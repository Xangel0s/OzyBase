import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowRight,
    Cpu,
    Monitor,
    Pause,
    Play,
    Radio,
    Search,
    Terminal,
    Wifi,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface RealtimeInspectorProps {
    view?: 'inspector' | 'config' | 'configuration';
}

const RealtimeInspector: React.FC<RealtimeInspectorProps> = ({ view = 'inspector' }) => {
    // Keep backward compatibility with persisted/legacy views ("config"/"configuration")
    void view;

    const [events, setEvents] = useState<any[]>([]);
    const [isListening, setIsListening] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [filterValue, setFilterValue] = useState('');

    useEffect(() => {
        if (!isListening) {
            return;
        }

        let es: EventSource | null = null;
        let disposed = false;

        const openStream = async () => {
            const workspaceId = localStorage.getItem('ozy_workspace_id')?.trim().toLowerCase() || '';
            const requestedChannels = workspaceId ? [`workspace:${workspaceId}`] : [];

            const sessionRes = await fetchWithAuth('/api/realtime/session', {
                method: 'POST',
                body: JSON.stringify({
                    channels: requestedChannels,
                    expires_in: 300,
                }),
            });

            if (disposed) {
                return;
            }

            if (sessionRes.status === 404 || sessionRes.status === 405) {
                es = new EventSource('/api/realtime');
            } else if (sessionRes.ok) {
                const sessionPayload = await sessionRes.json().catch(() => null) as { token?: unknown; channels?: unknown } | null;
                const token = typeof sessionPayload?.token === 'string' ? sessionPayload.token.trim() : '';
                if (!token) {
                    throw new Error('Realtime session did not return a token');
                }
                const grantedChannels = Array.isArray(sessionPayload?.channels)
                    ? sessionPayload.channels
                        .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
                        .map((item) => item.trim())
                    : [];
                const streamUrl = new URL('/api/realtime', window.location.origin);
                streamUrl.searchParams.set('token', token);
                if (grantedChannels.length > 0) {
                    streamUrl.searchParams.set('channels', grantedChannels.join(','));
                }
                es = new EventSource(`${streamUrl.pathname}${streamUrl.search}`);
            } else {
                const payload = await sessionRes.json().catch(() => null) as { error?: unknown } | null;
                throw new Error(String(payload?.error || `Failed to create realtime session (${sessionRes.status})`));
            }

            if (!es || disposed) {
                return;
            }

            es.onmessage = (event: MessageEvent) => {
                try {
                    const newEvent = JSON.parse(event.data);
                    const eventWithId = {
                        ...newEvent,
                        id: Date.now() + Math.random(),
                        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    };

                    setEvents((prev: any) => [eventWithId, ...prev].slice(0, 50));
                    setSelectedEvent((prev: any) => prev || eventWithId);
                } catch (error) {
                    console.error('Event parse error:', error);
                }
            };

            es.onerror = (error: Event) => {
                console.error('SSE Error:', error);
                es?.close();
            };
        };

        void openStream().catch((error) => {
            console.error('SSE bootstrap error:', error);
        });

        return () => {
            disposed = true;
            es?.close();
        };
    }, [isListening]);

    const filteredEvents = useMemo(() => {
        const query = filterValue.trim().toLowerCase();
        if (!query) {
            return events;
        }

        return events.filter((ev: any) => (
            String(ev?.action || '').toLowerCase().includes(query)
            || String(ev?.table || '').toLowerCase().includes(query)
            || String(ev?.time || '').toLowerCase().includes(query)
            || JSON.stringify(ev?.record || {}).toLowerCase().includes(query)
        ));
    }, [events, filterValue]);

    return (
        <div className="flex flex-col h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.012),transparent_50%)] pointer-events-none" />

            <div className="bg-[#131313] border-b border-white/5 px-12 pt-10 relative z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/5 rounded-[20px] flex items-center justify-center border border-primary/20 shadow-[0_0_30px_rgba(254,254,0,0.05)]">
                            <Radio size={28} className={isListening ? 'text-primary animate-pulse' : 'text-zinc-600'} strokeWidth={1.5} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-white uppercase italic tracking-tighter leading-none">Realtime Engine</h1>
                             <p className="mt-2 text-[9px] font-bold text-zinc-300 uppercase tracking-[0.4em] leading-none italic">
                                Listening on {window.location.host}/api/realtime
                            </p>
                        </div>
                    </div>

                    <div className="px-4 py-2 rounded-md border border-white/5 bg-black/40 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 italic">
                        Inspector
                    </div>
                </div>
            </div>

            <div className="h-20 border-b border-white/5 bg-background/80 backdrop-blur-md flex items-center justify-between px-12 relative z-10">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4 px-6 py-2.5 bg-black border border-white/5 rounded-md shadow-inner">
                        <Wifi size={14} className={isListening ? 'text-emerald-500 animate-pulse' : 'text-zinc-700'} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] italic text-zinc-300">
                            {isListening ? 'Stream_Active' : 'Stream_Paused'}
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsListening(!isListening)}
                            className={`h-11 px-6 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-3 italic ${isListening ? 'bg-red-500/5 text-red-500 border border-red-500/20 hover:bg-red-500/10' : 'bg-primary text-black shadow-lg shadow-primary/10'}`}
                        >
                            {isListening ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
                            {isListening ? 'Terminate_Stream' : 'Initialize_Stream'}
                        </button>

                        <button
                            onClick={() => {
                                setEvents([]);
                                setSelectedEvent(null);
                            }}
                            className="h-11 px-6 bg-white/3 border border-white/5 text-zinc-400 hover:text-white rounded-md text-[10px] font-bold uppercase tracking-widest transition-all italic"
                        >
                            Clear_Stack
                        </button>
                    </div>
                </div>

                <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-primary transition-colors" size={16} />
                    <input
                        type="text"
                        value={filterValue}
                        onChange={(event) => setFilterValue(event.target.value)}
                        placeholder="FILTER_EVENT_SIGNATURE..."
                        className="bg-black border border-white/5 rounded-md pl-12 pr-6 py-3 text-[10px] font-bold text-white focus:outline-none focus:border-primary/20 w-80 transition-all font-mono uppercase tracking-widest placeholder:text-zinc-700"
                    />
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden relative z-10">
                <div className="w-1/2 border-r border-white/5 flex flex-col bg-background">
                    <div className="px-8 py-5 border-b border-white/5 bg-white/2 flex items-center justify-between">
                         <span className="text-[9px] font-bold text-white/50 uppercase tracking-[0.4em] italic">Live_Kernel_Log</span>
                        <span className="text-[9px] font-bold text-zinc-400 tabular-nums">BUFFER: {filteredEvents.length}/50</span>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.02)_0%,_transparent_70%)]">
                        {filteredEvents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full opacity-70 grayscale gap-6">
                                <Monitor size={64} strokeWidth={1} />
                                <span className="text-[10px] uppercase font-bold tracking-[0.5em] italic">Awaiting_Transmission...</span>
                            </div>
                        ) : (
                            filteredEvents.map((ev: any) => (
                                <div
                                    key={ev.id}
                                    onClick={() => setSelectedEvent(ev)}
                                    className={`group relative flex items-center justify-between p-5 rounded-[22px] border transition-all cursor-pointer overflow-hidden ${selectedEvent?.id === ev.id ? 'bg-white/4 border-primary/40 shadow-2xl' : 'bg-black/40 border-white/5 hover:border-white/10 hover:bg-white/2'}`}
                                >
                                    <div className="absolute inset-y-0 left-0 w-1 bg-primary transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300" />

                                    <div className="flex items-center gap-5 relative z-10">
                                        <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center font-bold text-[9px] tracking-tighter italic border transition-all ${
                                            ev.action === 'INSERT' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                                : ev.action === 'UPDATE' ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
                                                    : 'bg-red-500/10 text-red-500 border-red-500/20'
                                        }`}>
                                            {ev.action}
                                        </div>

                                        <div>
                                             <p className="text-[12px] font-bold text-white italic tracking-tight flex items-center gap-3">
                                                {String(ev.table || '').toUpperCase()}
                                                <ArrowRight size={12} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                                <span className="text-zinc-300/60 uppercase text-[9px] font-bold tracking-widest">OZYBASE_KERNEL</span>
                                            </p>
                                            <p className="text-[9px] font-mono text-zinc-300 font-bold leading-none mt-2 tabular-nums">{ev.time}</p>
                                        </div>
                                    </div>

                                     <div className="text-[10px] font-mono text-zinc-500 group-hover:text-primary transition-colors font-bold relative z-10">
                                        #{Math.floor(ev.id % 9999).toString().padStart(4, '0')}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="w-1/2 flex flex-col bg-background relative">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,rgba(59,130,246,0.02),transparent_50%)] pointer-events-none" />
                    <div className="px-8 py-5 border-b border-white/5 bg-white/2 flex items-center justify-between relative z-10">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none">Payload Inspector</span>
                        <div className="flex gap-2">
                            <div className={`w-2 h-2 rounded-full transition-all duration-500 ${selectedEvent ? 'bg-primary shadow-[0_0_8px_rgba(254,254,0,0.5)]' : 'bg-zinc-900 animate-pulse'}`} />
                            <div className="w-2 h-2 rounded-full bg-zinc-900" />
                            <div className="w-2 h-2 rounded-full bg-zinc-900" />
                        </div>
                    </div>

                    <div className="flex-1 p-10 overflow-auto custom-scrollbar relative z-10">
                        {selectedEvent ? (
                            <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-500">
                                <div className="bg-background rounded-[40px] border border-white/5 overflow-hidden shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)]">
                                    <div className="px-8 py-4 bg-white/3 border-b border-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Terminal size={14} className="text-primary/60" />
                                            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest italic">JSON_PROTOCOL_BLOB</span>
                                        </div>
                                        <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">READ_ONLY_ACCESS</span>
                                    </div>
                                    <pre className="p-10 text-[12px] text-primary/70 font-mono leading-relaxed overflow-x-auto selection:bg-white/10 selection:text-white">
                                        {JSON.stringify(selectedEvent.record, null, 4)}
                                    </pre>
                                </div>

                                <div className="space-y-6">
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic ml-2 leading-none">Event Trace Metadata</h4>
                                    <div className="grid grid-cols-2 gap-6">
                                        {[
                                            { k: 'Source_Vector', v: 'POSTGRES_NOTIFY_BUS' },
                                            { k: 'Target_Schema', v: String(selectedEvent.table || '').toUpperCase() },
                                            { k: 'Operation', v: String(selectedEvent.action || '').toUpperCase() },
                                            { k: 'Resolution', v: selectedEvent.time },
                                        ].map((item) => (
                                            <div key={item.k} className="bg-white/2 border border-white/5 rounded-md p-6 relative group overflow-hidden">
                                                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/20 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
                                                <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-[0.3em] mb-3 italic">{item.k}</p>
                                                <p className="text-xs font-bold text-white uppercase italic tracking-tight">{item.v}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center opacity-70 grayscale gap-8">
                                <Cpu size={80} strokeWidth={0.5} />
                                <div className="text-center">
                                     <span className="text-[12px] font-bold uppercase tracking-[0.5em] italic block">Select_Vector_to_Decode</span>
                                    <p className="mt-4 text-[9px] font-bold text-zinc-400 uppercase tracking-widest">REALTIME_DECRYPTOR_AV_V4.2</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RealtimeInspector;



