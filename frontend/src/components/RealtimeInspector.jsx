import React, { useState, useEffect } from 'react';
import {
    Activity,
    Search,
    Filter,
    Trash2,
    Play,
    Pause,
    Radio,
    Terminal,
    ArrowRight,
    Wifi
} from 'lucide-react';

const RealtimeInspector = () => {
    const [events, setEvents] = useState([
        { id: 1, type: 'INSERT', table: 'users', data: { id: '550e...', name: 'John' }, time: '12:04:32' },
        { id: 2, type: 'UPDATE', table: 'profiles', data: { last_seen: '2026-01-26' }, time: '12:05:11' },
        { id: 3, type: 'DELETE', table: 'tokens', data: { id: '772b...' }, time: '12:06:01' }
    ]);
    const [isListening, setIsListening] = useState(true);

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500">
            {/* Realtime Control Bar */}
            <div className="h-14 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between px-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-inner">
                        <Wifi size={14} className={isListening ? "text-primary animate-pulse" : "text-zinc-600"} />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {isListening ? 'Streaming Active' : 'Stream Paused'}
                        </span>
                    </div>
                    <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                    <button
                        onClick={() => setIsListening(!isListening)}
                        className={`flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${isListening ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' : 'bg-primary text-black'
                            }`}
                    >
                        {isListening ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        {isListening ? 'Stop Listening' : 'Start Listening'}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <button className="text-zinc-500 hover:text-zinc-200 p-2 transition-colors">
                        <Trash2 size={16} />
                    </button>
                    <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                        <input
                            type="text"
                            placeholder="Filter by type or table..."
                            className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-64 transition-all"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Event Feed */}
                <div className="w-1/2 border-r border-[#2e2e2e] flex flex-col bg-[#111111]">
                    <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#141414] text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                        Live Event Log
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {events.map((ev) => (
                            <div key={ev.id} className="group flex items-center justify-between p-3 rounded-xl bg-zinc-900/30 border border-transparent hover:border-zinc-800 hover:bg-zinc-800/40 cursor-pointer transition-all">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[8px] tracking-tighter ${ev.type === 'INSERT' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                            ev.type === 'UPDATE' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                                'bg-red-500/10 text-red-500 border border-red-500/20'
                                        }`}>
                                        {ev.type}
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                                            {ev.table} <ArrowRight size={10} className="text-zinc-700" /> <span className="text-zinc-500 uppercase text-[9px]">OzyBase-Core</span>
                                        </p>
                                        <p className="text-[9px] font-mono text-zinc-600 leading-none mt-1">{ev.time}</p>
                                    </div>
                                </div>
                                <div className="text-[10px] font-mono text-zinc-700 group-hover:text-primary transition-colors">
                                    #evt_{ev.id}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Event Detail / Inspection */}
                <div className="w-1/2 flex flex-col bg-[#0c0c0c]">
                    <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#141414] text-[9px] font-black text-zinc-600 uppercase tracking-widest flex items-center justify-between">
                        <span>Event Payload Inspector</span>
                        <div className="flex gap-2">
                            <span className="w-2 h-2 rounded-full bg-primary" />
                            <span className="w-2 h-2 rounded-full bg-zinc-800" />
                            <span className="w-2 h-2 rounded-full bg-zinc-800" />
                        </div>
                    </div>
                    <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                        <div className="bg-[#111111] rounded-2xl border border-[#2e2e2e] overflow-hidden shadow-2xl">
                            <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center gap-2">
                                <Terminal size={14} className="text-zinc-500" />
                                <span className="text-[10px] font-mono text-zinc-400">JSON Payload</span>
                            </div>
                            <pre className="p-6 text-xs text-primary font-mono leading-relaxed overflow-x-auto">
                                {JSON.stringify(events[0].data, null, 4)}
                            </pre>
                        </div>

                        <div className="mt-8 space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 ml-1">Event Metadata</h4>
                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { k: 'Source', v: 'PostgreSQL WAL' },
                                    { k: 'Channel', v: 'public:users' },
                                    { k: 'Latency', v: '12ms' },
                                    { k: 'Schema', v: 'public' }
                                ].map((item, i) => (
                                    <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                                        <p className="text-[8px] font-bold text-zinc-600 uppercase mb-1">{item.k}</p>
                                        <p className="text-xs font-bold text-zinc-300 uppercase tracking-tight">{item.v}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RealtimeInspector;
