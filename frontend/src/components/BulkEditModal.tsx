import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import OzySelect from './OzySelect';

interface ColumnSchema {
    name: string;
    [key: string]: unknown;
}

interface BulkEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    schema?: ColumnSchema[];
    onSubmit: (payload: Record<string, string>) => Promise<void> | void;
}

const BulkEditModal = ({ isOpen, onClose, schema = [], onSubmit }: BulkEditModalProps) => {
    const [column, setColumn] = useState('');
    const [value, setValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const editableColumns = schema.filter((col: any) => col.name !== 'id' && col.name !== 'created_at');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!column) return;
        setIsSubmitting(true);
        try {
            await onSubmit({ [column]: value });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-90 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-lg overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl transition-all">
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <Save className="text-primary" size={16} />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Bulk Edit</h3>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic">Target: Selected_Nodes</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-zinc-900">
                    <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">Target_Field</label>
                        <OzySelect
                            value={column}
                            onChange={(e: any) => setColumn(e.target.value)}
                            wrapperClassName="rounded-md border-border bg-zinc-950 shadow-none"
                            selectClassName="h-10 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400"
                        >
                            <option value="">Select_Attribute...</option>
                            {editableColumns.map((col: any) => (
                                <option key={col.name} value={col.name}>{col.name}</option>
                            ))}
                        </OzySelect>
                    </div>

                    <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">Override_Value</label>
                        <input
                            type="text"
                            value={value}
                            onChange={(e: any) => setValue(e.target.value)}
                            placeholder="NEW_LITERAL..."
                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 -mx-6 -mb-6 px-6 py-4 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                        >
                            Abort_Edit
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !column}
                            className="flex items-center gap-2 rounded-md bg-primary px-8 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-primary/90 shadow-[0_0_20px_rgba(254,254,0,0.1)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save size={14} strokeWidth={3} />
                            Commit_Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BulkEditModal;


