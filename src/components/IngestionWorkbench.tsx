import React, { useState } from 'react';
import {
  Upload,
  FileText,
  Check,
  ChevronRight,
  Sliders,
  Hash,
  Layers,
  FileCode,
  Clock,
  Trash2,
  Settings2,
  Binary,
  Network,
  Cpu
} from 'lucide-react';
import { DocumentItem, ChunkData } from '../types';

const SAMPLE_DOCS = [
  {
    name: 'distributed_consensus.md',
    type: 'md',
    content: `# Distributed Systems and Consensus in Modern Cloud Architecture

## Abstract
Distributed consensus is the fundamental protocol by which a set of independent processes agree on a state machine transition or value, despite message delays, network partitions, and machine crashes.

## 1. The Core Consensus Dilemma
In asynchronous networks without synchronized clocks, the FLP Impossibility Theorem (Fischer, Lynch, Paterson, 1985) establishes that no deterministic consensus protocol can guarantee both safety and liveness in the presence of even a single unannounced fail-stop failure. Practical systems resolve this trade-off by favoring safety over liveness during network instability. Under partial synchrony models, algorithms guarantee that safety invariants are never violated, while liveness is eventually recovered once message delivery bounds stabilize.

## 2. The Paxos Protocol
Developed by Leslie Lamport, Paxos operates in distinct phases:
- **Phase 1a (Prepare):** A Proposer selects a unique proposal number n and sends a Prepare request to a majority quorum of Acceptors.
- **Phase 1b (Promise):** Acceptors promise not to accept proposals numbered lower than n, returning the highest-numbered proposal they have accepted so far.
- **Phase 2a (Accept):** If a quorum promises, the Proposer chooses the value associated with the highest proposal number returned, or its own proposed value if none exists, and issues an Accept request.
- **Phase 2b (Accepted):** Acceptors register the proposal unless a higher proposal number was promised in the interim.

## 3. Raft Consensus Algorithm
Designed by Ongaro and Ousterhout at Stanford University, Raft divides consensus into three modular subproblems:
1. **Leader Election:** Heartbeats and election timeouts ensure a single leader coordinates log replication.
2. **Log Replication:** AppendEntries RPCs enforce monotonic index matching across follower nodes.
3. **Safety Invariants:** The Election Restriction rule mandates that candidate nodes cannot win an election unless their log is at least as up-to-date as any majority quorum member.

## 4. Byzantine Fault Tolerance (BFT)
In adversarial environments, nodes may fail arbitrarily (malicious collusion, bit-flips, Byzantine behavior). Practical Byzantine Fault Tolerance (PBFT) requires 3f + 1 total nodes to tolerate f Byzantine failures, requiring Pre-prepare, Prepare, and Commit message phases with cryptographic signatures.`,
  },
  {
    name: 'hybrid_rag_overview.txt',
    type: 'txt',
    content: `AdaptiRAG Architecture: Hybrid Retrieval for Query-Focused Summarization

Traditional Vector RAG operates on dense embedding similarity over local text chunks. While vector search is exceptionally cheap, low-latency, and accurate for factual lookups ("What is the timeout parameter for Paxos prepare requests?"), it fundamentally fails on global thematic questions ("What are the overarching architectural trade-offs across all distributed protocols discussed?").

Conversely, GraphRAG extracts entities, relationships, and higher-order topological communities from the corpus, running hierarchical map-reduce summarization passes. While GraphRAG produces exceptional comprehensive synthesis, it incurs a 10x to 20x cost multiplier due to the extensive LLM extraction and summarization passes.

AdaptiRAG resolves this economic and algorithmic tension by implementing an Adaptive Router Agent. Queries classified as 'local' bypass the graph pipeline entirely, querying the FAISS vector index in under 150 milliseconds. Queries classified as 'global' trigger community traversal and map-reduce synthesis. Every answer is grounded in exact source citations with verifiable chunk offsets.`,
  }
];

export const IngestionWorkbench: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentItem[]>([
    {
      id: 1,
      filename: 'consensus_overview.md',
      file_type: 'md',
      file_size: 1337,
      status: 'ready',
      chunk_count: 2,
      uploaded_at: 'Just now (SQLite verified)',
      chunks: [
        {
          chunk_index: 0,
          text: '# Distributed Systems and Consensus in Modern Cloud Architecture\n\n## Abstract\nDistributed consensus is the fundamental protocol by which a set of independent processes agree on a state machine transition or value, despite message delays, network partitions, and machine crashes.\n\n## 1. The Core Consensus Dilemma\nIn asynchronous networks without synchronized clocks, the FLP Impossibility Theorem (Fischer, Lynch, Paterson, 1985) establishes that no deterministic consensus protocol can guarantee both safety and liveness in the presence of even a single unannounced fail-stop failure.',
          token_estimate: 112,
          start_char: 0,
          end_char: 524,
        },
        {
          chunk_index: 1,
          text: '## 2. The Paxos Protocol\nDeveloped by Leslie Lamport, Paxos operates in distinct phases:\n- Phase 1a (Prepare): A Proposer selects a unique proposal number n and sends a Prepare request to a majority quorum of Acceptors.\n- Phase 1b (Promise): Acceptors promise not to accept proposals numbered lower than n.\n\n## 3. Raft Consensus Algorithm\nDesigned by Ongaro and Ousterhout at Stanford University, Raft divides consensus into three modular subproblems: Leader Election, Log Replication, Safety Invariants.',
          token_estimate: 125,
          start_char: 480,
          end_char: 994,
        }
      ]
    }
  ]);

  const [selectedDocId, setSelectedDocId] = useState<number>(1);
  const [targetTokenSize, setTargetTokenSize] = useState<number>(600);
  const [overlapTokens, setOverlapTokens] = useState<number>(100);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>('');
  const [customFilename, setCustomFilename] = useState<string>('custom_notes.md');
  const [extractTriples, setExtractTriples] = useState<boolean>(true);
  const [extractCommunities, setExtractCommunities] = useState<boolean>(true);
  const [extractVectors, setExtractVectors] = useState<boolean>(true);
  const [showExtractionSettings, setShowExtractionSettings] = useState<boolean>(true);
  const [extractionStatusMsg, setExtractionStatusMsg] = useState<string | null>(null);

  // Client-side mirror of the backend sliding window chunking
  const simulateChunking = (text: string, filename: string) => {
    setIsProcessing(true);
    setTimeout(() => {
      const words = text.split(/\s+/).filter(Boolean);
      const chunks: ChunkData[] = [];
      const wordTarget = Math.max(15, Math.floor(targetTokenSize / 1.33));
      const wordOverlap = Math.max(5, Math.floor(overlapTokens / 1.33));
      const step = Math.max(1, wordTarget - wordOverlap);

      let currentWordIdx = 0;
      let charCursor = 0;

      while (currentWordIdx < words.length) {
        const slice = words.slice(currentWordIdx, currentWordIdx + wordTarget);
        const chunkText = slice.join(' ');
        const startChar = text.indexOf(chunkText.slice(0, 30), charCursor);
        const actualStart = startChar >= 0 ? startChar : charCursor;
        const actualEnd = actualStart + chunkText.length;
        charCursor = actualStart;

        chunks.push({
          chunk_index: chunks.length,
          text: chunkText,
          token_estimate: Math.round(slice.length * 1.33),
          start_char: actualStart,
          end_char: actualEnd,
        });

        currentWordIdx += step;
        if (currentWordIdx >= words.length && chunks.length > 0) break;
      }

      const newDoc: DocumentItem = {
        id: documents.length + 1,
        filename,
        file_type: filename.split('.').pop() || 'txt',
        file_size: text.length,
        status: 'ready',
        chunk_count: chunks.length,
        uploaded_at: 'Just now (Ingested)',
        chunks,
      };

      setDocuments([newDoc, ...documents]);
      setSelectedDocId(newDoc.id);
      setIsProcessing(false);
    }, 300);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      simulateChunking(content || 'Document text extracted.', file.name);
    };
    reader.readAsText(file);
  };

  const activeDoc = documents.find((d) => d.id === selectedDocId) || documents[0];

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-5 mb-6 border-b border-zinc-100 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-zinc-900 tracking-tight">
              Document Ingestion & Chunking Workbench
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              PRD FR-1 & FR-2
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Extracts text from PDF, DOCX, TXT, MD and computes sliding-window overlapping chunks for vector & graph indexing.
          </p>
        </div>

        {/* Sliders for Chunking parameters & Extraction options */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowExtractionSettings(!showExtractionSettings)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              showExtractionSettings
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs'
                : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Extraction Options</span>
          </button>

          <div className="flex flex-wrap items-center gap-4 bg-zinc-50 p-2.5 rounded-xl border border-zinc-200 text-xs">
            <div className="flex items-center space-x-2">
              <Sliders className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-zinc-600 font-medium">Target Size:</span>
              <span className="font-bold text-zinc-900 w-12">{targetTokenSize} tok</span>
              <input
                type="range"
                min="200"
                max="1000"
                step="50"
                value={targetTokenSize}
                onChange={(e) => setTargetTokenSize(Number(e.target.value))}
                className="w-20 accent-indigo-600 cursor-pointer"
              />
            </div>

            <div className="h-4 w-px bg-zinc-200"></div>

            <div className="flex items-center space-x-2">
              <span className="text-zinc-600 font-medium">Overlap:</span>
              <span className="font-bold text-zinc-900 w-12">{overlapTokens} tok</span>
              <input
                type="range"
                min="30"
                max="250"
                step="10"
                value={overlapTokens}
                onChange={(e) => setOverlapTokens(Number(e.target.value))}
                className="w-20 accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Extraction Pipeline Settings Panel */}
      {showExtractionSettings && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-indigo-50/60 via-white to-blue-50/60 border border-indigo-100 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-zinc-900 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-indigo-600" />
              Multi-Modal Extraction & Indexing Pipeline Options
            </span>
            <span className="text-[11px] text-zinc-500">Configures FAISS vector indexing & Knowledge Graph extraction</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Vector Extraction */}
            <div
              onClick={() => setExtractVectors(!extractVectors)}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between ${
                extractVectors
                  ? 'bg-white border-indigo-200 shadow-xs'
                  : 'bg-zinc-50/80 border-zinc-200 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
                  <Binary className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Dense Vector Extraction</span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  768-dim embeddings with FAISS IndexFlatIP cosine similarity indexing.
                </p>
              </div>
              <div className={`w-4 h-4 rounded flex items-center justify-center text-white shrink-0 ml-2 ${extractVectors ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
                {extractVectors && <Check className="w-3 h-3" />}
              </div>
            </div>

            {/* Triples Extraction */}
            <div
              onClick={() => setExtractTriples(!extractTriples)}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between ${
                extractTriples
                  ? 'bg-white border-indigo-200 shadow-xs'
                  : 'bg-zinc-50/80 border-zinc-200 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
                  <Network className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Entity-Relation Triples</span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Extracts Subject-Predicate-Object knowledge graphs for relational hops.
                </p>
              </div>
              <div className={`w-4 h-4 rounded flex items-center justify-center text-white shrink-0 ml-2 ${extractTriples ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
                {extractTriples && <Check className="w-3 h-3" />}
              </div>
            </div>

            {/* Community Extraction */}
            <div
              onClick={() => setExtractCommunities(!extractCommunities)}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between ${
                extractCommunities
                  ? 'bg-white border-indigo-200 shadow-xs'
                  : 'bg-zinc-50/80 border-zinc-200 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
                  <Layers className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Louvain Communities</span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Modular graph partitioning for high-level thematic map-reduce passes.
                </p>
              </div>
              <div className={`w-4 h-4 rounded flex items-center justify-center text-white shrink-0 ml-2 ${extractCommunities ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
                {extractCommunities && <Check className="w-3 h-3" />}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Upload & Document Selector */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border-2 border-dashed border-zinc-200 hover:border-indigo-400 rounded-xl p-5 text-center transition-colors bg-zinc-50/50 hover:bg-indigo-50/20 group relative cursor-pointer">
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="w-10 h-10 mx-auto rounded-xl bg-white border border-zinc-200 flex items-center justify-center text-zinc-600 group-hover:text-indigo-600 group-hover:border-indigo-200 shadow-sm transition-colors mb-2">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-zinc-800">
              Upload PDF, DOCX, TXT, or MD
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Drag & drop or click to ingest and chunk
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                Sample Test Documents
              </span>
              <span className="text-[10px] text-zinc-400">Click to ingest</span>
            </div>
            <div className="space-y-1.5">
              {SAMPLE_DOCS.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => simulateChunking(sample.content, sample.name)}
                  disabled={isProcessing}
                  className="w-full text-left p-2.5 rounded-lg border border-zinc-200 hover:border-indigo-300 bg-white hover:bg-indigo-50/40 text-xs transition-all flex items-center justify-between group"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <FileCode className="w-3.5 h-3.5 text-zinc-400 group-hover:text-indigo-600 flex-shrink-0" />
                    <span className="font-medium text-zinc-800 truncate">{sample.name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono px-1.5 py-0.5 bg-zinc-100 rounded">
                    .{sample.type}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                Ingested Documents ({documents.length})
              </span>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${
                    selectedDocId === doc.id
                      ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 font-semibold'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${selectedDocId === doc.id ? 'text-indigo-600' : 'text-zinc-400'}`} />
                    <span className="truncate">{doc.filename}</span>
                  </div>
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <span className="text-[10px] font-mono bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded">
                      {doc.chunk_count} {doc.chunk_count === 1 ? 'chunk' : 'chunks'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Chunk Viewer & Analysis */}
        <div className="lg:col-span-8 bg-zinc-50/50 rounded-xl border border-zinc-200 p-4">
          {activeDoc ? (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-zinc-200/80 gap-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-sm text-zinc-900">{activeDoc.filename}</h3>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {activeDoc.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {activeDoc.file_size} bytes · {activeDoc.chunk_count} chunks generated · {activeDoc.uploaded_at}
                  </p>
                </div>

                <div className="text-[11px] font-mono text-zinc-500 bg-white px-2.5 py-1 rounded border border-zinc-200">
                  SQLite Doc ID: #{activeDoc.id}
                </div>
              </div>

              {/* Chunk list */}
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                {activeDoc.chunks.map((chunk) => (
                  <div
                    key={chunk.chunk_index}
                    className="bg-white rounded-xl p-4 border border-zinc-200 shadow-xs hover:border-zinc-300 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">
                          Chunk #{chunk.chunk_index}
                        </span>
                        <span className="text-[11px] text-zinc-500 flex items-center space-x-1">
                          <Hash className="w-3 h-3 text-zinc-400" />
                          <span>~{chunk.token_estimate} tokens</span>
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400">
                        Chars [{chunk.start_char}..{chunk.end_char}]
                      </span>
                    </div>

                    <div className="text-xs text-zinc-700 font-sans leading-relaxed whitespace-pre-wrap bg-zinc-50/70 p-3 rounded-lg border border-zinc-100">
                      {chunk.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-zinc-400 text-xs">
              No document selected. Upload or choose a sample document.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
