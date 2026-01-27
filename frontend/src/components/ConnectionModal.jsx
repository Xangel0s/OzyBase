import React, { useState } from 'react';
import {
    X,
    Copy,
    Check,
    Database,
    Key,
    Lock,
    ExternalLink,
    Globe,
    Code,
    Smartphone,
    Server,
    Layers
} from 'lucide-react';

const ConnectionModal = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('connection');
    const [connectionType, setConnectionType] = useState('uri');
    const [showPassword, setShowPassword] = useState(false);
    const [copied, setCopied] = useState(null);

    // Connection info - in production this would come from API/config
    const connectionInfo = {
        host: 'localhost',
        port: '5432',
        database: 'ozybase',
        user: 'postgres',
        password: 'yourpassword',
        uri: 'postgresql://postgres:[YOUR-PASSWORD]@localhost:5432/ozybase',
        poolerUri: 'postgresql://postgres.[PROJECT_REF]:[YOUR-PASSWORD]@pooler.ozybase.io:6543/ozybase',
        apiUrl: 'http://localhost:8090',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        serviceKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    };

    const handleCopy = (text, key) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    if (!isOpen) return null;

    const tabs = [
        { id: 'connection', label: 'Connection String', icon: Database },
        { id: 'frameworks', label: 'App Frameworks', icon: Code },
        { id: 'mobile', label: 'Mobile Frameworks', icon: Smartphone },
        { id: 'orms', label: 'ORMs', icon: Layers },
        { id: 'api', label: 'API Keys', icon: Key },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-black text-white uppercase tracking-tight">Connect to your project</h2>
                        <p className="text-xs text-zinc-500 mt-1">Get the connection strings and environment variables for your app.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="px-6 py-3 border-b border-[#2e2e2e] flex gap-1 overflow-x-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap transition-all ${activeTab === tab.id
                                    ? 'bg-primary text-black'
                                    : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                                }`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
                    {activeTab === 'connection' && (
                        <div className="space-y-6">
                            {/* Type Selector */}
                            <div className="flex gap-2 items-center">
                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Type</span>
                                <select
                                    value={connectionType}
                                    onChange={(e) => setConnectionType(e.target.value)}
                                    className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                >
                                    <option value="uri">URI</option>
                                    <option value="params">Parameters</option>
                                    <option value="jdbc">JDBC</option>
                                </select>

                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-4">Source</span>
                                <select className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50">
                                    <option>Primary Database</option>
                                    <option>Read Replica</option>
                                </select>

                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-4">Method</span>
                                <select className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50">
                                    <option>Direct connection</option>
                                    <option>Session pooler</option>
                                    <option>Transaction pooler</option>
                                </select>
                            </div>

                            {/* Direct Connection */}
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-bold text-white">Direct connection</h3>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">Active</span>
                                    </div>
                                    <p className="text-xs text-zinc-500 mb-3">Ideal for applications with persistent and long-lived connections, such as those running on virtual machines or long-standing containers.</p>
                                </div>

                                <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-sm text-zinc-400 flex items-center justify-between group">
                                    <code className="break-all text-xs">{connectionInfo.uri}</code>
                                    <button
                                        onClick={() => handleCopy(connectionInfo.uri, 'uri')}
                                        className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all text-zinc-400 hover:text-white shrink-0"
                                    >
                                        {copied === 'uri' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                    </button>
                                </div>

                                {/* Parameters Table */}
                                <div className="mt-6">
                                    <button className="text-xs font-bold text-zinc-400 hover:text-white transition-colors flex items-center gap-2">
                                        <span>View parameters</span>
                                    </button>

                                    <div className="mt-3 bg-[#111111] rounded-xl border border-[#2e2e2e] overflow-hidden">
                                        <table className="w-full">
                                            <tbody className="divide-y divide-[#2e2e2e]/50 text-xs">
                                                {[
                                                    { label: 'Host', value: connectionInfo.host },
                                                    { label: 'Port', value: connectionInfo.port },
                                                    { label: 'Database', value: connectionInfo.database },
                                                    { label: 'User', value: connectionInfo.user },
                                                ].map((row) => (
                                                    <tr key={row.label} className="hover:bg-zinc-900/30">
                                                        <td className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest w-28">{row.label}</td>
                                                        <td className="px-4 py-3 text-zinc-300 font-mono">{row.value}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                onClick={() => handleCopy(row.value, row.label)}
                                                                className="p-1 text-zinc-600 hover:text-white"
                                                            >
                                                                {copied === row.label ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                                <tr className="hover:bg-zinc-900/30">
                                                    <td className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest">Password</td>
                                                    <td className="px-4 py-3 text-zinc-300 font-mono">
                                                        {showPassword ? connectionInfo.password : '••••••••••••'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right flex gap-1 justify-end">
                                                        <button
                                                            onClick={() => setShowPassword(!showPassword)}
                                                            className="p-1 text-zinc-600 hover:text-white"
                                                        >
                                                            {showPassword ? <Lock size={12} /> : <Key size={12} />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(connectionInfo.password, 'password')}
                                                            className="p-1 text-zinc-600 hover:text-white"
                                                        >
                                                            {copied === 'password' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                        </button>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'api' && (
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-bold text-white mb-1">API URL</h3>
                                    <p className="text-xs text-zinc-500 mb-3">Use this URL to access your OzyBase API endpoints.</p>
                                    <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between">
                                        <code>{connectionInfo.apiUrl}</code>
                                        <button
                                            onClick={() => handleCopy(connectionInfo.apiUrl, 'apiUrl')}
                                            className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all"
                                        >
                                            {copied === 'apiUrl' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-bold text-white mb-1">Anon Key</h3>
                                    <p className="text-xs text-zinc-500 mb-3">This key is safe to use in a browser if you have enabled Row Level Security.</p>
                                    <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between">
                                        <code className="truncate">{connectionInfo.anonKey}</code>
                                        <button
                                            onClick={() => handleCopy(connectionInfo.anonKey, 'anonKey')}
                                            className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all"
                                        >
                                            {copied === 'anonKey' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-bold text-white mb-1">Service Role Key</h3>
                                    <p className="text-xs text-zinc-500 mb-3">This key has full access to your data. Keep it secret and never expose it in client-side code.</p>
                                    <div className="bg-[#111111] p-4 rounded-xl border border-red-500/20 font-mono text-xs text-zinc-400 flex items-center justify-between">
                                        <code className="truncate">{connectionInfo.serviceKey}</code>
                                        <button
                                            onClick={() => handleCopy(connectionInfo.serviceKey, 'serviceKey')}
                                            className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all"
                                        >
                                            {copied === 'serviceKey' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {(activeTab === 'frameworks' || activeTab === 'mobile' || activeTab === 'orms') && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Code size={40} className="text-zinc-700 mb-4" />
                            <h3 className="text-lg font-bold text-zinc-400 mb-2">Coming Soon</h3>
                            <p className="text-xs text-zinc-600">Framework-specific snippets will be available here.</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-[#2e2e2e] bg-[#111111] flex items-center justify-between">
                    <a href="#" className="text-xs text-zinc-500 hover:text-primary transition-colors flex items-center gap-2">
                        <ExternalLink size={12} />
                        Learn how to connect to your Postgres databases
                    </a>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-[#2e2e2e] hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #2e2e2e;
                    border-radius: 10px;
                }
            `}} />
        </div>
    );
};

export default ConnectionModal;
