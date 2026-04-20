import React, { useEffect, useState } from 'react';
import { 
    AlertTriangle, 
    Plus, 
    Search, 
    ShieldBan, 
    ShieldCheck, 
    Trash2, 
    X,
    ShieldAlert,
    Network,
    Clock,
    Lock
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';
import OzySelect from './OzySelect';

interface FirewallRule {
    id: string;
    ip_address: string;
    rule_type: 'BLOCK' | 'ALLOW' | string;
    reason?: string;
    expires_at?: string | null;
}

interface NewFirewallRule {
    ip_address: string;
    rule_type: 'BLOCK' | 'ALLOW';
    reason: string;
    duration_hours: number;
}

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown error';
};

const FirewallManager = () => {
    const [rules, setRules] = useState<FirewallRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newRule, setNewRule] = useState<NewFirewallRule>({
        ip_address: '',
        rule_type: 'BLOCK',
        reason: '',
        duration_hours: 0
    });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/security/firewall');
            if (!res.ok) throw new Error('Failed to fetch firewall rules');
            const data: unknown = await res.json();
            if (Array.isArray(data)) setRules(data as FirewallRule[]);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        try {
            const res = await fetchWithAuth('/api/security/firewall', {
                method: 'POST',
                body: JSON.stringify(newRule)
            });
            if (!res.ok) throw new Error('Failed to deploy rule');
            setShowModal(false);
            fetchRules();
            setNewRule({ ip_address: '', rule_type: 'BLOCK', reason: '', duration_hours: 0 });
            setToast({ message: 'Firewall architecture updated', type: 'success' });
        } catch (error) {
            setToast({ message: getErrorMessage(error), type: 'error' });
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetchWithAuth(`/api/security/firewall/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to release rule');
            fetchRules();
            setToast({ message: 'Transport vector released', type: 'success' });
        } catch (error) {
            setToast({ message: getErrorMessage(error), type: 'error' });
        }
    };

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.03),transparent_50%)] pointer-events-none" />
            
            <header className="px-10 py-16 border-b border-white/5 bg-linear-to-b from-zinc-900/50 to-transparent relative z-10 overflow-hidden">
                <div className="absolute inset-0 bg-linear-to-r from-red-500/5 to-transparent pointer-events-none" />
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <div className="w-20 h-20 rounded-[32px] bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 shadow-[0_0_50px_rgba(239,68,68,0.1)] relative z-10">
                            <ShieldBan size={40} strokeWidth={1} />
                        </div>
                        <div className="relative z-10">
                            <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase italic">Ozy_Security :: Protocol_Filter</p>
                            <h1 className="mt-3 text-5xl font-bold text-white uppercase tracking-tighter italic leading-none">Firewall</h1>
                            <div className="mt-6 flex items-center gap-6">
                                <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 group cursor-help">
                                    <ShieldCheck size={12} className="text-emerald-500" />
                                    <span className="text-emerald-400 text-[9px] font-bold uppercase tracking-widest italic">Active_Defense_Active</span>
                                </div>
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em] italic tabular-nums">{rules.length}_ENFORCED_POLICIES</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="h-14 flex items-center gap-4 bg-white text-black px-10 rounded-md font-bold text-[11px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)] group"
                    >
                        <Plus size={18} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-500" />
                        Provision Rule
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto custom-scrollbar p-10 relative z-10">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-700">
                        <Clock size={32} className="opacity-20 animate-spin" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] italic">Scanning Perimeter...</p>
                    </div>
                ) : rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full border border-white/5 bg-white/1 rounded-[48px] gap-6 group transition-all hover:bg-white/2">
                        <div className="w-20 h-20 bg-emerald-500/5 border border-emerald-500/10 rounded-[32px] flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
                            <ShieldCheck size={32} />
                        </div>
                        <div className="text-center">
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.3em] italic">Perimeter is currently uncontested</p>
                            <p className="mt-2 text-[9px] font-bold text-zinc-700 uppercase tracking-widest">No active block/allow rules detected in kernel space</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6 max-w-6xl mx-auto">
                        {rules.map((rule) => (
                            <div key={rule.id} className="group relative rounded-[40px] border border-white/5 bg-background p-8 flex items-center justify-between transition-all hover:bg-white/2 hover:border-white/10 shadow-2xl">
                                <div className="flex items-center gap-8">
                                    <div className={`w-14 h-14 rounded-[24px] border flex items-center justify-center transition-all ${rule.rule_type === 'BLOCK' ? 'bg-red-500/5 border-red-500/20 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.05)]' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-500'}`}>
                                        {rule.rule_type === 'BLOCK' ? <ShieldBan size={24} strokeWidth={1.5} /> : <ShieldCheck size={24} strokeWidth={1.5} />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-4 mb-2">
                                            <h3 className="text-white font-mono text-lg font-bold tracking-tight">{rule.ip_address}</h3>
                                            <span className={`text-[9px] font-bold px-3 py-1 rounded-md border text-black uppercase italic tracking-widest ${rule.rule_type === 'BLOCK' ? 'bg-red-500 border-red-400' : 'bg-emerald-500 border-emerald-400'}`}>
                                                {rule.rule_type}_PROTOCOL
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                <AlertTriangle size={10} className={rule.rule_type === 'BLOCK' ? 'text-red-500' : 'text-emerald-500'} />
                                                {rule.reason || 'NO_NARRATIVE_PROVIDED'}
                                            </p>
                                            {rule.expires_at && (
                                                <>
                                                    <div className="w-1 h-1 rounded-full bg-white/10" />
                                                    <p className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest italic">TTL: {new Date(rule.expires_at).toLocaleDateString()}</p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPendingDeleteId(rule.id)}
                                    className="w-12 h-12 rounded-md bg-white/3 border border-white/5 flex items-center justify-center text-zinc-600 hover:text-red-500 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {showModal && (
                <div className="fixed inset-0 z-120 flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-in fade-in duration-500" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
                    <div className="w-full max-w-4xl bg-background border border-white/5 rounded-[48px] overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-700">
                        <header className="px-10 py-8 border-b border-white/5 flex items-center justify-between bg-white/2">
                            <div className="flex items-center gap-5">
                                <div className="w-12 h-12 rounded-[20px] bg-red-500/5 border border-red-500/20 flex items-center justify-center text-red-500">
                                    <Network size={24} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white italic tracking-tighter uppercase leading-none">Rule Provisioning</h2>
                                    <p className="text-[9px] text-zinc-600 uppercase font-bold mt-2 tracking-widest leading-none">Updating kernel filter policies</p>
                                </div>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-md bg-white/3 flex items-center justify-center text-zinc-500 hover:text-white transition-all">
                                <X size={20} className="rotate-45" />
                            </button>
                        </header>
                        
                        <div className="p-10 space-y-10">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                                <div className="md:col-span-2 space-y-4">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-none ml-2">Source IP Vector</label>
                                    <div className="p-6 rounded-md bg-black border border-white/5 shadow-inner">
                                        <input
                                            type="text"
                                            placeholder="0.0.0.0"
                                            className="w-full bg-transparent border-none p-0 text-sm font-bold text-white outline-none placeholder:text-zinc-900 tracking-[0.2em] font-mono"
                                            value={newRule.ip_address}
                                            onChange={(e: any) => setNewRule({ ...newRule, ip_address: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-none ml-2">Action_Type</label>
                                    <OzySelect
                                        value={newRule.rule_type}
                                        onChange={(e: any) => setNewRule({ ...newRule, rule_type: e.target.value as NewFirewallRule['rule_type'] })}
                                        wrapperClassName="border-white/5 bg-black rounded-md"
                                        selectClassName="h-14 px-6 text-[10px] font-bold uppercase tracking-widest italic"
                                    >
                                        <option value="BLOCK">BLOCK_ACCESS</option>
                                        <option value="ALLOW">ALLOW_WHITELIST</option>
                                    </OzySelect>
                                </div>

                                <div className="md:col-span-2 space-y-4">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-none ml-2">Incident_Context</label>
                                    <div className="p-6 rounded-md bg-black border border-white/5 shadow-inner">
                                        <input
                                            type="text"
                                            placeholder="TRACE_DETAILS..."
                                            className="w-full bg-transparent border-none p-0 text-[11px] font-bold text-zinc-400 outline-none placeholder:text-zinc-900 tracking-widest uppercase italic"
                                            value={newRule.reason}
                                            onChange={(e: any) => setNewRule({ ...newRule, reason: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[9px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-none ml-2">TTL_WINDOW (HR)</label>
                                    <div className="p-4 h-14 rounded-md bg-black border border-white/5 flex items-center shadow-inner">
                                         <input
                                            type="number"
                                            placeholder="0_INF"
                                            className="w-full bg-transparent border-none p-0 text-[10px] font-bold text-white outline-none placeholder:text-zinc-900 tracking-widest"
                                            value={newRule.duration_hours}
                                            onChange={(e: any) => setNewRule({ ...newRule, duration_hours: Number.parseInt(e.target.value, 10) || 0 })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <footer className="p-10 bg-black/40 border-t border-white/5">
                            <button
                                onClick={handleCreate}
                                className="w-full bg-white text-black py-6 rounded-[32px] font-bold text-[11px] uppercase tracking-[0.3em] hover:scale-[1.02] active:scale-95 shadow-[0_20px_40px_rgba(255,255,255,0.1)] transition-all italic"
                            >
                                Deploy Rule to Kernel
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingDeleteId}
                onClose={() => setPendingDeleteId(null)}
                onConfirm={() => pendingDeleteId ? handleDelete(pendingDeleteId) : undefined}
                title="RELEASE_FIREWALL_VECTOR"
                message="Vector traffic flow will be restored to default routing. Confirm rule revocation?"
                confirmText="Revoke Rule"
                type="danger"
            />

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                    position="top-right"
                />
            ) : null}
        </div>
    );
};

export default FirewallManager;


