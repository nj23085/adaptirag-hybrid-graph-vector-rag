import React, { useState } from 'react';
import { Terminal, Copy, Check, PlayCircle, Download, FolderArchive } from 'lucide-react';
import { downloadProjectZip } from '../utils/exportZip';

export const CliQuickstart: React.FC = () => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  const handleDownloadZip = async () => {
    setIsExporting(true);
    setDownloadSuccess(false);
    try {
      await downloadProjectZip();
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  const snippets = [
    {
      title: 'Ingest Any Document (.pdf, .docx, .txt, .md) via CLI',
      cmd: 'python3 query_cli.py --ingest path/to/your_document.pdf',
      desc: 'Extracts text, builds sliding-window chunks, syncs into FAISS vector store and constructs Knowledge Graph communities.',
    },
    {
      title: 'Ask Questions Grounded in Document via Adaptive Router',
      cmd: 'python3 query_cli.py --ask "What is the key finding in the document?"',
      desc: 'Automatically classifies query intent (pointwise local, thematic global, or hybrid) and returns grounded answers with exact bracket citations.',
    },
    {
      title: 'Start Backend Server (FastAPI + FAISS + GraphRAG)',
      cmd: 'cd backend && pip install -r requirements.txt && python3 -m uvicorn main:app --port 8000 --reload',
      desc: 'Boots the full backend API server providing vector search, community map-reduce, and telemetry logging.',
    },
    {
      title: 'Run Phase 2 Vector Pipeline & Grounded QA Test Suite',
      cmd: 'pytest -s -v backend/test_phase2.py',
      desc: 'Verifies FAISS IndexFlatIP, dense embeddings (Gemini/local), grounded generation, bracket citations, and query logging.',
    },
    {
      title: 'Run Phase 1 End-to-End Automated Test Suite',
      cmd: 'PYTHONPATH=backend python3 backend/test_phase1.py',
      desc: 'Tests DB tables, JWT login/registration, text extraction & chunking offsets, and admin role restrictions.',
    },
    {
      title: 'Factual Vector Search & Grounded Answer via curl',
      cmd: `curl -s -X POST http://localhost:8001/query \\
  -H "Content-Type: application/json" \\
  -d '{"query": "What happens in Phase 1a of Paxos?", "top_k": 3}' | jq .`,
      desc: 'Performs FAISS cosine similarity retrieval and returns grounded answer with exact bracket citations.',
    },
    {
      title: 'Inspect FAISS Vector Index Status via curl',
      cmd: 'curl -s http://localhost:8001/index/status | jq .',
      desc: 'Returns vector count, dimensionality (3072 dims), index type, and active embedding provider info.',
    },
    {
      title: 'Rebuild & Sync FAISS Index from Database Chunks',
      cmd: `curl -s -X POST http://localhost:8001/index/build \\
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" | jq .`,
      desc: 'Embeds all ready chunks in the SQLite database and loads them into the FAISS index.',
    },
    {
      title: 'Authenticate via curl & Obtain JWT Access Token',
      cmd: `curl -s -X POST http://localhost:8001/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "admin@adaptirag.ai", "password": "admin123"}' | jq .`,
      desc: 'Returns a signed JWT bearer token with admin role privileges.',
    },
  ];

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-zinc-100">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-zinc-900 tracking-tight">
              Terminal Verification & CLI Quickstart
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200">
              Runnable Commands
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Execute these commands directly in your terminal to verify Phase 1 end-to-end.
          </p>
        </div>

        <div className="flex items-center space-x-1.5 text-xs text-zinc-600 bg-zinc-50 px-2.5 py-1 rounded-lg border border-zinc-200">
          <Terminal className="w-3.5 h-3.5 text-indigo-600" />
          <span>Bash / zsh</span>
        </div>
      </div>

      {/* Direct Download ZIP banner */}
      <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-indigo-50 via-white to-blue-50 border border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
            <FolderArchive className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-900">
              Download Standalone Project Archive (.zip)
            </h4>
            <p className="text-[11px] text-zinc-500">
              Get all 22 backend Python files, requirements.txt, query_cli.py, and start scripts for local offline execution.
            </p>
          </div>
        </div>

        <button
          onClick={handleDownloadZip}
          disabled={isExporting}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
            downloadSuccess
              ? 'bg-emerald-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs active:scale-95'
          }`}
        >
          {isExporting ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Packaging...</span>
            </>
          ) : downloadSuccess ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Downloaded!</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span>Download ZIP</span>
            </>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {snippets.map((snip, idx) => (
          <div key={idx} className="bg-zinc-900 rounded-xl p-4 text-xs font-mono text-zinc-200 relative group">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-2 font-sans border-b border-zinc-800 pb-2">
              <span className="font-semibold text-zinc-200 flex items-center space-x-1.5">
                <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>{snip.title}</span>
              </span>
              <button
                onClick={() => handleCopy(snip.cmd, idx)}
                className="flex items-center space-x-1 hover:text-white px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-[10px]"
              >
                {copiedIdx === idx ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-zinc-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="text-emerald-400 overflow-x-auto whitespace-pre-wrap py-1">{snip.cmd}</pre>
            <p className="text-[11px] text-zinc-400 font-sans mt-2 pt-2 border-t border-zinc-800/80">
              {snip.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
