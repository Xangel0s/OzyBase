import React, { useState, useEffect } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    Monitor,
    Database,
    ShieldCheck,
    Cpu,
    BellRing,
    RefreshCw
} from 'lucide-react';
import { fetchWithAuth, isAbortLikeError, readJsonIfOk } from '../utils/api';
import { BrandedToast } from './OverlayPrimitives';

const Observability = ({ onViewSelect }: any) => {
    const [info, setInfo] = useState<any>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [workspaceUsage, setWorkspaceUsage] = useState<any>(null);
    const [workspaceLimits, setWorkspaceLimits] = useState<any>(null);
    const [sloStatus, setSloStatus] = useState<any>(null);
    const [alertRouting, setAlertRouting] = useState<any>(null);
    const [storageStatus, setStorageStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'warning' } | null>(null);

    useEffect(() => {
        fetchInfo();
        fetchLogs();
        const interval = setInterval(() => {
            fetchInfo();
            fetchLogs();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchInfo = async () => {
        try {
            const workspaceId = String(localStorage.getItem('ozy_workspace_id') || '').trim();
            const [infoRes, sloRes, routingRes, storageRes, usageRes, limitsRes] = await Promise.all([
                fetchWithAuth('/api/project/info'),
                fetchWithAuth('/api/project/observability/slo'),
                fetchWithAuth('/api/project/security/alert-routing'),
                fetchWithAuth('/api/project/observability/storage'),
                workspaceId ? fetchWithAuth(`/api/workspaces/${workspaceId}/usage`) : Promise.resolve(null),
                workspaceId ? fetchWithAuth(`/api/workspaces/${workspaceId}/limits`) : Promise.resolve(null),
            ]);

            const [infoData, sloData, routingData, storageData, usageData, limitsData] = await Promise.all([
                readJsonIfOk<any>(infoRes),
                readJsonIfOk<any>(sloRes),
                readJsonIfOk<any>(routingRes),
                readJsonIfOk<any>(storageRes),
                usageRes ? readJsonIfOk<any>(usageRes) : Promise.resolve(null),
                limitsRes ? readJsonIfOk<any>(limitsRes) : Promise.resolve(null),
            ]);

            if (infoData) setInfo(infoData);
            if (sloData) setSloStatus(sloData);
            if (routingData) setAlertRouting(routingData);
            if (storageData) setStorageStatus(storageData);
            setWorkspaceUsage(usageData);
            setWorkspaceLimits(limitsData);
        } catch (error) {
            if (!isAbortLikeError(error)) {
                console.error('Failed to fetch info:', error);
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async () => {
        try {
            const res = await fetchWithAuth('/api/project/logs');
            const data = await readJsonIfOk<any>(res);
            if (Array.isArray(data)) {
                setLogs(data.slice(0, 4));
            } else if (Array.isArray(data?.logs)) {
                setLogs(data.logs.slice(0, 4));
            } else {
                setLogs([]);
            }
        } catch (error) {
            if (!isAbortLikeError(error)) {
                console.error('Failed to fetch logs:', error);
            }
        }
    };

    const handleManualRefresh = async () => {
        setLoading(true);
        await Promise.all([fetchInfo(), fetchLogs()]);
        setToast({ message: 'Observability matrix synchronized', tone: 'success' });
    };

    const stats = info ? [
        { title: 'DB Requests', value: info.metrics.db_requests, change: 'Live', up: true, icon: Database },
        { title: 'Auth Events', value: info.metrics.auth_requests, change: 'Live', up: true, icon: ShieldCheck },
        { title: 'Active Connections', value: info.metrics.realtime_requests, change: 'DB', up: true, icon: Activity },
        { title: 'DB Version', value: info.version.split(' ')[0], change: 'Core', up: true, icon: Cpu }
    ] : [];

    const evaluation = sloStatus?.evaluation || alertRouting?.slo || null;
    const rules = Array.isArray(alertRouting?.rules) ? alertRouting.rules : [];
    const routes = Array.isArray(alertRouting?.routes) ? alertRouting.routes : [];
    const warnings = Array.isArray(alertRouting?.warnings) ? alertRouting.warnings : [];
    const storageSummary = storageStatus?.summary || null;
    const storageBuckets = Array.isArray(storageStatus?.buckets) ? storageStatus.buckets : [];
    const storageAlerts = Array.isArray(storageStatus?.alerts) ? storageStatus.alerts : [];
    const storageHistory = Array.isArray(storageStatus?.history) ? storageStatus.history : [];
    const maxStorageHistoryBytes = storageHistory.length > 0
        ? Math.max(...storageHistory.map((point: any) => Number(point.created_bytes || 0)), 1)
        : 1;
    const usageWarnings = Array.isArray(workspaceUsage?.warnings) ? workspaceUsage.warnings.slice(0, 4) : [];

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-500 overflow-y-auto custom-scrollbar relative">
            {toast && (
                <BrandedToast
                    message={toast.message}
                    tone={toast.tone}
                    onClose={() => setToast(null)}
                />
            )}

            {/* Header with Title and Refresh */}
            <div className="px-8 pt-10 pb-4 flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-bold text-white italic tracking-tighter uppercase leading-none">Observability</h1>
                    <div className="mt-4 flex items-center gap-3">
                        <Activity size={12} className="text-primary animate-pulse" />
                        <span className="text-zinc-600 text-[10px] font-bold uppercase tracking-[0.2em] italic">Telemetry Hub / Live State</span>
                    </div>
                </div>
                <button
                    onClick={handleManualRefresh}
                    disabled={loading}
                    className="flex items-center gap-3 px-6 py-3 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:border-primary/50 transition-all active:scale-95 disabled:opacity-50 shadow-xl"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Sync_Matrix
                </button>
            </div>

            {/* Realtime Stats Header */}
            <div className="px-8 py-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {loading && !info ? (
                    [...Array(4)].map((_: any, i: any) => (
                        <div key={i} className="bg-background border border-border rounded-md p-8 h-40 animate-pulse" />
                    ))
                ) : stats.map((stat: any, i: any) => (
                    <div key={i} className="bg-zinc-950/40 relative overflow-hidden group border border-zinc-800/50 rounded-md p-8 hover:border-primary/40 transition-all duration-500">
                        <div className="absolute inset-0 bg-linear-to-b from-primary/30 to-transparent pointer-events-none" />
                        <div className="flex items-center justify-between mb-8 relative z-10">
                            <div className="w-12 h-12 rounded-md bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-primary group-hover:scale-110 transition-all duration-500 shadow-xl">
                                <stat.icon size={22} />
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-bold tracking-widest uppercase italic">
                                <ArrowUpRight size={10} />
                                {stat.change}
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 italic opacity-60">{stat.title}</p>
                        <h3 className="text-4xl font-bold text-white tracking-tighter italic leading-none">{stat.value}</h3>
                    </div>
                ))}
            </div>

            {/* Main Graphs Area */}
            <div className="px-8 pb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-background border border-border rounded-md p-6 h-80 flex flex-col relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Database Load History</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Real-time throughput metrics (Last 12 mins)</p>
                        </div>
                        <div className="flex gap-2">
                            <div className="bg-background border border-border rounded-md px-2 py-1 text-[9px] font-bold uppercase text-zinc-500">Live</div>
                        </div>
                    </div>
                    {/* Visualizer with Real Data */}
                    <div className="flex-1 flex items-end gap-2 px-2">
                        {info?.metrics.db_history.map((val: any, i: any) => (
                            <div
                                key={i}
                                style={{ height: `${Math.min(100, (val / (Math.max(...info.metrics.db_history, 1) * 1.2)) * 100)}%` }}
                                className={`flex-1 rounded-t-sm transition-all duration-500 bg-primary/40 hover:bg-primary/80 group relative`}
                            >
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black border border-border rounded px-1.5 py-0.5 text-[8px] text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20">
                                    {val} reqs
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-primary/5 to-transparent pointer-events-none" />
                </div>

                <div className="bg-background border border-border rounded-md p-6 h-80 flex flex-col">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Storage Pressure</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Quota, lifecycle and multipart activity</p>
                        </div>
                        <div className="px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[9px] font-medium text-zinc-400">
                            {storageSummary?.provider || 'local'}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">Stored Data</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{storageSummary?.total_size_human || '0 B'}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">{storageSummary?.object_count || 0} objects across {storageSummary?.bucket_count || 0} buckets</p>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">Recent 24h</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{storageSummary?.recent_upload_bytes_24h_human || '0 B'}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">{storageSummary?.recent_uploads_24h || 0} uploads in the last day</p>
                        </div>
                    </div>
                    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
                        <div className="flex items-center justify-between text-[9px] font-medium text-zinc-500">
                            <span>Tracked Quota Usage</span>
                            <span>{storageSummary?.quota_usage_pct?.toFixed?.(2) || '0.00'}%</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-900">
                            <div
                                className={`h-full rounded-full ${
                                    (storageSummary?.quota_usage_pct || 0) >= 95 ? 'bg-red-500' :
                                        (storageSummary?.quota_usage_pct || 0) >= 80 ? 'bg-amber-500' :
                                            'bg-primary'
                                }`}
                                style={{ width: `${Math.min(100, Number(storageSummary?.quota_usage_pct || 0))}%` }}
                            />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                            <span>{storageSummary?.quota_enabled_buckets || 0} quota-enabled buckets</span>
                            <span>{storageSummary?.total_quota_human || '0 B'} tracked</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* SLO + Alert Routing */}
            <div className="px-8 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-background border border-border rounded-md p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Service SLO</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Availability, error rate, and p95 latency</p>
                        </div>
                        <div className={`px-2 py-1 rounded-md text-[9px] font-medium ${
                            evaluation?.status === 'breached' ? 'bg-red-500/10 text-red-500' :
                            evaluation?.status === 'insufficient_data' ? 'bg-amber-500/10 text-amber-500' :
                            'bg-green-500/10 text-green-500'
                        }`}>
                            {evaluation?.status || 'unknown'}
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md flex items-center justify-between">
                            <span className="text-[10px] font-medium text-zinc-500">Availability</span>
                            <span className="text-xs font-bold text-white">
                                {evaluation?.availability?.current ?? '--'}% / {evaluation?.availability?.objective ?? '--'}%
                            </span>
                        </div>
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md flex items-center justify-between">
                            <span className="text-[10px] font-medium text-zinc-500">Error Rate</span>
                            <span className="text-xs font-bold text-white">
                                {evaluation?.error_rate?.current ?? '--'}% / {evaluation?.error_rate?.objective ?? '--'}%
                            </span>
                        </div>
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md flex items-center justify-between">
                            <span className="text-[10px] font-medium text-zinc-500">Latency P95</span>
                            <span className="text-xs font-bold text-white">
                                {evaluation?.latency_p95?.current ?? '--'}ms / {evaluation?.latency_p95?.objective ?? '--'}ms
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bg-background border border-border rounded-md p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Alert Routing / On-Call</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Actionable rules and escalation targets</p>
                        </div>
                        <BellRing size={16} className="text-zinc-500" />
                    </div>

                    <div className="flex items-center gap-2 mb-4">
                        <div className={`w-2 h-2 rounded-full ${alertRouting?.on_call?.enabled ? 'bg-green-500' : 'bg-zinc-700'}`} />
                        <span className="text-[10px] font-medium text-zinc-500">
                            On-call {alertRouting?.on_call?.enabled ? 'enabled' : 'disabled'}
                        </span>
                        <span className="text-[10px] font-medium text-zinc-700">Routes: {routes.length}</span>
                    </div>

                    <div className="space-y-2">
                        {rules.slice(0, 3).map((rule: any) => (
                            <div key={rule.id} className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-bold text-white uppercase tracking-widest">{rule.name}</p>
                                    <p className="text-[10px] text-zinc-500 mt-1">{rule.current_value} (target {rule.threshold})</p>
                                </div>
                                <span className={`text-[9px] font-medium px-2 py-1 rounded-md ${
                                    rule.breached ? 'bg-red-500/10 text-red-500' : 'bg-zinc-800 text-zinc-500'
                                }`}>
                                    {rule.severity}
                                </span>
                            </div>
                        ))}
                        {rules.length === 0 ? (
                            <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-md text-[10px] font-medium text-zinc-600">
                                No routing rules loaded
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="px-8 pb-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-background border border-border rounded-md p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Project Quotas</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Shared runtime, project-scoped limits</p>
                        </div>
                        <button
                            onClick={() => onViewSelect?.('usage')}
                            className="text-[9px] font-medium text-primary tracking-widest hover:underline"
                        >
                            Open usage
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">Rows</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{workspaceUsage?.rows ?? 0}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">Hard limit {workspaceLimits?.rows_hard_limit || 'unlimited'}</p>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">Storage</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{workspaceUsage?.storage_bytes ? `${Math.round(workspaceUsage.storage_bytes / 1024)} KB` : '0 B'}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">Hard limit {workspaceLimits?.storage_bytes_hard_limit ? `${Math.round(workspaceLimits.storage_bytes_hard_limit / 1024)} KB` : 'unlimited'}</p>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">API requests</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{workspaceUsage?.api_requests ?? 0}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">30d soft limit {workspaceLimits?.api_requests_soft_limit || 'unlimited'}</p>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
                            <p className="text-[9px] font-medium text-zinc-500">Realtime / Functions</p>
                            <p className="mt-2 text-2xl font-bold italic tracking-tighter text-white">{workspaceUsage?.realtime_events ?? 0} / {workspaceUsage?.function_invocations ?? 0}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">Soft limits {workspaceLimits?.realtime_events_soft_limit || 'unlimited'} / {workspaceLimits?.function_invocations_soft_limit || 'unlimited'}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-background border border-border rounded-md p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-medium text-white">Limit Warnings</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">Thresholds close to exhaustion</p>
                        </div>
                        <AlertTriangle size={16} className="text-zinc-500" />
                    </div>
                    <div className="space-y-3">
                        {usageWarnings.length > 0 ? usageWarnings.map((warning: any, index: number) => (
                            <div key={`${warning.metric}-${index}`} className={`rounded-md border p-4 ${
                                warning.severity === 'critical' ? 'border-red-500/30 bg-red-500/10' : 'border-amber-500/30 bg-amber-500/10'
                            }`}>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-medium text-white">{String(warning.metric || '').replace(/_/g, ' ')}</p>
                                    <span className="text-[9px] font-medium text-zinc-500">{Math.round(Number(warning.usage_pct || 0))}%</span>
                                </div>
                                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                                    {warning.current} used of {warning.limit}
                                </p>
                            </div>
                        )) : (
                            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4 text-[10px] font-medium text-zinc-600">
                                No project limit warnings right now
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* API Gateway Logs */}
            <div className="px-8 pb-12">
                <div className="bg-background border border-border rounded-md overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-border bg-[#131313] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Monitor size={16} className="text-zinc-500" />
                            <h4 className="text-[10px] font-medium text-white">Real-time Gateway Logs</h4>
                        </div>
                        <button 
                            onClick={() => onViewSelect('logs')}
                            className="text-[9px] font-medium text-primary tracking-widest hover:underline"
                        >
                            View All Logs
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <tbody className="divide-y divide-border/30">
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-10 text-center text-zinc-600 text-[10px] font-medium">No activity detected yet</td>
                                    </tr>
                                ) : logs.map((log: any) => (
                                    <tr key={log.id} className="hover:bg-zinc-900/50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium border ${log.method === 'POST' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                                    log.method === 'GET' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                        'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                    }`}>
                                                    {log.method}
                                                </span>
                                                <span className="text-xs font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-tight truncate max-w-xs">{log.path}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1 h-1 rounded-full ${log.status >= 400 ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-green-500'}`} />
                                                <span className="text-[11px] font-bold text-zinc-500">{log.status}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            {log.latency}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[10px] font-mono text-zinc-700">{log.time}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Observability;


