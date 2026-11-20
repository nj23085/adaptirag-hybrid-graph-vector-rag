import os
import time
import threading
from dotenv import load_dotenv
load_dotenv()  # Load .env file for API keys
from typing import List, Optional
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File,
    BackgroundTasks,
    status,
    Query
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import engine, get_db, Base, SessionLocal
import models
import schemas
import auth
import chunking
from vector_store import vector_store
from generator import generator
from graph_extractor import graph_extractor
from graph_pipeline import graph_pipeline
from neo4j_store import neo4j_store
from router import router_agent
from metrics_routes import router as metrics_router

# Create all tables on startup
Base.metadata.create_all(bind=engine)

def ensure_query_log_columns():
    """Ensure newly added columns exist in query_logs table."""
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(query_logs)"))
            cols = [row[1] for row in result.fetchall()]
            if "reasoning" not in cols:
                conn.execute(text("ALTER TABLE query_logs ADD COLUMN reasoning TEXT"))
                conn.commit()
            if "cost_usd" not in cols:
                conn.execute(text("ALTER TABLE query_logs ADD COLUMN cost_usd REAL DEFAULT 0.0"))
                conn.commit()
    except Exception as e:
        print(f"[DB Schema Note] {e}")

ensure_query_log_columns()

def build_graph_from_chunks(db: Session, document_id: Optional[int] = None) -> dict:
    """Extracts entities and relationships from chunks, updates DB and Neo4j, and builds the knowledge graph."""
    q = db.query(models.Chunk).join(models.Document).filter(models.Document.status == "ready")
    if document_id is not None:
        q = q.filter(models.Chunk.document_id == document_id)
    chunks = q.all()

    if not chunks:
        return graph_pipeline.detect_communities_and_metrics(db)

    # Step 1: extraction. This can call the LLM and be slow, so do it before any database writes
    # (a long-open write transaction would block other requests such as chat queries on SQLite).
    extracted_chunks = graph_extractor.extract_batch(chunks)  # a few chunks per model request

    # Step 2: merge into the database / graph store
    existing_entities = {e.name: e for e in db.query(models.Entity).all()}

    for c, extracted in extracted_chunks:
        # Merge entities
        for ent_data in extracted.get("entities", []):
            name = ent_data["name"]
            if name in existing_entities:
                ent_obj = existing_entities[name]
                if len(ent_data.get("description", "")) > len(ent_obj.description or ""):
                    ent_obj.description = ent_data["description"]
            else:
                new_ent = models.Entity(
                    name=name,
                    type=ent_data.get("type", "CONCEPT"),
                    description=ent_data.get("description", ""),
                    document_id=ent_data.get("document_id")
                )
                db.add(new_ent)
                db.flush()
                existing_entities[name] = new_ent

            # Also write to Neo4j
            neo4j_store.merge_entity(
                name=name,
                entity_type=ent_data.get("type", "CONCEPT"),
                description=ent_data.get("description", ""),
                document_id=ent_data.get("document_id"),
                entity_id=existing_entities[name].id,
            )

        # Merge relationships
        for rel_data in extracted.get("relationships", []):
            src_name = rel_data.get("source")
            tgt_name = rel_data.get("target")
            if src_name in existing_entities and tgt_name in existing_entities:
                src_ent = existing_entities[src_name]
                tgt_ent = existing_entities[tgt_name]

                existing_rel = db.query(models.Relationship).filter(
                    models.Relationship.source_entity_id == src_ent.id,
                    models.Relationship.target_entity_id == tgt_ent.id
                ).first()

                if existing_rel:
                    existing_rel.weight = float(existing_rel.weight or 1.0) + float(rel_data.get("weight", 1.0))
                else:
                    new_rel = models.Relationship(
                        source_entity_id=src_ent.id,
                        target_entity_id=tgt_ent.id,
                        description=rel_data.get("description", "related to"),
                        weight=float(rel_data.get("weight", 1.0)),
                        document_id=rel_data.get("document_id")
                    )
                    db.add(new_rel)

                # Also write to Neo4j
                neo4j_store.merge_relationship(
                    source_name=src_name,
                    target_name=tgt_name,
                    description=rel_data.get("description", "related to"),
                    weight=float(rel_data.get("weight", 1.0)),
                    document_id=rel_data.get("document_id"),
                )

    db.commit()
    metrics = graph_pipeline.build_from_db(db)
    return metrics

# Only one graph build at a time (the graph and community detection are shared, global state)
_graph_build_lock = threading.Lock()

def build_graph_in_background(document_id: int, filename: str) -> None:
    """
    Runs after the upload response has been sent, so the user can start asking questions
    right away. Uses its own database session because the request's session is already closed.
    """
    with _graph_build_lock:
        db = SessionLocal()
        try:
            started = time.time()
            build_graph_from_chunks(db, document_id)
            print(f"[GraphPipeline] Graph updated for {filename} in {time.time() - started:.1f}s (background)")
        except Exception as graph_err:
            db.rollback()
            print(f"[GraphPipeline Warning] Could not build graph for {filename}: {graph_err}")
        finally:
            db.close()

def sync_vector_store_from_db():
    """Sync all chunks from database into FAISS if vector store is empty."""
    try:
        if vector_store.index is None or vector_store.index.ntotal == 0:
            db = SessionLocal()
            chunks = db.query(models.Chunk).join(models.Document).filter(models.Document.status == "ready").all()
            if chunks:
                v_chunks = [
                    {
                        "chunk_id": c.id,
                        "document_id": c.document_id,
                        "filename": c.document.filename if c.document else "unknown",
                        "chunk_index": c.chunk_index,
                        "text": c.text,
                        "start_char": c.start_char,
                        "end_char": c.end_char,
                        "token_estimate": c.token_estimate,
                    }
                    for c in chunks
                ]
                count = vector_store.add_chunks(v_chunks)
                print(f"[VectorStore] Auto-indexed {count} existing chunks into FAISS.")
            db.close()
    except Exception as e:
        print(f"[VectorStore Sync Warning] {e}")

def sync_graph_from_db():
    """Builds Knowledge Graph from ready chunks in SQLite if graph has not yet been built.
    Also syncs existing SQLite entities into Neo4j on startup."""
    try:
        db = SessionLocal()
        ent_count = db.query(models.Entity).count()
        if ent_count == 0:
            chunks = db.query(models.Chunk).join(models.Document).filter(models.Document.status == "ready").all()
            if chunks:
                print(f"[GraphPipeline] Auto-extracting entities & relationships from {len(chunks)} chunks...")
                build_graph_from_chunks(db)
                print(f"[GraphPipeline] Knowledge graph initialized.")
        else:
            # Sync existing entities/relationships into Neo4j
            if neo4j_store.is_connected:
                sync_result = neo4j_store.sync_from_sqlite(db)
                print(f"[Startup] Neo4j sync: {sync_result}")
            graph_pipeline.build_from_db(db)
        db.close()
    except Exception as e:
        print(f"[GraphPipeline Sync Warning] {e}")

sync_vector_store_from_db()
sync_graph_from_db()

app = FastAPI(
    title="AdaptiRAG API",
    description="Adaptive Hybrid Graph-Vector RAG for Query-Focused Summarization",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        admin = db.query(models.User).filter(models.User.email == "admin@adaptirag.ai").first()
        if not admin:
            admin = models.User(
                email="admin@adaptirag.ai",
                password_hash=auth.get_password_hash("admin123"),
                role="admin"
            )
            db.add(admin)

        user = db.query(models.User).filter(models.User.email == "user@adaptirag.ai").first()
        if not user:
            user = models.User(
                email="user@adaptirag.ai",
                password_hash=auth.get_password_hash("user123"),
                role="user"
            )
            db.add(user)

        # Seed default routing threshold
        threshold = db.query(models.AdminSetting).filter(models.AdminSetting.key == "routing_threshold").first()
        if not threshold:
            db.add(models.AdminSetting(key="routing_threshold", value="0.75"))

        db.commit()
    finally:
        db.close()

init_db()

@app.on_event("startup")
def startup_event():
    init_db()

app.include_router(metrics_router)

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "AdaptiRAG API",
        "phase": "Phase 1 - Ingestion & Chunking Complete"
    }

# ----------------- AUTH ENDPOINTS -----------------

@app.post("/auth/register", response_model=schemas.Token)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == user_in.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    user = models.User(
        email=user_in.email,
        password_hash=auth.get_password_hash(user_in.password),
        role=user_in.role or "user"
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return schemas.Token(
        access_token=token,
        token_type="bearer",
        user=schemas.UserResponse.from_orm(user)
    )

@app.post("/auth/login", response_model=schemas.Token)
def login(login_data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == login_data.email).first()
    if not user or not auth.verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return schemas.Token(
        access_token=token,
        token_type="bearer",
        user=schemas.UserResponse.from_orm(user)
    )

@app.get("/auth/me", response_model=schemas.UserResponse)
def get_current_user_info(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

# ----------------- DOCUMENT ENDPOINTS -----------------

@app.post("/documents", response_model=schemas.DocumentDetailResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    # Allow optional auth for easy local testing / curl, but associate with user if token provided
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional)
):
    filename = file.filename or "untitled_doc"
    ext = filename.split(".")[-1].lower() if "." in filename else "txt"
    allowed_exts = ["pdf", "docx", "txt", "md"]
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file extension '{ext}'. Allowed: {', '.join(allowed_exts)}"
        )

    file_bytes = await file.read()
    file_size = len(file_bytes)

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    # 1. Create document record in "uploaded" state
    doc = models.Document(
        filename=filename,
        file_type=ext,
        file_size=file_size,
        status="chunking",
        user_id=current_user.id if current_user else None
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    try:
        # 2. Extract text
        extracted_text = chunking.extract_text(filename, file_bytes)
        if not extracted_text.strip():
            raise ValueError("No extractable text found in file.")

        # 3. Chunk text (~500-800 tokens with overlap)
        chunks_data = chunking.chunk_text(extracted_text, target_token_size=600, overlap_tokens=100)

        # 4. Save chunks to SQLite
        chunk_objects = []
        for c in chunks_data:
            chunk_obj = models.Chunk(
                document_id=doc.id,
                chunk_index=c["chunk_index"],
                text=c["text"],
                token_estimate=c["token_estimate"],
                start_char=c["start_char"],
                end_char=c["end_char"]
            )
            db.add(chunk_obj)
            chunk_objects.append(chunk_obj)

        doc.chunk_count = len(chunks_data)
        doc.status = "ready"
        db.commit()
        db.refresh(doc)

        # Index chunks in FAISS Vector Store
        try:
            vector_items = [
                {
                    "chunk_id": chunk_obj.id,
                    "document_id": doc.id,
                    "filename": doc.filename,
                    "chunk_index": chunk_obj.chunk_index,
                    "text": chunk_obj.text,
                    "start_char": chunk_obj.start_char,
                    "end_char": chunk_obj.end_char,
                    "token_estimate": chunk_obj.token_estimate,
                }
                for chunk_obj in chunk_objects
            ]
            vector_store.add_chunks(vector_items)
            print(f"[VectorStore] Indexed {len(vector_items)} chunks for document {doc.filename} (ID: {doc.id})")
        except Exception as vec_err:
            print(f"[VectorStore Warning] Could not index chunks: {vec_err}")

        # Knowledge graph (entities, relationships, communities) is built AFTER the response is sent.
        # Vector search and "This document" questions work immediately; only graph answers wait for it.
        background_tasks.add_task(build_graph_in_background, doc.id, doc.filename)

        return doc

    except Exception as e:
        doc.status = "error"
        doc.error_message = str(e)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Ingestion failed: {str(e)}"
        )

@app.get("/documents", response_model=List[schemas.DocumentResponse])
def list_documents(
    db: Session = Depends(get_db),
    status_filter: Optional[str] = Query(None, alias="status")
):
    query = db.query(models.Document)
    if status_filter:
        query = query.filter(models.Document.status == status_filter)
    return query.order_by(models.Document.uploaded_at.desc()).all()

@app.get("/documents/{document_id}", response_model=schemas.DocumentDetailResponse)
def get_document(document_id: int, db: Session = Depends(get_db)):
    doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    return {"message": f"Document {document_id} and its chunks were deleted"}

# ----------------- VECTOR INDEX & QUERY PIPELINE -----------------

@app.get("/index/status", response_model=schemas.IndexStatusResponse)
def get_index_status():
    """Returns current FAISS index size, dimension, and provider status."""
    return vector_store.get_stats()

@app.post("/index/build")
def build_vector_index(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Rebuilds the FAISS vector index from all ready chunks in the database."""
    chunks = db.query(models.Chunk).join(models.Document).filter(models.Document.status == "ready").all()
    if not chunks:
        return {"message": "No chunks found to index.", "indexed_count": 0}

    v_chunks = [
        {
            "chunk_id": c.id,
            "document_id": c.document_id,
            "filename": c.document.filename if c.document else "unknown",
            "chunk_index": c.chunk_index,
            "text": c.text,
            "start_char": c.start_char,
            "end_char": c.end_char,
            "token_estimate": c.token_estimate,
        }
        for c in chunks
    ]
    # Reset and add
    vector_store.reset()
    indexed_count = vector_store.add_chunks(v_chunks)
    return {
        "message": f"Successfully indexed {indexed_count} chunks into FAISS.",
        "indexed_count": indexed_count,
        "stats": vector_store.get_stats()
    }

@app.post("/index/reset")
def reset_vector_index(current_admin: models.User = Depends(auth.get_current_admin)):
    """Admin-only endpoint to wipe and reset the FAISS index."""
    vector_store.reset()
    return {"message": "Vector index has been reset.", "stats": vector_store.get_stats()}

# ----------------- KNOWLEDGE GRAPH ENDPOINTS (PHASE 3) -----------------

@app.post("/graph/build", response_model=schemas.GraphStatusResponse)
def build_knowledge_graph(
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_admin)
):
    """
    Extracts entities and relationships from all ready chunks, updates database,
    constructs networkx graph, executes Louvain community detection, and generates
    Map-Reduce community summaries.
    """
    metrics = build_graph_from_chunks(db)
    return metrics

@app.get("/graph/status", response_model=schemas.GraphStatusResponse)
def get_graph_status(db: Session = Depends(get_db)):
    """Retrieves current graph topological statistics, modularity, and community counts."""
    status = graph_pipeline.detect_communities_and_metrics(db)
    # Remove non-schema keys added by Neo4j backend
    status.pop("backend", None)
    return status

@app.get("/graph/neo4j/status")
def get_neo4j_status():
    """Returns Neo4j connection health, server version, and GDS availability."""
    return neo4j_store.health_check()

@app.get("/graph/entities", response_model=List[schemas.EntityResponse])
def get_graph_entities(
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Retrieves extracted entities with degree and betweenness centrality metrics."""
    # Try Neo4j first
    if neo4j_store.is_connected:
        neo4j_entities = neo4j_store.get_entities(limit=limit)
        if neo4j_entities:
            return neo4j_entities

    # Fallback to SQLite + networkx
    entities = db.query(models.Entity).limit(limit).all()
    results = []
    for e in entities:
        deg = 0.0
        bet = 0.0
        if graph_pipeline.graph.has_node(e.id):
            deg = graph_pipeline.graph.nodes[e.id].get("degree_centrality", 0.0)
            bet = graph_pipeline.graph.nodes[e.id].get("betweenness_centrality", 0.0)
        results.append({
            "id": e.id,
            "name": e.name,
            "type": e.type,
            "description": e.description,
            "document_id": e.document_id,
            "degree_centrality": deg,
            "betweenness_centrality": bet
        })
    return results

@app.get("/graph/relationships", response_model=List[schemas.RelationshipResponse])
def get_graph_relationships(
    limit: int = 150,
    db: Session = Depends(get_db)
):
    """Retrieves relational edges with source and target entity names."""
    # Try Neo4j first
    if neo4j_store.is_connected:
        neo4j_rels = neo4j_store.get_relationships(limit=limit)
        if neo4j_rels:
            return neo4j_rels

    # Fallback to SQLite
    rels = db.query(models.Relationship).limit(limit).all()
    id_name_map = {e.id: e.name for e in db.query(models.Entity.id, models.Entity.name).all()}
    return [
        {
            "id": r.id,
            "source_entity_id": r.source_entity_id,
            "source_name": id_name_map.get(r.source_entity_id, f"Entity #{r.source_entity_id}"),
            "target_entity_id": r.target_entity_id,
            "target_name": id_name_map.get(r.target_entity_id, f"Entity #{r.target_entity_id}"),
            "description": r.description,
            "weight": r.weight or 1.0,
            "document_id": r.document_id
        }
        for r in rels
    ]

@app.get("/graph/communities", response_model=List[schemas.CommunityResponse])
def get_graph_communities(
    level: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Retrieves detected communities with member names and synthesized Map summaries."""
    q = db.query(models.Community)
    if level is not None:
        q = q.filter(models.Community.level == level)
    comms = q.all()
    id_name_map = {e.id: e.name for e in db.query(models.Entity.id, models.Entity.name).all()}

    return [
        {
            "id": c.id,
            "level": c.level,
            "title": c.title,
            "summary": c.summary,
            "member_entity_ids": c.member_entity_ids or [],
            "member_count": len(c.member_entity_ids or []),
            "member_names": [id_name_map.get(m_id, f"Entity #{m_id}") for m_id in (c.member_entity_ids or [])]
        }
        for c in comms
    ]

@app.post("/graph/query", response_model=schemas.GraphQueryResponse)
def execute_graph_query(
    req: schemas.GraphQueryRequest,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional)
):
    """
    Global Graph-RAG Query Engine:
    Executes Map-Reduce summarization across relevant community summaries,
    generating a high-level synthesized answer with explicit community and entity citations.
    """
    result = graph_pipeline.execute_global_query(
        query=req.query,
        db_session=db,
        target_level=req.level or 0,
        top_communities=req.top_communities or 3
    )

    # Log query
    try:
        log_entry = models.QueryLog(
            query_text=req.query,
            route="graph",
            confidence=0.92,
            cost_tokens=result.get("tokens_used", 0),
            latency_ms=result.get("latency_ms", 0.0),
            user_id=current_user.id if current_user else None
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        print(f"[QueryLog Error] {e}")

    return result

@app.get("/graph/export", response_model=schemas.GraphExportResponse)
def export_graph(db: Session = Depends(get_db)):
    """Exports graph nodes and links for interactive D3 / SVG graph visualizers."""
    if neo4j_store.is_connected:
        export = graph_pipeline.export_graph_json()
        if export.get("nodes"):
            return export
    # Fallback: build from DB if graph is empty
    if graph_pipeline.graph.number_of_nodes() == 0:
        graph_pipeline.build_from_db(db)
    return graph_pipeline.export_graph_json()

# ----------------- UNIFIED / HYBRID QUERY ROUTER -----------------

def is_global_thematic_query(query: str) -> bool:
    """Heuristic detector for global, high-level comparative or thematic queries."""
    q = query.lower()
    thematic_keywords = [
        "compare", "comparison", "overview", "summary", "summarize",
        "trade-off", "tradeoff", "trade-offs", "architecture", "system",
        "how do", "difference", "relationship", "all protocols", "consensus protocols",
        "limits", "bounds", "comprehensive", "synthesize", "landscape"
    ]
    return any(kw in q for kw in thematic_keywords)

@app.post("/query", response_model=schemas.QueryResponse)
def execute_query(
    req: schemas.QueryRequest,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional)
):
    """
    Executes a query using Vector search, Graph Map-Reduce, or Auto-Routing.
    """
    start_time = time.time()
    mode = (req.mode or "vector").lower()

    # Route decision
    route = "vector"
    if mode == "graph" or (mode == "auto" and is_global_thematic_query(req.query)):
        route = "graph"

    if route == "graph":
        graph_res = graph_pipeline.execute_global_query(
            query=req.query,
            db_session=db,
            target_level=0,
            top_communities=3
        )
        # Convert community citations to CitationItem format for schema compatibility
        synthetic_citations = [
            {
                "document_id": c.get("community_id", 0),
                "filename": f"Community: {c.get('title', '')}",
                "chunk_index": c.get("level", 0),
                "start_char": 0,
                "end_char": len(c.get("summary", "")),
                "score": 0.95,
                "text": f"Community Summary ({c.get('title')}): {c.get('summary')}",
                "token_estimate": len(c.get("summary", "").split())
            }
            for c in graph_res.get("community_citations", [])
        ]
        elapsed_ms = graph_res.get("latency_ms", round((time.time() - start_time) * 1000.0, 2))

        try:
            log_entry = models.QueryLog(
                query_text=req.query,
                route="graph",
                confidence=0.95,
                cost_tokens=graph_res.get("tokens_used", 0),
                latency_ms=elapsed_ms,
                user_id=current_user.id if current_user else None
            )
            db.add(log_entry)
            db.commit()
        except Exception as log_err:
            print(f"[QueryLog Error] {log_err}")

        return {
            "query": req.query,
            "route": "graph",
            "answer": graph_res.get("answer", ""),
            "citations": synthetic_citations,
            "latency_ms": elapsed_ms,
            "tokens_used": graph_res.get("tokens_used", 0),
            "model": graph_res.get("model", "graph-synthesizer")
        }

    # Vector search route
    citations = vector_store.search(
        query=req.query,
        top_k=req.top_k or 4,
        min_similarity=req.min_similarity or 0.0
    )

    gen_result = generator.generate_grounded_answer(req.query, citations)
    elapsed_ms = round((time.time() - start_time) * 1000.0, 2)

    try:
        log_entry = models.QueryLog(
            query_text=req.query,
            route="vector",
            confidence=citations[0]["score"] if citations else 0.0,
            cost_tokens=gen_result.get("tokens_used", 0),
            latency_ms=elapsed_ms,
            user_id=current_user.id if current_user else None
        )
        db.add(log_entry)
        db.commit()
    except Exception as log_err:
        print(f"[QueryLog Error] Failed to log query: {log_err}")

    return {
        "query": req.query,
        "route": "vector",
        "answer": gen_result.get("answer", ""),
        "citations": citations,
        "latency_ms": elapsed_ms,
        "tokens_used": gen_result.get("tokens_used", 0),
        "model": gen_result.get("model", "unknown")
    }

@app.get("/query/history")
def get_query_history(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Retrieves recent query executions with telemetry metrics."""
    logs = db.query(models.QueryLog).order_by(models.QueryLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "query_text": l.query_text,
            "route": l.route,
            "confidence": l.confidence,
            "cost_tokens": l.cost_tokens,
            "latency_ms": l.latency_ms,
            "reasoning": getattr(l, "reasoning", None),
            "cost_usd": getattr(l, "cost_usd", 0.0),
            "created_at": l.created_at.isoformat() if l.created_at else None
        }
        for l in logs
    ]

# ----------------- PHASE 4: ROUTER AGENT ENDPOINTS -----------------

@app.post("/router/classify", response_model=schemas.RouterClassifyResponse)
def router_classify(req: schemas.RouterClassifyRequest):
    """
    Classifies a query without executing, providing signal analysis,
    archetype detection, confidence score, and latency/cost estimation.
    """
    return router_agent.classify(req.query)

@app.post("/router/query")
@app.post("/router/execute")
def router_execute(
    req: schemas.RouterQueryRequest,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional)
):
    """
    Adaptive end-to-end execution orchestrated by the Router Agent.
    Routes to local vector search, global graph Map-Reduce, or hybrid dual-engine.
    Records comprehensive telemetry into the database.
    """
    return router_agent.execute_query(
        query=req.query,
        mode=req.mode or "auto",
        db_session=db,
        current_user=current_user,
        top_k=req.top_k or 4,
        community_level=req.community_level or 0,
        document_id=req.document_id,
        document_ids=req.document_ids
    )

@app.get("/router/telemetry", response_model=schemas.RouterTelemetryResponse)
def get_router_telemetry(
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """
    Returns aggregated query telemetry metrics, route distribution,
    average latencies, total cost, and chronological query execution logs.
    """
    return router_agent.get_telemetry_stats(db_session=db, limit=limit)

@app.get("/router/config", response_model=schemas.RouterConfig)
def get_router_config():
    """Returns current router configuration and cost parameters."""
    return {
        "graph_threshold": router_agent.graph_threshold,
        "hybrid_threshold": router_agent.hybrid_threshold,
        "cost_per_1k_input_tokens": router_agent.cost_per_1k_input,
        "cost_per_1k_output_tokens": router_agent.cost_per_1k_output,
        "active_model": router_agent.active_model
    }

@app.patch("/router/config")
def update_router_config(config: schemas.RouterConfig):
    """Updates router sensitivity thresholds and pricing parameters."""
    router_agent.graph_threshold = config.graph_threshold
    router_agent.hybrid_threshold = config.hybrid_threshold
    router_agent.cost_per_1k_input = config.cost_per_1k_input_tokens
    router_agent.cost_per_1k_output = config.cost_per_1k_output_tokens
    router_agent.active_model = config.active_model
    return {
        "status": "updated",
        "graph_threshold": router_agent.graph_threshold,
        "hybrid_threshold": router_agent.hybrid_threshold,
        "active_model": router_agent.active_model
    }

# ----------------- ADMIN SETTINGS -----------------

@app.get("/admin/settings")
def get_admin_settings(
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_admin)
):
    settings = db.query(models.AdminSetting).all()
    return {s.key: s.value for s in settings}

@app.patch("/admin/settings")
def update_admin_setting(
    key: str,
    value: str,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_admin)
):
    setting = db.query(models.AdminSetting).filter(models.AdminSetting.key == key).first()
    if not setting:
        setting = models.AdminSetting(key=key, value=value)
        db.add(setting)
    else:
        setting.value = value
    db.commit()
    return {"key": key, "value": value}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("BACKEND_PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)