import React from 'react';
import { BookOpen, FileText, Code, Shield, Database, FolderOpen, Zap, MousePointer2 } from 'lucide-react';

const ApiDocs = ({ page = 'intro' }) => {
    const getContent = () => {
        switch (page) {
            case 'intro':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Introduction</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Welcome to the OzyBase API documentation. OzyBase provides a complete backend-as-a-service
                                interface including database management, authentication, storage, and edge functions.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-[#171717] rounded-xl border border-[#2e2e2e]">
                                    <h3 className="text-sm font-bold text-white mb-2">REST API</h3>
                                    <p className="text-xs text-zinc-500">Auto-generated endpoints for all your tables.</p>
                                </div>
                                <div className="p-4 bg-[#171717] rounded-xl border border-[#2e2e2e]">
                                    <h3 className="text-sm font-bold text-white mb-2">Realtime</h3>
                                    <p className="text-xs text-zinc-500">Subscribe to database changes via WebSocket.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'auth_api':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Authentication API</h2>
                            <p className="text-zinc-400 mb-6">
                                Manage users, issue tokens, and handle OAuth providers.
                            </p>
                            <div className="bg-[#0c0c0c] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs overflow-x-auto">
                                <span className="text-green-400">POST</span> <span className="text-zinc-300">/api/auth/login</span>
                            </div>
                        </div>
                    </div>
                );
            // Add other cases as placeholdes
            default:
                return (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-zinc-500">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <h2 className="text-xl font-black uppercase tracking-widest opacity-50">Documentation</h2>
                        <p className="text-xs font-mono mt-2">Select a topic from the sidebar</p>
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                        <BookOpen className="text-primary" size={28} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">API Docs</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                            <Code size={12} className="text-blue-500" />
                            Developer Reference & SDKs
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                <div className="max-w-4xl mx-auto">
                    {getContent()}
                </div>
            </div>
        </div>
    );
};

export default ApiDocs;
