import React, { useState, useEffect } from 'react';
import {
    Webhook, Plus, Trash2, Check, AlertCircle,
    Loader2, Info, Activity, Radio, Play
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';

type IntegrationType = 'slack' | 'discord' | 'siem';
type ToastType = 'success' | 'error';

interface Integration {
    id: number | string;
    name: string;
    type: IntegrationType | string;
    webhook_url: string;
    is_active: boolean;
    config?: Record<string, unknown>;
}

interface NewIntegration {
    name: string;
    type: IntegrationType;
    webhook_url: string;
    config: Record<string, unknown>;
}

interface IntegrationToast {
    message: string;
    type: ToastType;
}

const INTEGRATION_TYPES: IntegrationType[] = ['slack', 'discord', 'siem'];

const isIntegration = (value: unknown): value is Integration => (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { type?: unknown }).type === 'string'
);

const IntegrationsManager: React.FC = () => {
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [toast, setToast] = useState<IntegrationToast | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | string | null>(null);
    const [newIntegration, setNewIntegration] = useState<NewIntegration>({
        name: '',
        type: 'slack',
        webhook_url: '',
        config: {}
    });

    useEffect(() => {
        fetchIntegrations();
    }, []);

    const fetchIntegrations = async () => {
        try {
            const res = await fetchWithAuth('/api/project/integrations');
            const data: unknown = await res.json();
            const parsed = Array.isArray(data) ? data.filter(isIntegration) : [];
            setIntegrations(parsed);
        } catch (error) {
            console.error("Failed to fetch integrations", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newIntegration.name || !newIntegration.webhook_url) {
            setToast({ message: 'Name and Webhook URL are required', type: 'error' });
            return;
        }

        try {
            const res = await fetchWithAuth('/api/project/integrations', {
                method: 'POST',
                body: JSON.stringify(newIntegration)
            });

            if (res.ok) {
                setNewIntegration({ name: '', type: 'slack', webhook_url: '', config: {} });
                setShowAdd(false);
                await fetchIntegrations();
                setToast({ message: 'Integration added successfully', type: 'success' });
            } else {
                setToast({ message: 'Failed to add integration', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to add integration', error);
            setToast({ message: 'Network error', type: 'error' });
        }
    };

    const handleDelete = async (id: number | string) => {
        try {
            const res = await fetchWithAuth(`/api/project/integrations/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                await fetchIntegrations();
                setToast({ message: 'Integration deleted', type: 'success' });
            }
        } catch (error) {
            console.error('Failed to delete integration', error);
            setToast({ message: 'Failed to delete', type: 'error' });
        }
    };

    const handleTest = async (id: number | string) => {
        try {
            const res = await fetchWithAuth(`/api/project/integrations/${id}/test`, {
                method: 'POST'
            });

            if (res.ok) {
                setToast({ message: 'Test alert sent!', type: 'success' });
            } else {
                setToast({ message: 'Failed to send test alert', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to test integration', error);
            setToast({ message: 'Network error', type: 'error' });
        }
    }

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-[10px] font-medium">Loading Integrations...</span>
        </div>
    );

    return (
        <ModuleScrollContainer width="5xl" innerClassName="animate-in fade-in duration-700">
            <div className="space-y-10 pb-20 relative">
                <div className="absolute inset-x-0 top-0 h-96 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />
                
                {/* Header */}
                <header className="px-10 py-16 border-b border-white/5 bg-linear-to-b from-zinc-900/50 to-transparent relative z-10 overflow-hidden rounded-[48px]">
                    <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
                    <div className="flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-8">
                            <div className="w-20 h-20 rounded-[32px] bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_50px_rgba(254,254,0,0.1)]">
                                <Webhook size={40} strokeWidth={1} />
                            </div>
                            <div className="relative z-10">
                                <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase italic mb-3">Ozy_Core :: Data_Export</p>
                                <h1 className="text-5xl font-bold tracking-tighter text-white uppercase italic leading-none">
                                    Integration Hub
                                </h1>
                                <div className="mt-6 flex items-center gap-6">
                                    <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 group cursor-help">
                                        <Activity size={12} className="text-primary" />
                                        <span className="text-primary text-[9px] font-bold uppercase tracking-widest italic">SIEM_Streaming</span>
                                    </div>
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                    <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em] italic tabular-nums">{integrations.length}_ACTIVE_CHANNELS</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowAdd(!showAdd)}
                            className="flex items-center gap-4 px-8 py-4 bg-primary text-black rounded-md text-[11px] font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_20px_40px_rgba(254,254,0,0.1)] group/btn"
                        >
                            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-500" />
                            New integration
                        </button>
                    </div>
                </header>

                {/* Add New Integration Form */}
                {showAdd && (
                    <div className="p-10 bg-background border border-white/5 rounded-[48px] space-y-10 animate-in slide-in-from-top duration-700 relative overflow-hidden group shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
                        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/5 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                        
                        <div className="flex items-center justify-between relative z-10">
                            <div>
                                <h2 className="text-3xl font-bold text-white uppercase tracking-tighter italic leading-none">Assemble Pipeline</h2>
                                <p className="mt-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest italic">Protocol Configuration</p>
                            </div>
                            <button
                                onClick={() => setShowAdd(false)}
                                className="text-[10px] font-bold text-zinc-700 hover:text-white uppercase tracking-widest italic transition-colors"
                            >
                                / Abort_Form
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
                            <div className="space-y-4">
                                <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic block">Provider_Type</label>
                                <div className="grid grid-cols-3 gap-4">
                                    {INTEGRATION_TYPES.map((type: any) => (
                                        <div
                                            key={type}
                                            onClick={() => setNewIntegration({ ...newIntegration, type })}
                                            className={`p-6 rounded-md border transition-all duration-500 flex flex-col items-center gap-4 group/type cursor-pointer ${newIntegration.type === type ? 'bg-primary/20 border-primary shadow-[0_0_30px_rgba(254,254,0,0.15)] text-primary' : 'bg-black/40 border-white/5 text-zinc-600 hover:border-white/10 hover:bg-black/60'}`}
                                        >
                                            <Webhook size={24} className={newIntegration.type === type ? 'scale-110' : 'group-hover:scale-110 transition-transform'} />
                                            <span className="text-[10px] font-bold uppercase tracking-widest">{type}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="p-6 rounded-md bg-black/40 border border-white/5 space-y-3 shadow-inner">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic block">Reference_Handle</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. CORE_ALERTS_VX"
                                        value={newIntegration.name}
                                        onChange={(e: any) => setNewIntegration({ ...newIntegration, name: e.target.value })}
                                        className="w-full bg-transparent border-none p-0 text-sm font-bold text-white outline-none placeholder:text-zinc-800 tracking-wide"
                                    />
                                </div>
                                <div className="p-6 rounded-md bg-black/40 border border-white/5 space-y-3 shadow-inner">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic block">Data_Endpoint_URL</label>
                                    <input
                                        type="url"
                                        placeholder="https://hooks.slack.com/..."
                                        value={newIntegration.webhook_url}
                                        onChange={(e: any) => setNewIntegration({ ...newIntegration, webhook_url: e.target.value })}
                                        className="w-full bg-transparent border-none p-0 text-xs font-bold text-white outline-none placeholder:text-zinc-800 tracking-normal font-mono"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-10 border-t border-white/5 relative z-10">
                            <button
                                onClick={handleAdd}
                                className="group/save inline-flex items-center gap-4 rounded-md bg-white px-10 py-4 text-[11px] font-bold text-black uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 shadow-[0_20px_40px_rgba(255,255,255,0.05)]"
                            >
                                <Check size={16} className="group-hover:scale-125 transition-transform" />
                                Deploy Integration
                            </button>
                        </div>
                    </div>
                )}

                {/* Integrations List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                    {integrations.map((integration: any) => (
                        <div key={integration.id} className="group relative p-8 bg-background border border-white/5 rounded-[48px] hover:border-white/10 transition-all duration-700 overflow-hidden shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)]">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-linear-to-bl from-white/2 to-transparent pointer-events-none" />
                            
                            <div className="flex items-center justify-between mb-8 relative z-10">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-md flex items-center justify-center transition-all duration-700 ${integration.type === 'slack' ? 'bg-[#4A154B]/10 text-[#4A154B] border border-[#4A154B]/20' : integration.type === 'discord' ? 'bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                                        <Webhook size={20} className={integration.type === 'slack' ? 'text-white brightness-150' : ''} strokeWidth={1.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white uppercase italic tracking-tighter leading-none">{integration.name}</h3>
                                        <p className="mt-1 text-[9px] text-zinc-600 font-bold uppercase tracking-widest italic">{integration.type}</p>
                                    </div>
                                </div>
                                <div className={`w-2 h-2 rounded-full ${integration.is_active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                            </div>

                            <div className="p-5 bg-black/40 rounded-md border border-white/5 mb-8 overflow-hidden group/url relative">
                                <p className="text-[10px] text-zinc-600 font-mono truncate group-hover/url:text-zinc-400 transition-colors uppercase tracking-tight">{integration.webhook_url}</p>
                                <div className="absolute inset-y-0 right-0 w-12 bg-linear-to-l from-background to-transparent pointer-events-none" />
                            </div>

                            <div className="flex items-center gap-3 relative z-10">
                                <button
                                    onClick={() => handleTest(integration.id)}
                                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-md text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-3 group/probe"
                                >
                                    <Play size={12} className="group-hover:translate-x-0.5 transition-transform" /> Probe_Target
                                </button>
                                <button
                                    onClick={() => setPendingDeleteId(integration.id)}
                                    className="w-12 h-12 flex items-center justify-center bg-red-500/5 hover:bg-red-500/10 text-red-500/60 hover:text-red-500 rounded-md border border-red-500/10 transition-all"
                                >
                                    <Trash2 size={18} strokeWidth={1.5} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {integrations.length === 0 && !showAdd && (
                        <div className="col-span-full py-32 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-[64px] text-zinc-800 gap-8 bg-black/20 animate-in fade-in zoom-in duration-1000">
                            <Activity size={80} strokeWidth={0.5} className="text-zinc-900" />
                            <div className="text-center">
                                <p className="text-xl font-bold text-zinc-700 uppercase italic tracking-tighter">No Active Pipelines</p>
                                <p className="text-[10px] font-bold text-zinc-800 uppercase tracking-[0.3em] mt-3">Connect Slack, Discord or SIEM endpoints to begin ingestion</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* SIEM Info Box */}
                <div className="p-10 bg-linear-to-r from-primary/5 to-transparent border border-primary/10 rounded-[48px] flex items-start gap-8 relative overflow-hidden group shadow-[0_30px_60px_-15px_rgba(254,254,0,0.05)]">
                    <div className="absolute inset-0 bg-primary/2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0 text-primary shadow-[0_10px_30px_rgba(254,254,0,0.1)]">
                        <Activity size={28} />
                    </div>
                    <div>
                        <h3 className="text-[11px] font-bold text-primary uppercase tracking-[0.4em] italic mb-3">SIEM Data Stream</h3>
                        <p className="text-sm font-medium text-zinc-500 leading-relaxed max-w-3xl">
                            Deploy a <span className="text-white font-bold italic">SIEM Pipeline</span> above to establish high-throughput audit telemetry. System logs are batched and exported in real-time intervals of 30s. Advanced support for <span className="text-zinc-400 font-bold">Splunk (HEC)</span>, <span className="text-zinc-400 font-bold">ELK</span>, and <span className="text-zinc-400 font-bold">Datadog</span>.
                        </p>
                    </div>
                </div>
            </div>

            <ConfirmModal
                isOpen={pendingDeleteId !== null}
                onClose={() => setPendingDeleteId(null)}
                onConfirm={() => pendingDeleteId !== null ? handleDelete(pendingDeleteId) : undefined}
                title="Protocol Decommission"
                message="This integration endpoint will be immediately severed. Alerts and telemetry batches will cease transmission."
                confirmText="Terminate Pipeline"
                type="danger"
            />

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </ModuleScrollContainer>
    );
};

export default IntegrationsManager;


