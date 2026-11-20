"""
AdaptiRAG Knowledge Graph Pipeline
Constructs the knowledge graph in Neo4j (primary) or networkx (fallback),
executes Louvain hierarchical community detection, computes topological metrics,
and runs Map-Reduce community summarization for Global Graph-RAG QA.
"""
import os
import re
import json
import time
from typing import List, Dict, Any, Optional, Tuple
import networkx as nx
from networkx.algorithms.community import louvain_communities, modularity

from neo4j_store import neo4j_store


class GraphPipeline:
    def __init__(self):
        # In-memory networkx graph used as FALLBACK when Neo4j is unavailable
        self.graph = nx.Graph()
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}  # canonical_name -> entity dict
        self.id_to_name: Dict[int, str] = {}
        self.name_to_id: Dict[str, int] = {}
        self.communities_cache: List[Dict[str, Any]] = []
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self._gemini_client = None
        self._last_modularity: float = 0.0

        if self.gemini_key:
            try:
                from google import genai
                self._gemini_client = genai.Client()
            except Exception as e:
                print(f"[GraphPipeline] Gemini client notice: {e}")

    @property
    def use_neo4j(self) -> bool:
        """Whether to delegate graph operations to Neo4j."""
        return neo4j_store.is_connected

    # ------------------------------------------------------------------ #
    #  Build Graph from Database
    # ------------------------------------------------------------------ #

    def build_from_db(self, db_session) -> Dict[str, Any]:
        """
        Loads all entities and relationships from the SQLite database,
        syncs to Neo4j (if connected), constructs the graph, detects
        communities, and computes metrics.
        """
        import models

        # Always populate lookup maps from SQLite (used for name resolution)
        self.entity_lookup.clear()
        self.id_to_name.clear()
        self.name_to_id.clear()

        db_entities = db_session.query(models.Entity).all()
        for e in db_entities:
            self.id_to_name[e.id] = e.name
            self.name_to_id[e.name] = e.id
            self.entity_lookup[e.name] = {
                "id": e.id,
                "name": e.name,
                "type": e.type,
                "description": e.description or "",
                "document_id": e.document_id,
            }

        if self.use_neo4j:
            return self._build_neo4j(db_session)
        else:
            return self._build_networkx(db_session)

    def _build_neo4j(self, db_session) -> Dict[str, Any]:
        """Sync SQLite → Neo4j, run Louvain + centrality, build community summaries."""
        import models

        # 1. Sync all entities and relationships into Neo4j
        neo4j_store.sync_from_sqlite(db_session)

        # 2. Run Louvain community detection
        louvain_result = neo4j_store.run_louvain()
        self._last_modularity = louvain_result.get("modularity", 0.0)

        # 3. Compute centrality metrics
        neo4j_store.compute_centrality()

        # 4. Build community summary nodes
        metrics = self._build_community_summaries_neo4j(db_session)

        # 5. Also build the networkx fallback graph for any remaining callers
        self._sync_networkx_from_neo4j()

        return metrics

    def _build_networkx(self, db_session) -> Dict[str, Any]:
        """Original networkx-only path (fallback when Neo4j is unavailable)."""
        import models

        self.graph.clear()

        # Load entities
        db_entities = db_session.query(models.Entity).all()
        for e in db_entities:
            self.graph.add_node(
                e.id,
                name=e.name,
                type=e.type,
                description=e.description or "",
                document_id=e.document_id
            )

        # Load relationships
        db_relationships = db_session.query(models.Relationship).all()
        for r in db_relationships:
            if self.graph.has_node(r.source_entity_id) and self.graph.has_node(r.target_entity_id):
                weight = float(r.weight or 1.0)
                if self.graph.has_edge(r.source_entity_id, r.target_entity_id):
                    self.graph[r.source_entity_id][r.target_entity_id]["weight"] += weight
                else:
                    self.graph.add_edge(
                        r.source_entity_id,
                        r.target_entity_id,
                        description=r.description or "related to",
                        weight=weight,
                        rel_id=r.id
                    )

        # Detect communities and compute metrics
        metrics = self.detect_communities_and_metrics(db_session)
        return metrics

    def _sync_networkx_from_neo4j(self):
        """Pull the Neo4j graph into self.graph for callers that still use networkx."""
        try:
            export = neo4j_store.export_graph_json()
            self.graph.clear()
            for node in export.get("nodes", []):
                nid = node.get("id")
                if nid is not None:
                    self.graph.add_node(
                        nid,
                        name=node.get("name", ""),
                        type=node.get("type", "CONCEPT"),
                        description=node.get("description", ""),
                        document_id=node.get("document_id"),
                        degree_centrality=node.get("degree_centrality", 0.0),
                        betweenness_centrality=node.get("betweenness_centrality", 0.0),
                    )
            for link in export.get("links", []):
                src = link.get("source")
                tgt = link.get("target")
                if src is not None and tgt is not None and self.graph.has_node(src) and self.graph.has_node(tgt):
                    self.graph.add_edge(
                        src, tgt,
                        description=link.get("description", "related to"),
                        weight=link.get("weight", 1.0),
                        rel_id=link.get("rel_id"),
                    )
        except Exception as e:
            print(f"[GraphPipeline] networkx sync from Neo4j note: {e}")

    # ------------------------------------------------------------------ #
    #  Community Detection & Metrics
    # ------------------------------------------------------------------ #

    def detect_communities_and_metrics(self, db_session) -> Dict[str, Any]:
        """
        Runs Louvain community detection and returns graph metrics.
        Delegates to Neo4j when connected, falls back to networkx.
        """
        if self.use_neo4j:
            return self._detect_communities_neo4j(db_session)
        else:
            return self._detect_communities_networkx(db_session)

    def _detect_communities_neo4j(self, db_session) -> Dict[str, Any]:
        """Get metrics from Neo4j and build community summaries."""
        status = neo4j_store.get_graph_status()
        status["modularity"] = self._last_modularity
        return status

    def _detect_communities_networkx(self, db_session) -> Dict[str, Any]:
        """Original networkx community detection (unchanged from Phase 3)."""
        import models

        num_nodes = self.graph.number_of_nodes()
        num_edges = self.graph.number_of_edges()

        if num_nodes == 0:
            return {
                "total_entities": 0,
                "total_relationships": 0,
                "total_communities": 0,
                "modularity": 0.0,
                "density": 0.0,
                "connected_components": 0,
                "communities_by_level": {0: 0, 1: 0}
            }

        # Centrality metrics
        deg_centrality = nx.degree_centrality(self.graph)
        try:
            between_centrality = nx.betweenness_centrality(self.graph, weight="weight")
        except Exception:
            between_centrality = {n: 0.0 for n in self.graph.nodes()}

        for node_id in self.graph.nodes():
            self.graph.nodes[node_id]["degree_centrality"] = round(deg_centrality.get(node_id, 0.0), 4)
            self.graph.nodes[node_id]["betweenness_centrality"] = round(between_centrality.get(node_id, 0.0), 4)

        # Community Detection (Louvain)
        communities_l0 = []
        if num_edges > 0:
            try:
                raw_comms = louvain_communities(self.graph, weight="weight", seed=42)
                communities_l0 = [list(c) for c in raw_comms if len(c) > 0]
            except Exception as e:
                print(f"[GraphPipeline] Louvain fallback to connected components: {e}")
                communities_l0 = [list(c) for c in nx.connected_components(self.graph)]
        else:
            communities_l0 = [[n] for n in self.graph.nodes()]

        # Modularity calculation
        mod_score = 0.0
        if num_edges > 0 and len(communities_l0) > 1:
            try:
                mod_score = round(modularity(self.graph, communities_l0, weight="weight"), 4)
            except Exception:
                mod_score = 0.0

        # Create hierarchical Level 1 (Macro) communities
        communities_l1 = self._build_level_1_communities(communities_l0)

        # Clear existing communities in DB and generate Map summaries
        db_session.query(models.Community).delete()
        db_session.commit()

        created_communities = []
        # Level 0 (Micro/Sub-protocol communities)
        for idx, member_ids in enumerate(communities_l0):
            comm_obj = self._summarize_community(
                community_idx=idx,
                level=0,
                member_entity_ids=member_ids,
                db_session=db_session
            )
            created_communities.append(comm_obj)

        # Level 1 (Macro/Architectural communities)
        for idx, member_ids in enumerate(communities_l1):
            comm_obj = self._summarize_community(
                community_idx=idx,
                level=1,
                member_entity_ids=member_ids,
                db_session=db_session
            )
            created_communities.append(comm_obj)

        db_session.commit()
        self.communities_cache = [
            {
                "id": c.id,
                "level": c.level,
                "title": c.title,
                "summary": c.summary,
                "member_entity_ids": c.member_entity_ids,
                "member_count": len(c.member_entity_ids),
                "member_names": [self.id_to_name.get(m_id, f"Entity #{m_id}") for m_id in c.member_entity_ids]
            }
            for c in created_communities
        ]

        density = round(nx.density(self.graph), 4) if num_nodes > 1 else 0.0
        conn_comp = nx.number_connected_components(self.graph)

        return {
            "total_entities": num_nodes,
            "total_relationships": num_edges,
            "total_communities": len(created_communities),
            "modularity": mod_score,
            "density": density,
            "connected_components": conn_comp,
            "communities_by_level": {
                0: len(communities_l0),
                1: len(communities_l1)
            }
        }

    # ------------------------------------------------------------------ #
    #  Neo4j Community Summaries
    # ------------------------------------------------------------------ #

    def _build_community_summaries_neo4j(self, db_session) -> Dict[str, Any]:
        """
        After Louvain runs in Neo4j, retrieve community assignments,
        generate Map summaries, and save them as Community nodes in both
        SQLite and Neo4j.
        """
        import models

        # Clear old communities
        db_session.query(models.Community).delete()
        db_session.commit()
        neo4j_store.clear_communities()

        # Get distinct community IDs from Neo4j entity nodes
        community_groups = self._get_neo4j_community_groups()

        if not community_groups:
            return neo4j_store.get_graph_status()

        # Build Level 0 communities
        communities_l0 = []
        for comm_id, entity_ids in community_groups.items():
            communities_l0.append(entity_ids)

        # Build Level 1 (Macro) communities using the same logic as networkx path
        communities_l1 = self._build_level_1_communities_from_ids(communities_l0)

        created_communities = []

        # Level 0
        for idx, member_ids in enumerate(communities_l0):
            comm_obj = self._summarize_community(
                community_idx=idx,
                level=0,
                member_entity_ids=member_ids,
                db_session=db_session,
            )
            created_communities.append(comm_obj)
            # Also save in Neo4j
            neo4j_store.save_community_node(
                community_idx=idx,
                level=0,
                title=comm_obj.title,
                summary=comm_obj.summary,
                member_entity_ids=member_ids,
            )

        # Level 1
        for idx, member_ids in enumerate(communities_l1):
            comm_obj = self._summarize_community(
                community_idx=idx,
                level=1,
                member_entity_ids=member_ids,
                db_session=db_session,
            )
            created_communities.append(comm_obj)
            neo4j_store.save_community_node(
                community_idx=idx,
                level=1,
                title=comm_obj.title,
                summary=comm_obj.summary,
                member_entity_ids=member_ids,
            )

        db_session.commit()

        self.communities_cache = [
            {
                "id": c.id,
                "level": c.level,
                "title": c.title,
                "summary": c.summary,
                "member_entity_ids": c.member_entity_ids,
                "member_count": len(c.member_entity_ids),
                "member_names": [self.id_to_name.get(m_id, f"Entity #{m_id}") for m_id in c.member_entity_ids],
            }
            for c in created_communities
        ]

        status = neo4j_store.get_graph_status()
        status["modularity"] = self._last_modularity
        status["total_communities"] = len(created_communities)
        status["communities_by_level"] = {
            0: len(communities_l0),
            1: len(communities_l1),
        }
        return status

    def _get_neo4j_community_groups(self) -> Dict[int, List[int]]:
        """
        Query Neo4j for entities grouped by their Louvain community_id.
        Returns { community_id: [entity_id, ...] }.
        """
        if not neo4j_store.is_connected:
            return {}
        try:
            from neo4j import GraphDatabase
            groups: Dict[int, List[int]] = {}
            with neo4j_store._driver.session() as session:
                result = session.run(
                    """
                    MATCH (e:Entity)
                    WHERE e.community_id IS NOT NULL AND e.entity_id IS NOT NULL
                    RETURN e.community_id AS comm_id, collect(e.entity_id) AS entity_ids
                    ORDER BY comm_id
                    """
                )
                for record in result:
                    groups[record["comm_id"]] = record["entity_ids"]
            return groups
        except Exception as e:
            print(f"[GraphPipeline] _get_neo4j_community_groups error: {e}")
            return {}

    def _build_level_1_communities_from_ids(self, l0_communities: List[List[int]]) -> List[List[int]]:
        """
        Builds Level 1 macro communities from Level 0 using cross-community
        edge density — works with both Neo4j and networkx.
        """
        if len(l0_communities) <= 2:
            return [list(set([n for c in l0_communities for n in c]))]

        if self.use_neo4j:
            # Use the in-memory networkx mirror for cross-edge counting
            self._sync_networkx_from_neo4j()

        return self._build_level_1_communities(l0_communities)

    # ------------------------------------------------------------------ #
    #  Level 1 Community Builder (shared logic)
    # ------------------------------------------------------------------ #

    def _build_level_1_communities(self, l0_communities: List[List[int]]) -> List[List[int]]:
        """
        Aggregates Level 0 communities into macro-level clusters (Level 1)
        based on cross-community edge density and domain semantics.
        """
        if len(l0_communities) <= 2:
            return [list(set([n for c in l0_communities for n in c]))]

        # Construct meta-graph where each node is a Level 0 community
        meta_g = nx.Graph()
        for i in range(len(l0_communities)):
            meta_g.add_node(i)

        for i, c_i in enumerate(l0_communities):
            set_i = set(c_i)
            for j, c_j in enumerate(l0_communities):
                if i >= j:
                    continue
                # Count cross edges
                cross_weight = 0.0
                for u in set_i:
                    for v in c_j:
                        if self.graph.has_edge(u, v):
                            cross_weight += self.graph[u][v].get("weight", 1.0)
                if cross_weight > 0:
                    meta_g.add_edge(i, j, weight=cross_weight)

        if meta_g.number_of_edges() > 0:
            try:
                macro_comms = louvain_communities(meta_g, weight="weight", seed=42)
                l1 = []
                for macro_c in macro_comms:
                    members = []
                    for l0_idx in macro_c:
                        members.extend(l0_communities[l0_idx])
                    l1.append(list(set(members)))
                return l1
            except Exception:
                pass

        # Default split into two macro halves
        mid = len(l0_communities) // 2
        macro_a = [n for c in l0_communities[:mid] for n in c]
        macro_b = [n for c in l0_communities[mid:] for n in c]
        return [macro_a, macro_b]

    # ------------------------------------------------------------------ #
    #  Community Summarization (Map Phase)
    # ------------------------------------------------------------------ #

    def _summarize_community(
        self,
        community_idx: int,
        level: int,
        member_entity_ids: List[int],
        db_session
    ):
        """
        Map Phase: Generates a high-level, technical summary of a community
        using member entities and interconnecting edges.
        """
        import models

        member_entities = []
        for e_id in member_entity_ids:
            if self.graph.has_node(e_id):
                n_data = self.graph.nodes[e_id]
                member_entities.append(f"- {n_data.get('name')} ({n_data.get('type')}): {n_data.get('description', '')}")

        # Subgraph edges
        subgraph = self.graph.subgraph(member_entity_ids)
        internal_edges = []
        for u, v, data in subgraph.edges(data=True):
            u_name = self.id_to_name.get(u, str(u))
            v_name = self.id_to_name.get(v, str(v))
            desc = data.get("description", "connected to")
            internal_edges.append(f"- {u_name} -> {desc} -> {v_name} (weight: {data.get('weight', 1.0)})")

        members_text = "\n".join(member_entities[:15])
        edges_text = "\n".join(internal_edges[:15]) if internal_edges else "No internal interconnections."

        # Title and summary. Optional model-written version (ENABLE_LLM_COMMUNITY_SUMMARY=true), otherwise
        # a summary built from the community's own entities and relationships, so it works for any subject.
        ent_names = [self.id_to_name.get(e_id, "") for e_id in member_entity_ids if self.id_to_name.get(e_id)]
        # Most connected entities first: they describe the community best
        ent_names.sort(key=lambda n: -self.graph.degree(self.name_to_id[n]) if n in self.name_to_id and self.graph.has_node(self.name_to_id[n]) else 0)
        title = (" & ".join(ent_names[:3]) if ent_names else f"Community {community_idx + 1}") or f"Community {community_idx + 1}"
        summary = ""

        use_llm_summary = os.getenv("ENABLE_LLM_COMMUNITY_SUMMARY", "false").lower() == "true"
        if use_llm_summary and len(member_entity_ids) > 1:
            try:
                from generator import generator
                prompt = (
                    f"Entities in one group of a knowledge graph:\n{members_text}\n\n"
                    f"Relationships between them:\n{edges_text}\n\n"
                    "Write a JSON object with two fields:\n"
                    '"title": 3 to 8 words naming what this group is about.\n'
                    '"summary": 2 or 3 sentences explaining how these entities relate. Use only the information above.\n'
                    "Return valid JSON only."
                )
                out = generator.complete(prompt, "You summarise groups of a knowledge graph for any subject. Be factual and brief.", 0.2)
                if out:
                    raw = re.sub(r"^```(?:json)?|```$", "", out["text"].strip(), flags=re.MULTILINE).strip()
                    parsed = json.loads(raw)
                    title = parsed.get("title") or title
                    summary = parsed.get("summary") or ""
            except Exception as e:
                print(f"[GraphPipeline] LLM community summary note: {e}")

        if not summary:
            lead = ", ".join(ent_names[:5])
            more = f" and {len(ent_names) - 5} more" if len(ent_names) > 5 else ""
            facts = []
            strongest = sorted(subgraph.edges(data=True), key=lambda e: -float(e[2].get("weight", 1.0)))[:4]
            for u, v, data in strongest:
                facts.append(f"{self.id_to_name.get(u, u)} {data.get('description', 'is related to')} {self.id_to_name.get(v, v)}")
            summary = f"This group contains {lead}{more}."
            if facts:
                summary += " Key links: " + "; ".join(facts) + "."

        comm_record = models.Community(
            level=level,
            title=title,
            summary=summary,
            member_entity_ids=member_entity_ids
        )
        db_session.add(comm_record)
        return comm_record

    # ------------------------------------------------------------------ #
    #  Global Query Execution (Reduce Phase)
    # ------------------------------------------------------------------ #

    def execute_global_query(
        self,
        query: str,
        db_session,
        target_level: int = 0,
        top_communities: int = 3
    ) -> Dict[str, Any]:
        """
        Reduce Phase: Global Graph-RAG Query Engine.
        Synthesizes an overarching answer to a thematic question across community summaries,
        citing communities and entities with exact brackets.
        """
        import models

        start_time = time.time()

        if not self.id_to_name:
            ents = db_session.query(models.Entity).all()
            for e in ents:
                self.id_to_name[e.id] = e.name
                self.name_to_id[e.name] = e.id

        # Retrieve communities — try Neo4j first, fall back to SQLite
        comms = None
        if self.use_neo4j:
            neo4j_comms = neo4j_store.get_communities(level=target_level)
            if not neo4j_comms:
                neo4j_comms = neo4j_store.get_communities()
            if neo4j_comms:
                # Wrap into objects with attribute access for uniform processing
                comms = self._neo4j_comms_to_objects(neo4j_comms)

        # Fallback to SQLite
        if not comms:
            comms = db_session.query(models.Community).filter(models.Community.level == target_level).all()
            if not comms:
                comms = db_session.query(models.Community).all()

        if not comms:
            return {
                "query": query,
                "route": "graph",
                "answer": "No knowledge graph communities have been generated yet. Please run /graph/build first.",
                "community_citations": [],
                "entity_citations": [],
                "latency_ms": 0.0,
                "tokens_used": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "tokens_exact": True,
                "model": "rule-based"
            }

        # Score communities by overlap between the question and the community's entities, title and summary
        def _stem(w: str) -> str:
            return w[:-1] if len(w) > 3 and w.endswith("s") else w

        stop = {"the", "and", "for", "are", "what", "how", "does", "did", "who", "which", "with", "that", "this",
                "from", "into", "about", "main", "overall", "between", "their", "them", "have", "has", "was", "were"}
        q_tokens = {_stem(t) for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2 and t not in stop}

        scored_comms = []
        for c in comms:
            c_title = c.title if hasattr(c, 'title') else c.get('title', '')
            c_summary = c.summary if hasattr(c, 'summary') else c.get('summary', '')
            c_member_ids = c.member_entity_ids if hasattr(c, 'member_entity_ids') else c.get('member_entity_ids', [])
            member_names = [self.id_to_name.get(m_id, "") for m_id in (c_member_ids or [])]

            name_tokens = {_stem(t) for n in member_names for t in re.findall(r"[a-z0-9]+", n.lower())}
            text_tokens = {_stem(t) for t in re.findall(r"[a-z0-9]+", f"{c_title} {c_summary}".lower())}

            # An entity name in the question counts double: it is the strongest sign of relevance
            score = 2.0 * len(q_tokens & name_tokens) + 1.0 * len(q_tokens & (text_tokens - name_tokens))
            # Tie-break toward bigger communities, which matters for broad "overview" questions with no keyword overlap
            score += min(len(c_member_ids or []), 50) / 1000.0

            scored_comms.append((score, c))

        # Sort by relevance
        scored_comms.sort(key=lambda x: x[0], reverse=True)
        selected = [c for _, c in scored_comms[:top_communities]]

        # Prepare context blocks
        context_blocks = []
        community_citations = []
        all_cited_entities = []

        for c in selected:
            c_id = c.id if hasattr(c, 'id') else c.get('id', 0)
            c_title = c.title if hasattr(c, 'title') else c.get('title', '')
            c_level = c.level if hasattr(c, 'level') else c.get('level', 0)
            c_summary = c.summary if hasattr(c, 'summary') else c.get('summary', '')
            c_member_ids = c.member_entity_ids if hasattr(c, 'member_entity_ids') else c.get('member_entity_ids', [])

            member_names = [self.id_to_name.get(m_id, "") for m_id in (c_member_ids or []) if self.id_to_name.get(m_id)]
            block = (
                f"[Community #{c_id}: {c_title} (Level {c_level})]\n"
                f"Member Entities: {', '.join(member_names)}\n"
                f"Summary: {c_summary}\n"
            )
            context_blocks.append(block)
            community_citations.append({
                "community_id": c_id,
                "level": c_level,
                "title": c_title,
                "summary": c_summary,
                "member_count": len(c_member_ids or []),
                "member_names": member_names
            })
            all_cited_entities.extend(member_names)

        context_str = "\n\n---\n\n".join(context_blocks)

        system_instruction = (
            "You are AdaptiRAG's Global Knowledge Graph Synthesis Engine.\n"
            "Your task is to answer broad, thematic, comparative, or high-level questions across the knowledge graph.\n"
            "Rules:\n"
            "1. Synthesize insights across the provided community summaries into a coherent, structured, technical analysis.\n"
            "2. Whenever citing evidence from a community summary, use the notation [Community: <title>] or [Community #<id>].\n"
            "3. Whenever referencing specific entities, cite them as [Entity: <entity_name>].\n"
            "4. Contrast trade-offs, assumptions, and failure modes explicitly."
        )

        prompt = (
            f"Knowledge Graph Community Context:\n\n{context_str}\n\n"
            f"User Global Question: {query}\n\n"
            "Synthesized Global Answer (with [Community: <title>] and [Entity: <name>] citations):"
        )

        from generator import generator, estimate_tokens

        answer = ""
        model_name = ""
        in_tok = out_tok = 0
        exact = True

        out = generator.complete(prompt, system_instruction)
        if out:
            answer = out["text"]
            model_name = out["model"]
            in_tok, out_tok, exact = out["input_tokens"], out["output_tokens"], out["tokens_exact"]

        if not answer:
            # No language model available: show the real community summaries instead of inventing an answer
            lead_ents = ", ".join(all_cited_entities[:6])
            blocks = [f"[Community: {c['title']}]\n{c['summary']}" for c in community_citations]
            answer = (
                "No language model is available, so this is a direct view of the most relevant knowledge-graph "
                "communities.\n\n" + "\n\n".join(blocks)
                + (f"\n\nKey entities: {lead_ents}" if lead_ents else "")
            )
            model_name = "extractive-graph-fallback"
            in_tok, out_tok, exact = 0, estimate_tokens(answer), False

        parsed_entity_citations = re.findall(r'\[Entity:\s*([^\]]+)\]', answer)
        final_entities = list(dict.fromkeys(parsed_entity_citations + all_cited_entities))

        elapsed_ms = round((time.time() - start_time) * 1000.0, 2)
        return {
            "query": query,
            "route": "graph",
            "answer": answer,
            "community_citations": community_citations,
            "entity_citations": final_entities[:10],
            "latency_ms": elapsed_ms,
            "tokens_used": in_tok + out_tok,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "tokens_exact": exact,
            "model": model_name
        }

    # ------------------------------------------------------------------ #
    #  Graph Export (D3 / Visualization)
    # ------------------------------------------------------------------ #

    def export_graph_json(self) -> Dict[str, Any]:
        """Exports graph nodes and edges in D3 / visualizer JSON format."""
        if self.use_neo4j:
            return neo4j_store.export_graph_json()

        # Fallback to networkx
        nodes = []
        for n_id, data in self.graph.nodes(data=True):
            nodes.append({
                "id": n_id,
                "name": data.get("name", f"Node-{n_id}"),
                "type": data.get("type", "CONCEPT"),
                "description": data.get("description", ""),
                "degree_centrality": data.get("degree_centrality", 0.0),
                "betweenness_centrality": data.get("betweenness_centrality", 0.0),
                "document_id": data.get("document_id")
            })

        links = []
        for u, v, data in self.graph.edges(data=True):
            links.append({
                "source": u,
                "target": v,
                "description": data.get("description", "related to"),
                "weight": data.get("weight", 1.0),
                "rel_id": data.get("rel_id")
            })

        return {
            "nodes": nodes,
            "links": links
        }

    # ------------------------------------------------------------------ #
    #  Helpers
    # ------------------------------------------------------------------ #

    def _neo4j_comms_to_objects(self, neo4j_comms: List[Dict]) -> List[Any]:
        """Convert Neo4j community dicts to simple namespace objects for uniform access."""

        class CommObj:
            def __init__(self, d):
                self.id = d.get("id", 0)
                self.level = d.get("level", 0)
                self.title = d.get("title", "")
                self.summary = d.get("summary", "")
                self.member_entity_ids = d.get("member_entity_ids", [])

        return [CommObj(c) for c in neo4j_comms]


graph_pipeline = GraphPipeline()