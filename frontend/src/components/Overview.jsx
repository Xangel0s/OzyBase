import React, { useState, useEffect } from 'react';
import {
    Database,
    Zap,
    Activity,
    ShieldCheck,
    Lock,
    Cpu,
    Server,
    ExternalLink,
    Search,
    ChevronDown,
    Menu,
    Triangle,
    AlertTriangle,
    Shield,
    FolderOpen,
    MousePointer2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

// --- Mini Charts Components (Mock Implementation) ---
const BarChart = ({ label, value, color }) => (
    <div className="flex-1 flex flex-col justify-end h-24 gap-1">
        <div className="flex items-end justify-between h-16 gap-2 px-2">
            {[30, 45, 20, 60, 40, 80, 50].map((h, i) => (
                <div key={i} className={`w-1 rounded-t-sm ${color}`} style={{ height: `${h}%`, opacity: 0.5 + (i / 14) }}></div>
            ))}
        </div>
        <div className="flex justify-between text-[9px] font-black text-zinc-600 uppercase tracking-tight mt-2 px-1">
            <span>Jan 26, 12:07am</span>
            <span>Jan 26, 1:07am</span>
        </div>
    </div>
);

const Overview = ({ onTableSelect }) => {
    // Stats State - Mocked for the requested design
    const [mockStats] = useState({
        database: { requests: 5, color: 'bg-green-500' },
        auth: { requests: 3, color: 'bg-green-500' },
        storage: { requests: 1, color: 'bg-green-500' },
        realtime: { requests: 0, color: 'bg-zinc-700' }
    });

    const [issuesTab, setIssuesTab] = useState('security'); // 'security' | 'performance'

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar p-10 font-sans">

            {/* Top Bar / Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-black text-white italic tracking-tighter uppercase">vlaberapp <span className="text-[10px] not-italic font-black text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded ml-2 align-middle">NANO</span></h1>
                </div>
                <div className="flex items-center gap-12">
                    <div className="flex items-center gap-8">
                        <div className="text-center">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Tables</p>
                            <p className="text-xl font-black text-white leading-none">6</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Functions</p>
                            <p className="text-xl font-black text-white leading-none">0</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Replicas</p>
                            <p className="text-xl font-black text-white leading-none">0</p>
                        </div>
                    </div>
                    <button className="bg-zinc-900 border border-zinc-700 text-zinc-300 px-4 py-1.5 rounded-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:border-green-500/50 transition-colors">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_5px_rgba(34,197,94,0.6)]"></div>
                        Project Status
                    </button>
                </div>
            </div>

            <div className="w-full h-[1px] bg-[#2e2e2e] mb-8" />

            {/* Filter */}
            <div className="flex items-center gap-4 mb-8">
                <button className="flex items-center gap-2 bg-[#171717] border border-[#2e2e2e] px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-300 hover:text-white transition-colors">
                    Last 60 minutes
                    <ChevronDown size={14} />
                </button>
                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Statistics for last 60 minutes</span>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                {/* Database Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Database size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Database</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">REST Requests</p>
                    <p className="text-2xl font-black text-white mb-6">5</p>
                    <BarChart color="bg-green-500" />
                </div>

                {/* Auth Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Lock size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Auth</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Auth Requests</p>
                    <p className="text-2xl font-black text-white mb-6">3</p>
                    <BarChart color="bg-green-500" />
                </div>

                {/* Storage Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <FolderOpen size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Storage</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Storage Requests</p>
                    <p className="text-2xl font-black text-white mb-6">1</p>
                    <BarChart color="bg-green-500" />
                </div>

                {/* Realtime Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <MousePointer2 size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Realtime</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Realtime Requests</p>
                    <p className="text-2xl font-black text-white mb-6">0</p>
                    <BarChart color="bg-zinc-700" />
                </div>
            </div>

            <h3 className="text-lg font-black text-white mb-6 flex items-center gap-2">
                20 issues need <span className="text-amber-500">attention</span>
            </h3>

            {/* Bottom Panels Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">
                {/* Issues Panel */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col h-96">
                    <div className="flex items-center border-b border-[#2e2e2e]">
                        <button
                            onClick={() => setIssuesTab('security')}
                            className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-colors ${issuesTab === 'security' ? 'text-white border-white' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                }`}
                        >
                            Security <span className="bg-amber-500/20 text-amber-500 px-1.5 rounded text-[9px]">2</span>
                        </button>
                        <button
                            onClick={() => setIssuesTab('performance')}
                            className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-colors ${issuesTab === 'performance' ? 'text-white border-white' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                }`}
                        >
                            Performance <span className="bg-amber-500/20 text-amber-500 px-1.5 rounded text-[9px]">18</span>
                        </button>
                        <div className="ml-auto mr-4">
                            <ExternalLink size={14} className="text-zinc-600 hover:text-zinc-300 cursor-pointer" />
                        </div>
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                        {issuesTab === 'security' ? (
                            <div className="space-y-2">
                                <div className="p-3 hover:bg-zinc-900/50 rounded-lg group cursor-pointer transition-colors flex items-start gap-3">
                                    <Shield size={16} className="text-zinc-600 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-mono text-zinc-300 group-hover:text-primary transition-colors">Function `public.handle_new_user` has a role mutable search_path</p>
                                    </div>
                                </div>
                                <div className="p-3 hover:bg-zinc-900/50 rounded-lg group cursor-pointer transition-colors flex items-start gap-3">
                                    <Lock size={16} className="text-zinc-600 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-mono text-zinc-300 group-hover:text-primary transition-colors">Supabase Auth prevents the use of compromised passwords by checking agains...</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                <AlertTriangle size={32} className="mb-2 opacity-50" />
                                <p className="text-xs font-bold uppercase tracking-widest">18 Performance hints available</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Slow Queries Panel */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col h-96">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between">
                        <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Slow Queries</h4>
                        <ExternalLink size={14} className="text-zinc-600 hover:text-zinc-300 cursor-pointer" />
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col">
                        <div className="grid grid-cols-12 px-6 py-2 border-b border-[#2e2e2e] bg-[#0c0c0c]">
                            <div className="col-span-8 text-[9px] font-black text-zinc-600 uppercase tracking-widest">Query</div>
                            <div className="col-span-2 text-[9px] font-black text-zinc-600 uppercase tracking-widest text-right">Avg Time</div>
                            <div className="col-span-2 text-[9px] font-black text-zinc-600 uppercase tracking-widest text-right">Calls</div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {[
                                { q: 'SELECT name FROM pg_timezone_names', t: '0.20s', c: '75' },
                                { q: 'LOCK TABLE "realtime"."schema_migrations" IN SHARE...', t: '0.21s', c: '132' },
                                { q: '-- postgres-migrations disable-transaction CREATE...', t: '0.99s', c: '1' },
                                { q: 'SELECT wal->>$5 as type, wal->>$6 as schema, wal-...', t: '0.00s', c: '46407' },
                                { q: 'SELECT e.name, n.nspname AS schema, e.default_ver...', t: '0.06s', c: '58' },
                                { q: 'SELECT * FROM auth.users WHERE email = $1', t: '0.15s', c: '12' },
                                { q: 'UPDATE public.profiles SET updated_at = NOW() SHE...', t: '0.34s', c: '89' },
                            ].map((item, i) => (
                                <div key={i} className="grid grid-cols-12 px-6 py-3 border-b border-[#2e2e2e]/50 hover:bg-zinc-900/40 transition-colors cursor-pointer group">
                                    <div className="col-span-8 text-[10px] font-mono text-zinc-300 truncate pr-4 group-hover:text-primary transition-colors">{item.q}</div>
                                    <div className="col-span-2 text-[10px] font-mono text-zinc-400 text-right">{item.t}</div>
                                    <div className="col-span-2 text-[10px] font-mono text-zinc-400 text-right">{item.c}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Overview;
