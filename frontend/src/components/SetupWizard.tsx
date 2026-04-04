import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
    ShieldCheck,
    Zap,
    Server,
    Globe,
    Lock,
    CheckCircle,
    ArrowRight,
    Database,
    Loader2,
    ScanSearch,
    Sparkles,
    Shield,
    FileSpreadsheet,
    FileJson,
    MousePointerClick,
    TableProperties,
    X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

type SetupMode = 'clean' | 'secure' | 'migrate';
type WizardStep = 'mode' | 'prepare' | 'account';
type MigrationSourceKind = 'csv' | 'mongo_json' | 'mysql_sql' | 'sqlite_sql' | 'sqlserver_sql' | 'postgres_sql';
type MigrationInputMode = 'upload' | 'paste';
type MigrationPrepareStage = 'source' | 'upload' | 'analysis';

interface SetupFormData {
    email: string;
    password: string;
    confirmPassword: string;
    country: string;
}

interface SetupWizardProps {
    onComplete: (token: string) => void;
}

interface SetupActionSummary {
    key?: string;
    label?: string;
    detail?: string;
}

interface SetupResponse {
    token?: string;
    error?: string;
    summary?: string;
    applied_actions?: SetupActionSummary[];
    preserved_table_count?: number;
    migrated_table_count?: number;
    imported_row_count?: number;
    migration_warnings?: string[];
}

interface MigrationDraft {
    sourceKind: MigrationSourceKind;
    tableName: string;
    rawInput: string;
    importRows: boolean;
}

interface MigrationPreviewColumn {
    name: string;
    type: string;
    required: boolean;
    is_primary?: boolean;
}

interface MigrationPreviewTable {
    name: string;
    display_name: string;
    column_count: number;
    detected_rows: number;
    translated_sql: string;
    columns: MigrationPreviewColumn[];
    sample_rows?: Record<string, unknown>[];
    has_more_rows?: boolean;
    warnings?: string[];
}

interface MigrationPreviewResponse {
    source_kind: MigrationSourceKind;
    summary: string;
    table_count: number;
    row_count: number;
    warnings?: string[];
    tables: MigrationPreviewTable[];
}

interface MigrationSourceDescriptor {
    id: MigrationSourceKind;
    label: string;
    title: string;
    hint: string;
    accept: string;
    requiresTableName: boolean;
    icon: LucideIcon;
    accentClass: string;
}

interface ModeDescriptor {
    icon: LucideIcon;
    label: string;
    title: string;
    description: string;
    accentClass: string;
    iconClass: string;
    iconPanelClass: string;
    badge?: string;
    bullets: string[];
    prepEyebrow: string;
    prepTitle: string;
    prepDescription: string;
    prepSteps: string[];
    accountTitle: string;
    accountDescription: string;
    accountBullets: string[];
    footnote: string;
}

const modeDetails: Record<SetupMode, ModeDescriptor> = {
    clean: {
        icon: Zap,
        label: 'Manual baseline',
        title: 'Do it myself',
        description: 'Bootstrap the admin account only. No extra security presets are applied during setup.',
        accentClass: 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700',
        iconClass: 'text-white',
        iconPanelClass: 'bg-zinc-800 group-hover:bg-zinc-700',
        bullets: [
            'Admin bootstrap only',
            'No geo-fencing preset',
            'You tune ACL/RLS later',
        ],
        prepEyebrow: 'Manual bootstrap',
        prepTitle: 'Loading the baseline path',
        prepDescription: 'We keep setup minimal here: finish the admin bootstrap and leave the security hardening for after login.',
        prepSteps: [
            'Reviewing the baseline bootstrap path',
            'Skipping automatic policy presets',
            'Preparing the admin registration handoff',
        ],
        accountTitle: 'Admin bootstrap only',
        accountDescription: 'This path does not touch security policies during setup. It simply finishes the first admin account so you can configure the rest yourself.',
        accountBullets: [
            'No extra preset is written before login.',
            'Your existing tables remain untouched.',
            'Security rules are configured later from the dashboard.',
        ],
        footnote: 'Manual baseline does not create extra presets or migrate data.',
    },
    secure: {
        icon: ShieldCheck,
        label: 'Secure preset',
        title: 'Secure Fortress',
        description: 'Seed geo-fencing from your detected location and leave an audit trail of the secure bootstrap.',
        accentClass: 'border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40',
        iconClass: 'text-primary',
        iconPanelClass: 'bg-primary/20',
        badge: 'Recommended',
        bullets: [
            'Geo-fencing preset from your location',
            'Security bootstrap audit event',
            'ACL/RLS can still be refined later',
        ],
        prepEyebrow: 'Security preset',
        prepTitle: 'Preparing the secure bootstrap',
        prepDescription: 'This option preloads the first geo-fencing rule with your detected country and records the secure initialization event.',
        prepSteps: [
            'Building the geo-fencing bootstrap preset',
            'Preparing the detected country allowlist',
            'Queuing the secure initialization audit entry',
        ],
        accountTitle: 'Geo-fencing will be seeded automatically',
        accountDescription: 'After you register the admin account, setup will save a geo-fencing policy using your detected country and record a secure bootstrap event.',
        accountBullets: [
            'Geo-fencing is the preset that really gets applied here.',
            'This mode does not auto-create RBAC rules for your tables.',
            'You can adjust ACL/RLS after you enter the dashboard.',
        ],
        footnote: 'Secure Fortress applies geo-fencing and a security audit entry, not a full RBAC template.',
    },
    migrate: {
        icon: Database,
        label: 'Migration studio',
        title: 'Migrate existing database',
        description: 'Translate SQL, CSV, or Mongo-like JSON into PostgreSQL and optionally import the first dataset during setup.',
        accentClass: 'border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/40',
        iconClass: 'text-blue-400',
        iconPanelClass: 'bg-blue-500/20',
        bullets: [
            'Schema translation to PostgreSQL',
            'CSV and Mongo-like ETL during setup',
            'DDL import from MySQL, SQLite, SQL Server, or Postgres',
        ],
        prepEyebrow: 'Migration studio',
        prepTitle: 'Prepare the migration plan',
        prepDescription: 'Choose the source format, review the translated PostgreSQL output, and confirm whether the first dataset should be imported during setup.',
        prepSteps: [
            'Analyzing source schema and inferring PostgreSQL types',
            'Building the translated migration plan',
            'Preparing setup to create tables and import initial rows',
        ],
        accountTitle: 'Migration plan is ready to run',
        accountDescription: 'After you register the first admin, OzyBase will create the translated tables, register their metadata, and import the initial rows included in the plan.',
        accountBullets: [
            'The schema is translated into native PostgreSQL tables.',
            'CSV and Mongo-like payloads can import rows immediately.',
            'A migration audit marker is recorded for traceability.',
        ],
        footnote: 'Migration Studio performs real schema translation and setup-time ETL for the sources analyzed below.',
    },
};

const migrationSourceOptions: MigrationSourceDescriptor[] = [
    {
        id: 'csv',
        label: 'CSV',
        title: 'CSV dataset',
        hint: 'Infer one PostgreSQL table from headers and sampled rows.',
        accept: '.csv,.txt',
        requiresTableName: true,
        icon: FileSpreadsheet,
        accentClass: 'border-emerald-500/20 bg-emerald-500/6 hover:border-emerald-400/40 hover:bg-emerald-500/10',
    },
    {
        id: 'mongo_json',
        label: 'Mongo JSON',
        title: 'Mongo-like JSON',
        hint: 'Map document arrays or { documents: [] } payloads into a relational table.',
        accept: '.json,.txt',
        requiresTableName: true,
        icon: FileJson,
        accentClass: 'border-cyan-500/20 bg-cyan-500/6 hover:border-cyan-400/40 hover:bg-cyan-500/10',
    },
    {
        id: 'mysql_sql',
        label: 'MySQL SQL',
        title: 'MySQL schema dump',
        hint: 'Translate CREATE TABLE and INSERT statements from MySQL.',
        accept: '.sql,.txt',
        requiresTableName: false,
        icon: Database,
        accentClass: 'border-sky-500/20 bg-sky-500/6 hover:border-sky-400/40 hover:bg-sky-500/10',
    },
    {
        id: 'sqlite_sql',
        label: 'SQLite SQL',
        title: 'SQLite schema dump',
        hint: 'Translate SQLite DDL/INSERT statements into PostgreSQL.',
        accept: '.sql,.txt',
        requiresTableName: false,
        icon: TableProperties,
        accentClass: 'border-violet-500/20 bg-violet-500/6 hover:border-violet-400/40 hover:bg-violet-500/10',
    },
    {
        id: 'sqlserver_sql',
        label: 'SQL Server',
        title: 'SQL Server schema dump',
        hint: 'Translate SQL Server table definitions and INSERT batches.',
        accept: '.sql,.txt',
        requiresTableName: false,
        icon: Server,
        accentClass: 'border-amber-500/20 bg-amber-500/6 hover:border-amber-400/40 hover:bg-amber-500/10',
    },
    {
        id: 'postgres_sql',
        label: 'Postgres SQL',
        title: 'Postgres DDL',
        hint: 'Bootstrap existing Postgres DDL into OzyBase metadata and setup-time imports.',
        accept: '.sql,.txt',
        requiresTableName: false,
        icon: Database,
        accentClass: 'border-blue-500/20 bg-blue-500/6 hover:border-blue-400/40 hover:bg-blue-500/10',
    },
];

const stepLabels: Array<{ id: WizardStep; label: string }> = [
    { id: 'mode', label: 'Choose Mode' },
    { id: 'prepare', label: 'Review Plan' },
    { id: 'account', label: 'Register Admin' },
];

const migrationPrepareStages: Array<{
    id: MigrationPrepareStage;
    label: string;
    hint: string;
}> = [
    { id: 'source', label: 'Choose Database', hint: 'Select the source engine first.' },
    { id: 'upload', label: 'Load Source', hint: 'Upload or paste the selected dump.' },
    { id: 'analysis', label: 'Basic Analysis', hint: 'Review the translated scope before the modal.' },
];

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) return error.message;
    return fallback;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
});

const sanitizeImportedTableName = (value: string): string => {
    const cleaned = value
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!cleaned) {
        return 'imported_records';
    }

    return /^\d/.test(cleaned) ? `n_${cleaned}` : cleaned;
};

const formatMigrationPreviewValue = (value: unknown, columnType: string): string => {
    if (value === null || value === undefined || value === '') {
        return '—';
    }

    const normalizedType = columnType.toLowerCase();
    if (normalizedType === 'boolean' || normalizedType === 'bool') {
        const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : value;
        if (normalizedValue === true || normalizedValue === 1 || normalizedValue === '1' || normalizedValue === 'true' || normalizedValue === 't' || normalizedValue === 'yes' || normalizedValue === 'y') {
            return 'True';
        }
        if (normalizedValue === false || normalizedValue === 0 || normalizedValue === '0' || normalizedValue === 'false' || normalizedValue === 'f' || normalizedValue === 'no' || normalizedValue === 'n') {
            return 'False';
        }
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatMigrationPreviewValue(item, 'text')).join(', ');
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
};

const describeMigrationColumn = (column: MigrationPreviewColumn): string => {
    const parts = [column.type.toUpperCase()];
    if (column.is_primary) {
        parts.push('PK');
    }
    if (column.required) {
        parts.push('Required');
    }
    return parts.join(' • ');
};

const MigrationTablePreviewCard: React.FC<{ table: MigrationPreviewTable }> = ({ table }) => {
    const sampleRows = table.sample_rows || [];

    return (
        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] space-y-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-blue-100/80">
                            {table.display_name}
                        </span>
                        {table.has_more_rows && (
                            <span className="rounded-full border border-zinc-700 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                                Showing first {sampleRows.length} rows
                            </span>
                        )}
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-white break-all">{table.name}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
                        Review the imported shape first: columns, sample records, and warnings. The SQL translation is available only if you need the technical detail.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:min-w-[320px]">
                    <div className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Columns</span>
                        <span className="mt-1 block text-lg font-black text-white">{table.column_count}</span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Rows</span>
                        <span className="mt-1 block text-lg font-black text-white">{table.detected_rows}</span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3 col-span-2 sm:col-span-1">
                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Preview</span>
                        <span className="mt-1 block text-sm font-semibold text-zinc-200">
                            {sampleRows.length > 0 ? `${sampleRows.length} rows visible` : 'Schema only'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {table.columns.map((column) => (
                    <div key={`${table.name}-${column.name}`} className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                        <span className="block text-sm font-semibold text-white break-all">{column.name}</span>
                        <span className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            {describeMigrationColumn(column)}
                        </span>
                    </div>
                ))}
            </div>

            {sampleRows.length > 0 ? (
                <div className="rounded-[1.5rem] border border-zinc-800 bg-black/35 overflow-hidden">
                    <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-semibold text-white">Sample rows</p>
                            <p className="text-xs text-zinc-500">
                                {table.has_more_rows ? `Showing ${sampleRows.length} of ${table.detected_rows} rows detected.` : `${table.detected_rows} rows detected in this source.`}
                            </p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left">
                            <thead className="bg-zinc-950/70">
                                <tr>
                                    {table.columns.map((column) => (
                                        <th key={`${table.name}-head-${column.name}`} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                                            {column.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sampleRows.map((row, rowIndex) => (
                                    <tr key={`${table.name}-row-${rowIndex}`} className="border-t border-zinc-800/90">
                                        {table.columns.map((column) => (
                                            <td key={`${table.name}-row-${rowIndex}-${column.name}`} className="max-w-[220px] px-4 py-3 align-top text-sm text-zinc-200">
                                                <span className="block truncate" title={formatMigrationPreviewValue(row[column.name], column.type)}>
                                                    {formatMigrationPreviewValue(row[column.name], column.type)}
                                                </span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="rounded-[1.5rem] border border-dashed border-zinc-800 bg-black/20 px-4 py-5 text-sm text-zinc-500">
                    No row preview was detected for this table. Setup will create the schema only unless you add INSERT rows or enable data import.
                </div>
            )}

            {table.warnings && table.warnings.length > 0 && (
                <div className="space-y-2">
                    {table.warnings.map((warning) => (
                        <div key={`${table.name}-${warning}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/85">
                            {warning}
                        </div>
                    ))}
                </div>
            )}

            <details className="rounded-[1.5rem] border border-zinc-800 bg-black/30">
                <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
                    Technical SQL Translation
                </summary>
                <div className="border-t border-zinc-800 px-4 py-4">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">{table.translated_sql}</pre>
                </div>
            </details>
        </div>
    );
};

interface MigrationPreviewModalProps {
    preview: MigrationPreviewResponse;
    sourceLabel: string;
    importRows: boolean;
    onClose: () => void;
    onContinue: () => void;
}

const MigrationPreviewModal: React.FC<MigrationPreviewModalProps> = ({
    preview,
    sourceLabel,
    importRows,
    onClose,
    onContinue,
}) => {
    const tablesWithWarnings = preview.tables.filter((table) => (table.warnings?.length || 0) > 0).length;

    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-5">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="migration-preview-modal-title"
                className="flex h-full w-full max-w-[min(96vw,1480px)] flex-col overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#090909] shadow-[0_40px_160px_-64px_rgba(0,0,0,0.95)]"
            >
                <div className="flex flex-col gap-5 border-b border-zinc-800 bg-[linear-gradient(135deg,rgba(254,254,0,0.1),rgba(7,7,7,0.98)_30%,rgba(7,7,7,0.98))] px-5 py-5 sm:px-7 sm:py-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="max-w-4xl">
                            <div className="mb-3 flex items-center gap-2 text-primary">
                                <ScanSearch size={16} />
                                <span className="text-[10px] font-black uppercase tracking-[0.24em]">Migration Review</span>
                            </div>
                            <h3 id="migration-preview-modal-title" className="text-2xl font-black tracking-tight text-white sm:text-[2rem]">
                                Review the translated plan without squeezing the workspace
                            </h3>
                            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
                                The editor stays focused on source preparation. This review layer opens only after analysis so you can inspect tables, sample rows, warnings, and the SQL translation with enough space.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-700 bg-black/35 text-zinc-300 transition-all hover:border-primary/35 hover:text-primary"
                            aria-label="Close migration review"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                        <div className="rounded-[1.75rem] border border-primary/20 bg-black/30 px-4 py-4 xl:col-span-2">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Summary</span>
                            <p className="mt-2 text-sm font-semibold leading-relaxed text-white">{preview.summary}</p>
                        </div>
                        <div className="rounded-[1.75rem] border border-zinc-800 bg-black/30 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Source</span>
                            <span className="mt-2 block text-sm font-semibold text-white">{sourceLabel}</span>
                        </div>
                        <div className="rounded-[1.75rem] border border-zinc-800 bg-black/30 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Tables</span>
                            <span className="mt-2 block text-2xl font-black text-white">{preview.table_count}</span>
                        </div>
                        <div className="rounded-[1.75rem] border border-zinc-800 bg-black/30 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Rows</span>
                            <span className="mt-2 block text-2xl font-black text-white">{preview.row_count}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Setup action</span>
                            <span className="mt-2 block text-sm font-semibold text-white">
                                {importRows ? 'Create schema and import detected rows' : 'Create translated schema only'}
                            </span>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Global warnings</span>
                            <span className="mt-2 block text-sm font-semibold text-white">{preview.warnings?.length || 0} review notes</span>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Table issues</span>
                            <span className="mt-2 block text-sm font-semibold text-white">{tablesWithWarnings} tables with warnings</span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
                    <div className="space-y-5">
                        {preview.warnings && preview.warnings.length > 0 && (
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {preview.warnings.map((warning) => (
                                    <div key={warning} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-amber-100/85">
                                        {warning}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-5">
                            {preview.tables.map((table) => (
                                <MigrationTablePreviewCard key={table.name} table={table} />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-zinc-800 bg-[#090909] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-5">
                    <p className="max-w-3xl text-xs leading-relaxed text-zinc-500">
                        Close this review to keep editing the source, or continue directly to create the first admin after confirming the translated plan looks correct.
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                        >
                            Keep editing
                        </button>
                        <button
                            type="button"
                            onClick={onContinue}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-black transition-all hover:scale-[1.01]"
                        >
                            Continue to Admin
                            <ArrowRight size={14} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState<WizardStep>('mode');
    const [mode, setMode] = useState<SetupMode | null>(null);
    const [formData, setFormData] = useState<SetupFormData>({
        email: '',
        password: '',
        confirmPassword: '',
        country: '',
    });
    const [loading, setLoading] = useState(false);
    const [detectingLoc, setDetectingLoc] = useState(false);
    const [error, setError] = useState('');
    const [serverSummary, setServerSummary] = useState('');
    const [prepProgress, setPrepProgress] = useState(0);
    const [loadingPhase, setLoadingPhase] = useState(0);
    const [appliedActions, setAppliedActions] = useState<SetupActionSummary[]>([]);
    const [migrationDraft, setMigrationDraft] = useState<MigrationDraft>({
        sourceKind: 'csv',
        tableName: 'imported_records',
        rawInput: '',
        importRows: true,
    });
    const [migrationPreview, setMigrationPreview] = useState<MigrationPreviewResponse | null>(null);
    const [migrationPreviewing, setMigrationPreviewing] = useState(false);
    const [isMigrationPreviewModalOpen, setIsMigrationPreviewModalOpen] = useState(false);
    const [migrationFileName, setMigrationFileName] = useState('');
    const [migrationDragActive, setMigrationDragActive] = useState(false);
    const [migrationInputMode, setMigrationInputMode] = useState<MigrationInputMode>('upload');
    const [migrationStage, setMigrationStage] = useState<MigrationPrepareStage>('source');
    const migrationFileInputRef = useRef<HTMLInputElement | null>(null);

    const selectedMode = useMemo(() => (
        mode ? modeDetails[mode] : null
    ), [mode]);

    const selectedMigrationSource = useMemo(() => (
        migrationSourceOptions.find((option) => option.id === migrationDraft.sourceKind) || migrationSourceOptions[0]
    ), [migrationDraft.sourceKind]);

    const migrationPreviewTableWarningCount = useMemo(() => (
        migrationPreview?.tables.filter((table) => (table.warnings?.length || 0) > 0).length || 0
    ), [migrationPreview]);

    const migrationPreviewTableSample = useMemo(() => (
        migrationPreview?.tables.slice(0, 4) || []
    ), [migrationPreview]);

    const canContinueFromPrepare = mode === 'migrate'
        ? Boolean(migrationPreview) && !migrationPreviewing
        : prepProgress >= (selectedMode?.prepSteps.length || 0);

    const migrationHasInput = migrationInputMode === 'upload'
        ? migrationFileName.trim() !== ''
        : migrationDraft.rawInput.trim() !== '';
    const migrationCanEnterAnalysis = migrationHasInput && (!selectedMigrationSource.requiresTableName || migrationDraft.tableName.trim() !== '');
    const activeMigrationStageIndex = migrationPrepareStages.findIndex((stage) => stage.id === migrationStage);

    useEffect(() => {
        setDetectingLoc(true);
        fetch('https://ipapi.co/json/')
            .then((res) => res.json())
            .then((data: unknown) => {
                const country = (
                    typeof data === 'object' &&
                    data !== null &&
                    'country_name' in data &&
                    typeof (data as { country_name?: unknown }).country_name === 'string'
                ) ? (data as { country_name: string }).country_name : (
                    (
                        typeof data === 'object' &&
                        data !== null &&
                        'country' in data &&
                        typeof (data as { country?: unknown }).country === 'string'
                    ) ? (data as { country: string }).country : ''
                );

                setFormData((prev) => ({ ...prev, country }));
            })
            .catch(() => console.warn('Could not detect location'))
            .finally(() => setDetectingLoc(false));
    }, []);

    useEffect(() => {
        if (step !== 'prepare' || !selectedMode) {
            setPrepProgress(0);
            return;
        }

        setPrepProgress(0);
        let current = 0;
        const interval = window.setInterval(() => {
            current += 1;
            setPrepProgress(current);
            if (current >= selectedMode.prepSteps.length) {
                window.clearInterval(interval);
            }
        }, 280);

        return () => window.clearInterval(interval);
    }, [selectedMode, step]);

    useEffect(() => {
        if (!loading || !selectedMode) {
            setLoadingPhase(0);
            return;
        }

        setLoadingPhase(0);
        const interval = window.setInterval(() => {
            setLoadingPhase((prev) => (
                prev < selectedMode.prepSteps.length - 1 ? prev + 1 : prev
            ));
        }, 360);

        return () => window.clearInterval(interval);
    }, [loading, selectedMode]);

    useEffect(() => {
        if (!isMigrationPreviewModalOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsMigrationPreviewModalOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMigrationPreviewModalOpen]);

    useEffect(() => {
        if (mode !== 'migrate' || (step !== 'prepare' && step !== 'account')) {
            setIsMigrationPreviewModalOpen(false);
        }
    }, [mode, step]);

    useEffect(() => {
        if (mode !== 'migrate') {
            setMigrationStage('source');
        }
    }, [mode]);

    const handleModeSelect = (nextMode: SetupMode) => {
        setMode(nextMode);
        setStep('prepare');
        setError('');
        setServerSummary('');
        setAppliedActions([]);
        setIsMigrationPreviewModalOpen(false);
        if (nextMode !== 'migrate') {
            setMigrationPreview(null);
            setMigrationPreviewing(false);
        } else {
            setMigrationInputMode('upload');
            setMigrationStage('source');
        }
    };

    const handleMigrationDraftChange = (updates: Partial<MigrationDraft>) => {
        setMigrationDraft((prev) => ({ ...prev, ...updates }));
        setMigrationPreview(null);
        setIsMigrationPreviewModalOpen(false);
        setError('');
    };

    const handleMigrationRawInputChange = (value: string) => {
        setMigrationInputMode('paste');
        setMigrationFileName('');
        handleMigrationDraftChange({ rawInput: value });
    };

    const handleMigrationSourceSelect = (sourceKind: MigrationSourceKind) => {
        setMigrationStage('upload');
        setMigrationInputMode('upload');
        setMigrationFileName('');
        setMigrationDragActive(false);
        setMigrationDraft((prev) => ({
            ...prev,
            sourceKind,
            rawInput: '',
        }));
        setMigrationPreview(null);
        setIsMigrationPreviewModalOpen(false);
        setError('');
    };

    const handleMigrationContinueToAnalysis = () => {
        if (migrationInputMode === 'upload' && migrationFileName.trim() === '') {
            setError('Load a file first or switch to paste mode');
            return;
        }
        if (migrationDraft.rawInput.trim() === '') {
            setError('Paste or upload the migration input first');
            return;
        }
        if (selectedMigrationSource.requiresTableName && migrationDraft.tableName.trim() === '') {
            setError('Table name is required for this migration source');
            return;
        }

        setError('');
        setMigrationStage('analysis');
    };

    const processMigrationFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (loadEvent: ProgressEvent<FileReader>) => {
            const text = loadEvent.target?.result;
            if (typeof text !== 'string') {
                return;
            }

            setMigrationFileName(file.name);
            setMigrationInputMode('upload');
            setMigrationDraft((prev) => ({
                ...prev,
                rawInput: text,
                tableName: !prev.tableName || prev.tableName === 'imported_records'
                    ? sanitizeImportedTableName(file.name)
                    : prev.tableName,
            }));
            setMigrationPreview(null);
            setIsMigrationPreviewModalOpen(false);
            setError('');
        };
        reader.readAsText(file);
    };

    const handleMigrationFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        processMigrationFile(file);
    };

    const handleMigrationDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setMigrationDragActive(false);

        const file = event.dataTransfer.files?.[0];
        if (!file) {
            return;
        }

        processMigrationFile(file);
    };

    const handleAnalyzeMigration = async () => {
        if (migrationInputMode === 'upload' && migrationFileName.trim() === '') {
            setError('Load a file first or switch to paste mode');
            return;
        }
        if (migrationDraft.rawInput.trim() === '') {
            setError('Paste or upload the migration input first');
            return;
        }
        if (selectedMigrationSource.requiresTableName && migrationDraft.tableName.trim() === '') {
            setError('Table name is required for this migration source');
            return;
        }

        setMigrationPreviewing(true);
        setError('');
        setMigrationPreview(null);
        setIsMigrationPreviewModalOpen(false);

        try {
            const res = await fetchWithAuth('/api/system/setup/migration/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_kind: migrationDraft.sourceKind,
                    table_name: migrationDraft.tableName,
                    raw_input: migrationDraft.rawInput,
                    import_rows: migrationDraft.importRows,
                }),
            });

            const data = await res.json() as MigrationPreviewResponse & { error?: string };
            if (!res.ok) {
                throw new Error(data.error || 'Could not analyze the migration plan');
            }

            setMigrationPreview(data);
            setMigrationStage('analysis');
            setIsMigrationPreviewModalOpen(true);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Could not analyze the migration plan'));
        } finally {
            setMigrationPreviewing(false);
        }
    };

    const handleSetup = async () => {
        if (!mode) {
            setError('Select setup mode');
            return;
        }
        if (mode === 'migrate' && !migrationPreview) {
            setError('Analyze the migration plan before finishing setup');
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (formData.password.length < 12) {
            setError('Password must be at least 12 characters');
            return;
        }

        setLoading(true);
        setError('');
        setServerSummary('');
        setAppliedActions([]);

        const requestStartedAt = Date.now();

        try {
            const res = await fetchWithAuth('/api/system/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                    mode,
                    allow_country: formData.country,
                    ...(mode === 'migrate' ? {
                        migration: {
                            source_kind: migrationDraft.sourceKind,
                            table_name: migrationDraft.tableName,
                            raw_input: migrationDraft.rawInput,
                            import_rows: migrationDraft.importRows,
                        },
                    } : {}),
                }),
            });

            const data = await res.json() as SetupResponse;
            const elapsed = Date.now() - requestStartedAt;
            if (elapsed < 900) {
                await delay(900 - elapsed);
            }

            if (!res.ok) throw new Error(data.error || 'Setup failed');

            setServerSummary(data.summary || '');
            setAppliedActions(Array.isArray(data.applied_actions) ? data.applied_actions : []);

            if (data.token) {
                onComplete(data.token);
            } else {
                throw new Error('Security handshake failed: No token received.');
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Setup failed'));
        } finally {
            setLoading(false);
        }
    };

    const renderStepIndicator = (targetStep: WizardStep, index: number) => {
        const stepIndex = stepLabels.findIndex((item) => item.id === step);
        const targetIndex = stepLabels.findIndex((item) => item.id === targetStep);
        const isActive = step === targetStep;
        const isCompleted = stepIndex > targetIndex;

        return (
            <div key={targetStep} className="flex items-center gap-3 text-zinc-400">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isActive || isCompleted ? 'border-primary text-primary' : 'border-zinc-700 text-transparent'}`}>
                    <div className="w-1.5 h-1.5 bg-current rounded-full" />
                </div>
                <span className={`text-xs font-medium ${isActive ? 'text-white' : isCompleted ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    {index + 1}. {stepLabels[index].label}
                </span>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/95 p-2 backdrop-blur-sm animate-in fade-in duration-500 sm:p-4 md:items-center">
            <div className="relative flex h-full w-full max-w-[min(96vw,1540px)] flex-col overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#0a0a0a] shadow-2xl max-h-[calc(100vh-1rem)] min-h-0 md:h-auto md:max-h-[calc(100vh-2rem)] lg:min-h-[760px] lg:flex-row">
                <div className="relative flex max-h-[34vh] w-full flex-col justify-between overflow-y-auto border-b border-zinc-800 bg-zinc-900/50 p-5 sm:p-6 lg:max-h-none lg:w-[22rem] lg:border-b-0 lg:border-r lg:p-8 xl:w-[24rem]">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent pointer-events-none" />

                    <div className="relative">
                        <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_30px_-5px_rgba(254,254,0,0.28)]">
                            <Database className="text-black" size={24} strokeWidth={2.5} />
                        </div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic mb-2">
                            OzyBase <span className="text-primary">Setup</span>
                        </h1>
                        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                            Initialize your backend
                        </p>
                    </div>

                    <div className="relative space-y-6">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-zinc-400">
                                <CheckCircle size={16} className="text-primary" />
                                <span className="text-xs font-medium">Database Schema Ready</span>
                            </div>
                            <div className="flex items-center gap-3 text-zinc-400">
                                <CheckCircle size={16} className="text-primary" />
                                <span className="text-xs font-medium">API Gateway Active</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {stepLabels.map((item, index) => renderStepIndicator(item.id, index))}
                        </div>

                        {selectedMode && (
                            <div className="rounded-3xl border border-zinc-800 bg-black/30 p-5 animate-in fade-in duration-300">
                                <div className="flex items-start gap-3">
                                    <div className={`p-3 rounded-2xl ${selectedMode.iconPanelClass}`}>
                                        <selectedMode.icon size={18} className={selectedMode.iconClass} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-1">
                                            {selectedMode.label}
                                        </p>
                                        <h3 className="text-sm font-bold text-white">{selectedMode.title}</h3>
                                        <p className="text-xs text-zinc-500 leading-relaxed mt-2">
                                            {selectedMode.footnote}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-6 lg:p-8 xl:p-10 2xl:p-12">
                    {loading && selectedMode && (
                        <div className="absolute inset-0 z-20 bg-black/88 backdrop-blur-sm p-6 md:p-10 flex items-center justify-center animate-in fade-in duration-300">
                            <div className="w-full max-w-xl rounded-[2rem] border border-zinc-800 bg-[#0d0d0d] p-7 shadow-2xl">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                                        <Loader2 size={20} className="animate-spin" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-1">
                                            Applying Setup
                                        </p>
                                        <h3 className="text-xl font-black text-white uppercase tracking-tight">
                                            Preparing {selectedMode.title}
                                        </h3>
                                        <p className="text-sm text-zinc-500 mt-1">
                                            We are finishing the selected bootstrap path before the first login.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {selectedMode.prepSteps.map((label, index) => {
                                        const isComplete = index < loadingPhase;
                                        const isCurrent = index === loadingPhase;
                                        return (
                                            <div
                                                key={label}
                                                className={`rounded-2xl border px-4 py-3 flex items-center gap-3 transition-all duration-300 ${isComplete ? 'border-primary/30 bg-primary/5' : isCurrent ? 'border-zinc-700 bg-zinc-900/70' : 'border-zinc-800 bg-black/30 text-zinc-600'}`}
                                            >
                                                {isComplete ? (
                                                    <CheckCircle size={16} className="text-primary shrink-0" />
                                                ) : isCurrent ? (
                                                    <Loader2 size={16} className="text-primary shrink-0 animate-spin" />
                                                ) : (
                                                    <div className="w-4 h-4 rounded-full border border-zinc-700 shrink-0" />
                                                )}
                                                <span className={`text-sm ${isComplete || isCurrent ? 'text-white' : 'text-zinc-600'}`}>
                                                    {label}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'mode' && (
                        <div className="animate-in slide-in-from-right duration-500 flex-1 min-h-0 overflow-y-auto pr-1">
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">How do you want to start?</h2>
                            <p className="text-zinc-500 text-sm mb-8">Choose the bootstrap preset that best matches what you really want setup to apply.</p>

                            <div className="grid grid-cols-1 gap-4">
                                {(Object.entries(modeDetails) as Array<[SetupMode, ModeDescriptor]>).map(([modeKey, descriptor]) => (
                                    <button
                                        key={modeKey}
                                        onClick={() => handleModeSelect(modeKey)}
                                        className={`group p-6 rounded-2xl border text-left transition-all hover:scale-[1.01] relative overflow-hidden ${descriptor.accentClass}`}
                                    >
                                        <div className="flex items-center justify-between mb-4 gap-4">
                                            <div className={`p-3 rounded-xl ${descriptor.iconPanelClass}`}>
                                                <descriptor.icon size={20} className={descriptor.iconClass} />
                                            </div>
                                            {descriptor.badge ? (
                                                <span className="px-3 py-1 bg-primary text-black text-[10px] font-black uppercase tracking-widest rounded-full">
                                                    {descriptor.badge}
                                                </span>
                                            ) : (
                                                <ArrowRight size={16} className="text-zinc-600 group-hover:text-white transition-colors opacity-0 group-hover:opacity-100 shrink-0" />
                                            )}
                                        </div>

                                        <h3 className="text-lg font-bold text-white mb-1">{descriptor.title}</h3>
                                        <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                                            {descriptor.description}
                                        </p>

                                        <div className="space-y-2">
                                            {descriptor.bullets.map((bullet) => (
                                                <div key={bullet} className="flex items-center gap-2 text-xs text-zinc-300">
                                                    <CheckCircle size={12} className="text-primary shrink-0" />
                                                    <span>{bullet}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 'prepare' && selectedMode && mode === 'migrate' && (
                        <div className="animate-in slide-in-from-right duration-500 h-full min-h-0 flex flex-col overflow-hidden">
                            <button
                                onClick={() => setStep('mode')}
                                className="text-xs text-zinc-500 hover:text-white mb-4 flex items-center gap-1"
                            >
                                Back
                            </button>

                            <div className="mb-6">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">
                                    {selectedMode.prepEyebrow}
                                </p>
                                <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">{selectedMode.prepTitle}</h2>
                                <p className="text-zinc-500 text-sm max-w-3xl">
                                    Select the source engine first, then load that database dump, continue to a basic analysis, and leave the detailed review for the final modal.
                                </p>
                            </div>

                            <div className="mb-5 grid grid-cols-1 gap-3 xl:grid-cols-3">
                                {migrationPrepareStages.map((stage, index) => {
                                    const isActive = stage.id === migrationStage;
                                    const isComplete = stage.id === 'analysis'
                                        ? Boolean(migrationPreview)
                                        : index < activeMigrationStageIndex;

                                    return (
                                        <div
                                            key={stage.id}
                                            className={`rounded-2xl border px-4 py-3 transition-all ${isActive
                                                ? 'border-primary/35 bg-primary/10'
                                                : isComplete
                                                    ? 'border-zinc-700 bg-zinc-900/70'
                                                    : 'border-zinc-800 bg-zinc-950/70'
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border ${isActive || isComplete ? 'border-primary/40 bg-primary/15 text-primary' : 'border-zinc-700 text-zinc-500'}`}>
                                                    {isComplete ? <CheckCircle size={15} /> : <span className="text-[11px] font-black">{index + 1}</span>}
                                                </div>
                                                <div>
                                                    <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${isActive ? 'text-primary' : 'text-zinc-500'}`}>{stage.label}</p>
                                                    <p className="mt-1 text-sm text-zinc-400">{stage.hint}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-[minmax(420px,0.82fr)_minmax(0,1.18fr)] gap-6 flex-1 min-h-0 overflow-hidden">
                                <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900/30 p-6 flex flex-col min-h-0 overflow-y-auto pr-1">
                                    <div className="flex items-center gap-3 mb-5">
                                        <div className={`p-3 rounded-2xl ${selectedMode.iconPanelClass}`}>
                                            <selectedMode.icon size={20} className={selectedMode.iconClass} />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-1">
                                                {migrationStage === 'source'
                                                    ? 'Step 1 · Choose database'
                                                    : migrationStage === 'upload'
                                                        ? 'Step 2 · Load selected source'
                                                        : 'Step 3 · Basic analysis'}
                                            </p>
                                            <h3 className="text-lg font-bold text-white">
                                                {migrationStage === 'source'
                                                    ? 'Choose the database engine first'
                                                    : migrationStage === 'upload'
                                                        ? `Load the ${selectedMigrationSource.label} dump`
                                                        : 'Run the first analysis before the final review'}
                                            </h3>
                                            <p className="text-xs text-zinc-500">
                                                {migrationStage === 'source'
                                                    ? 'Selecting a source moves you directly to the upload step so the next screen is adapted to that engine.'
                                                    : migrationStage === 'upload'
                                                        ? 'This stage is only for loading the selected source. The next stage runs the analysis and opens the final modal review.'
                                                        : 'Keep this step focused on the first analysis. The deeper SQL review stays in the modal at the end.'}
                                            </p>
                                        </div>
                                        <div className="hidden">
                                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-1">Step 1 · Source</p>
                                            <h3 className="text-lg font-bold text-white">Choose the source, load it, then analyze</h3>
                                            <p className="text-xs text-zinc-500">This step only prepares the migration. The detailed review opens after analysis so the workspace stays lighter.</p>
                                        </div>
                                    </div>

                                    <div className={migrationStage === 'upload' ? 'mb-6 grid grid-cols-1 gap-4' : 'hidden'}>
                                        <div className="hidden">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Step 1 · Source format</label>
                                            <select
                                                value={migrationDraft.sourceKind}
                                                onChange={(event) => handleMigrationDraftChange({ sourceKind: event.target.value as MigrationSourceKind })}
                                                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white transition-all focus:border-primary/50 focus:outline-none"
                                            >
                                                {migrationSourceOptions.map((source) => (
                                                    <option key={source.id} value={source.id}>
                                                        {source.title}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="rounded-[1.75rem] border border-zinc-800 bg-black/20 p-5">
                                            <div className="flex items-start gap-4">
                                                <div className="rounded-2xl border border-white/5 bg-black/30 p-3">
                                                    <selectedMigrationSource.icon size={18} className="text-primary" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">{selectedMigrationSource.label}</span>
                                                        <span className="rounded-full border border-zinc-700 bg-black/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                                                            {selectedMigrationSource.accept}
                                                        </span>
                                                    </div>
                                                    <h4 className="mt-2 text-sm font-semibold text-white">{selectedMigrationSource.title}</h4>
                                                    <p className="mt-2 text-xs leading-relaxed text-zinc-500">{selectedMigrationSource.hint}</p>
                                                    <p className="mt-3 text-xs text-zinc-400">
                                                        {selectedMigrationSource.requiresTableName
                                                            ? 'This format needs one target table name before analysis.'
                                                            : 'This format can reuse table names from the dump automatically.'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {selectedMigrationSource.requiresTableName ? (
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Target table name</label>
                                                <input
                                                    type="text"
                                                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white transition-all focus:border-primary/50 focus:outline-none"
                                                    placeholder="legacy_users"
                                                    value={migrationDraft.tableName}
                                                    onChange={(e) => handleMigrationDraftChange({ tableName: sanitizeImportedTableName(e.target.value) })}
                                                />
                                            </div>
                                        ) : (
                                            <details className="rounded-[1.5rem] border border-zinc-800 bg-black/15">
                                                <summary className="cursor-pointer list-none px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                                                    Optional table-name override
                                                </summary>
                                                <div className="border-t border-zinc-800 px-4 py-4">
                                                    <input
                                                        type="text"
                                                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white transition-all focus:border-primary/50 focus:outline-none"
                                                        placeholder="Leave empty to keep names from the dump"
                                                        value={migrationDraft.tableName}
                                                        onChange={(e) => handleMigrationDraftChange({ tableName: sanitizeImportedTableName(e.target.value) })}
                                                    />
                                                </div>
                                            </details>
                                        )}

                                        <div className="rounded-[1.75rem] border border-zinc-800 bg-black/20 p-5">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-2">Step 2 · Provide the source</p>
                                                    <h4 className="text-sm font-semibold text-white">Choose one input method</h4>
                                                    <p className="mt-2 max-w-2xl text-xs leading-relaxed text-zinc-500">
                                                        Use a file when you already have a dump ready. Use paste when you want to test a snippet quickly without leaving the browser.
                                                    </p>
                                                </div>
                                                <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-950/70 p-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setMigrationInputMode('upload')}
                                                        className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] transition-all ${migrationInputMode === 'upload' ? 'bg-primary text-black' : 'text-zinc-400 hover:text-white'}`}
                                                    >
                                                        Upload file
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setMigrationInputMode('paste')}
                                                        className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] transition-all ${migrationInputMode === 'paste' ? 'bg-primary text-black' : 'text-zinc-400 hover:text-white'}`}
                                                    >
                                                        Paste text
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="mt-4">
                                                {migrationInputMode === 'upload' ? (
                                                    <div
                                                        onDragOver={(event) => {
                                                            event.preventDefault();
                                                            setMigrationDragActive(true);
                                                        }}
                                                        onDragEnter={(event) => {
                                                            event.preventDefault();
                                                            setMigrationDragActive(true);
                                                        }}
                                                        onDragLeave={(event) => {
                                                            event.preventDefault();
                                                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                                                setMigrationDragActive(false);
                                                            }
                                                        }}
                                                        onDrop={handleMigrationDrop}
                                                        className={`rounded-2xl border border-dashed p-4 transition-all ${migrationDragActive ? 'border-primary bg-primary/8' : 'border-zinc-700 bg-black/20'}`}
                                                    >
                                                        <input
                                                            ref={migrationFileInputRef}
                                                            type="file"
                                                            accept={selectedMigrationSource.accept}
                                                            onChange={handleMigrationFileUpload}
                                                            className="hidden"
                                                        />

                                                        <div className="flex flex-col gap-4">
                                                            <div className="flex items-start gap-4">
                                                                <div className="rounded-2xl border border-white/5 bg-black/30 p-3">
                                                                    <selectedMigrationSource.icon size={18} className="text-primary" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-sm font-semibold text-white">Drop your {selectedMigrationSource.label} file here</p>
                                                                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                                                                        Accepted formats: {selectedMigrationSource.accept}. The file content will be analyzed inside the setup flow.
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                                <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-3 text-xs">
                                                                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Loaded file</span>
                                                                    <span className="break-all font-medium text-white">{migrationFileName || 'No file loaded yet'}</span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => migrationFileInputRef.current?.click()}
                                                                    className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/40 hover:text-primary"
                                                                >
                                                                    <MousePointerClick size={14} />
                                                                    Browse file
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Paste schema or data</label>
                                                        <textarea
                                                            className="min-h-[320px] w-full resize-y rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-4 text-sm text-white transition-all focus:border-primary/50 focus:outline-none"
                                                            placeholder={selectedMigrationSource.id === 'csv'
                                                                ? 'id,name,email\n1,Ana,ana@example.com'
                                                                : selectedMigrationSource.id === 'mongo_json'
                                                                    ? '[{\"name\":\"Ana\",\"email\":\"ana@example.com\"}]'
                                                                    : 'CREATE TABLE users (...);\nINSERT INTO users VALUES (...);'}
                                                            value={migrationDraft.rawInput}
                                                            onChange={(e) => handleMigrationRawInputChange(e.target.value)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className={migrationStage === 'source' ? 'grid grid-cols-1 gap-4 2xl:grid-cols-2' : 'hidden'}>
                                        {migrationSourceOptions.map((source) => (
                                            <button
                                                key={source.id}
                                                onClick={() => handleMigrationSourceSelect(source.id)}
                                                className={`rounded-2xl border p-4 text-left transition-all ${migrationDraft.sourceKind === source.id ? 'border-primary/40 bg-primary/8 shadow-[0_0_0_1px_rgba(254,254,0,0.08)]' : source.accentClass}`}
                                            >
                                                <div className="flex items-start justify-between gap-3 mb-3">
                                                    <div className="p-3 rounded-2xl bg-black/30 border border-white/5">
                                                        <source.icon size={18} className={migrationDraft.sourceKind === source.id ? 'text-primary' : 'text-white'} />
                                                    </div>
                                                    {migrationDraft.sourceKind === source.id && <CheckCircle size={14} className="text-primary shrink-0" />}
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">{source.label}</span>
                                                <p className="text-sm font-semibold text-white mb-1">{source.title}</p>
                                                <p className="text-xs text-zinc-500 leading-relaxed">{source.hint}</p>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="hidden">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                                {selectedMigrationSource.requiresTableName ? 'Target Table Name' : 'Target Table Name (Optional Override)'}
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                                placeholder={selectedMigrationSource.requiresTableName ? 'legacy_users' : 'Leave empty to use source table names'}
                                                value={migrationDraft.tableName}
                                                onChange={(e) => handleMigrationDraftChange({ tableName: sanitizeImportedTableName(e.target.value) })}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Step 2 · Upload Source File</label>
                                            <div
                                                onDragOver={(event) => {
                                                    event.preventDefault();
                                                    setMigrationDragActive(true);
                                                }}
                                                onDragEnter={(event) => {
                                                    event.preventDefault();
                                                    setMigrationDragActive(true);
                                                }}
                                                onDragLeave={(event) => {
                                                    event.preventDefault();
                                                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                                        setMigrationDragActive(false);
                                                    }
                                                }}
                                                onDrop={handleMigrationDrop}
                                                className={`rounded-2xl border border-dashed p-4 flex flex-col gap-4 transition-all ${migrationDragActive ? 'border-primary bg-primary/8' : 'border-zinc-700 bg-black/20'}`}
                                            >
                                                <input
                                                    ref={migrationFileInputRef}
                                                    type="file"
                                                    accept={selectedMigrationSource.accept}
                                                    onChange={handleMigrationFileUpload}
                                                    className="hidden"
                                                />

                                                <div className="flex items-start gap-4">
                                                    <div className="p-3 rounded-2xl bg-black/30 border border-white/5">
                                                        <selectedMigrationSource.icon size={18} className="text-primary" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-white">Drag and drop your {selectedMigrationSource.label} file here</p>
                                                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                                                            Accepted formats: {selectedMigrationSource.accept}. If your dump needs cleanup, you can still paste the content manually below.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                                    <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-3 text-xs">
                                                        <span className="block text-zinc-500 uppercase tracking-widest text-[10px] mb-1">Loaded source</span>
                                                        <span className="text-white font-medium break-all">{migrationFileName || 'No file loaded yet'}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => migrationFileInputRef.current?.click()}
                                                        className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-[10px] font-black uppercase tracking-[0.22em] text-white hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-2"
                                                    >
                                                        <MousePointerClick size={14} />
                                                        Browse file
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Paste Schema / Data</label>
                                            <textarea
                                                className="w-full min-h-[320px] resize-y bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-sm text-white focus:border-primary/50 focus:outline-none transition-all"
                                                placeholder={selectedMigrationSource.id === 'csv'
                                                    ? 'id,name,email\n1,Ana,ana@example.com'
                                                    : selectedMigrationSource.id === 'mongo_json'
                                                        ? '[{\"name\":\"Ana\",\"email\":\"ana@example.com\"}]'
                                                        : 'CREATE TABLE users (...);\nINSERT INTO users VALUES (...);'}
                                                value={migrationDraft.rawInput}
                                                onChange={(e) => handleMigrationDraftChange({ rawInput: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className={migrationStage === 'analysis' ? 'mt-5 flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-black/30 p-4 shadow-[0_20px_70px_-48px_rgba(0,0,0,0.85)]' : 'hidden'}>
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Step 3 · Analyze</p>
                                                <p className="mt-2 text-sm text-zinc-300">Generate the translated plan and open the detailed review only when the source is ready.</p>
                                            </div>
                                            <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${migrationHasInput ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200/80' : 'border-zinc-700 bg-black/30 text-zinc-400'}`}>
                                                {migrationHasInput ? 'Ready to analyze' : 'Waiting for source input'}
                                            </span>
                                        </div>
                                        <label className="flex items-start gap-3 text-sm text-zinc-300">
                                            <input
                                                type="checkbox"
                                                checked={migrationDraft.importRows}
                                                onChange={(e) => handleMigrationDraftChange({ importRows: e.target.checked })}
                                                className="mt-0.5 accent-[var(--color-primary)]"
                                            />
                                            <span>
                                                Import detected rows during setup.
                                                <span className="mt-1 block text-xs text-zinc-500">
                                                    Disable this if you only want the PostgreSQL schema translated now and plan to load data later.
                                                </span>
                                            </span>
                                        </label>

                                        <div className="flex flex-col gap-3 sm:flex-row">
                                            <button
                                                onClick={handleAnalyzeMigration}
                                                disabled={migrationPreviewing}
                                                className="flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                                            >
                                                {migrationPreviewing ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                                                {migrationPreviewing ? 'Analyzing...' : 'Analyze migration plan'}
                                            </button>
                                            {migrationPreview && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsMigrationPreviewModalOpen(true)}
                                                    className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-6 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                                                >
                                                    Reopen review
                                                    <ArrowRight size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="hidden">
                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Step 3 · Analyze</p>
                                        <label className="flex items-start gap-3 text-sm text-zinc-300">
                                            <input
                                                type="checkbox"
                                                checked={migrationDraft.importRows}
                                                onChange={(e) => handleMigrationDraftChange({ importRows: e.target.checked })}
                                                className="mt-0.5 accent-[var(--color-primary)]"
                                            />
                                            <span>
                                                Import detected rows during setup.
                                                <span className="block text-xs text-zinc-500 mt-1">
                                                    Disable this if you only want the PostgreSQL schema translated now and plan to load data later.
                                                </span>
                                            </span>
                                        </label>

                                        <button
                                            onClick={handleAnalyzeMigration}
                                            disabled={migrationPreviewing}
                                            className="px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                        >
                                            {migrationPreviewing ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                                            {migrationPreviewing ? 'Analyzing...' : 'Analyze migration plan'}
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-zinc-800 bg-[#0c0c0c] flex flex-col min-h-0 overflow-hidden">
                                    <div className="px-6 pt-6 pb-5 border-b border-zinc-800">
                                        <div className="flex items-center gap-2 text-primary mb-2">
                                            {migrationStage === 'source' ? <Database size={16} /> : <ScanSearch size={16} />}
                                            <span className="text-[10px] font-black uppercase tracking-[0.24em]">
                                                {migrationStage === 'source'
                                                    ? 'Migration Flow'
                                                    : migrationStage === 'upload'
                                                        ? 'Source Readiness'
                                                        : 'Migration Preview'}
                                            </span>
                                        </div>
                                        <h3 className="text-xl font-black tracking-tight text-white">
                                            {migrationStage === 'source'
                                                ? 'Select first, then upload'
                                                : migrationStage === 'upload'
                                                    ? 'Make sure the selected source is ready'
                                                    : 'Keep the workspace focused'}
                                        </h3>
                                        <p className="text-sm text-zinc-500 mt-2 leading-relaxed max-w-3xl">
                                            {migrationStage === 'source'
                                                ? 'The migration wizard is easier to follow when it asks for the engine first. After you choose it, the next step adapts to that database format.'
                                                : migrationStage === 'upload'
                                                    ? 'This side stays focused on readiness: selected source, what the basic analysis will check, and the next move into analysis.'
                                                    : 'After analysis, the complete migration review opens in a dedicated modal. This side panel stays lighter so editing the source and understanding next steps do not compete for space.'}
                                        </p>
                                    </div>

                                    {migrationStage === 'source' ? (
                                        <div className="flex-1 min-h-0 overflow-y-auto p-6">
                                            <div className="rounded-[1.75rem] border border-zinc-800 bg-black/20 p-5">
                                                <div className="flex items-start gap-4">
                                                    <div className="rounded-2xl bg-black/30 border border-white/5 p-3">
                                                        <Database size={18} className="text-primary" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Minimal flow</p>
                                                        <h4 className="text-sm font-semibold text-white">Choose the engine and move on</h4>
                                                        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                                            Pick the source here. The upload screen adapts automatically, and the detailed review stays reserved for the final modal.
                                                        </p>
                                                        <div className="mt-4 flex flex-wrap gap-2">
                                                            {migrationPrepareStages.map((stage, index) => (
                                                                <span key={`source-pill-${stage.id}`} className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-300">
                                                                    {index + 1}. {stage.label}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
                                                            Current default: {selectedMigrationSource.title}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : migrationStage === 'upload' ? (
                                        <div className="flex-1 min-h-0 overflow-y-auto p-6">
                                            <div className="rounded-[1.75rem] border border-zinc-800 bg-black/20 p-5">
                                                <div className="flex items-center gap-2 text-primary mb-3">
                                                    <CheckCircle size={16} />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">Readiness</span>
                                                </div>
                                                <div className="space-y-3 text-sm">
                                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
                                                        <span className="text-zinc-400">Source</span>
                                                        <span className="font-semibold text-white">{selectedMigrationSource.label}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
                                                        <span className="text-zinc-400">Input</span>
                                                        <span className={`font-semibold ${migrationHasInput ? 'text-white' : 'text-zinc-500'}`}>
                                                            {migrationHasInput ? 'Loaded' : 'Pending'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
                                                        <span className="text-zinc-400">Target table</span>
                                                        <span className={`font-semibold ${!selectedMigrationSource.requiresTableName || migrationDraft.tableName.trim() ? 'text-white' : 'text-zinc-500'}`}>
                                                            {selectedMigrationSource.requiresTableName
                                                                ? (migrationDraft.tableName.trim() || 'Required')
                                                                : (migrationDraft.tableName.trim() || 'Optional')}
                                                        </span>
                                                    </div>
                                                </div>
                                                <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                                                    When these three are ready, continue to the basic analysis. The detailed SQL review stays outside this page in the modal.
                                                </p>
                                            </div>
                                        </div>
                                    ) : migrationPreview ? (
                                        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
                                            <div className="rounded-[2rem] border border-primary/20 bg-[linear-gradient(135deg,rgba(254,254,0,0.12),rgba(12,12,12,0.5))] p-5">
                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="max-w-2xl">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Analysis ready</span>
                                                        <p className="mt-3 text-base font-semibold leading-relaxed text-white">{migrationPreview.summary}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsMigrationPreviewModalOpen(true)}
                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-black/30 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary hover:text-primary"
                                                    >
                                                        Open full review
                                                        <ArrowRight size={14} />
                                                    </button>
                                                </div>
                                                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                                                    <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Tables</span>
                                                        <span className="mt-1 block text-2xl font-black text-white">{migrationPreview.table_count}</span>
                                                    </div>
                                                    <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Rows</span>
                                                        <span className="mt-1 block text-2xl font-black text-white">{migrationPreview.row_count}</span>
                                                    </div>
                                                    <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Source</span>
                                                        <span className="mt-1 block text-sm font-semibold text-zinc-100">{selectedMigrationSource.label}</span>
                                                    </div>
                                                    <div className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-4">
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Setup action</span>
                                                        <span className="mt-1 block text-sm font-semibold text-zinc-100">
                                                            {migrationDraft.importRows ? 'Create and import rows' : 'Create schema only'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {migrationPreview.warnings && migrationPreview.warnings.length > 0 && (
                                                <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 px-4 py-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/70">Warnings</span>
                                                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/70">
                                                            {migrationPreview.warnings.length} global
                                                        </span>
                                                    </div>
                                                    <div className="mt-3 space-y-2">
                                                        {migrationPreview.warnings.slice(0, 2).map((warning) => (
                                                            <div key={warning} className="rounded-xl border border-amber-500/20 bg-black/20 px-3 py-3 text-xs leading-relaxed text-amber-100/85">
                                                                {warning}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="rounded-[1.5rem] border border-zinc-800 bg-black/20 px-4 py-4">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <span className="block text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Preview tables</span>
                                                        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                                                            Keep this page minimal: scan the first tables here and use the modal for full SQL and sample rows.
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsMigrationPreviewModalOpen(true)}
                                                        className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                                                    >
                                                        Open modal review
                                                    </button>
                                                </div>
                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    {migrationPreviewTableSample.map((table) => (
                                                        <span key={`compact-${table.name}`} className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-200">
                                                            {table.name}
                                                        </span>
                                                    ))}
                                                </div>
                                                {migrationPreview.table_count > migrationPreviewTableSample.length && (
                                                    <p className="mt-4 text-xs text-zinc-500">
                                                        {migrationPreview.table_count - migrationPreviewTableSample.length} more tables are available in the full review.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1 min-h-0 overflow-y-auto p-6">
                                            <div className="rounded-[1.75rem] border border-zinc-800 bg-black/20 p-5">
                                                <div className="flex items-start gap-4">
                                                    <div className="rounded-2xl bg-black/30 border border-white/5 p-3">
                                                        {migrationPreviewing ? <Loader2 size={18} className="text-primary animate-spin" /> : <selectedMigrationSource.icon size={18} className="text-primary" />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Before analysis</p>
                                                        <h4 className="text-sm font-semibold text-white">{selectedMigrationSource.title}</h4>
                                                        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                                                            Run the basic analysis first. The page stays compact here, and the detailed inspection opens in the modal only when the preview is ready.
                                                        </p>
                                                        <div className="mt-4 space-y-2">
                                                            {selectedMode.prepSteps.map((prepStep) => (
                                                                <div key={`analysis-prestep-${prepStep}`} className="text-sm text-zinc-500">
                                                                    {prepStep}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="border-t border-zinc-800 px-6 py-5 bg-[#0c0c0c] flex flex-col gap-4">
                                        {error && (
                                            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-xl flex items-start gap-2">
                                                <Shield size={14} className="shrink-0 mt-0.5" />
                                                <span>{error}</span>
                                            </div>
                                        )}
                                        <p className="text-xs text-zinc-500 leading-relaxed">
                                            {selectedMode.footnote}
                                        </p>
                                        {migrationStage === 'source' && (
                                            <p className="text-xs text-zinc-400 leading-relaxed">
                                                Selecting any database card moves you directly to the source-loading step.
                                            </p>
                                        )}
                                        {migrationStage === 'upload' && (
                                            <div className="flex flex-col gap-3 sm:flex-row">
                                                <button
                                                    type="button"
                                                    onClick={() => setMigrationStage('source')}
                                                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                                                >
                                                    Change database
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleMigrationContinueToAnalysis}
                                                    disabled={!migrationCanEnterAnalysis}
                                                    className="w-full rounded-xl bg-primary px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-black transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
                                                >
                                                    Continue to Basic Analysis
                                                </button>
                                            </div>
                                        )}
                                        {migrationStage === 'analysis' && (
                                            <div className="flex flex-col gap-3">
                                                {migrationPreview && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsMigrationPreviewModalOpen(true)}
                                                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                                                    >
                                                        Open Final Modal Review
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setStep('account')}
                                                    disabled={!canContinueFromPrepare}
                                                    className="w-full px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.01] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                                >
                                                    Continue to Admin
                                                    <ArrowRight size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'prepare' && selectedMode && mode !== 'migrate' && (
                        <div className="animate-in slide-in-from-right duration-500 h-full min-h-0 flex flex-col">
                            <button
                                onClick={() => setStep('mode')}
                                className="text-xs text-zinc-500 hover:text-white mb-4 flex items-center gap-1"
                            >
                                Back
                            </button>

                            <div className="mb-8">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">
                                    {selectedMode.prepEyebrow}
                                </p>
                                <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">{selectedMode.prepTitle}</h2>
                                <p className="text-zinc-500 text-sm max-w-2xl">{selectedMode.prepDescription}</p>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 flex-1 min-h-0">
                                <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900/30 p-6 flex flex-col">
                                    <div className="flex items-center gap-3 mb-5">
                                        <div className={`p-3 rounded-2xl ${selectedMode.iconPanelClass}`}>
                                            <selectedMode.icon size={20} className={selectedMode.iconClass} />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white">{selectedMode.title}</h3>
                                            <p className="text-xs text-zinc-500">Preview of what this setup path really does.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-3 flex-1">
                                        {selectedMode.prepSteps.map((prepStep, index) => {
                                            const isReady = index < prepProgress;
                                            return (
                                                <div
                                                    key={prepStep}
                                                    className={`rounded-2xl border px-4 py-3 transition-all duration-300 ${isReady ? 'border-primary/30 bg-primary/5' : 'border-zinc-800 bg-black/25'}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {isReady ? (
                                                            <CheckCircle size={16} className="text-primary shrink-0" />
                                                        ) : (
                                                            <Loader2 size={16} className="text-zinc-600 shrink-0 animate-spin" />
                                                        )}
                                                        <span className={`text-sm ${isReady ? 'text-white' : 'text-zinc-500'}`}>
                                                            {prepStep}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-zinc-800 bg-[#0c0c0c] p-6 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 text-primary mb-4">
                                            <ScanSearch size={16} />
                                            <span className="text-[10px] font-black uppercase tracking-[0.24em]">What Happens Next</span>
                                        </div>
                                        <div className="space-y-3">
                                            {selectedMode.accountBullets.map((bullet) => (
                                                <div key={bullet} className="flex items-start gap-3 text-sm text-zinc-300">
                                                    <Sparkles size={14} className="text-primary mt-0.5 shrink-0" />
                                                    <span>{bullet}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="mt-8 pt-6 border-t border-zinc-800 flex flex-col gap-4">
                                        <p className="text-xs text-zinc-500 leading-relaxed">
                                            {selectedMode.footnote}
                                        </p>
                                        <button
                                            onClick={() => setStep('account')}
                                            disabled={!canContinueFromPrepare}
                                            className="px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                        >
                                            Continue to Admin
                                            <ArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'account' && selectedMode && (
                        <div className="animate-in slide-in-from-right duration-500 h-full min-h-0 flex flex-col">
                            <button
                                onClick={() => setStep('prepare')}
                                className="text-xs text-zinc-500 hover:text-white mb-4 flex items-center gap-1"
                            >
                                Back
                            </button>

                            <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">Register Admin Account</h2>
                            <p className="text-zinc-500 text-sm mb-6">Create the first admin credentials and finish the selected bootstrap path.</p>

                            <div className="space-y-6 flex-1 min-h-0 overflow-y-auto pr-1">
                                <div className="p-5 rounded-3xl border border-zinc-800 bg-zinc-900/30">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-2xl ${selectedMode.iconPanelClass}`}>
                                            <selectedMode.icon size={20} className={selectedMode.iconClass} />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <h3 className="text-base font-bold text-white">{selectedMode.accountTitle}</h3>
                                                {selectedMode.badge && (
                                                    <span className="px-2.5 py-1 rounded-full bg-primary text-black text-[10px] font-black uppercase tracking-widest">
                                                        {selectedMode.badge}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-zinc-500 leading-relaxed">
                                                {selectedMode.accountDescription}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
                                        {selectedMode.accountBullets.map((bullet) => (
                                            <div key={bullet} className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3">
                                                <Shield size={14} className="text-primary mt-0.5 shrink-0" />
                                                <span className="text-sm text-zinc-300">{bullet}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {mode === 'secure' && (
                                        <div className="mt-5 p-4 bg-primary/5 border border-primary/20 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-2 text-primary">
                                                <Globe size={16} />
                                                <span className="text-xs font-bold uppercase tracking-widest">Detected Geo-Fencing Seed</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                                                <span>Allowed Country:</span>
                                                {detectingLoc ? (
                                                    <span className="flex items-center gap-2 text-white">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        Detecting...
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-white font-mono bg-zinc-800 px-2 py-1 rounded">
                                                            {formData.country || 'Unknown'}
                                                        </span>
                                                        <span className="text-[10px] opacity-60">(Detected)</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {mode === 'migrate' && (
                                        <div className="mt-5 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs leading-relaxed text-blue-100/80">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="max-w-2xl">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-200/60">Migration summary</span>
                                                    <p className="mt-2">
                                                        Setup will run the reviewed migration plan after the first admin is created, then register the translated tables inside OzyBase metadata.
                                                    </p>
                                                </div>
                                                {migrationPreview && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsMigrationPreviewModalOpen(true)}
                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/20 bg-black/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white transition-all hover:border-primary/35 hover:text-primary"
                                                    >
                                                        Open reviewed plan
                                                        <ArrowRight size={14} />
                                                    </button>
                                                )}
                                            </div>
                                            {migrationPreview && (
                                                <div className="mt-4 space-y-4">
                                                    <div className="grid grid-cols-2 gap-3 text-xs xl:grid-cols-4">
                                                        <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                            <span className="mb-1 block text-[10px] uppercase tracking-widest text-blue-200/60">Tables</span>
                                                            <span className="text-base font-black text-white">{migrationPreview.table_count}</span>
                                                        </div>
                                                        <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                            <span className="mb-1 block text-[10px] uppercase tracking-widest text-blue-200/60">Rows</span>
                                                            <span className="text-base font-black text-white">{migrationPreview.row_count}</span>
                                                        </div>
                                                        <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                            <span className="mb-1 block text-[10px] uppercase tracking-widest text-blue-200/60">Source</span>
                                                            <span className="text-sm font-semibold text-white">{selectedMigrationSource.label}</span>
                                                        </div>
                                                        <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                            <span className="mb-1 block text-[10px] uppercase tracking-widest text-blue-200/60">Warnings</span>
                                                            <span className="text-sm font-semibold text-white">{(migrationPreview.warnings?.length || 0) + migrationPreviewTableWarningCount}</span>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl border border-blue-500/20 bg-black/20 px-4 py-4">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-200/60">Included tables</span>
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            {migrationPreviewTableSample.map((table) => (
                                                                <span key={`account-summary-${table.name}`} className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300">
                                                                    {table.name}
                                                                </span>
                                                            ))}
                                                            {migrationPreview.table_count > migrationPreviewTableSample.length && (
                                                                <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                                                    +{migrationPreview.table_count - migrationPreviewTableSample.length} more
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4 rounded-[2rem] border border-zinc-800 bg-zinc-950/60 p-5">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Admin access</p>
                                        <h3 className="text-lg font-bold text-white">Create the first admin credentials</h3>
                                        <p className="mt-1 text-sm text-zinc-500">This account is created after the migration plan is applied, so you land directly in the initialized project.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Email</label>
                                        <input
                                            type="email"
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                            placeholder="admin@company.com"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>
                                    <div className="row flex flex-col md:flex-row gap-4">
                                        <div className="space-y-2 flex-1">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Password</label>
                                            <input
                                                type="password"
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                                placeholder="Minimum 12 characters"
                                                value={formData.password}
                                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2 flex-1">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Confirm</label>
                                            <input
                                                type="password"
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                                placeholder="Repeat the password"
                                                value={formData.confirmPassword}
                                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {serverSummary && (
                                    <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5 text-sm text-zinc-200 animate-in fade-in duration-300">
                                        <div className="flex items-center gap-2 text-primary mb-2">
                                            <CheckCircle size={14} />
                                            <span className="text-[10px] font-black uppercase tracking-[0.24em]">Server Summary</span>
                                        </div>
                                        <p>{serverSummary}</p>
                                        {appliedActions.length > 0 && (
                                            <div className="mt-3 space-y-2">
                                                {appliedActions.map((action) => (
                                                    <div key={`${action.key || action.label}`} className="flex items-start gap-2 text-xs text-zinc-300">
                                                        <CheckCircle size={12} className="text-primary mt-0.5 shrink-0" />
                                                        <div>
                                                            <span className="font-semibold text-white">{action.label || 'Applied action'}</span>
                                                            {action.detail && <span className="text-zinc-400"> {' '} {action.detail}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold rounded-lg flex items-center gap-2">
                                    <Lock size={14} /> {error}
                                </div>
                            )}

                            <div className="mt-6 pt-6 border-t border-zinc-800 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                <p className="text-xs text-zinc-500">
                                    The backend enforces a minimum password length of 12 characters.
                                </p>
                                <button
                                    onClick={handleSetup}
                                    disabled={loading}
                                    className="w-full xl:w-auto px-8 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                                    {loading ? 'Initializing...' : 'Initialize System'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {isMigrationPreviewModalOpen && migrationPreview && mode === 'migrate' && (
                    <MigrationPreviewModal
                        preview={migrationPreview}
                        sourceLabel={selectedMigrationSource.label}
                        importRows={migrationDraft.importRows}
                        onClose={() => setIsMigrationPreviewModalOpen(false)}
                        onContinue={() => {
                            setIsMigrationPreviewModalOpen(false);
                            setStep('account');
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default SetupWizard;
