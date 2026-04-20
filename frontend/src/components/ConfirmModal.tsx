import React from 'react';
import { AlertCircle, Loader2, ShieldAlert, X } from 'lucide-react';

type ConfirmModalType = 'danger' | 'info' | 'success';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    type?: ConfirmModalType;
    confirmDisabled?: boolean;
    closeOnConfirm?: boolean;
    confirmButtonClassName?: string;
    cancelButtonClassName?: string;
}

const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title = '',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'danger',
    confirmDisabled = false,
    closeOnConfirm = true,
    confirmButtonClassName = '',
    cancelButtonClassName = '',
}: ConfirmModalProps) => {
    const [submitting, setSubmitting] = React.useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (submitting || confirmDisabled) {
            return;
        }

        setSubmitting(true);
        try {
            await onConfirm();
            if (closeOnConfirm) {
                onClose();
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-100 flex items-center justify-center p-4"
            onClick={(e: React.MouseEvent<HTMLDivElement>) => e.target === e.currentTarget && onClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div className="relative w-full max-w-md overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-inner ${type === 'danger' ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                            {type === 'danger' ? <ShieldAlert size={16} strokeWidth={2.5} /> : <AlertCircle size={16} strokeWidth={2.5} />}
                        </div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">{title || 'Confirm_Operation'}</h3>
                    </div>
                    <button onClick={onClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 bg-zinc-900">
                    <p className="text-[11px] font-bold uppercase tracking-tight text-zinc-400 leading-relaxed">
                        {message}
                    </p>
                    {type === 'danger' && (
                        <div className="mt-4 flex gap-3 rounded-md border border-red-500/10 bg-red-500/5 p-4">
                            <AlertCircle size={14} className="shrink-0 text-red-500" />
                            <p className="text-[9px] font-bold uppercase tracking-widest text-red-400/60 leading-normal">
                                Warning: Target_Data_Erasure is permanent. No engine rollback available.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 px-6 py-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                    >
                        {cancelText || 'Abort'}
                    </button>
                    <button
                        onClick={() => void handleConfirm()}
                        disabled={submitting || confirmDisabled}
                        className={`flex items-center gap-2 rounded-md px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(254,254,0,0.05)] ${type === 'danger'
                            ? 'bg-red-600 text-white hover:bg-red-500'
                            : 'bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(254,254,0,0.1)]'
                            } ${confirmButtonClassName}`}
                    >
                        {submitting && <Loader2 size={12} className="animate-spin" />}
                        {confirmText || 'Execute_Commit'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;


