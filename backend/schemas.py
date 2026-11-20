import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr

class UserBase(BaseModel):
    email: EmailStr
    role: Optional[str] = "user"

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: Optional[str] = "user"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    role: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None

class ChunkResponse(BaseModel):
    id: int
    chunk_index: int
    text: str
    token_estimate: int
    start_char: int
    end_char: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class DocumentResponse(BaseModel):
    id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    chunk_count: int
    uploaded_at: datetime.datetime
    error_message: Optional[str] = None

    class Config:
        from_attributes = True

class DocumentDetailResponse(DocumentResponse):
    chunks: List[ChunkResponse] = []

class CitationItem(BaseModel):
    document_id: int
    filename: str
    chunk_index: int
    start_char: int
    end_char: int
    score: float
    text: str
    token_estimate: Optional[int] = None

class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 4
    min_similarity: Optional[float] = 0.0
    mode: Optional[str] = "vector"

class QueryResponse(BaseModel):
    query: str
    route: str
    answer: str
    citations: List[CitationItem]
    latency_ms: float
    tokens_used: int
    model: str

class IndexStatusResponse(BaseModel):
    total_vectors: int
    dimension: int
    index_type: str
    provider_info: dict

class EntityResponse(BaseModel):
    id: int
    name: str
    type: str
    description: Optional[str] = None
    document_id: Optional[int] = None
    degree_centrality: Optional[float] = 0.0
    betweenness_centrality: Optional[float] = 0.0

    class Config:
        from_attributes = True

class RelationshipResponse(BaseModel):
    id: int
    source_entity_id: int
    source_name: Optional[str] = None
    target_entity_id: int
    target_name: Optional[str] = None
    description: Optional[str] = None
    weight: float = 1.0
    document_id: Optional[int] = None

    class Config:
        from_attributes = True

class CommunityResponse(BaseModel):
    id: int
    level: int
    title: Optional[str] = None
    summary: Optional[str] = None
    member_entity_ids: List[int] = []
    member_count: int = 0
    member_names: List[str] = []

    class Config:
        from_attributes = True

class GraphStatusResponse(BaseModel):
    total_entities: int
    total_relationships: int
    total_communities: int
    modularity: float
    density: float
    connected_components: int
    communities_by_level: dict

class GraphQueryRequest(BaseModel):
    query: str
    level: Optional[int] = 0
    top_communities: Optional[int] = 3

class CommunityCitationItem(BaseModel):
    community_id: int
    level: int
    title: str
    summary: str
    member_count: int
    member_names: List[str] = []

class GraphQueryResponse(BaseModel):
    query: str
    route: str
    answer: str
    community_citations: List[CommunityCitationItem]
    entity_citations: List[str] = []
    latency_ms: float
    tokens_used: int
    model: str

class GraphNode(BaseModel):
    id: int
    name: str
    type: str
    description: Optional[str] = ""
    degree_centrality: Optional[float] = 0.0
    betweenness_centrality: Optional[float] = 0.0
    document_id: Optional[int] = None

class GraphLink(BaseModel):
    source: int
    target: int
    description: Optional[str] = "related to"
    weight: float = 1.0
    rel_id: Optional[int] = None

class GraphExportResponse(BaseModel):
    nodes: List[GraphNode]
    links: List[GraphLink]

# ----------------- PHASE 4: ROUTER AGENT SCHEMAS -----------------

class RouterClassifyRequest(BaseModel):
    query: str

class RouterIntentBreakdown(BaseModel):
    factual_specificity: float
    thematic_breadth: float
    relational_multi_hop: float

class RouterSignals(BaseModel):
    thematic_keywords: List[str] = []
    factual_keywords: List[str] = []
    entity_matches: List[str] = []
    query_length: int = 0
    archetype: str = "pointwise_fact"

class RouterClassifyResponse(BaseModel):
    query: str
    route: str  # "local", "global", or "hybrid"
    confidence: float
    reasoning: str
    intent_breakdown: RouterIntentBreakdown
    signals: RouterSignals
    estimated_latency_ms: float
    estimated_tokens: int
    estimated_cost_usd: float

class RouterQueryRequest(BaseModel):
    query: str
    mode: Optional[str] = "auto"  # "auto", "local", "global", "hybrid"
    top_k: Optional[int] = 4
    community_level: Optional[int] = 0
    document_id: Optional[int] = None  # restrict vector retrieval to this document
    document_ids: Optional[List[int]] = None  # restrict retrieval to these documents (hand-picked set)

class RouterTelemetryItem(BaseModel):
    id: int
    query_text: str
    route: str
    confidence: float
    cost_tokens: int
    latency_ms: float
    reasoning: Optional[str] = None
    cost_usd: float = 0.0
    created_at: Optional[str] = None

class RouterTelemetryStats(BaseModel):
    total_queries: int
    route_distribution: dict
    route_percentages: dict
    avg_latency_by_route_ms: dict
    total_tokens: int
    total_cost_usd: float
    avg_confidence: float

class RouterTelemetryResponse(BaseModel):
    stats: RouterTelemetryStats
    recent_logs: List[RouterTelemetryItem]

class RouterConfig(BaseModel):
    graph_threshold: float = 0.55
    hybrid_threshold: float = 0.50
    cost_per_1k_input_tokens: float = 0.00015
    cost_per_1k_output_tokens: float = 0.00060
    active_model: str = "gemini-2.5-flash"