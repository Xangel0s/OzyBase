import React, { useState, useEffect } from 'react';
import {
    Terminal, Search, Play, History, Activity, BarChart,
    Filter, ArrowRight, Clock, Globe, RefreshCw, Zap
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const LogsAnalytics = () => {
    const [trafficStats, setTrafficStats] = useState([]);
    const [geoStats, setGeoStats] = useState([]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAllData();
        const interval = setInterval(fetchAllData, 5000); // 5s refresh
        return () => clearInterval(interval);
    }, []);

    const fetchAllData = async () => {
        if (!loading) setLoading(true); // Optional: show loading on refresh
        try {
            // Parallel fetching for performance
            const [trafficRes, geoRes, logsRes] = await Promise.all([
                fetchWithAuth('/api/analytics/traffic'),
                fetchWithAuth('/api/analytics/geo'),
                fetchWithAuth('/api/project/logs')
            ]);

            if (trafficRes.ok) setTrafficStats(await trafficRes.json());
            if (geoRes.ok) setGeoStats(await geoRes.json());
            if (logsRes.ok) {
                const logsData = await logsRes.json();
                if (Array.isArray(logsData)) setLogs(logsData);
            }
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
        } finally {
            setLoading(false);
        }
    };

    // Helper to find max for scaling charts
    const maxTraffic = Math.max(...trafficStats.map(s => s.requests), 1);

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden font-sans">
            {/* Header */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                            <Activity className="text-indigo-400" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">
                                Live <span className="text-indigo-400">Analytics</span>
                            </h1>
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-0.5 leading-none">
                                Powered by Go High-Performance Engine
                            </p>
                        </div>
                    </div>
                    <button onClick={fetchAllData} className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:border-zinc-700 transition-all">
                        <RefreshCw size={14} className={loading && "animate-spin"} /> Refresh
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar p-8 space-y-8">

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Traffic Chart (Powered by Go Aggregations) */}
                    <div className="lg:col-span-2 p-6 bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl relative overflow-hidden group hover:border-[#3e3e3e] transition-all">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <BarChart size={16} className="text-indigo-400" />
                                Traffic Volume (24h)
                            </h3>
                            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded font-mono">
                                {trafficStats.reduce((acc, curr) => acc + curr.requests, 0)} Req
                            </span>
                        </div>

                        <div className="h-40 flex items-end gap-1 w-full">
                            {trafficStats.length === 0 ? (
                                <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600">No traffic data yet</div>
                            ) : (
                                trafficStats.map((stat, i) => (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group/bar">
                                        <div
                                            className="w-full bg-indigo-500/20 hover:bg-indigo-500 rounded-t-sm transition-all relative"
                                            style={{ height: `${(stat.requests / maxTraffic) * 100}%` }}
                                        >
                                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-black text-[9px] font-bold px-2 py-1 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                                {stat.requests} reqs • {new Date(stat.time).getHours()}:00
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="h-px bg-zinc-800 w-full mt-2" />
                        <div className="flex justify-between mt-2 text-[9px] text-zinc-600 font-mono uppercase">
                            <span>24 Hours Ago</span>
                            <span>Now</span>
                        </div>
                    </div>

                    {/* Geo Stats (Powered by Go Geo-Grouping) */}
                    <div className="p-6 bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-6">
                            <Globe size={16} className="text-emerald-400" />
                            Top Regions
                        </h3>
                        <div className="space-y-4">
                            {geoStats.map((geo, i) => (
                                <div key={i} className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold text-zinc-400 uppercase">
                                        <span>{geo.country || 'Unknown'}</span>
                                        <span>{geo.count}</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full"
                                            style={{ width: `${(geo.count / (geoStats[0]?.count || 1)) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                            {geoStats.length === 0 && <div className="text-xs text-zinc-600 text-center py-10">No geo data</div>}
                        </div>
                    </div>
                </div>

                {/* Recent Logs Table */}
                <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="h-12 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center px-6 justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal size={12} className="text-zinc-600" />
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Live Audit Stream</span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-zinc-600 font-bold uppercase">
                            <Zap size={10} className="text-yellow-500" /> Live Feed
                        </div>
                    </div>

                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#111111] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 border-b border-[#2e2e2e]">
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4">Endpoint</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Latency</th>
                                <th className="px-6 py-4">Origin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/30 font-mono text-[10px]">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors group">
                                    <td className="px-6 py-4 text-zinc-600 whitespace-nowrap w-32">{new Date(log.time).toLocaleTimeString()}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${log.method === 'GET' ? 'text-blue-400 bg-blue-400/10' : 'text-purple-400 bg-purple-400/10'}`}>{log.method}</span>
                                            <span className="text-zinc-300 truncate max-w-[200px]">{log.path}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-0.5 rounded ${log.status >= 400 ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
                                            {log.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-zinc-500">{log.latency}</td>
                                    <td className="px-6 py-4 text-zinc-400 flex items-center gap-2">
                                        {log.country && <img src={`https://flagcdn.com/16x12/${log.country === 'Unknown' ? 'un' : (countryCodeMap[log.country] || 'un')}.png`} className="w-3 h-2 opacity-70" alt="" onError={(e) => e.target.style.display = 'none'} />}
                                        {log.country || 'Localhost'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// Simple map for flags (optional/incomplete, improves UI)
const countryCodeMap = {
    "United States": "us", "Canada": "ca", "United Kingdom": "gb", "Germany": "de",
    "France": "fr", "Japan": "jp", "Brazil": "br", "India": "in"
};

export default LogsAnalytics;
