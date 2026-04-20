import React, { useEffect, useState } from 'react';
import {
    AtSign,
    Calendar,
    CheckCircle2,
    Clock,
    Code,
    Cpu,
    Database,
    DollarSign,
    Hash,
    Key,
    Layers,
    Loader2,
    Save,
    Settings2,
    Globe,
    type LucideIcon,
    X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

interface EditColumnModalProps {
    isOpen: boolean;
    onClose: () => void;
    tableName: string;
    column: {
        name: string;
        type: string;
        required?: boolean;
        isPrimary?: boolean;
        isSystem?: boolean;
    } | null;
    onColumnUpdated: () => void;
}

interface ColumnTypeOption {
    label: string;
    value: string;
    icon: LucideIcon;
    desc: string;
}

const COLUMN_TYPES: ColumnTypeOption[] = [
    { label: 'text', value: 'text', icon: AtSign, desc: 'Variable-length character string' },
    { label: 'varchar', value: 'varchar', icon: AtSign, desc: 'Variable-length character string' },
    { label: 'uuid', value: 'uuid', icon: Key, desc: 'Universally unique identifier' },
    { label: 'int2', value: 'int2', icon: Hash, desc: 'Signed two-byte integer' },
    { label: 'int4', value: 'int4', icon: Hash, desc: 'Signed four-byte integer' },
    { label: 'int8', value: 'int8', icon: Hash, desc: 'Signed eight-byte integer' },
    { label: 'float4', value: 'float4', icon: Hash, desc: 'Single precision floating point' },
    { label: 'float8', value: 'float8', icon: Hash, desc: 'Double precision floating point' },
    { label: 'numeric', value: 'numeric', icon: Hash, desc: 'Exact numeric precision' },
    { label: 'json', value: 'json', icon: Code, desc: 'Textual JSON data' },
    { label: 'jsonb', value: 'jsonb', icon: Code, desc: 'Binary JSON data' },
    { label: 'date', value: 'date', icon: Calendar, desc: 'Calendar date' },
    { label: 'time', value: 'time', icon: Calendar, desc: 'Time of day' },
    { label: 'timetz', value: 'timetz', icon: Calendar, desc: 'Time with zone' },
    { label: 'timestamp', value: 'timestamp', icon: Calendar, desc: 'Date and time' },
    { label: 'timestamptz', value: 'timestamptz', icon: Calendar, desc: 'Date and time with zone' },
    { label: 'bool', value: 'bool', icon: CheckCircle2, desc: 'Logical boolean' },
    { label: 'bytea', value: 'bytea', icon: Database, desc: 'Binary string' },
    { label: 'inet', value: 'inet', icon: Globe, desc: 'IP address' },
    { label: 'cidr', value: 'cidr', icon: Globe, desc: 'Network range' },
    { label: 'macaddr', value: 'macaddr', icon: Cpu, desc: 'MAC address' },
    { label: 'interval', value: 'interval', icon: Clock, desc: 'Time span' },
    { label: 'money', value: 'money', icon: DollarSign, desc: 'Currency value' },
    { label: 'text_array', value: 'text_array', icon: Layers, desc: 'Array of strings' },
    { label: 'int_array', value: 'int_array', icon: Layers, desc: 'Array of integers' },
];

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Failed to update column';
};

const EditColumnModal: React.FC<EditColumnModalProps> = ({ isOpen, onClose, tableName, column, onColumnUpdated }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('text');
    const [required, setRequired] = useState(false);
    const [defaultMode, setDefaultMode] = useState<'keep' | 'set' | 'drop'>('keep');
    const [defaultValue, setDefaultValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(false);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closingRef = React.useRef(false);

    useEffect(() => {
        if (!column) return;
        setName(column.name);
        setType(column.type || 'text');
        setRequired(Boolean(column.required));
        setDefaultMode('keep');
        setDefaultValue('');
        setError(null);
    }, [column, isOpen]);

    useEffect(() => {
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

    useEffect(() => () => {
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

    if (!shouldRender || !column) return null;

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const payload: Record<string, unknown> = {};
            const trimmedName = name.trim();
            if (trimmedName && trimmedName !== column.name) {
                payload.next_name = trimmedName;
            }
            if (type !== column.type) {
                payload.type = type;
            }
            if (required !== Boolean(column.required)) {
                payload.required = required;
            }
            if (defaultMode !== 'keep') {
                payload.default_mode = defaultMode;
                payload.default_value = defaultMode === 'set' ? defaultValue : null;
            }

            if (Object.keys(payload).length === 0) {
                requestClose();
                return;
            }

            const response = await fetchWithAuth(`/api/tables/${tableName}/columns/${column.name}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error || 'Failed to update column');
            }

            onColumnUpdated();
            requestClose();
        } catch (submissionError) {
            setError(getErrorMessage(submissionError));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-80 flex items-center justify-center p-4 transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(event) => event.target === event.currentTarget && requestClose()}
        >
            <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
            <div
                className={`ozy-dialog-panel w-full max-w-3xl origin-top transform-gpu transition-all ${isVisible ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-1.5 scale-[0.98] opacity-0'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >
                <div className="flex items-center justify-between border-b border-border px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                            <Settings2 size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-medium] text-white">Edit Column</h3>
                            <p className="mt-1 text-[10px] font-medium] text-zinc-500">
                                {tableName}.{column.name}
                            </p>
                        </div>
                    </div>
                    <button onClick={requestClose} className="text-zinc-500 transition-colors hover:text-zinc-200">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 p-6">
                    {error ? (
                        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-[11px] font-semibold text-red-300">
                            {error}
                        </div>
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="space-y-2">
                            <label className="text-[10px] font-medium] text-zinc-500">Column Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                required
                                className="w-full rounded-md border border-[#2b2b2b] bg-[#101010] px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-primary/40"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-medium] text-zinc-500">Default Behavior</label>
                            <div className="grid grid-cols-3 gap-2 rounded-md border border-[#2b2b2b] bg-[#101010] p-1">
                                {[
                                    { value: 'keep', label: 'Keep' },
                                    { value: 'set', label: 'Set' },
                                    { value: 'drop', label: 'Drop' },
                                ].map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        onClick={() => setDefaultMode(item.value as 'keep' | 'set' | 'drop')}
                                        className={`rounded-md px-3 py-2 text-[10px] font-medium] transition-colors ${
                                            defaultMode === item.value
                                                ? 'bg-primary text-black'
                                                : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {defaultMode === 'set' ? (
                        <div className="space-y-2">
                            <label className="text-[10px] font-medium] text-zinc-500">Default Value</label>
                            <input
                                type="text"
                                value={defaultValue}
                                onChange={(event) => setDefaultValue(event.target.value)}
                                placeholder="for example now() or draft"
                                className="w-full rounded-md border border-[#2b2b2b] bg-[#101010] px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-primary/40"
                            />
                            <p className="text-[11px] text-zinc-500">
                                Existing defaults stay untouched unless you choose <span className="text-zinc-300">Set</span> or <span className="text-zinc-300">Drop</span>.
                            </p>
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-md border border-[#2b2b2b] bg-[#101010] px-4 py-4">
                            <div>
                                <p className="text-sm font-semibold text-zinc-200">Required column</p>
                                <p className="mt-1 text-[11px] text-zinc-500">Toggle the `NOT NULL` constraint for this field.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRequired((current) => !current)}
                                className={`relative h-7 w-12 rounded-full transition-colors ${required ? 'bg-primary' : 'bg-zinc-800'}`}
                            >
                                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${required ? 'left-6 bg-black' : 'left-1'}`} />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-medium] text-zinc-500">Data Type</label>
                            <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-[#2b2b2b] bg-[#101010] p-2 md:grid-cols-2 custom-scrollbar">
                                {COLUMN_TYPES.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        onClick={() => setType(item.value)}
                                        className={`flex items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                                            type === item.value
                                                ? 'border-primary/40 bg-primary/10 text-primary'
                                                : 'border-transparent bg-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/70 hover:text-zinc-200'
                                        }`}
                                    >
                                        <item.icon size={16} className={type === item.value ? 'text-primary' : 'text-zinc-700'} />
                                        <div className="min-w-0">
                                            <div className="truncate text-[11px] font-medium]">{item.label}</div>
                                            <div className="truncate text-[10px] text-zinc-600">{item.desc}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
                        <button
                            type="button"
                            onClick={requestClose}
                            className="rounded-md border border-[#2b2b2b] bg-[#141414] px-4 py-2 text-[10px] font-medium] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[10px] font-medium] text-black transition-colors hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            Save changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditColumnModal;


