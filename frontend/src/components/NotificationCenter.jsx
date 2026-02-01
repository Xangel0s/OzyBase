import React, { useState, useEffect } from 'react';
import { Bell, Shield, AlertTriangle, CheckCircle2, X, Activity } from 'lucide-react';

const NotificationCenter = ({ isOpen, onClose, issues }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute top-16 right-6 w-96 bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-top-4 duration-200">
            <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between bg-[#111111]">
                <div className="flex items-center gap-2">
                    <Bell size={16} className="text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Project Notifications</h3>
                </div>
                <button onClick={onClose} className="text-zinc-600 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar">
                {issues.length === 0 ? (
                    <div className="p-12 text-center">
                        <CheckCircle2 size={32} className="text-green-500/30 mx-auto mb-4" />
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">No alerts detected</p>
                        <p className="text-[9px] text-zinc-700 mt-1 uppercase">Everything is looking sharp!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#2e2e2e]/50">
                        {issues.map((issue, idx) => (
                            <div key={idx} className="p-4 hover:bg-zinc-900/40 transition-colors group cursor-pointer">
                                <div className="flex items-start gap-4">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${issue.type === 'security' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                                        }`}>
                                        {issue.type === 'security' ? <Shield size={16} /> : <AlertTriangle size={16} />}
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-zinc-200 uppercase tracking-tight group-hover:text-white transition-colors leading-tight">
                                            {issue.title}
                                        </p>
                                        <p className="text-[10px] text-zinc-600 leading-relaxed font-medium">
                                            {issue.description}
                                        </p>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${issue.type === 'security' ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'
                                                }`}>
                                                {issue.type}
                                            </span>
                                            <span className="text-[8px] font-bold text-zinc-700 uppercase">JUST NOW</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-3 bg-[#0c0c0c] border-t border-[#2e2e2e] text-center">
                <button className="text-[9px] font-black text-zinc-600 hover:text-primary uppercase tracking-widest transition-colors">
                    View System Logs
                </button>
            </div>
        </div>
    );
};

export default NotificationCenter;
