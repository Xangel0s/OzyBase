import React, { useState, useEffect } from 'react';
import {
    Terminal,
    Search,
    Play,
    History,
    Activity,
    BarChart,
    Filter,
    ArrowRight,
    Clock,
    Globe,
    RefreshCw
} from 'lucide-react';

const LogsAnalytics = () => {
    const [activeTab, setActiveTab] = useState('explorer');
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 3000);
        return () => clearInterval(interval);
    }, []);

    const fetchLogs = async () => {
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/project/logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setLogs(data);
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">
            {/* Header / Subnav */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <BarChart className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Logs & Analytics</h1>
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-0.5 leading-none">Real-time system audit & traffic analysis</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Filter results..."
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl pl-9 pr-6 py-2 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-96 transition-all font-mono"
                            />
                        </div>
                        <button onClick={fetchLogs} className="flex items-center gap-2 p-2 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">
                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Realtime Feed</span>
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(254,254,0,0.6)]" />
                    </div>
                </div>
            </div>

            {/* Content Explorer */}
            <div className="flex-1 overflow-auto custom-scrollbar p-8">
                <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="h-12 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center px-6 justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal size={12} className="text-zinc-600" />
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">GET /api/project/logs --realtime</span>
                        </div>
                    </div>

                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#111111] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 border-b border-[#2e2e2e]">
                                <th className="px-6 py-4">Timestamp</th>
                                <th className="px-6 py-4">Method / Endpoint</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Latency</th>
                                <th className="px-6 py-4">Location</th>
                                <th className="px-6 py-4">Client IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/30 font-mono text-[10px]">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-zinc-600 animate-pulse uppercase font-black tracking-widest">Synchronizing Logs...</td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-zinc-600 uppercase font-black tracking-widest">No audit logs found</td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors group cursor-pointer">
                                        <td className="px-6 py-4 text-zinc-600 group-hover:text-zinc-400 whitespace-nowrap">{log.time}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${log.status >= 400 ? 'bg-red-500/10 text-red-500' : 'bg-primary/20 text-primary'}`}>{log.method}</span>
                                                <ArrowRight size={10} className="text-zinc-800" />
                                                <span className="text-zinc-300 font-bold truncate max-w-sm">{log.path}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-1.5 py-0.5 rounded ${log.status < 400 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                                {log.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-zinc-500">{log.latency}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-zinc-300 font-bold">{log.country || 'Unknown'}</span>
                                                <span className="text-[9px] text-zinc-600 uppercase">{log.city || '---'}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-zinc-700 flex items-center gap-2">
                                            <Globe size={10} />
                                            {log.ip}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default LogsAnalytics;
