import React from 'react';
import { Settings2 } from 'lucide-react';

export type GovernanceAutonomyLevel = 'L1' | 'L2' | 'L3';

interface GovernanceControlProps {
    context: 'mcp' | 'engram';
    level: GovernanceAutonomyLevel;
    name: string;
    dotToneClassName: string;
    onClick: () => void;
    disabled?: boolean;
}

const GovernanceControl: React.FC<GovernanceControlProps> = ({
    context,
    level,
    name,
    dotToneClassName,
    onClick,
    disabled = false,
}) => {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-2 rounded-md border border-white/10 bg-black/50 px-3 py-2 shadow-inner transition-colors hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
            title={`Ozy-Governance: ${name} (${level})`}
        >
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">{context}-gov</span>
            <Settings2 size={14} className="text-zinc-200" />
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-300">{level}</span>
            <span className={`h-2.5 w-2.5 rounded-full ${dotToneClassName}`} />
        </button>
    );
};

export default GovernanceControl;

