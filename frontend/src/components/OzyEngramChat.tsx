import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Check, Clock3, Copy, Download, Eye, EyeOff, Loader2, MoreVertical, RefreshCw, SendHorizontal, Settings2, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import GovernanceControl from './Shared/GovernanceControl';
import { BrandedToast, type BrandedToastTone } from './OverlayPrimitives';
import { useEngramNexus } from '../hooks/useEngramNexus';
import { fetchWithAuth } from '../utils/api';

type ThreadMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: number;
    meta?: string;
};

const OZY_ENGRAM_CHAT_STORAGE_KEY = 'ozyengram.threadMessages.v1';

const OzyEngramChat: React.FC = () => {
    const {
        engramFeed,
        engramStatus,
        engramTotalEvents,
        engramWindowHours,
        engramChronicle,
        engramEntropy,
        engramKernelConfig,
        engramAutonomyConfig,
        engramConfigLoading,
        engramConfigSaving,
        engramAutonomyLoading,
        engramAutonomySaving,
        engramCompactionRunning,
        engramDiagnosticRunning,
        engramDiagnostic,
        leadArchitectAudit,
        loadEngramKernelConfig,
        saveEngramKernelConfig,
        saveEngramAutonomyLevel,
        runEngramDiagnostic,
        refreshEngramContext,
        compactEngramNow,
    } = useEngramNexus();

    const [draft, setDraft] = useState('');
    const [activeThreadId, setActiveThreadId] = useState<string>('thread-general');
    const [threadMessages, setThreadMessages] = useState<Record<string, ThreadMessage[]>>({});
    const [isResponding, setIsResponding] = useState(false);
    const [typingThreadId, setTypingThreadId] = useState<string | null>(null);
    const [threadMenuOpenId, setThreadMenuOpenId] = useState<string | null>(null);
    const [showKernelConfig, setShowKernelConfig] = useState(false);
    const [autonomySelectorOpen, setAutonomySelectorOpen] = useState(false);
    const [dangerModalOpen, setDangerModalOpen] = useState(false);
    const [dangerAcknowledge, setDangerAcknowledge] = useState(false);
    const [pendingAutonomyLevel, setPendingAutonomyLevel] = useState<'L1' | 'L2' | 'L3' | null>(null);
    const [kernelAPIKeyInput, setKernelAPIKeyInput] = useState('');
    const [kernelAPIKeyVisible, setKernelAPIKeyVisible] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const autonomySelectorRef = useRef<HTMLDivElement | null>(null);
    const threadMenuRef = useRef<HTMLDivElement | null>(null);
    const responseTimerRef = useRef<number | null>(null);

    const [contextFeedback, setContextFeedback] = useState<{
        message: string;
        tone: BrandedToastTone;
        title?: string;
    } | null>(null);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(OZY_ENGRAM_CHAT_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Record<string, ThreadMessage[]>;
            if (!parsed || typeof parsed !== 'object') return;
            setThreadMessages(parsed);
        } catch {
            // ignore broken local cache
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(OZY_ENGRAM_CHAT_STORAGE_KEY, JSON.stringify(threadMessages));
        } catch {
            // ignore storage quota errors
        }
    }, [threadMessages]);

    const formatTimestamp = (value: number) => (
        new Date(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    );

    const approxBytes = useMemo(() => {
        const chronicleBytes = new TextEncoder().encode(String(engramChronicle || '')).length;
        const feedBytes = engramFeed.slice(0, 48).reduce((sum, item) => (
            sum + new TextEncoder().encode(`${item.agentName} ${item.intention} ${item.resource}`).length
        ), 0);
        return chronicleBytes + feedBytes;
    }, [engramChronicle, engramFeed]);

    const approxKB = approxBytes / 1024;

    const entropyTone = engramEntropy.state === 'flow'
        ? 'text-emerald-400'
        : engramEntropy.state === 'tension'
            ? 'text-amber-400'
            : engramEntropy.state === 'chaos'
                ? 'text-rose-400'
                : 'text-sky-400';

    const entropyLabel = engramEntropy.state === 'flow'
        ? 'NOMINAL_FLOW'
        : engramEntropy.state === 'tension'
            ? 'MODERATE_TENSION'
            : engramEntropy.state === 'chaos'
                ? 'CRITICAL_CHAOS'
                : 'CONTEXT_DEBT';

            const bridgeLabel = useMemo(() => {
                const kernelState = String(engramKernelConfig.syncState || '').toUpperCase();
                if (kernelState === 'SYNCHRONIZED' || kernelState === 'SYNC_COMPLETE') {
                    return 'SYNCHRONIZED';
                }
                if (kernelState === 'KERNEL_READY') {
                    return 'KERNEL_READY';
                }
                return String(engramStatus || 'idle').toUpperCase();
            }, [engramKernelConfig.syncState, engramStatus]);

            const bridgeTone = bridgeLabel === 'SYNCHRONIZED'
                ? 'text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.45)]'
                : bridgeLabel === 'KERNEL_READY'
                    ? 'text-sky-300'
                    : 'text-zinc-200';

    const threadCatalog = useMemo(() => {
        const grouped = new Map<string, { id: string; title: string; subtitle: string; updatedAt: number; count: number }>();

        engramFeed.slice(0, 120).forEach((entry) => {
            const resource = String(entry.resource || 'General').trim() || 'General';
            const threadId = `thread-${resource.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const current = grouped.get(threadId);
            grouped.set(threadId, {
                id: threadId,
                title: resource,
                subtitle: entry.agentName || 'MCP Agent',
                updatedAt: Math.max(current?.updatedAt || 0, entry.timestamp),
                count: (current?.count || 0) + 1,
            });
        });

        const ordered = Array.from(grouped.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        const hasGeneral = ordered.some((item) => item.id === 'thread-general');
        if (!hasGeneral) {
            ordered.unshift({
                id: 'thread-general',
                title: 'General',
                subtitle: 'Ozy Engram',
                updatedAt: Date.now(),
                count: engramFeed.length,
            });
        }
        return ordered.slice(0, 14);
    }, [engramFeed]);

    useEffect(() => {
        if (!threadCatalog.some((thread) => thread.id === activeThreadId)) {
            setActiveThreadId(threadCatalog[0]?.id || 'thread-general');
        }
    }, [activeThreadId, threadCatalog]);

    const activeThread = useMemo(
        () => threadCatalog.find((thread) => thread.id === activeThreadId),
        [activeThreadId, threadCatalog],
    );

    const baseMessages = useMemo(() => {
        const normalizedThread = String(activeThread?.title || 'General').toLowerCase();
        const scoped = engramFeed
            .filter((entry) => normalizedThread === 'general' || String(entry.resource || '').toLowerCase().includes(normalizedThread))
            .slice(0, 24)
            .reverse();

        if (scoped.length === 0) {
            return [{
                id: `empty-${activeThreadId}`,
                role: 'assistant' as const,
                text: 'No hay eventos de memoria para este hilo todavia. Puedes enviar una pregunta para iniciar contexto.',
                timestamp: Date.now(),
                meta: 'Ozy Engram',
            }];
        }

        return scoped.map((entry) => ({
            id: entry.id,
            role: 'assistant' as const,
            text: entry.intention,
            timestamp: entry.timestamp,
            meta: `${entry.agentName} | ${entry.resource}`,
        }));
    }, [activeThreadId, activeThread?.title, engramFeed]);

    const localMessages = threadMessages[activeThreadId] || [];
    const messages = useMemo(
        () => [...baseMessages, ...localMessages].sort((a, b) => a.timestamp - b.timestamp),
        [baseMessages, localMessages],
    );

    useEffect(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, typingThreadId]);

    useEffect(() => {
        if (!showKernelConfig) return;
        void loadEngramKernelConfig();
    }, [loadEngramKernelConfig, showKernelConfig]);

    useEffect(() => {
        if (!autonomySelectorOpen) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setAutonomySelectorOpen(false);
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                setAutonomySelectorOpen(false);
                return;
            }
            if (autonomySelectorRef.current?.contains(target)) return;
            setAutonomySelectorOpen(false);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [autonomySelectorOpen]);

    useEffect(() => {
        if (!threadMenuOpenId) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                setThreadMenuOpenId(null);
                return;
            }
            if (threadMenuRef.current?.contains(target)) return;
            setThreadMenuOpenId(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setThreadMenuOpenId(null);
            }
        };
        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [threadMenuOpenId]);

    useEffect(() => () => {
        if (responseTimerRef.current !== null) {
            window.clearTimeout(responseTimerRef.current);
        }
    }, []);

    const appendAssistantResponse = async (prompt: string) => {
        const summary = String(engramChronicle || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 1)[0] || 'Sin cronologia extensa.';
        const activeTriggers = leadArchitectAudit.triggers.filter((item) => item.active);
        const triggerSummary = activeTriggers.length > 0
            ? activeTriggers.map((item) => `${item.title}:${item.metric}`).join(' | ')
            : 'Sin señales activas';
        const semanticFlag = engramTotalEvents <= 2
            ? 'ALERTA: posible inconsistencia semantica (pocos eventos para el estado actual).'
            : 'Consistencia semantica estable con el contexto disponible.';
        let text = `Diagnostico Lead Architect para "${prompt}": eventos=${engramTotalEvents} en ${engramWindowHours}h, entropia=${entropyLabel}, estado=${leadArchitectAudit.status}. Triggers=${triggerSummary}. ${semanticFlag} Contexto clave: ${summary}`;
        let assistantMeta = 'Ozy Engram';
        try {
            const res = await fetchWithAuth('/api/project/engram/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            if (res.ok) {
                const payload = await res.json().catch(() => null) as {
                    response?: string;
                    response_mode?: string;
                    llm_provider?: string;
                    llm_model?: string;
                    fallback_reason?: string;
                } | null;
                const backendText = String(payload?.response || '').trim();
                if (backendText) {
                    text = backendText;
                }
                const mode = String(payload?.response_mode || '').trim().toLowerCase();
                if (mode === 'llm') {
                    const provider = String(payload?.llm_provider || '').trim();
                    const model = String(payload?.llm_model || '').trim();
                    assistantMeta = `Ozy Engram · LLM${provider ? ` (${provider}${model ? `/${model}` : ''})` : ''}`;
                } else if (mode === 'fallback') {
                    const reason = String(payload?.fallback_reason || '').trim();
                    assistantMeta = `Ozy Engram · FALLBACK${reason ? ` (${reason})` : ''}`;
                }
            }
        } catch {
            // keep local fallback response
            assistantMeta = 'Ozy Engram · FALLBACK (network)';
        }

        const response: ThreadMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text,
            timestamp: Date.now(),
            meta: assistantMeta,
        };
        setThreadMessages((current) => ({
            ...current,
            [activeThreadId]: [...(current[activeThreadId] || []), response],
        }));
        setTypingThreadId(null);
        setIsResponding(false);
        responseTimerRef.current = null;
    };

    const handleSend = () => {
        const text = draft.trim();
        if (!text || isResponding) return;

        const userMsg: ThreadMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            text,
            timestamp: Date.now(),
            meta: 'User',
        };

        setThreadMessages((current) => ({
            ...current,
            [activeThreadId]: [...(current[activeThreadId] || []), userMsg],
        }));
        setDraft('');
        setTypingThreadId(activeThreadId);
        setIsResponding(true);
        responseTimerRef.current = window.setTimeout(() => {
            void appendAssistantResponse(text);
        }, 850);
    };

    const onComposerKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    };

    const clearCurrentThreadMessages = () => {
        setThreadMessages((current) => {
            const next = { ...current };
            delete next[activeThreadId];
            return next;
        });
    };

    const clearThreadMessagesById = (threadID: string) => {
        setThreadMessages((current) => {
            const next = { ...current };
            delete next[threadID];
            return next;
        });
    };

    const clearAllThreadMessages = () => {
        setThreadMessages({});
        try {
            window.localStorage.removeItem(OZY_ENGRAM_CHAT_STORAGE_KEY);
        } catch {
            // ignore
        }
    };

    const exportThreadById = (threadID: string) => {
        const thread = threadCatalog.find((item) => item.id === threadID);
        const local = threadMessages[threadID] || [];
        const normalizedThread = String(thread?.title || 'General').toLowerCase();
        const scopedFeed = engramFeed
            .filter((entry) => normalizedThread === 'general' || String(entry.resource || '').toLowerCase().includes(normalizedThread))
            .slice(0, 24)
            .reverse()
            .map((entry) => ({
                role: 'assistant' as const,
                text: entry.intention,
                timestamp: entry.timestamp,
                meta: `${entry.agentName} | ${entry.resource}`,
            }));
        const merged = [...scopedFeed, ...local].sort((a, b) => a.timestamp - b.timestamp);
        const lines = merged.map((msg) => {
            const who = msg.role === 'user' ? 'USER' : 'OZY';
            const time = formatTimestamp(msg.timestamp);
            return `[${time}] ${who}: ${msg.text}`;
        });
        const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `ozyengram-${(thread?.title || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const quickPrompts = [
        'Detecta inconsistencia semantica entre esquema y memoria',
        'Evalua Context Debt y Entropy Drift ahora',
        'Propone plan tecnico de mitigacion por prioridad',
    ];

    const leadArchitectTone = leadArchitectAudit.status === 'critical'
        ? 'text-rose-300 border-rose-500/40 bg-rose-500/10'
        : leadArchitectAudit.status === 'watch'
            ? 'text-amber-200 border-amber-500/40 bg-amber-500/10'
            : leadArchitectAudit.status === 'nominal'
                ? 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10'
                : 'text-zinc-300 border-white/15 bg-white/5';

    const handleKernelSave = async () => {
        const ok = await saveEngramKernelConfig(kernelAPIKeyInput);
        if (ok) {
            setKernelAPIKeyInput('');
            setKernelAPIKeyVisible(false);
            await loadEngramKernelConfig();
        }
    };

    const handleKernelDiagnostic = async () => {
        await runEngramDiagnostic();
        await loadEngramKernelConfig();
    };

    const autonomyDotTone = engramAutonomyConfig.level === 'L3'
        ? 'bg-rose-400'
        : engramAutonomyConfig.level === 'L2'
            ? 'bg-sky-400'
            : 'bg-zinc-400';

    const applyAutonomyLevel = async (level: 'L1' | 'L2' | 'L3', acknowledgeRisk = false) => {
        const ok = await saveEngramAutonomyLevel(level, acknowledgeRisk);
        if (!ok) return;
        setAutonomySelectorOpen(false);
        setDangerModalOpen(false);
        setPendingAutonomyLevel(null);
        setDangerAcknowledge(false);
    };

    const onSelectAutonomyLevel = async (level: 'L1' | 'L2' | 'L3') => {
        if (level === engramAutonomyConfig.level) {
            setAutonomySelectorOpen(false);
            return;
        }

        if (level === 'L3') {
            setPendingAutonomyLevel('L3');
            setDangerAcknowledge(false);
            setDangerModalOpen(true);
            return;
        }

        await applyAutonomyLevel(level, false);
    };

    const [isCopying, setIsCopying] = useState(false);
    const copyChronicleAction = async () => {
        const text = String(engramChronicle || '').trim();
        if (!text) return;
        try {
            setIsCopying(true);
            await navigator.clipboard.writeText(text);
            setContextFeedback({
                message: 'Cronologia copiada al portapapeles con exito.',
                tone: 'success',
                title: 'OzyEngram_Cache'
            });
            setTimeout(() => setIsCopying(false), 2000);
        } catch {
            setContextFeedback({
                message: 'No se pudo copiar la cronologia.',
                tone: 'error',
                title: 'Bridge_Error'
            });
            setIsCopying(false);
        }
    };

    return (
        <div className="flex h-full w-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.02),transparent_50%)] pointer-events-none" />

            <aside className="w-72 border-r border-white/5 bg-linear-to-b from-white/2 to-transparent flex flex-col relative z-10 shrink-0">
                <div className="p-6 border-b border-white/5">
                    <p className="text-[10px] font-bold tracking-[0.3em] uppercase italic text-zinc-400">Context_Threads</p>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    {threadCatalog.length > 0 ? threadCatalog.map((thread) => {
                        const isActive = thread.id === activeThreadId;
                        return (
                            <div
                                key={thread.id}
                                onClick={() => setActiveThreadId(thread.id)}
                                className={`group relative rounded-md border p-4 cursor-pointer transition-all duration-500 ${isActive ? 'bg-primary border-primary shadow-[0_20px_40px_rgba(254,254,0,0.15)]' : 'bg-white/2 border-white/5 hover:border-white/20'}`}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className={`text-sm font-bold italic tracking-tight uppercase leading-none truncate ${isActive ? 'text-black' : 'text-white'}`}>
                                        {thread.title}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md border ${isActive ? 'bg-black/20 border-black/10 text-black' : 'bg-black/40 border-white/10 text-zinc-400'}`}>{thread.count} REQ</span>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setThreadMenuOpenId((current) => current === thread.id ? null : thread.id);
                                            }}
                                            className={`h-7 w-7 inline-flex items-center justify-center rounded-md border transition-colors ${isActive ? 'border-black/20 text-black hover:bg-black/10' : 'border-white/15 text-zinc-400 hover:text-white hover:border-white/30 hover:bg-white/10'}`}
                                            title="Opciones de hilo"
                                        >
                                            <MoreVertical size={14} />
                                        </button>
                                    </div>
                                </div>
                                <p className={`truncate text-[9px] font-bold uppercase tracking-widest mt-1 ${isActive ? 'text-black/60' : 'text-zinc-500'}`}>{thread.subtitle}</p>
                                <p className={`mt-2 text-[8px] font-bold uppercase tracking-widest italic ${isActive ? 'text-black/80' : 'text-zinc-600'}`}>SYNC: {formatTimestamp(thread.updatedAt)}</p>

                                {threadMenuOpenId === thread.id && (
                                    <div
                                        ref={threadMenuRef}
                                        className="absolute right-3 top-12 z-30 min-w-[170px] rounded-md border border-white/10 bg-[#0b0b0b]/95 p-2 shadow-[0_12px_35px_rgba(0,0,0,0.45)] backdrop-blur-xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                exportThreadById(thread.id);
                                                setThreadMenuOpenId(null);
                                            }}
                                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-200 hover:bg-white/10"
                                        >
                                            <Download size={12} /> Exportar hilo
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearThreadMessagesById(thread.id);
                                                setThreadMenuOpenId(null);
                                            }}
                                            className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-rose-200 hover:bg-rose-500/20"
                                        >
                                            <Trash2 size={12} /> Eliminar hilo
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <div className="py-12 text-center text-zinc-500 font-bold text-[9px] uppercase tracking-[0.4em] animate-pulse italic">Scanning_Memories...</div>
                    )}
                </div>
                <div className="border-t border-white/5 p-4">
                    <button
                        type="button"
                        onClick={() => setShowKernelConfig((current) => !current)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/45 bg-primary/15 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary hover:bg-primary/25 shadow-[0_0_20px_rgba(254,254,0,0.16)]"
                    >
                        <Settings2 size={13} /> Configuracion
                    </button>
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0 relative z-10">
                <header className="px-6 py-4 md:py-5 border-b border-white/5 flex items-center justify-between gap-4 md:gap-8 bg-linear-to-b from-zinc-900/50 to-transparent relative shrink-0">
                    <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
                    <div className="flex items-center gap-4 relative z-10 w-full overflow-hidden">
                        <div className="hidden sm:flex w-10 h-10 rounded-md bg-primary/20 border border-primary/30 items-center justify-center text-primary shadow-[0_0_20px_rgba(254,254,0,0.1)] shrink-0">
                            <BrainCircuit size={18} strokeWidth={2} />
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                             <div className="flex items-center gap-3">
                                 <h1 className="text-lg font-bold text-white uppercase italic tracking-tighter leading-none truncate">{activeThread?.title || 'General'}</h1>
                                 <span className="hidden md:inline-block text-[9px] font-bold tracking-[0.3em] text-zinc-500 uppercase italic truncate">:: KERNEL_MEMORY</span>
                             </div>
                        </div>
                    </div>

                    <div className="hidden lg:flex items-center gap-3 relative z-10 shrink-0">
                        <button
                             onClick={() => void refreshEngramContext()}
                             className="h-9 flex items-center gap-2 bg-white text-black px-4 rounded-md font-bold text-[9px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-md group shrink-0"
                        >
                            <RefreshCw size={14} strokeWidth={3} className="group-hover:rotate-180 transition-transform duration-500" />
                            Sync
                        </button>
                        <button
                             onClick={() => void compactEngramNow(true)}
                             disabled={engramCompactionRunning}
                             className="h-9 flex items-center gap-2 border border-emerald-400/35 bg-emerald-500/10 text-emerald-200 px-4 rounded-md font-bold text-[9px] uppercase tracking-[0.2em] transition-all shadow-md group shrink-0 hover:bg-emerald-500/20 disabled:opacity-55 disabled:cursor-not-allowed"
                        >
                            <RefreshCw size={14} strokeWidth={3} className={engramCompactionRunning ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
                            {engramCompactionRunning ? 'Compacting' : 'Compact'}
                        </button>

                        <div ref={autonomySelectorRef} className="relative">
                            <GovernanceControl
                                context="engram"
                                level={engramAutonomyConfig.level}
                                name={engramAutonomyConfig.name}
                                dotToneClassName={autonomyDotTone}
                                onClick={() => setAutonomySelectorOpen((current) => !current)}
                                disabled={engramAutonomyLoading || engramAutonomySaving}
                            />

                            {autonomySelectorOpen && (
                                <div className="absolute right-0 top-[calc(100%+10px)] z-[120] w-[360px] rounded-md border border-white/10 bg-[#090909]/95 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                                    <div className="mb-3">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Autonomy Selector</p>
                                        <p className="mt-1 text-xs font-semibold text-zinc-200">Nivel actual: {engramAutonomyConfig.level} · {engramAutonomyConfig.name}</p>
                                        <p className="mt-1 text-[11px] text-zinc-400">{engramAutonomyConfig.description}</p>
                                    </div>

                                    <div className="space-y-2">
                                        {['L1', 'L2', 'L3'].map((level) => {
                                            const isCurrent = level === engramAutonomyConfig.level;
                                            const subtitle = level === 'L1'
                                                ? 'Observador: solo lectura.'
                                                : level === 'L2'
                                                    ? 'Copiloto: escritura con aprobación.'
                                                    : 'Soberano: autonomía total.';
                                            return (
                                                <button
                                                    key={level}
                                                    type="button"
                                                    onClick={() => void onSelectAutonomyLevel(level as 'L1' | 'L2' | 'L3')}
                                                    disabled={engramAutonomyLoading || engramAutonomySaving}
                                                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${isCurrent ? 'border-primary/45 bg-primary/10 text-primary' : 'border-white/10 bg-black/35 text-zinc-300 hover:border-white/30'} disabled:cursor-not-allowed disabled:opacity-60`}
                                                >
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{level}</p>
                                                    <p className="mt-1 text-[10px] text-zinc-400 normal-case tracking-normal">{subtitle}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 custom-scrollbar">
                    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                        {messages.map((message) => (
                            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-5 py-4 text-sm shadow-xl ${message.role === 'user' ? 'rounded-[20px] rounded-br-[4px] border border-primary/20 bg-primary/10 text-white' : 'rounded-[20px] rounded-bl-[4px] border border-white/5 bg-white/5 text-zinc-200'}`}>
                                    {message.role === 'assistant' ? (
                                        <div className="prose prose-invert max-w-none text-sm leading-relaxed prose-p:my-2 prose-strong:text-zinc-100 prose-li:my-1 prose-code:rounded prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:text-primary prose-pre:rounded-md prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/50 prose-pre:p-3 prose-hr:border-white/10">
                                            <ReactMarkdown
                                                components={{
                                                    p({ children }) {
                                                        return <div className="my-2">{children}</div>;
                                                    },
                                                    code(props) {
                                                        const { inline, children, className, ...rest } = props as any;
                                                        const raw = String(children ?? '');
                                                        const isInlineCode = typeof inline === 'boolean'
                                                            ? inline
                                                            : (!className && !raw.includes('\n'));
                                                        if (isInlineCode) {
                                                            return <code className={className} {...rest}>{children}</code>;
                                                        }
                                                        const warnTone = raw.includes('[WARN]')
                                                            ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                                                            : raw.includes('[INFO]')
                                                                ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
                                                                : 'border-white/10 bg-black/50 text-zinc-200';
                                                        return (
                                                            <pre className={`rounded-md border p-3 ${warnTone}`}>
                                                                <code className={className} {...rest}>{children}</code>
                                                            </pre>
                                                        );
                                                    },
                                                }}
                                            >
                                                {message.text}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p className="whitespace-pre-wrap font-medium font-sans leading-relaxed">{message.text}</p>
                                    )}
                                    <div className={`mt-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] ${message.role === 'user' ? 'text-primary/70' : 'text-zinc-500'}`}>
                                        <Clock3 size={11} strokeWidth={2.5} />
                                        <span>{formatTimestamp(message.timestamp)}</span>
                                        {message.meta ? <><div className="w-1.5 h-1.5 rounded-full bg-current opacity-30" /><span>{message.meta}</span></> : null}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {typingThreadId === activeThreadId && (
                            <div className="flex justify-start">
                                <div className="inline-flex items-center gap-3 rounded-[20px] rounded-bl-[4px] border border-white/5 bg-white/5 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 italic">
                                    <Loader2 size={14} className="animate-spin text-primary" strokeWidth={2.5} />
                                    Synthesizing_Response...
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <footer className="px-4 md:px-8 py-6 bg-linear-to-t from-background via-background to-transparent relative z-10 shrink-0">
                    <div className="max-w-4xl mx-auto flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                            {quickPrompts.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => setDraft(prompt)}
                                    className="px-4 py-2 rounded-md border border-white/5 bg-black/40 text-[9px] font-bold text-zinc-500 hover:text-white hover:border-white/20 hover:bg-white/5 uppercase tracking-widest transition-all"
                                >
                                    {prompt}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setDraft(leadArchitectAudit.prompt)}
                                className="px-4 py-2 rounded-md border border-primary/35 bg-primary/10 text-[9px] font-bold text-primary hover:text-black hover:bg-primary uppercase tracking-widest transition-all"
                            >
                                Lead Architect Audit
                            </button>
                        </div>

                        <div className="flex items-end gap-3 bg-black/60 rounded-md border border-white/5 p-2 focus-within:border-primary/30 focus-within:shadow-[0_0_30px_rgba(254,254,0,0.05)] transition-all">
                            <textarea
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={onComposerKeyDown}
                                placeholder="TRANSMIT_QUERY_VECTOR..."
                                rows={1}
                                className="min-h-[52px] flex-1 resize-none bg-transparent px-5 py-4 text-[13px] font-bold text-white placeholder:text-zinc-600 focus:outline-none custom-scrollbar uppercase tracking-widest italic"
                            />
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={isResponding || !draft.trim()}
                                className="h-[52px] w-[52px] flex items-center justify-center rounded-[20px] bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-black hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale transition-all shrink-0 shadow-lg"
                                title="Transmitir"
                            >
                                {isResponding ? <Loader2 size={20} className="animate-spin text-zinc-500" /> : <SendHorizontal size={20} strokeWidth={2.5} />}
                            </button>
                        </div>
                    </div>
                </footer>
            </main>

            <aside className="hidden xl:flex w-72 border-l border-white/5 bg-[#070707] flex-col relative z-10 shrink-0">
                <div className="p-6 border-b border-white/5 bg-zinc-900/10">
                    <p className="text-[10px] font-bold tracking-[0.4em] uppercase italic text-zinc-500">Contexto vivo</p>
                </div>
                <div className="custom-scrollbar flex-1 overflow-y-auto p-4 space-y-3">
                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md p-5 relative overflow-hidden group hover:border-white/10 transition-all">
                        <div className={`absolute -top-6 -right-6 w-20 h-20 blur-2xl rounded-full opacity-10 group-hover:opacity-20 transition-opacity ${engramStatus === 'connected' ? 'bg-emerald-400' : 'bg-primary'}`} />
                        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Bridge</p>
                        <p className={`mt-3 text-sm font-bold uppercase tracking-[0.14em] drop-shadow-sm ${bridgeTone}`}>{bridgeLabel}</p>
                    </div>
                    
                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md p-5 hover:border-white/10 transition-all">
                        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Eventos</p>
                        <p className="mt-3 text-sm font-bold text-white uppercase tracking-[0.12em]"><span className="text-primary">{engramTotalEvents}</span> <span className="text-zinc-600 mx-1">/</span> <span className="text-zinc-400 font-bold">{engramWindowHours}H</span></p>
                    </div>
                    
                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md p-5 hover:border-white/10 transition-all">
                        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Entropia</p>
                        <p className={`mt-3 text-[11px] font-bold uppercase tracking-[0.15em] ${entropyTone}`}>{entropyLabel}</p>
                    </div>
                    
                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md p-5 hover:border-white/10 transition-all">
                        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Memoria</p>
                        <p className="mt-3 text-sm font-bold text-white uppercase tracking-[0.1em]">{approxKB.toFixed(1)} <span className="text-[10px] text-zinc-600 font-bold ml-1">KB TOTAL</span></p>
                    </div>
                    
                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/40 backdrop-blur-sm p-5 min-h-[180px] flex flex-col group hover:border-white/10 hover:bg-[#0d0d0d]/60 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Chronicle</p>
                            <button 
                                onClick={copyChronicleAction}
                                className={`p-2 rounded-md border border-white/5 hover:border-primary/40 hover:bg-primary/5 transition-all ${isCopying ? 'text-emerald-400 border-emerald-500/30' : 'text-zinc-500 hover:text-primary'}`}
                                title="Copiar cronologia"
                            >
                                {isCopying ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={3} />}
                            </button>
                        </div>
                        <p className="text-[10px] font-bold leading-relaxed text-zinc-300 uppercase tracking-widest italic line-clamp-[12] selection:bg-primary selection:text-black">{String(engramChronicle || 'Awaiting_Updates...')}</p>
                    </div>

                    <div className="rounded-md border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md p-5 hover:border-white/10 transition-all">
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 italic">Lead Architect</p>
                            <span className={`rounded-md border px-2 py-1 text-[8px] font-bold uppercase tracking-[0.2em] shadow-inner ${leadArchitectTone}`}>
                                {leadArchitectAudit.status}
                            </span>
                        </div>

                        {!leadArchitectAudit.ready && (
                            <div className="mb-4 p-3 rounded-md border border-white/5 bg-black/40">
                                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 text-center italic">
                                    Esperando SYNC_COMPLETE para auditoria.
                                </p>
                            </div>
                        )}

                        <div className="space-y-2">
                            {leadArchitectAudit.triggers.map((trigger) => (
                                <div key={trigger.id} className="rounded-md border border-white/5 bg-black/40 px-4 py-3 group/trigger hover:border-white/15 transition-all">
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-100 italic">{trigger.title}</p>
                                        <span className={`text-[8px] font-bold uppercase tracking-[0.15em] ${trigger.active ? 'text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]' : 'text-zinc-600'}`}>
                                            {trigger.metric}
                                        </span>
                                    </div>
                                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-500 group-hover/trigger:text-zinc-400 transition-colors">{trigger.detail}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </aside>

            {showKernelConfig && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm" onClick={() => setShowKernelConfig(false)}>
                    <div className="w-full max-w-xl rounded-md border border-primary/25 bg-[#0c0d10] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.75)]" onClick={(event) => event.stopPropagation()}>
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">Portal de Sincronia</p>
                                <h3 className="mt-1 text-xl font-bold uppercase tracking-[0.08em] text-primary">Kernel Config</h3>
                                <p className="mt-2 text-[11px] text-zinc-400">Configura la API Key y valida el puente de memoria con estilo OzyBase.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowKernelConfig(false)}
                                className="rounded-md border border-white/10 p-2 text-zinc-500 hover:text-zinc-100"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="mb-4 flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Bridge</span>
                            <span className={`rounded-md border px-2 py-1 text-[8px] font-bold uppercase tracking-[0.14em] ${bridgeLabel === 'SYNCHRONIZED' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : bridgeLabel === 'KERNEL_READY' ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
                                {bridgeLabel}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type={kernelAPIKeyVisible ? 'text' : 'password'}
                                value={kernelAPIKeyInput}
                                onChange={(event) => setKernelAPIKeyInput(event.target.value)}
                                placeholder={engramKernelConfig.apiKeyMasked || 'sk-...'}
                                className="h-11 flex-1 rounded-md border border-white/10 bg-black/35 px-3 text-sm text-zinc-200 outline-none transition focus:border-primary/55"
                            />
                            <button
                                type="button"
                                onClick={() => setKernelAPIKeyVisible((current) => !current)}
                                className="h-11 w-11 rounded-md border border-white/10 text-zinc-400 hover:text-zinc-100"
                                title={kernelAPIKeyVisible ? 'Ocultar API key' : 'Mostrar API key'}
                            >
                                {kernelAPIKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => void handleKernelSave()}
                                disabled={engramConfigSaving}
                                className="rounded-md border border-primary/45 bg-primary/15 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-primary hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {engramConfigSaving ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleKernelDiagnostic()}
                                disabled={engramDiagnosticRunning || engramConfigLoading}
                                className="rounded-md border border-amber-400/45 bg-amber-500/12 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {engramDiagnosticRunning ? 'Validando...' : 'Test Kernel'}
                            </button>
                        </div>

                        {engramDiagnostic && (
                            <p className="mt-4 rounded-md border border-white/10 bg-black/25 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.11em] text-zinc-300">
                                {engramDiagnostic.summary || engramDiagnostic.status}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {dangerModalOpen && (
                <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" onClick={() => setDangerModalOpen(false)}>
                    <div className="w-full max-w-xl rounded-md border border-rose-500/45 bg-[#12090a] p-5 shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_24px_90px_rgba(0,0,0,0.7)]" onClick={(event) => event.stopPropagation()}>
                        <div className="mb-4 flex items-start gap-3">
                            <div className="mt-0.5 rounded-md border border-rose-400/40 bg-rose-500/15 p-2 text-rose-200">
                                <X size={16} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-rose-300">Modal de Peligrosidad</p>
                                <h3 className="mt-1 text-base font-bold uppercase tracking-[0.08em] text-rose-100">Activar Nivel L3: Soberano</h3>
                            </div>
                        </div>

                        <p className="rounded-md border border-rose-500/30 bg-black/35 p-3 text-[12px] leading-relaxed text-rose-100">
                            Estás habilitando la autonomía total del Lead Architect. OzyBase ejecutará mutaciones, compactaciones y snapshots de forma autónoma basándose en el razonamiento del LLM. Riesgos: consumo imprevisto de tokens y posibles mutaciones no deseadas.
                        </p>

                        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-black/30 p-3">
                            <input
                                type="checkbox"
                                checked={dangerAcknowledge}
                                onChange={(event) => setDangerAcknowledge(event.target.checked)}
                                className="mt-0.5 h-4 w-4 accent-rose-500"
                            />
                            <span className="text-[11px] text-zinc-200">Entiendo que el Perfect Order tiene un costo de riesgo.</span>
                        </label>

                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setDangerModalOpen(false);
                                    setPendingAutonomyLevel(null);
                                    setDangerAcknowledge(false);
                                }}
                                className="rounded-md border border-white/15 bg-black/35 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={!dangerAcknowledge || engramAutonomySaving || pendingAutonomyLevel !== 'L3'}
                                onClick={() => void applyAutonomyLevel('L3', true)}
                                className="rounded-md border border-rose-400/45 bg-rose-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {engramAutonomySaving ? 'Aplicando...' : 'Activar L3'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {contextFeedback && (
                <BrandedToast
                    message={contextFeedback.message}
                    tone={contextFeedback.tone}
                    title={contextFeedback.title}
                    onClose={() => setContextFeedback(null)}
                    durationMs={2400}
                    position="bottom-right"
                />
            )}
        </div>
    );
};

export default OzyEngramChat;


