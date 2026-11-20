"""
AdaptiRAG retrieval benchmark.

Compares the three retrieval modes of the real AdaptiRAG vector store on a question set with known
answers:  dense (FAISS embeddings)  vs  bm25 (keywords)  vs  hybrid (both, fused with RRF).

Run from the project root, from the backend virtual environment:

    backend\\venv\\Scripts\\python.exe scripts\\benchmark.py --dataset own
    backend\\venv\\Scripts\\python.exe scripts\\benchmark.py --dataset hotpotqa

Datasets
    own       your own documents  : data/benchmark_docs/*  +  data/own_questions.json
    hotpotqa  public multi-hop QA : data/hotpotqa_subset.json   (made by scripts/prepare_hotpotqa.py)
    --file X  any dataset file in the same format as hotpotqa_subset.json

What is measured (nothing is simulated)
    recall@k     share of the gold evidence found among the top-k retrieved chunks
    all-gold@k   share of questions where ALL gold evidence is found in the top-k (the multi-hop test)
    MRR          1 / rank of the first chunk that contains gold evidence, averaged over questions
    latency      time of the search itself (query embedding is cached and reported separately)
    context      average tokens in the retrieved chunks (what would be sent to the LLM)

Results are written to data/benchmark_results.json, which the Efficiency page shows.
Running a second dataset adds to the file instead of replacing the first.

This benchmark does not touch your uploaded documents or your FAISS index: it builds its own
in-memory index and never saves it.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import pickle
import random
import re
import sys
import time
from typing import Any, Dict, List, Tuple

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

try:  # API keys live in backend/.env
    from dotenv import load_dotenv
    load_dotenv(os.path.join(ROOT, "backend", ".env"))
except ImportError:
    pass

from chunking import chunk_text, extract_text  # noqa: E402
from embeddings import engine  # noqa: E402
import vector_store as vs_module  # noqa: E402

RESULTS_PATH = os.path.join(ROOT, "data", "benchmark_results.json")
CACHE_DIR = os.path.join(ROOT, "data", ".benchmark_cache")
KS = (1, 3, 5, 10)
# Systems compared. "rerank" adds the local cross-encoder (backend/reranker.py) on top of the retrieved candidates.
# The hybrid weights are the weight given to the dense ranking and to the BM25 ranking inside the RRF fusion.
CONFIGS = [
    {"name": "Dense (FAISS)", "mode": "dense"},
    {"name": "BM25 (keywords)", "mode": "bm25"},
    {"name": "Hybrid 1:1 (plain RRF)", "mode": "hybrid", "dense_weight": 1.0, "bm25_weight": 1.0},
    {"name": "Hybrid 1:0.5", "mode": "hybrid", "dense_weight": 1.0, "bm25_weight": 0.5},
    {"name": "Hybrid 1:0.25", "mode": "hybrid", "dense_weight": 1.0, "bm25_weight": 0.25},
    {"name": "Dense + rerank", "mode": "dense", "rerank": True},
    {"name": "Hybrid 1:1 + rerank", "mode": "hybrid", "dense_weight": 1.0, "bm25_weight": 1.0, "rerank": True},
]


# ------------------------------------------------------------------ text helpers
def norm(s: str) -> str:
    """Lower-case and collapse whitespace so evidence matching ignores layout differences."""
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


# ------------------------------------------------------------------ dataset loading
def load_own(chunk_size: int, overlap: int, docs_dir: str, questions_file: str) -> Dict[str, Any]:
    if not os.path.exists(questions_file):
        sys.exit(f"Missing {questions_file}. Create it with scripts/draft_questions.py (see its header).")
    with open(questions_file, "r", encoding="utf-8") as f:
        qdata = json.load(f)
    if not os.path.isdir(docs_dir):
        sys.exit(f"Missing folder {docs_dir}. Copy your documents (pdf, docx, txt, md) into it.")

    documents = []
    for name in sorted(os.listdir(docs_dir)):
        path = os.path.join(docs_dir, name)
        if not os.path.isfile(path) or name.startswith("."):
            continue
        try:
            with open(path, "rb") as f:
                text = extract_text(name, f.read())
        except Exception as e:  # unreadable file: say so and move on
            print(f"  skipping {name}: {e}")
            continue
        if text.strip():
            documents.append({"doc_id": name, "title": name, "text": text})
    if not documents:
        sys.exit(f"No readable documents found in {docs_dir}.")

    questions = []
    for q in qdata.get("questions", []):
        if q.get("status") == "rejected":
            continue
        ev = q.get("evidence") or []
        if isinstance(ev, str):
            ev = [ev]
        if not q.get("question") or not ev:
            continue
        questions.append({
            "question": q["question"],
            "answer": q.get("answer", ""),
            "gold": [{"text": e} for e in ev],
            "type": q.get("type", "factual"),
        })
    return {"name": qdata.get("name", "Own documents"), "kind": "own", "documents": documents, "questions": questions}


def load_file(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("kind", "public")
    return data


# ------------------------------------------------------------------ chunking and embedding
def build_chunks(dataset: Dict[str, Any], chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
    chunks, doc_ids = [], {}
    cid = 0
    for doc in dataset["documents"]:
        doc_int = doc_ids.setdefault(doc["doc_id"], len(doc_ids))
        for c in chunk_text(doc["text"], target_token_size=chunk_size, overlap_tokens=overlap):
            chunks.append({
                "chunk_id": cid, "document_id": doc_int, "doc_key": doc["doc_id"], "filename": doc["title"],
                "chunk_index": c["chunk_index"], "text": c["text"], "start_char": c.get("start_char"),
                "end_char": c.get("end_char"), "token_estimate": c.get("token_estimate", 0),
            })
            cid += 1
    return chunks


def _cache_file() -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tag = re.sub(r"[^a-z0-9]+", "_", f"{engine.provider}_{engine.model_name}".lower())
    return os.path.join(CACHE_DIR, f"emb_{tag}.pkl")


def _load_cache() -> Dict[str, np.ndarray]:
    try:
        with open(_cache_file(), "rb") as f:
            return pickle.load(f)
    except Exception:
        return {}


def _save_cache(cache: Dict[str, np.ndarray]) -> None:
    with open(_cache_file(), "wb") as f:
        pickle.dump(cache, f)


def embed_all(texts: List[str], label: str) -> Tuple[np.ndarray, float]:
    """
    Embeds texts with the project's embedding engine, caching results on disk so re-runs are instant.
    The engine silently falls back to a different local embedding when the API errors; mixing the two
    would corrupt the index, so a changed vector size is treated as a failure and retried.
    Returns (matrix, average seconds per text for the texts that were actually embedded).
    """
    cache = _load_cache()
    keys = [hashlib.sha1(t.encode("utf-8")).hexdigest() for t in texts]
    missing = [i for i, k in enumerate(keys) if k not in cache]
    spent, embedded = 0.0, 0
    batch = 5
    # Free-tier Gemini allows about 30,000 embedding tokens per minute. Stay under it with a rolling
    # one-minute token budget instead of hitting the limit and waiting. (1 token is about 4 characters.)
    # It also allows about 100 embedding REQUESTS per minute, and every text counts as one request.
    budget = int(os.getenv("EMBED_TOKENS_PER_MIN", "20000")) if engine.provider == "gemini" else 10**12
    max_texts = int(os.getenv("EMBED_TEXTS_PER_MIN", "80")) if engine.provider == "gemini" else 10**9
    window: List[Tuple[float, int, int]] = []  # (time sent, estimated tokens, number of texts)
    try:
        for start in range(0, len(missing), batch):
            idxs = missing[start:start + batch]
            est = sum(max(1, len(texts[i]) // 4) for i in idxs)
            for attempt in range(5):
                now = time.time()
                window = [w for w in window if now - w[0] < 60]
                while window and (sum(w[1] for w in window) + est > budget
                                  or sum(w[2] for w in window) + len(idxs) > max_texts):
                    time.sleep(max(0.5, 60 - (time.time() - window[0][0]) + 0.5))
                    now = time.time()
                    window = [w for w in window if now - w[0] < 60]
                t0 = time.perf_counter()
                vecs = engine.embed_texts([texts[i] for i in idxs])
                dt = time.perf_counter() - t0
                window.append((time.time(), est, len(idxs)))
                if vecs.shape[1] == engine.dimension:
                    break
                print(f"\n  embedding API refused a batch (attempt {attempt + 1}/5), waiting 65s for the limit to reset ...")
                time.sleep(65)
                window = []
            else:
                _save_cache(cache)
                sys.exit("The embedding API kept failing, so the benchmark stopped instead of mixing embeddings. "
                         "Progress is saved: run the same command again later. Check GEMINI_API_KEY and quota in "
                         "backend/.env, or run with EMBEDDING_PROVIDER=local.")
            for i, v in zip(idxs, vecs):
                cache[keys[i]] = v
            spent += dt
            embedded += len(idxs)
            done = start + len(idxs)
            print(f"  embedded {label}: {done}/{len(missing)}", end="\r")
            if (done // batch) % 40 == 0:
                _save_cache(cache)
    finally:
        if embedded:
            _save_cache(cache)
    if missing:
        print()
    matrix = np.vstack([cache[k] for k in keys]).astype(np.float32) if texts else np.empty((0, engine.dimension), np.float32)
    return matrix, (spent / embedded if embedded else 0.0)


def build_store(chunks: List[Dict[str, Any]], embeddings: np.ndarray):
    import faiss
    store = vs_module.VectorStore(auto_load=False)
    store.save = lambda: None  # never write to the real index files
    store.dimension = embeddings.shape[1]
    store.index = faiss.IndexFlatIP(store.dimension)
    store.index.add(embeddings)
    store.metadata = list(chunks)
    store._bm25 = None
    return store


# ------------------------------------------------------------------ evaluation
def gold_found(unit: Dict[str, str], chunk: Dict[str, Any]) -> bool:
    if "doc" in unit:
        return chunk.get("doc_key") == unit["doc"]
    return norm(unit["text"]) in norm(chunk.get("text", ""))


def evaluate_mode(store, cfg: Dict[str, Any], questions: List[Dict[str, Any]], q_vecs: np.ndarray,
                  headline_k: int) -> Dict[str, Any]:
    mode = cfg["mode"]
    # Use cached query embeddings so the timing below measures retrieval, not the embedding API.
    vec_by_query = {q["question"]: q_vecs[i] for i, q in enumerate(questions)}
    original = vs_module.engine.embed_query
    vs_module.engine.embed_query = lambda text: vec_by_query[text]
    top_k = max(KS)
    latencies, ctx_tokens = [], []
    recall = {k: [] for k in KS}
    allgold = {k: [] for k in KS}
    rr = []
    by_type: Dict[str, List[float]] = {}
    try:
        for q in questions:
            t0 = time.perf_counter()
            raw_results = store.search(
                q["question"], top_k=top_k, mode=mode,
                dense_weight=cfg.get("dense_weight"), bm25_weight=cfg.get("bm25_weight"),
                rerank=bool(cfg.get("rerank", False)))
            latencies.append((time.perf_counter() - t0) * 1000.0)
            # search() returns a trimmed view of each chunk; look up the full record (it has the doc key)
            results = [store.metadata[r["chunk_id"]] for r in raw_results]
            units = q["gold"]
            first_rank = 0
            for rank, r in enumerate(results, start=1):
                if any(gold_found(u, r) for u in units):
                    first_rank = rank
                    break
            rr.append(1.0 / first_rank if first_rank else 0.0)
            for k in KS:
                top = results[:k]
                found = sum(1 for u in units if any(gold_found(u, r) for r in top))
                recall[k].append(found / len(units))
                allgold[k].append(1.0 if found == len(units) else 0.0)
            ctx_tokens.append(sum(int(r.get("token_estimate") or 0) for r in results[:headline_k]))
            by_type.setdefault(q.get("type", "other"), []).append(allgold[headline_k][-1])
    finally:
        vs_module.engine.embed_query = original

    def mean(v):
        return float(sum(v) / len(v)) if v else 0.0

    lat_sorted = sorted(latencies)
    p95 = lat_sorted[max(0, math.ceil(0.95 * len(lat_sorted)) - 1)] if lat_sorted else 0.0
    return {
        "name": cfg["name"],
        "mode": mode,
        "dense_weight": cfg.get("dense_weight"),
        "bm25_weight": cfg.get("bm25_weight"),
        "rerank": bool(cfg.get("rerank", False)),
        "recall_at_k": round(mean(recall[headline_k]), 4),
        "all_gold_at_k": round(mean(allgold[headline_k]), 4),
        "mrr": round(mean(rr), 4),
        "recall_by_k": {str(k): round(mean(recall[k]), 4) for k in KS},
        "all_gold_by_k": {str(k): round(mean(allgold[k]), 4) for k in KS},
        "all_gold_by_type": {t: round(mean(v), 4) for t, v in by_type.items()},
        "avg_latency_ms": round(mean(latencies), 3),
        "p95_latency_ms": round(p95, 3),
        "avg_context_tokens": round(mean(ctx_tokens), 1),
    }


# ------------------------------------------------------------------ main
def main() -> None:
    ap = argparse.ArgumentParser(description="AdaptiRAG retrieval benchmark")
    ap.add_argument("--dataset", choices=["own", "hotpotqa"], help="which dataset to run")
    ap.add_argument("--file", help="path to a dataset JSON file (overrides --dataset)")
    ap.add_argument("--docs-dir", default=os.path.join(ROOT, "data", "benchmark_docs"))
    ap.add_argument("--questions", default=os.path.join(ROOT, "data", "own_questions.json"))
    ap.add_argument("--k", type=int, default=5, choices=KS, help="headline k shown in the table (default 5)")
    ap.add_argument("--chunk-size", type=int, default=600, help="target tokens per chunk (default 600, as in the app)")
    ap.add_argument("--overlap", type=int, default=100)
    ap.add_argument("--no-rerank", action="store_true", help="skip the systems that use the reranker")
    ap.add_argument("--limit", type=int, default=0, help="only use the first N questions (quick test)")
    args = ap.parse_args()

    if args.file:
        dataset = load_file(args.file)
    elif args.dataset == "own":
        dataset = load_own(args.chunk_size, args.overlap, args.docs_dir, args.questions)
    elif args.dataset == "hotpotqa":
        path = os.path.join(ROOT, "data", "hotpotqa_subset.json")
        if not os.path.exists(path):
            sys.exit("Missing data/hotpotqa_subset.json. Run: python scripts/prepare_hotpotqa.py")
        dataset = load_file(path)
    else:
        ap.error("give --dataset own, --dataset hotpotqa, or --file PATH")

    questions = dataset["questions"][: args.limit] if args.limit else dataset["questions"]
    if not questions:
        sys.exit("The dataset has no usable questions.")

    print(f"Dataset: {dataset['name']}  ({len(dataset['documents'])} documents, {len(questions)} questions)")
    print(f"Embedding: {engine.provider} / {engine.model_name} ({engine.dimension}-dim)")
    chunks = build_chunks(dataset, args.chunk_size, args.overlap)
    print(f"Chunks: {len(chunks)}  (target {args.chunk_size} tokens, overlap {args.overlap})")

    # Questions whose evidence text is not present in any chunk cannot be scored; drop and report them.
    valid = []
    for q in questions:
        ok = all(("doc" in u) or any(norm(u["text"]) in norm(c["text"]) for c in chunks) for u in q["gold"])
        if ok:
            valid.append(q)
    dropped = len(questions) - len(valid)
    if dropped:
        print(f"Dropped {dropped} questions whose evidence text is not found in any chunk (check the evidence quotes).")
    questions = valid
    if not questions:
        sys.exit("No scoreable questions left.")

    chunk_vecs, _ = embed_all([c["text"] for c in chunks], "chunks")
    q_vecs, per_query_s = embed_all([q["question"] for q in questions], "questions")
    store = build_store(chunks, chunk_vecs)

    from reranker import reranker
    configs = list(CONFIGS)
    if not args.no_rerank and not reranker.available:
        print(f"Reranker unavailable ({reranker.error}); skipping the rerank systems. "
              f"Install with: backend\\venv\\Scripts\\python.exe -m pip install fastembed")
    if args.no_rerank or not reranker.available:
        configs = [c for c in configs if not c.get("rerank")]

    systems = []
    for cfg in configs:
        res = evaluate_mode(store, cfg, questions, q_vecs, args.k)
        systems.append(res)
        print(f"  {res['name']:<26} recall@{args.k} {res['recall_at_k']:.3f}  all-gold@{args.k} {res['all_gold_at_k']:.3f}  "
              f"MRR {res['mrr']:.3f}  {res['avg_latency_ms']:.2f} ms")

    entry = {
        "name": dataset["name"],
        "kind": dataset.get("kind", "public"),
        "num_questions": len(questions),
        "num_dropped": dropped,
        "num_documents": len(dataset["documents"]),
        "num_chunks": len(chunks),
        "chunk_size": args.chunk_size,
        "overlap": args.overlap,
        "headline_k": args.k,
        "embedding": {"provider": engine.provider, "model": engine.model_name, "dimension": engine.dimension},
        "avg_query_embedding_ms": round(per_query_s * 1000.0, 2),
        "systems": systems,
    }

    # Merge into the shared results file (replace a previous run of the same dataset name)
    existing: Dict[str, Any] = {}
    if os.path.exists(RESULTS_PATH):
        try:
            with open(RESULTS_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = {}
    datasets = [d for d in existing.get("datasets", []) if d.get("name") != entry["name"]]
    datasets.append(entry)
    out = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "datasets": datasets,
    }
    os.makedirs(os.path.dirname(RESULTS_PATH), exist_ok=True)
    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()