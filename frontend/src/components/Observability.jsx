import React, { useState } from 'react';
import {
    Activity,
    Zap,
    Wifi,
    Clock,
    ArrowUpRight,
    ArrowDownRight,
    Monitor,
    Database,
    ShieldCheck,
    Cpu,
    BarChart
} from 'lucide-react';

const Observability = () => {
    const stats = [
        { title: 'Total Requests', value: '42,901', change: '+12%', up: true, icon: Activity },
        { title: 'Avg. Latency', value: '18ms', change: '-4%', up: false, icon: Zap },
        { title: 'Error Rate', value: '0.04%', change: '-0.01%', up: false, icon: ShieldCheck },
        { title: 'CPU Usage', value: '14.2%', change: '+2%', up: true, icon: Cpu }
    ];

    const logs = [
        { method: 'GET', path: '/api/tables/users', status: 200, time: '14ms', timestamp: '12:04:32' },
        { method: 'POST', path: '/api/auth/login', status: 200, time: '142ms', timestamp: '12:05:01' },
        { method: 'GET', path: '/api/schema/orders', status: 404, time: '8ms', timestamp: '12:05:15' },
        { method: 'PATCH', path: '/api/tables/profiles/row/8', status: 200, time: '28ms', timestamp: '12:06:00' }
    ];

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            {/* Realtime Stats Header */}
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, i) => (
                    <div key={i} className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 shadow-xl group hover:border-primary/30 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-primary transition-colors font-bold">
                                <stat.icon size={20} />
                            </div>
                            <div className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${stat.up ? 'text-green-500' : 'text-primary'}`}>
                                {stat.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                {stat.change}
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">{stat.title}</p>
                        <h3 className="text-2xl font-black text-white tracking-tighter italic">{stat.value}</h3>
                    </div>
                ))}
            </div>

            {/* Main Graphs Area (Mock) */}
            <div className="px-8 pb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 h-80 flex flex-col relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Request Traffic</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Global load across all regions</p>
                        </div>
                        <div className="flex gap-2">
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-2 py-1 text-[9px] font-bold uppercase text-zinc-500">Last 24h</div>
                        </div>
                    </div>
                    {/* Visualizer Mock */}
                    <div className="flex-1 flex items-end gap-1 px-2">
                        {[...Array(60)].map((_, i) => (
                            <div
                                key={i}
                                style={{ height: `${Math.random() * 80 + 10}%` }}
                                className={`flex-1 rounded-full transition-all duration-1000 ${i > 45 ? 'bg-primary/80 animate-pulse' : 'bg-zinc-800/50'}`}
                            />
                        ))}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />
                </div>

                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 h-80 flex flex-col">
                    <div className="flex items-center justify-between mb-8">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Database Health</h4>
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                    </div>
                    <div className="flex-1 flex items-center justify-center relative">
                        <div className="w-40 h-40 rounded-full border-[8px] border-zinc-900 flex items-center justify-center">
                            <div className="text-center">
                                <p className="text-2xl font-black text-white italic tracking-tighter">99.9%</p>
                                <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Uptime</p>
                            </div>
                        </div>
                        {/* Circular progress mock */}
                        <div className="absolute inset-0 w-40 h-40 m-auto rounded-full border-[8px] border-transparent border-t-primary border-l-primary rotate-45" />
                    </div>
                </div>
            </div>

            {/* API Gateway Logs (Referral) */}
            <div className="px-8 pb-12">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Monitor size={16} className="text-zinc-500" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Recent API Calls</h4>
                        </div>
                        <button className="text-[9px] font-black uppercase text-primary tracking-widest hover:underline">View All Logs</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <tbody className="divide-y divide-[#2e2e2e]/30">
                                {logs.map((log, i) => (
                                    <tr key={i} className="hover:bg-zinc-900/50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase tracking-widest border ${log.method === 'POST' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                                    log.method === 'GET' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                        'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                    }`}>
                                                    {log.method}
                                                </span>
                                                <span className="text-xs font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-tight">{log.path}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1 h-1 rounded-full ${log.status >= 400 ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-green-500'}`} />
                                                <span className="text-[11px] font-bold text-zinc-500">{log.status}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            {log.time}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[10px] font-mono text-zinc-700">{log.timestamp}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Observability;
