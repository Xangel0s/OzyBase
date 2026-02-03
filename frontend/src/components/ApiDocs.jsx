import React, { useState, useEffect } from 'react';
import { BookOpen, FileText, Code, Shield, Database, FolderOpen, Zap, MousePointer2, Copy, Check, Loader2, ChevronRight, Hash, Key, ToggleLeft, Calendar, Type, FileJson } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const ApiDocs = ({ page = 'intro' }) => {
    const [schema, setSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(null);

    useEffect(() => {
        const fetchSchema = async () => {
            try {
                const res = await fetchWithAuth('/api/collections/visualize');
                const data = await res.json();
                setSchema(data);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchSchema();
    }, []);

    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const getColumnIcon = (type) => {
        const t = (type || '').toLowerCase();
        if (t.includes('uuid')) return <Key size={14} className="text-yellow-500" />;
        if (t.includes('int') || t.includes('num')) return <Hash size={14} className="text-blue-400" />;
        if (t.includes('bool')) return <ToggleLeft size={14} className="text-green-400" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={14} className="text-purple-400" />;
        if (t.includes('json')) return <FileJson size={14} className="text-orange-400" />;
        return <Type size={14} className="text-zinc-400" />;
    };

    const getContent = () => {
        if (loading) return (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500 gap-4">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-[10px] font-black uppercase tracking-widest">Compiling Documentation...</span>
            </div>
        );

        if (page === 'db_api') {
            return (
                <div className="space-y-12">
                    <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                        <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Database REST API</h2>
                        <p className="text-zinc-400 mb-6 leading-relaxed">
                            OzyBase automatically generates a full RESTful API for every table in your database.
                            Endpoints are protected by Row Level Security and API Keys.
                        </p>
                    </div>

                    {schema?.tables?.map((table) => (
                        <div key={table.name} className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-[#2e2e2e] pb-4">
                                <Database className="text-primary" size={20} />
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">{table.name}</h3>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Columns & Types</h4>
                                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                            {table.columns.map((col, i) => (
                                                <div key={i} className={`flex items-center justify-between px-4 py-3 text-xs border-b border-[#2e2e2e] last:border-0 hover:bg-zinc-900/50 transition-colors`}>
                                                    <div className="flex items-center gap-3">
                                                        {getColumnIcon(col.type)}
                                                        <span className="font-mono text-zinc-200">{col.name}</span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-zinc-600 uppercase">{col.type}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Usage Example</h4>

                                    {/* GET Example */}
                                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">GET List</span>
                                            <button onClick={() => copyToClipboard(`curl -X GET 'https://api.ozybase.io/api/tables/${table.name}'`, `get-${table.name}`)} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === `get-${table.name}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-[11px] font-mono text-blue-400">
                                                <code>GET /api/tables/{table.name}</code>
                                            </pre>
                                        </div>
                                    </div>

                                    {/* POST Example */}
                                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Insert Row</span>
                                            <button onClick={() => copyToClipboard(`fetch('/api/tables/${table.name}', { method: 'POST', body: JSON.stringify({...}) })`, `post-${table.name}`)} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === `post-${table.name}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-[11px] font-mono text-green-400">
                                                <code>POST /api/tables/{table.name}</code>
                                            </pre>
                                            <pre className="text-[10px] font-mono text-zinc-500 mt-2">
                                                {`{
  ${table.columns.slice(0, 2).map(c => `"${c.name}": "value"`).join(',\n  ')}
}`}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        switch (page) {
            case 'intro':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Introduction</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Welcome to the OzyBase API documentation. OzyBase provides a complete backend-as-a-service
                                interface including database management, authentication, storage, and edge functions.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-6 bg-[#171717] rounded-2xl border border-[#2e2e2e] hover:border-primary/50 transition-all group">
                                    <div className="w-10 h-10 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center mb-4 text-primary group-hover:scale-110 transition-transform">
                                        <Zap size={20} />
                                    </div>
                                    <h3 className="text-sm font-bold text-white mb-2">REST API</h3>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Auto-generated endpoints for all your tables with full CRUD support and query filtering.</p>
                                </div>
                                <div className="p-6 bg-[#171717] rounded-2xl border border-[#2e2e2e] hover:border-primary/50 transition-all group">
                                    <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center mb-4 text-blue-500 group-hover:scale-110 transition-transform">
                                        <MousePointer2 size={20} />
                                    </div>
                                    <h3 className="text-sm font-bold text-white mb-2">Realtime</h3>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Subscribe to database changes via WebSocket. Instant updates for any table.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'auth_api':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Authentication API</h2>
                            <div className="space-y-4">
                                <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-green-500/20 text-green-500 text-[10px] font-black px-2 py-0.5 rounded">POST</span>
                                        <code className="text-zinc-300 text-xs">/api/auth/login</code>
                                    </div>
                                    <p className="text-xs text-zinc-500">Authenticate admin or user and receive JWT token.</p>
                                </div>
                                <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-green-500/20 text-green-500 text-[10px] font-black px-2 py-0.5 rounded">POST</span>
                                        <code className="text-zinc-300 text-xs">/api/auth/signup</code>
                                    </div>
                                    <p className="text-xs text-zinc-500">Create a new user account (Requires Admin Token).</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'storage_api':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Storage API</h2>
                            <div className="space-y-4">
                                <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-green-500/20 text-green-500 text-[10px] font-black px-2 py-0.5 rounded">POST</span>
                                        <code className="text-zinc-300 text-xs">/api/files</code>
                                    </div>
                                    <p className="text-xs text-zinc-500">Upload a file (Multipart form data).</p>
                                </div>
                                <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-blue-500/20 text-blue-500 text-[10px] font-black px-2 py-0.5 rounded">GET</span>
                                        <code className="text-zinc-300 text-xs">/api/files</code>
                                    </div>
                                    <p className="text-xs text-zinc-500">List all storage assets.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-500">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <h2 className="text-xl font-black uppercase tracking-widest opacity-50">Documentation</h2>
                        <p className="text-xs font-mono mt-2">Select a topic from the sidebar</p>
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
                        <BookOpen className="text-primary" size={28} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">API Documentation</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                            <Code size={12} className="text-blue-500" />
                            Auto-Generated Reference v1.0
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar bg-[#0c0c0c]">
                <div className="max-w-6xl mx-auto">
                    {getContent()}
                </div>
            </div>
        </div>
    );
};

export default ApiDocs;
