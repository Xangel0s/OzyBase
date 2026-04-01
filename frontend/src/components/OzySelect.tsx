import React from 'react';
import { ChevronDown } from 'lucide-react';

type OzySelectTone = 'default' | 'accent' | 'danger';

interface OzySelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    tone?: OzySelectTone;
    wrapperClassName?: string;
    selectClassName?: string;
}

const toneClasses: Record<OzySelectTone, string> = {
    default: 'border-[#2e2e2e] bg-[linear-gradient(180deg,rgba(20,20,20,0.98),rgba(10,10,10,0.96))] text-zinc-200 hover:border-primary/20 focus-within:border-primary/45 focus-within:ring-4 focus-within:ring-primary/10',
    accent: 'border-primary/25 bg-[linear-gradient(180deg,rgba(38,38,8,0.92),rgba(12,12,12,0.98))] text-white hover:border-primary/40 focus-within:border-primary/55 focus-within:ring-4 focus-within:ring-primary/15',
    danger: 'border-red-500/25 bg-[linear-gradient(180deg,rgba(52,12,12,0.92),rgba(12,12,12,0.98))] text-red-50 hover:border-red-500/40 focus-within:border-red-500/55 focus-within:ring-4 focus-within:ring-red-500/10',
};

const OzySelect = React.forwardRef<HTMLSelectElement, OzySelectProps>(function OzySelect(
    {
        tone = 'default',
        wrapperClassName = '',
        selectClassName = '',
        children,
        disabled,
        ...props
    },
    ref,
) {
    return (
        <div className={`group relative overflow-hidden rounded-2xl border shadow-[0_16px_40px_rgba(0,0,0,0.24)] transition-all ${toneClasses[tone]} ${disabled ? 'opacity-60' : ''} ${wrapperClassName}`}>
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            <select
                {...props}
                ref={ref}
                disabled={disabled}
                className={`h-12 w-full appearance-none bg-transparent pl-4 pr-11 text-[11px] font-black uppercase tracking-[0.18em] text-inherit outline-none disabled:cursor-not-allowed ${selectClassName}`}
            >
                {children}
            </select>
            <ChevronDown
                size={15}
                className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${disabled ? 'text-zinc-700' : 'text-zinc-500 group-focus-within:text-primary group-hover:text-zinc-200'}`}
            />
        </div>
    );
});

export default OzySelect;
