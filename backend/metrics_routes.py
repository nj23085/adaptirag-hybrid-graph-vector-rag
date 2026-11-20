"""
AdaptiRAG - Chunk & Efficiency metrics endpoints.

Powers the "Efficiency & Chunks" page:
  GET /chunks/stats        -> chunk statistics (global + per document + size histogram)
  GET /chunks              -> paginated chunk list (optionally for one document)
  GET /metrics/efficiency  -> measured latency / tokens / cost per route, from real query logs,
                              plus benchmark results (data/benchmark_results.json) when available

Every number here is computed from data actually stored in the database.
Nothing is simulated or hardcoded.
"""
import os
import json
import math
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from database import get_db
from vector_store import vector_store

router = APIRouter(tags=["metrics"])

BENCHMARK_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "benchmark_results.json")
ROUTER_EVAL_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "router_eval.json")

# Token-size buckets for the chunk size histogram
HISTOGRAM_BUCKETS = [(0, 100), (100, 200), (200, 300), (300, 400), (400, 500), (500, 600), (600, 700), (700, 10**9)]


def _bucket_label(lo: int, hi: int) -> str:
    return f"{lo}+" if hi >= 10**9 else f"{lo}-{hi}"


def _percentile(values: List[float], pct: float) -> float:
    """Nearest-rank percentile. Returns 0.0 for an empty list."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100.0 * len(ordered)))
    return round(float(ordered[rank - 1]), 2)


@router.get("/chunks/stats")
def chunk_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Global and per-document chunk statistics plus a token-size histogram."""
    rows = (
        db.query(
            models.Chunk.document_id,
            func.count(models.Chunk.id),
            func.avg(models.Chunk.token_estimate),
            func.min(models.Chunk.token_estimate),
            func.max(models.Chunk.token_estimate),
            func.sum(models.Chunk.token_estimate),
        )
        .group_by(models.Chunk.document_id)
        .all()
    )
    stats_by_doc = {r[0]: r for r in rows}

    documents = []
    for doc in db.query(models.Document).order_by(models.Document.uploaded_at.desc()).all():
        r = stats_by_doc.get(doc.id)
        documents.append({
            "document_id": doc.id,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "file_size": doc.file_size,
            "status": doc.status,
            "chunk_count": int(r[1]) if r else 0,
            "avg_tokens": round(float(r[2]), 1) if r and r[2] is not None else 0.0,
            "min_tokens": int(r[3]) if r and r[3] is not None else 0,
            "max_tokens": int(r[4]) if r and r[4] is not None else 0,
            "total_tokens": int(r[5]) if r and r[5] is not None else 0,
            "uploaded_at": doc.uploaded_at.isoformat() if doc.uploaded_at else None,
        })

    token_values = [t[0] or 0 for t in db.query(models.Chunk.token_estimate).all()]
    histogram = []
    for lo, hi in HISTOGRAM_BUCKETS:
        histogram.append({
            "bucket": _bucket_label(lo, hi),
            "count": sum(1 for t in token_values if lo <= t < hi),
        })

    total_chunks = len(token_values)
    return {
        "total_documents": len(documents),
        "total_chunks": total_chunks,
        "total_tokens": int(sum(token_values)),
        "avg_tokens_per_chunk": round(sum(token_values) / total_chunks, 1) if total_chunks else 0.0,
        "min_tokens": min(token_values) if token_values else 0,
        "max_tokens": max(token_values) if token_values else 0,
        "histogram": histogram,
        "documents": documents,
        "vector_index": vector_store.get_stats(),
    }


@router.get("/chunks")
def list_chunks(
    document_id: Optional[int] = Query(None, description="Only chunks of this document"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Paginated chunk list, ordered by document then position."""
    q = db.query(models.Chunk, models.Document.filename).join(
        models.Document, models.Document.id == models.Chunk.document_id
    )
    if document_id is not None:
        q = q.filter(models.Chunk.document_id == document_id)

    total = q.count()
    rows = (
        q.order_by(models.Chunk.document_id, models.Chunk.chunk_index)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "chunks": [
            {
                "chunk_id": c.id,
                "document_id": c.document_id,
                "filename": filename,
                "chunk_index": c.chunk_index,
                "text": c.text,
                "token_estimate": c.token_estimate,
                "char_length": len(c.text or ""),
                "start_char": c.start_char,
                "end_char": c.end_char,
            }
            for c, filename in rows
        ],
    }


@router.get("/metrics/efficiency")
def efficiency_metrics(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Measured efficiency per route (local / global / hybrid) from the QueryLog table,
    plus benchmark results if scripts/benchmark.py has been run.
    """
    logs = db.query(models.QueryLog).all()

    per_route: Dict[str, Dict[str, Any]] = {}
    for route in ("local", "global", "hybrid"):
        subset = [l for l in logs if l.route == route]
        latencies = [float(l.latency_ms or 0.0) for l in subset]
        tokens = [int(l.cost_tokens or 0) for l in subset]
        costs = [float(l.cost_usd or 0.0) for l in subset]
        n = len(subset)
        per_route[route] = {
            "queries": n,
            "avg_latency_ms": round(sum(latencies) / n, 2) if n else 0.0,
            "p50_latency_ms": _percentile(latencies, 50),
            "p95_latency_ms": _percentile(latencies, 95),
            "avg_tokens": round(sum(tokens) / n, 1) if n else 0.0,
            "total_tokens": int(sum(tokens)),
            "avg_cost_usd": round(sum(costs) / n, 6) if n else 0.0,
            "total_cost_usd": round(sum(costs), 6),
            "avg_confidence": round(sum(float(l.confidence or 0.0) for l in subset) / n, 3) if n else 0.0,
        }

    total = len(logs)
    route_mix = [
        {"route": r, "queries": per_route[r]["queries"],
         "share": round(per_route[r]["queries"] / total, 3) if total else 0.0}
        for r in ("local", "global", "hybrid")
    ]

    recent = (
        db.query(models.QueryLog).order_by(models.QueryLog.created_at.desc()).limit(20).all()
    )
    recent_queries = [
        {
            "query": l.query_text,
            "route": l.route,
            "confidence": l.confidence,
            "latency_ms": l.latency_ms,
            "tokens": l.cost_tokens,
            "cost_usd": l.cost_usd,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in recent
    ]

    benchmark = None
    if os.path.exists(BENCHMARK_FILE):
        try:
            with open(BENCHMARK_FILE, "r", encoding="utf-8") as f:
                benchmark = json.load(f)
        except Exception as e:
            benchmark = {"error": f"Could not read benchmark results: {e}"}

    router_eval = None
    if os.path.exists(ROUTER_EVAL_FILE):
        try:
            with open(ROUTER_EVAL_FILE, "r", encoding="utf-8") as f:
                router_eval = json.load(f)
        except Exception as e:
            router_eval = {"error": f"Could not read router evaluation: {e}"}

    return {
        "total_queries": total,
        "per_route": per_route,
        "route_mix": route_mix,
        "recent_queries": recent_queries,
        "benchmark": benchmark,
        "router_eval": router_eval,
    }