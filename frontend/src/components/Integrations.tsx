import React, { useEffect, useMemo, useState } from 'react';
import { Code, Copy, LayoutGrid, Loader2, Plus, RefreshCw, Shield, Trash2, Eye, EyeOff, Check, Clock, Zap, ChevronRight, X } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import OzySelect from './OzySelect';

const WRAPPERS = [
    ['postgres_fdw', 'Postgres FDW'],
    ['file_fdw', 'File FDW'],
    ['mysql_fdw', 'MySQL FDW'],
    ['sqlite_fdw', 'SQLite FDW'],
    ['redis_fdw', 'Redis FDW'],
] as const;

const EMPTY = {
    webhook: { name: '', url: '', events: 'INSERT,UPDATE,DELETE', secret: '' },
    cron: { name: '', schedule: '0 * * * *', command: 'SELECT NOW();' },
    secret: { key: '', value: '', description: '' },
    wrapper: { name: 'postgres_fdw' },
};

interface IntegrationsProps {
    page?: string;
}

const Integrations: React.FC<IntegrationsProps> = ({ page = 'wrappers' }) => {
    const [extensions, setExtensions] = useState<any[]>([]);
    const [wrappers, setWrappers] = useState<any[]>([]);
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [cron, setCron] = useState<{ available: boolean; enabled: boolean; extension: string; jobs: any[] }>({ available: false, enabled: false, extension: 'ozy_native', jobs: [] });
    const [vault, setVault] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState<'webhook' | 'cron' | 'secret' | 'wrapper' | null>(null);
    const [form, setForm] = useState<Record<string, any>>(EMPTY.webhook);
    const [copied, setCopied] = useState<string | null>(null);
    const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
    const [pendingDelete, setPendingDelete] = useState<{ type: 'webhook' | 'cron' | 'secret' | 'wrapper'; id: string } | null>(null);
    const [logModal, setLogModal] = useState<{ open: boolean; jobId: string; logs: any[]; jobName: string }>({ open: false, jobId: '', logs: [], jobName: '' });

    const graphqlUrl = `${window.location.origin}/api/graphql/v1`;
    const graphiqlUrl = `${window.location.origin}/graphiql.html`;
    const graphQLEnabled = useMemo(() => (
        (Array.isArray(extensions) ? extensions : []).some((item) => item.name === 'pg_graphql' && item.installed)
    ), [extensions]);
    const activeWrappers = useMemo(() => new Set((Array.isArray(wrappers) ? wrappers : []).map((item) => String(item.name).toLowerCase())), [wrappers]);

    const copyValue = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1200);
    };

    const load = async () => {
        setLoading(true);
        try {
            if (page === 'wrappers') {
                const data = await (await fetchWithAuth('/api/wrappers')).json();
                setWrappers(Array.isArray(data) ? data : []);
            }
            if (page === 'webhooks') {
                const data = await (await fetchWithAuth('/api/webhooks')).json();
                setWebhooks(Array.isArray(data) ? data : []);
            }
            if (page === 'cron') {
                const data = await (await fetchWithAuth('/api/cron')).json();
                setCron({ 
                    available: Boolean(data?.available), 
                    enabled: Boolean(data?.enabled), 
                    extension: String(data?.extension || 'ozy_native'),
                    jobs: Array.isArray(data?.jobs) ? data.jobs : [] 
                });
            }
            if (page === 'vault') {
                const data = await (await fetchWithAuth('/api/vault')).json();
                setVault(Array.isArray(data) ? data : []);
            }
            if (page === 'extensions' || page === 'graphql') {
                const data = await (await fetchWithAuth('/api/extensions')).json();
                setExtensions(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(`Failed to load ${page}:`, error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [page]);

    const openModal = (type: 'webhook' | 'cron' | 'secret' | 'wrapper', seed: Record<string, any> = {}) => {
        setModal(type);
        setForm({ ...EMPTY[type], ...seed });
    };

    const addModalTypeForPage = () => {
        if (page === 'vault') return 'secret' as const;
        if (page === 'wrappers') return 'wrapper' as const;
        if (page === 'cron') return 'cron' as const;
        return 'webhook' as const;
    };

    const closeModal = () => {
        setModal(null);
        setForm(EMPTY.webhook);
    };

    const create = async (event: React.FormEvent) => {
        event.preventDefault();
        const endpoints = { webhook: '/api/webhooks', cron: '/api/cron', secret: '/api/vault', wrapper: '/api/wrappers' };
        const payload = modal === 'wrapper' ? { name: form.name } : form;
        if (!modal) {
            return;
        }
        setBusy(true);
        try {
            const res = await fetchWithAuth(endpoints[modal], { method: 'POST', body: JSON.stringify(payload) });
            if (res.ok) {
                closeModal();
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const remove = async (type: 'webhook' | 'cron' | 'secret' | 'wrapper', id: string) => {
        const endpoints = { webhook: `/api/webhooks/${id}`, cron: `/api/cron/${id}`, secret: `/api/vault/${id}`, wrapper: `/api/wrappers/${id}` };
        setBusy(true);
        try {
            const res = await fetchWithAuth(endpoints[type], { method: 'DELETE' });
            if (res.ok) {
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const toggleExtension = async (name: string, installed: boolean) => {
        setBusy(true);
        try {
            const action = installed ? 'disable' : 'enable';
            const res = await fetchWithAuth(`/api/extensions/${name}?action=${action}`, { method: 'POST' });
            if (res.ok) {
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const enableCron = async () => {
        setBusy(true);
        try {
            const res = await fetchWithAuth('/api/cron/enable', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setCron({ 
                    available: Boolean(data?.available), 
                    enabled: Boolean(data?.enabled), 
                    extension: String(data?.extension || 'ozy_native'),
                    jobs: Array.isArray(data?.jobs) ? data.jobs : [] 
                });
            }
        } finally {
            setBusy(false);
        }
    };

    const fetchLogs = async (jobId: string, jobName: string) => {
        setBusy(true);
        try {
            const res = await fetchWithAuth(`/api/cron/${jobId}/logs`);
            if (res.ok) {
                const data = await res.json();
                setLogModal({ open: true, jobId, logs: Array.isArray(data) ? data : [], jobName });
            }
        } finally {
            setBusy(false);
        }
    };

    const itemClass = 'bg-background border border-border rounded-md p-6 shadow-2xl';

    const renderContent = () => {
        if (loading) {
            return <div className="flex items-center justify-center py-24"><Loader2 size={28} className="text-primary animate-spin" /></div>;
        }
        if (page === 'wrappers') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {WRAPPERS.map(([id, name]) => (
                        <div key={id} className={itemClass}>
                            <p className="text-lg font-bold text-white uppercase tracking-tight">{name}</p>
                            <p className="text-xs text-zinc-500 mt-2">{id}</p>
                            <div className="flex gap-3 mt-5">
                                <button onClick={() => openModal('wrapper', { name: id })} className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-[10px] font-medium text-zinc-300">Configure Wrapper</button>
                                {activeWrappers.has(id.toLowerCase()) && <button onClick={() => setPendingDelete({ type: 'wrapper', id })} className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-md text-[10px] font-medium text-red-500">Remove</button>}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }
        if (page === 'webhooks') {
            return webhooks.length === 0
                ? <div className={itemClass}>No webhooks configured.</div>
                : webhooks.map((item) => (
                    <div key={item.id} className={`${itemClass} mb-3`}>
                        <p className="text-sm font-bold text-white">{item.name}</p>
                        <code className="text-xs text-zinc-500">{item.url}</code>
                        <div className="mt-4">
                            <button onClick={() => setPendingDelete({ type: 'webhook', id: String(item.id) })} className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-md text-[10px] font-medium text-red-500">Delete</button>
                        </div>
                    </div>
                ));
        }
        if (page === 'cron') {
            return (
                <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/10 rounded-md">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
                                <Clock size={14} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-white uppercase tracking-widest">Scheduler Engine Active</p>
                                <p className="text-[9px] text-zinc-500 font-bold uppercase mt-0.5">Mode: {cron.extension === 'ozy_native' ? 'Ozy Native (Go-Isolate)' : 'PostgreSQL Extension (pg_cron)'}</p>
                            </div>
                        </div>
                        {!cron.enabled && cron.extension === 'pg_cron' && (
                            <button onClick={() => void enableCron()} className="px-4 py-2 bg-primary text-black rounded-md text-[10px] font-medium hover:scale-105 transition-all">Enable pg_cron</button>
                        )}
                    </div>

                    {!cron.jobs?.length ? (
                        <div className={itemClass}>
                             <p className="text-zinc-500 italic uppercase tracking-widest text-[10px] text-center py-12">No active temporal vectors. Initialize a new job to begin.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {cron.jobs.map((item) => (
                                <div key={item.id} className={`${itemClass} flex flex-col gap-4 group transition-all hover:border-primary/20`}>
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center text-indigo-400">
                                                <Zap size={14} />
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-white uppercase tracking-widest italic">{item.name}</p>
                                                <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-[0.2em] mt-0.5 font-mono">{item.schedule}</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => setPendingDelete({ type: 'cron', id: String(item.id) })}
                                            className="p-2 text-zinc-700 hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    
                                    <div className="bg-black/40 border border-white/5 rounded-md p-3">
                                        <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mb-2">Last Transmission</p>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-mono text-zinc-400">{item.last_run ? new Date(item.last_run).toLocaleString() : 'PENDING_IO'}</span>
                                            {item.is_active ? (
                                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[8px] font-bold uppercase">Active</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 text-[8px] font-bold uppercase">Paused</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-widest text-zinc-700">
                                        <span>Next Window: {item.next_run ? new Date(item.next_run).toLocaleTimeString() : 'CALCULATING...'}</span>
                                        <button 
                                            onClick={() => void fetchLogs(item.id, item.name)}
                                            className="text-primary/40 hover:text-primary transition-colors flex items-center gap-1 group/log"
                                        >
                                            <span className="group-hover/log:translate-x-[-2px] transition-transform">Logs</span> <ChevronRight size={10} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }
        if (page === 'extensions') {
            return extensions.map((item) => (
                <div key={item.name} className={`${itemClass} mb-3`}>
                    <p className="text-sm font-bold text-white">{item.name}</p>
                    <p className="text-xs text-zinc-500 mt-2">{item.description}</p>
                    <button onClick={() => void toggleExtension(String(item.name), Boolean(item.installed))} className={`mt-4 px-4 py-2 rounded-md text-[10px] font-medium ${item.installed ? 'bg-red-500/10 border border-red-500/20 text-red-500' : 'bg-primary text-black'}`}>
                        {item.installed ? 'Disable' : 'Enable'}
                    </button>
                </div>
            ));
        }
        if (page === 'vault') {
            const toggleReveal = (id: string) => {
                const next = new Set(revealedSecrets);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setRevealedSecrets(next);
            };

            return vault.length === 0
                ? <div className={itemClass}>
                    <p className="text-zinc-500 italic uppercase tracking-widest text-[10px] text-center py-12">Security vector is currently empty.</p>
                </div>
                : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {vault.map((item) => {
                        const isRevealed = revealedSecrets.has(item.id);
                        return (
                            <div key={item.id} className={`${itemClass} flex flex-col gap-4 group transition-all hover:border-primary/20`}>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-primary/5 border border-primary/10 flex items-center justify-center text-primary">
                                            <Shield size={14} />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-white uppercase tracking-widest italic">{item.key}</p>
                                            <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-[0.2em] mt-0.5">{item.description || 'Global Access Vector'}</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => setPendingDelete({ type: 'secret', id: String(item.id) })}
                                        className="p-2 text-zinc-700 hover:text-red-500 transition-colors"
                                        title="Revoke Secret"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                <div className="relative group/val">
                                    <div className="bg-black/40 border border-white/5 rounded-md px-4 py-3 flex items-center justify-between gap-4 overflow-hidden">
                                        <code className={`text-[11px] font-mono flex-1 truncate transition-all ${isRevealed ? 'text-primary/80' : 'text-zinc-700 blur-[3px]'}`}>
                                            {isRevealed ? item.value : '••••••••••••••••••••••••••••••••'}
                                        </code>
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={() => toggleReveal(item.id)}
                                                className="p-1.5 text-zinc-600 hover:text-white transition-colors"
                                                title={isRevealed ? "Hide Value" : "Reveal Value"}
                                            >
                                                {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                            <button 
                                                onClick={() => copyValue(item.value, `secret-${item.id}`)}
                                                className="p-1.5 text-zinc-600 hover:text-white transition-colors"
                                                title="Copy Value"
                                            >
                                                {copied === `secret-${item.id}` ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>;
        }
        if (page === 'graphql') {
            return (
                <div className={itemClass}>
                    <p className="text-sm font-bold text-white uppercase tracking-widest">GraphQL Endpoint</p>
                    <code className="text-xs text-zinc-400 block mt-3">{graphqlUrl}</code>
                    <div className="flex gap-3 mt-5">
                        <button disabled={!graphQLEnabled} onClick={() => window.open(graphiqlUrl, '_blank', 'noopener,noreferrer')} className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-[10px] font-medium text-zinc-300 disabled:opacity-40">Open Playground (GraphiQL)</button>
                        <button onClick={() => void copyValue(graphqlUrl, 'graphql')} className="px-4 py-2 bg-primary text-black rounded-md text-[10px] font-medium">{copied === 'graphql' ? 'Copied' : 'Copy URL'}</button>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-500 overflow-hidden relative">
            {modal && (
                <div className="fixed inset-0 z-120 flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={closeModal} />
                    <form onSubmit={create} className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
                        <div className="px-8 py-6 border-b border-border bg-background"><h3 className="text-xl font-bold text-white uppercase tracking-tight">{modal === 'wrapper' ? 'Configure Wrapper' : modal === 'webhook' ? 'Create Webhook' : modal === 'cron' ? 'New Cron Job' : 'Add Secret'}</h3></div>
                        <div className="p-8 space-y-4">
                            {modal === 'wrapper' && (
                                <OzySelect
                                    value={form.name}
                                    onChange={(event) => setForm({ name: event.target.value })}
                                    wrapperClassName="shadow-none"
                                    selectClassName="text-[10px]"
                                >
                                    {WRAPPERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                                </OzySelect>
                            )}
                            {modal === 'webhook' && (
                                <>
                                    <input required placeholder="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                    <input required placeholder="https://example.com/webhook" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                    <input required placeholder="INSERT,UPDATE,DELETE" value={form.events} onChange={(event) => setForm((current) => ({ ...current, events: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                </>
                            )}
                            {modal === 'cron' && (
                                <>
                                    <input required placeholder="Job name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                    <input required placeholder="0 * * * *" value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white font-mono" />
                                    <textarea required value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))} className="w-full min-h-[120px] bg-zinc-900 border border-zinc-800 rounded-md px-4 py-4 text-sm text-white font-mono" />
                                </>
                            )}
                            {modal === 'secret' && (
                                <>
                                    <input required placeholder="Secret key" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                    <input required type="password" placeholder="Secret value" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                    <input placeholder="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white" />
                                </>
                            )}
                        </div>
                        <div className="px-8 py-5 border-t border-border bg-background flex justify-end gap-3">
                            <button type="button" onClick={closeModal} className="px-5 py-2.5 text-[10px] font-medium text-zinc-500">Cancel</button>
                            <button type="submit" disabled={busy} className="px-6 py-2.5 bg-primary text-black rounded-md text-[10px] font-medium disabled:opacity-60">{busy ? 'Saving' : 'Save'}</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="px-8 py-10 border-b border-border bg-[#131313]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-md flex items-center justify-center border border-primary/20"><LayoutGrid className="text-primary" size={28} /></div>
                        <div><h1 className="text-3xl font-bold text-white uppercase tracking-tighter italic">Integrations</h1><p className="text-zinc-500 text-[10px] font-medium mt-1">Extensions, wrappers and runtime utilities</p></div>
                    </div>
                    <div className="flex gap-3">
                        {(page === 'wrappers' || page === 'webhooks' || page === 'cron' || page === 'vault') && <button onClick={() => openModal(addModalTypeForPage())} className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-md text-[10px] font-medium"><Plus size={14} />Add</button>}
                        <button onClick={() => void load()} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2 rounded-md text-[10px] font-medium"><RefreshCw size={14} />Refresh</button>
                    </div>
                </div>
            </div>

            <div className="p-8 flex-1 overflow-auto custom-scrollbar">{renderContent()}</div>

            <ConfirmModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => pendingDelete ? remove(pendingDelete.type, pendingDelete.id) : undefined}
                title="Delete Integration Item"
                message="This runtime integration entry will be removed from the project configuration."
                confirmText="Delete Item"
                type="danger"
            />

            {logModal.open && (
                <div className="fixed inset-0 z-150 flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setLogModal({ ...logModal, open: false })} />
                    <div className="ozy-dialog-panel relative w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                        <div className="px-8 py-6 border-b border-border bg-background flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-white uppercase tracking-tight italic flex items-center gap-2">
                                    <Clock size={18} className="text-primary" /> Execution History
                                </h3>
                                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1 tracking-widest">{logModal.jobName}</p>
                            </div>
                            <button onClick={() => setLogModal({ ...logModal, open: false })} className="p-2 text-zinc-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                            {!logModal.logs.length ? (
                                <div className="py-24 text-center">
                                    <p className="text-zinc-600 uppercase tracking-[0.2em] text-[10px] font-bold">No historical data recorded for this vector yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {logModal.logs.map((log: any) => (
                                        <div key={log.id} className="bg-black/40 border border-white/5 rounded-md p-4 flex items-center justify-between group hover:border-primary/20 transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-2 h-2 rounded-full ${log.status === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                                                <div>
                                                    <p className={`text-[10px] font-bold uppercase tracking-widest ${log.status === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
                                                        {log.status === 'success' ? 'Transmission Successful' : 'Transmission Failure'}
                                                    </p>
                                                    <p className="text-[9px] text-zinc-500 mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                                                    {log.status === 'error' && (
                                                        <p className="text-[9px] text-red-400/60 mt-2 font-mono bg-red-500/5 p-2 rounded border border-red-500/10 italic">
                                                            {log.message}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-mono text-zinc-400 group-hover:text-primary transition-colors">{log.duration_ms}ms</p>
                                                <p className="text-[8px] text-zinc-600 uppercase font-bold tracking-tighter mt-0.5">Latency</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="px-8 py-5 border-t border-border bg-background flex justify-end">
                            <button onClick={() => setLogModal({ ...logModal, open: false })} className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-md text-[10px] font-medium hover:text-white transition-colors">Close Portal</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Integrations;


