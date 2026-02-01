import React, { useState, useEffect } from 'react';
import {
    Zap,
    Terminal,
    Play,
    Plus,
    Search,
    MoreVertical,
    ExternalLink,
    Code,
    Cpu,
    Globe
} from 'lucide-react';

const EdgeFunctions = () => {
    const [functions, setFunctions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchFunctions();
    }, []);

    const fetchFunctions = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/functions', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setFunctions(data);
            }
        } catch (error) {
            console.error('Failed to fetch functions:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Zap className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Edge Functions</h1>
                            <p className="text-zinc-500 text-sm font-medium">Server-side logic running at the edge.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 bg-[#2e2e2e] hover:bg-[#3e3e3e] text-zinc-300 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all">
                            <Terminal size={14} />
                            CLI Docs
                        </button>
                        <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                            <Plus size={14} strokeWidth={3} />
                            New Function
                        </button>
                    </div>
                </div>

                {/* Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                    {[
                        { title: 'Total Executions', value: '0', icon: Play, color: 'text-primary' },
                        { title: 'Avg. Latency', value: '0ms', icon: Cpu, color: 'text-green-500' },
                        { title: 'Global Regions', value: '1', icon: Globe, color: 'text-blue-500' },
                    ].map((card, i) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-xl p-4 flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center ${card.color}`}>
                                <card.icon size={18} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{card.title}</p>
                                <p className="text-xl font-black text-white tracking-tighter">{card.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* List Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Search functions..."
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-64 transition-all"
                            />
                        </div>
                        <button
                            onClick={fetchFunctions}
                            className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary transition-colors"
                        >
                            Refresh
                        </button>
                    </div>

                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#0c0c0c] text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                                <th className="px-6 py-4">Function Name</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Endpoint</th>
                                <th className="px-6 py-4">Last Run</th>
                                <th className="px-6 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/50">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-10 text-center text-zinc-500 text-xs font-bold uppercase">Loading...</td>
                                </tr>
                            ) : functions.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-10 text-center text-zinc-500 text-xs font-bold uppercase">No functions deployed</td>
                                </tr>
                            ) : (
                                functions.map((fn) => (
                                    <tr key={fn.id} className="hover:bg-zinc-900/40 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500 group-hover:text-primary transition-colors">
                                                    <Code size={16} />
                                                </div>
                                                <span className="text-sm font-bold text-zinc-200">{fn.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${fn.status === 'Active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-zinc-600'}`} />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{fn.status}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500 bg-[#171717] px-2 py-1 rounded border border-[#2e2e2e] w-fit">
                                                {fn.url}
                                                <ExternalLink size={10} className="hover:text-primary cursor-pointer" />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-zinc-600 uppercase font-bold tracking-tight">
                                            {fn.lastRun}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="p-2 text-zinc-600 hover:text-zinc-200 transition-colors">
                                                <MoreVertical size={16} />
                                            </button>
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

export default EdgeFunctions;
