import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, BookOpen, Copy, Database, Info, Loader2, MoreVertical, RefreshCw, Search, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { applyHealthFix, buildCoverageHealthFixIssue, canAutoFixCoverageItem, formatHealthFixSuccessMessage, type HealthFixIssue } from '../utils/healthFix';
import { addProjectSyncListener, dispatchProjectSync } from '../utils/projectEvents';
import AutoFixModal from './AutoFixModal';
import ModuleScrollContainer from './ModuleScrollContainer';
import OzySelect from './OzySelect';
import { BrandedToast } from './OverlayPrimitives';

type RuleKey = 'list_rule' | 'create_rule' | 'update_rule' | 'delete_rule';
type ToastTone = 'success' | 'error' | 'warning';
type TableScope = 'all' | 'user' | 'system';

interface CollectionRule {
    id?: string;
    name: string;
    display_name?: string;
    is_system?: boolean;
    rls_rule?: string;
    list_rule?: string;
    create_rule?: string;
    update_rule?: string;
    delete_rule?: string;
    [key: string]: unknown;
}
interface ToastState { message: string; tone: ToastTone; }
interface RLSCoverageItem {
    table_name: string;
    rls_db_enabled: boolean;
    rls_metadata_enabled: boolean;
    owner_column_present: boolean;
    eligible_for_auto_enforce: boolean;
    policy_count: number;
    missing_actions: string[];
    fully_covered: boolean;
}
interface RLSCoverageState {
    total_tables: number;
    fully_covered: number;
    tables_with_gaps: number;
    eligible_tables: number;
    eligible_fully_covered: number;
    eligible_tables_with_gaps: number;
    non_eligible_tables: number;
    kpi_full_action_coverage_ratio: number;
    items: RLSCoverageItem[];
}

const roles = ['public', 'auth', 'admin', 'editor', 'manager'];
const RULES: Array<{ id: RuleKey; label: string }> = [
    { id: 'list_rule', label: 'SELECT' },
    { id: 'create_rule', label: 'INSERT' },
    { id: 'update_rule', label: 'UPDATE' },
    { id: 'delete_rule', label: 'DELETE' },
];

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const prettify = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const inferAccessModel = (rule: string): 'Ninguno' | 'Solo Dueno' | 'Publico' | 'Personalizado' => {
    const normalized = rule.trim().toLowerCase();
    if (!normalized) return 'Ninguno';
    if (normalized === 'true') return 'Publico';
    if (normalized.includes('auth.uid')) return 'Solo Dueno';
    return 'Personalizado';
};

const PermissionManager = () => {
    const [collections, setCollections] = useState<CollectionRule[]>([]);
    const [coverage, setCoverage] = useState<RLSCoverageState | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [enforcing, setEnforcing] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [tableScope, setTableScope] = useState<TableScope>('all');
    const [activeMenuKey, setActiveMenuKey] = useState<string | null>(null);
    const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
    const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const [selectedFixIssue, setSelectedFixIssue] = useState<HealthFixIssue | null>(null);
    const [isAutoFixModalOpen, setIsAutoFixModalOpen] = useState(false);

    const loadState = useCallback(async (options?: { silent?: boolean }) => {
        if (options?.silent) setRefreshing(true); else setLoading(true);
        try {
            const [collectionsResult, coverageResult] = await Promise.allSettled([
                fetchWithAuth('/api/collections'),
                fetchWithAuth('/api/project/security/rls/coverage?only_gaps=true'),
            ]);
            if (collectionsResult.status !== 'fulfilled') throw new Error('Failed to load table rules');
            const collectionsRes = collectionsResult.value;
            if (!collectionsRes.ok) throw new Error(await extractErrorMessage(collectionsRes, 'Failed to load table rules'));
            const collectionsData: unknown = await collectionsRes.json();
            setCollections(Array.isArray(collectionsData) ? (collectionsData as CollectionRule[]) : []);

            if (coverageResult.status === 'fulfilled' && coverageResult.value.ok) {
                const coverageData: unknown = await coverageResult.value.json();
                setCoverage((typeof coverageData === 'object' && coverageData !== null) ? (coverageData as RLSCoverageState) : null);
            } else {
                setCoverage(null);
                setToast({ message: 'ACL loaded, but native RLS coverage is unavailable right now', tone: 'error' });
            }
        } catch (error) {
            console.error('Failed to load permissions surface', error);
            setToast({ message: error instanceof Error ? error.message : 'Failed to load permissions surface', tone: 'error' });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { void loadState(); }, [loadState]);
    useEffect(() => {
        const unsubscribe = addProjectSyncListener((detail) => {
            if (!detail.tables && !detail.coverage && !detail.health) {
                return;
            }
            void loadState({ silent: true });
        });
        return unsubscribe;
    }, [loadState]);
    useEffect(() => {
        const focusedTable = localStorage.getItem('ozy_policies_focus_table');
        if (!focusedTable) return;
        setSearchQuery(focusedTable);
        localStorage.removeItem('ozy_policies_focus_table');
    }, []);
    useEffect(() => {
        if (!toast) return undefined;
        const timeout = window.setTimeout(() => setToast(null), 3200);
        return () => window.clearTimeout(timeout);
    }, [toast]);
    useEffect(() => {
        const handlePointer = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target.closest('[data-policy-menu-root]')) return;
            setActiveMenuKey(null);
        };
        document.addEventListener('mousedown', handlePointer);
        return () => document.removeEventListener('mousedown', handlePointer);
    }, []);

    const updateRule = async (collectionName: string, type: RuleKey, value: string) => {
        setSaving(collectionName);
        try {
            const response = await fetchWithAuth('/api/collections/rules', {
                method: 'PATCH',
                body: JSON.stringify({ name: collectionName, [type]: value }),
            });
            if (!response.ok) throw new Error(await extractErrorMessage(response, `Failed to update ${collectionName}`));
            setCollections((current) => current.map((collection) => collection.name === collectionName ? { ...collection, [type]: value } : collection));
            setToast({ message: `ACL updated for ${collectionName}`, tone: 'success' });
        } catch (error) {
            console.error(`Failed to update rule for ${collectionName}`, error);
            setToast({ message: error instanceof Error ? error.message : 'Update failed', tone: 'error' });
        } finally {
            setSaving(null);
        }
    };

    const handleEnforceRLS = async () => {
        setEnforcing(true);
        try {
            const response = await fetchWithAuth('/api/project/security/rls/enforce', { method: 'POST', body: JSON.stringify({}) });
            if (!response.ok) throw new Error(await extractErrorMessage(response, 'Failed to auto-enforce RLS coverage'));
            const payload = await response.json().catch(() => null) as { enforced?: number } | null;
            await loadState({ silent: true });
            dispatchProjectSync({
                tables: true,
                health: true,
                coverage: true,
                reason: 'rls-auto-enforce',
            });
            setToast({ message: payload?.enforced ? `Native RLS enforced on ${payload.enforced} eligible table${payload.enforced === 1 ? '' : 's'}` : 'No eligible tables needed auto-enforcement', tone: 'success' });
        } catch (error) {
            console.error('Failed to auto-enforce RLS coverage', error);
            setToast({ message: error instanceof Error ? error.message : 'Failed to auto-enforce RLS coverage', tone: 'error' });
        } finally {
            setEnforcing(false);
        }
    };

    const openCoverageAutoFix = useCallback((item: RLSCoverageItem) => {
        setSelectedFixIssue(buildCoverageHealthFixIssue(item));
        setIsAutoFixModalOpen(true);
    }, []);

    const handleApplyFix = useCallback(async (issue: HealthFixIssue) => {
        try {
            await applyHealthFix(issue, 'Failed to auto-fix RLS coverage');
            await loadState({ silent: true });
            setToast({ message: formatHealthFixSuccessMessage(issue), tone: 'success' });
        } catch (error) {
            console.error('Failed to auto-fix RLS coverage', error);
            setToast({ message: error instanceof Error ? error.message : 'Failed to auto-fix RLS coverage', tone: 'error' });
        }
    }, [loadState]);

    const handleCopyTableName = useCallback(async (tableName: string) => {
        try {
            await navigator.clipboard.writeText(tableName);
            setToast({ message: `Copied ${tableName}`, tone: 'success' });
        } catch {
            setToast({ message: 'Clipboard is unavailable in this session', tone: 'error' });
        } finally {
            setActiveMenuKey(null);
        }
    }, []);

    const openDocs = useCallback(() => {
        setActiveMenuKey(null);
        window.open('https://www.postgresql.org/docs/current/ddl-rowsecurity.html', '_blank', 'noopener,noreferrer');
    }, []);

    const collectionLookup = useMemo(() => {
        const next = new Map<string, CollectionRule>();
        collections.forEach((collection) => next.set(collection.name, collection));
        return next;
  }, [collections]);
  
    const coverageByTable = useMemo(() => {
        const next = new Map<string, RLSCoverageItem>();
        coverage?.items.forEach((item) => next.set(item.table_name, item));
        return next;
  }, [coverage]);
  
    const filteredCollections = useMemo(() => {
        const normalizedSearch = searchQuery.trim().toLowerCase();
        return collections.filter((collection) => {
            const matchesScope = tableScope === 'all' || (tableScope === 'system' && Boolean(collection.is_system)) || (tableScope === 'user' && !collection.is_system);
            if (!matchesScope) return false;
            if (!normalizedSearch) return true;
            const displayName = String(collection.display_name || '').toLowerCase();
            const tableName = String(collection.name || '').toLowerCase();
            return displayName.includes(normalizedSearch) || tableName.includes(normalizedSearch);
        });
  }, [collections, searchQuery, tableScope]);
  
    const filteredCoverageItems = useMemo(() => {
        const normalizedSearch = searchQuery.trim().toLowerCase();
        return (coverage?.items ?? []).filter((item) => {
            const collection = collectionLookup.get(item.table_name);
            const matchesScope = tableScope === 'all' || (tableScope === 'system' && Boolean(collection?.is_system)) || (tableScope === 'user' && !collection?.is_system);
            if (!matchesScope) return false;
            if (!normalizedSearch) return true;
            return item.table_name.toLowerCase().includes(normalizedSearch);
        });
  }, [collectionLookup, coverage?.items, searchQuery, tableScope]);
  
    const scrollCollectionIntoView = useCallback((tableName: string) => {
        const card = document.querySelector<HTMLElement>(`[data-policy-card="${tableName}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, []);

    if (loading) {
        return <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500"><Loader2 className="animate-spin text-primary" size={32} /><span className="text-[10px] font-medium">Syncing policy surfaces...</span></div>;
    }

    return (
        <ModuleScrollContainer width="full" innerClassName="animate-in fade-in duration-500">
            <div className="space-y-8 pb-20">
                <section className="space-y-6">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between border-b border-border/50 pb-8">
                        <div className="flex items-center gap-6">
                            <div className="w-20 h-20 bg-[#fefefe03] rounded-[32px] flex items-center justify-center border border-white/5 shadow-[0_0_50px_rgba(254,254,0,0.02)] relative group/logo">
                                <div className="absolute inset-0 bg-primary/20 blur-2xl opacity-0 group-hover/logo:opacity-100 transition-opacity duration-700" />
                                <ShieldCheck className="text-primary relative z-10" size={40} strokeWidth={1.5} />
                            </div>
                            <div>
                                <h1 className="text-5xl font-bold tracking-tighter text-white uppercase italic leading-none">Access Policies</h1>
                                <p className="mt-2 text-zinc-500 text-sm font-medium tracking-wide">Manage RLS security layers and public REST permissions</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button 
                                type="button" 
                                onClick={() => void loadState({ silent: true })} 
                                disabled={refreshing} 
                                className="inline-flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/30 p-4 text-zinc-400 transition-all hover:border-primary/40 hover:text-primary active:scale-90 disabled:opacity-50 shadow-xl"
                            >
                                <RefreshCw size={20} strokeWidth={2.5} className={refreshing ? 'animate-spin text-primary' : ''} />
                            </button>
                            <button 
                                type="button" 
                                onClick={openDocs} 
                                className="inline-flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 px-6 py-4 text-[11px] font-bold tracking-[0.25em] text-zinc-300 uppercase transition-all hover:border-primary/40 hover:text-white shadow-xl group"
                            >
                                <BookOpen size={16} className="text-primary group-hover:scale-110 transition-transform" /> Documentation
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
                        <div className="flex items-center gap-4 rounded-md border border-border/60 bg-background px-6 py-5 shadow-inner group/search focus-within:border-primary/30 transition-all">
                            <Search size={20} className="text-zinc-600 group-focus-within/search:text-primary transition-colors" />
                            <input 
                                value={searchQuery} 
                                onChange={(event) => setSearchQuery(event.target.value)} 
                                placeholder="Filter by source identifier or alias..." 
                                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-zinc-700 font-semibold" 
                            />
                        </div>
                        <OzySelect 
                            value={tableScope} 
                            onChange={(event) => setTableScope(event.target.value as TableScope)}
                            wrapperClassName="rounded-md border-border/60 bg-background shadow-none"
                            selectClassName="h-full px-6 text-[11px] font-bold tracking-[0.2em] uppercase"
                        >
                            <option value="all">Global Catalog</option>
                            <option value="user">User Entities</option>
                            <option value="system">Engine Core</option>
                        </OzySelect>
                    </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <section className="lg:col-span-1 space-y-6">
                        <div className="flex items-center justify-between px-3">
                            <h3 className="text-[11px] font-bold tracking-[0.3em] text-zinc-600 uppercase italic">RLS Disabled Tables</h3>
                            <button 
                                onClick={() => void handleEnforceRLS()}
                                disabled={enforcing || !coverage || coverage.eligible_tables_with_gaps === 0}
                                className="text-[10px] font-bold text-primary hover:text-white uppercase tracking-widest transition-colors disabled:opacity-20"
                            >
                                {enforcing ? 'Fixing...' : 'Fix All'}
                            </button>
                        </div>
                        
                        <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
                            {filteredCoverageItems.length === 0 ? (
                                <div className="rounded-[40px] border border-emerald-500/5 bg-emerald-500/2 p-10 text-center flex flex-col items-center justify-center gap-4">
                                    <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
                                        <ShieldCheck size={28} className="text-emerald-500" />
                                    </div>
                                    <p className="text-[10px] font-bold text-emerald-500/40 uppercase tracking-[0.3em]">RLS Isolation Active</p>
                                </div>
                            ) : filteredCoverageItems.map((item) => (
                                <div key={item.table_name} className="group relative rounded-[32px] border border-red-500/10 bg-background p-6 transition-all hover:border-red-500/30 hover:shadow-[0_20px_40px_-20px_rgba(239,68,68,0.1)] overflow-hidden">
                                     <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-3xl rounded-full translate-x-16 -translate-y-16" />
                                    <div className="flex flex-col gap-4 relative z-10">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-[12px] text-red-400 font-bold tracking-tight truncate max-w-[140px]">{item.table_name}</span>
                                            <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse" />
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {item.missing_actions.map(action => (
                                                <span key={action} className="text-[9px] font-bold bg-red-500/10 text-red-300 px-2 py-1 rounded-md uppercase tracking-widest">{action}</span>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-zinc-500 leading-relaxed">
                                            RLS is disabled, so rows are not isolated at database level.
                                        </p>
                                        <button 
                                            onClick={() => scrollCollectionIntoView(item.table_name)}
                                            className="mt-2 w-full py-4 bg-white/3 hover:bg-white/8 rounded-md text-[10px] font-bold text-white/50 hover:text-white uppercase tracking-[0.2em] transition-all border border-white/5"
                                        >
                                            Inspect Source
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="lg:col-span-3 space-y-8">
                        <div className="flex items-center justify-between px-3">
                             <h3 className="text-[11px] font-bold tracking-[0.3em] text-zinc-600 uppercase italic">Policy Registry</h3>
                             <div className="flex items-center gap-4 text-[10px] font-bold text-zinc-700 tracking-widest uppercase">
                                <span>{filteredCollections.length} Identifiers mapped</span>
                             </div>
                        </div>

                        <div className="space-y-8">
                            {filteredCollections.length === 0 ? (
                                <div className="rounded-[60px] border border-zinc-900/50 bg-background py-40 text-center shadow-2xl">
                                    <div className="w-24 h-24 bg-zinc-900 rounded-[32px] flex items-center justify-center mx-auto mb-8 border border-zinc-800/50 relative overflow-hidden group">
                                         <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <Search size={32} className="text-zinc-700 relative z-10" />
                                    </div>
                                    <p className="text-[12px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-relaxed">System scan complete<br/>No matching policies revealed</p>
                                </div>
                            ) : filteredCollections.map((collection) => {
                                const coverageItem = coverageByTable.get(collection.name);
                                return (
                                    <article 
                                        key={collection.name} 
                                        data-policy-card={collection.name} 
                                        className="group relative rounded-[48px] border border-white/5 bg-background transition-all hover:border-white/10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]"
                                    >
                                        <div className="absolute inset-0 rounded-[48px] overflow-hidden pointer-events-none">
                                            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/1 blur-[120px] rounded-full translate-x-1/2 -translate-y-1/2" />
                                        </div>
                                        
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 p-10 border-b border-white/5 relative z-10">
                                            <div className="flex items-center gap-6">
                                                <div className="w-16 h-16 bg-zinc-900 rounded-md flex items-center justify-center border border-zinc-800 group-hover:border-primary/30 transition-colors shadow-2xl">
                                                    <Database size={28} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-4">
                                                        <h2 className="text-3xl font-bold tracking-tighter text-white">{collection.name}</h2>
                                                        <span className={`text-[9px] font-bold px-3 py-1 rounded-full border uppercase tracking-widest ${collection.is_system ? 'bg-zinc-800/50 border-zinc-700 text-zinc-500' : 'bg-primary/5 border-primary/20 text-primary animate-pulse'}`}>
                                                            {collection.is_system ? 'SYSTEM' : 'DATA_ENTITY'}
                                                        </span>
                                                    </div>
                                                    <div className="mt-3 flex items-center gap-6">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-2 h-2 rounded-full ${coverageItem ? 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]' : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]'}`} />
                                                            <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${coverageItem ? 'text-red-400' : 'text-emerald-500'}`}>
                                                                {coverageItem ? 'RLS disabled' : 'RLS activo'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-zinc-700">
                                                            <RefreshCw size={10} />
                                                            <span className="text-[10px] font-bold uppercase tracking-tight">RLS ENFORCED</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {canAutoFixCoverageItem(coverageItem) && (
                                                    <button 
                                                        type="button" 
                                                        onClick={() => openCoverageAutoFix(coverageItem)} 
                                                        className="inline-flex items-center gap-3 rounded-md bg-primary px-8 py-4 text-[11px] font-bold text-black uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 shadow-[0_10px_30px_rgba(254,254,0,0.15)] group/fix"
                                                    >
                                                        <Sparkles size={14} className="group-hover:rotate-12 transition-transform" /> Enable RLS
                                                    </button>
                                                )}
                                                {!coverageItem && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveMenuKey(`${collection.name}:header`)}
                                                        className="inline-flex items-center gap-3 rounded-md border border-sky-500/30 bg-sky-500/10 px-6 py-4 text-[11px] font-bold text-sky-200 uppercase tracking-[0.2em] transition-all hover:bg-sky-500/20"
                                                    >
                                                        <Wand2 size={14} /> Configurar Acceso
                                                    </button>
                                                )}
                                                <div className="relative" data-policy-menu-root>
                                                    <button 
                                                        ref={(el) => { menuBtnRefs.current[collection.name] = el; }}
                                                        type="button" 
                                                        onClick={() => {
                                                            const btn = menuBtnRefs.current[collection.name];
                                                            const rect = btn?.getBoundingClientRect() ?? null;
                                                            setMenuAnchorRect(rect);
                                                            setActiveMenuKey((current) => current === `${collection.name}:header` ? null : `${collection.name}:header`);
                                                        }} 
                                                        className="p-4 text-zinc-500 hover:text-white bg-zinc-900/50 border border-zinc-800 rounded-md transition-all shadow-xl"
                                                    >
                                                        <MoreVertical size={20} />
                                                    </button>
                                                    {activeMenuKey === `${collection.name}:header` && menuAnchorRect && typeof document !== 'undefined' && createPortal(
                                                        <div
                                                            className="fixed z-9999 min-w-[240px] overflow-hidden rounded-md border border-white/10 shadow-[0_40px_100px_-20px_rgba(0,0,0,1)] animate-in zoom-in-95 duration-200"
                                                            style={{
                                                                backgroundColor: '#0d0d0d',
                                                                top: menuAnchorRect.bottom + 8,
                                                                right: window.innerWidth - menuAnchorRect.right,
                                                            }}
                                                        >
                                                            <button onClick={openDocs} className="flex w-full items-center gap-4 px-6 py-5 text-left text-[11px] font-bold text-zinc-400 uppercase tracking-[0.2em] transition-colors hover:bg-white/5 hover:text-white border-b border-white/5">
                                                                <BookOpen size={16} className="text-primary" /> Master Docs
                                                            </button>
                                                            <button onClick={() => void handleCopyTableName(collection.name)} className="flex w-full items-center gap-4 px-6 py-5 text-left text-[11px] font-bold text-zinc-400 uppercase tracking-[0.2em] transition-colors hover:bg-white/5 hover:text-white">
                                                                <Copy size={16} className="text-zinc-500" /> Copy Name
                                                            </button>
                                                        </div>,
                                                        document.body,
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-10 relative z-10">
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                                {RULES.map((rule) => {
                                                    const selectedValue = typeof collection[rule.id] === 'string' ? String(collection[rule.id]) : 'admin';
                                                    return (
                                                        <div key={rule.id} className="space-y-4 p-6 rounded-md border border-white/5 bg-black/15 group/rule transition-all hover:bg-black/25 hover:border-white/10 shadow-inner">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] italic">{rule.label}</span>
                                                                {saving === collection.name ? (
                                                                    <Loader2 size={12} className="animate-spin text-primary" />
                                                                ) : (
                                                                    <div className={`w-3 h-3 rounded-full ${selectedValue === 'public' ? 'bg-zinc-800' : 'bg-primary/40 shadow-[0_0_8px_rgba(254,254,0,0.2)]'}`} />
                                                                )}
                                                            </div>
                                                            <OzySelect 
                                                                value={selectedValue} 
                                                                onChange={(event) => void updateRule(collection.name, rule.id, event.target.value)} 
                                                                density="compact"
                                                                wrapperClassName="rounded-md border-white/5 bg-[#070707] shadow-none group-hover/rule:border-white/10 transition-colors" 
                                                                selectClassName="text-[10px] font-bold uppercase tracking-tight italic !pr-6"
                                                            >
                                                                {roles.map((role) => <option key={role} value={role}>{role.toUpperCase()}</option>)}
                                                            </OzySelect>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {coverageItem && coverageItem.missing_actions.length > 0 && (
                                                <div className="mt-8 flex items-start gap-5 p-6 rounded-[32px] bg-red-500/2 border border-red-500/10 shadow-inner group/warn">
                                                    <div className="w-10 h-10 rounded-md bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20 group-hover/warn:bg-red-500/20 transition-colors">
                                                        <AlertCircle size={20} className="text-red-500" />
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-bold text-red-500 uppercase tracking-[0.3em] italic">Isolation Disabled</p>
                                                        <p className="mt-2 text-[11px] text-zinc-500 font-medium leading-relaxed tracking-wide">
                                                            RLS is currently disabled for this table. Enable RLS to block direct database access by default.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {!coverageItem && (
                                                <div className="mt-8 flex items-start gap-5 p-6 rounded-[32px] bg-sky-500/5 border border-sky-500/20 shadow-inner">
                                                    <div className="w-10 h-10 rounded-md bg-sky-500/10 flex items-center justify-center shrink-0 border border-sky-500/30">
                                                        <Info size={18} className="text-sky-300" />
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-bold text-sky-200 uppercase tracking-[0.3em] italic">Informacion de Acceso</p>
                                                        <p className="mt-2 text-[11px] text-zinc-400 font-medium leading-relaxed tracking-wide">
                                                            Tu tabla esta protegida por RLS. Acceso actual: <span className="text-sky-200">{inferAccessModel(String(collection.rls_rule || ''))}</span>.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>

            {toast && (
                <BrandedToast
                    message={toast.message}
                    tone={toast.tone}
                    onClose={() => setToast(null)}
                />
            )}
            <AutoFixModal
                isOpen={isAutoFixModalOpen}
                issue={selectedFixIssue}
                onClose={() => setIsAutoFixModalOpen(false)}
                onConfirm={handleApplyFix}
            />
        </ModuleScrollContainer>
    );
};

export default PermissionManager;


