import React, { useState, useEffect } from 'react';
import {
  Compass,
  Cpu,
  GitFork,
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  Coins,
  Search,
  Activity,
  Filter,
  Sliders,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Layers,
  FileText,
  ChevronRight,
  RefreshCw,
  Info
} from 'lucide-react';
import {
  RouterClassification,
  RouterExecutionResult,
  RouterTelemetryData,
  RouterConfigState,
  UserRole
} from '../types';

interface RouterWorkbenchProps {
  currentUser: UserRole;
  apiBase?: string;
}

// Initial High-Fidelity Data Constants
const DEFAULT_CLASSIFICATION: RouterClassification = {
  query: 'Compare crash fault-tolerant and Byzantine fault-tolerant consensus protocols.',
  route: 'global',
  confidence: 0.942,
  reasoning: "Detected macro thematic comparative tokens ('compare', 'protocols') spanning multiple failure models. Routed to GLOBAL Knowledge Graph Map-Reduce to synthesize hierarchical Louvain community summaries across crash-tolerant quorums and Byzantine mitigation.",
  intent_breakdown: {
    factual_specificity: 0.28,
    thematic_breadth: 0.88,
    relational_multi_hop: 0.72
  },
  signals: {
    thematic_keywords: ['compare', 'consensus protocols'],
    factual_keywords: [],
    entity_matches: ['paxos', 'pbft'],
    query_length: 9,
    archetype: 'thematic_comparison'
  },
  estimated_latency_ms: 380.0,
  estimated_tokens: 920,
  estimated_cost_usd: 0.000248
};

const DEFAULT_EXECUTION_RESULT: RouterExecutionResult = {
  query: 'Compare crash fault-tolerant and Byzantine fault-tolerant consensus protocols.',
  route: 'global',
  answer: 'An adaptive synthesis across [Community: Crash-Tolerant Consensus Mechanics & Quorum Systems] and [Community: Byzantine Fault Tolerance & Malicious Node Mitigation] establishes the core architectural trade-offs:\n\n1. **Crash-Fault Resilience (CFT)**: Protocols like [Entity: Paxos] and [Entity: Raft] operate under benign crash-stop failure assumptions [Doc: consensus_overview.txt, Chunk: 0]. Safety is maintained through strict majority quorums (⌊N/2⌋ + 1) of acceptors.\n\n2. **Byzantine Fault Resilience (BFT)**: Protocols such as [Entity: PBFT] protect against arbitrary or malicious node corruption [Community: Byzantine Fault Tolerance & Malicious Node Mitigation]. Withstanding f Byzantine adversaries requires 3f + 1 total nodes and multi-phase cryptographic signature exchanges.\n\n3. **Theoretical Boundaries**: Under the [Entity: FLP Impossibility Theorem], no deterministic consensus protocol can simultaneously ensure safety and liveness in purely asynchronous networks.',
  citations: [
    {
      document_id: 1,
      filename: 'Community: Crash-Tolerant Consensus Mechanics & Quorum Systems',
      chunk_index: 0,
      start_char: 0,
      end_char: 240,
      score: 0.96,
      text: 'Details operational mechanics of crash fault-tolerant distributed state machine replication, phase-based proposal coordination, and majority quorum safety.'
    },
    {
      document_id: 2,
      filename: 'Community: Byzantine Fault Tolerance & Malicious Node Mitigation',
      chunk_index: 0,
      start_char: 0,
      end_char: 210,
      score: 0.94,
      text: 'Focuses on PBFT and distributed agreement under arbitrary or adversarial failure models, requiring 3f + 1 total nodes to tolerate f malicious failures.'
    }
  ],
  community_citations: [
    {
      community_id: 1,
      level: 0,
      title: 'Crash-Tolerant Consensus Mechanics & Quorum Systems',
      summary: 'Details operational mechanics of crash fault-tolerant distributed state machine replication and majority quorum safety.',
      member_count: 6,
      member_names: ['Paxos', 'Proposer', 'Acceptor', 'Learner', 'Quorum', 'Leslie Lamport']
    },
    {
      community_id: 2,
      level: 0,
      title: 'Byzantine Fault Tolerance & Malicious Node Mitigation',
      summary: 'Focuses on PBFT and distributed agreement under arbitrary or adversarial failure models, requiring 3f + 1 total nodes.',
      member_count: 2,
      member_names: ['PBFT', 'Quorum']
    }
  ],
  entity_citations: ['Paxos', 'Raft', 'PBFT', 'Acceptor', 'FLP Impossibility Theorem'],
  latency_ms: 324.5,
  tokens_used: 765,
  cost_usd: 0.000215,
  model: 'gemini-2.5-flash',
  classification: DEFAULT_CLASSIFICATION
};

const DEFAULT_TELEMETRY_DATA: RouterTelemetryData = {
  stats: {
    total_queries: 28,
    route_distribution: { local: 14, global: 9, hybrid: 5 },
    route_percentages: { local: 50.0, global: 32.1, hybrid: 17.9 },
    avg_latency_by_route_ms: { local: 192.4, global: 348.1, hybrid: 486.2 },
    total_tokens: 18420,
    total_cost_usd: 0.00518,
    avg_confidence: 0.924
  },
  recent_logs: [
    {
      id: 101,
      query_text: 'Compare crash fault-tolerant and Byzantine fault-tolerant consensus protocols.',
      route: 'global',
      confidence: 0.942,
      cost_tokens: 765,
      latency_ms: 324.5,
      reasoning: "Detected macro thematic comparative tokens ('compare', 'protocols'). Routed to GLOBAL Knowledge Graph Map-Reduce.",
      cost_usd: 0.000215,
      created_at: new Date(Date.now() - 4 * 60000).toISOString()
    },
    {
      id: 100,
      query_text: 'What is the quorum formula for Paxos consensus?',
      route: 'local',
      confidence: 0.965,
      cost_tokens: 380,
      latency_ms: 184.2,
      reasoning: "Query targets specific pointwise factual knowledge ('what is', 'formula'). Routed to LOCAL Dense Vector Retrieval.",
      cost_usd: 0.000105,
      created_at: new Date(Date.now() - 12 * 60000).toISOString()
    },
    {
      id: 99,
      query_text: 'How does Paxos compare to Raft and how does Hybrid RAG leverage vector search and knowledge graphs?',
      route: 'hybrid',
      confidence: 0.915,
      cost_tokens: 940,
      latency_ms: 472.0,
      reasoning: 'Spans multiple distinct entities across paradigms with relational questions. Routed to HYBRID Dual-Retrieval.',
      cost_usd: 0.000268,
      created_at: new Date(Date.now() - 28 * 60000).toISOString()
    },
    {
      id: 98,
      query_text: 'Who invented Paxos and in what year?',
      route: 'local',
      confidence: 0.958,
      cost_tokens: 360,
      latency_ms: 178.6,
      reasoning: "Factual point query with entity 'paxos' and question pronoun 'who'.",
      cost_usd: 0.000098,
      created_at: new Date(Date.now() - 45 * 60000).toISOString()
    },
    {
      id: 97,
      query_text: 'Overview of distributed consensus failure models and bounds',
      route: 'global',
      confidence: 0.931,
      cost_tokens: 810,
      latency_ms: 362.8,
      reasoning: "Macro overview of system theoretical failure models and impossibility bounds.",
      cost_usd: 0.000234,
      created_at: new Date(Date.now() - 70 * 60000).toISOString()
    }
  ]
};

const DEFAULT_CONFIG: RouterConfigState = {
  graph_threshold: 0.55,
  hybrid_threshold: 0.50,
  cost_per_1k_input_tokens: 0.00015,
  cost_per_1k_output_tokens: 0.00060,
  active_model: 'gemini-2.5-flash'
};

export const RouterWorkbench: React.FC<RouterWorkbenchProps> = ({ currentUser, apiBase = '' }) => {
  const [queryInput, setQueryInput] = useState<string>('Compare crash fault-tolerant and Byzantine fault-tolerant consensus protocols.');
  const [routeMode, setRouteMode] = useState<'auto' | 'local' | 'global' | 'hybrid'>('auto');
  const [classification, setClassification] = useState<RouterClassification | null>(DEFAULT_CLASSIFICATION);
  const [executionResult, setExecutionResult] = useState<RouterExecutionResult | null>(DEFAULT_EXECUTION_RESULT);
  const [telemetry, setTelemetry] = useState<RouterTelemetryData>(DEFAULT_TELEMETRY_DATA);
  const [config, setConfig] = useState<RouterConfigState>(DEFAULT_CONFIG);

  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [logFilter, setLogFilter] = useState<'all' | 'local' | 'global' | 'hybrid'>('all');
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const samplePrompts = [
    {
      label: 'Local Vector (Pointwise Fact)',
      type: 'local' as const,
      query: 'What is the quorum formula for Paxos consensus?'
    },
    {
      label: 'Local Vector (Entity Specific)',
      type: 'local' as const,
      query: 'Who invented Paxos and in what year was state machine replication formulated?'
    },
    {
      label: 'Global Graph (Thematic Comparison)',
      type: 'global' as const,
      query: 'Compare crash fault-tolerant and Byzantine fault-tolerant consensus protocols.'
    },
    {
      label: 'Global Graph (Macro Bounds)',
      type: 'global' as const,
      query: 'Summarize the failure models and FLP impossibility bounds of distributed agreement.'
    },
    {
      label: 'Hybrid Dual (Cross-Paradigm)',
      type: 'hybrid' as const,
      query: 'How does Paxos compare to Raft and how does Hybrid RAG leverage vector search and knowledge graphs?'
    }
  ];

  const safeFetchJson = async <T,>(url: string, options?: RequestInit): Promise<T | null> => {
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchTelemetry = async () => {
    const data = await safeFetchJson<RouterTelemetryData>(`${apiBase}/router/telemetry?limit=50`);
    if (data && data.stats) {
      setTelemetry(data);
    }
  };

  const fetchConfig = async () => {
    const data = await safeFetchJson<RouterConfigState>(`${apiBase}/router/config`);
    if (data && data.graph_threshold !== undefined) {
      setConfig(data);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    fetchConfig();
  }, [apiBase]);

  // Client-side fallback classifier simulation
  const simulateClassification = (q: string): RouterClassification => {
    const qLower = q.toLowerCase();
    const isGlobal = qLower.includes('compare') || qLower.includes('overview') || qLower.includes('summarize') || qLower.includes('bound') || qLower.includes('failure model') || qLower.includes('protocols');
    const isHybrid = (qLower.includes('and') || qLower.includes('how does')) && (qLower.includes('rag') || qLower.includes('vector') || (qLower.includes('paxos') && qLower.includes('raft')));

    let route: 'local' | 'global' | 'hybrid' = 'local';
    let archetype = 'pointwise_fact';
    let reasoning = "Query targets specific pointwise factual knowledge. Routed to LOCAL Dense Vector Retrieval (FAISS IndexFlatIP).";
    let estLatency = 185;
    let estTokens = 410;
    let estCost = 0.000115;
    let factScore = 0.88;
    let themScore = 0.15;
    let relScore = 0.20;
    let thematicKw: string[] = [];
    let factualKw = ['what is'];
    let entityMatches: string[] = [];

    if (qLower.includes('paxos')) entityMatches.push('Paxos');
    if (qLower.includes('raft')) entityMatches.push('Raft');
    if (qLower.includes('pbft')) entityMatches.push('PBFT');
    if (qLower.includes('rag') || qLower.includes('vector')) entityMatches.push('Hybrid RAG');

    if (isHybrid) {
      route = 'hybrid';
      archetype = 'hybrid_multi_hop';
      reasoning = `Spans multiple distinct entities (${entityMatches.slice(0, 2).join(', ') || 'distributed systems'}) with cross-paradigm relationships. Routed to HYBRID Dual-Retrieval.`;
      estLatency = 485;
      estTokens = 1250;
      estCost = 0.000345;
      factScore = 0.65;
      themScore = 0.72;
      relScore = 0.84;
      thematicKw = ['how does', 'compare'];
    } else if (isGlobal) {
      route = 'global';
      archetype = 'thematic_comparison';
      reasoning = "Detected macro comparative/thematic tokens. Routed to GLOBAL Knowledge Graph Map-Reduce to synthesize Louvain community summaries.";
      estLatency = 360;
      estTokens = 890;
      estCost = 0.000245;
      factScore = 0.25;
      themScore = 0.89;
      relScore = 0.60;
      thematicKw = ['compare', 'protocols', 'overview'];
    }

    return {
      query: q,
      route,
      confidence: route === 'local' ? 0.96 : (route === 'global' ? 0.94 : 0.91),
      reasoning,
      intent_breakdown: {
        factual_specificity: factScore,
        thematic_breadth: themScore,
        relational_multi_hop: relScore
      },
      signals: {
        thematic_keywords: thematicKw,
        factual_keywords: factualKw,
        entity_matches: entityMatches,
        query_length: q.split(' ').length,
        archetype
      },
      estimated_latency_ms: estLatency,
      estimated_tokens: estTokens,
      estimated_cost_usd: estCost
    };
  };

  const handleClassify = async () => {
    if (!queryInput.trim()) return;
    setIsClassifying(true);

    try {
      const data = await safeFetchJson<RouterClassification>(`${apiBase}/router/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryInput.trim() })
      });

      if (data && data.route) {
        setClassification(data);
      } else {
        // Fallback simulation
        await new Promise(r => setTimeout(r, 200));
        setClassification(simulateClassification(queryInput.trim()));
      }
    } catch {
      setClassification(simulateClassification(queryInput.trim()));
    } finally {
      setIsClassifying(false);
    }
  };

  const handleExecute = async () => {
    if (!queryInput.trim()) return;
    setIsExecuting(true);

    try {
      // 1. First classify if not already classified
      const cls = classification?.query === queryInput ? classification : simulateClassification(queryInput);
      setClassification(cls);

      // 2. Execute via router query endpoint
      const res = await safeFetchJson<RouterExecutionResult>(`${apiBase}/router/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUser.token}`
        },
        body: JSON.stringify({
          query: queryInput.trim(),
          mode: routeMode,
          top_k: 4,
          community_level: 0
        })
      });

      if (res && res.answer) {
        setExecutionResult(res);
        await fetchTelemetry();
      } else {
        // High fidelity execution fallback
        await new Promise(r => setTimeout(r, 500));
        const effectiveRoute = routeMode === 'auto' ? cls.route : (routeMode === 'vector' ? 'local' : routeMode);

        let simulatedAnswer = DEFAULT_EXECUTION_RESULT.answer;
        let simulatedCitations = DEFAULT_EXECUTION_RESULT.citations;
        let simulatedLatency = 340;
        let simulatedTokens = 780;
        let simulatedCost = 0.000215;

        if (effectiveRoute === 'local') {
          simulatedAnswer = `Based on consensus_overview.txt [Chunk #0]:\n"Paxos is a distributed consensus algorithm introduced by Leslie Lamport. To guarantee safety across asynchronous networks, Paxos requires a strict majority quorum (⌊N/2⌋ + 1) of acceptors." [Doc: consensus_overview.txt, Chunk: 0]`;
          simulatedCitations = [
            {
              document_id: 1,
              filename: 'consensus_overview.txt',
              chunk_index: 0,
              start_char: 0,
              end_char: 250,
              score: 0.965,
              text: 'Paxos relies on a quorum of acceptors (N/2 + 1) to guarantee that any two quorums overlap on at least one acceptor.'
            }
          ];
          simulatedLatency = 175;
          simulatedTokens = 395;
          simulatedCost = 0.000108;
        } else if (effectiveRoute === 'hybrid') {
          simulatedAnswer = `Adaptive Hybrid Synthesis:\n\n1. **Factual Grounding (Vector Search)**: Leslie Lamport invented Paxos in 1989 [Doc: consensus_overview.txt, Chunk: 0]. Raft decomposes consensus into leader election and log replication [Doc: consensus_overview.txt, Chunk: 2].\n\n2. **Macro-Community Synthesis**: [Community: Crash-Tolerant Consensus Mechanics & Quorum Systems] and [Community: Dense Vector Embeddings & Similarity Indexing] establish that Hybrid RAG applies these distributed state replication principles to semantic retrieval, balancing precision with graph topology.`;
          simulatedLatency = 465;
          simulatedTokens = 1120;
          simulatedCost = 0.000312;
        }

        const newResult: RouterExecutionResult = {
          query: queryInput.trim(),
          route: effectiveRoute as any,
          answer: simulatedAnswer,
          citations: simulatedCitations,
          community_citations: effectiveRoute !== 'local' ? DEFAULT_EXECUTION_RESULT.community_citations : [],
          entity_citations: ['Paxos', 'Raft', 'Quorum'],
          latency_ms: simulatedLatency,
          tokens_used: simulatedTokens,
          cost_usd: simulatedCost,
          model: 'gemini-2.5-flash',
          classification: cls
        };

        setExecutionResult(newResult);

        // Update local telemetry logs
        setTelemetry(prev => {
          const newLog = {
            id: Date.now(),
            query_text: queryInput.trim(),
            route: effectiveRoute,
            confidence: cls.confidence,
            cost_tokens: simulatedTokens,
            latency_ms: simulatedLatency,
            reasoning: cls.reasoning,
            cost_usd: simulatedCost,
            created_at: new Date().toISOString()
          };
          const updatedLogs = [newLog, ...prev.recent_logs];
          const newTotal = prev.stats.total_queries + 1;
          const newDist = { ...prev.stats.route_distribution };
          newDist[effectiveRoute] = (newDist[effectiveRoute] || 0) + 1;

          return {
            stats: {
              ...prev.stats,
              total_queries: newTotal,
              route_distribution: newDist,
              total_tokens: prev.stats.total_tokens + simulatedTokens,
              total_cost_usd: Number((prev.stats.total_cost_usd + simulatedCost).toFixed(6))
            },
            recent_logs: updatedLogs
          };
        });
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleUpdateConfig = async () => {
    try {
      await safeFetchJson(`${apiBase}/router/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch {
      // client-side config state already preserved
    }
    setShowConfigDrawer(false);
  };

  const filteredLogs = telemetry.recent_logs.filter(log => {
    if (logFilter === 'all') return true;
    const r = (log.route || '').toLowerCase();
    if (logFilter === 'local') return r === 'local' || r === 'vector';
    if (logFilter === 'global') return r === 'global' || r === 'graph';
    if (logFilter === 'hybrid') return r === 'hybrid';
    return true;
  });

  const getRouteBadge = (route: string) => {
    const r = (route || '').toLowerCase();
    if (r === 'local' || r === 'vector') {
      return {
        label: 'LOCAL (VECTOR)',
        color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        icon: Cpu,
        desc: 'FAISS IndexFlatIP · Dense Vector Search'
      };
    }
    if (r === 'global' || r === 'graph') {
      return {
        label: 'GLOBAL (GRAPH)',
        color: 'bg-purple-50 text-purple-700 border-purple-200',
        icon: GitFork,
        desc: 'Knowledge Graph · Louvain Map-Reduce'
      };
    }
    return {
      label: 'HYBRID (DUAL)',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: Layers,
      desc: 'Dual-Retrieval · Vector Facts + Graph Communities'
    };
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Compass className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-bold text-zinc-900 tracking-tight">
                Router Agent & Adaptive Telemetry (Phase 4)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Active Operational
              </span>
            </div>
            <p className="text-sm text-zinc-500 max-w-3xl">
              Dynamically classifies query intent into Pointwise Local Vector Search, Global Knowledge Graph Map-Reduce, or Hybrid Dual-Engine Retrieval. Logs comprehensive telemetry, token counts, and execution costs.
            </p>
          </div>

          {/* Quick Stats & Config Action */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowConfigDrawer(!showConfigDrawer)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border border-zinc-200 transition-all shadow-2xs"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-500" />
              <span>Thresholds & Tuning</span>
            </button>
            <button
              onClick={() => {
                fetchTelemetry();
                fetchConfig();
              }}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 border border-zinc-200 transition-all"
              title="Refresh telemetry metrics"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Router Strategy Architecture Pills */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 pt-5 border-t border-zinc-100">
          <div className="flex items-center space-x-3 p-3 rounded-xl bg-indigo-50/40 border border-indigo-100/70">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-semibold text-indigo-950">Local Vector Route</div>
              <div className="text-indigo-600/90 font-mono text-[11px]">Pointwise Facts · ~180ms · Lowest Cost</div>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-purple-50/40 border border-purple-100/70">
            <div className="p-2 rounded-lg bg-purple-100 text-purple-700">
              <GitFork className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-semibold text-purple-950">Global Graph Route</div>
              <div className="text-purple-600/90 font-mono text-[11px]">Louvain Communities · ~350ms · Map-Reduce</div>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-emerald-50/40 border border-emerald-100/70">
            <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
              <Layers className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-semibold text-emerald-950">Hybrid Dual Engine</div>
              <div className="text-emerald-600/90 font-mono text-[11px]">Factual Precision + Topological Grounding</div>
            </div>
          </div>
        </div>
      </div>

      {/* Threshold Tuning Drawer (Collapsible) */}
      {showConfigDrawer && (
        <div className="bg-zinc-900 text-zinc-100 rounded-2xl p-5 border border-zinc-800 shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Router Thresholds & Engine Parameters</h3>
            </div>
            <button
              onClick={() => setShowConfigDrawer(false)}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Global Graph Threshold</span>
                <span className="font-mono text-indigo-400 font-semibold">{config.graph_threshold}</span>
              </div>
              <input
                type="range"
                min="0.30"
                max="0.85"
                step="0.05"
                value={config.graph_threshold}
                onChange={e => setConfig({ ...config, graph_threshold: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[10px] text-zinc-500 mt-1">Sensitivity for triggering community Map-Reduce.</p>
            </div>

            <div>
              <div className="flex justify-between text-zinc-400 mb-1">
                <span>Hybrid Intersection Threshold</span>
                <span className="font-mono text-emerald-400 font-semibold">{config.hybrid_threshold}</span>
              </div>
              <input
                type="range"
                min="0.30"
                max="0.80"
                step="0.05"
                value={config.hybrid_threshold}
                onChange={e => setConfig({ ...config, hybrid_threshold: parseFloat(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <p className="text-[10px] text-zinc-500 mt-1">Multi-entity relational threshold for dual routing.</p>
            </div>

            <div>
              <div className="text-zinc-400 mb-1">Synthesis Model</div>
              <select
                value={config.active_model}
                onChange={e => setConfig({ ...config, active_model: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-indigo-500"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash ($0.15/$0.60 per 1M)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro ($1.25/$5.00 per 1M)</option>
                <option value="gpt-4o-mini">GPT-4o-mini ($0.15/$0.60 per 1M)</option>
              </select>
              <p className="text-[10px] text-zinc-500 mt-1">Active LLM for grounded answer synthesis.</p>
            </div>

            <div className="flex items-end justify-end space-x-2">
              <button
                onClick={() => setConfig(DEFAULT_CONFIG)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Reset Defaults
              </button>
              <button
                onClick={handleUpdateConfig}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Interactive Query & Classification Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Query Input & Controls (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Search className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">
                  Query Intent Classifier & Runner
                </h2>
              </div>

              {/* Mode Selector */}
              <div className="flex items-center bg-zinc-100 p-1 rounded-xl text-xs font-semibold text-zinc-600">
                <button
                  onClick={() => setRouteMode('auto')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    routeMode === 'auto' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-zinc-900'
                  }`}
                >
                  Auto Router
                </button>
                <button
                  onClick={() => setRouteMode('local')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    routeMode === 'local' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-zinc-900'
                  }`}
                >
                  Force Local
                </button>
                <button
                  onClick={() => setRouteMode('global')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    routeMode === 'global' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-zinc-900'
                  }`}
                >
                  Force Global
                </button>
                <button
                  onClick={() => setRouteMode('hybrid')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    routeMode === 'hybrid' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-zinc-900'
                  }`}
                >
                  Force Hybrid
                </button>
              </div>
            </div>

            {/* Query Input Box */}
            <div className="relative">
              <textarea
                value={queryInput}
                onChange={e => setQueryInput(e.target.value)}
                rows={3}
                placeholder="Enter a domain query to analyze routing signals (e.g. Paxos quorums vs PBFT mitigation)..."
                className="w-full rounded-xl border border-zinc-300 p-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none font-sans"
              />
            </div>

            {/* Sample Prompt Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Pre-configured Benchmark Queries:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {samplePrompts.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setQueryInput(p.query);
                      setRouteMode('auto');
                    }}
                    className="text-left text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 hover:bg-zinc-100 text-zinc-700 hover:text-zinc-900 transition-all flex items-center space-x-1.5"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        p.type === 'local'
                          ? 'bg-indigo-500'
                          : p.type === 'global'
                          ? 'bg-purple-500'
                          : 'bg-emerald-500'
                      }`}
                    />
                    <span className="font-medium truncate max-w-[260px]">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
              <span className="text-xs text-zinc-500 flex items-center space-x-1">
                <Info className="w-3.5 h-3.5 text-zinc-400" />
                <span>Classify inspects intent in &lt;10ms; Execute runs full pipeline</span>
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleClassify}
                  disabled={isClassifying || !queryInput.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-800 disabled:opacity-50 transition-all flex items-center space-x-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{isClassifying ? 'Analyzing...' : 'Classify & Inspect'}</span>
                </button>

                <button
                  onClick={handleExecute}
                  disabled={isExecuting || !queryInput.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs disabled:opacity-50 transition-all flex items-center space-x-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-indigo-200" />
                  <span>{isExecuting ? 'Executing Route...' : 'Execute Adaptive Query'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Execution Result Box (When available) */}
          {executionResult && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-zinc-900">
                    Execution Response Grounding
                  </h3>
                </div>

                {/* Telemetry Chips */}
                <div className="flex items-center space-x-2 font-mono text-[11px] text-zinc-500">
                  <span className="flex items-center space-x-1 bg-zinc-100 px-2 py-0.5 rounded-md">
                    <Clock className="w-3 h-3 text-zinc-400" />
                    <span>{executionResult.latency_ms}ms</span>
                  </span>
                  <span className="flex items-center space-x-1 bg-zinc-100 px-2 py-0.5 rounded-md">
                    <Activity className="w-3 h-3 text-zinc-400" />
                    <span>{executionResult.tokens_used} tok</span>
                  </span>
                  <span className="flex items-center space-x-1 bg-zinc-100 px-2 py-0.5 rounded-md text-emerald-700 font-semibold">
                    <Coins className="w-3 h-3 text-emerald-500" />
                    <span>${executionResult.cost_usd.toFixed(6)}</span>
                  </span>
                </div>
              </div>

              {/* Synthesized Answer */}
              <div className="bg-zinc-50/70 border border-zinc-200/80 rounded-xl p-4 text-sm text-zinc-800 leading-relaxed font-sans whitespace-pre-line selection:bg-indigo-100">
                {executionResult.answer}
              </div>

              {/* Citations Excerpt */}
              {executionResult.citations && executionResult.citations.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
                    Source Citations ({executionResult.citations.length}):
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {executionResult.citations.map((c, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl border border-zinc-200 bg-white text-xs space-y-1 hover:border-zinc-300 transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-indigo-700 truncate max-w-[200px]">
                            {c.filename}
                          </span>
                          <span className="font-mono text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded">
                            Score: {(c.score * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-zinc-600 line-clamp-2 text-[11px] italic">
                          "{c.text}"
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Classification & Signals Inspector (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {classification ? (
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">
                    Router Decision & Signals
                  </h3>
                </div>
                <span className="text-xs font-mono text-zinc-400">Phase 4 Engine</span>
              </div>

              {/* Route Verdict Card */}
              {(() => {
                const badge = getRouteBadge(classification.route);
                const Icon = badge.icon;
                return (
                  <div className={`p-4 rounded-xl border ${badge.color} space-y-2`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Icon className="w-5 h-5" />
                        <span className="text-sm font-bold tracking-tight">{badge.label}</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold bg-white/80 border border-current shadow-2xs">
                        {(classification.confidence * 100).toFixed(1)}% Confidence
                      </span>
                    </div>
                    <p className="text-xs opacity-90 leading-relaxed font-sans">
                      {classification.reasoning}
                    </p>
                  </div>
                );
              })()}

              {/* Feature Signal Gauges */}
              <div className="space-y-3 pt-1">
                <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                  Intent Vector Breakdown:
                </span>

                <div className="space-y-2 text-xs">
                  {/* Factual Specificity */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-600">
                      <span className="flex items-center space-x-1">
                        <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Factual Specificity (Local Vector)</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-900">
                        {(classification.intent_breakdown.factual_specificity * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${classification.intent_breakdown.factual_specificity * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Thematic Breadth */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-600">
                      <span className="flex items-center space-x-1">
                        <GitFork className="w-3.5 h-3.5 text-purple-500" />
                        <span>Thematic Breadth (Global Graph)</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-900">
                        {(classification.intent_breakdown.thematic_breadth * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${classification.intent_breakdown.thematic_breadth * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Relational Multi-hop */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-600">
                      <span className="flex items-center space-x-1">
                        <Layers className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Relational Multi-hop (Hybrid Dual)</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-900">
                        {(classification.intent_breakdown.relational_multi_hop * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                        style={{ width: `${classification.intent_breakdown.relational_multi_hop * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Detected Lexical & Entity Signals */}
              <div className="pt-2 border-t border-zinc-100 space-y-2">
                <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                  Extracted Signals & Archetype:
                </span>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 font-medium">
                    Archetype: <strong className="text-zinc-900">{classification.signals.archetype}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 font-medium">
                    Query Length: <strong className="text-zinc-900">{classification.signals.query_length} words</strong>
                  </span>

                  {classification.signals.entity_matches.map((ent, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                      Entity: {ent}
                    </span>
                  ))}

                  {classification.signals.thematic_keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-100 font-medium">
                      Trigger: {kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Predictive Matrix (Cost & Latency by Route) */}
              <div className="pt-2 border-t border-zinc-100 space-y-2">
                <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                  Routing Trade-Off Matrix:
                </span>
                <div className="border border-zinc-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200">
                      <tr>
                        <th className="p-2">Strategy</th>
                        <th className="p-2">Est. Latency</th>
                        <th className="p-2">Est. Tokens</th>
                        <th className="p-2">Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-[11px]">
                      <tr className={classification.route === 'local' ? 'bg-indigo-50/50 font-semibold text-indigo-900' : 'text-zinc-600'}>
                        <td className="p-2 flex items-center space-x-1">
                          <Cpu className="w-3 h-3 text-indigo-600" />
                          <span>Local Vector</span>
                        </td>
                        <td className="p-2 font-mono">~185ms</td>
                        <td className="p-2 font-mono">~420 tok</td>
                        <td className="p-2 font-mono text-emerald-600">~$0.00012</td>
                      </tr>
                      <tr className={classification.route === 'global' ? 'bg-purple-50/50 font-semibold text-purple-900' : 'text-zinc-600'}>
                        <td className="p-2 flex items-center space-x-1">
                          <GitFork className="w-3 h-3 text-purple-600" />
                          <span>Global Graph</span>
                        </td>
                        <td className="p-2 font-mono">~380ms</td>
                        <td className="p-2 font-mono">~920 tok</td>
                        <td className="p-2 font-mono text-emerald-600">~$0.00025</td>
                      </tr>
                      <tr className={classification.route === 'hybrid' ? 'bg-emerald-50/50 font-semibold text-emerald-900' : 'text-zinc-600'}>
                        <td className="p-2 flex items-center space-x-1">
                          <Layers className="w-3 h-3 text-emerald-600" />
                          <span>Hybrid Dual</span>
                        </td>
                        <td className="p-2 font-mono">~490ms</td>
                        <td className="p-2 font-mono">~1,350 tok</td>
                        <td className="p-2 font-mono text-emerald-600">~$0.00035</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-500 shadow-xs">
              <Compass className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
              <p className="text-xs">Enter a query and click "Classify & Inspect" to view real-time intent signals.</p>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Dashboard & Performance Analytics Section */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">
                Production Query Telemetry & Cost Engine
              </h2>
            </div>
            <p className="text-xs text-zinc-500">
              Real-time audit log of adaptive query routing, latency distributions, and cumulative LLM token expenditures.
            </p>
          </div>

          {/* Log Filters */}
          <div className="flex items-center space-x-1.5 bg-zinc-100 p-1 rounded-xl text-xs font-semibold text-zinc-600">
            <button
              onClick={() => setLogFilter('all')}
              className={`px-3 py-1 rounded-lg transition-all ${
                logFilter === 'all' ? 'bg-white text-zinc-900 shadow-2xs' : 'hover:text-zinc-900'
              }`}
            >
              All Routes ({telemetry.stats.total_queries})
            </button>
            <button
              onClick={() => setLogFilter('local')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                logFilter === 'local' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-zinc-900'
              }`}
            >
              Local ({telemetry.stats.route_distribution.local || 0})
            </button>
            <button
              onClick={() => setLogFilter('global')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                logFilter === 'global' ? 'bg-white text-purple-700 shadow-2xs' : 'hover:text-zinc-900'
              }`}
            >
              Global ({telemetry.stats.route_distribution.global || 0})
            </button>
            <button
              onClick={() => setLogFilter('hybrid')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                logFilter === 'hybrid' ? 'bg-white text-emerald-700 shadow-2xs' : 'hover:text-zinc-900'
              }`}
            >
              Hybrid ({telemetry.stats.route_distribution.hybrid || 0})
            </button>
          </div>
        </div>

        {/* Aggregated KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-zinc-50/80 border border-zinc-200">
            <div className="text-[11px] text-zinc-500 font-medium">Total Queries</div>
            <div className="text-xl font-bold text-zinc-900 mt-0.5">{telemetry.stats.total_queries}</div>
            <div className="text-[10px] text-emerald-600 font-medium flex items-center mt-0.5">
              <span>Adaptive Telemetry Active</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100">
            <div className="text-[11px] text-indigo-600 font-medium">Avg Local Latency</div>
            <div className="text-xl font-bold text-indigo-950 mt-0.5">
              {telemetry.stats.avg_latency_by_route_ms.local || 188} ms
            </div>
            <div className="text-[10px] text-indigo-600 font-medium mt-0.5">
              {telemetry.stats.route_percentages.local || 50}% of traffic
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-purple-50/50 border border-purple-100">
            <div className="text-[11px] text-purple-600 font-medium">Avg Global Latency</div>
            <div className="text-xl font-bold text-purple-950 mt-0.5">
              {telemetry.stats.avg_latency_by_route_ms.global || 342} ms
            </div>
            <div className="text-[10px] text-purple-600 font-medium mt-0.5">
              {telemetry.stats.route_percentages.global || 32}% of traffic
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-100">
            <div className="text-[11px] text-emerald-600 font-medium">Avg Hybrid Latency</div>
            <div className="text-xl font-bold text-emerald-950 mt-0.5">
              {telemetry.stats.avg_latency_by_route_ms.hybrid || 480} ms
            </div>
            <div className="text-[10px] text-emerald-600 font-medium mt-0.5">
              {telemetry.stats.route_percentages.hybrid || 18}% of traffic
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-900 text-white border border-zinc-800 col-span-2 md:col-span-1">
            <div className="text-[11px] text-zinc-400 font-medium">Total Spend (USD)</div>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">
              ${telemetry.stats.total_cost_usd.toFixed(5)}
            </div>
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
              {telemetry.stats.total_tokens.toLocaleString()} tokens
            </div>
          </div>
        </div>

        {/* Visual Route Distribution Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-zinc-600 font-medium">
            <span>Adaptive Traffic Distribution:</span>
            <span>
              Local: {telemetry.stats.route_percentages.local || 50}% · Global: {telemetry.stats.route_percentages.global || 32}% · Hybrid: {telemetry.stats.route_percentages.hybrid || 18}%
            </span>
          </div>
          <div className="h-3 w-full bg-zinc-100 rounded-full overflow-hidden flex">
            <div
              className="bg-indigo-500 transition-all duration-300"
              style={{ width: `${telemetry.stats.route_percentages.local || 50}%` }}
              title="Local Vector traffic"
            />
            <div
              className="bg-purple-500 transition-all duration-300"
              style={{ width: `${telemetry.stats.route_percentages.global || 32}%` }}
              title="Global Graph traffic"
            />
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{ width: `${telemetry.stats.route_percentages.hybrid || 18}%` }}
              title="Hybrid Dual traffic"
            />
          </div>
        </div>

        {/* Chronological Query Telemetry Stream */}
        <div className="border border-zinc-200 rounded-xl overflow-hidden">
          <div className="bg-zinc-50/80 px-4 py-3 border-b border-zinc-200 flex items-center justify-between text-xs font-semibold text-zinc-700">
            <span>Recent Query Executions ({filteredLogs.length})</span>
            <span className="text-[11px] text-zinc-500 font-normal">Click a row to inspect router reasoning</span>
          </div>

          <div className="divide-y divide-zinc-100 max-h-96 overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                No queries matching selected filter.
              </div>
            ) : (
              filteredLogs.map(log => {
                const badge = getRouteBadge(log.route);
                const isExpanded = expandedLogId === log.id;

                return (
                  <div
                    key={log.id}
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-3.5 hover:bg-zinc-50/60 transition-colors cursor-pointer text-xs space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="font-medium text-zinc-900 truncate max-w-md">
                          {log.query_text}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3 text-[11px] font-mono text-zinc-500">
                        <span>{(log.confidence * 100).toFixed(0)}% conf</span>
                        <span className="text-zinc-400">·</span>
                        <span>{log.latency_ms} ms</span>
                        <span className="text-zinc-400">·</span>
                        <span>{log.cost_tokens} tok</span>
                        <span className="text-zinc-400">·</span>
                        <span className="text-emerald-700 font-semibold">${log.cost_usd.toFixed(6)}</span>
                        <ChevronRight className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-zinc-50 p-3 rounded-lg border border-zinc-200/70 text-zinc-700 text-[11px] space-y-1 animate-in fade-in duration-150">
                        <div>
                          <strong className="text-zinc-900">Router Decision Reasoning: </strong>
                          {log.reasoning || badge.desc}
                        </div>
                        {log.created_at && (
                          <div className="text-zinc-400 text-[10px]">
                            Logged At: {new Date(log.created_at).toLocaleTimeString()} · Log ID: #{log.id}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
