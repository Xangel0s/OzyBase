import React from 'react';
import { Activity, Radar, Shield, Sparkles, Table2 } from 'lucide-react';

export interface MCPSkillItem {
    id: string;
    name: string;
    description: string;
    icon?: string;
    enabled: boolean;
    min_level: string;
    usage_count: number;
    tools: string[];
}

interface SkillStorePanelProps {
    skills: MCPSkillItem[];
    loading: boolean;
    updatingSkillMap: Record<string, boolean>;
    onToggleSkill: (skillID: string, enabled: boolean) => void;
    onChangeMinLevel: (skillID: string, minLevel: string) => void;
}

type TierOption = {
    id: 'observer' | 'analyst' | 'operator' | 'admin';
    apiLevel: 'libre' | 'medio' | 'restringido';
};

const TIER_OPTIONS: TierOption[] = [
    { id: 'observer', apiLevel: 'libre' },
    { id: 'analyst', apiLevel: 'medio' },
    { id: 'operator', apiLevel: 'restringido' },
    { id: 'admin', apiLevel: 'restringido' },
];

const iconForSkill = (iconName?: string) => {
    const normalized = String(iconName || '').trim().toLowerCase();
    if (normalized === 'shield') return Shield;
    if (normalized === 'table') return Table2;
    if (normalized === 'radar') return Radar;
    if (normalized === 'sparkles') return Sparkles;
    return Activity;
};

const displayTierForMinLevel = (minLevel: string) => {
    const normalized = String(minLevel || '').toLowerCase();
    if (normalized === 'medio') return 'analyst';
    if (normalized === 'restringido') return 'operator';
    return 'observer';
};

const SkillStorePanel: React.FC<SkillStorePanelProps> = ({
    skills,
    loading,
    updatingSkillMap,
    onToggleSkill,
    onChangeMinLevel,
}) => {
    return (
        <div className="flex h-full w-full flex-col">
            <div className="mb-6 flex flex-col gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-white/95">Governance Policies</h2>
                <p className="max-w-3xl text-[13px] text-zinc-400">
                    Administra la matriz de habilidades y herramientas a las que pueden acceder los agentes del sistema.
                    Los niveles de acceso se aplican en caliente via MCP.
                </p>
            </div>

            {loading ? (
                <div className="flex flex-col gap-3 py-6">
                    {[1, 2, 3, 4].map((item) => (
                        <div key={item} className="h-[80px] w-full animate-pulse rounded-md bg-white/5" />
                    ))}
                </div>
            ) : skills.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 bg-white/[0.02] py-16">
                    <p className="text-sm text-zinc-500">No hay skills registradas en OzyBase.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3 pb-8">
                    {skills.map((skill) => {
                        const Icon = iconForSkill(skill.icon);
                        const isUpdating = Boolean(updatingSkillMap[skill.id]);
                        const selectedTier = displayTierForMinLevel(skill.min_level);

                        return (
                            <div
                                key={skill.id}
                                className="group relative flex items-center justify-between rounded-md border border-zinc-800/80 bg-[#131313] p-4 transition-colors hover:border-zinc-700"
                            >
                                <div className="mr-6 flex min-w-0 flex-1 items-start gap-4">
                                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-indigo-500/25 bg-indigo-500/10 text-indigo-300">
                                        <Icon size={16} />
                                    </div>

                                    <div className="flex min-w-0 flex-col">
                                        <h3 className="truncate text-[15px] font-medium text-zinc-200">{skill.name}</h3>
                                        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-500">{skill.description}</p>
                                        <p className="mt-1 text-[11px] text-zinc-600">
                                            Uso: <span className="text-zinc-500">{skill.usage_count}</span> · Tools: {skill.tools.length}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-6">
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Access Tier</span>
                                        <div className="flex rounded-md border border-zinc-800/50 bg-black/40 p-0.5">
                                            {TIER_OPTIONS.map((tier) => (
                                                <button
                                                    key={tier.id}
                                                    type="button"
                                                    disabled={isUpdating}
                                                    onClick={() => onChangeMinLevel(skill.id, tier.apiLevel)}
                                                    className={`rounded-md px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                                                        selectedTier === tier.id
                                                            ? 'bg-zinc-800 text-zinc-200 shadow-sm'
                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                    } ${isUpdating ? 'opacity-50' : ''}`}
                                                >
                                                    {tier.id}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="hidden h-8 w-[1px] bg-zinc-800 sm:block" />

                                    <label className="relative inline-flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            className="peer sr-only"
                                            checked={skill.enabled}
                                            disabled={isUpdating}
                                            onChange={(event) => onToggleSkill(skill.id, event.target.checked)}
                                        />
                                        <div className="h-6 w-11 rounded-full bg-zinc-800 peer-focus:outline-none peer-checked:bg-emerald-500 peer-disabled:opacity-50 peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']" />
                                    </label>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SkillStorePanel;


