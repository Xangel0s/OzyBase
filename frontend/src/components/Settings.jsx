import React, { useState } from 'react';
import {
    Settings as SettingsIcon,
    Shield,
    Key,
    Database,
    Lock,
    FolderOpen,
    Zap,
    CreditCard,
    Activity,
    Globe,
    ExternalLink,
    Copy,
    RefreshCw,
    Pause,
    Play,
    Trash2,
    Info
} from 'lucide-react';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('general');
    const [projectName, setProjectName] = useState('vlaberapp');
    const projectId = 'elicsuhhgyfukbdfaiun';

    const menuSections = [
        {
            title: 'PROJECT SETTINGS',
            items: [
                { id: 'general', name: 'General', icon: SettingsIcon },
                { id: 'compute', name: 'Compute and Disk', icon: Database },
                { id: 'infrastructure', name: 'Infrastructure', icon: Shield },
                { id: 'integrations', name: 'Integrations', icon: Zap },
                { id: 'data-api', name: 'Data API', icon: Globe },
                { id: 'api-keys', name: 'API Keys', icon: Key },
                { id: 'jwt-keys', name: 'JWT Keys', icon: Lock },
                { id: 'log-drains', name: 'Log Drains', icon: Activity },
                { id: 'add-ons', name: 'Add Ons', icon: Globe },
                { id: 'vault', name: 'Vault', icon: Lock, beta: true },
            ]
        },
        {
            title: 'CONFIGURATION',
            items: [
                { id: 'db-config', name: 'Database', icon: Database, external: true },
                { id: 'auth-config', name: 'Authentication', icon: Lock, external: true },
                { id: 'storage-config', name: 'Storage', icon: FolderOpen, external: true },
                { id: 'edge-config', name: 'Edge Functions', icon: Zap, external: true },
            ]
        },
        {
            title: 'BILLING',
            items: [
                { id: 'subscription', name: 'Subscription', icon: CreditCard, external: true },
                { id: 'usage', name: 'Usage', icon: Activity, external: true },
            ]
        }
    ];

    const renderGeneral = () => (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Project Settings</h2>
                <p className="text-zinc-500 text-sm font-medium">Configure general options, domains, transfers, and project lifecycle.</p>
            </div>

            {/* General Settings Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-8">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-primary pl-4">General settings</h3>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <div>
                                <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">Project name</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Displayed throughout the dashboard.</p>
                            </div>
                            <div className="md:col-span-2">
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 transition-all font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <div>
                                <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">Project ID</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Reference used in APIs and URLs.</p>
                            </div>
                            <div className="md:col-span-2 flex gap-3">
                                <input
                                    type="text"
                                    readOnly
                                    value={projectId}
                                    className="flex-1 bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-500 focus:outline-none font-mono"
                                />
                                <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-3 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                    <Copy size={14} />
                                    Copy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="px-8 py-4 bg-[#111111]/50 border-t border-[#2e2e2e] flex justify-end">
                    <button className="bg-primary hover:bg-[#E6E600] text-black px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                        Save changes
                    </button>
                </div>
            </div>

            {/* Project Availability Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-8">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-primary pl-4">Project availability</h3>
                    <p className="text-[11px] text-zinc-600 uppercase font-black tracking-widest -mt-4">Restart or pause your project when performing maintenance.</p>

                    <div className="space-y-8">
                        <div className="flex items-center justify-between p-6 bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl">
                            <div>
                                <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">Restart project</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Your project will not be available for a few minutes.</p>
                            </div>
                            <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <RefreshCw size={14} />
                                Restart project
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-6 bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl">
                            <div>
                                <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">Pause project</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Your project will not be accessible while it is paused.</p>
                            </div>
                            <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <Pause size={14} />
                                Pause project
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Project Usage Warning */}
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-8 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <div className="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center text-zinc-500">
                        <Activity size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-black text-white uppercase tracking-widest">Project usage statistics have been moved</p>
                        <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">You may view your project's usage under your organization's settings</p>
                    </div>
                </div>
                <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest">
                    View project usage
                </button>
            </div>

            {/* Custom Domains Hero */}
            <div className="pt-8">
                <h2 className="text-xl font-black text-white italic tracking-tighter uppercase mb-2">Custom Domains</h2>
                <div className="bg-[#171717] border-2 border-dashed border-[#2e2e2e] rounded-3xl p-12 flex flex-col items-center justify-center text-center">
                    <Globe size={48} className="text-zinc-800 mb-6" />
                    <p className="text-sm font-bold text-zinc-400 mb-2">Set up a custom domain for your project</p>
                    <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest max-w-sm mb-8">Establish a professional presence with your own domain name on the OzyBase edge network.</p>
                    <button className="bg-primary text-black px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                        Configure Custom Domain
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">
            {/* Sidebar Navigation */}
            <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col flex-shrink-0">
                <div className="px-6 py-6 font-black text-white italic uppercase italic tracking-tighter text-lg border-b border-[#2e2e2e]">
                    Settings
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-8 py-8">
                    {menuSections.map((sec, idx) => (
                        <div key={idx}>
                            <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">{sec.title}</h4>
                            <div className="space-y-1">
                                {sec.items.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => !item.external && setActiveTab(item.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all group ${activeTab === item.id
                                                ? 'bg-zinc-900 border border-zinc-800 text-primary font-bold'
                                                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon size={14} className={activeTab === item.id ? 'text-primary' : 'text-zinc-700 group-hover:text-zinc-400'} />
                                            <span className="tracking-tight">{item.name}</span>
                                        </div>
                                        {item.beta && (
                                            <span className="bg-primary/10 text-primary border border-primary/20 text-[8px] font-black uppercase px-1.5 py-0.5 rounded leading-none">Beta</span>
                                        )}
                                        {item.external && (
                                            <ArrowUpRight size={10} className="text-zinc-800" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#111111]">
                <div className="max-w-4xl mx-auto py-12 px-12">
                    {activeTab === 'general' ? renderGeneral() : (
                        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                            <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center text-zinc-800 mb-6">
                                <SettingsIcon size={40} className="animate-spin-slow" />
                            </div>
                            <h3 className="text-xl font-black text-zinc-600 italic tracking-tighter uppercase mb-2">Module Under Construction</h3>
                            <p className="text-xs text-zinc-700 font-bold uppercase tracking-widest max-w-xs leading-relaxed">
                                This settings sub-module is being provisioned across our global edge network.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .animate-spin-slow {
                    animation: spin 8s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
};

const ArrowUpRight = ({ size, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M7 17l10-10" /><path d="M7 7h10v10" />
    </svg>
);

export default Settings;
