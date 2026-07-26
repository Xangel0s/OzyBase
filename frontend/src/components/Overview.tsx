import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    Check,
    Copy,
    Database,
    ExternalLink,
    FolderOpen,
    Globe,
    Lock,
    MousePointer2,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Zap,
    Cpu,
    ArrowRight,
} from 'lucide-react';
import { fetchWithAuth, isAbortLikeError, readJsonIfOk } from '../utils/api';

// ─── Sparkline SVG (inline, no deps) ────────────────────────────────────────
const Sparkline = ({
    data,
    width = 120,
    height = 36,
    color = '#a3e635',
    fill = true,
}: {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
    fill?: boolean;
}) => {
    const points = data.length < 2 ? [] : (() => {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const pad = 2;
        return data.map((v, i) => {
            const x = pad + (i / (data.length - 1)) * (width - pad * 2);
            const y = pad + ((1 - (v - min) / range) * (height - pad * 2));
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
    })();

    if (points.length === 0) return <svg width={width} height={height} />;

    const polyline = points.join(' ');
    const areaPath = `M${points[0]} L${points.join(' L')} L${points[points.length - 1].split(',')[0]},${height} L${points[0].split(',')[0]},${height} Z`;

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <defs>
                <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            {fill && (
                <path d={areaPath} fill={`url(#sg-${color.replace('#', '')})`} />
            )}
            <polyline
                points={polyline}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
};

// ─── Activity bar chart (inline, no deps) ───────────────────────────────────
const ActivityBars = ({
    data,
    width = 80,
    height = 28,
    color = '#a3e635',
}: {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
}) => {
    const recent = data.slice(-20);
    if (recent.length === 0) return <svg width={width} height={height} />;
    const max = Math.max(...recent, 1);
    const barW = Math.floor((width - recent.length) / recent.length);
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            {recent.map((v, i) => {
                const barH = Math.max(2, (v / max) * height);
                return (
                    <rect
                        key={i}
                        x={i * (barW + 1)}
                        y={height - barH}
                        width={barW}
                        height={barH}
                        rx={1}
                        fill={color}
                        opacity={0.5 + (i / recent.length) * 0.5}
                    />
                );
            })}
        </svg>
    );
};

export function AgentSummaryCard({
    onClick,
    activeAgents,
    pendingApprovals,
    connectionStatus,
}: {
    onClick: () => void;
    activeAgents: number;
    pendingApprovals: number;
    connectionStatus: string;
}) {
    const isHealthy = connectionStatus === 'healthy';
    
    return (
        <div 
            onClick={onClick}
            className="group relative cursor-pointer border border-border bg-zinc-900/40 hover:bg-zinc-900/60 transition-all duration-300 rounded-md"
        >
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center border border-border bg-black/40 text-primary transition-transform group-hover:scale-105 rounded-md">
                        <Cpu size={20} strokeWidth={1.5} />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">Agent Engine</h3>
                            <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        </div>
                        <div className="mt-1 flex items-center gap-3">
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                                <span className="text-zinc-300">{activeAgents}</span> Active
                            </p>
                            <span className="h-1 w-1 rounded-full bg-zinc-800" />
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                                <span className={pendingApprovals > 0 ? 'text-amber-500' : 'text-zinc-300'}>{pendingApprovals}</span> Pending
                            </p>
                            <span className="h-1 w-1 rounded-full bg-zinc-800" />
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                                Connection: <span className={isHealthy ? 'text-emerald-400' : 'text-amber-400'}>{connectionStatus}</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-2 pr-4 border-r border-border">
                        <Activity size={12} className="text-zinc-700" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-700">Core_Linked</span>
                    </div>
                    <div className="flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-primary">Manage</span>
                        <ArrowRight size={14} className="text-primary" />
                    </div>
                </div>
            </div>
            
            <div className="absolute bottom-0 left-0 h-px w-0 bg-primary/20 transition-all duration-700 group-hover:w-full" />
        </div>
    );
}

interface OverviewProps {
    onTableSelect?: (tableName: string | null) => void;
    onViewSelect?: (view: string) => void;
}

interface ProjectInfo {
    name?: string;
    database?: string;
    api_url?: string;
    app_domain?: string;
    deploy_country_code?: string;
    db_size?: string;
    db_size_bytes?: number;
    user_table_count?: number;
    system_table_count?: number;
    function_count?: number;
    user_function_count?: number;
    schema_count?: number;
    user_schema_count?: number;
    version?: string;
    production?: {
        profile?: string;
    };
    metrics?: {
        db_requests?: number;
        auth_requests?: number;
        storage_requests?: number;
        realtime_requests?: number;
        cpu_history?: number[];
        ram_history?: number[];
        db?: number[];
        auth?: number[];
        storage?: number[];
        realtime?: number[];
    };
    slow_queries?: Array<{
        query: string;
        avg_time: number;
        calls: number;
    }>;
}

const formatBytes = (bytesValue: unknown) => {
    const bytes = Number(bytesValue);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = -1;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[idx]}`;
};

const formatCompactMetric = (value: unknown) => {
    const num = Number(value) || 0;
    if (num < 1000) return `${Math.round(num)}`;
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
};

const getLatestNumericSample = (series: unknown) => {
    if (!Array.isArray(series) || series.length === 0) return null;
    const last = Number(series[series.length - 1]);
    return Number.isFinite(last) ? last : null;
};

const resolveDomain = (projectInfo: ProjectInfo | null) => {
    const explicitDomain = String(projectInfo?.app_domain || '').trim();
    if (explicitDomain) {
        return explicitDomain;
    }

    const apiURL = String(projectInfo?.api_url || '').trim();
    if (!apiURL) {
        return 'localhost';
    }

    try {
        const hostname = new URL(apiURL).hostname;
        return hostname.replace(/^(api|app)\./i, '') || hostname;
    } catch {
        return apiURL.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }
};

const MetricTile = ({
    icon: Icon,
    label,
    value,
    hint,
    tone = 'default',
    onClick,
    testId,
    actionLabel,
}: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    value: string;
    hint: string;
    tone?: 'default' | 'accent' | 'success' | 'warning';
    onClick?: () => void;
    testId?: string;
    actionLabel?: string;
}) => {
    const toneClasses = {
        default: 'border-border bg-zinc-900/30 text-zinc-200',
        accent: 'border-primary/20 bg-primary/5 text-primary',
        success: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300/80',
        warning: 'border-amber-500/20 bg-amber-500/5 text-amber-200/80',
    };

    const Component = onClick ? 'button' : 'div';

    return (
        <Component
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            data-testid={testId}
            className={`rounded-md border p-4 text-left transition-all ${toneClasses[tone]} ${
                onClick ? 'group cursor-pointer hover:border-zinc-500 hover:bg-zinc-900/60 focus:outline-none focus:ring-1 focus:ring-primary/20' : ''
            }`}
        >
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-black/20">
                    <Icon size={16} className="opacity-70" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-wider opacity-50">{label}</p>
                    <p className="mt-0.5 text-xl font-bold leading-none tracking-tight">{value}</p>
                </div>
            </div>
            <p className="mt-3 text-[11px] text-zinc-600 line-clamp-2">{hint}</p>
            {onClick ? (
                <div className="mt-3 inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest opacity-40 transition-opacity group-hover:opacity-100 group-hover:text-primary">
                    {actionLabel || 'Open'}
                    <ArrowRight size={10} />
                </div>
            ) : null}
        </Component>
    );
};

const Overview: React.FC<OverviewProps> = ({ onViewSelect }) => {
    const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
    const [healthIssues, setHealthIssues] = useState<any[]>([]);
    const [copied, setCopied] = useState(false);
    const cardArenaRef = useRef<HTMLDivElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
    const [cardPosition, setCardPosition] = useState({ x: 0, y: 0 });
    const [cardPositionReady, setCardPositionReady] = useState(false);
    const [isDraggingCard, setIsDraggingCard] = useState(false);
    const clampCardPosition = useCallback((position: { x: number; y: number }) => {
        const arena = cardArenaRef.current;
        const card = cardRef.current;
        if (!arena || !card) {
            return position;
        }
        const padding = 28;
        const maxX = Math.max(padding, arena.clientWidth - card.offsetWidth - padding);
        const maxY = Math.max(padding, arena.clientHeight - card.offsetHeight - padding);
        return {
            x: Math.min(Math.max(position.x, padding), maxX),
            y: Math.min(Math.max(position.y, padding), maxY),
        };
    }, []);

    const centerDatabaseCard = useCallback((preserveCurrent: boolean) => {
        const arena = cardArenaRef.current;
        const card = cardRef.current;
        if (!arena || !card) {
            return;
        }

        const centered = {
            x: Math.max(28, (arena.clientWidth - card.offsetWidth) / 2),
            y: Math.max(28, (arena.clientHeight - card.offsetHeight) / 2),
        };

        setCardPosition((current) => {
            const next = preserveCurrent ? clampCardPosition(current) : centered;
            return next;
        });
        setCardPositionReady(true);
    }, [clampCardPosition]);

    const startCardDrag = useCallback((clientX: number, clientY: number, pointerId: number) => {
        const card = cardRef.current;
        if (!card) {
            return;
        }
        const cardRect = card.getBoundingClientRect();
        dragRef.current = {
            pointerId,
            offsetX: clientX - cardRect.left,
            offsetY: clientY - cardRect.top,
        };
        setIsDraggingCard(true);
    }, []);

    const loadData = useCallback(async (
        isActive: () => boolean = () => true,
        signal?: AbortSignal,
    ): Promise<boolean> => {
        try {
            const [infoResult, healthResult] = await Promise.allSettled([
                fetchWithAuth('/api/project/info', { signal }),
                fetchWithAuth('/api/project/health', { signal }),
            ]);

            if (infoResult.status === 'fulfilled') {
                const res = infoResult.value;
                if (res.status === 401 || res.status === 403) {
                    return false; // Unauthorized/forbidden - stop polling
                }
                const info = await readJsonIfOk<ProjectInfo>(res);
                if (info && isActive()) {
                    setProjectInfo(info);
                }
            }

            if (healthResult.status === 'fulfilled') {
                const res = healthResult.value;
                if (res.status === 401 || res.status === 403) {
                    return false;
                }
                const health = await readJsonIfOk<any>(res);
                if (isActive()) {
                    setHealthIssues(Array.isArray(health) ? health : []);
                }
            }
            return true;
        } catch (err) {
            if (!isAbortLikeError(err) && isActive()) {
                setHealthIssues((current) => current);
            }
            return true;
        }
    }, []);

    useEffect(() => {
        let active = true;
        let timerId: number | null = null;
        const abortController = new AbortController();
        const isActive = () => active;

        const runPoll = async () => {
            const shouldContinue = await loadData(isActive, abortController.signal);
            if (shouldContinue && active) {
                timerId = window.setTimeout(() => {
                    void runPoll();
                }, 5000);
            }
        };

        void runPoll();

        return () => {
            active = false;
            abortController.abort();
            if (timerId !== null) {
                window.clearTimeout(timerId);
            }
        };
    }, [loadData]);

    const securityIssues = useMemo(
        () => healthIssues.filter((issue: any) => issue.type === 'security').length,
        [healthIssues],
    );
    const performanceIssues = useMemo(
        () => healthIssues.filter((issue: any) => issue.type === 'performance').length,
        [healthIssues],
    );

    const databaseName = projectInfo?.database || projectInfo?.name || 'Primary Database';
    const domainLabel = resolveDomain(projectInfo);
    const apiUrl = projectInfo?.api_url || `https://${domainLabel}`;
    const databaseSizeLabel = useMemo(() => {
        const computed = formatBytes(projectInfo?.db_size_bytes);
        return computed || projectInfo?.db_size || 'Unknown size';
    }, [projectInfo]);
    const deployCountryCode = String(projectInfo?.deploy_country_code || '').trim().toLowerCase();
    const latestCPU = getLatestNumericSample(projectInfo?.metrics?.cpu_history);
    const latestRAM = getLatestNumericSample(projectInfo?.metrics?.ram_history);
    const productionProfile = String(projectInfo?.production?.profile || 'single_project_local')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());

    const status = useMemo(() => {
        if (securityIssues > 0) {
            return {
                label: 'Needs attention',
                hint: `${securityIssues} security issue${securityIssues === 1 ? '' : 's'} detected.`,
                tone: 'warning' as const,
                icon: ShieldAlert,
            };
        }
        if (performanceIssues > 0 || (latestCPU ?? 0) > 85 || (latestRAM ?? 0) > 85) {
            return {
                label: 'Under load',
                hint: 'Performance signals need a closer review.',
                tone: 'accent' as const,
                icon: Activity,
            };
        }
        return {
            label: 'Healthy',
            hint: 'Core services are responding normally.',
            tone: 'success' as const,
            icon: ShieldCheck,
        };
    }, [latestCPU, latestRAM, performanceIssues, securityIssues]);

    const copyProjectURL = async () => {
        await navigator.clipboard.writeText(apiUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => centerDatabaseCard(false));
        const handleResize = () => centerDatabaseCard(true);
        window.addEventListener('resize', handleResize);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', handleResize);
        };
    }, [centerDatabaseCard]);

    const visibleIssues = healthIssues.slice(0, 5);
    const slowQueries = Array.isArray(projectInfo?.slow_queries) ? projectInfo.slow_queries.slice(0, 5) : [];
    const userSchemaCount = Math.max(0, Number(projectInfo?.user_schema_count ?? 0));
    const userFunctionCount = Math.max(0, Number(projectInfo?.user_function_count ?? projectInfo?.function_count ?? 0));

    return (
        <div
            data-testid="overview-scroll-root"
            className="h-full min-h-0 overflow-y-auto bg-background px-6 py-6 font-sans animate-in fade-in duration-500 custom-scrollbar sm:px-8 xl:px-10"
        >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
                <section className="rounded-md border border-border bg-zinc-900/50 p-6 sm:p-8">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border bg-zinc-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                            Project overview
                        </span>
                        <span className="rounded-md border border-border bg-zinc-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                            {productionProfile}
                        </span>
                        <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                            {databaseSizeLabel}
                        </span>
                    </div>

                    <div className="mt-6 flex flex-wrap items-baseline gap-3">
                        <h1 className="text-4xl font-bold tracking-tight text-white uppercase italic">
                            {databaseName}
                        </h1>
                        <span className="text-xs font-mono text-zinc-600">
                            v{projectInfo?.version || '0.0.1'}
                        </span>
                    </div>

                    <p className="mt-4 max-w-2xl text-sm text-zinc-400 leading-relaxed uppercase tracking-tight">
                        Direct project summary for the live deployment. Domain, database identity and runtime signals are surfaced here without filler.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <a
                            href={apiUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-zinc-900/50 px-4 py-2 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-900"
                        >
                            <Globe size={14} className="text-primary" />
                            <span className="truncate">{apiUrl}</span>
                            <ExternalLink size={12} className="text-zinc-500" />
                        </a>
                        <button
                            onClick={() => void copyProjectURL()}
                            className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-4 py-2 text-xs font-bold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
                        >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>

                    <div className="mt-8 grid gap-3 grid-cols-2">
                        <MetricTile
                            icon={status.icon}
                            label="Status"
                            value={status.label}
                            hint={status.hint}
                            tone={status.tone}
                            testId="overview-card-status"
                        />
                        <MetricTile
                            icon={Database}
                            label="Tables"
                            value={`${projectInfo?.user_table_count || 0}`}
                            hint="User tables in the public schema."
                            onClick={() => onViewSelect?.('tables')}
                            testId="overview-card-tables"
                            actionLabel="Open tables"
                        />
                        <MetricTile
                            icon={Zap}
                            label="Edge Functions"
                            value={`${userFunctionCount}`}
                            hint="Active edge functions and custom API hooks deployed."
                            onClick={() => onViewSelect?.('functions')}
                            testId="overview-card-functions"
                            actionLabel="Open functions"
                        />
                        <MetricTile
                            icon={FolderOpen}
                            label="Storage"
                            value={databaseSizeLabel}
                            hint="Estimated storage footprint across all buckets."
                            onClick={() => onViewSelect?.('storage')}
                            testId="overview-card-storage"
                            actionLabel="Open storage"
                        />
                    </div>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <button
                            onClick={() => onViewSelect?.('tables')}
                            className="rounded-md bg-primary px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-all hover:bg-primary/90"
                        >
                            Open tables
                        </button>
                        <button
                            onClick={() => onViewSelect?.('sql')}
                            className="rounded-md border border-border bg-zinc-900 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                        >
                            Open SQL
                        </button>
                        <button
                            onClick={() => onViewSelect?.('settings')}
                            className="rounded-md border border-border bg-transparent px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:border-zinc-500 hover:text-white"
                        >
                            Infrastructure
                        </button>
                    </div>

                    <div className="mt-8 rounded-md border border-border bg-zinc-900/50 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-black/40 text-zinc-300">
                                    <Cpu size={18} />
                                    <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                    </span>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                                            MCP Integration <span className="text-zinc-400 italic">Native AI</span>
                                        </h4>
                                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                                            Active
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-zinc-400 font-mono tracking-tight">
                                        Model Context Protocol // Zero-trust AI bridge for Cursor & Claude
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={async () => {
                                        const mcpCmd = `npx ozybase connect --url ${apiUrl}/api/project/mcp`;
                                        await navigator.clipboard.writeText(mcpCmd);
                                        setCopied(true);
                                        window.setTimeout(() => setCopied(false), 1500);
                                    }}
                                    className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                        copied
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                            : 'border-border bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:text-white'
                                    }`}
                                >
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? 'Command Copied' : 'Copy MCP Connection'}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="relative overflow-hidden rounded-md border border-border bg-zinc-950 p-1">
                    <div
                        ref={cardArenaRef}
                        className="relative h-full min-h-100 overflow-hidden rounded-md border border-dashed border-border/50 bg-zinc-900/20"
                    >
                        <div className="absolute left-4 top-4 rounded-md border border-border bg-zinc-900 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                            Draggable Manifest
                        </div>
                        <div
                            ref={cardRef}
                            data-testid="overview-database-card"
                            onPointerDown={(event) => {
                                startCardDrag(event.clientX, event.clientY, event.pointerId);
                            }}
                            style={{
                                transform: `translate(${cardPosition.x}px, ${cardPosition.y}px)`,
                                opacity: cardPositionReady ? 1 : 0,
                            }}
                            className={`absolute w-full max-w-95 rounded-md border border-border bg-zinc-900 p-6 shadow-2xl select-none transition-colors ${isDraggingCard ? 'cursor-grabbing border-primary/50' : 'cursor-grab hover:border-zinc-500'}`}
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-black/40 text-primary">
                                        <Database size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                                            Primary database
                                        </p>
                                        <h2 className="mt-1 text-2xl font-bold tracking-tight text-white uppercase italic">
                                            {domainLabel}
                                        </h2>
                                    </div>
                                </div>
                                {deployCountryCode && (
                                    <img
                                        src={`https://flagcdn.com/32x24/${deployCountryCode}.png`}
                                        alt={deployCountryCode.toUpperCase()}
                                        className="h-4 w-6 rounded-sm border border-border grayscale opacity-50"
                                    />
                                )}
                            </div>
                            
                            <div className="mt-6 space-y-3">
                                {[
                                    { label: 'Domain', value: domainLabel },
                                    { label: 'Database', value: databaseName },
                                    { label: 'Endpoint', value: apiUrl },
                                    { label: 'Runtime', value: productionProfile },
                                ].map((item) => (
                                    <div key={item.label} className="bg-black/20 border border-border rounded-md p-3">
                                        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1">{item.label}</p>
                                        <p className="text-[11px] font-mono font-bold text-zinc-300 break-all">{item.value}</p>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="mt-6 flex items-center justify-between">
                                <span className="rounded-md border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-500">
                                    core_ready
                                </span>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-700">Ozy_Core_V1</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricTile
                    icon={Database}
                    label="DB requests"
                    value={formatCompactMetric(projectInfo?.metrics?.db_requests)}
                    hint="Total database requests captured by the current runtime window."
                    onClick={() => onViewSelect?.('tables')}
                    testId="overview-card-db-requests"
                    actionLabel="Open table editor"
                />
                <MetricTile
                    icon={Lock}
                    label="Auth requests"
                    value={formatCompactMetric(projectInfo?.metrics?.auth_requests)}
                    hint="Authentication traffic currently seen by the platform."
                    onClick={() => onViewSelect?.('auth')}
                    testId="overview-card-auth-requests"
                    actionLabel="Open auth"
                />
                <MetricTile
                    icon={FolderOpen}
                    label="Storage ops"
                    value={formatCompactMetric(projectInfo?.metrics?.storage_requests)}
                    hint="Storage reads and writes observed from the active node."
                    onClick={() => onViewSelect?.('storage')}
                    testId="overview-card-storage-requests"
                    actionLabel="Open storage"
                />
                <MetricTile
                    icon={MousePointer2}
                    label="Realtime"
                    value={formatCompactMetric(projectInfo?.metrics?.realtime_requests)}
                    hint="Active realtime workload and live database fan-out."
                    onClick={() => onViewSelect?.('realtime')}
                    testId="overview-card-realtime-requests"
                    actionLabel="Open realtime"
                />
            </div>

            <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div data-testid="overview-runtime-panel" className="rounded-md border border-[#2c2c2c] bg-[#131313] p-6 xl:self-start">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Current signals</p>
                            <h3 className="mt-1 text-xl font-bold text-white">Runtime Pressure</h3>
                        </div>
                        <Sparkles size={18} className="text-primary" />
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border border-[#2c2c2c] bg-[#101010] p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">CPU Usage</p>
                                <span className="text-xs font-mono font-bold text-primary">
                                    {latestCPU !== null ? `${latestCPU.toFixed(1)}%` : '0%'}
                                </span>
                            </div>
                            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                                <div
                                    className="h-full bg-primary transition-all duration-500"
                                    style={{ width: `${Math.min(100, Math.max(0, latestCPU ?? 0))}%` }}
                                />
                            </div>
                        </div>

                        <div className="rounded-md border border-[#2c2c2c] bg-[#101010] p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">RAM Usage</p>
                                <span className={`text-xs font-mono font-bold ${(latestRAM ?? 0) > 90 ? 'text-amber-400' : 'text-primary'}`}>
                                    {latestRAM !== null ? `${latestRAM.toFixed(1)}%` : '0%'}
                                </span>
                            </div>
                            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                                <div
                                    className={`h-full transition-all duration-500 ${(latestRAM ?? 0) > 90 ? 'bg-amber-400' : 'bg-primary'}`}
                                    style={{ width: `${Math.min(100, Math.max(0, latestRAM ?? 0))}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div data-testid="overview-issues-panel" className="rounded-md border border-[#2c2c2c] bg-[#131313] p-6 xl:self-start">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Security & Health</p>
                    <h3 className="mt-1 text-xl font-bold text-white">
                        {healthIssues.length > 0 ? `${healthIssues.length} issues need review` : 'Active Alerts'}
                    </h3>
                    <div
                        data-testid="overview-issues-scroll"
                        className="mt-5 flex min-h-25 flex-col overflow-y-auto pr-1 custom-scrollbar"
                    >
                        <div className="space-y-3">
                            {visibleIssues.length > 0 ? visibleIssues.map((issue: any, index: number) => (
                                <button
                                    key={`${issue?.title || 'issue'}-${index}`}
                                    type="button"
                                    onClick={() => onViewSelect?.('overview')}
                                    className="w-full rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-[#141414]"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-md ${
                                            issue?.type === 'security' ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/10 text-sky-300'
                                        }`}>
                                            {issue?.type === 'security' ? <ShieldAlert size={15} /> : <Activity size={15} />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold leading-6 text-zinc-200">{issue?.title || 'Issue detected'}</p>
                                            <p className="mt-1 text-xs text-zinc-500">
                                                {issue?.description || 'Review this item for more context.'}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            )) : (
                                <div className="flex items-center gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-4 text-emerald-400">
                                    <ShieldCheck size={20} className="shrink-0" />
                                    <div>
                                        <p className="text-xs font-bold">System Secure</p>
                                        <p className="text-[11px] text-emerald-300/70">No security or performance alerts detected.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 rounded-md border border-[#2c2c2c] bg-[#131313] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Performance</p>
                        <h3 className="mt-1 text-xl font-bold text-white">Slow Queries</h3>
                    </div>
                    <button
                        onClick={() => onViewSelect?.('sql')}
                        className="rounded-md border border-[#2c2c2c] bg-background px-4 py-2 text-xs font-bold text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                        Open SQL Editor
                    </button>
                </div>

                <div className="mt-4 overflow-hidden rounded-md border border-[#2c2c2c]">
                    <div className="grid grid-cols-[minmax(0,1fr)_110px_90px] border-b border-[#2c2c2c] bg-[#101010] px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        <span>Query</span>
                        <span className="text-right">Avg time</span>
                        <span className="text-right">Calls</span>
                    </div>
                    <div className="divide-y divide-[#232323]">
                        {slowQueries.length > 0 ? slowQueries.map((query, index) => (
                            <div key={`${query.query}-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_90px] gap-4 px-5 py-3 text-xs">
                                <div className="min-w-0">
                                    <p className="truncate font-mono text-zinc-300" title={query.query}>
                                        {query.query}
                                    </p>
                                </div>
                                <span className="text-right font-mono text-zinc-400">
                                    {Number(query.avg_time || 0).toFixed(3)}s
                                </span>
                                <span className="text-right font-mono text-zinc-400">
                                    {query.calls}
                                </span>
                            </div>
                        )) : (
                            <div className="flex items-center gap-2.5 px-5 py-4 text-xs text-zinc-400">
                                <Check size={14} className="text-emerald-400" />
                                <span>Optimal query performance — no slow queries recorded.</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Overview;


