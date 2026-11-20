"""
AdaptiRAG Phase 4: Router Agent
Adaptive Query Classification (Local Vector vs Global Graph vs Hybrid),
Intent Signal Extraction, Decision Reasoning, Execution Orchestration,
and Real-Time Telemetry / Cost Tracking.
"""
import os
import re
import time
import math
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

import models
from vector_store import vector_store
from generator import generator
from graph_pipeline import graph_pipeline
from router_model import LearnedRouter

class RouterAgent:
    def __init__(self):
        # Pricing model: $0.15 / 1M input tokens, $0.60 / 1M output tokens (Gemini 2.5 Flash / standard)
        self.cost_per_1k_input = 0.00015
        self.cost_per_1k_output = 0.00060
        self.graph_threshold = 0.55
        self.hybrid_threshold = 0.50
        self.active_model = "gemini-2.5-flash"

        # Learned classifier (backend/router_model.json). ROUTER_MODE=keyword in backend/.env switches
        # back to the original rule-based router, which is also the automatic fallback if the model file is missing.
        self.learned = LearnedRouter()
        self.use_learned = os.getenv("ROUTER_MODE", "learned").strip().lower() != "keyword"

        # Thematic / Global keywords
        self.thematic_keywords = [
            "compare", "comparison", "overview", "summary", "summarize",
            "trade-off", "tradeoff", "trade-offs", "architecture", "system",
            "how do", "difference", "differences", "relationship", "relationships",
            "limits", "bounds", "comprehensive", "main themes", "key themes", "across",
            "synthesize", "landscape", "contrast",
            "taxonomy", "paradigms", "macro", "broadly"
        ]

        # Factual / Local keywords
        self.factual_keywords = [
            "what is", "what are", "who", "who invented", "when", "define",
            "definition", "formula", "exact", "number of", "how many",
            "dimension", "metric", "type of", "step", "algorithm name",
            "equation", "quote", "citation", "index type", "parameter"
        ]

    @property
    def known_entities(self) -> List[str]:
        """Entity names found in the uploaded documents (from the knowledge graph), lower-cased.
        Used only as a signal that a question mentions several entities. Empty until a graph exists."""
        names = getattr(graph_pipeline, "id_to_name", {}) or {}
        return [n.lower() for n in names.values() if n and len(n) >= 3]

    def _estimate_for_route(self, route: str):
        """Planning estimates of latency (ms), tokens and cost (USD) for a route."""
        if route == "local":
            est_latency, est_tokens, in_share = 185.0, 420, 0.70
        elif route == "global":
            est_latency, est_tokens, in_share = 380.0, 920, 0.75
        else:  # hybrid
            est_latency, est_tokens, in_share = 490.0, 1350, 0.72
        est_cost = round(
            (est_tokens * in_share * self.cost_per_1k_input / 1000)
            + (est_tokens * (1 - in_share) * self.cost_per_1k_output / 1000), 6)
        return est_latency, est_tokens, est_cost

    def classify(self, query: str) -> Dict[str, Any]:
        """
        Decides local / global / hybrid. Uses the learned classifier when its model file is available
        (default), otherwise the keyword rules. The result keeps the same fields either way, and adds
        "classifier" ("learned" or "keyword") and "probabilities" (learned only).
        """
        result = self.classify_keyword(query)  # also supplies the keyword signals shown in the UI
        if not (self.use_learned and self.learned.available):
            result["classifier"] = "keyword"
            return result

        route, confidence, probs = self.learned.predict(query)
        q_lower = query.lower()
        archetype = {
            "local": "pointwise_fact",
            "global": "thematic_comparison" if any(k in q_lower for k in ["compare", "contrast", "difference", "versus", " vs "]) else "macro_overview",
            "hybrid": "hybrid_multi_hop",
        }[route]
        engine = {
            "local": "LOCAL retrieval (hybrid BM25 + dense vector search) for the lowest latency on a specific fact.",
            "global": "GLOBAL Knowledge Graph map-reduce over community summaries for a broad or comparative answer.",
            "hybrid": "HYBRID dual retrieval: vector evidence for the facts plus graph communities for the relationships.",
        }[route]
        terms = self.learned.top_terms(query)
        est_latency, est_tokens, est_cost = self._estimate_for_route(route)

        result.update({
            "route": route,
            "confidence": round(confidence, 3),
            "reasoning": (
                f"Learned router predicts {route.upper()} at {confidence:.0%} confidence "
                f"(local {probs['local']:.0%}, global {probs['global']:.0%}, hybrid {probs['hybrid']:.0%})"
                + (f"; influential terms: {', '.join(repr(t) for t in terms)}" if terms else "")
                + f". Routed to {engine}"
            ),
            "intent_breakdown": {
                "factual_specificity": round(probs["local"], 3),
                "thematic_breadth": round(probs["global"], 3),
                "relational_multi_hop": round(probs["hybrid"], 3),
            },
            "estimated_latency_ms": est_latency,
            "estimated_tokens": est_tokens,
            "estimated_cost_usd": est_cost,
            "classifier": "learned",
            "probabilities": {k: round(v, 3) for k, v in probs.items()},
        })
        result["signals"] = dict(result["signals"], archetype=archetype, learned_terms=terms)
        return result

    def classify_keyword(self, query: str) -> Dict[str, Any]:
        """
        The original rule-based classifier. Classifies query intent into 'local' (vector), 'global' (graph), or 'hybrid'.
        Computes feature signals, confidence score, intent breakdown, and reasoning.
        """
        q_lower = query.lower().strip()
        words = re.findall(r'\b[a-z0-9_\-]+\b', q_lower)
        query_len = len(words)

        # 1. Match signals
        matched_thematic = [kw for kw in self.thematic_keywords if kw in q_lower]
        matched_factual = [kw for kw in self.factual_keywords if kw in q_lower]
        matched_entities = [ent for ent in self.known_entities if re.search(r"\b" + re.escape(ent) + r"\b", q_lower)]

        # 2. Compute Intent Scores (0.0 to 1.0)
        # Thematic breadth score
        thematic_raw = (len(matched_thematic) * 0.35) + (0.15 if any(k in q_lower for k in ["compare", "overview", "difference", "trade-off", "landscape"]) else 0.0)
        if query_len > 12:
            thematic_raw += 0.10
        thematic_score = min(1.0, round(thematic_raw, 3))

        # Factual specificity score
        factual_raw = (len(matched_factual) * 0.35) + (0.25 if len(matched_entities) == 1 else 0.0)
        if any(q_lower.startswith(p) for p in ["what is", "who", "define", "how many", "when"]):
            factual_raw += 0.30
        if query_len < 10 and len(matched_thematic) == 0:
            factual_raw += 0.20
        factual_score = min(1.0, round(factual_raw, 3))

        # Relational multi-hop score
        relational_raw = 0.0
        if len(matched_entities) >= 2:
            relational_raw += 0.40
        if any(w in q_lower for w in ["and", "with", "between", "connect", "relate", "versus", "vs"]):
            relational_raw += 0.25
        if matched_thematic and matched_factual:
            relational_raw += 0.25
        relational_score = min(1.0, round(relational_raw, 3))

        # 3. Decision Logic & Archetype Determination
        route = "local"
        archetype = "pointwise_fact"
        confidence = 0.85
        reasoning = ""

        if relational_score >= self.hybrid_threshold and len(matched_entities) >= 2 and (thematic_score >= 0.35 or factual_score >= 0.35):
            route = "hybrid"
            archetype = "hybrid_multi_hop"
            confidence = min(0.97, round(0.78 + (relational_score * 0.18), 3))
            reasoning = (
                f"Query spans multiple distinct entities ({', '.join(matched_entities[:2])}) with relational connective phrasing. "
                f"Routed to HYBRID Dual-Retrieval: combining dense vector precision for factual claims with knowledge graph community traversal."
            )
        elif thematic_score >= self.graph_threshold or len(matched_thematic) >= 2:
            route = "global"
            archetype = "thematic_comparison" if any(k in q_lower for k in ["compare", "difference", "vs", "versus"]) else "macro_overview"
            confidence = min(0.98, round(0.80 + (thematic_score * 0.18), 3))
            keywords_str = ", ".join(f"'{k}'" for k in matched_thematic[:3])
            reasoning = (
                f"Detected macro thematic indicators ({keywords_str or 'high-level synthesis'}) requiring multi-document aggregation. "
                f"Routed to GLOBAL Knowledge Graph Map-Reduce to synthesize hierarchical Louvain community summaries."
            )
        else:
            route = "local"
            archetype = "pointwise_fact"
            confidence = min(0.96, round(0.82 + (factual_score * 0.14), 3))
            reasoning = (
                f"Query targets specific pointwise factual knowledge (e.g. definitions, parameters, specific algorithms). "
                f"Routed to LOCAL Dense Vector Retrieval (FAISS IndexFlatIP) for lowest latency and high lexical-semantic precision."
            )

        # 4. Latency, Token & Cost Estimates
        est_latency, est_tokens, est_cost = self._estimate_for_route(route)

        return {
            "query": query,
            "route": route,
            "confidence": confidence,
            "reasoning": reasoning,
            "intent_breakdown": {
                "factual_specificity": factual_score,
                "thematic_breadth": thematic_score,
                "relational_multi_hop": relational_score
            },
            "signals": {
                "thematic_keywords": matched_thematic,
                "factual_keywords": matched_factual,
                "entity_matches": matched_entities,
                "query_length": query_len,
                "archetype": archetype
            },
            "estimated_latency_ms": est_latency,
            "estimated_tokens": est_tokens,
            "estimated_cost_usd": est_cost
        }

    def execute_query(
        self,
        query: str,
        mode: str = "auto",
        db_session: Optional[Session] = None,
        current_user: Optional[models.User] = None,
        top_k: int = 4,
        community_level: int = 0,
        document_id: Optional[int] = None,
        document_ids: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        Executes query based on auto-classification or forced mode, records telemetry,
        and returns grounded synthesized response.
        """
        start_time = time.time()
        classification = self.classify(query)

        chosen_route = classification["route"]
        if mode in ["local", "vector"]:
            chosen_route = "local"
        elif mode in ["global", "graph"]:
            chosen_route = "global"
        elif mode == "hybrid":
            chosen_route = "hybrid"

        # Restricted scope (one document, or a hand-picked set): the knowledge graph is built over ALL
        # documents together, so graph routes would leak content from other files. Answer from the chosen
        # documents' chunks instead, retrieving more of them so broad questions still get good coverage.
        scope = "all"
        scope_note = None
        scope_ids: Optional[List[int]] = None
        if document_ids:
            scope = "selected"
            scope_ids = [int(d) for d in document_ids]
        elif document_id is not None:
            scope = "document"
            scope_ids = [int(document_id)]
        if scope_ids is not None and chosen_route in ("global", "hybrid"):
            scope_note = (
                "Selected-documents scope: used retrieval inside the chosen documents instead of the cross-document graph."
                if scope == "selected"
                else "Single-document scope: used document-wide retrieval instead of the cross-document graph."
            )
            chosen_route = "local"
            top_k = max(top_k, 8)

        citations: List[Dict[str, Any]] = []
        community_citations: List[Dict[str, Any]] = []
        entity_citations: List[str] = []
        answer = ""
        model_name = self.active_model
        total_tokens = 0
        input_tokens = 0
        output_tokens = 0
        tokens_exact = True

        # Route 1: LOCAL Vector Retrieval
        if chosen_route == "local":
            citations = vector_store.search(query=query, top_k=top_k, min_similarity=0.0, document_ids=scope_ids)
            gen_result = generator.generate_grounded_answer(query, citations)
            answer = gen_result.get("answer", "")
            total_tokens = gen_result.get("tokens_used", 0)
            input_tokens = gen_result.get("input_tokens", 0)
            output_tokens = gen_result.get("output_tokens", 0)
            tokens_exact = gen_result.get("tokens_exact", False)
            model_name = gen_result.get("model", self.active_model)

        # Route 2: GLOBAL Graph Map-Reduce
        elif chosen_route == "global":
            graph_res = graph_pipeline.execute_global_query(
                query=query,
                db_session=db_session,
                target_level=community_level,
                top_communities=3
            )
            answer = graph_res.get("answer", "")
            community_citations = graph_res.get("community_citations", [])
            entity_citations = graph_res.get("entity_citations", [])
            total_tokens = graph_res.get("tokens_used", 0)
            input_tokens = graph_res.get("input_tokens", 0)
            output_tokens = graph_res.get("output_tokens", 0)
            tokens_exact = graph_res.get("tokens_exact", False)
            model_name = graph_res.get("model", self.active_model)

            # Map community citations for uniform citation output
            for c in community_citations:
                citations.append({
                    "document_id": c.get("community_id", 0),
                    "filename": f"Community: {c.get('title', '')}",
                    "chunk_index": c.get("level", 0),
                    "start_char": 0,
                    "end_char": len(c.get("summary", "")),
                    "score": 0.94,
                    "text": f"Community Summary [{c.get('title')}]: {c.get('summary')}",
                    "token_estimate": len(c.get("summary", "").split())
                })

        # Route 3: HYBRID Dual Retrieval (Vector + Graph)
        else: # hybrid
            vector_citations = vector_store.search(query=query, top_k=2, min_similarity=0.0, document_ids=scope_ids)
            graph_res = graph_pipeline.execute_global_query(
                query=query,
                db_session=db_session,
                target_level=community_level,
                top_communities=2
            )

            community_citations = graph_res.get("community_citations", [])
            entity_citations = graph_res.get("entity_citations", [])

            # Combine citations
            citations = list(vector_citations)
            for c in community_citations:
                citations.append({
                    "document_id": c.get("community_id", 0),
                    "filename": f"Community: {c.get('title', '')}",
                    "chunk_index": c.get("level", 0),
                    "start_char": 0,
                    "end_char": len(c.get("summary", "")),
                    "score": 0.95,
                    "text": f"Community Summary [{c.get('title')}]: {c.get('summary')}",
                    "token_estimate": len(c.get("summary", "").split())
                })

            # Synthesize the hybrid answer with the language model (real token usage comes back with it)
            gen_res = generator.generate_hybrid_answer(query, vector_citations, community_citations)
            answer = gen_res.get("answer", "")
            total_tokens = gen_res.get("tokens_used", 0)
            input_tokens = gen_res.get("input_tokens", 0)
            output_tokens = gen_res.get("output_tokens", 0)
            tokens_exact = gen_res.get("tokens_exact", False)
            model_name = gen_res.get("model", self.active_model)

        elapsed_ms = round((time.time() - start_time) * 1000.0, 2)
        if (input_tokens or output_tokens) and not str(model_name).startswith("extractive"):
            # Real input/output split reported by the model
            cost_usd = round((input_tokens / 1000.0) * self.cost_per_1k_input + (output_tokens / 1000.0) * self.cost_per_1k_output, 6)
        else:
            # No model was used (offline fallback), so nothing was billed
            cost_usd = 0.0

        # Telemetry logging to database
        if db_session:
            try:
                log_entry = models.QueryLog(
                    query_text=query,
                    route=chosen_route,
                    confidence=classification["confidence"],
                    cost_tokens=total_tokens,
                    latency_ms=elapsed_ms,
                    reasoning=classification["reasoning"],
                    cost_usd=cost_usd,
                    user_id=current_user.id if current_user else None
                )
                db_session.add(log_entry)
                db_session.commit()
            except Exception as e:
                print(f"[Router Telemetry Error] Failed to persist QueryLog: {e}")
                db_session.rollback()

        return {
            "query": query,
            "route": chosen_route,
            "answer": answer,
            "citations": citations,
            "community_citations": community_citations,
            "entity_citations": entity_citations,
            "latency_ms": elapsed_ms,
            "tokens_used": total_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "tokens_exact": tokens_exact,
            "cost_usd": cost_usd,
            "model": model_name,
            "classification": classification,
            "scope": scope,
            "scope_note": scope_note
        }

    def get_telemetry_stats(self, db_session: Session, limit: int = 50) -> Dict[str, Any]:
        """
        Computes aggregated telemetry metrics, distribution, cost tracking, and recent logs.
        """
        logs = db_session.query(models.QueryLog).order_by(models.QueryLog.created_at.desc()).limit(limit).all()

        total_queries = len(logs)
        route_distribution = {"local": 0, "global": 0, "hybrid": 0}
        latency_by_route = {"local": [], "global": [], "hybrid": []}
        total_tokens = 0
        total_cost = 0.0
        confidence_sum = 0.0

        for l in logs:
            r = l.route.lower() if l.route else "local"
            # Normalize legacy labels
            if r in ["vector", "local"]:
                r = "local"
            elif r in ["graph", "global"]:
                r = "global"
            elif r not in route_distribution:
                r = "local"

            route_distribution[r] = route_distribution.get(r, 0) + 1
            if l.latency_ms:
                latency_by_route[r].append(l.latency_ms)
            total_tokens += (l.cost_tokens or 0)
            total_cost += getattr(l, "cost_usd", 0.0) or (l.cost_tokens * 0.00000035)
            confidence_sum += (l.confidence or 0.85)

        avg_latency = {}
        for r, lat_list in latency_by_route.items():
            avg_latency[r] = round(sum(lat_list) / len(lat_list), 2) if lat_list else 0.0

        route_percentages = {}
        for r, count in route_distribution.items():
            pct = round((count / total_queries * 100), 1) if total_queries > 0 else 0.0
            route_percentages[r] = pct

        avg_conf = round(confidence_sum / total_queries, 3) if total_queries > 0 else 0.88

        formatted_logs = [
            {
                "id": l.id,
                "query_text": l.query_text,
                "route": l.route,
                "confidence": round(l.confidence or 0.85, 3),
                "cost_tokens": l.cost_tokens or 0,
                "latency_ms": round(l.latency_ms or 0.0, 2),
                "reasoning": getattr(l, "reasoning", None) or f"Routed to {l.route} based on query semantics.",
                "cost_usd": round(getattr(l, "cost_usd", 0.0) or ((l.cost_tokens or 0) * 0.00000035), 6),
                "created_at": l.created_at.isoformat() if l.created_at else None
            }
            for l in logs
        ]

        return {
            "stats": {
                "total_queries": total_queries,
                "route_distribution": route_distribution,
                "route_percentages": route_percentages,
                "avg_latency_by_route_ms": avg_latency,
                "total_tokens": total_tokens,
                "total_cost_usd": round(total_cost, 6),
                "avg_confidence": avg_conf
            },
            "recent_logs": formatted_logs
        }

router_agent = RouterAgent()