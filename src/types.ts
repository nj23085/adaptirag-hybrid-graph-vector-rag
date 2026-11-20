export interface ChunkData {
  chunk_index: number;
  text: string;
  token_estimate: number;
  start_char: number;
  end_char: number;
}

export interface DocumentItem {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  status: 'uploaded' | 'chunking' | 'ready' | 'error';
  chunk_count: number;
  uploaded_at: string;
  chunks: ChunkData[];
}

export interface UserRole {
  email: string;
  role: 'admin' | 'user';
  name: string;
  token: string;
}

export interface TableSchema {
  name: string;
  phase: string;
  status: 'active' | 'ready_for_phase';
  description: string;
  columns: { name: string; type: string; key?: boolean; desc: string }[];
}

export interface CitationItem {
  document_id: number;
  filename: string;
  chunk_index: number;
  start_char: number;
  end_char: number;
  score: number;
  text: string;
  token_estimate?: number;
}

export interface QueryResult {
  query: string;
  route: string;
  answer: string;
  citations: CitationItem[];
  latency_ms: number;
  tokens_used: number;
  model: string;
}

export interface IndexStatus {
  total_vectors: number;
  dimension: number;
  index_type: string;
  provider_info: {
    provider: string;
    model: string;
    dimension: number;
    has_gemini_key: boolean;
    has_openai_key: boolean;
  };
}

export interface EntityItem {
  id: number;
  name: string;
  type: string;
  description?: string;
  document_id?: number;
  degree_centrality: number;
  betweenness_centrality: number;
}

export interface RelationshipItem {
  id: number;
  source_entity_id: number;
  source_name: string;
  target_entity_id: number;
  target_name: string;
  description: string;
  weight: number;
  document_id?: number;
}

export interface CommunityItem {
  id: number;
  level: number;
  title: string;
  summary: string;
  member_entity_ids: number[];
  member_count: number;
  member_names: string[];
}

export interface GraphStatus {
  total_entities: number;
  total_relationships: number;
  total_communities: number;
  modularity: number;
  density: number;
  connected_components: number;
  communities_by_level: Record<number, number>;
}

export interface GraphNode {
  id: number;
  name: string;
  type: string;
  description?: string;
  degree_centrality?: number;
  betweenness_centrality?: number;
  document_id?: number;
}

export interface GraphLink {
  source: number;
  target: number;
  description?: string;
  weight: number;
  rel_id?: number;
}

export interface GraphExportData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface CommunityCitation {
  community_id: number;
  level: number;
  title: string;
  summary: string;
  member_count: number;
  member_names: string[];
}

export interface GraphQueryResult {
  query: string;
  route: string;
  answer: string;
  community_citations: CommunityCitation[];
  entity_citations: string[];
  latency_ms: number;
  tokens_used: number;
  model: string;
}

// ----------------- PHASE 4: ROUTER AGENT TYPES -----------------

export interface RouterIntentBreakdown {
  factual_specificity: number;
  thematic_breadth: number;
  relational_multi_hop: number;
}

export interface RouterSignals {
  thematic_keywords: string[];
  factual_keywords: string[];
  entity_matches: string[];
  query_length: number;
  archetype: string;
}

export interface RouterClassification {
  query: string;
  route: 'local' | 'global' | 'hybrid';
  confidence: number;
  reasoning: string;
  intent_breakdown: RouterIntentBreakdown;
  signals: RouterSignals;
  estimated_latency_ms: number;
  estimated_tokens: number;
  estimated_cost_usd: number;
  /** Probability of each route from the learned classifier (sums to about 1). */
  probabilities?: Partial<Record<'local' | 'global' | 'hybrid', number>>;
  /** Which classifier made the decision, e.g. the learned model or the rule-based fallback. */
  classifier?: string;
}

export interface RouterExecutionResult {
  query: string;
  route: 'local' | 'global' | 'hybrid';
  answer: string;
  citations: CitationItem[];
  community_citations?: CommunityCitation[];
  entity_citations?: string[];
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  model: string;
  classification?: RouterClassification;
  scope?: string;
  scope_note?: string;
  input_tokens?: number;
  output_tokens?: number;
  /** true when the token counts were reported by the model, false when estimated */
  tokens_exact?: boolean;
}

export interface RouterTelemetryLog {
  id: number;
  query_text: string;
  route: 'local' | 'global' | 'hybrid' | string;
  confidence: number;
  cost_tokens: number;
  latency_ms: number;
  reasoning?: string;
  cost_usd: number;
  created_at?: string;
}

export interface RouterTelemetryStats {
  total_queries: number;
  route_distribution: Record<string, number>;
  route_percentages: Record<string, number>;
  avg_latency_by_route_ms: Record<string, number>;
  total_tokens: number;
  total_cost_usd: number;
  avg_confidence: number;
}

export interface RouterTelemetryData {
  stats: RouterTelemetryStats;
  recent_logs: RouterTelemetryLog[];
}

export interface RouterConfigState {
  graph_threshold: number;
  hybrid_threshold: number;
  cost_per_1k_input_tokens: number;
  cost_per_1k_output_tokens: number;
  active_model: string;
}

// Phase 5 Frontend Chat, Citation Inspector & Evaluation Types
export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text: string;
  route?: 'local' | 'global' | 'hybrid';
  confidence?: number;
  latency_ms?: number;
  cost_usd?: number;
  tokens_used?: number;
  model?: string;
  reasoning?: string;
  citations?: CitationItem[];
  community_citations?: CommunityCitation[];
  entity_citations?: string[];
  classification?: RouterClassification;
  /** Set when the backend changed the search scope, e.g. single-document mode skipping the cross-document graph. */
  scope_note?: string;
  input_tokens?: number;
  output_tokens?: number;
  tokens_exact?: boolean;
  feedback?: 'positive' | 'negative' | null;
}

export interface EvaluationMetricSummary {
  metric: string;
  score: number;
  benchmark: number;
  description: string;
  trend: 'up' | 'down' | 'neutral';
}

// Phase 6 Evaluation, Trade-off Harness and Production Benchmark Types
export interface TradeoffScenario {
  id: string;
  name: string;
  query_sample: string;
  category: 'factual' | 'thematic' | 'multi_hop' | 'adversarial';
  vector_latency_ms: number;
  vector_cost_usd: number;
  vector_faithfulness: number;
  vector_completeness: number;
  graph_latency_ms: number;
  graph_cost_usd: number;
  graph_faithfulness: number;
  graph_completeness: number;
  hybrid_latency_ms: number;
  hybrid_cost_usd: number;
  hybrid_faithfulness: number;
  hybrid_completeness: number;
  recommended_route: 'local' | 'global' | 'hybrid';
  saving_vs_global_pct: number;
}

export interface ProductionAuditReport {
  generated_at: string;
  total_queries_benchmarked: number;
  avg_router_overhead_ms: number;
  cost_saved_usd: number;
  faithfulness_rate: number;
  groundedness_rate: number;
  zero_hallucination_rate: number;
}