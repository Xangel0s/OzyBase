import React, { useState, useEffect } from 'react';
import {
    Webhook,
    Plus,
    Trash2,
    Globe,
    Shield,
    Activity,
    ExternalLink,
    Zap,
    CheckCircle2,
    XCircle
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';
import OzySelect from './OzySelect';

interface WebhookRecord {
    id: string;
    url: string;
    events: string;
    is_active?: boolean;
}

interface NewWebhookInput {
    url: string;
    events: string;
}

const WebhooksManager = () => {
    const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newWebhook, setNewWebhook] = useState<NewWebhookInput>({ url: '', events: '*' });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    useEffect(() => {
        fetchWebhooks();
    }, []);

    const fetchWebhooks = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/webhooks');
            const data: unknown = await res.json();
            if (Array.isArray(data)) setWebhooks(data as WebhookRecord[]);
        } catch (error) {
            console.error('Failed to fetch webhooks:', error);
        } finally {
            setLoading(false);
        }
    };

    const createWebhook = async () => {
        try {
            const res = await fetchWithAuth('/api/webhooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newWebhook)
            });
            if (res.ok) {
                setShowModal(false);
                setToast({ message: 'Webhook created', type: 'success' });
                fetchWebhooks();
            }
        } catch (error) {
            console.error('Failed to create webhook:', error);
            setToast({ message: 'Failed to create webhook', type: 'error' });
        }
    };

    const deleteWebhook = async (id: string) => {
        try {
            const res = await fetchWithAuth(`/api/webhooks/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setToast({ message: 'Webhook deleted', type: 'success' });
                fetchWebhooks();
            }
        } catch (error) {
            console.error('Failed to delete webhook:', error);
            setToast({ message: 'Failed to delete webhook', type: 'error' });
        }
    };

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-x-0 top-0 h-96 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />
            {/* Header */}
            <header className="px-10 py-16 border-b border-white/5 bg-linear-to-b from-zinc-900/50 to-transparent relative z-10 overflow-hidden">
                <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-[32px] bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_50px_rgba(254,254,0,0.1)] relative z-10">
                            <Webhook size={40} strokeWidth={1} />
                        </div>
                        <div className="relative z-10">
                            <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase italic mb-3">Ozy_Kernel :: Event_Dispatcher</p>
                            <h1 className="text-5xl font-bold text-white uppercase tracking-tighter italic leading-none">Webhooks</h1>
                            <div className="mt-6 flex items-center gap-6">
                                <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 group cursor-help">
                                    <Activity size={12} className="text-primary animate-pulse" />
                                    <span className="text-primary text-[9px] font-bold uppercase tracking-widest italic">Outbound_Event_Pipeline_Stable</span>
                                </div>
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em] italic tabular-nums">{webhooks.length}_REGISTERED_NODES</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="h-14 flex items-center gap-4 bg-white text-black px-10 rounded-md font-bold text-[11px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)] group"
                    >
                        <Plus size={18} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-500" />
                        Provision Webhook
                    </button>
                </div>
            </header>

            {/* List */}
            <div className="p-8 flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <p className="text-[10px] font-medium text-zinc-600">Syncing Webhook Nodes...</p>
                    </div>
                ) : webhooks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-900 rounded-md gap-4 bg-zinc-900/10">
                        <Globe size={48} className="text-zinc-800" />
                        <p className="text-[10px] font-medium text-zinc-600">No webhooks registered</p>
                        <button onClick={() => setShowModal(true)} className="text-primary text-[10px] font-medium hover:underline">Initialize first node</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {webhooks.map((w: any) => (
                            <div key={w.id} className="bg-background border border-border rounded-md p-6 hover:border-primary/20 transition-all flex items-center justify-between group">
                                <div className="flex items-center gap-6">
                                    <div className={`p-4 rounded-md bg-zinc-900 border border-zinc-800 ${w.is_active ? 'text-green-500' : 'text-zinc-600'}`}>
                                        <Zap size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className="text-white font-bold text-sm tracking-wide">{w.url}</h3>
                                            <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 uppercase">
                                                Active
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                                Events: <span className="text-zinc-400">{w.events}</span>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => window.open(w.url, '_blank', 'noopener,noreferrer')}
                                        className="p-2 text-zinc-600 hover:text-white"
                                    >
                                        <ExternalLink size={16} />
                                    </button>
                                    <button onClick={() => setPendingDeleteId(w.id)} className="p-2 text-zinc-600 hover:text-red-500"><Trash2 size={16} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setShowModal(false)} />
                    <div className="ozy-dialog-panel w-full max-w-lg overflow-hidden">
                        <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-[#131313]">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-primary/10 rounded-md">
                                    <Webhook className="text-primary" size={20} />
                                </div>
                                <h3 className="text-lg font-bold text-white uppercase tracking-tighter italic">Register Webhook</h3>
                            </div>
                            <button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white"><Plus className="rotate-45" size={20} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Endpoint URL</label>
                                <input
                                    type="text"
                                    value={newWebhook.url}
                                    onChange={(e: any) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                                    className="w-full bg-background border border-zinc-800 rounded-md px-4 py-3 text-xs text-zinc-200 focus:outline-none focus:border-primary/50"
                                    placeholder="https://your-api.com/webhook"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Event Trigger</label>
                                <OzySelect
                                    value={newWebhook.events}
                                    onChange={(e: any) => setNewWebhook({ ...newWebhook, events: e.target.value })}
                                    wrapperClassName="shadow-none border-zinc-800 bg-background"
                                    selectClassName="text-[10px]"
                                >
                                    <option value="*">All Events (*)</option>
                                    <option value="records:create">Record Created</option>
                                    <option value="records:update">Record Updated</option>
                                    <option value="records:delete">Record Deleted</option>
                                </OzySelect>
                            </div>
                            <button
                                onClick={createWebhook}
                                className="w-full bg-primary text-black py-4 rounded-md font-bold text-xs uppercase tracking-[0.2em] hover:scale-[1.02] transition-all mt-4"
                            >
                                Deploy Webhook Node
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingDeleteId}
                onClose={() => setPendingDeleteId(null)}
                onConfirm={() => pendingDeleteId ? deleteWebhook(pendingDeleteId) : undefined}
                title="Delete Webhook"
                message="Outbound deliveries to this endpoint will stop immediately."
                confirmText="Delete Webhook"
                type="danger"
            />

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

export default WebhooksManager;


