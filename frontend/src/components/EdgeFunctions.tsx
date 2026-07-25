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
    Globe,
    X,
    Activity,
    Clock,
    Shield,
    Trash2,
    Save,
    RefreshCw,
    Share2,
    Settings,
    ChevronRight,
    ArrowRight
} from 'lucide-react';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';

interface EdgeFunctionRecord {
    id: string;
    name: string;
    script: string;
    status?: string;
    runtime?: string;
    url?: string;
    created_at?: string;
}

type EdgeFunctionDraft = {
    id?: string;
    name: string;
    script: string;
};

const DEFAULT_FUNCTION_SCRIPT = `/**
 * OzyBase Edge Computing Node
 * 
 * Available Context: 
 * - body: JSON parsed request body
 * - ozy.query(sql, ...args): Direct SQL execution
 * - console.log(...): Server-side logging
 */

// Example: Fetching data from a table
// const users = ozy.query("SELECT * FROM _ozy_users LIMIT 5");

return { 
    message: "Node transmission recognized",
    node_status: "NOMINAL",
    payload_echo: body,
    timestamp: new Date().toISOString()
};`;

const isEdgeFunctionRecord = (value: unknown): value is EdgeFunctionRecord => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
);

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
};

const EdgeFunctions: React.FC = () => {
    const [functions, setFunctions] = useState<EdgeFunctionRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [currentFn, setCurrentFn] = useState<EdgeFunctionDraft>({ name: '', script: DEFAULT_FUNCTION_SCRIPT });
    const [invokeOutput, setInvokeOutput] = useState<{ name: string; result: string; isError: boolean } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        fetchFunctions();
    }, []);

    const fetchFunctions = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/functions');
            const data: unknown = await res.json();
            if (Array.isArray(data)) setFunctions(data.filter(isEdgeFunctionRecord));
        } catch (error) {
            console.error('Failed to fetch functions:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveFunction = async () => {
        const name = currentFn.name.trim();
        if (!name) {
            setToast({ message: 'Node identifier is required', type: 'error' });
            return;
        }

        // Basic alphanumeric validation (matches backend IsValidIdentifier)
        const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        if (!identifierRegex.test(name)) {
            setToast({ message: 'Invalid identifier: use only letters, numbers, and underscores', type: 'error' });
            return;
        }

        try {
            // Explicitly build payload - id must be present for updates
            const payload: Record<string, unknown> = {
                name: name,
                script: currentFn.script,
                runtime: 'js',
            };
            if (currentFn.id) {
                payload['id'] = currentFn.id;
            }

            console.log('[OzyEdge] Saving function, id:', currentFn.id ?? '(new)', 'name:', name);

            const res = await fetchWithAuth('/api/functions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                setShowModal(false);
                await fetchFunctions();
                setToast({ message: currentFn.id ? 'Function updated successfully' : 'Function deployed to edge', type: 'success' });
            } else {
                const errorData = await res.json().catch(() => ({}));
                setToast({ message: (errorData as { error?: string }).error || 'Deployment synchronization failed', type: 'error' });
            }
        } catch (error) {
            console.error('Save failed:', error);
            setToast({ message: 'Critical I/O error', type: 'error' });
        }
    };

    const invokeFunction = async (name: string) => {
        try {
            const res = await fetchWithAuth(`/api/functions/${encodeURIComponent(name)}/invoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ test: true, mode: 'diagnostic' })
            });
            const data = await res.json();
            setInvokeOutput({
                name,
                result: JSON.stringify(data.result ?? data, null, 4),
                isError: !res.ok,
            });
        } catch (error: unknown) {
            setInvokeOutput({
                name,
                result: getErrorMessage(error),
                isError: true,
            });
        }
    };

    const deleteFunction = async (name: string) => {
        try {
            const res = await fetchWithAuth(`/api/functions/${encodeURIComponent(name)}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                await fetchFunctions();
                setToast({ message: 'Function removed from edge registry', type: 'success' });
            } else {
                const payload = await res.json().catch(() => null) as { error?: string } | null;
                setToast({ message: payload?.error || 'Delete failed', type: 'error' });
            }
        } catch (error) {
            console.error('Delete failed:', error);
            setToast({ message: 'Delete request failed', type: 'error' });
        }
    };

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.015),transparent_50%)] pointer-events-none" />
            
            {/* Core Header */}
            <div className="px-8 py-8 border-b border-border bg-zinc-900/20 relative z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/5 rounded-md flex items-center justify-center border border-primary/20">
                            <Zap className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white uppercase tracking-tight">Edge Functions</h1>
                            <div className="mt-1 flex items-center gap-3">
                                <span className="text-[9px] font-bold text-primary uppercase tracking-widest">Runtime: Goja</span>
                                <div className="w-1 h-1 rounded-full bg-zinc-800" />
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">V8 Protocol v4</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            const suggestedName = `node_${Math.random().toString(36).substring(2, 7)}`;
                            setCurrentFn({ name: suggestedName, script: DEFAULT_FUNCTION_SCRIPT });
                            setShowModal(true);
                        }}
                        className="h-10 flex items-center gap-2 bg-primary text-black px-6 rounded-md font-bold text-[10px] uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all"
                    >
                        <Plus size={14} />
                        New function
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { title: 'Active Nodes', value: functions.length.toString(), icon: Zap, status: 'NOMINAL' },
                        { title: 'Runtime Engine', value: 'V8_ISOLATE', icon: Cpu, status: 'SECURE' },
                        { title: 'Global Sync', value: 'ENABLED', icon: Globe, status: 'ACTIVE' },
                    ].map((card: any, i: any) => (
                        <div key={i} className="bg-zinc-900/40 border border-border rounded-md p-4 flex items-center gap-4">
                             <div className="p-3 rounded-md bg-background border border-border text-zinc-500">
                                <card.icon size={18} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">{card.title}</span>
                                    <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">{card.status}</span>
                                </div>
                                <p className="text-lg font-bold text-white uppercase tracking-tight tabular-nums">{card.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Function Registry */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar relative z-10">
                <div className="bg-background border border-border rounded-md overflow-hidden">
                    <div className="px-6 py-4 border-b border-border bg-zinc-900/20 flex items-center justify-between">
                        <div className="flex-1 max-w-sm h-10 bg-background border border-border rounded-md flex items-center px-4 gap-3 focus-within:border-primary/40 transition-all">
                            <Search className="text-zinc-700" size={14} />
                            <input
                                type="text"
                                placeholder="Filter functions..."
                                className="bg-transparent border-none text-[10px] font-bold text-white focus:outline-none w-full uppercase tracking-widest placeholder:text-zinc-800"
                            />
                        </div>
                        <button onClick={fetchFunctions} className="group flex items-center gap-2 text-[9px] font-bold text-zinc-600 hover:text-white uppercase tracking-widest transition-all">
                             <RefreshCw size={12} className="group-hover:rotate-180 transition-transform duration-700" />
                             Refresh
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-white/2 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-300 border-b border-white/5">
                                    <th className="px-10 py-6 italic">Node_Identifier</th>
                                    <th className="px-10 py-6 italic">Status</th>
                                    <th className="px-10 py-6 italic">Endpoint_Vector</th>
                                    <th className="px-10 py-6 italic text-right">Ops</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {loading ? (
                                    <tr><td colSpan={4} className="px-10 py-32 text-center text-zinc-400 font-bold text-[10px] uppercase tracking-[0.5em] italic animate-pulse">Scanning_Edge_Network...</td></tr>
                                ) : functions.length === 0 ? (
                                    <tr><td colSpan={4} className="px-10 py-32 text-center text-zinc-400 font-bold text-[10px] uppercase tracking-[0.4em] italic opacity-70">No localized nodes detected in current cluster</td></tr>
                                ) : (
                                    functions.map((fn: any) => (
                                        <tr key={fn.id} className="hover:bg-white/2 transition-colors group">
                                            <td className="px-6 py-4">
                                                 <div className="flex items-center gap-3">
                                                     <div className="p-2 rounded-md bg-background border border-border text-zinc-700">
                                                         <Code size={14} />
                                                     </div>
                                                     <div>
                                                         <span className="text-xs font-bold text-white uppercase tracking-tight">{fn.name}</span>
                                                         <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5">Created: {formatDate(fn.created_at)}</p>
                                                     </div>
                                                 </div>
                                             </td>
                                             <td className="px-6 py-4">
                                                 <div className="flex items-center gap-2">
                                                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                                                     <span className="text-[9px] font-bold text-emerald-500/80 uppercase tracking-widest">Active</span>
                                                 </div>
                                             </td>
                                             <td className="px-6 py-4">
                                                 <div className="bg-zinc-900/40 border border-border px-3 py-1 rounded-md text-[10px] text-zinc-500 flex items-center gap-3 w-fit">
                                                     <span className="truncate max-w-[200px]">{fn.url?.replace(/^https?:\/\//, '')}</span>
                                                     <button
                                                         onClick={() => {
                                                             if (fn.url) window.open(fn.url, '_blank', 'noopener,noreferrer');
                                                         }}
                                                         className="text-zinc-700 hover:text-primary transition-colors"
                                                     >
                                                         <ExternalLink size={10} />
                                                     </button>
                                                 </div>
                                             </td>
                                             <td className="px-6 py-4 text-right">
                                                 <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                     <button
                                                         onClick={() => invokeFunction(fn.name)}
                                                         className="w-8 h-8 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black transition-all flex items-center justify-center shadow-lg active:scale-90"
                                                         title="Invoke Function"
                                                     >
                                                         <Play size={12} fill="currentColor" />
                                                     </button>
                                                     <button
                                                         onClick={() => { 
                                                             setCurrentFn({ id: fn.id, name: fn.name, script: fn.script ?? '' }); 
                                                             setShowModal(true); 
                                                         }}
                                                         className="w-8 h-8 rounded-md bg-background border border-border text-zinc-600 hover:text-white hover:border-zinc-700 transition-all flex items-center justify-center"
                                                         title="Configure"
                                                     >
                                                         <Settings size={14} />
                                                     </button>
                                                     <button
                                                         onClick={() => deleteFunction(fn.name)}
                                                         className="w-8 h-8 rounded-md bg-red-500/5 border border-red-500/20 text-red-500 hover:bg-red-500/15 transition-all flex items-center justify-center"
                                                         title="Delete Function"
                                                     >
                                                         <Trash2 size={12} />
                                                     </button>
                                                 </div>
                                             </td>
                                        </tr>
                                    ))
                                )                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Node Configuration Dialog */}
            {showModal && (
                <div className="fixed inset-0 z-120 flex items-center justify-center p-6 bg-black/98 backdrop-blur-2xl animate-in fade-in duration-500">
                    <div className="absolute inset-0 z-0 pointer-events-auto" onClick={() => setShowModal(false)} />
                    <div className="relative z-10 w-full max-w-4xl bg-background border border-border rounded-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-500">
                        <header className="px-8 py-6 border-b border-border flex items-center justify-between bg-zinc-900/20">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-primary/5 rounded-md border border-primary/20 flex items-center justify-center text-primary">
                                    <Cpu size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white uppercase tracking-tight">
                                        {currentFn.id ? 'Configure Function' : 'New Function'}
                                    </h3>
                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Edge Computing Runtime</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-md bg-white/3 text-zinc-500 hover:text-white transition-all flex items-center justify-center">
                                    <X size={20} />
                                </button>
                                <button
                                    onClick={saveFunction}
                                    className="h-10 bg-primary text-black px-6 rounded-md font-bold text-[10px] uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all flex items-center gap-2"
                                >
                                    <Zap size={14} fill="currentColor" />
                                    Save & Deploy
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 flex overflow-hidden">
                             <div className="w-1/3 border-r border-white/5 p-12 space-y-12 overflow-y-auto custom-scrollbar bg-black/20">
                                <div className="space-y-4">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.5em] italic leading-none ml-2">Node Identifier</label>
                                    <div className="relative group">
                                        <div className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors">
                                            <Terminal size={18} />
                                        </div>
                                        <input
                                            type="text"
                                            spellCheck="false"
                                            value={currentFn.name}
                                            onChange={(e) => setCurrentFn({ ...currentFn, name: e.target.value })}
                                            placeholder="NODE_IDENTIFIER"
                                            className={`w-full bg-black border ${currentFn.name && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(currentFn.name) ? 'border-red-500/50' : 'border-white/5'} rounded-md pl-16 pr-8 py-6 text-sm font-bold text-white focus:outline-none focus:border-primary/20 transition-all font-mono uppercase tracking-[0.2em] shadow-inner`}
                                        />
                                    </div>
                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed px-2">Must be alphanumeric. This identifier forms the lookup vector for high-speed edge routing.</p>
                                </div>

                                <div className="pt-8 border-t border-white/5">
                                     <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] italic mb-6">Runtime Metrics</h4>
                                     <div className="space-y-4">
                                         {[
                                             { label: 'Memory Limit', value: '128MB' },
                                             { label: 'Time Threshold', value: '2.0s' },
                                             { label: 'Cold Start', value: '~40ms' }
                                         ].map((m, i) => (
                                             <div key={i} className="flex items-center justify-between p-4 rounded-md bg-white/2 border border-white/5">
                                                 <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-widest">{m.label}</span>
                                                 <span className="text-[10px] font-bold text-white italic">{m.value}</span>
                                             </div>
                                         ))}
                                     </div>
                                </div>
                             </div>

                             <div className="flex-1 flex flex-col p-12 bg-black relative">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(59,130,246,0.03),transparent_50%)] pointer-events-none" />
                                <div className="flex items-center justify-between mb-6 relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-md bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                            <Code size={18} />
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-bold text-white uppercase tracking-[0.3em] italic">Kernel_Logic.js</span>
                                            <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest mt-1">EMCASCRIPT_ISOLATE_CONSTRUCT</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-6 opacity-40">
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Async_v2_Enabled</span>
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Ozy_Query_Inject</span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2 mb-3">
                                     <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Templates:</span>
                                     <button type="button" onClick={() => setCurrentFn({ ...currentFn, script: DEFAULT_FUNCTION_SCRIPT })} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary transition-all">Hello World</button>
                                     <button type="button" onClick={() => setCurrentFn({ ...currentFn, script: `/** Stripe Webhook Handler */\nconst event = body;\nif (event.type === 'payment_intent.succeeded') {\n    console.log('Payment succeeded:', event.data.object.id);\n}\nreturn { received: true };` })} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary transition-all">Stripe Webhook</button>
                                     <button type="button" onClick={() => setCurrentFn({ ...currentFn, script: `/** AI Completion Handler */\nconst prompt = body.prompt || "Hello world";\nreturn {\n    completion: "AI Response generated for: " + prompt,\n    tokens: 42\n};` })} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary transition-all">AI Completion</button>
                                 </div>
                                 
                                <div className="flex-1 relative group rounded-[40px] overflow-hidden border border-white/5 shadow-inner">
                                    <textarea
                                        value={currentFn.script}
                                        spellCheck="false"
                                        onChange={(e) => setCurrentFn({ ...currentFn, script: e.target.value })}
                                        className="w-full h-full bg-background p-10 text-xs text-zinc-400 font-mono focus:outline-none transition-all resize-none leading-relaxed custom-scrollbar selection:bg-primary selection:text-black"
                                        placeholder="// Synchronize edge logic..."
                                    />
                                    <div className="absolute bottom-6 right-8 flex items-center gap-3">
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/3 border border-white/5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-[8px] font-bold text-white uppercase tracking-widest opacity-60">Linter_NOMINAL</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 p-6 bg-primary/5 rounded-[32px] border border-primary/10 flex items-center gap-6 relative overflow-hidden group/tip">
                                     <div className="absolute inset-0 bg-linear-to-r from-primary/2 to-transparent pointer-events-none" />
                                     <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover/tip:scale-110 transition-transform">
                                        <Info size={24} />
                                     </div>
                                     <div>
                                        <p className="text-[10px] text-white font-bold italic uppercase tracking-widest">Injected Context Vectors</p>
                                        <div className="mt-2 flex items-center gap-4">
                                            <code className="text-[9px] text-primary/80 font-mono font-bold bg-black/40 px-2 py-0.5 rounded">body</code>
                                            <code className="text-[9px] text-primary/80 font-mono font-bold bg-black/40 px-2 py-0.5 rounded">ozy.query(sql, ...args)</code>
                                            <code className="text-[9px] text-primary/80 font-mono font-bold bg-black/40 px-2 py-0.5 rounded">console.log(...)</code>
                                        </div>
                                     </div>
                                </div>
                             </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Invocation Outcome Display */}
            {invokeOutput && (
                <div className="fixed inset-0 z-130 flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl animate-in fade-in duration-500">
                    <div className="absolute inset-0 pointer-events-auto" onClick={() => setInvokeOutput(null)} />
                    <div className="relative w-full max-w-4xl bg-[#131313] border border-white/10 rounded-[48px] overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-500">
                        <div className="px-10 py-8 border-b border-white/5 bg-white/2 flex items-center justify-between">
                            <div className="flex items-center gap-5">
                                <div className={`w-12 h-12 rounded-md flex items-center justify-center border ${invokeOutput.isError ? 'bg-red-500/5 border-red-500/20 text-red-500' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-500'}`}>
                                    <Activity size={24} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white uppercase italic tracking-tighter">
                                        {invokeOutput.isError ? 'Transmission_Fault' : 'Transmission_Success'}
                                    </h3>
                                    <p className="mt-1 text-[9px] font-bold text-zinc-700 uppercase tracking-widest">Diagnostic Outcome // Node: [{invokeOutput.name}]</p>
                                </div>
                            </div>
                            <button onClick={() => setInvokeOutput(null)} className="w-10 h-10 rounded-md bg-white/3 text-zinc-600 hover:text-white transition-all flex items-center justify-center">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-10 flex-1 overflow-hidden flex flex-col">
                            <div className="flex-1 rounded-[32px] border border-white/5 bg-background p-10 overflow-auto custom-scrollbar shadow-inner relative group">
                                <div className="absolute top-6 right-8 text-[8px] font-bold text-zinc-900 uppercase tracking-widest italic group-hover:text-primary transition-colors">Vector_Output_JSON</div>
                                <pre className={`text-xs font-mono leading-relaxed selection:bg-white/10 ${invokeOutput.isError ? 'text-red-400' : 'text-primary/70'}`}>
                                    {invokeOutput.result}
                                </pre>
                            </div>
                        </div>
                        <footer className="px-10 py-6 border-t border-white/5 bg-black/40 flex items-center justify-between">
                             <div className="flex gap-4">
                                <span className="text-[9px] font-bold text-zinc-800 uppercase tracking-widest italic">Cluster: OZY_GLOBAL_1</span>
                                <span className="text-[9px] font-bold text-zinc-800 uppercase tracking-widest italic">Region: EDGE_AUTO</span>
                             </div>
                             <button onClick={() => setInvokeOutput(null)} className="text-[9px] font-bold text-white hover:text-primary uppercase tracking-[0.5em] italic transition-colors">Release_Thread</button>
                        </footer>
                    </div>
                </div>
            )}

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </div>
    );
};

// Utility
const formatDate = (value?: string): string => {
    if (!value) return 'RECENT_DEPLOY';
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date).toUpperCase();
};

const Info = ({ size, className }: { size: number, className?: string }) => (
    <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

export default EdgeFunctions;


