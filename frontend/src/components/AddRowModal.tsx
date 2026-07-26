import React, { useState } from 'react';
import {
    X,
    AtSign,
    Hash,
    Calendar,
    CheckCircle2,
    Database,
    Key,
    Loader2,
    Check,
    Plus,
    Edit2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

interface RowSchemaColumn {
    name: string;
    type: string;
    required?: boolean;
    default?: any;
}

type RowData = Record<string, unknown> & { id?: string | number };

interface AddRowModalProps {
    isOpen: boolean;
    onClose?: () => void;
    schema: RowSchemaColumn[];
    tableName: string;
    onRecordAdded: () => void;
    initialData?: RowData | null;
    rowIdColumn?: string;
}

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Failed to process row';
};

const toInputValue = (value: unknown): string | number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
};

const toBooleanValue = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
};

const toDateTimeLocalValue = (value: unknown): string => {
    if (value == null || value === '') return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 16);
};

const normalizeColumnType = (type: string): string => String(type || '').toLowerCase();

const isBooleanType = (type: string): boolean => normalizeColumnType(type).includes('bool');

const isNumericType = (type: string): boolean => {
    const normalized = normalizeColumnType(type);
    return ['int', 'num', 'float', 'double', 'decimal', 'real', 'serial'].some((token) => normalized.includes(token));
};

const isJSONType = (type: string): boolean => {
    const normalized = normalizeColumnType(type);
    return normalized.includes('json');
};

const isDateType = (type: string): boolean => {
    const normalized = normalizeColumnType(type);
    return normalized === 'date';
};

const isTimeType = (type: string): boolean => {
    const normalized = normalizeColumnType(type);
    return normalized === 'time' || normalized === 'timetz';
};

const isDateTimeType = (type: string): boolean => {
    const normalized = normalizeColumnType(type);
    return normalized === 'datetime' || normalized.includes('timestamp');
};

const isSensitiveColumn = (name: string): boolean => {
    const n = (name || '').toLowerCase();
    return ['password', 'hash', 'secret', 'token', 'passwd', 'key_secret'].some((token) => n.includes(token));
};

const toTemporalInputType = (type: string): 'date' | 'time' | 'datetime-local' => {
    if (isDateType(type)) return 'date';
    if (isTimeType(type)) return 'time';
    return 'datetime-local';
};

const toTemporalInputValue = (value: unknown, type: string): string => {
    if (value == null || value === '') return '';

    if (isDateType(type)) {
        const date = new Date(String(value));
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
        return String(value).slice(0, 10);
    }

    if (isTimeType(type)) {
        const match = String(value).match(/^(\d{2}:\d{2})/);
        return match ? match[1] : '';
    }

    return toDateTimeLocalValue(value);
};

const coerceValueForColumn = (column: RowSchemaColumn, value: unknown): unknown => {
    const normalizedType = normalizeColumnType(column.type);
    const stringValue = typeof value === 'string' ? value.trim() : value;
    const isBlank = stringValue === '' || stringValue == null;

    if (isBlank) {
        if (normalizedType.includes('text') || normalizedType.includes('char')) {
            return '';
        }
        return null;
    }

    if (isBooleanType(normalizedType)) {
        return toBooleanValue(value);
    }

    if (isNumericType(normalizedType)) {
        const numericValue = Number(value);
        if (Number.isNaN(numericValue)) {
            throw new Error(`Invalid numeric value for ${column.name}`);
        }
        return numericValue;
    }

    if (isJSONType(normalizedType) && typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (error) {
            throw new Error(`Invalid JSON value for ${column.name}`);
        }
    }

    return value;
};

const buildRowPayload = (schema: RowSchemaColumn[], formData: RowData): RowData => {
    return schema.reduce<RowData>((payload, column) => {
        if (!Object.prototype.hasOwnProperty.call(formData, column.name)) {
            return payload;
        }
        payload[column.name] = coerceValueForColumn(column, formData[column.name]);
        return payload;
    }, {});
};

const AddRowModal: React.FC<AddRowModalProps> = ({ isOpen, onClose, schema, tableName, onRecordAdded, initialData, rowIdColumn }) => {
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closingRef = React.useRef(false);
    const [formData, setFormData] = useState<RowData>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    React.useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData({});
        }
    }, [initialData, isOpen]);

    React.useEffect(() => {
        if (isOpen) {
            closingRef.current = false;
            setShouldRender(true);
            const frame = requestAnimationFrame(() => setIsVisible(true));
            return () => cancelAnimationFrame(frame);
        }

        if (!shouldRender) return undefined;
        setIsVisible(false);
        const timer = setTimeout(() => {
            setShouldRender(false);
        }, MODAL_EXIT_MS);
        return () => clearTimeout(timer);
    }, [isOpen, shouldRender]);

    React.useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const requestClose = React.useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setIsVisible(false);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
            closingRef.current = false;
            onClose?.();
        }, MODAL_EXIT_MS);
    }, [onClose]);

    if (!shouldRender) return null;

    const handleInputChange = (field: string, value: unknown) => {
        setFormData((prev: any) => ({
            ...prev,
            [field]: value
        }));
    };

    const getTypeIcon = (type: string, name: string) => {
        const t = (type || '').toLowerCase();
        const n = (name || '').toLowerCase();

        if (isSensitiveColumn(n)) return <Key size={16} className="text-primary" />;
        if (t.includes('uuid')) return <Key size={16} className="text-zinc-500" />;
        if (t.includes('text') || t.includes('char')) return <AtSign size={16} className="text-zinc-500" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={16} className="text-zinc-500" />;
        if (t.includes('bool')) return <CheckCircle2 size={16} className="text-zinc-500" />;
        if (t.includes('num') || t.includes('int') || t.includes('float')) return <Hash size={16} className="text-zinc-500" />;
        return <Database size={16} className="text-zinc-500" />;
    };

    const renderInput = (column: RowSchemaColumn) => {
        const { name, type, required = false } = column;
        const val = formData[name];
        const boolValue = toBooleanValue(val);

        if (isBooleanType(type)) {
            return (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => handleInputChange(name, !boolValue)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${boolValue ? 'bg-primary' : 'bg-zinc-800'}`}
                    >
                        <div className={`absolute top-1 bottom-1 w-3 h-3 bg-white rounded-full transition-all ${boolValue ? 'left-6 bg-black' : 'left-1'}`} />
                    </button>
                    <span className="text-sm text-zinc-400">{boolValue ? 'True' : 'False'}</span>
                </div>
            );
        }

        if (isDateType(type) || isTimeType(type) || isDateTimeType(type)) {
            return (
                <input
                    type={toTemporalInputType(type)}
                    required={required}
                    value={toTemporalInputValue(val, type)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                    onChange={(e: any) => handleInputChange(name, e.target.value)}
                />
            );
        }

        if (isNumericType(type)) {
            return (
                <input
                    type="number"
                    value={toInputValue(val)}
                    required={required}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                    onChange={(e: any) => handleInputChange(name, e.target.value)}
                    placeholder="Enter number..."
                />
            );
        }

        if (isJSONType(type)) {
            return (
                <textarea
                    value={toInputValue(val)}
                    required={required}
                    rows={5}
                    className="w-full resize-y bg-background border border-border rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 placeholder:text-zinc-700"
                    onChange={(e: any) => handleInputChange(name, e.target.value)}
                    placeholder='{"key":"value"}'
                />
            );
        }

        return (
            <input
                type={isSensitiveColumn(name) ? 'password' : 'text'}
                value={toInputValue(val)}
                required={required}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 placeholder:text-zinc-700"
                onChange={(e: any) => handleInputChange(name, e.target.value)}
                placeholder={`Enter ${name}...`}
            />
        );
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const isEdit = !!initialData;
            const rowId = initialData?.[rowIdColumn || 'id'] ?? initialData?.id;
            if (isEdit && (rowId === undefined || rowId === null || rowId === '')) {
                throw new Error('Missing row identifier for edit operation');
            }
            const url = isEdit
                ? `/api/tables/${tableName}/rows/${encodeURIComponent(String(rowId))}`
                : `/api/tables/${tableName}/rows`;
            const payload = buildRowPayload(schema, formData);

            const res = await fetchWithAuth(url, {
                method: isEdit ? 'PATCH' : 'POST',
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to process row');
            }

            onRecordAdded();
            requestClose();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-100 flex items-center justify-center p-4 transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(e: any) => e.target === e.currentTarget && requestClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div
                className={`relative w-full max-w-5xl origin-top rounded-md border border-border bg-zinc-900 shadow-2xl transition-all transform-gpu ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-95'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-zinc-950/50">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-900 border border-border shadow-inner">
                            {initialData ? <Edit2 className="text-primary" size={16} /> : <Plus className="text-primary" size={16} />}
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">{initialData ? 'Edit Record' : 'New Record'}</h3>
                            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest italic">Table: {tableName}</p>
                        </div>
                    </div>
                    <button onClick={requestClose} className="rounded-md p-2 text-zinc-600 hover:text-white hover:bg-zinc-800 transition-all">
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar bg-zinc-900">
                        {error && (
                            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-md text-red-500 text-[10px] font-bold uppercase tracking-widest text-center">
                                Error: {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
                            {schema.map((col: any) => (
                                <div key={col.name} className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                            <span className="text-zinc-700">{getTypeIcon(col.type, col.name)}</span>
                                            {col.name}
                                            {col.required && <span className="text-primary italic">*</span>}
                                        </label>
                                        <span className="font-mono text-[9px] font-bold text-zinc-700 uppercase tracking-tighter">
                                            [{col.type}]
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        {renderInput(col)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-zinc-950/50 border-t border-border flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={requestClose}
                            className="px-4 py-2 text-[10px] font-bold text-zinc-600 hover:text-zinc-300 uppercase tracking-widest transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 bg-primary text-black px-8 py-2.5 rounded-md font-bold text-[10px] uppercase tracking-widest transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(254,254,0,0.1)]"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>Syncing...</span>
                                </>
                            ) : (
                                <>
                                    {initialData ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
                                    <span>{initialData ? 'Save Changes' : 'Insert Row'}</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddRowModal;


