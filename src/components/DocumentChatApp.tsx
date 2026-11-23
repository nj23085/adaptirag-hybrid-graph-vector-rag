import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitFork,
  Network,
  PanelLeft,
  PanelRight,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChatMessage,
  CitationItem,
  CommunityCitation,
  RouterClassification,
  RouterExecutionResult,
  UserRole
} from '../types';

interface DocumentChatAppProps {
  currentUser: UserRole;
  apiBase?: string;
}

interface UploadedDoc {
  id: number;
  filename: string;
  chunk_count: number;
  file_size: number;
  status: string;
}

type AppView = 'upload' | 'chat';
type RouteKey = 'local' | 'global' | 'hybrid';
type RouteMode = 'auto' | RouteKey;
// 'document' = the active document only, 'selected' = documents ticked by hand, 'all' = every document
type Scope = 'document' | 'selected' | 'all';

interface SelectedCitation {
  type: 'chunk' | 'community' | 'entity';
  data: any;
  /** The question that produced this citation, used to highlight matching words in the passage. */
  query?: string;
}

/* ------------------------------------------------------------------ */
/* Route styling. Class names are written out in full so Tailwind sees them. */
/* ------------------------------------------------------------------ */
const ROUTE: Record<
  RouteKey,
  { label: string; long: string; meaning: string; chip: string; dot: string; bar: string; ink: string; iconBg: string }
> = {
  local: {
    label: 'Local',
    long: 'Local Vector Search',
    meaning: 'Specific facts from high-similarity text chunks',
    chip: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
    dot: 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]',
    bar: 'bg-gradient-to-r from-cyan-400 to-teal-500',
    ink: 'text-cyan-700 dark:text-cyan-300',
    iconBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
  },
  global: {
    label: 'Global',
    long: 'Global Graph Search',
    meaning: 'High-level themes & concepts across graph communities',
    chip: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30',
    dot: 'bg-purple-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]',
    bar: 'bg-gradient-to-r from-purple-400 to-indigo-500',
    ink: 'text-purple-700 dark:text-purple-300',
    iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
  },
  hybrid: {
    label: 'Hybrid',
    long: 'Hybrid Graph + Vector',
    meaning: 'Unified passages and graph relationships for relational questions',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
    dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    bar: 'bg-gradient-to-r from-amber-400 to-orange-500',
    ink: 'text-amber-700 dark:text-amber-300',
    iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  }
};

const ROUTE_ORDER: RouteKey[] = ['local', 'global', 'hybrid'];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where',
  'does', 'did', 'with', 'that', 'this', 'these', 'those', 'from', 'about', 'into', 'than', 'then', 'there',
  'their', 'them', 'they', 'have', 'has', 'had', 'been', 'being', 'can', 'could', 'would', 'should', 'will',
  'tell', 'please', 'give', 'list', 'all', 'any', 'between', 'main', 'key'
]);

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const fmtKB = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const chunksLabel = (n: number) => `${n} ${n === 1 ? 'chunk' : 'chunks'}`;
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Highlights the words of the question inside a passage. */
const Highlighted: React.FC<{ text: string; query?: string }> = ({ text, query }) => {
  const re = useMemo(() => {
    const words: string[] = (query || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? [];
    const terms: string[] = Array.from(new Set<string>(words)).filter(t => !STOPWORDS.has(t));
    if (!terms.length) return null;
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(?<![\\p{L}\\p{N}])((?:${escaped.join('|')})[\\p{L}\\p{N}]*)`, 'giu');
  }, [query]);

  if (!re) return <>{text}</>;
  const parts = text.split(re); // with one capture group, odd positions are the matches
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="term">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
};

/** Rows for the "how it was routed" bars. Uses the learned router's probabilities when available. */
function traceRows(c?: RouterClassification): { title: string; rows: { key: RouteKey; value: number }[] } | null {
  if (!c) return null;
  if (c.probabilities && Object.keys(c.probabilities).length) {
    return {
      title: 'Route probability',
      rows: ROUTE_ORDER.map(k => ({ key: k, value: clamp01(c.probabilities?.[k] ?? 0) }))
    };
  }
  if (c.intent_breakdown) {
    return {
      title: 'Question signals',
      rows: [
        { key: 'local', value: clamp01(c.intent_breakdown.factual_specificity) },
        { key: 'global', value: clamp01(c.intent_breakdown.thematic_breadth) },
        { key: 'hybrid', value: clamp01(c.intent_breakdown.relational_multi_hop) }
      ]
    };
  }
  return null;
}

const classifierLabel = (c?: string) =>
  c === 'learned' ? 'Learned router' : c === 'keyword' ? 'Keyword rules (fallback)' : c || 'Router';

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */
const RouteChip: React.FC<{ route: RouteKey }> = ({ route }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold tracking-wide backdrop-blur-sm ${ROUTE[route].chip}`}>
    <span className={`h-2 w-2 rounded-full ${ROUTE[route].dot}`} />
    {ROUTE[route].long}
  </span>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'ready') return null;
  const isError = status === 'error';
  return (
    <span
      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isError ? 'bg-bad-bg text-bad border border-bad/30' : 'bg-surface-3 text-muted border border-line-strong'
        }`}
    >
      {isError ? 'error' : status}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export const DocumentChatApp: React.FC<DocumentChatAppProps> = ({ currentUser, apiBase = '' }) => {
  // Core state
  const [view, setView] = useState<AppView>('upload');
  const [activeDoc, setActiveDoc] = useState<UploadedDoc | null>(null);
  const [docHistory, setDocHistory] = useState<UploadedDoc[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [routeMode, setRouteMode] = useState<RouteMode>('auto');
  // 'document' = answer only from the selected document, 'all' = search every uploaded document
  const [scope, setScope] = useState<Scope>('document');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());

  // Upload state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllPrev, setShowAllPrev] = useState<boolean>(false);

  // Mobile drawers
  const [railOpen, setRailOpen] = useState<boolean>(false);
  const [evidenceOpen, setEvidenceOpen] = useState<boolean>(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Citation inspector
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isProcessing]);

  // Load existing documents into history on mount
  useEffect(() => {
    fetchDocumentHistory();
  }, []);

  // Grow the composer with its content (up to 5 lines)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [inputQuery, view]);

  // When a passage is opened, bring the first highlighted word into view
  const evidenceScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedCitation?.type !== 'chunk') return;
    const t = window.setTimeout(() => {
      const box = evidenceScrollRef.current;
      const mark = box?.querySelector('mark.term') as HTMLElement | null;
      if (box && mark) box.scrollTo({ top: Math.max(0, mark.offsetTop - box.clientHeight / 3), behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [selectedCitation]);

  // Close drawers with Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRailOpen(false);
        setEvidenceOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Notices disappear on their own
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Drag & drop anywhere on the page. Registered once on the window, and it always calls the latest
  // upload handler through a ref, so a dropped file is never ignored (and never opened by the browser).
  const uploadRef = useRef<(file: File) => void>(() => { });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setIsDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragOver(false);
    };
    const onDropWindow = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) uploadRef.current(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropWindow);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropWindow);
    };
  }, []);

  const fetchDocumentHistory = async () => {
    try {
      const res = await fetch(`${apiBase}/documents`);
      if (res.ok) {
        const docs = await res.json();
        const mapped: UploadedDoc[] = docs.map((d: any) => ({
          id: d.id,
          filename: d.filename,
          chunk_count: d.chunk_count,
          file_size: d.file_size,
          status: d.status
        }));
        setDocHistory(mapped);
      }
    } catch {
      // Backend might be offline
    }
  };

  const handleFileUpload = async (file: File) => {
    if (isUploading) return;
    setIsUploading(true);
    setNotice(null);
    setUploadProgress(`Indexing ${file.name}`);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiBase}/documents`, {
        method: 'POST',
        headers: currentUser.token ? { Authorization: `Bearer ${currentUser.token}` } : {},
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        const newDoc: UploadedDoc = {
          id: data.id,
          filename: data.filename,
          chunk_count: data.chunk_count,
          file_size: data.file_size,
          status: data.status
        };

        // Move old active doc to history if exists
        if (activeDoc) {
          setDocHistory(prev => {
            const exists = prev.find(d => d.id === activeDoc.id);
            return exists ? prev : [activeDoc, ...prev];
          });
        }

        // Set new doc as active, clear chat, switch to chat view
        setActiveDoc(newDoc);
        setMessages([
          {
            id: `sys-${Date.now()}`,
            sender: 'assistant',
            timestamp: nowLabel(),
            text:
              `${file.name} is ready.\n` +
              `${chunksLabel(data.chunk_count)} indexed, ${fmtKB(file.size)}. You can ask questions now.\n` +
              `The knowledge graph keeps building in the background and only matters for All documents graph answers.`
          }
        ]);
        setSelectedCitation(null);
        setEvidenceOpen(false);
        setView('chat');
        setUploadProgress(null);

        // Add to history
        setDocHistory(prev => {
          const exists = prev.find(d => d.id === newDoc.id);
          return exists ? prev : [newDoc, ...prev];
        });
      } else {
        const errData = await res.json().catch(() => ({}));
        setUploadProgress(null);
        setNotice(`Upload failed. ${errData.detail || `The server returned ${res.status}.`}`);
      }
    } catch {
      setUploadProgress(null);
      setNotice('Could not reach the server. Make sure the backend is running.');
    } finally {
      setIsUploading(false);
    }
  };

  uploadRef.current = handleFileUpload;

  const switchToDoc = (doc: UploadedDoc) => {
    // Move current active to history
    if (activeDoc && activeDoc.id !== doc.id) {
      setDocHistory(prev => {
        const exists = prev.find(d => d.id === activeDoc.id);
        return exists ? prev : [activeDoc, ...prev];
      });
    }

    setActiveDoc(doc);
    setMessages([
      {
        id: `sys-${Date.now()}`,
        sender: 'assistant',
        timestamp: nowLabel(),
        text: `Switched to ${doc.filename}, ${chunksLabel(doc.chunk_count)}. What would you like to know about it?`
      }
    ]);
    setSelectedCitation(null);
    setEvidenceOpen(false);
    setRailOpen(false);
    setView('chat');
  };

  const handleCopy = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard can be blocked; nothing else to do */
    }
  };

  const handleFeedback = (id: string, fb: 'positive' | 'negative') => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, feedback: m.feedback === fb ? null : fb } : m)));
  };

  const toggleTrace = (id: string) => {
    const opening = !expandedTrace.has(id);
    setExpandedTrace(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening) {
      // Once the panel has grown, make sure all of it is visible above the composer
      window.setTimeout(
        () => document.getElementById(`trace-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        240
      );
    }
  };

  const openCitation = (c: SelectedCitation) => {
    setSelectedCitation(c);
    setEvidenceOpen(true);
  };

  const handleSendMessage = async (queryToSend?: string) => {
    const query = (queryToSend || inputQuery).trim();
    if (!query || isProcessing) return;
    if (scope === 'selected' && selectedIds.length === 0) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: nowLabel(),
      text: query
    };
    setMessages(prev => [...prev, userMsg]);
    setInputQuery('');
    setIsProcessing(true);

    try {
      const res = await fetch(`${apiBase}/router/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentUser.token ? { Authorization: `Bearer ${currentUser.token}` } : {})
        },
        body: JSON.stringify({
          query,
          mode: routeMode,
          top_k: 4,
          document_id: scope === 'document' ? activeDoc?.id : undefined,
          document_ids: scope === 'selected' ? selectedIds : undefined
        })
      });

      if (res.ok) {
        const data: RouterExecutionResult = await res.json();
        const assistantMsg: ChatMessage = {
          id: `asst-${Date.now()}`,
          sender: 'assistant',
          timestamp: nowLabel(),
          text: data.answer,
          route: data.route,
          confidence: data.classification?.confidence || 0.92,
          latency_ms: data.latency_ms,
          tokens_used: data.tokens_used,
          cost_usd: data.cost_usd,
          model: data.model,
          reasoning: data.classification?.reasoning,
          citations: data.citations,
          community_citations: data.community_citations,
          entity_citations: data.entity_citations,
          classification: data.classification,
          scope_note: data.scope_note || undefined,
          input_tokens: data.input_tokens,
          output_tokens: data.output_tokens,
          tokens_exact: data.tokens_exact
        };
        setMessages(prev => [...prev, assistantMsg]);
        // Show the first piece of evidence on the right (without sliding the drawer open on phones)
        if (data.community_citations?.length) {
          setSelectedCitation({ type: 'community', data: data.community_citations[0], query });
        } else if (data.citations?.length) {
          setSelectedCitation({ type: 'chunk', data: data.citations[0], query });
        }
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: 'assistant',
            timestamp: nowLabel(),
            text: `The question could not be answered (server error ${res.status}). Check that the backend is running and try again.`
          }
        ]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          timestamp: nowLabel(),
          text: 'Could not connect to the server. Make sure the backend is running and try again.'
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Documents for the rail: the history, with the active document included even if it is not in it yet
  const allDocs = useMemo(() => {
    if (activeDoc && !docHistory.some(d => d.id === activeDoc.id)) return [activeDoc, ...docHistory];
    return docHistory;
  }, [docHistory, activeDoc]);

  const fileInput = (ref: React.RefObject<HTMLInputElement | null>) => (
    <input
      type="file"
      ref={ref}
      accept=".pdf,.docx,.txt,.md"
      className="hidden"
      onChange={e => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        e.target.value = '';
      }}
    />
  );

  const noticeBar = (
    <AnimatePresence>
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          role="alert"
          className="fixed left-1/2 top-16 z-50 flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
          <p className="flex-1 text-ink-2">{notice}</p>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ================================================================ */
  /* UPLOAD VIEW                                                       */
  /* ================================================================ */
  if (view === 'upload') {
    const routes: { key: RouteKey; title: string; sub: string; example: string; icon: React.ReactNode }[] = [
      {
        key: 'local',
        title: 'Specific Facts',
        sub: 'PINPOINT FACT EXTRACTION • Pinpoint exact passages & data tables',
        example: 'Who signed the contract and when?',
        icon: <BookOpen className="h-5 w-5" />
      },
      {
        key: 'global',
        title: 'Themes & Summaries',
        sub: 'KNOWLEDGE GRAPH TRAVERSAL • Cross-document themes & community synthesis',
        example: 'What are the main organizational risks?',
        icon: <GitFork className="h-5 w-5" />
      },
      {
        key: 'hybrid',
        title: 'Connected Insights',
        sub: 'ADAPTIVE MULTI-HOP • Merges deep vectors with relational graph context',
        example: 'Which supplier provided the part that failed?',
        icon: <Network className="h-5 w-5" />
      }
    ];

    return (
      <div className="h-full overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
        {noticeBar}
        <div className="mx-auto max-w-6xl">
          
          {/* Top Hero Glass Banner (matching reference site hero-card) */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative mb-10 overflow-hidden rounded-3xl border border-[var(--border-glass)] bg-surface/85 backdrop-blur-2xl p-8 sm:p-12 shadow-[var(--shadow)]"
          >
            {/* Ambient internal orb glow */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl" />

            <div className="relative z-10 max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-ping" />
                Adaptive Hybrid Graph-Vector RAG
              </div>

              <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl lg:text-[54px] leading-[1.12]">
                <span className="brand-gradient-text">Ask your documents.</span>
                <br />
                <span className="text-ink">Inspect the verified evidence.</span>
              </h1>

              <p className="mt-4 text-base sm:text-lg leading-relaxed text-muted">
                AdaptiRAG intelligently routes each query to local vector search, global knowledge graph communities,
                or a hybrid fusion—presenting highlighted evidence passages for every single answer.
              </p>
            </div>
          </motion.div>

          {/* 2-Column Section: Left Features Grid + Right Dropzone */}
          <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
            
            {/* Left: 3 Intelligent Route Cards (.metric-card style from reference) */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4 lg:col-span-7"
            >
              <h2 className="text-base font-bold uppercase tracking-wider text-muted">
                3 Adaptive Search Pathways
              </h2>

              <div className="space-y-3.5">
                {routes.map(r => (
                  <div
                    key={r.key}
                    className="glass-card group flex items-start gap-4 rounded-2xl border border-[var(--border-glass)] bg-surface/80 p-5 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${ROUTE[r.key].iconBg} shadow-sm transition-transform group-hover:scale-105`}>
                      {r.icon}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-bold text-ink">{r.title}</span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROUTE[r.key].chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${ROUTE[r.key].dot}`} />
                          {ROUTE[r.key].long}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted/90">{r.sub}</p>
                      <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1 text-xs italic text-ink-2">
                        <span className="font-semibold text-muted not-italic">e.g.</span>
                        "{r.example}"
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right: Upload Box + Previous Documents */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-6 lg:col-span-5"
            >
              {/* Dropzone Card */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload a document"
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all ${
                  isDragOver
                    ? 'border-accent bg-accent/10 shadow-xl scale-[1.01]'
                    : 'border-line-strong/80 bg-surface/85 backdrop-blur-xl shadow-md hover:border-accent/60 hover:bg-surface-2/90 hover:shadow-lg'
                }`}
              >
                {fileInput(fileInputRef)}
                {isUploading ? (
                  <div className="w-full max-w-xs">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl brand-btn text-white animate-pulse shadow-lg">
                      <Upload className="h-6 w-6" />
                    </div>
                    <p className="truncate text-base font-bold text-ink">{uploadProgress}</p>
                    <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div className="indeterminate h-full w-1/3 rounded-full bg-accent" />
                    </div>
                    <p className="mt-3 text-xs text-muted">Parsing file, chunking, and computing vector embeddings...</p>
                  </div>
                ) : (
                  <>
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl brand-btn text-white shadow-lg transition-transform group-hover:scale-105">
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="mt-4 text-lg font-bold text-ink">
                      {isDragOver ? 'Drop to upload now' : 'Drop your document here'}
                    </p>
                    <p className="mt-1 text-xs text-muted">or click to browse from device</p>
                    <div className="mt-5 flex items-center gap-1.5">
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">PDF</span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">DOCX</span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">TXT</span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">Markdown</span>
                    </div>
                  </>
                )}
              </div>

              {/* Previous Documents Glass Panel */}
              {allDocs.length > 0 && (
                <div className="rounded-3xl border border-[var(--border-glass)] bg-surface/85 p-5 backdrop-blur-xl shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <FileText className="h-4 w-4 text-accent" />
                      Uploaded Documents
                    </h3>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
                      {allDocs.length} total
                    </span>
                  </div>

                  <ul className="mt-3 divide-y divide-line/60">
                    {(showAllPrev ? allDocs : allDocs.slice(0, 4)).map(doc => (
                      <li key={doc.id}>
                        <button
                          onClick={() => switchToDoc(doc)}
                          className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted group-hover:text-ink">
                            <FileText className="h-4 w-4" />
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center">
                              <span className="truncate text-xs font-semibold text-ink">{doc.filename}</span>
                              <StatusBadge status={doc.status} />
                            </span>
                            <span className="block text-[11px] text-muted">
                              {chunksLabel(doc.chunk_count)} • {fmtKB(doc.file_size)}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  {allDocs.length > 4 && (
                    <button
                      onClick={() => setShowAllPrev(v => !v)}
                      className="mt-3 w-full rounded-xl border border-line bg-surface-2/60 py-2 text-center text-xs font-bold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      {showAllPrev ? 'Show fewer' : `View all ${allDocs.length} documents`}
                    </button>
                  )}
                </div>
              )}
            </motion.div>

          </div>

        </div>
      </div>
    );
  }

  /* ================================================================ */
  /* CHAT VIEW                                                         */
  /* ================================================================ */
  const forcedNonLocal = scope !== 'all' && (routeMode === 'global' || routeMode === 'hybrid');
  const noSelection = scope === 'selected' && selectedIds.length === 0;
  const scopeSentence =
    scope === 'document'
      ? 'this document'
      : scope === 'all'
        ? 'all documents'
        : selectedIds.length === 0
          ? 'no documents'
          : `${selectedIds.length} selected ${selectedIds.length === 1 ? 'document' : 'documents'}`;
  const selectableDocs = allDocs.filter(d => d.status !== 'error' && d.chunk_count > 0);
  const toggleSelected = (id: number) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const chooseScope = (next: Scope) => {
    setScope(next);
    // Start the hand-picked set with the document that is open, so it is never empty by surprise
    if (next === 'selected' && selectedIds.length === 0 && activeDoc) setSelectedIds([activeDoc.id]);
  };
  const routeSummary = routeMode === 'auto' ? 'automatic routing' : `${ROUTE[routeMode].long.toLowerCase()} routing`;
  const showSuggestions = messages.length <= 1;
  const hasEvidence = !!selectedCitation;

  return (
    <div className="relative flex h-full overflow-hidden">
      {noticeBar}
      {fileInput(chatFileInputRef)}

      {/* Drop overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/75 backdrop-blur-sm"
          >
            <div className="rounded-2xl border border-dashed border-ink bg-surface px-10 py-8 text-center shadow-[var(--shadow)]">
              <p className="text-lg font-semibold text-ink">Drop to add this document</p>
              <p className="mt-1 text-sm text-muted">You will switch to it as soon as it is indexed.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop for phone drawers */}
      {(railOpen || evidenceOpen) && (
        <button
          aria-label="Close panel"
          onClick={() => {
            setRailOpen(false);
            setEvidenceOpen(false);
          }}
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
        />
      )}

      {/* ---------------- Left rail: documents, scope, route ---------------- */}
      <aside
        aria-label="Documents and search options"
        className={`fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-line bg-surface/85 backdrop-blur-xl shadow-lg transition-transform duration-200 lg:static lg:z-auto lg:w-[280px] lg:shrink-0 lg:translate-x-0 ${railOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 border-b border-line/60">
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Documents</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => chatFileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2/80 px-3 py-1 text-xs font-semibold text-ink transition-all hover:bg-surface-3 hover:scale-105 shadow-sm disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 text-accent" />
              Add
            </button>
            <button
              onClick={() => setRailOpen(false)}
              aria-label="Close documents"
              className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isUploading && (
          <div className="mx-4 my-2 shrink-0 rounded-2xl bg-surface-2/90 border border-line p-3 shadow-sm">
            <p className="truncate text-xs font-bold text-ink">{uploadProgress}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="indeterminate h-full w-1/3 rounded-full bg-accent" />
            </div>
          </div>
        )}

        {scope === 'selected' && (
          <div className="flex shrink-0 items-center justify-between px-4 py-2 text-xs border-b border-line/40 bg-surface-2/40">
            <span className="text-muted font-medium">
              {selectedIds.length} of {selectableDocs.length} selected
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setSelectedIds(selectableDocs.map(d => d.id))}
                className="font-bold text-accent hover:underline"
              >
                All
              </button>
              <button onClick={() => setSelectedIds([])} className="font-bold text-muted hover:text-ink">
                Clear
              </button>
            </span>
          </div>
        )}

        <ul className="min-h-[96px] flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {allDocs.map(doc => {
            const active = activeDoc?.id === doc.id;
            const pickMode = scope === 'selected';
            const usable = doc.status !== 'error' && doc.chunk_count > 0;
            const picked = selectedIds.includes(doc.id);
            const highlighted = pickMode ? picked : active;
            return (
              <li key={doc.id}>
                <button
                  onClick={() => (pickMode ? usable && toggleSelected(doc.id) : switchToDoc(doc))}
                  aria-current={!pickMode && active ? 'true' : undefined}
                  role={pickMode ? 'checkbox' : undefined}
                  aria-checked={pickMode ? picked : undefined}
                  disabled={pickMode && !usable}
                  className={`group relative flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-all disabled:opacity-45 ${
                    highlighted
                      ? 'bg-surface-2/90 border border-line-strong shadow-sm'
                      : 'hover:bg-surface-2/60 border border-transparent'
                  }`}
                >
                  {!pickMode && active && <span className="absolute inset-y-2 left-0.5 w-[3px] rounded-full bg-accent" />}
                  {pickMode ? (
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                        picked ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface'
                      }`}
                    >
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                  ) : (
                    <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-faint group-hover:text-ink'}`} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center">
                      <span className={`truncate text-xs ${highlighted ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}>
                        {doc.filename}
                      </span>
                      <StatusBadge status={doc.status} />
                    </span>
                    <span className="block text-[11px] text-muted">
                      {chunksLabel(doc.chunk_count)} • {fmtKB(doc.file_size)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Scope and method stay pinned below the document list */}
        <div className="shrink-0 border-t border-line px-4 pb-3 pt-3.5 bg-surface-2/30">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Search In Scope</h2>
          <div className="mt-2 grid grid-cols-3 rounded-full bg-surface-2/80 p-1 border border-line-strong backdrop-blur-sm shadow-inner" role="radiogroup" aria-label="Search scope">
            {(
              [
                ['document', 'This doc'],
                ['selected', 'Selected'],
                ['all', 'All docs']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                id={`scope-${key}-btn`}
                role="radio"
                aria-checked={scope === key}
                onClick={() => chooseScope(key)}
                className={`rounded-full px-2 py-1 text-xs font-bold transition-all ${
                  scope === key ? 'brand-btn text-white shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Route */}
        <div className="shrink-0 px-4 pb-5 pt-1 bg-surface-2/30">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Routing Method</h2>
          <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Search method">
            {(['auto', 'local', 'global', 'hybrid'] as const).map(mode => {
              const selected = routeMode === mode;
              return (
                <button
                  key={mode}
                  id={`route-${mode}-btn`}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRouteMode(mode)}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all ${
                    selected
                      ? 'bg-surface border border-accent/30 shadow-sm'
                      : 'hover:bg-surface-2/70 border border-transparent'
                  }`}
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      mode === 'auto' ? 'bg-gradient-to-r from-sky-400 via-purple-500 to-amber-500 shadow-sm' : ROUTE[mode].dot
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs ${selected ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}>
                      {mode === 'auto' ? 'Auto Dynamic' : ROUTE[mode].long}
                    </span>
                    <span className="block text-[11px] leading-tight text-muted">
                      {mode === 'auto' ? 'AI router selects best path' : ROUTE[mode].meaning}
                    </span>
                  </span>
                  {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
          {forcedNonLocal && (
            <p className="mt-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
              {scope === 'selected' ? 'Selected documents' : 'Single document'} scope uses local search.
              Switch to All docs to query the graph.
            </p>
          )}
        </div>
      </aside>

      {/* ---------------- Centre: conversation ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col bg-transparent">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/75 backdrop-blur-md px-4 sm:px-6">
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open documents and options"
            className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {scope === 'document' ? activeDoc?.filename : scope === 'all' ? 'All indexed documents' : selectedIds.length === 0 ? 'No documents selected' : scopeSentence}
            </p>
          </div>
          <button
            onClick={() => setEvidenceOpen(true)}
            aria-label="Open evidence"
            className="relative rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <PanelRight className="h-[18px] w-[18px]" />
            {hasEvidence && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[800px] flex-col gap-7 px-4 py-8 sm:px-6">
            {messages.map((msg, idx) => {
              const isUser = msg.sender === 'user';
              const isSystem = msg.id.startsWith('sys-');
              const isError = msg.id.startsWith('err-');

              if (isSystem) {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mx-auto max-w-md text-center rounded-2xl border border-line bg-surface/70 backdrop-blur-md p-4 shadow-sm"
                  >
                    <span className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <FileText className="h-4 w-4" />
                    </span>
                    <p className="whitespace-pre-line text-xs sm:text-sm leading-relaxed text-muted">{msg.text}</p>
                  </motion.div>
                );
              }

              if (isUser) {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-md brand-btn px-5 py-3 text-[15px] font-medium text-white shadow-md">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              }

              if (isError) {
                return (
                  <div
                    key={msg.id}
                    role="alert"
                    className="flex items-start gap-3 rounded-2xl border border-bad/30 bg-bad-bg/80 backdrop-blur-md px-4 py-3 text-sm text-bad shadow-sm"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{msg.text}</p>
                  </div>
                );
              }

              // Assistant answer. The question that produced it is used to highlight evidence.
              const prevUser = [...messages.slice(0, idx)].reverse().find(m => m.sender === 'user');
              const query = prevUser?.text;
              const route = msg.route;
              const rows = traceRows(msg.classification);
              const open = expandedTrace.has(msg.id);
              const hasSources = !!(
                msg.citations?.length ||
                msg.community_citations?.length ||
                msg.entity_citations?.length
              );

              return (
                <motion.article
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-3xl border border-[var(--border-glass)] bg-surface/85 backdrop-blur-xl p-6 sm:p-7 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-md"
                >
                  {route && (
                    <div className="mb-3.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <RouteChip route={route} />
                      {msg.confidence != null && (
                        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 font-semibold text-ink-2">
                          {Math.round(msg.confidence * 100)}% confidence
                        </span>
                      )}
                      {msg.latency_ms != null && msg.latency_ms > 0 && (
                        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 font-semibold text-muted">
                          {(msg.latency_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                      {msg.tokens_used != null && msg.tokens_used > 0 && (
                        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 font-semibold text-muted" title={msg.tokens_exact ? 'Token count reported by the model' : 'Estimated token count'}>
                          {msg.tokens_exact ? '' : '~'}{fmtTokens(msg.tokens_used)} tokens
                        </span>
                      )}
                    </div>
                  )}

                  <div className="answer">{msg.text}</div>

                  {msg.scope_note && (
                    <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs leading-snug text-amber-700 dark:text-amber-300">
                      {msg.scope_note}
                    </p>
                  )}

                  {hasSources && (
                    <div className="mt-5 border-t border-line/60 pt-4">
                      <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">Cited Sources</p>
                      <div className="flex flex-wrap gap-2">
                        {msg.community_citations?.map((c: CommunityCitation, i: number) => {
                          const selected =
                            selectedCitation?.type === 'community' &&
                            selectedCitation.data.community_id === c.community_id;
                          return (
                            <button
                              key={`comm-${i}`}
                              onClick={() => openCitation({ type: 'community', data: c, query })}
                              aria-pressed={selected}
                              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all hover:scale-105 ${
                                selected
                                  ? 'border-purple-500 bg-purple-500/20 text-purple-700 dark:text-purple-300 shadow-sm'
                                  : 'border-line-strong bg-surface-2/80 text-ink-2 hover:bg-surface-3'
                              }`}
                            >
                              <GitFork className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                              <span className="truncate">{c.title}</span>
                            </button>
                          );
                        })}
                        {msg.citations?.map((cite: CitationItem, i: number) => {
                          const selected =
                            selectedCitation?.type === 'chunk' &&
                            selectedCitation.data.document_id === cite.document_id &&
                            selectedCitation.data.chunk_index === cite.chunk_index;
                          return (
                            <button
                              key={`chunk-${i}`}
                              onClick={() => openCitation({ type: 'chunk', data: cite, query })}
                              aria-pressed={selected}
                              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all hover:scale-105 ${
                                selected
                                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 shadow-sm'
                                  : 'border-line-strong bg-surface-2/80 text-ink-2 hover:bg-surface-3'
                              }`}
                            >
                              <BookOpen className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                              <span className="max-w-[160px] truncate">{cite.filename}</span>
                              <span className="text-muted font-normal">#{cite.chunk_index}</span>
                            </button>
                          );
                        })}
                      </div>
                      {!!msg.entity_citations?.length && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {msg.entity_citations.map((ent, i) => (
                            <button
                              key={`ent-${i}`}
                              onClick={() => openCitation({ type: 'entity', data: { name: ent }, query })}
                              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/50 px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:text-ink hover:border-line-strong"
                            >
                              <Network className="h-2.5 w-2.5 text-purple-400" />
                              {ent}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {route && (
                    <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-2.5">
                      <button
                        onClick={() => toggleTrace(msg.id)}
                        aria-expanded={open}
                        className="flex items-center gap-1.5 rounded-lg py-1 pr-2 text-xs font-semibold text-muted transition-colors hover:text-ink"
                      >
                        Router Insights
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopy(msg.text, msg.id)}
                          aria-label="Copy answer"
                          title="Copy"
                          className="rounded-full p-1.5 text-muted transition-all hover:bg-surface-2 hover:text-ink"
                        >
                          {copiedId === msg.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'positive')}
                          aria-label="Good answer"
                          aria-pressed={msg.feedback === 'positive'}
                          className={`rounded-full p-1.5 transition-all hover:bg-surface-2 ${msg.feedback === 'positive' ? 'text-ok' : 'text-muted hover:text-ink'
                            }`}
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'negative')}
                          aria-label="Poor answer"
                          aria-pressed={msg.feedback === 'negative'}
                          className={`rounded-full p-1.5 transition-all hover:bg-surface-2 ${msg.feedback === 'negative' ? 'text-bad' : 'text-muted hover:text-ink'
                            }`}
                        >
                          <ThumbsDown className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  <AnimatePresence initial={false}>
                    {open && route && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div id={`trace-${msg.id}`} className="mb-1 mt-3 rounded-2xl bg-surface-2/70 border border-line p-4 shadow-inner">
                          {rows && (
                            <>
                              <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-ink">{rows.title}</p>
                              <div className="space-y-2">
                                {rows.rows.map(r => (
                                  <div key={r.key} className="flex items-center gap-3 text-xs">
                                    <span
                                      className={`w-[90px] shrink-0 ${r.key === route ? 'font-bold text-ink' : 'text-muted'
                                        }`}
                                    >
                                      {ROUTE[r.key].long}
                                    </span>
                                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                                      <span
                                        className={`block h-full rounded-full ${ROUTE[r.key].bar} ${r.key === route ? '' : 'opacity-40'
                                          }`}
                                        style={{ width: `${Math.max(r.value * 100, 2)}%` }}
                                      />
                                    </span>
                                    <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-muted">
                                      {Math.round(r.value * 100)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {msg.reasoning && (
                            <p className={`text-xs leading-relaxed text-ink-2 ${rows ? 'mt-3 pt-3 border-t border-line/60' : ''}`}>
                              {msg.reasoning}
                            </p>
                          )}
                          <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs border-t border-line/60 pt-3">
                            <dt className="text-muted font-medium">Router Type</dt>
                            <dd className="text-ink-2 font-semibold">{classifierLabel(msg.classification?.classifier)}</dd>
                            {msg.model && (
                              <>
                                <dt className="text-muted font-medium">LLM Model</dt>
                                <dd className="text-ink-2 font-semibold">{msg.model}</dd>
                              </>
                            )}
                            {msg.tokens_exact && msg.input_tokens != null && (
                              <>
                                <dt className="text-muted font-medium">Tokens</dt>
                                <dd className="tabular-nums text-ink-2 font-semibold">
                                  {msg.input_tokens.toLocaleString()} in, {(msg.output_tokens ?? 0).toLocaleString()} out
                                </dd>
                              </>
                            )}
                            {msg.cost_usd != null && msg.cost_usd > 0 && (
                              <>
                                <dt className="text-muted font-medium">Estimated Cost</dt>
                                <dd className="tabular-nums text-ink-2 font-semibold">${msg.cost_usd.toFixed(6)}</dd>
                              </>
                            )}
                          </dl>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}

            {showSuggestions && !isProcessing && (
              <div className="flex flex-wrap justify-center gap-2 py-2">
                {['Summarize the key points', 'What are the main topics and entities?', 'What are the risks mentioned?'].map(q => (
                  <button
                    key={q}
                    onClick={() => handleSendMessage(q)}
                    className="rounded-full border border-line-strong bg-surface/85 px-4 py-2 text-xs sm:text-sm font-semibold text-ink-2 backdrop-blur-md shadow-sm transition-all hover:border-accent hover:bg-surface-2 hover:text-ink hover:scale-105"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center justify-center gap-3 py-3 text-xs sm:text-sm font-semibold text-accent" role="status">
                <span className="flex items-center gap-1">
                  <span className="thinking-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="thinking-dot h-2 w-2 rounded-full bg-accent" />
                  <span className="thinking-dot h-2 w-2 rounded-full bg-accent" />
                </span>
                Extracting evidence & synthesizing answer...
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-line/60 bg-surface/70 backdrop-blur-md px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3.5 sm:px-6">
          <div className="mx-auto w-full max-w-[800px]">
            <div className="flex items-end gap-2 rounded-2xl sm:rounded-full border border-line-strong bg-surface/90 backdrop-blur-xl p-2 sm:p-2.5 shadow-lg transition-all focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
              <textarea
                ref={composerRef}
                rows={1}
                value={inputQuery}
                onChange={e => setInputQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={scope === 'document' ? 'Ask a question about this document...' : 'Ask a question across your documents...'}
                aria-label="Your question"
                className="max-h-[132px] min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputQuery.trim() || isProcessing || noSelection}
                aria-label="Send question"
                className="brand-btn flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl sm:rounded-full text-white shadow-md transition-all disabled:opacity-25 hover:scale-105 active:scale-95"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] font-medium text-muted">
              {noSelection
                ? 'Select at least one document in the left sidebar to ask.'
                : `Searching ${scopeSentence} using ${routeSummary}${forcedNonLocal ? ' (local search enforced for single docs).' : ''
                }`}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Right: evidence ---------------- */}
      <aside
        aria-label="Evidence"
        className={`fixed inset-y-0 right-0 z-40 flex w-[min(92vw,420px)] flex-col border-l border-line bg-surface/85 backdrop-blur-xl shadow-xl transition-transform duration-200 lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:translate-x-0 ${evidenceOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-accent" />
            Verified Evidence
          </h2>
          <button
            onClick={() => setEvidenceOpen(false)}
            aria-label="Close evidence"
            className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={evidenceScrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!selectedCitation && (
            <div className="mt-12 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted shadow-sm">
                <BookOpen className="h-6 w-6 text-accent" />
              </span>
              <p className="mt-4 text-sm font-bold text-ink">No Source Selected</p>
              <p className="mx-auto mt-1.5 max-w-[240px] text-xs text-muted leading-relaxed">
                Click any citation badge under an assistant response to view the verified text passage and graph context.
              </p>
            </div>
          )}

          {selectedCitation?.type === 'chunk' && (
            <div>
              <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-3 border-b border-line bg-surface/90 backdrop-blur-md px-5 pb-3.5 pt-5 shadow-sm">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-ink">{selectedCitation.data.filename}</p>
                  <p className="text-xs text-muted">Chunk Index: #{selectedCitation.data.chunk_index}</p>
                </div>
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]" title="Vector search passage" />
              </div>
              <div className="passage rounded-2xl border-l-4 border-cyan-500 bg-surface-2/60 p-4 shadow-sm">
                <Highlighted text={selectedCitation.data.text || ''} query={selectedCitation.query} />
              </div>
              {selectedCitation.data.start_char != null && selectedCitation.data.end_char != null && (
                <p className="mt-3 text-[11px] text-muted">
                  Span: characters {selectedCitation.data.start_char} to {selectedCitation.data.end_char}
                </p>
              )}
            </div>
          )}

          {selectedCitation?.type === 'community' && (
            <div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600">
                  <GitFork className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-ink">{selectedCitation.data.title}</p>
                  <p className="text-xs text-muted">Knowledge Graph Community</p>
                </div>
              </div>
              <p className="passage mt-4 rounded-2xl border-l-4 border-purple-500 bg-surface-2/60 p-4 shadow-sm">
                {selectedCitation.data.summary}
              </p>
              {selectedCitation.data.member_names?.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                    Community Entities ({selectedCitation.data.member_count})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCitation.data.member_names.map((name: string, i: number) => (
                      <span key={i} className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedCitation?.type === 'entity' && (
            <div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600">
                  <Network className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-ink">{selectedCitation.data.name}</p>
                  <p className="text-xs text-muted">Knowledge Graph Node</p>
                </div>
              </div>
              <p className="mt-4 rounded-2xl bg-surface-2/60 border border-line p-4 text-xs leading-relaxed text-muted">
                This entity was extracted from your ingested corpus. It links multiple document facts across graph communities.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};