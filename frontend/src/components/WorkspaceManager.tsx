import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    Plus, 
    Search, 
    Users, 
    Settings, 
    Briefcase,
    Globe,
    Shield,
    ArrowRight,
    Layers,
    Clock3,
    Sparkles
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModulePageHero from './ModulePageHero';
import ModuleScrollContainer from './ModuleScrollContainer';
import ModuleSegmentedNav from './ModuleSegmentedNav';

const WORKSPACE_MANAGER_TABS = [
    { id: 'wm_overview', label: 'My Projects', hint: 'Create, search, and open your main projects.' },
    { id: 'wm_shared', label: 'Shared With Me', hint: 'Projects where you collaborate but are not the owner.' },
    { id: 'wm_templates', label: 'Quick Seeds', hint: 'Start from a naming seed instead of a blank title.' },
] as const;

const WorkspaceManager = ({ onWorkspaceChange, onViewSelect, view = 'wm_overview' }: any) => {
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [workspaceMembers, setWorkspaceMembers] = useState<Record<string, any>>({});

    const currentUserEmail = useMemo(() => {
        const raw = localStorage.getItem('ozy_user');
        if (!raw) return '';
        try {
            const parsed = JSON.parse(raw);
            return String(parsed?.email || '').toLowerCase();
        } catch {
            return '';
        }
    }, []);

    const fetchWorkspaces = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/workspaces');
            if (res.ok) {
                const data = await res.json();
                const workspaceList = Array.isArray(data) ? data : [];
                setWorkspaces(workspaceList);

                const storedWorkspaceId = String(localStorage.getItem('ozy_workspace_id') || '').trim();
                if (workspaceList.length === 0) {
                    localStorage.removeItem('ozy_workspace_id');
                    onWorkspaceChange?.(null);
                    return;
                }

                const activeWorkspace = workspaceList.find((workspace: any) => String(workspace?.id || '') === storedWorkspaceId) || workspaceList[0];
                const activeWorkspaceId = String(activeWorkspace?.id || '').trim();
                if (activeWorkspaceId && activeWorkspaceId !== storedWorkspaceId) {
                    localStorage.setItem('ozy_workspace_id', activeWorkspaceId);
                    onWorkspaceChange?.(activeWorkspaceId);
                }
            }
        } catch (err) {
            console.error("Failed to fetch workspaces", err);
        } finally {
            setLoading(false);
        }
    }, [onWorkspaceChange]);

    const fetchMembersForWorkspaces = useCallback(async (items: any) => {
        if (!Array.isArray(items) || items.length === 0) {
            setWorkspaceMembers({});
            return;
        }

        const memberEntries = await Promise.all(
            items.map(async (workspace: any) => {
                try {
                    const res = await fetchWithAuth(`/api/workspaces/${workspace.id}/members`);
                    if (!res.ok) return [workspace.id, []];
                    const data = await res.json();
                    return [workspace.id, Array.isArray(data) ? data : []];
                } catch {
                    return [workspace.id, []];
                }
            })
        );

        setWorkspaceMembers(Object.fromEntries(memberEntries));
    }, []);

    useEffect(() => {
        fetchWorkspaces();
    }, [fetchWorkspaces]);

    useEffect(() => {
        fetchMembersForWorkspaces(workspaces);
    }, [workspaces, fetchMembersForWorkspaces]);

    const createWorkspace = useCallback(async (nameToUse: any) => {
        const normalized = String(nameToUse || '').trim();
        if (!normalized) return null;
        try {
            const res = await fetchWithAuth('/api/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: normalized })
            });
            if (res.ok) {
                const createdWorkspace = await res.json();
                setNewWorkspaceName('');
                setShowCreateModal(false);
                await fetchWorkspaces();
                if (createdWorkspace?.id) {
                    const createdWorkspaceId = String(createdWorkspace.id);
                    localStorage.setItem('ozy_workspace_id', createdWorkspaceId);
                    onWorkspaceChange?.(createdWorkspaceId);
                    onViewSelect?.('workspace_settings');
                }
                return createdWorkspace;
            }
        } catch (err) {
            console.error("Failed to create workspace", err);
        }
        return null;
    }, [fetchWorkspaces, onViewSelect, onWorkspaceChange]);

    const handleCreate = useCallback(async () => {
        await createWorkspace(newWorkspaceName);
    }, [createWorkspace, newWorkspaceName]);

    const handleSelect = (workspace: any) => {
        const nextWorkspaceId = String(workspace.id);
        localStorage.setItem('ozy_workspace_id', nextWorkspaceId);
        if (onWorkspaceChange) onWorkspaceChange(nextWorkspaceId);
        if (onViewSelect) onViewSelect('overview');
    };

    const getWorkspaceIcon = (name: any) => {
        const firstChar = name.charAt(0).toUpperCase();
        const colors = [
            'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
            'bg-blue-500/10 text-blue-500 border-blue-500/20',
            'bg-purple-500/10 text-purple-500 border-purple-500/20',
            'bg-amber-500/10 text-amber-500 border-amber-500/20',
            'bg-rose-500/10 text-rose-500 border-rose-500/20'
        ];
        const colorIdx = (name.length % colors.length);
        return { char: firstChar, style: colors[colorIdx] };
    };

    const filteredWorkspaces = workspaces.filter((w: any) => 
        String(w.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(w.slug || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const enrichedWorkspaces = useMemo(() => {
        return filteredWorkspaces.map((workspace: any) => {
            const members = workspaceMembers[workspace.id] || [];
            const currentMembership = members.find((member: any) => {
                return String(member?.email || '').toLowerCase() === currentUserEmail;
            });

            return {
                ...workspace,
                members,
                currentRole: currentMembership?.role || 'owner',
                memberCount: members.length || 1
            };
        });
    }, [filteredWorkspaces, workspaceMembers, currentUserEmail]);

    const sharedWorkspaces = useMemo(() => {
        return enrichedWorkspaces.filter((workspace: any) => workspace.currentRole !== 'owner');
    }, [enrichedWorkspaces]);

    const overviewStats = useMemo(() => {
        const recent = [...enrichedWorkspaces]
            .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
        return {
            total: enrichedWorkspaces.length,
            shared: sharedWorkspaces.length,
            recentName: recent?.name || 'No projects yet'
        };
    }, [enrichedWorkspaces, sharedWorkspaces.length]);

    const templates = useMemo(() => ([
        {
            id: 'saas',
            name: 'SaaS Starter',
            hint: 'Naming seed for a SaaS-oriented project',
            quickSeed: 'SaaS Project'
        },
        {
            id: 'ecommerce',
            name: 'E-commerce',
            hint: 'Naming seed for catalog and order workloads',
            quickSeed: 'Commerce Project'
        },
        {
            id: 'internal',
            name: 'Internal Tool',
            hint: 'Naming seed for ops and automation projects',
            quickSeed: 'Ops Project'
        }
    ]), []);

    const createFromTemplate = async (template: any) => {
        await createWorkspace(`${template.quickSeed} ${new Date().getFullYear()}`);
    };

    return (
        <ModuleScrollContainer width="7xl" innerClassName="animate-in fade-in duration-500 pb-16">
            <div className="space-y-6">
                <ModulePageHero
                    eyebrow="Projects"
                    title="Projects"
                    description="Create project spaces for teams, API keys, collections metadata, and dashboard context. In self-hosted mode a project is a logical scope on the shared runtime, not a new PostgreSQL database."
                    icon={Briefcase}
                    pills={[
                        { label: `${overviewStats.total} total projects`, tone: 'accent' },
                        { label: `${overviewStats.shared} shared with you`, tone: sharedWorkspaces.length > 0 ? 'success' : 'neutral' },
                        { label: 'project-aware routing', tone: 'neutral' },
                    ]}
                    stats={[
                        {
                            label: 'Latest Project',
                            value: overviewStats.recentName,
                            hint: 'Recently created spaces appear here first while the switcher keeps quick access in the sidebar.',
                        },
                        {
                            label: 'Primary Use',
                            value: 'Team + metadata scope',
                            hint: 'Use projects to separate memberships, API keys, collection metadata, and admin context by active project.',
                        },
                        {
                            label: 'First Step',
                            value: 'Create or select a project',
                            hint: 'Once selected, compatible dashboard resources follow the active project through the X-Workspace-Id context.',
                        },
                    ]}
                    actions={
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-primary text-black font-medium text-xs tracking-widest rounded-md hover:scale-105 transition-transform shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)]"
                        >
                            <Plus size={18} strokeWidth={3} />
                            New Project
                        </button>
                    }
                />

                <ModuleSegmentedNav
                    items={WORKSPACE_MANAGER_TABS}
                    activeId={view}
                    onSelect={(nextView) => onViewSelect?.(nextView)}
                />

                {/* View Content */}
                {view === 'wm_overview' && (
                <>
                    {/* Search and Filters */}
                    <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-background border border-border rounded-md p-4">
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.18em] mb-2">Total Projects</p>
                            <div className="flex items-center gap-2">
                                <Layers size={14} className="text-primary" />
                                <span className="text-xl font-bold text-white">{overviewStats.total}</span>
                            </div>
                        </div>
                        <div className="bg-background border border-border rounded-md p-4">
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.18em] mb-2">Shared Access</p>
                            <div className="flex items-center gap-2">
                                <Users size={14} className="text-blue-500" />
                                <span className="text-xl font-bold text-white">{overviewStats.shared}</span>
                            </div>
                        </div>
                        <div className="bg-background border border-border rounded-md p-4">
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.18em] mb-2">Last Created</p>
                            <div className="flex items-center gap-2">
                                <Clock3 size={14} className="text-amber-500" />
                                <span className="text-sm font-bold text-white truncate">{overviewStats.recentName}</span>
                            </div>
                        </div>
                    </div>
                    <div className="relative max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                        <input
                            type="text"
                            placeholder="Search your projects..."
                            value={searchQuery}
                            onChange={(e: any) => setSearchQuery(e.target.value)}
                            className="w-full bg-background border border-border rounded-md pl-12 pr-4 py-3.5 text-sm font-bold text-white placeholder-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                        />
                    </div>
                    <div className="mt-6 rounded-4xl border border-primary/15 bg-[linear-gradient(180deg,rgba(34,34,10,0.18),rgba(10,10,10,0.96))] p-5">
                        <p className="text-[10px] font-medium] text-primary">Current Isolation Scope</p>
                        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                            Projects currently scope <span className="text-white">memberships, collection metadata, API keys, saved views, and admin audit context</span>.
                            In self-hosted mode they do not provision another PostgreSQL database or dedicated schema automatically.
                        </p>
                    </div>
                    </div>

                    {/* Grid of Projects */}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center gap-4 rounded-4xl border border-zinc-800 bg-background py-20">
                            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em]">Synching Projects...</span>
                        </div>
                    ) : filteredWorkspaces.length === 0 ? (
                        <div className="flex flex-col items-center justify-center bg-background border border-dashed border-border rounded-md p-20 text-center">
                            <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
                                <Briefcase size={40} className="text-zinc-700" />
                            </div>
                            <h2 className="text-2xl font-bold text-white uppercase tracking-tighter mb-2">No projects found</h2>
                            <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest mb-8 max-w-xs">
                                Start by creating your first scoped project to manage membership and dashboard context.
                            </p>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="px-8 py-3 bg-white text-black font-medium text-xs tracking-[0.2em] rounded-md hover:bg-zinc-200 transition-colors"
                            >
                                Create Project
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {enrichedWorkspaces.map((w: any) => {
                                const icon = getWorkspaceIcon(w.name);
                                return (
                                    <div
                                        key={w.id}
                                        className="group relative bg-background border border-border rounded-md p-6 hover:border-primary/50 hover:bg-[#0d0d0d] transition-all cursor-pointer overflow-hidden shadow-2xl"
                                        onClick={() => handleSelect(w)}
                                    >
                                        {/* Decorative elements */}
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[80px] group-hover:bg-primary/10 transition-colors" />

                                        <div className="flex items-start justify-between mb-6 relative z-10">
                                            <div className={`w-12 h-12 rounded-md flex items-center justify-center text-lg font-bold border group-hover:scale-110 transition-transform duration-500 ${icon.style}`}>
                                                {icon.char}
                                            </div>
                                            <button
                                                className="p-2 text-zinc-600 hover:text-white transition-colors"
                                                onClick={(e: any) => {
                                                    e.stopPropagation();
                                                    const nextWorkspaceId = String(w.id);
                                                    localStorage.setItem('ozy_workspace_id', nextWorkspaceId);
                                                    if (onWorkspaceChange) onWorkspaceChange(nextWorkspaceId);
                                                    if (onViewSelect) onViewSelect('workspace_settings');
                                                }}
                                            >
                                                <Settings size={18} />
                                            </button>
                                        </div>

                                        <div className="relative z-10">
                                            <h3 className="text-xl font-bold text-white tracking-tight mb-1 group-hover:text-primary transition-colors">{w.name}</h3>
                                            <div className="flex items-center gap-2 mb-6">
                                                <Globe size={12} className="text-zinc-600" />
                                                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{w.slug}</span>
                                            </div>

                                            <div className="flex items-center gap-4 border-t border-zinc-900 pt-6">
                                                <div className="flex items-center gap-1.5">
                                                    <Users size={12} className="text-zinc-500" />
                                                    <span className="text-[10px] font-bold text-zinc-400">{w.memberCount} member{w.memberCount > 1 ? 's' : ''}</span>
                                                </div>
                                                <div className="w-px h-3 bg-zinc-800" />
                                                <div className="flex items-center gap-1.5">
                                                    <Shield size={12} className="text-zinc-500" />
                                                    <span className="text-[10px] font-bold text-zinc-400">{w.currentRole}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                            <ArrowRight size={20} className="text-primary" />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
                )}

                {view === 'wm_shared' && (
                    <>
                        {sharedWorkspaces.length === 0 ? (
                            <div className="flex flex-col items-center justify-center bg-background border border-dashed border-border rounded-md p-20 text-center animate-in fade-in duration-500">
                                <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
                                    <Users size={40} className="text-zinc-700" />
                                </div>
                                <h2 className="text-2xl font-bold text-white uppercase tracking-tighter mb-2">No Shared Projects</h2>
                                <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest mb-8 max-w-xs">
                                    Shared projects will appear here with your role and member scope.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in fade-in duration-500">
                                {sharedWorkspaces.map((workspace: any) => (
                                    <button
                                        key={workspace.id}
                                        onClick={() => handleSelect(workspace)}
                                        className="w-full bg-background border border-border rounded-md p-5 text-left hover:border-primary/40 transition-all group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-lg font-bold text-white group-hover:text-primary transition-colors">{workspace.name}</p>
                                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
                                                    Role: {workspace.currentRole} - {workspace.memberCount} member{workspace.memberCount > 1 ? 's' : ''}
                                                </p>
                                            </div>
                                            <ArrowRight size={18} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {view === 'wm_templates' && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        <div className="rounded-4xl border border-border bg-background p-5">
                            <p className="text-[10px] font-medium] text-zinc-500">Quick Seeds</p>
                            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                                These cards create a normal blank project with a helpful name seed. Full project scaffolds and data templates are still pending.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                            {templates.map((template: any) => (
                                <div key={template.id} className="group bg-background border border-border rounded-md p-6 hover:border-primary/50 transition-all">
                                    <div className="h-32 bg-zinc-900 rounded-md mb-6 flex items-center justify-center">
                                        <span className="text-4xl font-bold text-zinc-800 group-hover:text-zinc-700 transition-colors">{template.name.charAt(0)}</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-white uppercase tracking-tight mb-2">{template.name}</h3>
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-4 min-h-[32px]">
                                        {template.hint}
                                    </p>
                                    <button
                                        onClick={() => createFromTemplate(template)}
                                        className="w-full py-3 bg-[#131313] text-zinc-400 font-medium text-xs tracking-widest rounded-md group-hover:bg-primary group-hover:text-black transition-all flex items-center justify-center gap-2"
                                    >
                                        <Sparkles size={14} />
                                        Use Quick Seed
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Create Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 z-1000 flex items-center justify-center p-6">
                        <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setShowCreateModal(false)} />
                        <div className="ozy-dialog-panel max-w-md w-full p-8">
                            <h2 className="text-2xl font-bold text-white italic uppercase tracking-tighter mb-2">Initialize New Project</h2>
                            <p className="text-zinc-500 text-[10px] font-medium mb-8">Project scope creation</p>

                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2 block">Project Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={newWorkspaceName}
                                        onChange={(e: any) => setNewWorkspaceName(e.target.value)}
                                        placeholder="Enter project name..."
                                        className="w-full bg-background border border-border rounded-md px-4 py-3 text-white font-bold focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                                    />
                                </div>

                                <div className="bg-primary/5 border border-primary/20 rounded-md p-4">
                                    <p className="text-[9px] text-primary font-medium leading-relaxed tracking-wider">
                                        New projects create the logical project record, owner membership, and project-scoped dashboard context. Physical tables, buckets, schemas, and database topology remain shared/manual in self-hosted mode.
                                    </p>
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 px-6 py-3 bg-[#131313] text-zinc-400 font-medium text-xs tracking-widest rounded-md hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleCreate}
                                        disabled={!newWorkspaceName.trim()}
                                        className="flex-1 px-6 py-3 bg-primary text-black font-medium text-xs tracking-widest rounded-md hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                                    >
                                        Create
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ModuleScrollContainer>
    );
};

export default WorkspaceManager;


