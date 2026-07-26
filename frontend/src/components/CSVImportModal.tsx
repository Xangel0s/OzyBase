import React, { useMemo, useState } from 'react';
import { X, FileText, ArrowRightLeft, AlertTriangle, CheckCircle2, Wand2 } from 'lucide-react';
import OzySelect from './OzySelect';

interface CSVHeader {
    index: number;
    raw: string;
    label: string;
    sampleValues: string[];
}

type CSVMapping = Record<number, string>;

interface CSVImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileName?: string;
    headers: CSVHeader[];
    sampleRows: Array<Record<number, string>>;
    totalRows: number;
    columnOptions: string[];
    initialMapping?: CSVMapping;
    onConfirm: (mapping: CSVMapping) => void;
    delimiter?: string;
    detectedDelimiter?: string;
    useHeaderRow?: boolean;
    onDelimiterChange?: (delimiter: string) => void;
    onHeaderToggle?: (enabled: boolean) => void;
    headerRowIndex?: number;
    onHeaderRowChange?: (rowIndex: number) => void;
}

const buildHeaderWarnings = (headers: CSVHeader[]) => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    const empties: string[] = [];
    headers.forEach((header: any) => {
        const key = header.raw.trim().toLowerCase();
        if (!key) {
            empties.push(header.label);
            return;
        }
        if (seen.has(key)) {
            duplicates.push(header.label);
        } else {
            seen.set(key, header.label);
        }
    });
    return { duplicates, empties };
};

const delimiterLabel = (delimiter: string) => {
    if (delimiter === ';') return 'semicolon';
    if (delimiter === '\t') return 'tab';
    if (delimiter === '|') return 'pipe';
    return 'comma';
};

const CSVImportModal: React.FC<CSVImportModalProps> = ({
    isOpen,
    onClose,
    fileName,
    headers,
    sampleRows,
    totalRows,
    columnOptions,
    initialMapping,
    onConfirm,
    delimiter,
    detectedDelimiter,
    useHeaderRow,
    onDelimiterChange,
    onHeaderToggle,
    headerRowIndex,
    onHeaderRowChange
}: any) => {
    const [mapping, setMapping] = useState<CSVMapping>(() => initialMapping || {});
    const [error, setError] = useState('');

    const { duplicates, empties } = useMemo(() => buildHeaderWarnings(headers || []), [headers]);
    const mappedCount = useMemo(() => Object.values(mapping || {}).filter(Boolean).length, [mapping]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const targets = Object.values(mapping || {}).filter(Boolean);
        if (targets.length === 0) {
            setError('Select at least one column mapping to continue.');
            return;
        }
        const uniqueTargets = new Set(targets);
        if (uniqueTargets.size !== targets.length) {
            setError('Each database column can only be mapped once.');
            return;
        }
        setError('');
        onConfirm(mapping);
    };

    const handleAutoMap = () => {
        setMapping(initialMapping || {});
        setError('');
    };

    const handleClear = () => {
        const cleared: CSVMapping = {};
        headers.forEach((header: any) => {
            cleared[header.index] = '';
        });
        setMapping(cleared);
        setError('');
    };

    return (
        <div
            className="fixed inset-0 z-110 flex items-center justify-center p-4"
            onClick={(e: any) => e.target === e.currentTarget && onClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div className="relative flex max-h-[92vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl">
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <FileText size={18} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">CSV_Ingestion_Engine</h3>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic truncate">{fileName || 'UNNAMED_STREAM.CSV'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 p-6 flex flex-col gap-6 overflow-hidden bg-zinc-900">
                    <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-widest">
                        <div className="rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-zinc-500">
                            <span className="font-mono text-zinc-400">{headers.length}</span> columns detected
                        </div>
                        <div className="rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-zinc-500">
                            <span className="font-mono text-zinc-400">{totalRows}</span> rows loaded
                        </div>
                        <div className={`rounded-md border px-3 py-1.5 transition-all ${mappedCount > 0 ? 'border-primary/30 bg-primary/10 text-primary shadow-[0_0_15px_rgba(254,254,0,0.1)]' : 'border-border bg-zinc-950 text-zinc-600'}`}>
                            <span className="font-mono">{mappedCount}</span> mapped
                        </div>
                    </div>

                    {(duplicates.length > 0 || empties.length > 0) && (
                        <div className="flex gap-3 rounded-md border border-red-500/20 bg-red-500/5 p-4">
                            <AlertTriangle size={16} className="shrink-0 text-red-500" />
                            <div className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-red-400/80">
                                {duplicates.length > 0 && <p>Integrity_Warning: Duplicate_Headers [{duplicates.join(', ')}]</p>}
                                {empties.length > 0 && <p>Integrity_Warning: Null_Headers [{empties.join(', ')}]</p>}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 italic">Column Mapping</h4>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleAutoMap}
                                className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-primary transition-all hover:bg-primary/20"
                            >
                                <Wand2 size={12} strokeWidth={2.5} /> Vector_Match
                            </button>
                            <button
                                onClick={handleClear}
                                className="rounded-md border border-border bg-zinc-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-all hover:border-zinc-600 hover:text-zinc-300"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                        <div className="flex items-center gap-3">
                            <span className="italic">Separator:</span>
                            <OzySelect
                                value={delimiter === 'auto' ? 'auto' : (delimiter || detectedDelimiter || ',')}
                                onChange={(e: any) => onDelimiterChange?.(e.target.value)}
                                wrapperClassName="min-w-[160px] rounded-md border-border bg-zinc-950 shadow-none"
                                selectClassName="h-9 px-3 text-[10px] font-mono tracking-widest text-zinc-400"
                            >
                                <option value="auto">AUTO_SCAN ({delimiterLabel(detectedDelimiter || ',')})</option>
                                <option value=",">COMMA_ASCII (44)</option>
                                <option value=";">SEMICOLON_ASCII (59)</option>
                                <option value="\t">TAB_ASCII (09)</option>
                                <option value="|">PIPE_ASCII (124)</option>
                            </OzySelect>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-zinc-400">
                            <input
                                type="checkbox"
                                checked={!!useHeaderRow}
                                onChange={(e: any) => onHeaderToggle?.(e.target.checked)}
                                className="h-4 w-4 rounded-sm border-zinc-800 bg-zinc-950 text-primary focus:ring-0 focus:ring-offset-0"
                            />
                            <span>Use_Header_Row</span>
                        </label>
                        <div className="flex items-center gap-3">
                            <span className="italic">Header_Offset:</span>
                            <input
                                type="number"
                                min={1}
                                value={headerRowIndex || 1}
                                onChange={(e: any) => onHeaderRowChange?.(Math.max(1, Number(e.target.value) || 1))}
                                className="w-16 rounded-md border border-border bg-zinc-950 px-2 py-1.5 text-center font-mono text-[10px] text-zinc-400 outline-none focus:border-primary/30 disabled:opacity-30"
                                disabled={!useHeaderRow}
                            />
                        </div>
                    </div>

                    <div className="grid flex-1 grid-cols-1 xl:grid-cols-2 gap-6 min-h-0">
                        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-border bg-zinc-950/50 p-2">
                            <div className="flex-1 overflow-auto custom-scrollbar pr-2 space-y-1">
                                {headers.map((header: any) => {
                                    const isMapped = !!mapping[header.index];
                                    return (
                                        <div key={header.index} className={`flex flex-col md:flex-row md:items-center gap-4 rounded-md border p-2.5 transition-all ${isMapped ? 'border-primary/20 bg-zinc-900' : 'border-transparent bg-zinc-900/30'}`}>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-[11px] font-bold uppercase tracking-widest ${isMapped ? 'text-primary' : 'text-zinc-400'}`}>{header.label}</div>
                                                <div className="text-[9px] font-mono text-zinc-700 uppercase tracking-tighter truncate mt-0.5">
                                                    {header.sampleValues.length > 0 ? header.sampleValues.join(' | ') : 'EMPTY_BUFFER'}
                                                </div>
                                            </div>
                                            <ArrowRightLeft size={12} className={isMapped ? 'text-primary' : 'text-zinc-700'} />
                                            <OzySelect
                                                value={mapping[header.index] || ''}
                                                onChange={(e: any) => setMapping((prev: any) => ({ ...prev, [header.index]: e.target.value }))}
                                                wrapperClassName={`w-full md:w-[220px] rounded-md border shadow-none transition-all ${isMapped ? 'border-primary/30 bg-zinc-950' : 'border-zinc-800 bg-zinc-950'}`}
                                                selectClassName={`h-10 px-3 text-[10px] font-bold uppercase tracking-widest ${isMapped ? 'text-white' : 'text-zinc-600'}`}
                                            >
                                                <option value="">SKIP_VECTOR</option>
                                                {columnOptions.map((col: any) => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </OzySelect>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-border bg-zinc-950/50 p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Data_Registry_Preview</h4>
                                <span className="font-mono text-[9px] text-zinc-700 uppercase tracking-widest">Buffer: Head_{sampleRows.length}</span>
                            </div>
                            <div className="flex-1 overflow-auto custom-scrollbar border border-zinc-800 rounded-md bg-zinc-950">
                                <table className="w-full text-left font-mono text-[10px]">
                                    <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900">
                                        <tr className="uppercase tracking-widest text-zinc-600">
                                            <th className="w-12 border-r border-zinc-800 px-3 py-2.5 font-bold">#</th>
                                            {headers.map((header: any) => (
                                                <th key={header.index} className="px-3 py-2.5 font-bold whitespace-nowrap">
                                                    {header.label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="text-zinc-500">
                                        {sampleRows.map((row: any, rowIdx: any) => (
                                            <tr key={rowIdx} className="border-t border-zinc-900 hover:bg-zinc-900/50">
                                                <td className="border-r border-zinc-900 px-3 py-2 text-zinc-700">
                                                    {String(rowIdx + 1).padStart(3, '0')}
                                                </td>
                                                {headers.map((header: any) => (
                                                    <td key={header.index} className="px-3 py-2 whitespace-nowrap">
                                                        {row[header.index] ?? ''}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-700">
                                <CheckCircle2 size={12} className="text-primary" />
                                Duplicates filtered
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-center text-[10px] font-bold uppercase tracking-widest text-red-500">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 px-6 py-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                    >
                        Abort_Ingestion
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="rounded-md bg-primary px-8 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-primary/90 shadow-[0_0_20px_rgba(254,254,0,0.1)] active:scale-95"
                    >
                        Execute_Ingest
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CSVImportModal;


