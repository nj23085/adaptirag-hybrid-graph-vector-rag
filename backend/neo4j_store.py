"""
AdaptiRAG Neo4j Graph Store
Manages the Knowledge Graph in Neo4j with entity/relationship CRUD,
GDS-based community detection (Louvain), centrality computation,
and D3-compatible graph export.

Falls back gracefully when Neo4j is unavailable — callers should check
`neo4j_store.is_connected` before invoking graph operations.
"""
import os
import time
from typing import List, Dict, Any, Optional, Tuple
from dotenv import load_dotenv

load_dotenv()


class Neo4jStore:
    """Singleton wrapper around the Neo4j Python driver."""

    def __init__(self):
        self.uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self.user = os.getenv("NEO4J_USER", "neo4j")
        self.password = os.getenv("NEO4J_PASSWORD", "adaptirag123")

        self._driver = None
        self.is_connected = False
        self.has_gds = False  # True if Graph Data Science library is installed

        self._connect()

    # ------------------------------------------------------------------ #
    #  Connection Management
    # ------------------------------------------------------------------ #

    def _connect(self):
        """Attempt to connect to Neo4j. Non-fatal on failure."""
        try:
            from neo4j import GraphDatabase
            self._driver = GraphDatabase.driver(
                self.uri, auth=(self.user, self.password)
            )
            # Verify connectivity
            self._driver.verify_connectivity()
            self.is_connected = True
            print(f"[Neo4jStore] Connected to {self.uri}")
            self._check_gds()
            self._ensure_indexes()
        except Exception as e:
            self.is_connected = False
            print(f"[Neo4jStore] Neo4j unavailable ({e}). Falling back to networkx.")

    def _check_gds(self):
        """Detect whether the Graph Data Science (GDS) library is installed."""
        try:
            with self._driver.session() as session:
                result = session.run("RETURN gds.version() AS version")
                record = result.single()
                if record:
                    self.has_gds = True
                    print(f"[Neo4jStore] GDS library detected: v{record['version']}")
        except Exception:
            self.has_gds = False
            print("[Neo4jStore] GDS library not found. Community detection will use networkx fallback.")

    def _ensure_indexes(self):
        """Create indexes and constraints for optimal Cypher performance."""
        try:
            with self._driver.session() as session:
                # Unique constraint on Entity name
                session.run(
                    "CREATE CONSTRAINT entity_name_unique IF NOT EXISTS "
                    "FOR (e:Entity) REQUIRE e.name IS UNIQUE"
                )
                # Index on Entity type
                session.run(
                    "CREATE INDEX entity_type_index IF NOT EXISTS "
                    "FOR (e:Entity) ON (e.type)"
                )
                # Index on Community level
                session.run(
                    "CREATE INDEX community_level_index IF NOT EXISTS "
                    "FOR (c:Community) ON (c.level)"
                )
                print("[Neo4jStore] Indexes and constraints verified.")
        except Exception as e:
            print(f"[Neo4jStore] Index creation note: {e}")

    def close(self):
        """Cleanly close the Neo4j driver connection."""
        if self._driver:
            self._driver.close()
            self.is_connected = False
            print("[Neo4jStore] Connection closed.")

    def health_check(self) -> Dict[str, Any]:
        """Return Neo4j connection status and server info."""
        if not self.is_connected or not self._driver:
            return {"connected": False, "uri": self.uri, "gds_available": False}
        try:
            with self._driver.session() as session:
                result = session.run(
                    "CALL dbms.components() YIELD name, versions "
                    "RETURN name, versions[0] AS version"
                )
                record = result.single()
                return {
                    "connected": True,
                    "uri": self.uri,
                    "server": record["name"] if record else "unknown",
                    "version": record["version"] if record else "unknown",
                    "gds_available": self.has_gds,
                }
        except Exception as e:
            return {"connected": False, "uri": self.uri, "error": str(e), "gds_available": False}

    # ------------------------------------------------------------------ #
    #  Entity CRUD
    # ------------------------------------------------------------------ #

    def merge_entity(
        self,
        name: str,
        entity_type: str = "CONCEPT",
        description: str = "",
        document_id: Optional[int] = None,
        entity_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        MERGE an entity node — creates if new, updates description if longer.
        Returns the entity dict or None on failure.
        """
        if not self.is_connected:
            return None
        try:
            with self._driver.session() as session:
                result = session.run(
                    """
                    MERGE (e:Entity {name: $name})
                    ON CREATE SET
                        e.type = $type,
                        e.description = $description,
                        e.document_id = $document_id,
                        e.entity_id = $entity_id,
                        e.created_at = datetime()
                    ON MATCH SET
                        e.description = CASE
                            WHEN size(coalesce(e.description, '')) < size($description)
                            THEN $description
                            ELSE e.description
                        END,
                        e.type = CASE WHEN e.type = 'CONCEPT' THEN $type ELSE e.type END
                    RETURN e.name AS name, e.type AS type, e.description AS description,
                           e.document_id AS document_id, e.entity_id AS entity_id,
                           elementId(e) AS element_id
                    """,
                    name=name,
                    type=entity_type,
                    description=description,
                    document_id=document_id,
                    entity_id=entity_id,
                )
                record = result.single()
                if record:
                    return dict(record)
                return None
        except Exception as e:
            print(f"[Neo4jStore] merge_entity error: {e}")
            return None

    def get_entities(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Retrieve entities with centrality metrics."""
        if not self.is_connected:
            return []
        try:
            with self._driver.session() as session:
                result = session.run(
                    """
                    MATCH (e:Entity)
                    OPTIONAL MATCH (e)-[r]-()
                    WITH e, count(r) AS degree
                    RETURN e.entity_id AS id, e.name AS name, e.type AS type,
                           e.description AS description, e.document_id AS document_id,
                           coalesce(e.degree_centrality, 0.0) AS degree_centrality,
                           coalesce(e.betweenness_centrality, 0.0) AS betweenness_centrality
                    ORDER BY degree DESC
                    LIMIT $limit
                    """,
                    limit=limit,
                )
                return [dict(r) for r in result]
        except Exception as e:
            print(f"[Neo4jStore] get_entities error: {e}")
            return []

    def get_entity_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Look up a single entity by canonical name."""
        if not self.is_connected:
            return None
        try:
            with self._driver.session() as session:
                result = session.run(
                    "MATCH (e:Entity {name: $name}) "
                    "RETURN e.entity_id AS id, e.name AS name, e.type AS type, "
                    "e.description AS description, e.document_id AS document_id",
                    name=name,
                )
                record = result.single()
                return dict(record) if record else None
        except Exception as e:
            print(f"[Neo4jStore] get_entity_by_name error: {e}")
            return None

    # ------------------------------------------------------------------ #
    #  Relationship CRUD
    # ------------------------------------------------------------------ #

    def merge_relationship(
        self,
        source_name: str,
        target_name: str,
        description: str = "related to",
        weight: float = 1.0,
        document_id: Optional[int] = None,
        rel_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        MERGE a RELATES_TO edge between two Entity nodes (by name).
        If the edge already exists, the weight is accumulated.
        """
        if not self.is_connected:
            return None
        try:
            with self._driver.session() as session:
                result = session.run(
                    """
                    MATCH (src:Entity {name: $source}), (tgt:Entity {name: $target})
                    MERGE (src)-[r:RELATES_TO]->(tgt)
                    ON CREATE SET
                        r.description = $description,
                        r.weight = $weight,
                        r.document_id = $document_id,
                        r.rel_id = $rel_id,
                        r.created_at = datetime()
                    ON MATCH SET
                        r.weight = r.weight + $weight
                    RETURN src.name AS source_name, tgt.name AS target_name,
                           r.description AS description, r.weight AS weight,
                           r.rel_id AS rel_id
                    """,
                    source=source_name,
                    target=target_name,
                    description=description,
                    weight=weight,
                    document_id=document_id,
                    rel_id=rel_id,
                )
                record = result.single()
                return dict(record) if record else None
        except Exception as e:
            print(f"[Neo4jStore] merge_relationship error: {e}")
            return None

    def get_relationships(self, limit: int = 150) -> List[Dict[str, Any]]:
        """Retrieve relationships with source/target names."""
        if not self.is_connected:
            return []
        try:
            with self._driver.session() as session:
                result = session.run(
                    """
                    MATCH (src:Entity)-[r:RELATES_TO]->(tgt:Entity)
                    RETURN r.rel_id AS id,
                           src.entity_id AS source_entity_id, src.name AS source_name,
                           tgt.entity_id AS target_entity_id, tgt.name AS target_name,
                           r.description AS description, r.weight AS weight,
                           r.document_id AS document_id
                    LIMIT $limit
                    """,
                    limit=limit,
                )
                return [dict(r) for r in result]
        except Exception as e:
            print(f"[Neo4jStore] get_relationships error: {e}")
            return []

    # ------------------------------------------------------------------ #
    #  Bulk Sync (SQLite → Neo4j)
    # ------------------------------------------------------------------ #

    def sync_from_sqlite(self, db_session) -> Dict[str, int]:
        """
        Loads all entities and relationships from the SQLite database
        and merges them into Neo4j. Idempotent — safe to run on every startup.
        """
        if not self.is_connected:
            return {"entities_synced": 0, "relationships_synced": 0}

        import models

        entities = db_session.query(models.Entity).all()
        relationships = db_session.query(models.Relationship).all()

        # Build id → name map for relationship resolution
        id_to_name = {e.id: e.name for e in entities}

        ent_count = 0
        for e in entities:
            result = self.merge_entity(
                name=e.name,
                entity_type=e.type or "CONCEPT",
                description=e.description or "",
                document_id=e.document_id,
                entity_id=e.id,
            )
            if result:
                ent_count += 1

        rel_count = 0
        for r in relationships:
            src_name = id_to_name.get(r.source_entity_id)
            tgt_name = id_to_name.get(r.target_entity_id)
            if src_name and tgt_name:
                result = self.merge_relationship(
                    source_name=src_name,
                    target_name=tgt_name,
                    description=r.description or "related to",
                    weight=float(r.weight or 1.0),
                    document_id=r.document_id,
                    rel_id=r.id,
                )
                if result:
                    rel_count += 1

        print(f"[Neo4jStore] Synced {ent_count} entities, {rel_count} relationships from SQLite.")
        return {"entities_synced": ent_count, "relationships_synced": rel_count}

    # ------------------------------------------------------------------ #
    #  Community Detection (GDS Louvain)
    # ------------------------------------------------------------------ #

    def run_louvain(self) -> Dict[str, Any]:
        """
        Runs Louvain community detection using the GDS library.
        Writes community IDs back onto Entity nodes as `community_id` property.
        Returns community metrics.
        """
        if not self.is_connected:
            return {"communities": 0, "modularity": 0.0, "method": "unavailable"}

        if not self.has_gds:
            return self._louvain_fallback()

        try:
            with self._driver.session() as session:
                # Drop existing graph projection if it exists
                try:
                    session.run("CALL gds.graph.drop('adaptirag_graph', false)")
                except Exception:
                    pass

                # Create graph projection
                session.run(
                    """
                    CALL gds.graph.project(
                        'adaptirag_graph',
                        'Entity',
                        {
                            RELATES_TO: {
                                orientation: 'UNDIRECTED',
                                properties: ['weight']
                            }
                        }
                    )
                    """
                )

                # Run Louvain and write community IDs
                result = session.run(
                    """
                    CALL gds.louvain.write('adaptirag_graph', {
                        writeProperty: 'community_id',
                        relationshipWeightProperty: 'weight'
                    })
                    YIELD communityCount, modularity, nodePropertiesWritten
                    RETURN communityCount, modularity, nodePropertiesWritten
                    """
                )
                record = result.single()

                community_count = record["communityCount"] if record else 0
                mod_score = round(record["modularity"], 4) if record else 0.0

                # Clean up projection
                try:
                    session.run("CALL gds.graph.drop('adaptirag_graph', false)")
                except Exception:
                    pass

                print(f"[Neo4jStore] Louvain detected {community_count} communities (modularity={mod_score})")

                return {
                    "communities": community_count,
                    "modularity": mod_score,
                    "method": "gds_louvain",
                }
        except Exception as e:
            print(f"[Neo4jStore] GDS Louvain error: {e}. Trying fallback.")
            return self._louvain_fallback()

    def _louvain_fallback(self) -> Dict[str, Any]:
        """
        Fallback: pull graph from Neo4j into networkx, run Louvain there,
        then write community IDs back to Neo4j.
        """
        try:
            import networkx as nx
            from networkx.algorithms.community import louvain_communities, modularity as nx_modularity

            G = self._to_networkx()
            if G.number_of_nodes() == 0:
                return {"communities": 0, "modularity": 0.0, "method": "fallback_empty"}

            if G.number_of_edges() > 0:
                raw_comms = louvain_communities(G, weight="weight", seed=42)
                comms = [list(c) for c in raw_comms if len(c) > 0]
                mod_score = round(nx_modularity(G, comms, weight="weight"), 4) if len(comms) > 1 else 0.0
            else:
                comms = [[n] for n in G.nodes()]
                mod_score = 0.0

            # Write community IDs back to Neo4j
            with self._driver.session() as session:
                for comm_idx, members in enumerate(comms):
                    for node_name in members:
                        session.run(
                            "MATCH (e:Entity {name: $name}) SET e.community_id = $comm_id",
                            name=node_name,
                            comm_id=comm_idx,
                        )

            print(f"[Neo4jStore] Fallback Louvain: {len(comms)} communities (modularity={mod_score})")
            return {
                "communities": len(comms),
                "modularity": mod_score,
                "method": "networkx_fallback",
            }
        except Exception as e:
            print(f"[Neo4jStore] Louvain fallback error: {e}")
            return {"communities": 0, "modularity": 0.0, "method": "error"}

    # ------------------------------------------------------------------ #
    #  Centrality Computation
    # ------------------------------------------------------------------ #

    def compute_centrality(self) -> bool:
        """
        Computes degree and betweenness centrality and writes them to Entity nodes.
        Uses GDS if available, otherwise Cypher-based approximation.
        Returns True on success.
        """
        if not self.is_connected:
            return False

        if self.has_gds:
            return self._centrality_gds()
        else:
            return self._centrality_cypher()

    def _centrality_gds(self) -> bool:
        """GDS-powered centrality — degree + betweenness."""
        try:
            with self._driver.session() as session:
                # Drop existing projection
                try:
                    session.run("CALL gds.graph.drop('adaptirag_centrality', false)")
                except Exception:
                    pass

                session.run(
                    """
                    CALL gds.graph.project(
                        'adaptirag_centrality',
                        'Entity',
                        {
                            RELATES_TO: {
                                orientation: 'UNDIRECTED',
                                properties: ['weight']
                            }
                        }
                    )
                    """
                )

                # Degree centrality
                session.run(
                    """
                    CALL gds.degree.write('adaptirag_centrality', {
                        writeProperty: 'degree_centrality',
                        relationshipWeightProperty: 'weight'
                    })
                    """
                )

                # Betweenness centrality
                session.run(
                    """
                    CALL gds.betweenness.write('adaptirag_centrality', {
                        writeProperty: 'betweenness_centrality'
                    })
                    """
                )

                # Clean up
                try:
                    session.run("CALL gds.graph.drop('adaptirag_centrality', false)")
                except Exception:
                    pass

                print("[Neo4jStore] GDS centrality computed (degree + betweenness).")
                return True
        except Exception as e:
            print(f"[Neo4jStore] GDS centrality error: {e}. Trying Cypher fallback.")
            return self._centrality_cypher()

    def _centrality_cypher(self) -> bool:
        """Cypher-based degree centrality (betweenness approximated as 0)."""
        try:
            with self._driver.session() as session:
                # Count total nodes for normalization
                count_result = session.run("MATCH (e:Entity) RETURN count(e) AS total")
                total = count_result.single()["total"]
                if total <= 1:
                    return True

                # Degree centrality = (number of relationships) / (total nodes - 1)
                session.run(
                    """
                    MATCH (e:Entity)
                    OPTIONAL MATCH (e)-[r]-()
                    WITH e, count(r) AS degree, $total AS total
                    SET e.degree_centrality = toFloat(degree) / toFloat(total - 1),
                        e.betweenness_centrality = 0.0
                    """,
                    total=total,
                )
                print("[Neo4jStore] Cypher degree centrality computed.")
                return True
        except Exception as e:
            print(f"[Neo4jStore] Cypher centrality error: {e}")
            return False

    # ------------------------------------------------------------------ #
    #  Community Queries
    # ------------------------------------------------------------------ #

    def get_communities(self, level: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Retrieve community summaries stored as Community nodes.
        These are created by the graph_pipeline after Louvain runs.
        """
        if not self.is_connected:
            return []
        try:
            with self._driver.session() as session:
                if level is not None:
                    result = session.run(
                        """
                        MATCH (c:Community {level: $level})
                        OPTIONAL MATCH (c)-[:CONTAINS]->(e:Entity)
                        WITH c, collect(e.name) AS member_names, collect(e.entity_id) AS member_ids
                        RETURN c.community_idx AS id, c.level AS level, c.title AS title,
                               c.summary AS summary, member_ids AS member_entity_ids,
                               size(member_names) AS member_count, member_names
                        """,
                        level=level,
                    )
                else:
                    result = session.run(
                        """
                        MATCH (c:Community)
                        OPTIONAL MATCH (c)-[:CONTAINS]->(e:Entity)
                        WITH c, collect(e.name) AS member_names, collect(e.entity_id) AS member_ids
                        RETURN c.community_idx AS id, c.level AS level, c.title AS title,
                               c.summary AS summary, member_ids AS member_entity_ids,
                               size(member_names) AS member_count, member_names
                        """
                    )
                return [dict(r) for r in result]
        except Exception as e:
            print(f"[Neo4jStore] get_communities error: {e}")
            return []

    def get_community_entities(self, community_id: int) -> List[Dict[str, Any]]:
        """Get all entities belonging to a specific Louvain community cluster."""
        if not self.is_connected:
            return []
        try:
            with self._driver.session() as session:
                result = session.run(
                    """
                    MATCH (e:Entity {community_id: $comm_id})
                    RETURN e.entity_id AS id, e.name AS name, e.type AS type,
                           e.description AS description, e.document_id AS document_id
                    """,
                    comm_id=community_id,
                )
                return [dict(r) for r in result]
        except Exception as e:
            print(f"[Neo4jStore] get_community_entities error: {e}")
            return []

    def save_community_node(
        self,
        community_idx: int,
        level: int,
        title: str,
        summary: str,
        member_entity_ids: List[int],
    ) -> bool:
        """
        Persist a Community summary node and link it to its member Entity nodes
        via :CONTAINS edges.
        """
        if not self.is_connected:
            return False
        try:
            with self._driver.session() as session:
                # Create or replace community node
                session.run(
                    """
                    MERGE (c:Community {community_idx: $idx, level: $level})
                    SET c.title = $title, c.summary = $summary, c.updated_at = datetime()
                    """,
                    idx=community_idx,
                    level=level,
                    title=title,
                    summary=summary,
                )
                # Link to member entities
                for eid in member_entity_ids:
                    session.run(
                        """
                        MATCH (c:Community {community_idx: $idx, level: $level})
                        MATCH (e:Entity {entity_id: $eid})
                        MERGE (c)-[:CONTAINS]->(e)
                        """,
                        idx=community_idx,
                        level=level,
                        eid=eid,
                    )
                return True
        except Exception as e:
            print(f"[Neo4jStore] save_community_node error: {e}")
            return False

    def clear_communities(self):
        """Remove all Community nodes and their edges."""
        if not self.is_connected:
            return
        try:
            with self._driver.session() as session:
                session.run("MATCH (c:Community) DETACH DELETE c")
                # Also clear community_id from entities
                session.run("MATCH (e:Entity) REMOVE e.community_id")
        except Exception as e:
            print(f"[Neo4jStore] clear_communities error: {e}")

    # ------------------------------------------------------------------ #
    #  Graph Metrics
    # ------------------------------------------------------------------ #

    def get_graph_status(self) -> Dict[str, Any]:
        """Return topological metrics of the graph in Neo4j."""
        if not self.is_connected:
            return {
                "total_entities": 0,
                "total_relationships": 0,
                "total_communities": 0,
                "modularity": 0.0,
                "density": 0.0,
                "connected_components": 0,
                "communities_by_level": {0: 0, 1: 0},
                "backend": "neo4j_disconnected",
            }
        try:
            with self._driver.session() as session:
                # Node count
                r = session.run("MATCH (e:Entity) RETURN count(e) AS cnt")
                node_count = r.single()["cnt"]

                # Edge count
                r = session.run("MATCH ()-[r:RELATES_TO]->() RETURN count(r) AS cnt")
                edge_count = r.single()["cnt"]

                # Community counts by level
                r = session.run(
                    """
                    MATCH (c:Community)
                    RETURN c.level AS level, count(c) AS cnt
                    """
                )
                communities_by_level = {}
                total_communities = 0
                for rec in r:
                    lv = rec["level"] if rec["level"] is not None else 0
                    communities_by_level[lv] = rec["cnt"]
                    total_communities += rec["cnt"]

                # Density
                if node_count > 1:
                    max_edges = node_count * (node_count - 1) / 2
                    density = round(edge_count / max_edges, 4) if max_edges > 0 else 0.0
                else:
                    density = 0.0

                # Connected components (Cypher-based)
                connected_components = self._count_components()

                return {
                    "total_entities": node_count,
                    "total_relationships": edge_count,
                    "total_communities": total_communities,
                    "modularity": 0.0,  # set by Louvain run
                    "density": density,
                    "connected_components": connected_components,
                    "communities_by_level": communities_by_level if communities_by_level else {0: 0, 1: 0},
                    "backend": "neo4j",
                }
        except Exception as e:
            print(f"[Neo4jStore] get_graph_status error: {e}")
            return {
                "total_entities": 0, "total_relationships": 0, "total_communities": 0,
                "modularity": 0.0, "density": 0.0, "connected_components": 0,
                "communities_by_level": {0: 0, 1: 0}, "backend": "neo4j_error",
            }

    def _count_components(self) -> int:
        """Count connected components. Uses GDS if available, else simple Cypher."""
        if self.has_gds:
            try:
                with self._driver.session() as session:
                    try:
                        session.run("CALL gds.graph.drop('adaptirag_wcc', false)")
                    except Exception:
                        pass
                    session.run(
                        """
                        CALL gds.graph.project(
                            'adaptirag_wcc', 'Entity',
                            {RELATES_TO: {orientation: 'UNDIRECTED'}}
                        )
                        """
                    )
                    r = session.run(
                        "CALL gds.wcc.stats('adaptirag_wcc') YIELD componentCount "
                        "RETURN componentCount"
                    )
                    cc = r.single()["componentCount"]
                    session.run("CALL gds.graph.drop('adaptirag_wcc', false)")
                    return cc
            except Exception:
                pass

        # Cypher fallback: count distinct community_id values as proxy
        try:
            with self._driver.session() as session:
                r = session.run(
                    "MATCH (e:Entity) "
                    "RETURN count(DISTINCT coalesce(e.community_id, e.name)) AS components"
                )
                return r.single()["components"]
        except Exception:
            return 0

    # ------------------------------------------------------------------ #
    #  Graph Export (D3 / Visualization)
    # ------------------------------------------------------------------ #

    def export_graph_json(self) -> Dict[str, Any]:
        """Export all nodes and edges in D3-compatible JSON format."""
        if not self.is_connected:
            return {"nodes": [], "links": []}
        try:
            with self._driver.session() as session:
                # Nodes
                r = session.run(
                    """
                    MATCH (e:Entity)
                    RETURN e.entity_id AS id, e.name AS name, e.type AS type,
                           e.description AS description,
                           coalesce(e.degree_centrality, 0.0) AS degree_centrality,
                           coalesce(e.betweenness_centrality, 0.0) AS betweenness_centrality,
                           e.document_id AS document_id, e.community_id AS community_id
                    """
                )
                nodes = [dict(rec) for rec in r]

                # Edges
                r = session.run(
                    """
                    MATCH (src:Entity)-[r:RELATES_TO]->(tgt:Entity)
                    RETURN src.entity_id AS source, tgt.entity_id AS target,
                           r.description AS description, r.weight AS weight,
                           r.rel_id AS rel_id
                    """
                )
                links = [dict(rec) for rec in r]

                return {"nodes": nodes, "links": links}
        except Exception as e:
            print(f"[Neo4jStore] export_graph_json error: {e}")
            return {"nodes": [], "links": []}

    # ------------------------------------------------------------------ #
    #  Admin — Clear / Reset
    # ------------------------------------------------------------------ #

    def clear_graph(self):
        """Delete ALL nodes and relationships from Neo4j. Admin-only operation."""
        if not self.is_connected:
            return
        try:
            with self._driver.session() as session:
                session.run("MATCH (n) DETACH DELETE n")
                print("[Neo4jStore] Graph cleared — all nodes and relationships deleted.")
        except Exception as e:
            print(f"[Neo4jStore] clear_graph error: {e}")

    # ------------------------------------------------------------------ #
    #  Internal Helpers
    # ------------------------------------------------------------------ #

    def _to_networkx(self):
        """Pull the Neo4j graph into a networkx.Graph for fallback algorithms."""
        import networkx as nx

        G = nx.Graph()
        if not self.is_connected:
            return G

        try:
            with self._driver.session() as session:
                # Nodes
                r = session.run("MATCH (e:Entity) RETURN e.name AS name, e.type AS type, e.description AS description")
                for rec in r:
                    G.add_node(rec["name"], type=rec["type"], description=rec["description"] or "")

                # Edges
                r = session.run(
                    "MATCH (s:Entity)-[r:RELATES_TO]->(t:Entity) "
                    "RETURN s.name AS source, t.name AS target, r.weight AS weight, r.description AS description"
                )
                for rec in r:
                    if G.has_edge(rec["source"], rec["target"]):
                        G[rec["source"]][rec["target"]]["weight"] += float(rec["weight"] or 1.0)
                    else:
                        G.add_edge(
                            rec["source"], rec["target"],
                            weight=float(rec["weight"] or 1.0),
                            description=rec["description"] or "related to",
                        )
        except Exception as e:
            print(f"[Neo4jStore] _to_networkx error: {e}")

        return G


# --------------------------------------------------------------------------- #
#  Global singleton — auto-connects on import
# --------------------------------------------------------------------------- #
neo4j_store = Neo4jStore()
