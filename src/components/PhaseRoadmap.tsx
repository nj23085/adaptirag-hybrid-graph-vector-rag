import React from 'react';
import { CheckCircle2, Circle, ArrowRight, Layers, Cpu, GitFork, Compass, Monitor, Sparkles } from 'lucide-react';

export const PhaseRoadmap: React.FC = () => {
  const phases = [
    {
      num: 1,
      title: 'Backend Skeleton',
      desc: 'FastAPI, SQLite, JWT Auth, PDF/DOCX/TXT/MD Ingestion & Chunking',
      status: 'completed',
      icon: Layers,
    },
    {
      num: 2,
      title: 'Vector Pipeline',
      desc: 'Embeddings + FAISS IndexFlatIP + /query grounded factual search',
      status: 'completed',
      icon: Cpu,
    },
    {
      num: 3,
      title: 'Graph Pipeline',
      desc: 'LLM entity/relationship extraction + networkx + Map-Reduce',
      status: 'completed',
      icon: GitFork,
    },
    {
      num: 4,
      title: 'Router Agent',
      desc: 'Adaptive query classification (local/global/hybrid) + telemetry & cost',
      status: 'completed',
      icon: Compass,
    },
    {
      num: 5,
      title: 'Frontend UI',
      desc: 'Integrated workbench, chat interface, citations & admin metrics',
      status: 'completed',
      icon: Monitor,
    },
    {
      num: 6,
      title: 'Production Polish',
      desc: 'Cost/latency trade-off harness & empirical evaluation suite',
      status: 'completed',
      icon: Sparkles,
    },
  ];

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-zinc-100 gap-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">
            PRD Implementation Sequence
          </h2>
          <p className="text-xs text-zinc-500">
            Current Status: All Phases (1 through 6) Fully Implemented & Verified Production-Ready
          </p>
        </div>
        <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 w-fit">
          6 of 6 Completed (All PRD Phases Operational)
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {phases.map((p) => {
          const Icon = p.icon;
          const isCompleted = p.status === 'completed';
          const isNext = p.status === 'next';

          return (
            <div
              key={p.num}
              className={`relative rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                isCompleted
                  ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-400/20'
                  : isNext
                  ? 'bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-400/20'
                  : 'bg-zinc-50/60 border-zinc-200/70 opacity-75'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      isCompleted
                        ? 'bg-emerald-200/70 text-emerald-800'
                        : isNext
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-zinc-200 text-zinc-600'
                    }`}
                  >
                    Phase {p.num}
                  </span>
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : isNext ? (
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-300" />
                  )}
                </div>
                <div className="flex items-center space-x-1.5 mb-1 text-zinc-900 font-semibold text-xs">
                  <Icon className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{p.title}</span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">{p.desc}</p>
              </div>

              <div className="mt-3 pt-2 border-t border-zinc-200/50">
                <span
                  className={`text-[10px] font-medium tracking-wide uppercase ${
                    isCompleted
                      ? 'text-emerald-700 font-bold'
                      : isNext
                      ? 'text-indigo-600 font-bold'
                      : 'text-zinc-400'
                  }`}
                >
                  {isCompleted ? '✓ Completed' : isNext ? '→ Next Up' : 'Queued'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

