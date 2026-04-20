import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Shield, X } from 'lucide-react';

export const cx = (...classes: Array<string | false | null | undefined>) => (
    classes.filter(Boolean).join(' ')
);

export type BrandedToastTone = 'success' | 'error' | 'warning' | 'info';
export type BrandedToastPosition = 'top-right' | 'bottom-right';

interface BrandedToastProps {
    message: string;
    tone?: BrandedToastTone;
    title?: string;
    onClose?: () => void;
    className?: string;
    position?: BrandedToastPosition;
    durationMs?: number;
}

const TOAST_TONE_STYLES: Record<BrandedToastTone, { accent: string; title: string; icon: React.ReactNode }> = {
    success: {
        accent: 'text-green-400 border-green-500/20 ring-1 ring-green-500/15 bg-green-500/8',
        title: 'Success',
        icon: <CheckCircle2 size={18} className="animate-[ozy-success-bounce_420ms_ease-out]" />,
    },
    error: {
        accent: 'text-red-400 border-red-500/20 ring-1 ring-red-500/15 bg-red-500/8',
        title: 'Error',
        icon: <AlertTriangle size={18} />,
    },
    warning: {
        accent: 'text-amber-400 border-amber-500/20 ring-1 ring-amber-500/15 bg-amber-500/8',
        title: 'Warning',
        icon: <Shield size={18} />,
    },
    info: {
        accent: 'text-sky-400 border-sky-500/20 ring-1 ring-sky-500/15 bg-sky-500/8',
        title: 'Info',
        icon: <Info size={18} />,
    },
};

const POSITION_STYLES: Record<BrandedToastPosition, string> = {
    'top-right': 'top-8 right-8',
    'bottom-right': 'bottom-8 right-8',
};

export const BrandedToast: React.FC<BrandedToastProps> = ({
    message,
    tone = 'success',
    title,
    onClose,
    className,
    position = 'top-right',
    durationMs = 5000,
}) => {
    const config = TOAST_TONE_STYLES[tone];

    React.useEffect(() => {
        if (!onClose || !durationMs) return;
        const timer = setTimeout(() => {
            onClose();
        }, durationMs);
        return () => clearTimeout(timer);
    }, [onClose, durationMs]);

    return (
        <div className={cx('fixed z-9999 min-w-[320px] max-w-[420px] animate-in slide-in-from-right-8 duration-500', POSITION_STYLES[position], className)}>
            <div className={cx('relative overflow-hidden ozy-toast-surface px-5 py-4 flex items-start gap-4 backdrop-blur-md border bg-zinc-900/90 rounded-md shadow-2xl', config.accent)}>
                <div className="mt-0.5 shrink-0">
                    <div className="w-8 h-8 rounded-md bg-black/40 border border-white/5 flex items-center justify-center">
                        {config.icon}
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-50 leading-tight">{title || config.title}</p>
                    <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-white">{message}</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="mt-0.5 shrink-0 text-white/30 transition-all hover:text-white hover:bg-white/5 p-1 rounded-md">
                        <X size={14} />
                    </button>
                )}
                {durationMs ? (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5">
                        <div
                            className="h-full bg-current opacity-60 animate-shrink-width"
                            style={{ animationDuration: `${durationMs}ms`, animationFillMode: 'forwards' }}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
};


