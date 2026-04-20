import React, { useState } from 'react';
import {
    X,
    Plus,
    Loader2,
    Database,
    Hash,
    AtSign,
    Calendar,
    CheckCircle2,
    Key,
    Code,
    Globe,
    DollarSign,
    Layers,
    Clock,
    Cpu,
    type LucideIcon
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

interface AddColumnModalProps {
    isOpen: boolean;
    onClose: () => void;
    tableName: string;
    onColumnAdded: () => void;
}

interface ColumnTypeOption {
    label: string;
    value: string;
    icon: LucideIcon;
    desc: string;
}

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Failed to add column';
};

const AddColumnModal: React.FC<AddColumnModalProps> = ({ isOpen, onClose, tableName, onColumnAdded }: any) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('text');
    const [required, setRequired] = useState(false);
    const [defaultValue, setDefaultValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closingRef = React.useRef(false);

    React.useEffect(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        if (isOpen) {
            closingRef.current = false;
            setShouldRender(true);
            requestAnimationFrame(() => setIsVisible(true));
            return undefined;
        }

        if (!shouldRender) return undefined;

        closingRef.current = true;
        setIsVisible(false);
        closeTimerRef.current = setTimeout(() => {
            setShouldRender(false);
            closingRef.current = false;
        }, MODAL_EXIT_MS);

        return () => {
            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, [isOpen, shouldRender]);

    React.useEffect(() => () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
        }
    }, []);

    const requestClose = React.useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setIsVisible(false);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
            setShouldRender(false);
            closingRef.current = false;
            onClose();
        }, MODAL_EXIT_MS);
    }, [onClose]);

    if (!shouldRender) return null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/columns`, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    type,
                    required,
                    default: defaultValue || null
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to add column');
            }

            onColumnAdded();
            requestClose();
            setName('');
            setType('text');
            setRequired(false);
            setDefaultValue('');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const types: ColumnTypeOption[] = [
        { label: 'text', value: 'text', icon: AtSign, desc: 'Variable-length character string' },
        { label: 'varchar', value: 'varchar', icon: AtSign, desc: 'Variable-length character string' },
        { label: 'uuid', value: 'uuid', icon: Key, desc: 'Universally unique identifier' },
        { label: 'int2', value: 'int2', icon: Hash, desc: 'Signed two-byte integer' },
        { label: 'int4', value: 'int4', icon: Hash, desc: 'Signed four-byte integer' },
        { label: 'int8', value: 'int8', icon: Hash, desc: 'Signed eight-byte integer' },
        { label: 'float4', value: 'float4', icon: Hash, desc: 'Single precision floating-point number' },
        { label: 'float8', value: 'float8', icon: Hash, desc: 'Double precision floating-point number' },
        { label: 'numeric', value: 'numeric', icon: Hash, desc: 'Exact numeric of selectable precision' },
        { label: 'json', value: 'json', icon: Code, desc: 'Textual JSON data' },
        { label: 'jsonb', value: 'jsonb', icon: Code, desc: 'Binary JSON data, decomposed' },
        { label: 'date', value: 'date', icon: Calendar, desc: 'Calendar date (year, month, day)' },
        { label: 'time', value: 'time', icon: Calendar, desc: 'Time of day (no time zone)' },
        { label: 'timetz', value: 'timetz', icon: Calendar, desc: 'Time of day, including time zone' },
        { label: 'timestamp', value: 'timestamp', icon: Calendar, desc: 'Date and time (no time zone)' },
        { label: 'timestamptz', value: 'timestamptz', icon: Calendar, desc: 'Date and time, including time zone' },
        { label: 'bool', value: 'bool', icon: CheckCircle2, desc: 'Logical boolean (true/false)' },
        { label: 'bytea', value: 'bytea', icon: Database, desc: 'Variable-length binary string' },
        { label: 'inet', value: 'inet', icon: Globe, desc: 'IPv4 or IPv6 host address' },
        { label: 'cidr', value: 'cidr', icon: Globe, desc: 'IPv4 or IPv6 network address' },
        { label: 'macaddr', value: 'macaddr', icon: Cpu, desc: 'MAC address' },
        { label: 'interval', value: 'interval', icon: Clock, desc: 'Time span / Duration' },
        { label: 'money', value: 'money', icon: DollarSign, desc: 'Currency / Monetary amount' },
        { label: 'text_array', value: 'text_array', icon: Layers, desc: 'Array of strings' },
        { label: 'int_array', value: 'int_array', icon: Layers, desc: 'Array of integers' },
    ];

    return (
        <div
            className={`fixed inset-0 z-60 flex items-center justify-center p-4 transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(e: any) => e.target === e.currentTarget && requestClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div
                className={`relative w-full max-w-5xl origin-top rounded-md border border-border bg-zinc-900 shadow-2xl transition-all transform-gpu ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-95'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <Plus className="text-primary" size={16} />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Add New Field</h3>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic">Target Table: {tableName}</p>
                        </div>
                    </div>
                    <button onClick={requestClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-zinc-900">
                    {error && (
                        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4 text-center text-[10px] font-bold uppercase tracking-widest text-red-500">
                            Execution Error: {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">Field Identifier</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e: any) => setName(e.target.value)}
                                    required
                                    placeholder="IDENTIFIER..."
                                    className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">Default Literal</label>
                                <input
                                    type="text"
                                    value={defaultValue}
                                    onChange={(e: any) => setDefaultValue(e.target.value)}
                                    placeholder="NULL..."
                                    className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">Data Type Manifest</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto custom-scrollbar border border-border bg-zinc-950 p-2 rounded-md">
                                {types.map((t: any) => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => setType(t.value)}
                                        className={`flex items-center gap-3 rounded-md border p-2.5 transition-all text-left group ${type === t.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent bg-zinc-900/50 text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400'}`}
                                    >
                                        <t.icon size={14} className={type === t.value ? 'text-primary' : 'text-zinc-800 transition-colors group-hover:text-zinc-600'} />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[10px] font-bold uppercase tracking-widest leading-none">{t.label}</span>
                                            <span className="text-[8px] font-bold uppercase tracking-tighter text-zinc-700 leading-none mt-1 group-hover:text-zinc-600">{t.desc}</span>
                                        </div>
                                        {type === t.value && <div className="ml-auto h-1 w-1 rounded-full bg-primary shadow-[0_0_8px_rgba(254,254,0,0.8)]" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-md border border-border bg-zinc-950/50 p-4">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Constraint: REQUIRED</span>
                                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 italic mt-0.5">Enforce Non-Null Values</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRequired(!required)}
                                className={`relative h-5 w-10 rounded-full transition-all ${required ? 'bg-primary shadow-[0_0_15px_rgba(254,254,0,0.1)]' : 'bg-zinc-800'}`}
                            >
                                <div className={`absolute top-1 bottom-1 h-3 w-3 rounded-full transition-all ${required ? 'left-6 bg-black' : 'left-1 bg-zinc-600'}`} />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 -mx-6 -mb-6 px-6 py-4 mt-6">
                        <button
                            type="button"
                            onClick={requestClose}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 rounded-md bg-primary px-8 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-primary/90 shadow-[0_0_20px_rgba(254,254,0,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={3} />}
                            Add Field
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddColumnModal;


