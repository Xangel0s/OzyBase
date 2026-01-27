import React, { useEffect, useState } from 'react';
import {
    LayoutGrid,
    Table2,
    Code,
    Database,
    Lock,
    FolderOpen,
    Zap,
    Activity,
    FileText,
    ShieldCheck,
    Settings,
    Bell,
    HelpCircle,
    ChevronDown,
    Search,
    BarChart,
    Home,
    Terminal,
    Users,
    Key,
    PanelLeftClose,
    PanelLeftOpen,
    LogOut,
    Plus,
    MousePointer2,
    Lightbulb,
    Telescope,
    List,
    User,
    Pin,
    PinOff,
    Shield,
    Globe,
    Cpu,
    History,
    CreditCard,
    Server,
    Check
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

import CreateTableModal from './CreateTableModal';
import ConnectionModal from './ConnectionModal';

const Layout = ({ children, selectedView, selectedTable, onTableSelect, onMenuViewSelect }) => {
    const [dbStatus, setDbStatus] = useState('Checking...');
    const [tables, setTables] = useState([]);
    const [user, setUser] = useState(null);
    const [isSidebarPinned, setIsSidebarPinned] = useState(false);
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
    const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
    const [schemas, setSchemas] = useState(['public']);
    const [selectedSchema, setSelectedSchema] = useState('public');
    const [isSchemaDropdownOpen, setIsSchemaDropdownOpen] = useState(false);

    const loadTables = () => {
        fetchWithAuth('/api/collections')
            .then(res => res.json())
            .then(data => setTables(data))
            .catch(err => console.error("Failed to load tables", err));
    };

    useEffect(() => {
        // Status check
        fetchWithAuth('/api/health')
            .then(res => res.json())
            .then(data => setDbStatus(data.database === 'connected' ? 'Connected' : 'Degraded'))
            .catch(() => setDbStatus('Disconnected'));

        // Load tables
        loadTables();

        // Load schemas
        fetchWithAuth('/api/collections/schemas')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setSchemas(data);
                } else {
                    setSchemas(['public']);
                }
            })
            .catch(err => {
                console.error("Failed to load schemas", err);
                setSchemas(['public']);
            });

        const storedUser = localStorage.getItem('ozy_user');
        if (storedUser) setUser(JSON.parse(storedUser));
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('ozy_token');
        localStorage.removeItem('ozy_user');
        window.location.reload();
    };

    const primaryNav = [
        { id: 'overview', icon: Home, label: 'Home' },
        { id: 'tables', icon: Table2, label: 'Table Editor' },
        { id: 'database', icon: Database, label: 'Database' },
        { id: 'sql', icon: Terminal, label: 'SQL Editor' },
        { type: 'separator' },
        { id: 'auth', icon: Lock, label: 'Authentication' },
        { id: 'storage', icon: FolderOpen, label: 'Storage' },
        { id: 'edge', icon: Zap, label: 'Edge Functions' },
        { id: 'realtime', icon: MousePointer2, label: 'Realtime' },
        { type: 'separator' },
        { id: 'advisors', icon: Lightbulb, label: 'Advisors' },
        { id: 'observability', icon: Telescope, label: 'Observability' },
        { id: 'logs', icon: List, label: 'Logs' },
        { id: 'docs', icon: FileText, label: 'API Docs' },
        { id: 'integrations', icon: LayoutGrid, label: 'Integrations' },
    ];

    const isExpanded = isSidebarPinned || isSidebarHovered;

    // --- Explorer Sidebar Submodules Content ---
    const renderExplorerContent = () => {
        let currentModule = selectedView;
        if (selectedView === 'table') currentModule = 'tables';
        if (selectedView === 'visualizer') currentModule = 'database';
        if (['intro', 'auth_api', 'db_api', 'storage_api', 'realtime_api', 'edge_api', 'sdk'].includes(selectedView)) currentModule = 'docs';
        if (['wrappers', 'webhooks', 'cron', 'extensions', 'vault', 'graphql'].includes(selectedView)) currentModule = 'integrations';


        if (currentModule === 'sql') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="mb-4 px-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-md group focus-within:border-zinc-500 transition-colors">
                                <Search size={12} className="text-zinc-600 group-focus-within:text-white" />
                                <input
                                    type="text"
                                    placeholder="Search queries..."
                                    className="bg-transparent border-none text-xs text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                />
                                <button className="text-zinc-600 hover:text-white"><Plus size={14} /></button>
                            </div>
                        </div>

                        <div className="space-y-4 px-2">
                            {/* SHARED */}
                            <div>
                                <button className="flex items-center gap-2 px-1 py-1 w-full text-left text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors">
                                    <ChevronDown size={12} className="-rotate-90" /> SHARED
                                </button>
                            </div>

                            {/* FAVORITES */}
                            <div>
                                <button className="flex items-center gap-2 px-1 py-1 w-full text-left text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors">
                                    <ChevronDown size={12} className="-rotate-90" /> FAVORITES
                                </button>
                            </div>

                            {/* PRIVATE */}
                            <div>
                                <button className="flex items-center gap-2 px-1 py-1 w-full text-left text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors mb-2">
                                    <ChevronDown size={12} /> PRIVATE (3)
                                </button>
                                <div className="pl-2 space-y-0.5">
                                    {[
                                        "Normalize scans status...",
                                        "Migrate scans status...",
                                        "User Profiles, Scans..."
                                    ].map((item, i) => (
                                        <button
                                            key={i}
                                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left truncate transition-colors group ${i === 1 ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}
                                        >
                                            <div className="min-w-[14px] h-[14px] rounded border border-zinc-700 flex items-center justify-center bg-[#111111] text-[8px] font-black text-zinc-500 group-hover:border-zinc-500">SQL</div>
                                            <span className="truncate">{item}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* COMMUNITY */}
                            <div>
                                <button className="flex items-center gap-2 px-1 py-1 w-full text-left text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors mb-1">
                                    <ChevronDown size={12} className="-rotate-90" /> COMMUNITY
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="px-3 mt-auto">
                        <button className="w-full py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-500 transition-all">
                            View running queries
                        </button>
                    </div>
                </div>
            );
        }

        if (currentModule === 'tables') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="mb-4 px-2 relative">
                            {/* Schema Selector */}
                            <button
                                onClick={() => setIsSchemaDropdownOpen(!isSchemaDropdownOpen)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-[#171717] border border-[#2e2e2e] hover:border-zinc-500 text-zinc-300 rounded-lg transition-all text-xs font-bold mb-2 group"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="text-zinc-500 font-normal">schema</span>
                                    {selectedSchema}
                                </span>
                                <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isSchemaDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isSchemaDropdownOpen && (
                                <div className="absolute top-full left-2 right-2 z-50 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="p-2 border-b border-[#2e2e2e]">
                                        <div className="flex items-center gap-2 px-2 py-1 bg-[#111111] rounded border border-[#2e2e2e]">
                                            <Search size={12} className="text-zinc-500" />
                                            <input
                                                type="text"
                                                placeholder="Find schema..."
                                                className="bg-transparent border-none text-xs text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                                        {schemas.map(s => (
                                            <button
                                                key={s}
                                                onClick={() => {
                                                    setSelectedSchema(s);
                                                    setIsSchemaDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-1.5 text-xs rounded-md flex items-center justify-between group ${selectedSchema === s ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                                            >
                                                {s}
                                                {selectedSchema === s && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={() => setIsCreateTableModalOpen(true)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#171717] border border-[#2e2e2e] hover:border-zinc-500 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg transition-all text-xs font-bold uppercase tracking-wide group shadow-sm"
                            >
                                <Plus size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                New table
                            </button>
                        </div>

                        <div className="flex items-center justify-between px-3 mb-2">
                            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">All Tables</h4>
                            <button className="text-zinc-700 hover:text-primary transition-colors"><Search size={12} /></button>
                        </div>

                        <div className="space-y-0.5">
                            {tables.map((t) => (
                                <button
                                    key={t.name}
                                    onClick={() => onTableSelect(t.name)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === t.name
                                        ? 'bg-zinc-900 text-primary font-bold border border-[#2e2e2e]/50 shadow-xl'
                                        : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                        }`}
                                >
                                    <Table2 size={14} className={selectedTable === t.name ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                    <span className="truncate">{t.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'database') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="flex items-center justify-between px-3 mb-2 pt-0">
                            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Database Management</h4>
                        </div>

                        <div className="space-y-0.5 mb-4">
                            <button
                                onClick={() => onTableSelect('__visualizer__')}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === '__visualizer__'
                                    ? 'bg-zinc-900 text-primary font-bold border border-[#2e2e2e]/50 shadow-xl'
                                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                    }`}
                            >
                                <LayoutGrid size={14} className={selectedTable === '__visualizer__' ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                <span className="truncate">Schema Visualizer</span>
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        const submenus = {
            auth: [
                { id: 'users', name: 'Users', icon: Users },
                { id: 'providers', name: 'Providers', icon: Key },
                { id: 'policies', name: 'Policies', icon: Shield },
                { id: 'templates', name: 'Email Templates', icon: FileText },
                { id: 'settings', name: 'Auth Settings', icon: Settings }
            ],
            storage: [
                { id: 'buckets', name: 'Buckets', icon: FolderOpen },
                { id: 'policies', name: 'Policies', icon: Shield },
                { id: 'usage', name: 'Usage', icon: Activity },
                { id: 'settings', name: 'Settings', icon: Settings }
            ],
            edge: [
                { id: 'functions', name: 'Functions', icon: Code },
                { id: 'deployments', name: 'Deployments', icon: Zap },
                { id: 'secrets', name: 'Env Variables', icon: Key },
                { id: 'logs', name: 'Edge Logs', icon: List }
            ],
            realtime: [
                { id: 'inspector', name: 'Inspector', icon: Search },
                { id: 'channels', name: 'Channels', icon: Activity },
                { id: 'config', name: 'Configuration', icon: Settings }
            ],
            logs: [
                { id: 'explorer', name: 'Log Explorer', icon: Search },
                { id: 'live', name: 'Live Tail', icon: Activity },
                { id: 'alerts', name: 'Alerts', icon: Bell }
            ],
            docs: [
                { id: 'intro', name: 'Getting Started', icon: Home },
                { id: 'auth_api', name: 'Authentication', icon: Lock },
                { id: 'db_api', name: 'Database & SQL', icon: Database },
                { id: 'storage_api', name: 'Storage', icon: FolderOpen },
                { id: 'realtime_api', name: 'Realtime', icon: MousePointer2 },
                { id: 'edge_api', name: 'Edge Functions', icon: Zap },
                { id: 'sdk', name: 'Client SDKs', icon: Code }
            ],
            settings: [
                { id: 'general', name: 'General', icon: Settings },
                { id: 'infrastructure', name: 'Infrastructure', icon: Server },
                { id: 'billing', name: 'Billing', icon: CreditCard },
                { id: 'api_keys', name: 'API Keys', icon: Key }
            ],
            integrations: [
                { id: 'wrappers', name: 'Wrappers', icon: Globe },
                { id: 'webhooks', name: 'Webhooks', icon: Zap },
                { id: 'cron', name: 'Cron Jobs', icon: History },
                { id: 'extensions', name: 'PG Extensions', icon: Cpu },
                { id: 'vault', name: 'Vault', icon: Shield },
                { id: 'graphql', name: 'GraphQL', icon: Code }
            ]
        };

        const activeSubmenu = submenus[currentModule] || [
            { id: 'general', name: 'Dashboard', icon: LayoutGrid },
            { id: 'status', name: 'System Status', icon: Activity }
        ];

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div>
                    <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                        {currentModule === 'docs' ? 'Documentation' : `${currentModule} Management`}
                    </h4>
                    <div className="space-y-0.5">
                        {activeSubmenu.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => onMenuViewSelect(item.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedView === item.id ? 'bg-zinc-900 text-primary font-bold' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'}`}
                            >
                                <item.icon size={14} className="text-zinc-800 group-hover:text-zinc-500" />
                                <span className="truncate font-medium">{item.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen bg-[#171717] overflow-hidden text-zinc-400 font-sans selection:bg-primary selection:text-black">
            {/* Primary Sidebar (Expandable) */}
            <div
                onMouseEnter={() => setIsSidebarHovered(true)}
                onMouseLeave={() => setIsSidebarHovered(false)}
                className={`bg-[#111111] border-r border-[#2e2e2e] flex flex-col py-4 flex-shrink-0 z-50 transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-14'
                    }`}
            >
                <div className="px-3 mb-8 flex items-center h-8">
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(254,254,0,0.2)] cursor-pointer hover:scale-105 transition-transform shrink-0 overflow-hidden border border-zinc-800"
                        onClick={() => onMenuViewSelect('overview')}
                    >
                        <img src="/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    {isExpanded && (
                        <span className="ml-3 font-black text-white italic tracking-tighter text-xl uppercase animate-in fade-in duration-300 truncate">OzyBase</span>
                    )}
                </div>

                <div className="flex-1 flex flex-col gap-1 w-full overflow-y-auto scrollbar-hide px-2">
                    {primaryNav.map((item, i) => {
                        if (item.type === 'separator') return <div key={i} className="h-[1px] bg-[#2e2e2e] my-2 mx-2 shrink-0" />;

                        const isActive = (item.id === 'tables' && (selectedView === 'tables' || selectedView === 'table')) ||
                            (item.id === 'database' && (selectedView === 'database' || selectedView === 'visualizer')) ||
                            (selectedView === item.id);

                        return (
                            <button
                                key={item.id}
                                onClick={() => {
                                    if (item.id === 'tables' && tables.length > 0) {
                                        onTableSelect(tables[0].name);
                                    } else if (item.id === 'database') {
                                        onTableSelect('__visualizer__');
                                    } else {
                                        onMenuViewSelect(item.id);
                                    }
                                }}
                                className={`flex items-center w-full p-2 rounded-xl transition-all group relative shrink-0 ${isActive ? 'text-primary bg-zinc-800 shadow-lg' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40'
                                    }`}
                            >
                                <div className="w-6 flex justify-center shrink-0">
                                    <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                {isExpanded && (
                                    <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                        {item.label}
                                    </span>
                                )}
                                {isActive && (
                                    <div className="absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-primary rounded-full shadow-[0_0_8px_rgba(254,254,0,0.6)]" />
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-auto flex flex-col gap-1 px-2 border-t border-[#2e2e2e] pt-4 shrink-0">
                    <button
                        onClick={() => onMenuViewSelect('settings')}
                        className={`flex items-center w-full p-2 transition-all rounded-xl ${selectedView === 'settings' ? 'text-primary bg-zinc-800' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'
                            }`}
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            <Settings size={18} />
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">Settings</span>
                        )}
                    </button>

                    <button
                        onClick={() => setIsSidebarPinned(!isSidebarPinned)}
                        className="flex items-center w-full p-2 text-zinc-600 hover:text-zinc-200 transition-colors"
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            {isSidebarPinned ? <Pin size={18} className="text-primary fill-primary/20" /> : <PinOff size={18} />}
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                {isSidebarPinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Explorer Sidebar */}
            <div className={`bg-[#0c0c0c] border-r border-[#2e2e2e] flex flex-col transition-all duration-300 ${selectedView === 'overview' ? 'w-0 border-r-0 overflow-hidden' : 'w-60'
                }`}>
                <div className="h-14 flex items-center px-4 border-b border-[#2e2e2e] flex-shrink-0">
                    <span className="font-black text-[10px] uppercase tracking-[0.25em] text-zinc-500 truncate">
                        Explorer
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
                    {renderExplorerContent()}
                </div>

                <div className="p-4 border-t border-[#2e2e2e]">
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-600 hover:text-red-500 transition-all rounded-xl hover:bg-red-500/5"
                    >
                        <LogOut size={14} />
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#0c0c0c]">
                <header className="h-14 border-b border-[#2e2e2e] bg-[#111111] flex items-center justify-between px-6 flex-shrink-0">
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-tight">
                        <span className="text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors uppercase tracking-[0.1em]">OzyBase</span>
                        <span className="text-zinc-800 text-lg font-thin">/</span>
                        <span className="text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors uppercase tracking-[0.1em]">Production</span>
                        <span className="text-zinc-800 text-lg font-thin">/</span>
                        <span className="bg-zinc-900 text-primary border border-primary/20 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest shadow-[0_0_10px_rgba(254,254,0,0.05)]">
                            {selectedTable || selectedView}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div
                            onClick={() => setIsConnectionModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1 bg-[#171717] rounded-full border border-[#2e2e2e] cursor-pointer hover:border-zinc-500 transition-all group"
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'Connected' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
                            <span className="text-[9px] font-black text-zinc-500 group-hover:text-zinc-300 uppercase tracking-[0.2em] transition-colors">{dbStatus}</span>
                        </div>

                        <div className="h-4 w-[1px] bg-[#2e2e2e] mx-1" />

                        <div
                            className="w-8 h-8 rounded-lg bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center text-primary text-[10px] font-black cursor-pointer hover:border-primary/50 transition-all"
                            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                        >
                            {user?.email?.charAt(0).toUpperCase() || 'A'}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-hidden relative">
                    {children}
                </main>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                    height: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #2e2e2e;
                    border-radius: 10px;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}} />

            <CreateTableModal
                isOpen={isCreateTableModalOpen}
                onClose={() => setIsCreateTableModalOpen(false)}
                schema={selectedSchema}
                onTableCreated={() => {
                    loadTables();
                }}
            />

            <ConnectionModal
                isOpen={isConnectionModalOpen}
                onClose={() => setIsConnectionModalOpen(false)}
            />
        </div>
    );
};

export default Layout;
