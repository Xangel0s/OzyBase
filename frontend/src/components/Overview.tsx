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
    Server,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Zap,
    ChevronDown,
    ChevronUp,
    Cpu,
    ArrowRight,
} from 'lucide-react';
import { fetchWithAuth, isAbortLikeError, readJsonIfOk } from '../utils/api';

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
                            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">Motor de Agentes</h3>
                            <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        </div>
                        <div className="mt-1 flex items-center gap-3">
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                                <span className="text-zinc-300">{activeAgents}</span> Activos
                            </p>
                            <span className="h-1 w-1 rounded-full bg-zinc-800" />
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                                <span className={pendingApprovals > 0 ? 'text-amber-500' : 'text-zinc-300'}>{pendingApprovals}</span> Pendientes
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
    };
    slow_queries?: Array<{
        query: string;
        avg_time: number;
        calls: number;
    }>;
}

interface WorkspaceUsageWarning {
    metric: string;
    current: number;
    limit: number;
    severity: string;
    usage_pct: number;
}

interface WorkspaceUsage {
    window?: string;
    rows?: number;
    storage_bytes?: number;
    api_requests?: number;
    realtime_events?: number;
    function_invocations?: number;
    warnings?: WorkspaceUsageWarning[];
}

interface WorkspaceLimits {
    rows_hard_limit?: number;
    storage_bytes_hard_limit?: number;
    api_requests_soft_limit?: number;
    realtime_events_soft_limit?: number;
    function_invocations_soft_limit?: number;
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
    const [workspaceUsage, setWorkspaceUsage] = useState<WorkspaceUsage | null>(null);
    const [workspaceLimits, setWorkspaceLimits] = useState<WorkspaceLimits | null>(null);
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
    ) => {
        try {
            const workspaceId = String(localStorage.getItem('ozy_workspace_id') || '').trim();
            const [infoResult, healthResult, usageResult, limitsResult] = await Promise.allSettled([
                fetchWithAuth('/api/project/info', { signal }),
                fetchWithAuth('/api/project/health', { signal }),
                workspaceId ? fetchWithAuth(`/api/workspaces/${workspaceId}/usage`, { signal }) : Promise.resolve(null),
                workspaceId ? fetchWithAuth(`/api/workspaces/${workspaceId}/limits`, { signal }) : Promise.resolve(null),
            ]);

            if (infoResult.status === 'fulfilled') {
                const info = await readJsonIfOk<ProjectInfo>(infoResult.value);
                if (info && isActive()) {
                    setProjectInfo(info);
                }
            }

            if (healthResult.status === 'fulfilled') {
                const health = await readJsonIfOk<any>(healthResult.value);
                if (isActive()) {
                    setHealthIssues(Array.isArray(health) ? health : []);
                }
            }

            if (usageResult.status === 'fulfilled' && usageResult.value) {
                const usage = await readJsonIfOk<WorkspaceUsage>(usageResult.value);
                if (isActive()) {
                    setWorkspaceUsage(usage);
                }
            } else if (isActive()) {
                setWorkspaceUsage(null);
            }

            if (limitsResult.status === 'fulfilled' && limitsResult.value) {
                const limits = await readJsonIfOk<WorkspaceLimits>(limitsResult.value);
                if (isActive()) {
                    setWorkspaceLimits(limits);
                }
            } else if (isActive()) {
                setWorkspaceLimits(null);
            }
        } catch (err) {
            if (!isAbortLikeError(err) && isActive()) {
                setHealthIssues((current) => current);
            }
        }
    }, []);

    useEffect(() => {
        let active = true;
        const abortController = new AbortController();
        const isActive = () => active;

        void loadData(isActive, abortController.signal);
        const interval = window.setInterval(() => {
            void loadData(isActive, abortController.signal);
        }, 5000);

        return () => {
            active = false;
            abortController.abort();
            window.clearInterval(interval);
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
    const projectUsageWarnings = Array.isArray(workspaceUsage?.warnings) ? workspaceUsage.warnings.slice(0, 3) : [];

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
                            hint={`${projectInfo?.system_table_count || 0} system tables detected in this database.`}
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
                </section>

                <section className="relative overflow-hidden rounded-md border border-border bg-zinc-950 p-1">
                    <div
                        ref={cardArenaRef}
                        className="relative h-full min-h-[400px] overflow-hidden rounded-md border border-dashed border-border/50 bg-zinc-900/20"
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
                            className={`absolute w-full max-w-[380px] rounded-md border border-border bg-zinc-900 p-6 shadow-2xl select-none transition-colors ${isDraggingCard ? 'cursor-grabbing border-primary/50' : 'cursor-grab hover:border-zinc-500'}`}
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

            {workspaceUsage ? (
                <div className="mt-6 rounded-md border border-[#2c2c2c] bg-[#131313] p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-medium] text-zinc-500">Project usage</p>
                            <h3 className="mt-2 text-2xl font-bold text-white">Active project envelope</h3>
                            <p className="mt-2 text-sm text-zinc-500">
                                Shared self-hosted runtime, project-scoped quotas. This project does not provision another physical PostgreSQL database.
                            </p>
                        </div>
                        <button
                            onClick={() => onViewSelect?.('usage')}
                            className="rounded-md border border-[#2c2c2c] bg-background px-4 py-2 text-sm font-medium] text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                        >
                            Open usage & limits
                        </button>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        {[
                            {
                                label: 'Rows',
                                value: formatCompactMetric(workspaceUsage.rows),
                                hint: `Hard limit ${workspaceLimits?.rows_hard_limit ? formatCompactMetric(workspaceLimits.rows_hard_limit) : 'unlimited'}`,
                            },
                            {
                                label: 'Storage',
                                value: formatBytes(workspaceUsage.storage_bytes) || '0 B',
                                hint: `Hard limit ${workspaceLimits?.storage_bytes_hard_limit ? formatBytes(workspaceLimits.storage_bytes_hard_limit) : 'unlimited'}`,
                            },
                            {
                                label: 'API requests',
                                value: formatCompactMetric(workspaceUsage.api_requests),
                                hint: `30d soft limit ${workspaceLimits?.api_requests_soft_limit ? formatCompactMetric(workspaceLimits.api_requests_soft_limit) : 'unlimited'}`,
                            },
                            {
                                label: 'Realtime',
                                value: formatCompactMetric(workspaceUsage.realtime_events),
                                hint: `30d soft limit ${workspaceLimits?.realtime_events_soft_limit ? formatCompactMetric(workspaceLimits.realtime_events_soft_limit) : 'unlimited'}`,
                            },
                            {
                                label: 'Functions',
                                value: formatCompactMetric(workspaceUsage.function_invocations),
                                hint: `30d soft limit ${workspaceLimits?.function_invocations_soft_limit ? formatCompactMetric(workspaceLimits.function_invocations_soft_limit) : 'unlimited'}`,
                            },
                        ].map((item) => (
                            <div key={item.label} className="rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-4">
                                <p className="text-[10px] font-medium] text-zinc-500">{item.label}</p>
                                <p className="mt-2 text-2xl font-bold text-white">{item.value}</p>
                                <p className="mt-2 text-sm text-zinc-500">{item.hint}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                        {projectUsageWarnings.length > 0 ? projectUsageWarnings.map((warning) => (
                            <div
                                key={`${warning.metric}-${warning.limit}`}
                                className={`rounded-full border px-3 py-1 text-[10px] font-medium] ${
                                    warning.severity === 'critical'
                                        ? 'border-red-500/30 bg-red-500/10 text-red-300'
                                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                }`}
                            >
                                {warning.metric.replace(/_/g, ' ')} {Math.round(warning.usage_pct)}%
                            </div>
                        )) : (
                            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium] text-emerald-300">
                                Project usage within limits
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div data-testid="overview-runtime-panel" className="rounded-md border border-[#2c2c2c] bg-[#131313] p-6 xl:self-start">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-medium] text-zinc-500">Current signals</p>
                            <h3 className="mt-2 text-2xl font-bold text-white">Runtime pressure</h3>
                        </div>
                        <Sparkles size={18} className="text-primary" />
                    </div>

                    <div className="mt-6 flex flex-col gap-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-4">
                                <p className="text-[10px] font-medium] text-zinc-500">CPU</p>
                                <p className="mt-2 text-3xl font-bold text-white">
                                    {latestCPU !== null ? `${latestCPU.toFixed(1)}%` : 'n/a'}
                                </p>
                                <p className="mt-2 text-sm text-zinc-500">Latest sampled CPU pressure from the runtime store.</p>
                            </div>
                            <div className="rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-4">
                                <p className="text-[10px] font-medium] text-zinc-500">RAM</p>
                                <p className="mt-2 text-3xl font-bold text-white">
                                    {latestRAM !== null ? `${latestRAM.toFixed(1)}%` : 'n/a'}
                                </p>
                                <p className="mt-2 text-sm text-zinc-500">Latest sampled memory pressure from the runtime store.</p>
                            </div>
                        </div>
                        <div className="rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-4">
                            <p className="text-[10px] font-medium] text-zinc-500">Runtime note</p>
                            <p className="mt-2 text-sm leading-6 text-zinc-400">
                                This panel stays compact even when the values are fixed. Use the dedicated module for deeper diagnostics when needed.
                            </p>
                        </div>
                    </div>
                </div>

                <div data-testid="overview-issues-panel" className="rounded-md border border-[#2c2c2c] bg-[#131313] p-6 xl:self-start">
                    <p className="text-[11px] font-medium] text-zinc-500">Latest issues</p>
                    <h3 className="mt-2 text-2xl font-bold text-white">
                        {healthIssues.length > 0 ? `${healthIssues.length} need review` : 'No active alerts'}
                    </h3>
                    <div
                        data-testid="overview-issues-scroll"
                        className="mt-5 flex min-h-[210px] max-h-[min(56vh,520px)] flex-col overflow-y-auto pr-1 custom-scrollbar"
                    >
                        <div className="space-y-3">
                            {visibleIssues.length > 0 ? visibleIssues.map((issue: any, index: number) => (
                                <button
                                    key={`${issue?.title || 'issue'}-${index}`}
                                    type="button"
                                    onClick={() => onViewSelect?.('overview')}
                                    className="w-full rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-3.5 text-left transition-colors hover:border-primary/25 hover:bg-[#141414]"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-md ${
                                            issue?.type === 'security' ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/10 text-sky-300'
                                        }`}>
                                            {issue?.type === 'security' ? <ShieldAlert size={15} /> : <Activity size={15} />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold leading-6 text-zinc-200">{issue?.title || 'Issue detected'}</p>
                                            <p className="mt-1 text-sm leading-6 text-zinc-500">
                                {issue?.description || 'Review this item for more context.'}
                                            </p>
                                            <div className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1 text-[9px] font-medium] text-zinc-500">
                                                Open details
                                                <ExternalLink size={12} />
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            )) : (
                                <button
                                    type="button"
                                    onClick={() => onViewSelect?.('overview')}
                                    className="rounded-md border border-[#2c2c2c] bg-[#101010] px-4 py-5 text-left text-sm text-zinc-500 transition-colors hover:border-primary/25 hover:text-zinc-300"
                                >
                                    No security or performance alerts are active right now.
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 rounded-md border border-[#2c2c2c] bg-[#131313] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-[11px] font-medium] text-zinc-500">Slow queries</p>
                        <h3 className="mt-2 text-2xl font-bold text-white">Recent database pressure points</h3>
                    </div>
                    <button
                        onClick={() => onViewSelect?.('sql')}
                        className="rounded-md border border-[#2c2c2c] bg-background px-4 py-2 text-sm font-medium] text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                        Open SQL
                    </button>
                </div>

                <div className="mt-5 overflow-hidden rounded-md border border-[#2c2c2c]">
                    <div className="grid grid-cols-[minmax(0,1fr)_110px_90px] border-b border-[#2c2c2c] bg-[#101010] px-5 py-3 text-[10px] font-medium] text-zinc-500">
                        <span>Query</span>
                        <span className="text-right">Avg time</span>
                        <span className="text-right">Calls</span>
                    </div>
                    <div className="divide-y divide-[#232323]">
                        {slowQueries.length > 0 ? slowQueries.map((query, index) => (
                            <div key={`${query.query}-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_90px] gap-4 px-5 py-4 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate font-mono text-zinc-300" title={query.query}>
                                        {query.query}
                                    </p>
                                </div>
                                <span className="text-right font-mono text-zinc-500">
                                    {Number(query.avg_time || 0).toFixed(3)}s
                                </span>
                                <span className="text-right font-mono text-zinc-500">
                                    {query.calls}
                                </span>
                            </div>
                        )) : (
                            <div className="px-5 py-6 text-sm text-zinc-500">
                                No active slow queries were reported in the latest sample.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Overview;


