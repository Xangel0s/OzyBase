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
    CreditCard
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const Layout = ({ children, selectedView, selectedTable, onTableSelect, onMenuViewSelect }) => {
    const [dbStatus, setDbStatus] = useState('Checking...');
    const [tables, setTables] = useState([]);
    const [user, setUser] = useState(null);
    const [isSidebarPinned, setIsSidebarPinned] = useState(false);
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

    useEffect(() => {
        // Status check
        fetchWithAuth('/api/health')
            .then(res => res.json())
            .then(data => setDbStatus(data.database === 'connected' ? 'Connected' : 'Degraded'))
            .catch(() => setDbStatus('Disconnected'));

        // Load tables
        fetchWithAuth('/api/collections')
            .then(res => res.json())
            .then(data => setTables(data))
            .catch(err => console.error("Failed to load tables", err));

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
        { id: 'database', icon: Table2, label: 'Database' },
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
        const currentModule = selectedTable ? 'database' : selectedView;

        if (currentModule === 'database' || selectedView === 'table') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="flex items-center justify-between px-3 mb-4">
                            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">All Collections</h4>
                            <button className="text-zinc-700 hover:text-primary transition-colors"><Plus size={12} /></button>
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
            settings: [
                { id: 'general', name: 'General', icon: Settings },
                { id: 'infrastructure', name: 'Infrastructure', icon: Server },
                { id: 'billing', name: 'Billing', icon: CreditCard },
                { id: 'api_keys', name: 'API Keys', icon: Key }
            ]
        };

        const activeSubmenu = submenus[currentModule] || [
            { id: 'general', name: 'Dashboard', icon: LayoutGrid },
            { id: 'status', name: 'System Status', icon: Activity }
        ];

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div>
                    <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">{currentModule} Management</h4>
                    <div className="space-y-0.5">
                        {activeSubmenu.map((item) => (
                            <button
                                key={item.id}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 transition-all group"
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

                        const isActive = (item.id === 'database' && (selectedView === 'database' || selectedView === 'table')) || (selectedView === item.id);

                        return (
                            <button
                                key={item.id}
                                onClick={() => {
                                    if (item.id === 'database' && tables.length > 0) {
                                        onTableSelect(tables[0].name);
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
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#171717] rounded-full border border-[#2e2e2e]">
                            <div className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'Connected' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">{dbStatus}</span>
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
        </div>
    );
};

export default Layout;
