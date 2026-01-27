import React, { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/api';
import {
    LayoutGrid,
    Globe,
    Zap,
    History,
    Cpu,
    Shield,
    Code,
    Plus,
    MoreVertical,
    CheckCircle,
    XCircle,
    ExternalLink,
    Search,
    RefreshCw,
    Loader2
} from 'lucide-react';

const Integrations = ({ page = 'wrappers' }) => {
    const [extensions, setExtensions] = useState([]);
    const [loading, setLoading] = useState(false);

    // Mock data for wrappers (Foreign Data Wrappers)
    const wrappers = [
        { id: 'stripe', name: 'Stripe', desc: 'Payment processing and billing', status: 'available', icon: '💳' },
        { id: 'firebase', name: 'Firebase', desc: 'Google Firebase integration', status: 'available', icon: '🔥' },
        { id: 's3', name: 'AWS S3', desc: 'Amazon S3 storage wrapper', status: 'available', icon: '☁️' },
        { id: 'airtable', name: 'Airtable', desc: 'Airtable database sync', status: 'available', icon: '📊' },
        { id: 'clickhouse', name: 'ClickHouse', desc: 'Analytics database wrapper', status: 'coming_soon', icon: '⚡' },
        { id: 'bigquery', name: 'BigQuery', desc: 'Google BigQuery integration', status: 'coming_soon', icon: '📈' }
    ];

    // Mock PG Extensions
    const pgExtensions = [
        { name: 'uuid-ossp', desc: 'UUID generation functions', enabled: true },
        { name: 'pgcrypto', desc: 'Cryptographic functions', enabled: true },
        { name: 'pg_trgm', desc: 'Trigram matching for text search', enabled: false },
        { name: 'postgis', desc: 'Geographic information systems', enabled: false },
        { name: 'pg_stat_statements', desc: 'Query performance statistics', enabled: true },
        { name: 'pg_cron', desc: 'Scheduled job execution', enabled: false },
        { name: 'pgjwt', desc: 'JSON Web Token support', enabled: true },
        { name: 'vector', desc: 'Vector similarity search (pgvector)', enabled: false },
        { name: 'http', desc: 'HTTP client for PostgreSQL', enabled: false },
        { name: 'pg_graphql', desc: 'GraphQL API layer', enabled: false }
    ];

    const getContent = () => {
        switch (page) {
            case 'wrappers':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">Foreign Data Wrappers</h2>
                                <p className="text-zinc-500 text-xs mt-1">Connect external data sources directly to your database</p>
                            </div>
                            <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                                <Plus size={14} /> Add Wrapper
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {wrappers.map((w) => (
                                <div key={w.id} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-5 hover:border-zinc-600 transition-all group">
                                    <div className="flex items-start justify-between mb-3">
                                        <span className="text-2xl">{w.icon}</span>
                                        {w.status === 'coming_soon' ? (
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 bg-zinc-800 px-2 py-1 rounded">Soon</span>
                                        ) : (
                                            <button className="text-zinc-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100">
                                                <MoreVertical size={16} />
                                            </button>
                                        )}
                                    </div>
                                    <h3 className="text-sm font-bold text-white mb-1">{w.name}</h3>
                                    <p className="text-xs text-zinc-500 mb-4">{w.desc}</p>
                                    {w.status === 'available' ? (
                                        <button className="w-full py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:border-zinc-500 transition-all">
                                            Enable Wrapper
                                        </button>
                                    ) : (
                                        <button disabled className="w-full py-2 bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg text-xs font-bold text-zinc-700 cursor-not-allowed">
                                            Coming Soon
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'webhooks':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">Webhooks</h2>
                                <p className="text-zinc-500 text-xs mt-1">Send HTTP requests when database events occur</p>
                            </div>
                            <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                                <Plus size={14} /> Create Webhook
                            </button>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-8 text-center">
                            <Zap size={40} className="text-zinc-700 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-zinc-400 mb-2">No webhooks configured</h3>
                            <p className="text-xs text-zinc-600 mb-6">Create your first webhook to trigger HTTP requests on database changes</p>
                            <button className="px-6 py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl text-xs font-bold text-zinc-300 hover:border-primary/50 transition-all">
                                Learn More
                            </button>
                        </div>
                    </div>
                );

            case 'cron':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">Cron Jobs</h2>
                                <p className="text-zinc-500 text-xs mt-1">Schedule recurring database tasks with pg_cron</p>
                            </div>
                            <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                                <Plus size={14} /> New Job
                            </button>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                            <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Scheduled Tasks</span>
                            </div>
                            <div className="p-8 text-center">
                                <History size={40} className="text-zinc-700 mx-auto mb-4" />
                                <p className="text-sm text-zinc-500">No cron jobs scheduled yet</p>
                                <p className="text-xs text-zinc-600 mt-2">Enable pg_cron extension first</p>
                            </div>
                        </div>
                    </div>
                );

            case 'extensions':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">PostgreSQL Extensions</h2>
                                <p className="text-zinc-500 text-xs mt-1">Enable powerful database extensions</p>
                            </div>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                <input
                                    type="text"
                                    placeholder="Search extensions..."
                                    className="bg-[#111111] border border-[#2e2e2e] rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-64"
                                />
                            </div>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-widest text-zinc-600 border-b border-[#2e2e2e]">
                                        <th className="px-6 py-4 text-left">Extension</th>
                                        <th className="px-6 py-4 text-left">Description</th>
                                        <th className="px-6 py-4 text-center">Status</th>
                                        <th className="px-6 py-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#2e2e2e]/50">
                                    {pgExtensions.map((ext) => (
                                        <tr key={ext.name} className="hover:bg-zinc-900/30 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-bold text-zinc-200 font-mono">{ext.name}</span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-zinc-500">{ext.desc}</td>
                                            <td className="px-6 py-4 text-center">
                                                {ext.enabled ? (
                                                    <span className="inline-flex items-center gap-1 text-green-500 text-[10px] font-bold uppercase">
                                                        <CheckCircle size={12} /> Enabled
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-zinc-600 text-[10px] font-bold uppercase">
                                                        <XCircle size={12} /> Disabled
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${ext.enabled
                                                    ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                                                    : 'bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20'
                                                    }`}>
                                                    {ext.enabled ? 'Disable' : 'Enable'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );

            case 'vault':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">Vault</h2>
                                <p className="text-zinc-500 text-xs mt-1">Securely store secrets, API keys, and sensitive data</p>
                            </div>
                            <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                                <Plus size={14} /> Add Secret
                            </button>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-8 text-center">
                            <Shield size={40} className="text-zinc-700 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-zinc-400 mb-2">Vault is empty</h3>
                            <p className="text-xs text-zinc-600">Securely store your API keys and connection strings</p>
                        </div>
                    </div>
                );

            case 'graphql':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">GraphQL</h2>
                                <p className="text-zinc-500 text-xs mt-1">Auto-generated GraphQL API powered by pg_graphql</p>
                            </div>
                            <button className="flex items-center gap-2 bg-[#2e2e2e] text-zinc-300 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-700 transition-all">
                                <ExternalLink size={14} /> Open Playground
                            </button>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm font-bold text-white">GraphQL Endpoint</span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded border border-yellow-500/20">Requires Extension</span>
                            </div>
                            <div className="bg-[#0c0c0c] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400">
                                https://your-project.ozybase.io/graphql/v1
                            </div>
                            <p className="text-xs text-zinc-600 mt-4">Enable the pg_graphql extension to auto-generate a GraphQL API from your database schema.</p>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="flex items-center justify-center h-[50vh] text-zinc-500">
                        <LayoutGrid size={48} className="opacity-20" />
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                        <LayoutGrid className="text-primary" size={28} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Integrations</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                            <Globe size={12} className="text-blue-500" />
                            Extensions, Wrappers & Third-Party Services
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                {getContent()}
            </div>
        </div>
    );
};

export default Integrations;
