import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    ChevronDown, 
    Plus, 
    LayoutGrid, 
    Check, 
    Settings, 
    Briefcase, 
    Search,
    Globe,
    Lock,
    Users,
    Building2,
    Command
} from 'lucide-react';
import { fetchWithAuth, isAbortLikeError } from '../utils/api';

interface Workspace {
    id: string;
    name: string;
    slug: string;
}

interface WorkspaceSwitcherProps {
    onWorkspaceChange?: (workspaceID: string | null) => void;
    onViewSelect?: (view: string) => void;
    isExpanded?: boolean;
    workspaceId?: string | null;
    onOpenStateChange?: (isOpen: boolean) => void;
}

const normalizeWorkspaceId = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : null;
};

const WorkspaceSwitcher = ({ onWorkspaceChange, onViewSelect, isExpanded = false, workspaceId = null, onOpenStateChange }: WorkspaceSwitcherProps) => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const fetchWorkspaces = React.useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetchWithAuth('/api/workspaces', { signal });
            if (signal?.aborted) {
                return;
            }
            if (res.ok) {
                const data: unknown = await res.json();
                if (signal?.aborted) {
                    return;
                }
                const workspaceData = Array.isArray(data) ? (data as Workspace[]) : [];
                setWorkspaces(workspaceData);
                
                const storedId = normalizeWorkspaceId(workspaceId) || normalizeWorkspaceId(localStorage.getItem('ozy_workspace_id'));
                const active = workspaceData.find((w: any) => normalizeWorkspaceId(w.id) === storedId) || workspaceData[0] || null;
                
                if (active) {
                    setActiveWorkspace(active);
                    const activeId = normalizeWorkspaceId(active.id);
                    if (activeId && storedId !== activeId) {
                        localStorage.setItem('ozy_workspace_id', activeId);
                    }
                    if (activeId && normalizeWorkspaceId(workspaceId) !== activeId) {
                        onWorkspaceChange?.(activeId);
                    }
                } else {
                    setActiveWorkspace(null);
                    localStorage.removeItem('ozy_workspace_id');
                    if (normalizeWorkspaceId(workspaceId) !== null) {
                        onWorkspaceChange?.(null);
                    }
                }
            }
        } catch (err) {
            if (isAbortLikeError(err, signal)) {
                return;
            }
            console.error("Failed to load workspaces", err);
        }
    }, [onWorkspaceChange, workspaceId]);

    useEffect(() => {
        const requestController = new AbortController();
        void fetchWorkspaces(requestController.signal);
        
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
                onOpenStateChange?.(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            requestController.abort();
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [fetchWorkspaces]);

    useEffect(() => {
        if (workspaces.length === 0) {
            setActiveWorkspace(null);
            return;
        }

        const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
        if (!normalizedWorkspaceId) {
            const storedId = normalizeWorkspaceId(localStorage.getItem('ozy_workspace_id'));
            if (storedId) {
                const storedWorkspace = workspaces.find((workspace: Workspace) => normalizeWorkspaceId(workspace.id) === storedId) || null;
                if (storedWorkspace) {
                    setActiveWorkspace(storedWorkspace);
                    return;
                }
                localStorage.removeItem('ozy_workspace_id');
            }
            setActiveWorkspace(null);
            return;
        }

        const nextActive = workspaces.find((workspace: Workspace) => normalizeWorkspaceId(workspace.id) === normalizedWorkspaceId) || null;
        setActiveWorkspace(nextActive);
    }, [workspaceId, workspaces]);

    const handleSelect = (workspace: Workspace) => {
        setActiveWorkspace(workspace);
        localStorage.setItem('ozy_workspace_id', String(workspace.id));
        setIsOpen(false);
        onOpenStateChange?.(false);
        if (onWorkspaceChange) onWorkspaceChange(workspace.id);
    };

    const filteredWorkspaces = useMemo(() => {
        return workspaces.filter((w: any) => 
            w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            w.slug.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [workspaces, searchQuery]);

    const getWorkspaceIcon = (name: string) => {
        const firstChar = name.charAt(0).toUpperCase();
        const colors = [
            'bg-emerald-500/20 text-emerald-500 border-emerald-500/30',
            'bg-blue-500/20 text-blue-500 border-blue-500/30',
            'bg-purple-500/20 text-purple-500 border-purple-500/30',
            'bg-amber-500/20 text-amber-500 border-amber-500/30',
            'bg-rose-500/20 text-rose-500 border-rose-500/30'
        ];
        const colorIdx = (name.length % colors.length);
        return { char: firstChar, style: colors[colorIdx] };
    };

    return (
        <div className={`relative w-full transition-all duration-300 ${isExpanded ? 'px-4 mb-6' : 'px-1 mb-4'}`} ref={dropdownRef}>
            <div 
                data-testid="workspace-switcher-toggle"
                role="button"
                aria-label="Open project switcher"
                onClick={() => {
                    const next = !isOpen;
                    setIsOpen(next);
                    onOpenStateChange?.(next);
                }}
                className={`group relative flex items-center transition-all cursor-pointer select-none ${
                    isExpanded 
                    ? `gap-4 p-3 rounded-md bg-background border hover:border-primary/30 hover:bg-background ${isOpen ? 'ring-2 ring-primary/20 border-primary/50 bg-background' : 'border-border'}`
                    : `justify-center p-2 rounded-md bg-transparent hover:bg-zinc-800/40 border border-transparent ${isOpen ? 'bg-zinc-800/60 border-primary/30' : ''}`
                }`}
            >
                {/* Icon Container */}
                <div className={`rounded-md flex items-center justify-center transition-all shrink-0 ${
                    isExpanded 
                    ? `w-12 h-12 ${activeWorkspace ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-[#131313] border border-border text-zinc-500'}`
                    : `w-9 h-9 ${activeWorkspace ? 'bg-primary/20 border border-primary/30 text-primary' : 'bg-zinc-900 border border-zinc-800 text-zinc-600'}`
                }`}>
                    {activeWorkspace ? (
                        <span className={`${isExpanded ? 'text-sm' : 'text-[10px]'} font-medium`}>{activeWorkspace.name.charAt(0)}</span>
                    ) : (
                        <Briefcase size={isExpanded ? 20 : 16} />
                    )}
                </div>

                {/* Content - Hidden when collapsed */}
                {isExpanded && (
                    <div className="flex-1 min-w-0 animate-in fade-in slide-in-from-left-2 duration-300">
                        <h3 className="text-[10px] font-bold text-white uppercase tracking-[0.2em] leading-none mb-1.5 flex items-center gap-2">
                            {isOpen ? 'Browse Projects' : activeWorkspace ? 'Active Project' : 'Choose Project'}
                        </h3>
                        <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                            <Globe size={12} className="text-primary/50" />
                            <span className="text-[11px] font-bold uppercase tracking-widest truncate">
                                {activeWorkspace?.name || 'OZYBASE'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Shortcut Hint - Hidden when collapsed */}
                {isExpanded && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-background border border-border text-[10px] font-bold text-zinc-600 shadow-inner animate-in fade-in zoom-in-95 duration-300">
                        <Command size={10} />
                        <span>K</span>
                    </div>
                )}

                {/* Subtle Glow */}
                {isExpanded && (
                    <div className={`absolute inset-x-0 -bottom-px h-px bg-linear-to-r from-transparent via-primary/20 to-transparent transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                )}
            </div>

            {isOpen && (
                <div className={`absolute ${isExpanded ? 'top-[calc(100%+8px)] left-2 right-2' : 'top-0 left-[calc(100%+12px)] w-64'} z-200 overflow-hidden backdrop-blur-xl ozy-floating-panel`}>
                    {/* Search Bar */}
                    <div className="p-3 border-b border-border bg-background/50">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search projects..."
                                value={searchQuery}
                                onChange={(e: any) => setSearchQuery(e.target.value)}
                                className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-md pl-9 pr-4 py-2 text-[10px] font-bold text-white placeholder-zinc-600 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                            />
                        </div>
                    </div>

                    {/* Workspace List */}
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                        <h3 className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] px-3 py-2">Your Projects</h3>
                        
                        {filteredWorkspaces.length === 0 ? (
                            <div className="py-8 px-4 text-center">
                                <p className="text-[10px] font-bold text-zinc-600 uppercase">No projects found</p>
                            </div>
                        ) : (
                            filteredWorkspaces.map((w: any) => (
                                <button
                                    key={w.id}
                                    onClick={() => handleSelect(w)}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-md transition-all group ${activeWorkspace?.id === w.id ? 'bg-primary/5 border border-primary/20' : 'hover:bg-zinc-900 border border-transparent'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold border transition-transform group-hover:scale-110 ${getWorkspaceIcon(w.name).style}`}>
                                            {getWorkspaceIcon(w.name).char}
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <span className={`text-[11px] font-bold leading-tight ${activeWorkspace?.id === w.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{w.name}</span>
                                            <span className="text-[8px] text-zinc-600 uppercase font-bold tracking-widest">{w.slug}</span>
                                        </div>
                                    </div>
                                    {activeWorkspace?.id === w.id && (
                                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                            <Check size={10} className="text-black" />
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-2 border-t border-border bg-background">
                        <button 
                            onClick={() => {
                                setIsOpen(false);
                                onOpenStateChange?.(false);
                                if (activeWorkspace) {
                                    localStorage.setItem('ozy_workspace_id', activeWorkspace.id);
                                    onWorkspaceChange?.(activeWorkspace.id);
                                }
                                if (onViewSelect) onViewSelect('workspace_settings');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-[10px] font-bold text-zinc-500 hover:text-white hover:bg-zinc-900/50 rounded-md transition-all uppercase tracking-widest group"
                        >
                            <Settings size={14} className="group-hover:rotate-45 transition-transform" />
                            Project Settings
                        </button>
                        <button 
                            onClick={() => {
                                setIsOpen(false);
                                onOpenStateChange?.(false);
                                if (onViewSelect) onViewSelect('workspaces');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-[10px] font-bold text-zinc-500 hover:text-white hover:bg-zinc-900/50 rounded-md transition-all uppercase tracking-widest group"
                        >
                            <LayoutGrid size={14} className="group-hover:scale-110 transition-transform" />
                            Project Directory
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspaceSwitcher;


