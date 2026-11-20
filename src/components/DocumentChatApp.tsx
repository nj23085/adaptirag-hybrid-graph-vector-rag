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
  { label: string; long: string; meaning: string; chip: string; dot: string; bar: string; ink: string }
> = {
  local: {
    label: 'Local',
    long: 'Local search',
    meaning: 'Specific facts from the best matching passages',
    chip: 'bg-local-bg text-local-ink',
    dot: 'bg-local',
    bar: 'bg-local',
    ink: 'text-local-ink'
  },
  global: {
    label: 'Global',
    long: 'Global graph',
    meaning: 'Themes and comparisons across the knowledge graph',
    chip: 'bg-global-bg text-global-ink',
    dot: 'bg-global',
    bar: 'bg-global',
    ink: 'text-global-ink'
  },
  hybrid: {
    label: 'Hybrid',
    long: 'Hybrid',
    meaning: 'Passages and graph context together, for facts that connect',
    chip: 'bg-hybrid-bg text-hybrid-ink',
    dot: 'bg-hybrid',
    bar: 'bg-hybrid',
    ink: 'text-hybrid-ink'
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
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${ROUTE[route].chip}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${ROUTE[route].dot}`} />
    {ROUTE[route].long}
  </span>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'ready') return null;
  const isError = status === 'error';
  return (
    <span
      className={`ml-2 shrink-0 rounded px-1.5 py-px text-[11px] font-medium ${isError ? 'bg-bad-bg text-bad' : 'bg-surface-2 text-muted'
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
    const routes: { key: RouteKey; title: string; sub: string; example: string }[] = [
      {
        key: 'local',
        title: 'Specific facts',
        sub: 'Finds the exact passage that holds the answer.',
        example: 'Who signed the contract?'
      },
      {
        key: 'global',
        title: 'Themes and comparisons',
        sub: 'Reads across the knowledge graph for the big picture.',
        example: 'What are the main risks in the report?'
      },
      {
        key: 'hybrid',
        title: 'Facts that connect',
        sub: 'Combines passages with graph context for linked questions.',
        example: 'Which supplier provided the part that failed?'
      }
    ];

    return (
      <div className="h-full overflow-y-auto">
        {noticeBar}
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-20 lg:py-20">
          {/* Left: what it does */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="max-w-xl text-[34px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[44px]">
              Ask your documents. See the evidence.
            </h1>
            <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-muted">
              AdaptiRAG reads your file, then chooses the best way to search it for each question and shows exactly
              which passages the answer came from.
            </p>

            <div className="mt-10 max-w-xl divide-y divide-line border-y border-line">
              {routes.map(r => (
                <div key={r.key} className="flex gap-4 py-4">
                  <span className={`mt-1 h-10 w-[3px] shrink-0 rounded-full ${ROUTE[r.key].bar}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-[15px] font-semibold text-ink">{r.title}</span>
                      <span className={`text-[13px] font-medium ${ROUTE[r.key].ink}`}>{ROUTE[r.key].long}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{r.sub}</p>
                    <p className="mt-1 font-serif text-sm italic text-faint">"{r.example}"</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right: dropzone and previous documents */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0"
          >
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
              className={`relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors ${isDragOver
                  ? 'border-ink bg-surface-2'
                  : 'border-line-strong bg-surface hover:border-ink hover:bg-surface-2/60'
                }`}
            >
              {fileInput(fileInputRef)}
              {isUploading ? (
                <div className="w-full max-w-xs">
                  <p className="truncate text-[15px] font-medium text-ink">{uploadProgress}</p>
                  <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="indeterminate h-full w-1/3 rounded-full bg-ink" />
                  </div>
                  <p className="mt-3 text-sm text-muted">Extracting text, splitting into chunks and embedding them.</p>
                </div>
              ) : (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink">
                    <Upload className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-[17px] font-semibold text-ink">
                    {isDragOver ? 'Drop to upload' : 'Drop a document here'}
                  </p>
                  <p className="mt-1 text-sm text-muted">or click to choose a file</p>
                  <p className="mt-5 text-[13px] text-faint">PDF, DOCX, TXT or Markdown</p>
                </>
              )}
            </div>

            {allDocs.length > 0 && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-ink">Previous documents</h2>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {(showAllPrev ? allDocs : allDocs.slice(0, 5)).map(doc => (
                    <li key={doc.id}>
                      <button
                        onClick={() => switchToDoc(doc)}
                        className="group flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-surface-2/60"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center">
                            <span className="truncate text-sm font-medium text-ink">{doc.filename}</span>
                            <StatusBadge status={doc.status} />
                          </span>
                          <span className="block text-[13px] text-muted">
                            {chunksLabel(doc.chunk_count)}, {fmtKB(doc.file_size)}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                      </button>
                    </li>
                  ))}
                </ul>
                {allDocs.length > 5 && (
                  <button
                    onClick={() => setShowAllPrev(v => !v)}
                    className="mt-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
                  >
                    {showAllPrev ? 'Show fewer' : `Show all ${allDocs.length} documents`}
                  </button>
                )}
              </div>
            )}
          </motion.div>
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
        className={`fixed inset-y-0 left-0 z-40 flex w-[290px] flex-col border-r border-line bg-surface transition-transform duration-200 lg:static lg:z-auto lg:w-[264px] lg:shrink-0 lg:translate-x-0 ${railOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-sm font-semibold text-ink">Documents</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => chatFileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add document
            </button>
            <button
              onClick={() => setRailOpen(false)}
              aria-label="Close documents"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isUploading && (
          <div className="mx-4 mb-2 shrink-0 rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="truncate text-[13px] font-medium text-ink">{uploadProgress}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div className="indeterminate h-full w-1/3 rounded-full bg-ink" />
            </div>
          </div>
        )}

        {scope === 'selected' && (
          <div className="flex shrink-0 items-center justify-between px-4 pb-1.5 text-[13px]">
            <span className="text-muted">
              {selectedIds.length} of {selectableDocs.length} selected
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => setSelectedIds(selectableDocs.map(d => d.id))}
                className="font-medium text-ink-2 hover:text-ink"
              >
                Select all
              </button>
              <button onClick={() => setSelectedIds([])} className="font-medium text-ink-2 hover:text-ink">
                Clear
              </button>
            </span>
          </div>
        )}

        <ul className="min-h-[96px] flex-1 overflow-y-auto px-2 pb-3">
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
                  className={`relative flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-45 ${highlighted ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                    }`}
                >
                  {!pickMode && active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-ink" />}
                  {pickMode ? (
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked ? 'border-ink bg-ink text-accent-ink' : 'border-line-strong bg-surface'
                        }`}
                    >
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                  ) : (
                    <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-ink' : 'text-faint'}`} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center">
                      <span className={`truncate text-sm ${highlighted ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
                        {doc.filename}
                      </span>
                      <StatusBadge status={doc.status} />
                    </span>
                    <span className="block text-xs text-muted">
                      {chunksLabel(doc.chunk_count)}, {fmtKB(doc.file_size)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Scope and method stay pinned below the document list */}
        <div className="shrink-0 border-t border-line px-4 pb-3 pt-4">
          <h2 className="text-sm font-semibold text-ink">Search in</h2>
          <div className="mt-2 grid grid-cols-3 rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Search scope">
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
                className={`rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors ${scope === key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Route */}
        <div className="shrink-0 px-4 pb-5">
          <h2 className="text-sm font-semibold text-ink">Search method</h2>
          <div className="mt-2 space-y-0.5" role="radiogroup" aria-label="Search method">
            {(['auto', 'local', 'global', 'hybrid'] as const).map(mode => {
              const selected = routeMode === mode;
              return (
                <button
                  key={mode}
                  id={`route-${mode}-btn`}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRouteMode(mode)}
                  className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                    }`}
                >
                  <span
                    className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${mode === 'auto' ? 'bg-gradient-to-br from-local via-global to-hybrid' : ROUTE[mode].dot
                      }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${selected ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
                      {mode === 'auto' ? 'Auto' : ROUTE[mode].long}
                    </span>
                    <span className="block text-xs leading-snug text-muted">
                      {mode === 'auto' ? 'The router picks a method for each question' : ROUTE[mode].meaning}
                    </span>
                  </span>
                  {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-ink" />}
                </button>
              );
            })}
          </div>
          {forcedNonLocal && (
            <p className="mt-2 rounded-lg bg-hybrid-bg px-3 py-2 text-xs leading-snug text-hybrid-ink">
              {scope === 'selected' ? 'Selected-documents mode' : 'Single-document mode'} always uses local search.
              Switch to All docs to use the graph.
            </p>
          )}
        </div>
      </aside>

      {/* ---------------- Centre: conversation ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/60 px-3 sm:px-5">
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open documents and options"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {scope === 'document' ? activeDoc?.filename : scope === 'all' ? 'All documents' : selectedIds.length === 0 ? 'No documents selected' : scopeSentence}
            </p>
          </div>
          <button
            onClick={() => setEvidenceOpen(true)}
            aria-label="Open evidence"
            className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <PanelRight className="h-[18px] w-[18px]" />
            {hasEvidence && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-global" />}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 py-8 sm:px-6">
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
                    className="mx-auto max-w-md text-center"
                  >
                    <span className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <FileText className="h-4 w-4" />
                    </span>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{msg.text}</p>
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
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[15px] text-ink">
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
                    className="flex items-start gap-3 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad"
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
                  className="min-w-0"
                >
                  {route && (
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
                      <RouteChip route={route} />
                      {msg.confidence != null && <span>{Math.round(msg.confidence * 100)}% confidence</span>}
                      {msg.latency_ms != null && msg.latency_ms > 0 && <span>{(msg.latency_ms / 1000).toFixed(1)} s</span>}
                      {msg.tokens_used != null && msg.tokens_used > 0 && (
                        <span title={msg.tokens_exact ? 'Token count reported by the model' : 'Estimated token count'}>
                          {msg.tokens_exact ? '' : '~'}
                          {fmtTokens(msg.tokens_used)} tokens
                        </span>
                      )}
                    </div>
                  )}

                  <div className="answer">{msg.text}</div>

                  {msg.scope_note && (
                    <p className="mt-3 rounded-lg bg-hybrid-bg px-3 py-2 text-[13px] leading-snug text-hybrid-ink">
                      {msg.scope_note}
                    </p>
                  )}

                  {hasSources && (
                    <div className="mt-5">
                      <p className="mb-2 text-[13px] font-semibold text-ink">Sources</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.community_citations?.map((c: CommunityCitation, i: number) => {
                          const selected =
                            selectedCitation?.type === 'community' &&
                            selectedCitation.data.community_id === c.community_id;
                          return (
                            <button
                              key={`comm-${i}`}
                              onClick={() => openCitation({ type: 'community', data: c, query })}
                              aria-pressed={selected}
                              className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${selected
                                  ? 'border-global bg-global-bg text-global-ink'
                                  : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2'
                                }`}
                            >
                              <GitFork className="h-3.5 w-3.5 shrink-0 text-global-ink" />
                              <span className="truncate font-medium">{c.title}</span>
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
                              className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${selected
                                  ? 'border-local bg-local-bg text-local-ink'
                                  : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2'
                                }`}
                            >
                              <BookOpen className="h-3.5 w-3.5 shrink-0 text-local-ink" />
                              <span className="max-w-[170px] truncate font-medium">{cite.filename}</span>
                              <span className="shrink-0 text-muted">chunk {cite.chunk_index}</span>
                            </button>
                          );
                        })}
                      </div>
                      {!!msg.entity_citations?.length && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                          {msg.entity_citations.map((ent, i) => (
                            <button
                              key={`ent-${i}`}
                              onClick={() => openCitation({ type: 'entity', data: { name: ent }, query })}
                              className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
                            >
                              <Network className="h-3 w-3" />
                              {ent}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {route && (
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-2">
                      <button
                        onClick={() => toggleTrace(msg.id)}
                        aria-expanded={open}
                        className="flex items-center gap-1 rounded-md py-1 pr-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
                      >
                        How it was routed
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleCopy(msg.text, msg.id)}
                          aria-label="Copy answer"
                          title="Copy"
                          className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          {copiedId === msg.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'positive')}
                          aria-label="Good answer"
                          aria-pressed={msg.feedback === 'positive'}
                          className={`rounded-md p-1.5 transition-colors hover:bg-surface-2 ${msg.feedback === 'positive' ? 'text-ok' : 'text-faint hover:text-ink'
                            }`}
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'negative')}
                          aria-label="Poor answer"
                          aria-pressed={msg.feedback === 'negative'}
                          className={`rounded-md p-1.5 transition-colors hover:bg-surface-2 ${msg.feedback === 'negative' ? 'text-bad' : 'text-faint hover:text-ink'
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
                        <div id={`trace-${msg.id}`} className="mb-1 mt-2 rounded-xl bg-surface px-4 py-4 ring-1 ring-line">
                          {rows && (
                            <>
                              <p className="mb-2.5 text-[13px] font-semibold text-ink">{rows.title}</p>
                              <div className="space-y-2">
                                {rows.rows.map(r => (
                                  <div key={r.key} className="flex items-center gap-3 text-[13px]">
                                    <span
                                      className={`w-[88px] shrink-0 ${r.key === route ? 'font-semibold text-ink' : 'text-muted'
                                        }`}
                                    >
                                      {ROUTE[r.key].long}
                                    </span>
                                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                      <span
                                        className={`block h-full rounded-full ${ROUTE[r.key].bar} ${r.key === route ? '' : 'opacity-45'
                                          }`}
                                        style={{ width: `${Math.max(r.value * 100, 1.5)}%` }}
                                      />
                                    </span>
                                    <span className="w-10 shrink-0 text-right tabular-nums text-muted">
                                      {Math.round(r.value * 100)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {msg.reasoning && (
                            <p className={`text-[13px] leading-relaxed text-ink-2 ${rows ? 'mt-4' : ''}`}>
                              {msg.reasoning}
                            </p>
                          )}
                          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-[13px]">
                            <dt className="text-muted">Router</dt>
                            <dd className="text-ink-2">{classifierLabel(msg.classification?.classifier)}</dd>
                            {msg.model && (
                              <>
                                <dt className="text-muted">Answer model</dt>
                                <dd className="text-ink-2">{msg.model}</dd>
                              </>
                            )}
                            {msg.tokens_exact && msg.input_tokens != null && (
                              <>
                                <dt className="text-muted">Tokens</dt>
                                <dd className="tabular-nums text-ink-2">
                                  {msg.input_tokens.toLocaleString()} in, {(msg.output_tokens ?? 0).toLocaleString()} out
                                </dd>
                              </>
                            )}
                            {msg.cost_usd != null && msg.cost_usd > 0 && (
                              <>
                                <dt className="text-muted">Cost</dt>
                                <dd className="tabular-nums text-ink-2">${msg.cost_usd.toFixed(6)}</dd>
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
              <div className="flex flex-wrap justify-center gap-2">
                {['Summarize the key points', 'What are the main topics?', 'List all entities mentioned'].map(q => (
                  <button
                    key={q}
                    onClick={() => handleSendMessage(q)}
                    className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center gap-3 text-sm text-muted" role="status">
                <span className="flex items-center gap-1">
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink" />
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink" />
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink" />
                </span>
                Finding evidence and writing the answer
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-line bg-bg px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-[760px]">
            <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-[var(--shadow)] transition-colors focus-within:border-ink">
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
                placeholder={scope === 'document' ? 'Ask a question about your document' : 'Ask a question about your documents'}
                aria-label="Your question"
                className="max-h-[132px] min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] text-ink outline-none placeholder:text-faint"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputQuery.trim() || isProcessing || noSelection}
                aria-label="Send question"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition-opacity disabled:opacity-25"
              >
                <ArrowUp className="h-[18px] w-[18px]" />
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              {noSelection
                ? 'Tick at least one document in the list to ask a question.'
                : `Searching ${scopeSentence} using ${routeSummary}${forcedNonLocal ? '. This scope always uses local search.' : ''
                }`}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Right: evidence ---------------- */}
      <aside
        aria-label="Evidence"
        className={`fixed inset-y-0 right-0 z-40 flex w-[min(92vw,400px)] flex-col border-l border-line bg-surface transition-transform duration-200 lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:translate-x-0 ${evidenceOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-sm font-semibold text-ink">Evidence</h2>
          <button
            onClick={() => setEvidenceOpen(false)}
            aria-label="Close evidence"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={evidenceScrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!selectedCitation && (
            <div className="mt-10 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-faint">
                <BookOpen className="h-5 w-5" />
              </span>
              <p className="mt-4 text-sm font-medium text-ink">No source selected</p>
              <p className="mx-auto mt-1 max-w-[240px] text-sm text-muted">
                Pick a source under an answer to read the passage it came from.
              </p>
            </div>
          )}

          {selectedCitation?.type === 'chunk' && (
            <div>
              <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 pb-3 pt-5">
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-semibold text-ink">{selectedCitation.data.filename}</p>
                  <p className="text-[13px] text-muted">Chunk {selectedCitation.data.chunk_index}</p>
                </div>
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-local" title="Passage from vector search" />
              </div>
              <div className="passage border-l-2 border-local pl-4">
                <Highlighted text={selectedCitation.data.text || ''} query={selectedCitation.query} />
              </div>
              {selectedCitation.data.start_char != null && selectedCitation.data.end_char != null && (
                <p className="mt-4 text-[13px] text-muted">
                  Characters {selectedCitation.data.start_char} to {selectedCitation.data.end_char} of the document
                </p>
              )}
            </div>
          )}

          {selectedCitation?.type === 'community' && (
            <div>
              <div className="flex items-start gap-2.5">
                <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-global-ink" />
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-semibold text-ink">{selectedCitation.data.title}</p>
                  <p className="text-[13px] text-muted">Knowledge graph community</p>
                </div>
              </div>
              <p className="passage mt-4 border-l-2 border-global pl-4">{selectedCitation.data.summary}</p>
              {selectedCitation.data.member_names?.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-[13px] font-semibold text-ink">
                    Entities in this community ({selectedCitation.data.member_count})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCitation.data.member_names.map((name: string, i: number) => (
                      <span key={i} className="rounded-md bg-surface-2 px-2 py-0.5 text-[13px] text-ink-2">
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
              <div className="flex items-start gap-2.5">
                <Network className="mt-0.5 h-4 w-4 shrink-0 text-global-ink" />
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-semibold text-ink">{selectedCitation.data.name}</p>
                  <p className="text-[13px] text-muted">Entity from the knowledge graph</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                This entity was extracted from your documents. It appears in relationships and in the community
                summaries the answer was built from.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};