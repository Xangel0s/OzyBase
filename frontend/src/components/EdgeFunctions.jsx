import React, { useEffect, useMemo, useState } from 'react';
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
    Globe,
    RefreshCw,
    Key,
    ScrollText,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const VIEW_META = {
    functions: { title: 'Edge Functions', subtitle: 'JavaScript runtime engine', accent: Zap },
    deployments: { title: 'Deployments', subtitle: 'Published edge nodes and endpoints', accent: Globe },
    secrets: { title: 'Env Variables', subtitle: 'Vault-backed runtime variables', accent: Key },
    logs: { title: 'Edge Logs', subtitle: 'Recent function traffic and diagnostics', accent: ScrollText },
};

const EdgeFunctions = ({ view = 'functions' }) => {
    const [functions, setFunctions] = useState([]);
    const [vaultSecrets, setVaultSecrets] = useState([]);
    const [edgeLogs, setEdgeLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [currentFn, setCurrentFn] = useState({
        name: '',
        script: '// Write your JS here\nreturn { message: "Hello from OzyBase!" };',
    });

    useEffect(() => {
        fetchFunctions();
    }, []);

    useEffect(() => {
        if (view === 'secrets') {
            fetchVaultSecrets();
            return;
        }
        if (view === 'logs') {
            fetchEdgeLogs();
        }
    }, [view]);

    const fetchFunctions = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/functions');
            const data = await res.json();
            setFunctions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch functions:', error);
            setFunctions([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchVaultSecrets = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/vault');
            const data = await res.json();
            setVaultSecrets(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch edge secrets:', error);
            setVaultSecrets([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchEdgeLogs = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/logs?limit=50');
            const data = await res.json();
            const logs = Array.isArray(data?.logs) ? data.logs : [];
            setEdgeLogs(logs.filter((log) => String(log.path || '').includes('/api/functions')));
        } catch (error) {
            console.error('Failed to fetch edge logs:', error);
            setEdgeLogs([]);
        } finally {
            setLoading(false);
        }
    };

    const saveFunction = async () => {
        try {
            const res = await fetchWithAuth('/api/functions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentFn),
            });
            if (res.ok) {
                setShowModal(false);
                fetchFunctions();
            }
        } catch (error) {
            console.error('Save failed:', error);
        }
    };

    const invokeFunction = async (name) => {
        try {
            const res = await fetchWithAuth(`/api/functions/${name}/invoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ test: true }),
            });
            const data = await res.json();
            alert(`Result: ${JSON.stringify(data.result, null, 2)}`);
        } catch (error) {
            alert(`Invoke failed: ${error.message}`);
        }
    };

    const meta = VIEW_META[view] || VIEW_META.functions;

    const summaryCards = useMemo(
        () => [
            { title: 'Active Nodes', value: functions.length.toString(), icon: Zap, color: 'text-primary' },
            { title: 'Engine Protocol', value: 'Goja/V8', icon: Cpu, color: 'text-zinc-400' },
            { title: 'Global Sync', value: 'Enabled', icon: Globe, color: 'text-zinc-400' },
        ],
        [functions.length],
    );

    const renderFunctions = () => (
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
                <button onClick={fetchFunctions} className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary">
                    Refresh
                </button>
            </div>
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-[#0c0c0c] text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 border-b border-[#2e2e2e]">
                        <th className="px-6 py-4">Function</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Endpoint</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#2e2e2e]/50">
                    {loading ? (
                        <tr><td colSpan="4" className="px-6 py-20 text-center text-zinc-600 font-black uppercase tracking-widest text-[10px]">Syncing with edge nodes...</td></tr>
                    ) : functions.length === 0 ? (
                        <tr><td colSpan="4" className="px-6 py-20 text-center text-zinc-600 font-black uppercase tracking-widest text-[10px]">No functions deployed to the edge</td></tr>
                    ) : (
                        functions.map((fn) => (
                            <tr key={fn.id || fn.name} className="hover:bg-zinc-900/40 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 group-hover:text-primary transition-colors">
                                            <Code size={16} />
                                        </div>
                                        <span className="text-sm font-bold text-zinc-200">{fn.name}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-green-500/80">Active</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="bg-[#0c0c0c] border border-zinc-900 px-3 py-1 rounded-full text-[10px] font-mono text-zinc-500 flex items-center gap-2 w-fit">
                                        {fn.url}
                                        <ExternalLink size={10} className="text-zinc-700 hover:text-primary cursor-pointer transition-colors" />
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => invokeFunction(fn.name)}
                                            className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black transition-all"
                                        >
                                            <Play size={14} fill="currentColor" />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setCurrentFn(fn);
                                                setShowModal(true);
                                            }}
                                            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-all"
                                        >
                                            <MoreVertical size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );

    const renderDeployments = () => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {functions.length === 0 && !loading ? (
                <div className="col-span-full bg-[#111111] border border-[#2e2e2e] rounded-3xl p-10 text-center text-zinc-500 font-black uppercase tracking-widest text-[10px]">
                    No edge deployments published yet
                </div>
            ) : (
                functions.map((fn) => (
                    <div key={fn.id || fn.name} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl">
                        <div className="flex items-start justify-between mb-5">
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">{fn.name}</h3>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mt-1">Published deployment</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-[9px] font-black uppercase tracking-widest">
                                Synced
                            </span>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                                <span className="text-zinc-500">Endpoint</span>
                                <code className="text-primary text-[11px]">{fn.url}</code>
                            </div>
                            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                                <span className="text-zinc-500">Runtime</span>
                                <span className="font-bold text-white">JavaScript / Goja</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-zinc-500">Dispatch mode</span>
                                <span className="font-bold text-white">HTTP invoke</span>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );

    const renderSecrets = () => (
        <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">Runtime variables</h3>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mt-1">Read-only view of shared vault secrets</p>
                </div>
                <button onClick={fetchVaultSecrets} className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all">
                    <RefreshCw size={16} />
                </button>
            </div>
            <div className="p-6 space-y-4">
                {loading ? (
                    <div className="text-center text-zinc-600 font-black uppercase tracking-widest text-[10px] py-16">Loading secrets...</div>
                ) : vaultSecrets.length === 0 ? (
                    <div className="text-center text-zinc-600 font-black uppercase tracking-widest text-[10px] py-16">No vault secrets available</div>
                ) : (
                    vaultSecrets.map((secret) => (
                        <div key={secret.id} className="border border-zinc-900 rounded-2xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-black text-white">{secret.key}</p>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mt-1">{secret.description || 'No description'}</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 text-[9px] font-black uppercase tracking-widest">
                                Vault
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderLogs = () => (
        <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Invocation traffic</h3>
                <button onClick={fetchEdgeLogs} className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all">
                    <RefreshCw size={16} />
                </button>
            </div>
            <div className="divide-y divide-zinc-900">
                {loading ? (
                    <div className="text-center text-zinc-600 font-black uppercase tracking-widest text-[10px] py-16">Loading logs...</div>
                ) : edgeLogs.length === 0 ? (
                    <div className="text-center text-zinc-600 font-black uppercase tracking-widest text-[10px] py-16">No function logs detected yet</div>
                ) : (
                    edgeLogs.map((log) => (
                        <div key={log.id} className="px-6 py-4 flex items-center justify-between gap-6">
                            <div>
                                <p className="text-sm font-bold text-white">{log.method} {log.path}</p>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mt-1">
                                    status {log.status} • latency {log.latency_ms}ms
                                </p>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500">{log.created_at}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderContent = () => {
        switch (view) {
            case 'deployments':
                return renderDeployments();
            case 'secrets':
                return renderSecrets();
            case 'logs':
                return renderLogs();
            case 'functions':
            default:
                return renderFunctions();
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <meta.accent className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">{meta.title}</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest flex items-center gap-2">
                                <Cpu size={14} className="text-primary" />
                                {meta.subtitle}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 bg-[#2e2e2e] hover:bg-[#3e3e3e] text-zinc-300 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all">
                            <Terminal size={14} />
                            CLI Docs
                        </button>
                        {view === 'functions' && (
                            <button
                                onClick={() => {
                                    setCurrentFn({
                                        name: '',
                                        script: '// Write your JS here\nreturn { message: "Hello from OzyBase!" };',
                                    });
                                    setShowModal(true);
                                }}
                                className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]"
                            >
                                <Plus size={14} strokeWidth={3} />
                                New Function
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {summaryCards.map((card) => (
                        <div key={card.title} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-4 flex items-center gap-4">
                            <div className={`p-3 rounded-xl bg-zinc-900 border border-zinc-800 ${card.color}`}>
                                <card.icon size={20} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{card.title}</p>
                                <p className="text-xl font-black text-white italic truncate">{card.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-8 flex-1 overflow-auto custom-scrollbar">{renderContent()}</div>

            {showModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-[#171717] border border-[#2e2e2e] rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.6)]">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                                    <Zap className="text-primary" size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-white uppercase tracking-tighter italic">
                                        {currentFn.id ? 'Configure Node' : 'Initialize Node'}
                                    </h3>
                                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em]">Edge computing protocol v2.0</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setShowModal(false)} className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest">
                                    Cancel
                                </button>
                                <button
                                    onClick={saveFunction}
                                    className="bg-primary text-black px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:shadow-[0_0_30px_rgba(254,254,0,0.2)] hover:scale-[1.02] transition-all"
                                >
                                    Deploy to Edge
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col p-10 gap-8 overflow-auto custom-scrollbar bg-[#111111]/50">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] ml-2">Node Identifier</label>
                                <div className="relative group">
                                    <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-primary transition-colors" size={16} />
                                    <input
                                        type="text"
                                        value={currentFn.name}
                                        onChange={(event) => setCurrentFn({ ...currentFn, name: event.target.value })}
                                        placeholder="e.g. process-payments"
                                        className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-2xl pl-12 pr-6 py-4 text-xs font-bold text-zinc-200 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10 transition-all font-mono uppercase tracking-widest"
                                    />
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col space-y-3 min-h-[400px]">
                                <div className="flex items-center justify-between ml-2">
                                    <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Runtime Script (JS/ES6)</label>
                                    <div className="flex gap-4">
                                        <span className="text-[9px] font-bold text-zinc-700">Goja 1.0</span>
                                        <span className="text-[9px] font-bold text-zinc-700">Async Ready</span>
                                    </div>
                                </div>
                                <div className="flex-1 relative group">
                                    <textarea
                                        value={currentFn.script}
                                        onChange={(event) => setCurrentFn({ ...currentFn, script: event.target.value })}
                                        className="w-full h-full bg-[#0c0c0c] border border-zinc-800 rounded-3xl p-8 text-xs text-zinc-400 font-mono focus:outline-none focus:border-primary/30 transition-all resize-none shadow-inner leading-relaxed"
                                        placeholder="// Your edge logic starts here..."
                                    />
                                    <div className="absolute top-4 right-4 p-2 bg-zinc-900/80 rounded-lg border border-white/5 opacity-40 group-focus-within:opacity-100 transition-opacity">
                                        <Code size={14} className="text-primary" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EdgeFunctions;
