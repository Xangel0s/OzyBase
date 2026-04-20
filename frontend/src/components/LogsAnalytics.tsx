import React, { useState, useEffect, useRef } from 'react';
import {
    Terminal, Search, Play, History, Activity, BarChart,
    Filter, ArrowRight, Clock, Globe, RefreshCw, Zap, Shield, Bell, X, AlertTriangle, Cpu
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import OzySelect from './OzySelect';
import { BrandedToast } from './OverlayPrimitives';

const LogsAnalytics = ({ view = 'explorer' }: any) => {
    const [trafficStats, setTrafficStats] = useState<any[]>([]);
    const [geoStats, setGeoStats] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [isLivePaused, setIsLivePaused] = useState(false);
    const [pollingInterval, setPollingInterval] = useState(5000);
    const [logLimit, setLogLimit] = useState(50);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [lastClearedTime, setLastClearedTime] = useState(() => Number(localStorage.getItem('ozy_logs_clear_time')) || 0);
    const [lastSyncTime, setLastSyncTime] = useState<any>(null);
    const [selectedLog, setSelectedLog] = useState<any>(null);
    const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'warning' } | null>(null);
    const generationRef = useRef(0);
    const skipNextFetchRef = useRef(false);
    const latestServerTimeRef = useRef(0);

    const fetchAnalytics = React.useCallback(async () => {
        try {
            const [trafficRes, geoRes] = await Promise.all([
                fetchWithAuth('/api/analytics/traffic'),
                fetchWithAuth('/api/analytics/geo')
            ]);
            if (trafficRes.ok) {
                const trafficData = await trafficRes.json();
                setTrafficStats(trafficData);
            }
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                setGeoStats(geoData);
            }
        } catch (e) { console.error(e); }
    }, []);

    const fetchLogs = React.useCallback(async () => {
        const currentGen = generationRef.current;
        try {
            const params = new URLSearchParams();
            params.append('limit', String(view === 'explorer' ? logLimit : 100));
            if (statusFilter !== 'all') {
                params.append('status', statusFilter);
            }
            params.append('source', 'memory');
            
            const res = await fetchWithAuth(`/api/project/logs?${params.toString()}`);
            if (res.ok) {
                const result = await res.json();
                const { logs: logData, server_time } = result;

                if (server_time) {
                    const sTime = new Date(server_time).getTime();
                    latestServerTimeRef.current = sTime;
                    setLastSyncTime(sTime);
                }
                
                if (currentGen !== generationRef.current) return;

                const clearTime = Number(localStorage.getItem('ozy_logs_clear_time')) || 0;
                if (clearTime > 0) {
                    const filtered = logData.filter((log: any) => {
                        if (!log.timestamp) return true;
                        return new Date(log.timestamp).getTime() > clearTime;
                    });
                    setLogs(filtered);
                } else {
                    setLogs(logData);
                }
            }
        } catch (e) { console.error(e); }
    }, [view, logLimit, statusFilter]);

    const fetchAlerts = React.useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/project/security/alerts');
            if (res.ok) {
                const data = await res.json();
                setAlerts(data);
            }
        } catch (e) { console.error(e); }
    }, []);

    const handleExport = async () => {
        try {
            const res = await fetchWithAuth('/api/project/logs/export');
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ozybase_logs_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setToast({ message: 'Log archive successfully exported to CSV', tone: 'success' });
            }
        } catch (e) { 
            console.error("Export failed", e);
            setToast({ message: 'Log export failed. Check connectivity.', tone: 'error' });
        }
    };

    useEffect(() => {
        let intervalId: any;
        let isMounted = true;

        const doFetch = async () => {
            if (!isMounted || isLivePaused) return;
            try {
                if (view === 'explorer' || view === 'metrics') await fetchAnalytics();
                if (view === 'live' || view === 'explorer' || view === 'metrics') await fetchLogs();
                if (view === 'alerts') await fetchAlerts();
            } catch (e) { console.error(e); }
        };

        if (skipNextFetchRef.current) {
            skipNextFetchRef.current = false;
        } else {
            doFetch();
        }

        intervalId = setInterval(doFetch, pollingInterval);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [view, isLivePaused, pollingInterval, lastClearedTime, fetchAnalytics, fetchLogs, fetchAlerts]);

    const renderLiveTail = () => (
        <div className="flex flex-col h-full animate-in fade-in duration-700">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-primary/5 border border-primary/20 rounded-md">
                        <Activity className={`text-primary ${!isLivePaused ? 'animate-pulse' : ''}`} size={16} />
                    </div>
                    <div>
                        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest leading-none">Socket</p>
                        <h2 className="mt-1 text-lg font-bold text-white uppercase tracking-tight">Real-time Stream</h2>
                    </div>
                </div>

                <div className="flex items-center gap-3 bg-zinc-900/40 p-1.5 rounded-md border border-border">
                    <button 
                         onClick={() => {
                            generationRef.current += 1;
                            const referenceTime = latestServerTimeRef.current;
                            if (!referenceTime) return;
                            localStorage.setItem('ozy_logs_clear_time', referenceTime.toString());
                            setLastClearedTime(referenceTime);
                            setLogs([]);
                            skipNextFetchRef.current = true;
                            setToast({ message: 'Log stream purged', tone: 'warning' });
                        }}
                        className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white transition-colors"
                    >
                        Purge
                    </button>
                    <div className="w-px h-3 bg-border" />
                    <OzySelect
                        value={statusFilter}
                        onChange={(e: any) => setStatusFilter(e.target.value)}
                        wrapperClassName="min-w-[80px] border-none bg-transparent"
                        selectClassName="h-7 px-1 text-[9px] font-bold tracking-widest uppercase"
                    >
                        <option value="all">ALL</option>
                        <option value="success">SUCCESS</option>
                        <option value="error">ERROR</option>
                    </OzySelect>
                    <div className="w-px h-3 bg-border" />
                    <button 
                        onClick={() => {
                            setIsLivePaused(!isLivePaused);
                            setToast({ 
                                message: !isLivePaused ? 'Stream suspended' : 'Stream resumed', 
                                tone: !isLivePaused ? 'warning' : 'success' 
                            });
                        }}
                        className={`px-4 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all ${isLivePaused ? 'bg-emerald-500 text-black' : 'bg-background border border-border text-zinc-500 hover:text-white hover:border-zinc-700'}`}
                    >
                        {isLivePaused ? 'Resume' : 'Pause'}
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-background border border-border rounded-md overflow-hidden flex flex-col relative">
                <div className="bg-zinc-900/20 px-6 py-2 border-b border-border flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2">
                        <Terminal size={12} className="text-primary" />
                        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Kernel_Output</span>
                    </div>
                    <div className="flex items-center gap-4">
                         <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-widest">
                            {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'WAITING'}
                        </span>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-6 space-y-1 custom-scrollbar relative z-10 font-mono">
                    {logs.filter(log => searchQuery ? log.path?.toLowerCase().includes(searchQuery.toLowerCase()) : true).map((log) => (
                        <div 
                            key={log.id} 
                            onClick={() => setSelectedLog(log)}
                            className="flex gap-4 group hover:bg-zinc-900/40 transition-all -mx-2 px-2 py-1 rounded cursor-pointer items-center border border-transparent hover:border-border/30"
                        >
                            <span className="text-zinc-800 text-[9px] tabular-nums">[{log.time}]</span>
                            <span className={`text-[9px] font-bold min-w-[30px] ${log.method === 'GET' ? 'text-blue-500' : 'text-purple-500'}`}>{log.method}</span>
                            <span className="text-zinc-500 text-[10px] truncate flex-1">{log.path}</span>
                            <span className={`text-[10px] font-bold ${log.status >= 400 ? 'text-red-500' : 'text-emerald-500'}`}>{log.status}</span>
                            <span className="text-[8px] font-bold text-zinc-800 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap tabular-nums">
                                {log.latency} // {log.ip || 'INTERNAL'}
                            </span>
                        </div>
                    ))}
                    {logs.length === 0 && !isLivePaused && (
                         <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-800">
                            <Cpu size={24} className="opacity-20 animate-pulse" />
                            <p className="text-[9px] font-bold uppercase tracking-widest">Awaiting packets...</p>
                         </div>
                    )}
                </div>
            </div>
        </div>
    );

    const renderAlerts = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right duration-700">
            <header className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-md bg-red-500/5 flex items-center justify-center border border-red-500/20 text-red-500">
                        <Bell size={24} className="animate-pulse" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white uppercase tracking-tight">Security Board</h2>
                        <p className="mt-1 max-w-lg text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            Real-time monitoring for authentication anomalies and threat vectors.
                        </p>
                    </div>
                </div>
                <div className="px-4 py-1.5 rounded-md bg-red-500/10 border border-red-500/20">
                    <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">{alerts.length} Active Alerts</span>
                </div>
            </header>
            
            <div className="bg-background border border-border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/2 border-b border-white/5">
                                <th className="px-10 py-6 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] italic">Timestamp</th>
                                <th className="px-10 py-6 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] italic">Classification</th>
                                <th className="px-10 py-6 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] italic">Vector Type</th>
                                <th className="px-10 py-6 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] italic">Incident Narrative</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono">
                            {alerts.map((alert) => (
                                <tr key={alert.id} className="group hover:bg-red-500/3 transition-all">
                                    <td className="px-10 py-6 text-[11px] text-zinc-500 italic tabular-nums">{alert.time}</td>
                                    <td className="px-10 py-6">
                                        <div className={`inline-flex px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest italic ${alert.severity === 'high' ? 'bg-red-500 text-black shadow-[0_10px_20px_rgba(239,68,68,0.2)]' : 'bg-orange-500/20 text-orange-400'}`}>
                                            {alert.severity}_LEVEL
                                        </div>
                                    </td>
                                    <td className="px-10 py-6 text-[12px] font-bold text-white italic tracking-tight">{alert.type}</td>
                                    <td className="px-10 py-6 text-[11px] text-zinc-400 font-medium leading-relaxed max-w-md">{alert.message}</td>
                                </tr>
                            ))}
                            {alerts.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="py-24 text-center">
                                        <div className="flex flex-col items-center justify-center gap-4">
                                            <div className="w-16 h-16 rounded-[24px] bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-center text-emerald-500">
                                                <Shield size={24} />
                                            </div>
                                            <p className="text-[11px] font-bold text-zinc-700 uppercase tracking-[0.3em] italic">Zero critical incidents detected in current cycle</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderExplorer = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom duration-700">
             <div className="bg-background border border-border rounded-md overflow-hidden relative">
                <div className="h-16 border-b border-border bg-zinc-900/20 flex items-center px-6 gap-6 relative z-10">
                    <div className="flex items-center gap-2">
                        <Terminal size={14} className="text-primary" />
                        <h3 className="text-[10px] font-bold text-white uppercase tracking-widest leading-none">Archive</h3>
                    </div>
                    
                    <div className="flex-1 h-9 bg-background rounded-md border border-border flex items-center px-4 gap-3 focus-within:border-primary/40 transition-all">
                        <Search size={14} className="text-zinc-700" />
                        <input 
                            type="text" 
                            placeholder="Filter path..." 
                            value={searchQuery} 
                            onChange={(e) => setSearchQuery(e.target.value)} 
                            className="bg-transparent border-none text-[10px] text-white focus:outline-none w-full font-bold uppercase tracking-widest placeholder:text-zinc-800" 
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <OzySelect
                            value={statusFilter}
                            onChange={(e: any) => setStatusFilter(e.target.value)}
                            wrapperClassName="min-w-[120px] border-border bg-background rounded-md"
                            selectClassName="h-9 px-3 text-[9px] font-bold tracking-widest uppercase"
                        >
                            <option value="all">ANY</option>
                            <option value="success">SUCCESS</option>
                            <option value="error">ERROR</option>
                        </OzySelect>

                        <button 
                            onClick={handleExport}
                            className="h-9 flex items-center gap-2 px-4 rounded-md bg-primary text-black font-bold text-[9px] tracking-widest uppercase transition-all active:scale-95 hover:bg-[#E6E600]"
                        >
                            <Zap size={12} />
                            Export
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest border-b border-border bg-zinc-900/10">
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4">Method</th>
                                <th className="px-6 py-4">Path</th>
                                <th className="px-6 py-4 text-center">Status</th>
                                <th className="px-6 py-4 text-right">Source</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-mono">
                            {logs.filter(log => searchQuery ? log.path?.toLowerCase().includes(searchQuery.toLowerCase()) : true).map((log) => (
                                <tr 
                                    key={log.id} 
                                    onClick={() => setSelectedLog(log)}
                                    className="group hover:bg-zinc-900/40 transition-all cursor-pointer"
                                >
                                    <td className="px-6 py-4 text-[10px] text-zinc-600 tabular-nums">{log.time}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ${log.method === 'GET' ? 'text-blue-500 border-blue-500/20 bg-blue-500/5' : 'text-purple-500 border-purple-500/20 bg-purple-500/5'}`}>{log.method}</span>
                                    </td>
                                    <td className="px-6 py-4 text-[10px] font-bold text-zinc-400 truncate max-w-xs">{log.path}</td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={`text-[11px] font-bold tabular-nums ${log.status >= 400 ? 'text-red-500' : 'text-emerald-500'}`}>{log.status}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-40 group-hover:opacity-100 transition-opacity">
                                             <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase">{log.country || 'LOCAL'}</span>
                                             {log.country && log.country !== 'Unknown' && (
                                                <img src={`https://flagcdn.com/16x12/${(countryCodeMap[log.country] || 'un')}.png`} className="w-3.5 h-2.5 rounded-sm grayscale group-hover:grayscale-0 transition-all" alt="" />
                                             )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                
                {logs.length === 0 && (
                    <div className="py-24 text-center flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-md bg-zinc-900/40 border border-border flex items-center justify-center text-zinc-800">
                            <History size={20} />
                        </div>
                        <p className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest">No logs found</p>
                    </div>
                )}
            </div>
        </div>
    );

    const renderMetrics = () => {
        const maxTraffic = Math.max(...trafficStats.map((s: any) => s.requests), 1);
        return (
            <div className="space-y-10 animate-in fade-in zoom-in-95 duration-700">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 p-10 bg-background border border-white/5 rounded-[48px] shadow-2xl relative overflow-hidden group">
                        <div className="absolute inset-0 bg-linear-to-br from-indigo-500/3 to-transparent pointer-events-none" />
                        <div className="flex items-start justify-between mb-12 relative z-10">
                            <div>
                                <p className="text-[10px] font-bold tracking-[0.3em] text-zinc-600 uppercase italic">Volumetric Analysis</p>
                                <h3 className="mt-3 text-2xl font-bold text-white uppercase italic tracking-tighter">Traffic Velocity</h3>
                            </div>
                            <div className="w-12 h-12 rounded-md bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <BarChart size={24} />
                            </div>
                        </div>
                        <div className="h-64 flex items-end gap-2 w-full relative z-10">
                            {trafficStats.map((stat, i) => (
                                <div 
                                    key={i} 
                                    className="flex-1 bg-white/2 rounded-t-xl transition-all hover:bg-white/8 relative group/bar" 
                                    style={{ height: `${Math.max((stat.requests / maxTraffic) * 100, 4)}%` }} 
                                >
                                    <div className="absolute bottom-0 left-0 right-0 bg-indigo-500/20 group-hover/bar:bg-indigo-500 transition-all rounded-t-lg" style={{ height: `${((stat.requests - stat.errors) / stat.requests) * 100}%` }} />
                                    <div className="absolute top-0 left-0 right-0 bg-red-500/40 rounded-t-lg opacity-0 group-hover/bar:opacity-100 transition-all" style={{ height: `${(stat.errors / stat.requests) * 100}%` }} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-10 bg-background border border-white/5 rounded-[48px] shadow-2xl flex flex-col relative overflow-hidden group">
                        <div className="absolute inset-0 bg-linear-to-br from-emerald-500/3 to-transparent pointer-events-none" />
                        <div className="flex items-start justify-between mb-12 relative z-10">
                            <div>
                                <p className="text-[10px] font-bold tracking-[0.3em] text-zinc-600 uppercase italic">Fleet Integrity</p>
                                <h3 className="mt-3 text-2xl font-bold text-white uppercase italic tracking-tighter">System Health</h3>
                            </div>
                            <div className="w-12 h-12 rounded-md bg-emerald-500/5 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <Shield size={24} />
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col justify-center items-center relative z-10">
                             <div className="relative w-40 h-40 flex items-center justify-center">
                                <svg className="w-full h-full -rotate-90">
                                    <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="16" />
                                    {(() => {
                                        const totalReqs = trafficStats.reduce((acc, s) => acc + s.requests, 0);
                                        const totalErrs = trafficStats.reduce((acc, s) => acc + s.errors, 0);
                                        const errorRate = totalReqs > 0 ? (totalErrs / totalReqs) : 0;
                                        const circ = 2 * Math.PI * 70;
                                        return (
                                            <circle 
                                                cx="80" cy="80" r="70" fill="none" stroke="#10b981" strokeWidth="16" 
                                                strokeDasharray={circ}
                                                strokeDashoffset={circ * errorRate}
                                                className="transition-all duration-1000 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                                            />
                                        );
                                    })()}
                                </svg>
                                <div className="absolute flex flex-col items-center">
                                    <span className="text-4xl font-bold text-white leading-none tracking-tighter italic">
                                        {(() => {
                                            const totalReqs = trafficStats.reduce((acc, s) => acc + s.requests, 0);
                                            const totalErrs = trafficStats.reduce((acc, s) => acc + s.errors, 0);
                                            return totalReqs > 0 ? Math.round(((totalReqs - totalErrs) / totalReqs) * 100) : 100;
                                        })()}%
                                    </span>
                                    <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-[0.2em] mt-2 italic leading-none">Healthy_OK</span>
                                </div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.02),transparent_50%)] pointer-events-none" />
            
            {toast && (
                <BrandedToast
                    message={toast.message}
                    tone={toast.tone}
                    onClose={() => setToast(null)}
                />
            )}
            
            <aside className="px-8 py-8 border-b border-border bg-zinc-900/20 relative z-10">
                <div className="flex items-center gap-6">
                    <div className={`w-12 h-12 rounded-md flex items-center justify-center border transition-all duration-700 ${
                        view === 'alerts' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                        view === 'metrics' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                        'bg-primary/10 border-primary/20 text-primary'
                    }`}>
                        {view === 'alerts' && <Shield size={24} />}
                        {view === 'live' && <Activity size={24} />}
                        {view === 'metrics' && <BarChart size={24} />}
                        {view === 'explorer' && <Terminal size={24} />}
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white uppercase tracking-tight">
                            {view === 'explorer' && "Explorer"}
                            {view === 'live' && "Tail"}
                            {view === 'alerts' && "Security"}
                            {view === 'metrics' && "Metrics"}
                        </h1>
                        <div className="mt-1 flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Zap size={10} className="text-primary" />
                                <span className="text-zinc-600 text-[9px] font-bold uppercase tracking-widest">Observability Matrix</span>
                            </div>
                            <div className="w-1 h-1 rounded-full bg-zinc-800" />
                            <div className="flex items-center gap-2">
                                <Clock size={10} className="text-zinc-700" />
                                <span className="text-zinc-700 text-[9px] font-bold uppercase tracking-widest tabular-nums">{new Date().toISOString().split('T')[0]}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-auto custom-scrollbar p-10 relative z-10">
                {view === 'explorer' && renderExplorer()}
                {view === 'live' && renderLiveTail()}
                {view === 'alerts' && renderAlerts()}
                {view === 'metrics' && renderMetrics()}
            </main>

            {selectedLog && (
                <div className="fixed inset-0 z-120 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-500" onClick={(e) => e.target === e.currentTarget && setSelectedLog(null)}>
                    <div className="w-full max-w-xl bg-background border border-border rounded-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500">
                        <header className="px-8 py-6 border-b border-border flex items-center justify-between bg-zinc-900/20">
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-md flex items-center justify-center border ${selectedLog.status >= 400 ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'}`}>
                                    <Shield size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white uppercase tracking-tight">Trace Inspection</h2>
                                    <p className="text-[9px] text-zinc-500 uppercase font-bold mt-1 tracking-widest">ID: {selectedLog.id.slice(0, 16)}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedLog(null)} className="p-2 text-zinc-600 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </header>
                        <div className="p-8 space-y-6 font-mono">
                            <div className="grid grid-cols-2 gap-6">
                                <DetailItem label="METHOD" value={selectedLog.method} highlight={selectedLog.method === 'GET' ? 'text-blue-500' : 'text-purple-500'} />
                                <DetailItem label="STATUS" value={selectedLog.status} highlight={selectedLog.status >= 400 ? 'text-red-500' : 'text-emerald-500'} />
                                <DetailItem label="LATENCY" value={selectedLog.latency} highlight="text-zinc-300" />
                                <DetailItem label="IP" value={selectedLog.ip || 'INTERNAL'} highlight="text-zinc-300" />
                            </div>
                            <div className="space-y-2">
                                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Resource Path</p>
                                <div className="p-4 rounded-md bg-zinc-900/40 border border-border text-[10px] text-zinc-400 break-all leading-relaxed">
                                    {selectedLog.path}
                                </div>
                            </div>
                            {selectedLog.user_agent && (
                                <div className="space-y-2">
                                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">User Agent</p>
                                    <div className="p-4 rounded-md bg-zinc-900/40 border border-border text-[9px] text-zinc-500 leading-relaxed">
                                        {selectedLog.user_agent}
                                    </div>
                                </div>
                            )}
                        </div>
                        <footer className="px-8 py-4 bg-zinc-900/40 border-t border-border flex justify-end">
                            <button onClick={() => setSelectedLog(null)} className="px-6 py-2 bg-zinc-900 border border-border hover:border-zinc-700 text-white text-[9px] font-bold uppercase tracking-widest rounded-md transition-all">Close</button>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
};

const DetailItem = ({ label, value, highlight }: any) => (
    <div className="space-y-3">
        <p className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.3em] italic leading-none">{label}</p>
        <p className={`text-[13px] font-bold italic tracking-tight ${highlight || 'text-zinc-300'}`}>{value || 'NULL'}</p>
    </div>
);

export default LogsAnalytics;

const countryCodeMap: Record<string, string> = {
    "United States": "us", "Canada": "ca", "United Kingdom": "gb", "Germany": "de",
    "France": "fr", "Japan": "jp", "Brazil": "br", "India": "in", "Peru": "pe", "Spain": "es"
};


