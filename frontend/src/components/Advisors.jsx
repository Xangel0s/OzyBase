import React, { useState } from 'react';
import {
    ShieldCheck,
    AlertTriangle,
    Zap,
    CheckCircle2,
    Info,
    RefreshCw,
    Play,
    Terminal,
    Cpu,
    Lock
} from 'lucide-react';

const Advisors = () => {
    const [issues] = useState([
        { id: 1, type: 'Security', severity: 'Critical', title: 'Public Access on System Table', desc: 'The table "_v_users" is currently world-readable. Change access to admin only.', status: 'Error' },
        { id: 2, type: 'Performance', severity: 'Warning', title: 'Missing Index on Email', desc: 'Queries on "users" using "email" column might be slow. Add a B-tree index.', status: 'Warning' },
        { id: 3, type: 'Linter', severity: 'Info', title: 'Redundant Column Type', desc: 'Column "phone" in table "profiles" uses TEXT but could be VARCHAR(20).', status: 'Info' }
    ]);

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <ShieldCheck className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Advisors</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest text-[10px]">Security, Performance & Best Practices</p>
                        </div>
                    </div>
                    <button className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-widest hover:text-primary hover:border-primary/30 transition-all">
                        <RefreshCw size={14} />
                        Re-scan Database
                    </button>
                </div>

                {/* Score Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { title: 'Security Score', value: '82/100', status: 'Healthy', color: 'text-green-500' },
                        { title: 'Performance', value: 'B+', status: 'Optimized', color: 'text-primary' },
                        { title: 'Data Integrity', value: 'Grade A', status: 'Strict', color: 'text-blue-500' }
                    ].map((card, i) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-6 relative overflow-hidden group">
                            <div className="relative z-10">
                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">{card.title}</p>
                                <h3 className={`text-2xl font-black ${card.color} tracking-tighter italic`}>{card.value}</h3>
                                <div className="mt-3 flex items-center gap-2">
                                    <div className={`w-1 h-1 rounded-full ${card.color.replace('text', 'bg')}`} />
                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{card.status}</span>
                                </div>
                            </div>
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <CheckCircle2 size={64} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Issues Explorer */}
            <div className="p-8">
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white underline decoration-primary underline-offset-8">Critical Issues ({issues.length})</h4>
                        <div className="flex gap-2">
                            <button className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-md text-[9px] font-black uppercase text-zinc-500 hover:text-white transition-colors">By Severity</button>
                            <button className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-md text-[9px] font-black uppercase text-zinc-500 hover:text-white transition-colors">By Category</button>
                        </div>
                    </div>

                    {issues.map((issue) => (
                        <div key={issue.id} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-xl group hover:border-zinc-700 transition-all">
                            <div className="flex items-stretch">
                                <div className={`w-1.5 ${issue.status === 'Error' ? 'bg-red-500 shadow-[2px_0_15px_rgba(239,68,68,0.4)]' :
                                        issue.status === 'Warning' ? 'bg-primary shadow-[2px_0_15px_rgba(254,254,0,0.4)]' :
                                            'bg-blue-500'
                                    }`} />
                                <div className="flex-1 p-6 flex items-start justify-between gap-6">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${issue.type === 'Security' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                    issue.type === 'Performance' ? 'bg-primary/10 text-primary border border-primary/20' :
                                                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                }`}>
                                                {issue.type}
                                            </span>
                                            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-tight truncate">{issue.title}</h3>
                                        </div>
                                        <p className="text-xs text-zinc-500 font-medium leading-relaxed max-w-2xl">
                                            {issue.desc}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button className="px-4 py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all">
                                            Dismiss
                                        </button>
                                        <button className="px-4 py-2 bg-zinc-100 text-black border border-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:border-primary transition-all flex items-center gap-2">
                                            <Zap size={12} fill="currentColor" />
                                            Auto-Fix
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Database Operations Mockup */}
                <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {[
                        { title: 'Vulnerabilities', items: '0 detected', icon: Lock },
                        { title: 'Linter Checks', items: '12 passed', icon: Terminal },
                        { title: 'Query Stats', items: 'Enabled', icon: Cpu }
                    ].map((item, i) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-5 flex items-center justify-between group cursor-pointer hover:bg-zinc-900/30 transition-all">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover:text-zinc-200 transition-colors">
                                    <item.icon size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.1em]">{item.title}</p>
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-tight">{item.items}</p>
                                </div>
                            </div>
                            <Play size={14} className="text-zinc-800 group-hover:text-primary transition-colors" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Advisors;
