import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, FileText, RefreshCw } from 'lucide-react';

/* ----------------------------- Types ----------------------------- */

interface DocStat {
    document_id: number;
    filename: string;
    file_type: string;
    file_size: number;
    status: string;
    chunk_count: number;
    avg_tokens: number;
    min_tokens: number;
    max_tokens: number;
    total_tokens: number;
    uploaded_at: string | null;
}

interface ChunkStats {
    total_documents: number;
    total_chunks: number;
    total_tokens: number;
    avg_tokens_per_chunk: number;
    min_tokens: number;
    max_tokens: number;
    histogram: { bucket: string; count: number }[];
    documents: DocStat[];
    vector_index: {
        total_vectors: number;
        dimension: number;
        index_type: string;
        provider_info?: { provider?: string; model?: string };
    };
}

interface ChunkRow {
    chunk_id: number;
    document_id: number;
    filename: string;
    chunk_index: number;
    text: string;
    token_estimate: number;
    char_length: number;
    start_char: number;
    end_char: number;
}

interface ChunkList {
    total: number;
    limit: number;
    offset: number;
    chunks: ChunkRow[];
}

interface RouteStat {
    queries: number;
    avg_latency_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    avg_tokens: number;
    total_tokens: number;
    avg_cost_usd: number;
    total_cost_usd: number;
    avg_confidence: number;
}

interface BenchmarkSystem {
    name: string;
    mode?: string;
    recall_at_k?: number;
    all_gold_at_k?: number;
    mrr?: number;
    recall_by_k?: Record<string, number>;
    all_gold_by_type?: Record<string, number>;
    avg_latency_ms?: number;
    p95_latency_ms?: number;
    avg_context_tokens?: number;
}

interface BenchmarkDataset {
    name: string;
    kind?: string;
    num_questions: number;
    num_dropped?: number;
    num_documents: number;
    num_chunks: number;
    chunk_size?: number;
    headline_k: number;
    embedding?: { provider: string; model: string; dimension: number };
    avg_query_embedding_ms?: number;
    systems: BenchmarkSystem[];
}

interface Benchmark {
    error?: string;
    generated_at?: string;
    datasets?: BenchmarkDataset[];
}

interface Efficiency {
    total_queries: number;
    per_route: Record<string, RouteStat>;
    route_mix: { route: string; queries: number; share: number }[];
    recent_queries: {
        query: string;
        route: string;
        confidence: number;
        latency_ms: number;
        tokens: number;
        cost_usd: number;
        created_at: string | null;
    }[];
    benchmark: Benchmark | null;
    router_eval?: RouterEval | null;
}

interface ClassMetrics {
    precision: number;
    recall: number;
    f1: number;
    support: number;
}

interface RouterModelEval {
    test_accuracy: number;
    train_accuracy?: number;
    ci95?: [number, number];
    per_class: Record<string, ClassMetrics>;
    confusion: Record<string, Record<string, number>>;
}

interface RouterEval {
    error?: string;
    generated_at?: string;
    train_size?: number;
    test_size?: number;
    learned?: RouterModelEval;
    keyword?: RouterModelEval;
    hard_test?: {
        size: number;
        learned_accuracy: number;
        keyword_accuracy: number;
        misclassified?: { query: string; true: string; predicted: string }[];
    };
}


/* ----------------------------- Constants and helpers ----------------------------- */

type RouteKey = 'local' | 'global' | 'hybrid';
const ROUTES: RouteKey[] = ['local', 'global', 'hybrid'];

const ROUTE: Record<RouteKey, { label: string; chip: string; dot: string; bar: string; ink: string }> = {
    local: { label: 'Local search', chip: 'bg-local-bg text-local-ink', dot: 'bg-local', bar: 'bg-local', ink: 'text-local-ink' },
    global: { label: 'Global graph', chip: 'bg-global-bg text-global-ink', dot: 'bg-global', bar: 'bg-global', ink: 'text-global-ink' },
    hybrid: { label: 'Hybrid', chip: 'bg-hybrid-bg text-hybrid-ink', dot: 'bg-hybrid', bar: 'bg-hybrid', ink: 'text-hybrid-ink' }
};

const PAGE_SIZE = 10;

interface Props {
    apiBase?: string;
}

// Fetch JSON, with a helpful message when the dev-server proxy is not set up (it returns HTML instead)
async function getJson(url: string) {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `${url} did not return JSON. Check that vite.config.ts proxies /chunks and /metrics to port 8000, then restart npm run dev.`
        );
    }
}

const fmtNum = (n: number | undefined | null, digits = 0) =>
    n === undefined || n === null ? '-' : n.toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (v: number | undefined | null, digits = 1) =>
    v === undefined || v === null ? '-' : `${(v * 100).toFixed(digits)}%`;
const fmtBytes = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ----------------------------- Small building blocks ----------------------------- */

const Segmented: React.FC<{
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    label: string;
}> = ({ value, onChange, options, label }) => (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
        {options.map(o => (
            <button
                key={o.value}
                role="radio"
                aria-checked={value === o.value}
                onClick={() => onChange(o.value)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                    }`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

/** A strip of headline numbers divided by hairlines instead of separate cards. */
const StatStrip: React.FC<{ items: { label: string; value: string; hint?: string }[]; loading?: boolean }> = ({
    items,
    loading
}) => (
    <dl className="grid grid-cols-2 gap-y-6 border-y border-line py-5 lg:grid-cols-4 lg:gap-y-0">
        {items.map((it, i) => (
            <div key={it.label} className={`px-1 lg:px-6 ${i > 0 ? 'lg:border-l lg:border-line' : 'lg:pl-0'}`}>
                <dt className="text-[13px] text-muted">{it.label}</dt>
                <dd className="mt-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-ink">
                    {loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-surface-2" /> : it.value}
                </dd>
                {it.hint && <p className="mt-1.5 truncate text-[13px] text-muted">{it.hint}</p>}
            </div>
        ))}
    </dl>
);

const SectionHead: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({ title, sub, right }) => (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
            {sub && <p className="mt-1 text-sm leading-relaxed text-muted">{sub}</p>}
        </div>
        {right}
    </div>
);

const RouteLabel: React.FC<{ route: string }> = ({ route }) => {
    const r = ROUTE[route as RouteKey];
    if (!r) return <span className="text-ink-2">{route}</span>;
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${r.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
            {r.label}
        </span>
    );
};

const EmptyNote: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="rounded-xl border border-dashed border-line-strong px-5 py-6">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
);

/* ----------------------------- Benchmark ----------------------------- */

type Metric = 'all_gold' | 'recall' | 'mrr';

const METRIC_INFO: Record<Metric, { label: string; explain: (k: number) => string }> = {
    all_gold: {
        label: 'All evidence found',
        explain: k => `Share of questions where every needed passage appears in the top ${k} results. This is the multi-hop test.`
    },
    recall: {
        label: 'Recall',
        explain: k => `Share of the needed passages that appear in the top ${k} results.`
    },
    mrr: {
        label: 'Ranking (MRR)',
        explain: () => 'How high the first correct passage is ranked. 1.0 means it is always first.'
    }
};

const metricValue = (s: BenchmarkSystem, m: Metric): number | undefined =>
    m === 'all_gold' ? s.all_gold_at_k : m === 'recall' ? s.recall_at_k : s.mrr;

const BenchmarkDatasetView: React.FC<{ d: BenchmarkDataset; metric: Metric }> = ({ d, metric }) => {
    const k = d.headline_k;
    const values = d.systems.map(s => metricValue(s, metric) ?? 0);
    const best = Math.max(0, ...values);
    const bestAll = Math.max(0, ...d.systems.map(s => s.all_gold_at_k ?? 0));
    const winner = d.systems.find(s => (metricValue(s, metric) ?? 0) === best);
    const fmtMetric = (v: number) => (metric === 'mrr' ? v.toFixed(3) : pct(v));

    return (
        <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[15px] font-semibold text-ink">{d.name}</h3>
                <p className="text-[13px] text-muted">
                    {d.num_questions} questions, {d.num_documents} documents, {d.num_chunks} chunks
                    {d.chunk_size ? ` of about ${d.chunk_size} tokens` : ''}
                </p>
            </div>
            {(d.embedding || d.num_dropped) && (
                <p className="mt-0.5 text-[13px] text-muted">
                    {d.embedding ? `Embeddings: ${d.embedding.model}, ${d.embedding.dimension} dimensions. ` : ''}
                    {d.num_dropped ? `${d.num_dropped} questions without usable gold evidence were skipped.` : ''}
                </p>
            )}

            {/* Bar chart: one row per retrieval setup */}
            <div className="mt-5 space-y-2.5" role="list" aria-label={`${METRIC_INFO[metric].label} by retrieval setup`}>
                {d.systems.map(s => {
                    const v = metricValue(s, metric) ?? 0;
                    const isBest = v === best && best > 0;
                    return (
                        <div key={s.name} role="listitem" className="grid grid-cols-[minmax(0,150px)_1fr_58px] items-center gap-3 sm:grid-cols-[200px_1fr_64px]">
                            <span className={`truncate text-sm ${isBest ? 'font-semibold text-ink' : 'text-ink-2'}`} title={s.name}>
                                {s.name}
                            </span>
                            <span className="h-3 overflow-hidden rounded-full bg-surface-2">
                                <span
                                    className={`block h-full rounded-full transition-[width] duration-500 ${isBest ? 'bg-ink' : 'bg-line-strong'}`}
                                    style={{ width: `${Math.max(v * 100, 0.8)}%` }}
                                />
                            </span>
                            <span className={`text-right text-sm tabular-nums ${isBest ? 'font-semibold text-ink' : 'text-muted'}`}>
                                {fmtMetric(v)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {winner && (
                <p className="mt-4 text-sm text-ink-2">
                    Best on this measure: <span className="font-semibold text-ink">{winner.name}</span> at {fmtMetric(best)}.
                </p>
            )}

            {/* Full numbers */}
            <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-[13px] text-muted">
                            <th className="py-2 pr-3 font-medium">Retrieval setup</th>
                            <th className="py-2 pr-3 text-right font-medium">Recall@{k}</th>
                            <th className="py-2 pr-3 text-right font-medium">All found@{k}</th>
                            <th className="py-2 pr-3 text-right font-medium">MRR</th>
                            <th className="py-2 pr-3 text-right font-medium">Search time</th>
                            <th className="py-2 text-right font-medium">Context tokens</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.systems.map(s => (
                            <tr key={s.name} className="border-b border-line/70">
                                <td className="py-2 pr-3 font-medium text-ink">{s.name}</td>
                                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{pct(s.recall_at_k)}</td>
                                <td
                                    className={`py-2 pr-3 text-right tabular-nums ${(s.all_gold_at_k ?? 0) === bestAll && bestAll > 0 ? 'font-semibold text-ink' : 'text-ink-2'
                                        }`}
                                >
                                    {pct(s.all_gold_at_k)}
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{s.mrr !== undefined ? s.mrr.toFixed(3) : '-'}</td>
                                <td className="py-2 pr-3 text-right tabular-nums text-muted">
                                    {s.avg_latency_ms !== undefined ? `${fmtNum(s.avg_latency_ms, 2)} ms` : '-'}
                                </td>
                                <td className="py-2 text-right tabular-nums text-muted">{fmtNum(s.avg_context_tokens, 0)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {d.avg_query_embedding_ms ? (
                <p className="mt-2 text-[13px] text-muted">
                    Search time leaves out embedding the question, which takes about {fmtNum(d.avg_query_embedding_ms, 0)} ms
                    through the embedding API.
                </p>
            ) : null}
        </div>
    );
};

const BenchmarkSection: React.FC<{ benchmark?: Benchmark | null }> = ({ benchmark }) => {
    const [metric, setMetric] = useState<Metric>('all_gold');
    const datasets = benchmark && !benchmark.error ? benchmark.datasets ?? [] : [];

    // Honest cross-dataset takeaway, computed from the data rather than written in advance
    const takeaway = useMemo(() => {
        if (datasets.length < 2) return null;
        const winners = datasets.map(d => {
            const best = Math.max(0, ...d.systems.map(s => s.all_gold_at_k ?? 0));
            return d.systems.find(s => (s.all_gold_at_k ?? 0) === best)?.name;
        });
        return new Set(winners).size > 1
            ? 'The best retrieval setup is different on each dataset, so no single setting wins everywhere. Measuring on your own documents matters.'
            : null;
    }, [datasets]);

    return (
        <section>
            <SectionHead
                title="Retrieval benchmark"
                sub="Seven retrieval setups, scored on questions with known answers. These run on the real AdaptiRAG index code, not a simulation."
                right={
                    datasets.length > 0 && (
                        <Segmented
                            label="Measure"
                            value={metric}
                            onChange={v => setMetric(v as Metric)}
                            options={(Object.keys(METRIC_INFO) as Metric[]).map(m => ({ value: m, label: METRIC_INFO[m].label }))}
                        />
                    )
                }
            />
            {datasets.length > 0 ? (
                <>
                    <p className="-mt-2 mb-6 text-sm text-muted">{METRIC_INFO[metric].explain(datasets[0].headline_k)}</p>
                    <div className="space-y-12">
                        {datasets.map(d => (
                            <BenchmarkDatasetView key={d.name} d={d} metric={metric} />
                        ))}
                    </div>
                    {takeaway && (
                        <p className="mt-8 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink-2">{takeaway}</p>
                    )}
                    {benchmark?.generated_at && (
                        <p className="mt-4 text-[13px] text-muted">Last run {fmtDate(benchmark.generated_at)}.</p>
                    )}
                </>
            ) : (
                <EmptyNote title="No benchmark results yet">
                    {benchmark?.error ?? 'Run scripts/benchmark.py and the results will appear here.'}
                </EmptyNote>
            )}
        </section>
    );
};

/* ----------------------------- Router accuracy ----------------------------- */

const Confusion: React.FC<{ title: string; m: RouterModelEval }> = ({ title, m }) => {
    const maxCell = Math.max(1, ...ROUTES.flatMap(t => ROUTES.map(p => m.confusion?.[t]?.[p] ?? 0)));
    return (
        <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mb-2 text-[13px] text-muted">{pct(m.test_accuracy)} correct on the test set</p>
            <table className="w-full max-w-[340px] border-separate border-spacing-1 text-sm">
                <thead>
                    <tr>
                        <th className="p-1 text-left text-[12px] font-normal text-muted">Actual / predicted</th>
                        {ROUTES.map(r => (
                            <th key={r} className="p-1 text-center text-[12px] font-medium text-muted">
                                {r}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ROUTES.map(t => (
                        <tr key={t}>
                            <td className="p-1 text-[13px] font-medium text-ink-2">{t}</td>
                            {ROUTES.map(p => {
                                const v = m.confusion?.[t]?.[p] ?? 0;
                                const diag = t === p;
                                const a = 14 + 52 * (v / maxCell);
                                return (
                                    <td
                                        key={p}
                                        className="rounded-md p-2 text-center tabular-nums text-ink"
                                        style={{
                                            background:
                                                v > 0
                                                    ? `color-mix(in srgb, var(${diag ? '--ok' : '--bad'}) ${a}%, transparent)`
                                                    : 'var(--surface-2)'
                                        }}
                                    >
                                        {v}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const CompareBar: React.FC<{ label: string; value: number; strong?: boolean; sub?: string }> = ({ label, value, strong, sub }) => (
    <div className="grid grid-cols-[130px_1fr_58px] items-center gap-3 sm:grid-cols-[160px_1fr_64px]">
        <span className={`text-sm ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>
            {label}
            {sub && <span className="block text-[12px] font-normal text-muted">{sub}</span>}
        </span>
        <span className="h-3 overflow-hidden rounded-full bg-surface-2">
            <span className={`block h-full rounded-full ${strong ? 'bg-ink' : 'bg-line-strong'}`} style={{ width: `${value * 100}%` }} />
        </span>
        <span className={`text-right text-sm tabular-nums ${strong ? 'font-semibold text-ink' : 'text-muted'}`}>{pct(value)}</span>
    </div>
);

const RouterSection: React.FC<{ data?: RouterEval | null }> = ({ data }) => {
    const ok = !!data && !data.error && !!data.learned && !!data.keyword;
    return (
        <section>
            <SectionHead
                title="Router accuracy"
                sub="How often the router picks the right search method for a question. The learned router is compared with the original keyword rules on questions it never saw during training."
            />
            {ok ? (
                <>
                    <div className="space-y-3">
                        <CompareBar label="Learned router" sub={`${data!.test_size} test questions`} value={data!.learned!.test_accuracy} strong />
                        <CompareBar label="Keyword rules" sub="original baseline" value={data!.keyword!.test_accuracy} />
                        {data!.hard_test && (
                            <>
                                <div className="my-1 border-t border-line" />
                                <CompareBar label="Learned, hard set" sub={`${data!.hard_test.size} tricky questions`} value={data!.hard_test.learned_accuracy} strong />
                                <CompareBar label="Keyword, hard set" value={data!.hard_test.keyword_accuracy} />
                            </>
                        )}
                    </div>
                    {data!.learned!.ci95 && (
                        <p className="mt-3 text-[13px] text-muted">
                            95% confidence interval for the learned router: {pct(data!.learned!.ci95[0], 0)} to {pct(data!.learned!.ci95[1], 0)}.
                            Trained on {data!.train_size} questions.
                        </p>
                    )}

                    <div className="mt-8 overflow-x-auto">
                        <table className="w-full min-w-[460px] text-sm">
                            <thead>
                                <tr className="border-b border-line text-left text-[13px] text-muted">
                                    <th className="py-2 pr-3 font-medium">Route</th>
                                    <th className="py-2 pr-3 text-right font-medium">Precision</th>
                                    <th className="py-2 pr-3 text-right font-medium">Recall</th>
                                    <th className="py-2 pr-3 text-right font-medium">F1</th>
                                    <th className="py-2 text-right font-medium">Test questions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ROUTES.map(r => {
                                    const c = data!.learned!.per_class[r];
                                    if (!c) return null;
                                    return (
                                        <tr key={r} className="border-b border-line/70">
                                            <td className="py-2 pr-3">
                                                <RouteLabel route={r} />
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{pct(c.precision)}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{pct(c.recall)}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{pct(c.f1)}</td>
                                            <td className="py-2 text-right tabular-nums text-muted">{c.support}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-8 grid gap-8 sm:grid-cols-2">
                        <Confusion title="Learned router" m={data!.learned!} />
                        <Confusion title="Keyword rules" m={data!.keyword!} />
                    </div>

                    {data!.hard_test?.misclassified && data!.hard_test.misclassified.length > 0 && (
                        <div className="mt-8">
                            <p className="mb-2 text-sm font-semibold text-ink">Hard-set mistakes</p>
                            <ul className="divide-y divide-line border-y border-line">
                                {data!.hard_test.misclassified.map((x, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                                        <span className="min-w-0 flex-1 font-serif text-ink-2">"{x.query}"</span>
                                        <span className="flex items-center gap-2 text-[13px] text-muted">
                                            should be <RouteLabel route={x.true} /> got <RouteLabel route={x.predicted} />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <p className="mt-5 text-[13px] leading-relaxed text-muted">
                        The project team wrote the labels, not an independent annotator, so read this as an internal evaluation. The
                        hard set was kept out of training completely.
                    </p>
                </>
            ) : (
                <EmptyNote title="No router evaluation found">
                    {data?.error ?? 'Run scripts/train_router.py to generate data/router_eval.json.'}
                </EmptyNote>
            )}
        </section>
    );
};

/* ----------------------------- Live usage ----------------------------- */

const UsageTab: React.FC<{ eff: Efficiency | null; loading: boolean }> = ({ eff, loading }) => {
    const has = !!eff && eff.total_queries > 0;
    const totalCost = eff ? ROUTES.reduce((a, r) => a + (eff.per_route[r]?.total_cost_usd ?? 0), 0) : 0;
    const totalTokens = eff ? ROUTES.reduce((a, r) => a + (eff.per_route[r]?.total_tokens ?? 0), 0) : 0;

    return (
        <div className="space-y-12">
            <StatStrip
                loading={loading && !eff}
                items={[
                    { label: 'Questions answered', value: fmtNum(eff?.total_queries) },
                    { label: 'Tokens used', value: fmtNum(totalTokens), hint: 'estimated' },
                    { label: 'Estimated cost', value: `$${totalCost.toFixed(4)}`, hint: 'Gemini Flash pricing' },
                    {
                        label: 'Average confidence',
                        value: has
                            ? pct(
                                ROUTES.reduce((a, r) => a + (eff!.per_route[r].avg_confidence || 0) * eff!.per_route[r].queries, 0) /
                                eff!.total_queries,
                                0
                            )
                            : '-'
                    }
                ]}
            />

            <section>
                <SectionHead title="How questions were routed" sub="The share of questions that went to each search method." />
                {has ? (
                    <>
                        <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Route mix">
                            {eff!.route_mix
                                .filter(m => m.share > 0)
                                .map(m => (
                                    <div
                                        key={m.route}
                                        className={`${ROUTE[m.route as RouteKey].bar} first:rounded-l-full last:rounded-r-full`}
                                        style={{ width: `${m.share * 100}%` }}
                                        title={`${ROUTE[m.route as RouteKey].label}: ${m.queries}`}
                                    />
                                ))}
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-3">
                            {eff!.route_mix.map(m => (
                                <div key={m.route} className="flex items-baseline gap-3">
                                    <RouteLabel route={m.route} />
                                    <span className="text-xl font-semibold tabular-nums text-ink">{pct(m.share, 0)}</span>
                                    <span className="text-[13px] text-muted">{m.queries} questions</span>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <EmptyNote title="No questions yet">Ask something in the chat and its route shows up here.</EmptyNote>
                )}
            </section>

            <section>
                <SectionHead
                    title="Speed, tokens and cost by route"
                    sub="Latency is measured for every request. Token counts and cost are estimates."
                />
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-[13px] text-muted">
                                <th className="py-2 pr-3 font-medium">Route</th>
                                <th className="py-2 pr-3 text-right font-medium">Questions</th>
                                <th className="py-2 pr-3 text-right font-medium">Average time</th>
                                <th className="py-2 pr-3 text-right font-medium">Median</th>
                                <th className="py-2 pr-3 text-right font-medium">Slowest 5%</th>
                                <th className="py-2 pr-3 text-right font-medium">Avg tokens</th>
                                <th className="py-2 text-right font-medium">Avg cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ROUTES.map(r => {
                                const s = eff?.per_route[r];
                                const any = !!s && s.queries > 0;
                                return (
                                    <tr key={r} className="border-b border-line/70">
                                        <td className="py-2.5 pr-3">
                                            <RouteLabel route={r} />
                                        </td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{s?.queries ?? 0}</td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums text-ink">{any ? `${fmtNum(s!.avg_latency_ms / 1000, 2)} s` : '-'}</td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{any ? `${fmtNum(s!.p50_latency_ms / 1000, 2)} s` : '-'}</td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{any ? `${fmtNum(s!.p95_latency_ms / 1000, 2)} s` : '-'}</td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{any ? fmtNum(s!.avg_tokens, 0) : '-'}</td>
                                        <td className="py-2.5 text-right tabular-nums text-muted">{any ? `$${s!.avg_cost_usd.toFixed(5)}` : '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section>
                <SectionHead title="Recent questions" />
                {eff && eff.recent_queries.length > 0 ? (
                    <ul className="divide-y divide-line border-y border-line">
                        {eff.recent_queries.map((q, i) => (
                            <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                                <span className="min-w-0 flex-1 basis-64 truncate font-serif text-[15px] text-ink" title={q.query}>
                                    {q.query}
                                </span>
                                <RouteLabel route={q.route} />
                                <span className="flex w-[210px] justify-end gap-4 text-[13px] tabular-nums text-muted">
                                    <span>{pct(q.confidence, 0)}</span>
                                    <span>{fmtNum(q.latency_ms / 1000, 1)} s</span>
                                    <span>{fmtNum(q.tokens)} tokens</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyNote title="Nothing logged yet">Questions you ask in the chat are listed here, newest first.</EmptyNote>
                )}
            </section>
        </div>
    );
};

/* ----------------------------- Component ----------------------------- */

type Tab = 'results' | 'usage' | 'chunks';

export const EfficiencyChunksPage: React.FC<Props> = ({ apiBase = '' }) => {
    const [tab, setTab] = useState<Tab>('results');
    const [stats, setStats] = useState<ChunkStats | null>(null);
    const [eff, setEff] = useState<Efficiency | null>(null);
    const [chunkList, setChunkList] = useState<ChunkList | null>(null);
    const [docFilter, setDocFilter] = useState<number | null>(null);
    const [page, setPage] = useState(0);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [s, e] = await Promise.all([getJson(`${apiBase}/chunks/stats`), getJson(`${apiBase}/metrics/efficiency`)]);
            setStats(s);
            setEff(e);
        } catch (err: any) {
            setError(err?.message || 'Could not reach the backend. Is it running on port 8000?');
        } finally {
            setLoading(false);
        }
    }, [apiBase]);

    const loadChunks = useCallback(async () => {
        try {
            const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
            if (docFilter !== null) params.set('document_id', String(docFilter));
            setChunkList(await getJson(`${apiBase}/chunks?${params.toString()}`));
        } catch (err: any) {
            setError(err?.message || 'Could not load chunks.');
        }
    }, [apiBase, page, docFilter]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);
    useEffect(() => {
        loadChunks();
    }, [loadChunks]);

    const refresh = () => {
        loadSummary();
        loadChunks();
    };

    const maxBucket = useMemo(() => Math.max(1, ...(stats?.histogram.map(h => h.count) ?? [1])), [stats]);
    const totalPages = chunkList ? Math.max(1, Math.ceil(chunkList.total / PAGE_SIZE)) : 1;

    const toggle = (id: number) =>
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const tabs: { key: Tab; label: string }[] = [
        { key: 'results', label: 'Results' },
        { key: 'usage', label: 'Live usage' },
        { key: 'chunks', label: 'Chunks' }
    ];

    return (
        <div className="min-h-full bg-bg">
            {/* Page title */}
            <div className="mx-auto max-w-5xl px-5 pt-7 sm:px-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-2xl">
                        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Efficiency and chunks</h1>
                        <p className="mt-1 text-sm leading-relaxed text-muted">
                            How well retrieval and routing work, how your documents were split, and what each question cost. Every
                            number comes from your own database, query logs and benchmark runs.
                        </p>
                    </div>
                    <button
                        onClick={refresh}
                        className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Tabs stay visible while scrolling */}
            <div className="sticky top-0 z-10 mt-5 border-b border-line bg-bg">
                <nav className="mx-auto flex max-w-5xl gap-1 px-5 pt-1 sm:px-8" aria-label="Sections">
                    {tabs.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            aria-current={tab === t.key ? 'page' : undefined}
                            className={`relative px-3 pb-3 pt-2 text-sm font-medium transition-colors ${tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'
                                }`}
                        >
                            {t.label}
                            {tab === t.key && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" />}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
                {error && (
                    <div role="alert" className="mb-8 flex items-start gap-3 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* ============================ RESULTS ============================ */}
                {tab === 'results' && (
                    <div className="space-y-16">
                        <BenchmarkSection benchmark={eff?.benchmark} />
                        <div className="border-t border-line pt-12">
                            <RouterSection data={eff?.router_eval} />
                        </div>
                    </div>
                )}

                {/* ============================ LIVE USAGE ============================ */}
                {tab === 'usage' && <UsageTab eff={eff} loading={loading} />}

                {/* ============================ CHUNKS ============================ */}
                {tab === 'chunks' && (
                    <div className="space-y-12">
                        <StatStrip
                            loading={loading && !stats}
                            items={[
                                { label: 'Documents', value: fmtNum(stats?.total_documents) },
                                { label: 'Chunks created', value: fmtNum(stats?.total_chunks), hint: `${fmtNum(stats?.total_tokens)} tokens in total` },
                                {
                                    label: 'Average chunk size',
                                    value: `${fmtNum(stats?.avg_tokens_per_chunk, 0)} tokens`,
                                    hint: `smallest ${fmtNum(stats?.min_tokens)}, largest ${fmtNum(stats?.max_tokens)}`
                                },
                                {
                                    label: 'Vectors in the index',
                                    value: fmtNum(stats?.vector_index.total_vectors),
                                    hint: `${stats?.vector_index.dimension ?? '-'} dimensions`
                                }
                            ]}
                        />

                        <section>
                            <SectionHead
                                title="Chunk size distribution"
                                sub="Documents are split at sentence boundaries into chunks of about 600 tokens, each sharing about 100 tokens with the one before it. Most chunks should sit near the target; the last chunk of a document is usually smaller."
                            />
                            {stats && stats.total_chunks > 0 ? (
                                <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Number of chunks per token size range">
                                    {stats.histogram.map(h => (
                                        <div key={h.bucket} className="flex h-full flex-1 flex-col items-center justify-end">
                                            <span className="mb-1 text-[13px] tabular-nums text-ink-2">{h.count}</span>
                                            <div
                                                className="w-full rounded-t-md bg-ink/85 transition-[height] duration-500"
                                                style={{ height: `${Math.max(h.count > 0 ? 3 : 0, (h.count / maxBucket) * 100)}%` }}
                                            />
                                            <span className="mt-2 text-[12px] tabular-nums text-muted">{h.bucket}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptyNote title="No chunks yet">Upload a document in the Ask tab and its chunks appear here.</EmptyNote>
                            )}
                            {stats && stats.total_chunks > 0 && <p className="mt-2 text-center text-[13px] text-muted">Tokens per chunk</p>}
                        </section>

                        <section>
                            <SectionHead title="Documents" sub="Select a document to see only its chunks below." />
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-sm">
                                    <thead>
                                        <tr className="border-b border-line text-left text-[13px] text-muted">
                                            <th className="py-2 pr-3 font-medium">File</th>
                                            <th className="py-2 pr-3 font-medium">Size</th>
                                            <th className="py-2 pr-3 font-medium">Status</th>
                                            <th className="py-2 pr-3 text-right font-medium">Chunks</th>
                                            <th className="py-2 pr-3 text-right font-medium">Avg tokens</th>
                                            <th className="py-2 text-right font-medium">Total tokens</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats?.documents.map(d => {
                                            const sel = docFilter === d.document_id;
                                            return (
                                                <tr
                                                    key={d.document_id}
                                                    tabIndex={0}
                                                    aria-selected={sel}
                                                    onClick={() => {
                                                        setDocFilter(sel ? null : d.document_id);
                                                        setPage(0);
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            setDocFilter(sel ? null : d.document_id);
                                                            setPage(0);
                                                        }
                                                    }}
                                                    className={`cursor-pointer border-b border-line/70 transition-colors ${sel ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                                                        }`}
                                                >
                                                    <td className="py-2.5 pr-3">
                                                        <span className="inline-flex items-center gap-2">
                                                            <FileText className="h-4 w-4 shrink-0 text-faint" />
                                                            <span className={`max-w-[280px] truncate ${sel ? 'font-semibold text-ink' : 'text-ink'}`}>{d.filename}</span>
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 pr-3 tabular-nums text-muted">{fmtBytes(d.file_size)}</td>
                                                    <td className="py-2.5 pr-3">
                                                        <span
                                                            className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${d.status === 'ready'
                                                                    ? 'bg-ok-bg text-ok'
                                                                    : d.status === 'error'
                                                                        ? 'bg-bad-bg text-bad'
                                                                        : 'bg-hybrid-bg text-hybrid-ink'
                                                                }`}
                                                        >
                                                            {d.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">{d.chunk_count}</td>
                                                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted">{fmtNum(d.avg_tokens, 0)}</td>
                                                    <td className="py-2.5 text-right tabular-nums text-muted">{fmtNum(d.total_tokens)}</td>
                                                </tr>
                                            );
                                        })}
                                        {stats && stats.documents.length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="py-6 text-muted">
                                                    No documents uploaded yet.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section>
                            <SectionHead
                                title={docFilter !== null ? 'Chunks in the selected document' : 'All chunks'}
                                sub={`${chunkList?.total ?? 0} in total. Open a chunk to read exactly what was stored and embedded.`}
                                right={
                                    docFilter !== null && (
                                        <button
                                            onClick={() => {
                                                setDocFilter(null);
                                                setPage(0);
                                            }}
                                            className="text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
                                        >
                                            Show all documents
                                        </button>
                                    )
                                }
                            />
                            <ul className="divide-y divide-line border-y border-line">
                                {chunkList?.chunks.map(c => {
                                    const open = expanded.has(c.chunk_id);
                                    return (
                                        <li key={c.chunk_id}>
                                            <button
                                                onClick={() => toggle(c.chunk_id)}
                                                aria-expanded={open}
                                                className="flex w-full items-start justify-between gap-4 py-3 text-left"
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                                                        <span className="text-sm font-semibold text-ink">
                                                            {c.filename}, chunk {c.chunk_index}
                                                        </span>
                                                        <span className="text-[13px] tabular-nums text-muted">
                                                            {c.token_estimate} tokens, {c.char_length} characters
                                                        </span>
                                                    </span>
                                                    {!open && <span className="mt-1 block truncate font-serif text-[15px] text-ink-2">{c.text.replace(/\s+/g, ' ')}</span>}
                                                </span>
                                                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                                            </button>
                                            {open && (
                                                <div className="pb-4">
                                                    <p className="passage border-l-2 border-line-strong pl-4">{c.text}</p>
                                                    <p className="mt-2 pl-4 text-[13px] text-muted">
                                                        Characters {c.start_char} to {c.end_char} of the document
                                                    </p>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                                {chunkList && chunkList.chunks.length === 0 && <li className="py-6 text-sm text-muted">No chunks to show.</li>}
                            </ul>

                            {chunkList && chunkList.total > PAGE_SIZE && (
                                <div className="mt-4 flex items-center justify-between text-sm">
                                    <button
                                        disabled={page === 0}
                                        onClick={() => setPage(p => Math.max(0, p - 1))}
                                        className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                                    >
                                        Previous
                                    </button>
                                    <span className="tabular-nums text-muted">
                                        Page {page + 1} of {totalPages}
                                    </span>
                                    <button
                                        disabled={page + 1 >= totalPages}
                                        onClick={() => setPage(p => p + 1)}
                                        className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
};