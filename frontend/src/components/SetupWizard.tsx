import React, { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

type SetupMode = 'clean' | 'secure' | 'migrate';
type WizardStep = 'mode' | 'prepare' | 'account';
type MigrationSourceKind = 'csv' | 'mongo_json' | 'mysql_sql' | 'sqlite_sql' | 'sqlserver_sql' | 'postgres_sql';

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
    },
    {
        id: 'mongo_json',
        label: 'Mongo JSON',
        title: 'Mongo-like JSON',
        hint: 'Map document arrays or { documents: [] } payloads into a relational table.',
        accept: '.json,.txt',
        requiresTableName: true,
    },
    {
        id: 'mysql_sql',
        label: 'MySQL SQL',
        title: 'MySQL schema dump',
        hint: 'Translate CREATE TABLE and INSERT statements from MySQL.',
        accept: '.sql,.txt',
        requiresTableName: false,
    },
    {
        id: 'sqlite_sql',
        label: 'SQLite SQL',
        title: 'SQLite schema dump',
        hint: 'Translate SQLite DDL/INSERT statements into PostgreSQL.',
        accept: '.sql,.txt',
        requiresTableName: false,
    },
    {
        id: 'sqlserver_sql',
        label: 'SQL Server',
        title: 'SQL Server schema dump',
        hint: 'Translate SQL Server table definitions and INSERT batches.',
        accept: '.sql,.txt',
        requiresTableName: false,
    },
    {
        id: 'postgres_sql',
        label: 'Postgres SQL',
        title: 'Postgres DDL',
        hint: 'Bootstrap existing Postgres DDL into OzyBase metadata and setup-time imports.',
        accept: '.sql,.txt',
        requiresTableName: false,
    },
];

const stepLabels: Array<{ id: WizardStep; label: string }> = [
    { id: 'mode', label: 'Choose Mode' },
    { id: 'prepare', label: 'Review Plan' },
    { id: 'account', label: 'Register Admin' },
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
    const [migrationFileName, setMigrationFileName] = useState('');

    const selectedMode = useMemo(() => (
        mode ? modeDetails[mode] : null
    ), [mode]);

    const selectedMigrationSource = useMemo(() => (
        migrationSourceOptions.find((option) => option.id === migrationDraft.sourceKind) || migrationSourceOptions[0]
    ), [migrationDraft.sourceKind]);

    const canContinueFromPrepare = mode === 'migrate'
        ? Boolean(migrationPreview) && !migrationPreviewing
        : prepProgress >= (selectedMode?.prepSteps.length || 0);

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

    const handleModeSelect = (nextMode: SetupMode) => {
        setMode(nextMode);
        setStep('prepare');
        setError('');
        setServerSummary('');
        setAppliedActions([]);
        if (nextMode !== 'migrate') {
            setMigrationPreview(null);
            setMigrationPreviewing(false);
        }
    };

    const handleMigrationDraftChange = (updates: Partial<MigrationDraft>) => {
        setMigrationDraft((prev) => ({ ...prev, ...updates }));
        setMigrationPreview(null);
        setError('');
    };

    const handleMigrationFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent: ProgressEvent<FileReader>) => {
            const text = loadEvent.target?.result;
            if (typeof text !== 'string') {
                return;
            }

            setMigrationFileName(file.name);
            setMigrationDraft((prev) => ({
                ...prev,
                rawInput: text,
                tableName: !prev.tableName || prev.tableName === 'imported_records'
                    ? sanitizeImportedTableName(file.name)
                    : prev.tableName,
            }));
            setMigrationPreview(null);
            setError('');
        };
        reader.readAsText(file);
    };

    const handleAnalyzeMigration = async () => {
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
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-500">
            <div className="w-full max-w-5xl bg-[#0a0a0a] border border-zinc-800 rounded-[2rem] overflow-hidden shadow-2xl flex max-h-[calc(100vh-2rem)] min-h-[620px] flex-col md:min-h-[640px] md:flex-row">
                <div className="w-full md:w-[30%] bg-zinc-900/50 p-8 flex flex-col justify-between border-r border-zinc-800 relative overflow-y-auto">
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

                <div className="flex-1 min-h-0 p-8 md:p-12 flex flex-col relative">
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
                                <p className="text-zinc-500 text-sm max-w-3xl">{selectedMode.prepDescription}</p>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6 flex-1 min-h-0">
                                <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900/30 p-6 flex flex-col min-h-0 overflow-y-auto">
                                    <div className="flex items-center gap-3 mb-5">
                                        <div className={`p-3 rounded-2xl ${selectedMode.iconPanelClass}`}>
                                            <selectedMode.icon size={20} className={selectedMode.iconClass} />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white">Source intake</h3>
                                            <p className="text-xs text-zinc-500">Choose the input you want OzyBase to translate into PostgreSQL.</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                                        {migrationSourceOptions.map((source) => (
                                            <button
                                                key={source.id}
                                                onClick={() => handleMigrationDraftChange({ sourceKind: source.id })}
                                                className={`rounded-2xl border p-4 text-left transition-all ${migrationDraft.sourceKind === source.id ? 'border-primary/40 bg-primary/8' : 'border-zinc-800 bg-black/20 hover:border-zinc-700'}`}
                                            >
                                                <div className="flex items-center justify-between gap-3 mb-2">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">{source.label}</span>
                                                    {migrationDraft.sourceKind === source.id && <CheckCircle size={14} className="text-primary" />}
                                                </div>
                                                <p className="text-sm font-semibold text-white mb-1">{source.title}</p>
                                                <p className="text-xs text-zinc-500 leading-relaxed">{source.hint}</p>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
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
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Upload Source File</label>
                                            <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3">
                                                <input
                                                    type="file"
                                                    accept={selectedMigrationSource.accept}
                                                    onChange={handleMigrationFileUpload}
                                                    className="text-xs text-zinc-400 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:text-black"
                                                />
                                                <p className="text-xs text-zinc-500">
                                                    {migrationFileName ? `Loaded ${migrationFileName}` : `Accepted formats: ${selectedMigrationSource.accept}`}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Paste Schema / Data</label>
                                            <textarea
                                                className="w-full min-h-[260px] resize-y bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-sm text-white focus:border-primary/50 focus:outline-none transition-all"
                                                placeholder={selectedMigrationSource.id === 'csv'
                                                    ? 'id,name,email\n1,Ana,ana@example.com'
                                                    : selectedMigrationSource.id === 'mongo_json'
                                                        ? '[{\"name\":\"Ana\",\"email\":\"ana@example.com\"}]'
                                                        : 'CREATE TABLE users (...);\nINSERT INTO users (...) VALUES (...);'}
                                                value={migrationDraft.rawInput}
                                                onChange={(e) => handleMigrationDraftChange({ rawInput: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-black/25 p-4">
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
                                            {migrationPreviewing ? 'Analyzing...' : 'Analyze Migration'}
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-zinc-800 bg-[#0c0c0c] p-6 flex flex-col min-h-0">
                                    <div className="flex items-center gap-2 text-primary mb-4">
                                        <ScanSearch size={16} />
                                        <span className="text-[10px] font-black uppercase tracking-[0.24em]">Migration Preview</span>
                                    </div>

                                    {migrationPreview ? (
                                        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                                            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                                                <p className="text-sm text-white font-semibold mb-2">{migrationPreview.summary}</p>
                                                <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
                                                    <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-3">
                                                        <span className="block text-zinc-500 uppercase tracking-widest text-[10px] mb-1">Tables</span>
                                                        <span className="text-white text-lg font-black">{migrationPreview.table_count}</span>
                                                    </div>
                                                    <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-3">
                                                        <span className="block text-zinc-500 uppercase tracking-widest text-[10px] mb-1">Rows</span>
                                                        <span className="text-white text-lg font-black">{migrationPreview.row_count}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {migrationPreview.warnings?.map((warning) => (
                                                <div key={warning} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/85">
                                                    {warning}
                                                </div>
                                            ))}

                                            {migrationPreview.tables.map((table) => (
                                                <div key={table.name} className="rounded-3xl border border-zinc-800 bg-black/25 p-4 space-y-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-1">{table.display_name}</p>
                                                            <h3 className="text-lg font-bold text-white">{table.name}</h3>
                                                        </div>
                                                        <div className="text-right text-xs text-zinc-400">
                                                            <div>{table.column_count} columns</div>
                                                            <div>{table.detected_rows} rows detected</div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        {table.columns.map((column) => (
                                                            <div key={`${table.name}-${column.name}`} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                                                                <span className="text-white font-medium">{column.name}</span>
                                                                <span className="text-zinc-400">{column.type}{column.is_primary ? ' • PK' : ''}{column.required ? ' • required' : ''}</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500 mb-2">Translated PostgreSQL</div>
                                                        <pre className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap overflow-x-auto">{table.translated_sql}</pre>
                                                    </div>

                                                    {table.warnings?.map((warning) => (
                                                        <div key={`${table.name}-${warning}`} className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-100/85">
                                                            {warning}
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex-1 flex flex-col justify-between">
                                            <div className="space-y-3">
                                                {selectedMode.prepSteps.map((prepStep) => (
                                                    <div key={prepStep} className="rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 text-sm text-zinc-500 flex items-center gap-3">
                                                        {migrationPreviewing ? <Loader2 size={16} className="text-primary shrink-0 animate-spin" /> : <Sparkles size={14} className="text-primary shrink-0" />}
                                                        <span>{prepStep}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="mt-6 text-xs text-zinc-500 leading-relaxed">
                                                Analyze the source first so the wizard can show the translated PostgreSQL output, inferred columns, warnings, and the exact row counts that setup will import.
                                            </p>
                                        </div>
                                    )}

                                    <div className="mt-6 pt-6 border-t border-zinc-800 flex flex-col gap-4">
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

                                    <div className="mt-5 grid grid-cols-1 gap-3">
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
                                        <div className="mt-5 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl text-xs text-blue-100/80 leading-relaxed space-y-3">
                                            <p>
                                                Setup will run the migration plan you reviewed in the previous step, create the translated PostgreSQL tables, and register them inside OzyBase metadata during the first bootstrap.
                                            </p>
                                            {migrationPreview && (
                                                <div className="grid grid-cols-2 gap-3 text-xs">
                                                    <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                        <span className="block text-blue-200/60 uppercase tracking-widest text-[10px] mb-1">Tables</span>
                                                        <span className="text-white text-base font-black">{migrationPreview.table_count}</span>
                                                    </div>
                                                    <div className="rounded-xl border border-blue-500/20 bg-black/20 px-3 py-3">
                                                        <span className="block text-blue-200/60 uppercase tracking-widest text-[10px] mb-1">Rows</span>
                                                        <span className="text-white text-base font-black">{migrationPreview.row_count}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4">
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

                            <div className="mt-6 pt-6 border-t border-zinc-800 flex items-center justify-between gap-4">
                                <p className="text-xs text-zinc-500">
                                    The backend enforces a minimum password length of 12 characters.
                                </p>
                                <button
                                    onClick={handleSetup}
                                    disabled={loading}
                                    className="px-8 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                                    {loading ? 'Initializing...' : 'Initialize System'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SetupWizard;
