import React from 'react';
import { X, AlertTriangle, Coins, Zap, ShieldAlert, CheckCircle2, Key } from 'lucide-react';

interface CostAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CostAnalysisModal: React.FC<CostAnalysisModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-zinc-200">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs z-10">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-zinc-900">
                PRD Cost & Token Consumption Analysis
              </h3>
              <p className="text-xs text-zinc-500">
                Architectural flags, risk mitigation, and recommended dev testing strategies
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-xs text-zinc-700">
          {/* Flagged Expensive Sections */}
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4">
            <div className="flex items-center space-x-2 text-amber-900 font-bold mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Flagged Expensive Sections in PRD (Tokens & Latency)</span>
            </div>
            <ul className="space-y-2 text-amber-950 leading-relaxed">
              <li className="flex items-start space-x-2">
                <span className="font-bold text-amber-700">•</span>
                <div>
                  <strong className="font-semibold">Phase 3: Per-Chunk Entity & Relationship Extraction:</strong>{' '}
                  Running an LLM over every text chunk to extract entities/edges generates <em>O(N_chunks)</em> LLM API calls. For a 30-page document (~40 chunks), that is 40 sequential or parallel LLM extraction calls (~60,000–80,000 tokens).
                </div>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-bold text-amber-700">•</span>
                <div>
                  <strong className="font-semibold">Phase 3: Hierarchical Community Summarization:</strong>{' '}
                  Generating summaries for detected entity communities requires aggregating member text and prompting for synthesis. On large corpora with 10+ communities, this adds significant initial ingestion time and cost.
                </div>
              </li>
              <li className="flex items-start space-x-2">
                <span className="font-bold text-amber-700">•</span>
                <div>
                  <strong className="font-semibold">Phase 3 & 4: Global Query Map-Reduce:</strong>{' '}
                  Global queries evaluate each community summary in parallel (Map) and combine them into a final answer (Reduce). This consumes ~10x to 15x more tokens per question than vector search (~15,000 tokens vs. ~800 tokens).
                </div>
              </li>
            </ul>
          </div>

          {/* Recommended Cost-Saving Dev Strategies */}
          <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50">
            <h4 className="font-bold text-zinc-900 text-sm mb-2 flex items-center space-x-2">
              <Zap className="w-4 h-4 text-indigo-600" />
              <span>Cost-Effective Development & Testing Strategies</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div className="bg-white p-3 rounded-lg border border-zinc-200">
                <div className="font-bold text-zinc-900 mb-1">1. Micro Test Corpus</div>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Use curated 1–2 page test files (2–4 chunks) like <code className="text-indigo-600 font-mono">consensus_overview.md</code> during development.
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-zinc-200">
                <div className="font-bold text-zinc-900 mb-1">2. Extraction Caching</div>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Persist extracted entities & communities in SQLite so re-querying never re-triggers expensive extraction passes.
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-zinc-200">
                <div className="font-bold text-zinc-900 mb-1">3. Tiered Model Selection</div>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Use high-throughput, low-cost flash models (Gemini Flash, Claude Haiku, or GPT-4o-mini) for extraction and routing.
                </p>
              </div>
            </div>
          </div>

          {/* LLM Provider Configuration */}
          <div className="border border-zinc-200 rounded-xl p-4 bg-white">
            <h4 className="font-bold text-zinc-900 text-sm mb-2 flex items-center space-x-2">
              <Key className="w-4 h-4 text-emerald-600" />
              <span>LLM Provider & API Key Setup</span>
            </h4>
            <p className="text-zinc-600 leading-relaxed mb-3">
              The PRD specifies using Claude API or OpenAI API (or Gemini). In this environment:
            </p>
            <div className="space-y-2 font-mono text-[11px]">
              <div className="bg-zinc-50 p-2.5 rounded border border-zinc-200 flex justify-between items-center">
                <span className="text-zinc-800">GEMINI_API_KEY</span>
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-sans text-[10px] font-bold border border-emerald-200">
                  Pre-configured in AI Studio runtime
                </span>
              </div>
              <div className="bg-zinc-50 p-2.5 rounded border border-zinc-200 flex justify-between items-center">
                <span className="text-zinc-800">OPENAI_API_KEY</span>
                <span className="text-zinc-500 font-sans text-[10px]">
                  Configured via .env or Secrets if chosen
                </span>
              </div>
              <div className="bg-zinc-50 p-2.5 rounded border border-zinc-200 flex justify-between items-center">
                <span className="text-zinc-800">ANTHROPIC_API_KEY</span>
                <span className="text-zinc-500 font-sans text-[10px]">
                  Configured via .env or Secrets if chosen
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-zinc-50 border-t border-zinc-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};
