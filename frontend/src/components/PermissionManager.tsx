import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Database,
    Edit3,
    Eye,
    Info,
    Loader2,
    Lock,
    Plus,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Trash2,
    Wand2,
} from 'lucide-react';

import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';
import OzySelect from './OzySelect';

type RuleKey = 'list_rule' | 'create_rule' | 'update_rule' | 'delete_rule';
type ToastType = 'success' | 'error';

interface CollectionRule {
    id?: string;
    name: string;
    list_rule?: string;
    create_rule?: string;
    update_rule?: string;
    delete_rule?: string;
    [key: string]: unknown;
}

interface ToastState {
    message: string;
    type: ToastType;
}

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

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
};

const PermissionManager = () => {
    const [collections, setCollections] = useState<CollectionRule[]>([]);
    const [coverage, setCoverage] = useState<RLSCoverageState | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [enforcing, setEnforcing] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);

    const loadState = useCallback(async (options?: { silent?: boolean }) => {
        if (options?.silent) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        try {
            const [collectionsResult, coverageResult] = await Promise.allSettled([
                fetchWithAuth('/api/collections'),
                fetchWithAuth('/api/project/security/rls/coverage?only_gaps=true'),
            ]);

            if (collectionsResult.status !== 'fulfilled') {
                throw new Error('Failed to load table rules');
            }

            const collectionsRes = collectionsResult.value;
            if (!collectionsRes.ok) {
                throw new Error(await extractErrorMessage(collectionsRes, 'Failed to load table rules'));
            }

            const collectionsData: unknown = await collectionsRes.json();
            setCollections(Array.isArray(collectionsData) ? (collectionsData as CollectionRule[]) : []);

            if (coverageResult.status === 'fulfilled' && coverageResult.value.ok) {
                const coverageData: unknown = await coverageResult.value.json();
                setCoverage((typeof coverageData === 'object' && coverageData !== null) ? (coverageData as RLSCoverageState) : null);
            } else {
                setCoverage(null);
                setToast({ message: 'ACL loaded, but native RLS coverage is unavailable right now', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to load permissions surface', error);
            setToast({ message: error instanceof Error ? error.message : 'Failed to load permissions surface', type: 'error' });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    useEffect(() => {
        if (!toast) return undefined;
        const timeout = window.setTimeout(() => setToast(null), 3200);
        return () => window.clearTimeout(timeout);
    }, [toast]);

    const updateRule = async (collectionName: string, type: RuleKey, value: string) => {
        setSaving(collectionName);
        try {
            const response = await fetchWithAuth('/api/collections/rules', {
                method: 'PATCH',
                body: JSON.stringify({
                    name: collectionName,
                    [type]: value,
                }),
            });

            if (!response.ok) {
                throw new Error(await extractErrorMessage(response, `Failed to update ${collectionName}`));
            }

            setCollections((current) => current.map((collection) => (
                collection.name === collectionName ? { ...collection, [type]: value } : collection
            )));
            setToast({ message: `ACL updated for ${collectionName}`, type: 'success' });
        } catch (error) {
            console.error(`Failed to update rule for ${collectionName}`, error);
            setToast({ message: error instanceof Error ? error.message : 'Update failed', type: 'error' });
        } finally {
            setSaving(null);
        }
    };

    const handleEnforceRLS = async () => {
        setEnforcing(true);
        try {
            const response = await fetchWithAuth('/api/project/security/rls/enforce', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (!response.ok) {
                throw new Error(await extractErrorMessage(response, 'Failed to auto-enforce RLS coverage'));
            }

            const payload = await response.json().catch(() => null) as { enforced?: number } | null;
            await loadState({ silent: true });
            setToast({
                message: payload?.enforced
                    ? `Native RLS enforced on ${payload.enforced} eligible table${payload.enforced === 1 ? '' : 's'}`
                    : 'No eligible tables needed auto-enforcement',
                type: 'success',
            });
        } catch (error) {
            console.error('Failed to auto-enforce RLS coverage', error);
            setToast({ message: error instanceof Error ? error.message : 'Failed to auto-enforce RLS coverage', type: 'error' });
        } finally {
            setEnforcing(false);
        }
    };

    const coverageByTable = useMemo(() => {
        const next = new Map<string, RLSCoverageItem>();
        coverage?.items.forEach((item) => next.set(item.table_name, item));
        return next;
    }, [coverage]);

    const summaryCards = useMemo(() => ([
        {
            label: 'Tables',
            value: coverage?.total_tables ?? collections.length,
            hint: 'Collections tracked in the current workspace context.',
        },
        {
            label: 'Full RLS Coverage',
            value: coverage ? `${coverage.fully_covered}/${coverage.total_tables}` : '--',
            hint: 'Native Postgres coverage across SELECT / INSERT / UPDATE / DELETE.',
        },
        {
            label: 'Coverage Gaps',
            value: coverage?.tables_with_gaps ?? '--',
            hint: 'Tables still missing one or more native RLS actions.',
        },
        {
            label: 'Auto-Enforce Ready',
            value: coverage?.eligible_tables_with_gaps ?? '--',
            hint: 'Tables with owner columns that can be tightened automatically.',
        },
    ]), [collections.length, coverage]);

    if (loading) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-[10px] font-black uppercase tracking-widest">Syncing access layers...</span>
            </div>
        );
    }

    return (
        <ModuleScrollContainer width="6xl" innerClassName="animate-in fade-in duration-500">
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 border-b border-[#2e2e2e] pb-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
                            <ShieldCheck className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black uppercase tracking-tighter text-white italic">Access Layers</h1>
                            <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">Table ACL shortcuts plus native RLS coverage visibility</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void loadState({ silent: true })}
                            disabled={refreshing}
                            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                            {refreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleEnforceRLS()}
                            disabled={enforcing || !coverage || coverage.eligible_tables_with_gaps === 0}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Wand2 size={14} />
                            {enforcing ? 'Tightening...' : 'Auto-Enforce Eligible RLS'}
                        </button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {summaryCards.map((card) => (
                        <div key={card.label} className="rounded-[2rem] border border-[#2e2e2e] bg-[#111111] p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{card.label}</p>
                            <p className="mt-3 text-2xl font-black text-white">{card.value}</p>
                            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{card.hint}</p>
                        </div>
                    ))}
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[2rem] border border-[#2e2e2e] bg-[linear-gradient(180deg,rgba(16,16,16,0.98),rgba(10,10,10,0.94))] p-6">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                                <Info size={16} />
                            </div>
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-white">What This Panel Actually Controls</h3>
                                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                    These dropdowns edit coarse ACL metadata for <span className="text-white">list / create / update / delete</span>.
                                    Full native Postgres RLS still lives in table-creation presets, SQL policies, and the coverage/enforcement endpoints.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[2rem] border border-[#2e2e2e] bg-[#111111] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Native RLS Gaps</p>
                                <p className="mt-2 text-sm text-zinc-400">Tables missing one or more RLS actions still need design or auto-fix.</p>
                            </div>
                            <Sparkles size={18} className="text-primary" />
                        </div>

                        <div className="mt-5 space-y-3">
                            {(coverage?.items.length ?? 0) === 0 ? (
                                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-300">
                                    All tracked tables currently report full native RLS action coverage.
                                </div>
                            ) : (
                                (coverage?.items ?? []).slice(0, 5).map((item) => (
                                    <div key={item.table_name} className="rounded-2xl border border-[#2e2e2e] bg-[#0c0c0c] px-4 py-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <Database size={15} className="text-zinc-500" />
                                                <span className="text-sm font-black text-white">{item.table_name}</span>
                                            </div>
                                            <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${item.eligible_for_auto_enforce ? 'border border-primary/20 bg-primary/10 text-primary' : 'border border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                                                {item.eligible_for_auto_enforce ? 'auto-fix ready' : 'manual design'}
                                            </span>
                                        </div>
                                        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                                            Missing native actions: <span className="text-zinc-300">{item.missing_actions.join(', ')}</span>
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid gap-6">
                    {collections.map((collection) => {
                        const coverageGap = coverageByTable.get(collection.name);
                        return (
                            <div key={collection.name} className="overflow-hidden rounded-[2rem] border border-[#2e2e2e] bg-[#111111] transition-all hover:border-primary/20">
                                <div className="flex items-center justify-between border-b border-[#2e2e2e] bg-[#0d0d0d] px-8 py-5">
                                    <div className="flex items-center gap-3">
                                        <Database size={18} className="text-zinc-600" />
                                        <span className="text-lg font-black text-white italic">{collection.name}</span>
                                        {coverageGap ? (
                                            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300">
                                                native RLS gap
                                            </span>
                                        ) : (
                                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                                                full native coverage
                                            </span>
                                        )}
                                    </div>
                                    {saving === collection.name ? <Loader2 size={16} className="animate-spin text-primary" /> : null}
                                </div>

                                <div className="grid grid-cols-1 gap-8 p-8 md:grid-cols-2 lg:grid-cols-4">
                                    {([
                                        { id: 'list_rule', label: 'List (Read)', icon: Eye },
                                        { id: 'create_rule', label: 'Create', icon: Plus },
                                        { id: 'update_rule', label: 'Update', icon: Edit3 },
                                        { id: 'delete_rule', label: 'Delete', icon: Trash2 },
                                    ] as const).map((rule) => {
                                        const selectedValue = typeof collection[rule.id] === 'string' ? String(collection[rule.id]) : 'admin';
                                        const helperText = selectedValue === 'public'
                                            ? 'Everyone can access this action.'
                                            : selectedValue === 'auth'
                                                ? 'Any authenticated user can access this action.'
                                                : `Only ${selectedValue} can access this action.`;

                                        return (
                                            <div key={rule.id} className="space-y-4">
                                                <div className="flex items-center gap-2">
                                                    <rule.icon size={14} className="text-zinc-500" />
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{rule.label}</label>
                                                </div>

                                                <OzySelect
                                                    value={selectedValue}
                                                    onChange={(event) => void updateRule(collection.name, rule.id, event.target.value)}
                                                    wrapperClassName="rounded-xl"
                                                    selectClassName="h-11 text-[10px] tracking-[0.16em]"
                                                >
                                                    {roles.map((role) => (
                                                        <option key={role} value={role}>{role}</option>
                                                    ))}
                                                </OzySelect>

                                                <p className="text-[10px] italic text-zinc-600">
                                                    {helperText}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>

                                {coverageGap ? (
                                    <div className="border-t border-[#2e2e2e] bg-[#0b0b0b] px-8 py-5">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-300">
                                                {coverageGap.eligible_for_auto_enforce ? <Sparkles size={14} /> : <Lock size={14} />}
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-200/90">
                                                    {coverageGap.eligible_for_auto_enforce ? 'Eligible for auto-enforce' : 'Needs manual policy design'}
                                                </p>
                                                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                                                    Native RLS still misses <span className="text-zinc-300">{coverageGap.missing_actions.join(', ')}</span>.
                                                    {coverageGap.eligible_for_auto_enforce
                                                        ? ' You can tighten owner-based coverage with the action above.'
                                                        : ' Add an owner column or design explicit policies in SQL for this table.'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>

                <div className="rounded-3xl border border-white/5 bg-zinc-900/50 p-6">
                    <div className="flex items-start gap-4">
                        <div className="mt-1 rounded-lg bg-blue-500/10 p-2 text-blue-500">
                            <Info size={16} />
                        </div>
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-widest text-white">Status Of The Unified Policy Editor</h3>
                            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                                OzyBase already has RLS presets, coverage auditing, and mass enforcement for eligible tables.
                                What is still <span className="text-zinc-300">in progress</span> is the consolidated visual editor for authoring every native policy from one screen.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {toast ? (
                <div className={`fixed bottom-8 right-8 flex items-center gap-3 rounded-xl border px-6 py-3 text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-bottom duration-300 ${toast.type === 'success' ? 'border-green-500/20 bg-green-500/10 text-green-500' : 'border-red-500/20 bg-red-500/10 text-red-500'}`}>
                    {toast.type === 'success' ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
                    {toast.message}
                </div>
            ) : null}
        </ModuleScrollContainer>
    );
};

export default PermissionManager;
