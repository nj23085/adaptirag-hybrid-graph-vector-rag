"""
AdaptiRAG FAISS Vector Store
Manages IndexFlatIP (Cosine Similarity) with metadata preservation and disk persistence.
"""
import os
import json
import numpy as np
import faiss
from typing import List, Dict, Any, Optional
from embeddings import engine
from lexical_index import BM25Index

INDEX_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", "vector_index.faiss")
METADATA_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", "vector_metadata.json")

# Retrieval modes: "dense" (FAISS only), "bm25" (keywords only), "hybrid" (both, fused with RRF).
# Override the default in backend/.env with RETRIEVAL_MODE=dense|bm25|hybrid
RETRIEVAL_MODES = ("dense", "bm25", "hybrid")
DEFAULT_RETRIEVAL_MODE = "hybrid"
RRF_K = 60  # standard reciprocal-rank-fusion constant
# Weight of each ranking inside the hybrid fusion (1.0 and 1.0 = plain RRF, the original behaviour).
# Override in backend/.env with DENSE_WEIGHT=... and BM25_WEIGHT=...
DEFAULT_DENSE_WEIGHT = 1.0
DEFAULT_BM25_WEIGHT = 1.0

class VectorStore:
    def __init__(self, auto_load: bool = True):
        self.dimension = engine.dimension
        self.index: Optional[faiss.IndexFlatIP] = None
        self.metadata: List[Dict[str, Any]] = []
        self._bm25: Optional[BM25Index] = None  # built lazily from self.metadata

        if auto_load and os.path.exists(INDEX_FILE_PATH) and os.path.exists(METADATA_FILE_PATH):
            self.load()
        else:
            self._create_empty_index()

    def _create_empty_index(self):
        self.dimension = engine.dimension
        self.index = faiss.IndexFlatIP(self.dimension)
        self.metadata = []
        self._bm25 = None

    def save(self):
        if self.index is not None:
            faiss.write_index(self.index, INDEX_FILE_PATH)
            with open(METADATA_FILE_PATH, "w", encoding="utf-8") as f:
                json.dump(self.metadata, f, indent=2)

    def load(self):
        try:
            loaded_index = faiss.read_index(INDEX_FILE_PATH)
            with open(METADATA_FILE_PATH, "r", encoding="utf-8") as f:
                loaded_meta = json.load(f)

            if loaded_index.d == engine.dimension:
                self.index = loaded_index
                self.metadata = loaded_meta
                self.dimension = loaded_index.d
                self._bm25 = None
                print(f"[VectorStore] Successfully loaded FAISS index with {self.index.ntotal} vectors.")
            else:
                print(f"[VectorStore] Dimension mismatch (Index={loaded_index.d}, Engine={engine.dimension}). Reinitializing.")
                self._create_empty_index()
        except Exception as e:
            print(f"[VectorStore] Failed to load index from disk: {e}. Starting fresh.")
            self._create_empty_index()

    def add_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        """
        Embeds chunks and inserts into the FAISS index.
        chunks schema:
        [
          {
            "chunk_id": int,
            "document_id": int,
            "filename": str,
            "chunk_index": int,
            "text": str,
            "start_char": int,
            "end_char": int,
            "token_estimate": int
          }
        ]
        """
        if not chunks:
            return 0

        texts = [c["text"] for c in chunks]
        embeddings = engine.embed_texts(texts)

        if self.index is None or self.index.d != embeddings.shape[1]:
            self.dimension = embeddings.shape[1]
            self.index = faiss.IndexFlatIP(self.dimension)
            self.metadata = []

        self.index.add(embeddings)
        self.metadata.extend(chunks)
        self._bm25 = None  # keyword index is rebuilt on next search
        self.save()
        return len(chunks)

    @staticmethod
    def resolve_mode(mode: Optional[str] = None) -> str:
        """Pick the retrieval mode: explicit argument > RETRIEVAL_MODE env var > hybrid."""
        chosen = (mode or os.getenv("RETRIEVAL_MODE") or DEFAULT_RETRIEVAL_MODE).strip().lower()
        return chosen if chosen in RETRIEVAL_MODES else DEFAULT_RETRIEVAL_MODE

    def _get_bm25(self) -> BM25Index:
        if self._bm25 is None:
            index = BM25Index()
            index.build([m.get("text", "") for m in self.metadata])
            self._bm25 = index
        return self._bm25

    def search(
        self,
        query: str,
        top_k: int = 4,
        min_similarity: float = 0.0,
        mode: Optional[str] = None,
        document_id: Optional[int] = None,
        dense_weight: Optional[float] = None,
        bm25_weight: Optional[float] = None,
        rerank: Optional[bool] = None,
        document_ids: Optional[List[int]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve the top_k chunks for a query.

        mode="dense":  FAISS cosine similarity only (the original behaviour).
        mode="bm25":   keyword (BM25) ranking only.
        mode="hybrid": both rankings merged with Reciprocal Rank Fusion (RRF).

        Every result keeps `score` = cosine similarity (so the UI relevance stays meaningful),
        and also carries `dense_score`, `bm25_score`, `fusion_score` and `retrieval_mode`.
        min_similarity is applied in dense mode only.
        document_id: if given, only chunks of that document are searched.
        document_ids: if given, only chunks of any of these documents are searched (used by "selected documents").
        dense_weight / bm25_weight: weights of the two rankings in the hybrid fusion (default: env or 1.0 each).
        rerank: True/False to force; None = use the RERANK env var (default off). When on, RERANK_CANDIDATES
                chunks are retrieved, reordered by the cross-encoder in reranker.py, and the best top_k kept.
        """
        if self.index is None or self.index.ntotal == 0:
            return []

        if rerank is None:
            rerank = os.getenv("RERANK", "off").strip().lower() in ("on", "1", "true", "yes")
        if rerank:
            from reranker import reranker
            if reranker.available:
                n_cand = max(top_k, int(os.getenv("RERANK_CANDIDATES", "20")))
                candidates = self.search(query, top_k=n_cand, min_similarity=min_similarity, mode=mode,
                                         document_id=document_id, dense_weight=dense_weight,
                                         bm25_weight=bm25_weight, rerank=False, document_ids=document_ids)
                return reranker.rerank(query, candidates, top_k)

        mode = self.resolve_mode(mode)
        total = self.index.ntotal
        k = min(top_k, total)

        # Optional restriction to one document, or to a chosen set of documents
        wanted: Optional[set] = None
        if document_ids:
            wanted = {int(d) for d in document_ids}
        elif document_id is not None:
            wanted = {int(document_id)}
        allowed: Optional[set] = None
        if wanted is not None:
            allowed = {i for i, m in enumerate(self.metadata) if m.get("document_id") in wanted}
            if not allowed:
                return []

        # Candidates taken from each ranker before fusion. When restricted to one document we rank
        # the whole index (exact flat search, cheap at this scale) and keep only that document's chunks.
        pool = total if allowed is not None else min(total, max(k * 5, 20))

        q_vec = engine.embed_query(query).reshape(1, -1)

        dense_scores: Dict[int, float] = {}
        dense_order: List[int] = []
        if mode in ("dense", "hybrid"):
            scores, indices = self.index.search(q_vec, pool)
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0 or idx >= len(self.metadata):
                    continue
                if allowed is not None and int(idx) not in allowed:
                    continue
                dense_scores[int(idx)] = float(score)
                dense_order.append(int(idx))

        bm25_scores: Dict[int, float] = {}
        bm25_order: List[int] = []
        if mode in ("bm25", "hybrid"):
            for idx, score in self._get_bm25().search(query, top_k=pool):
                if allowed is not None and idx not in allowed:
                    continue
                bm25_scores[idx] = score
                bm25_order.append(idx)

        # Final ranking
        fusion_scores: Dict[int, float] = {}
        if mode == "dense":
            ranked = dense_order[:k]
        elif mode == "bm25":
            ranked = bm25_order[:k]
        else:
            w_dense = DEFAULT_DENSE_WEIGHT if dense_weight is None else dense_weight
            w_bm25 = DEFAULT_BM25_WEIGHT if bm25_weight is None else bm25_weight
            env_d, env_b = os.getenv("DENSE_WEIGHT"), os.getenv("BM25_WEIGHT")
            if dense_weight is None and env_d:
                w_dense = float(env_d)
            if bm25_weight is None and env_b:
                w_bm25 = float(env_b)
            for order, weight in ((dense_order, w_dense), (bm25_order, w_bm25)):
                for rank, idx in enumerate(order, start=1):
                    fusion_scores[idx] = fusion_scores.get(idx, 0.0) + weight / (RRF_K + rank)
            ranked = sorted(fusion_scores, key=fusion_scores.get, reverse=True)[:k]

        results = []
        for idx in ranked:
            # Cosine similarity for every result, even keyword-only hits
            if idx in dense_scores:
                cosine = dense_scores[idx]
            else:
                cosine = float(np.dot(self.index.reconstruct(idx), q_vec[0]))
            if mode == "dense" and cosine < min_similarity:
                continue

            meta = self.metadata[idx]
            results.append({
                "score": round(cosine, 4),
                "dense_score": round(dense_scores[idx], 4) if idx in dense_scores else None,
                "bm25_score": round(bm25_scores[idx], 4) if idx in bm25_scores else None,
                "fusion_score": round(fusion_scores[idx], 5) if idx in fusion_scores else None,
                "retrieval_mode": mode,
                "chunk_id": meta.get("chunk_id"),
                "document_id": meta.get("document_id"),
                "filename": meta.get("filename"),
                "chunk_index": meta.get("chunk_index"),
                "start_char": meta.get("start_char"),
                "end_char": meta.get("end_char"),
                "token_estimate": meta.get("token_estimate"),
                "text": meta.get("text"),
            })

        return results

    def reset(self):
        self._create_empty_index()
        if os.path.exists(INDEX_FILE_PATH):
            try:
                os.remove(INDEX_FILE_PATH)
            except OSError:
                pass
        if os.path.exists(METADATA_FILE_PATH):
            try:
                os.remove(METADATA_FILE_PATH)
            except OSError:
                pass

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_vectors": self.index.ntotal if self.index is not None else 0,
            "dimension": self.dimension,
            "index_type": "IndexFlatIP (Cosine Similarity)",
            "retrieval_mode": self.resolve_mode(),
            "provider_info": engine.get_info(),
        }

# Global singleton instance
vector_store = VectorStore(auto_load=True)