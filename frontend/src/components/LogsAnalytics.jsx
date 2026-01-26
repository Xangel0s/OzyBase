import React, { useState } from 'react';
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
    Globe
} from 'lucide-react';

const LogsAnalytics = () => {
    const [activeTab, setActiveTab] = useState('explorer');

    const mockLogs = [
        { id: 1, event: 'API_REQUEST', table: 'users', method: 'GET', status: 200, latency: '12ms', ip: '192.168.1.1', time: '12:04:32' },
        { id: 2, event: 'AUTH_LOGIN', table: 'auth', method: 'POST', status: 200, latency: '138ms', ip: '45.12.33.1', time: '12:05:01' },
        { id: 3, event: 'SQL_EXEC', table: 'profiles', method: 'UPDATE', status: 200, latency: '44ms', ip: '12.0.0.1', time: '12:06:04' },
    ];

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
                    <div className="flex items-center gap-2 bg-[#0c0c0c] border border-[#2e2e2e] p-1 rounded-xl">
                        {['explorer', 'metrics', 'security'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-zinc-800 text-primary' : 'text-zinc-600 hover:text-zinc-300'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Query logs (e.g. status:>400)..."
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl pl-9 pr-6 py-2 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-96 transition-all font-mono"
                            />
                        </div>
                        <button className="flex items-center gap-2 p-2 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">
                            <Filter size={14} />
                            Filters
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
                    {/* Query Result (Mock Referral Image 5 Style) */}
                    <div className="h-12 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center px-6 justify-between">
                        <div className="flex items-center gap-2">
                            <Terminal size={12} className="text-zinc-600" />
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">SELECT * FROM ozy_audit_logs LIMIT 100</span>
                        </div>
                        <div className="flex gap-4">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Last 1 hour</span>
                        </div>
                    </div>

                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#111111] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 border-b border-[#2e2e2e]">
                                <th className="px-6 py-4">Timestamp</th>
                                <th className="px-6 py-4">Event</th>
                                <th className="px-6 py-4">Method / Object</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Latency</th>
                                <th className="px-6 py-4">IP Address</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/30 font-mono text-[10px]">
                            {mockLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors group cursor-pointer">
                                    <td className="px-6 py-4 text-zinc-600 group-hover:text-zinc-400 whitespace-nowrap">{log.time}</td>
                                    <td className="px-6 py-4">
                                        <span className="text-primary font-bold">{log.event}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-zinc-500 uppercase">{log.method}</span>
                                            <ArrowRight size={10} className="text-zinc-800" />
                                            <span className="text-zinc-300 font-bold">{log.table}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-1.5 py-0.5 rounded ${log.status === 200 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                            {log.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-zinc-500">{log.latency}</td>
                                    <td className="px-6 py-4 text-zinc-700 flex items-center gap-2">
                                        <Globe size={10} />
                                        {log.ip}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="p-4 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-center">
                        <button className="text-[9px] font-black uppercase tracking-widest text-zinc-600 hover:text-white transition-colors">Load more audit entries</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LogsAnalytics;
