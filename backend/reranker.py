"""
AdaptiRAG Reranker

Retrieval (dense / BM25 / hybrid) is fast but rough: it finds the right chunk often, yet does not always put it
first. A cross-encoder reranker reads the question and each candidate passage TOGETHER and scores how well the
passage answers the question, then the candidates are reordered by that score.

    retrieve ~20 candidates (fast)  ->  rerank them with the cross-encoder (slower, more accurate)  ->  keep top_k

The model runs locally (no API key, no Gemini quota) through `fastembed` (ONNX, no PyTorch needed). The first use
downloads the model once (about 90 MB) into the user's cache folder.

Settings (backend/.env):
    RERANK=on|off                     default off, so nothing changes until you decide
    RERANK_MODEL=Xenova/ms-marco-MiniLM-L-6-v2
    RERANK_CANDIDATES=20              how many retrieved chunks are reranked

If fastembed or the model is not available, reranking is skipped and the original order is kept (the app keeps
working). `reranker.error` explains why.
"""
import os
from typing import Any, Dict, List, Optional

DEFAULT_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"


class Reranker:
    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or os.getenv("RERANK_MODEL", DEFAULT_MODEL)
        self._encoder = None
        self.error: Optional[str] = None
        self._tried = False

    def _load(self) -> bool:
        if self._encoder is not None:
            return True
        if self._tried:
            return False
        self._tried = True
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            self._encoder = TextCrossEncoder(model_name=self.model_name)
            return True
        except Exception as e:  # missing package, no network for the first download, unsupported platform...
            self.error = f"{type(e).__name__}: {e}"
            print(f"[Reranker] Not available ({self.error}). Keeping the original retrieval order.")
            return False

    @property
    def available(self) -> bool:
        return self._load()

    def rerank(self, query: str, results: List[Dict[str, Any]], top_k: int) -> List[Dict[str, Any]]:
        """Reorder `results` (chunk dicts with a "text" field) by cross-encoder score and keep the best top_k."""
        if not results:
            return results
        if not self._load():
            return results[:top_k]
        scores = list(self._encoder.rerank(query, [r.get("text") or "" for r in results]))
        ranked = sorted(zip(scores, range(len(results))), key=lambda p: (-p[0], p[1]))
        out = []
        for score, idx in ranked[:top_k]:
            item = dict(results[idx])
            item["rerank_score"] = round(float(score), 4)
            item["reranked"] = True
            out.append(item)
        return out


reranker = Reranker()