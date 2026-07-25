import React, { useMemo, useState } from 'react';
import { X, Check, Plus, Trash2, Shield, Info, Link as LinkIcon, Settings, FileUp, GripVertical, Lock, Key, Zap, Database, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { createTable, updateTable, fetchTableSchema, type ColumnDraft, type TableMutationPayload } from '../services/schemaService';
import { dispatchProjectSync } from '../utils/projectEvents';
import OzySelect from './OzySelect';
import { BrandedToast } from './OverlayPrimitives';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

type RlsAction = 'select' | 'insert' | 'update' | 'delete';
type RlsRole = string;
type RlsStrategy = 'owner_only' | 'team_scope' | 'workspace_scope' | 'authenticated_full' | 'public_read_only' | 'public_read_owner_write' | 'deny_all' | 'custom';
type SecurityPosture = 'easy' | 'secure' | 'fortress' | 'custom';

interface RlsPolicies {
    select: string;
    insert: string;
    update: string;
    delete: string;
}

interface RlsPolicyRoles {
    select: RlsRole[];
    insert: RlsRole[];
    update: RlsRole[];
    delete: RlsRole[];
}



type TableModalMode = 'create' | 'edit';

interface EditableTableSummary {
    name: string;
    display_name?: string;
    realtime_enabled?: boolean;
    rls_enabled?: boolean;
    rls_rule?: string;
    has_id?: boolean;
    has_primary_id?: boolean;
    primary_key_column?: string;
    has_created_at?: boolean;
    has_updated_at?: boolean;
    has_deleted_at?: boolean;
}

interface CreateTableModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTableCreated: (tableName?: string) => void;
    onMenuViewSelect: (view: string) => void;
    schema?: string;
    mode?: TableModalMode;
    tableToEdit?: EditableTableSummary | null;
}

interface CollectionSummary {
    name: string;
}

type CsvRecord = Record<string, string>;
type JsonRecord = Record<string, unknown>;

interface InitialEditState {
    tableName: string;
    realtimeEnabled: boolean;
    primaryColumns: string[];
    columns: Map<string, EditableColumnState>;
}

interface EditableColumnState {
    name: string;
    type: string;
    defaultValue: string;
    required: boolean;
}

const RLS_ACTIONS: RlsAction[] = ['select', 'insert', 'update', 'delete'];
const DATA_TYPES = [
    'uuid', 'text', 'varchar', 'int8', 'int4', 'int2', 'numeric', 'float8', 'bool', 'timestamptz', 'date', 'jsonb', 'text_array'
];
const SYSTEM_COLUMN_NAMES = new Set(['id', 'updated_at', 'deleted_at', 'created_at']);

const SECURITY_POSTURE_CARDS: Array<{ key: SecurityPosture; title: string; copy: string; accent: string }> = [
    {
        key: 'easy',
        title: 'Easy Mode',
        copy: 'Ideal for prototypes & public catalogs. Public read access, authenticated write access.',
        accent: 'border-emerald-500/40',
    },
    {
        key: 'secure',
        title: 'Secure Mode',
        copy: 'Standard for private apps. Users can only access rows belonging to them.',
        accent: 'border-sky-500/40',
    },
    {
        key: 'fortress',
        title: 'Strict Mode',
        copy: 'Total isolation. All row access requires explicit custom SQL policy rules.',
        accent: 'border-rose-500/40',
    },
];

const makeColumnId = (): string => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createColumn = (overrides: Partial<ColumnDraft> = {}): ColumnDraft => ({
    id: makeColumnId(),
    name: '',
    type: 'text',
    defaultValue: '',
    isPrimary: false,
    isSystem: false,
    unique: false,
    required: false,
    references: '',
    ...overrides
});

const getDefaultColumns = (): ColumnDraft[] => ([
    createColumn({ name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: false })
]);


const DEFAULT_OWNER_FIELD = 'user_id';
const OWNER_FIELD_CANDIDATES = ['owner_id', 'user_id', 'created_by', 'author_id', 'account_id'];

const POLICY_REQUIRED_COLUMN_BY_PRESET: Partial<Record<RlsStrategy, string>> = {
    owner_only: 'user_id',
    team_scope: 'team_id',
    workspace_scope: 'workspace_id',
};

const resolveRequiredPolicyColumn = (preset: RlsStrategy, ownerField: string): string => {
    if (preset === 'owner_only') {
        return normalizeIdentifier(ownerField) || DEFAULT_OWNER_FIELD;
    }
    return POLICY_REQUIRED_COLUMN_BY_PRESET[preset] || '';
};

const buildOwnerRule = (ownerField: string): string => {
    const field = normalizeIdentifier(ownerField) || DEFAULT_OWNER_FIELD;
    return `(select auth.uid()) IS NOT NULL AND (select auth.uid()) = ${field}`;
};

const buildPoliciesForStrategy = (strategy: RlsStrategy, ownerField: string): RlsPolicies => {
    switch (strategy) {
        case 'owner_only': {
            const ownerRule = buildOwnerRule(ownerField);
            return {
                select: ownerRule,
                insert: ownerRule,
                update: ownerRule,
                delete: ownerRule,
            };
        }
        case 'team_scope': {
            const teamRule = "((select auth.jwt()) -> 'app_metadata' ->> 'team_id') IS NOT NULL AND team_id::text = ((select auth.jwt()) -> 'app_metadata' ->> 'team_id')";
            return {
                select: teamRule,
                insert: teamRule,
                update: teamRule,
                delete: teamRule,
            };
        }
        case 'workspace_scope': {
            const workspaceRule = "((select auth.jwt()) -> 'app_metadata' ->> 'workspace_id') IS NOT NULL AND workspace_id::text = ((select auth.jwt()) -> 'app_metadata' ->> 'workspace_id')";
            return {
                select: workspaceRule,
                insert: workspaceRule,
                update: workspaceRule,
                delete: workspaceRule,
            };
        }
        case 'authenticated_full':
            return {
                select: 'true',
                insert: 'true',
                update: 'true',
                delete: 'true',
            };
        case 'public_read_only':
            return {
                select: 'true',
                insert: 'false',
                update: 'false',
                delete: 'false',
            };
        case 'public_read_owner_write': {
            return {
                select: 'true',
                insert: 'true',
                update: 'true',
                delete: 'true',
            };
        }
        case 'deny_all':
            return {
                select: 'false',
                insert: 'false',
                update: 'false',
                delete: 'false',
            };
        case 'custom':
        default:
            return {
                select: '',
                insert: '',
                update: '',
                delete: '',
            };
    }
};

const RLS_ROLE_OPTIONS: Array<{ value: RlsRole; label: string }> = [
    { value: 'authenticated', label: 'authenticated' },
    { value: 'anon', label: 'anon' },
    { value: 'public', label: 'public' },
    { value: 'service_role', label: 'service_role' },
];

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) return error.message;
    return fallback;
};

const describeTableMutationError = (rawMessage: string): { inline: string; toast: string; title: string } => {
    const message = String(rawMessage || '').trim();
    const lower = message.toLowerCase();

    if (lower.includes('pg_undefined_relation') || lower.includes('undefined relation') || lower.includes('undefined_relation') || lower.includes('secuencia') || lower.includes('sequence')) {
        return {
            inline: 'La secuencia o tabla referenciada no existe. Revisa DEFAULT con nextval(...) o usa gen_random_uuid()/identity.',
            toast: 'Falta una secuencia o relación referenciada en un DEFAULT.',
            title: 'Secuencia faltante',
        };
    }
    if (lower.includes('pg_undefined_column') || lower.includes('undefined column') || lower.includes('undefined_column')) {
        return {
            inline: 'Una columna referenciada no existe. Verifica nombres en DEFAULT y reglas RLS.',
            toast: 'Hay columnas referenciadas que no existen en la tabla.',
            title: 'Columna inválida',
        };
    }
    if (lower.includes('pg_syntax_error') || lower.includes('syntax') || lower.includes('42601')) {
        return {
            inline: 'Hay un error de sintaxis SQL en una expresión (DEFAULT, relación o política).',
            toast: 'Revisa sintaxis SQL en defaults o políticas.',
            title: 'Sintaxis SQL',
        };
    }
    if (lower.includes('pg_invalid_text_representation') || lower.includes('invalid input syntax') || lower.includes('22p02')) {
        return {
            inline: 'Un valor no coincide con el tipo de dato esperado (uuid, numeric, date, etc.).',
            toast: 'Formato de dato inválido para alguna columna.',
            title: 'Tipo de dato inválido',
        };
    }

    return {
        inline: message || 'No se pudo guardar la tabla. Revisa columnas, defaults y llaves primarias.',
        toast: message || 'No se pudo guardar la tabla.',
        title: 'Error al guardar',
    };
};

const normalizeIdentifier = (value: unknown): string => {
    const cleaned = String(value || '')
        .replace(/^\ufeff/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_ñáéíóúü]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!cleaned) return '';
    if (/^[0-9]/.test(cleaned)) return `t_${cleaned}`;
    return cleaned.slice(0, 63);
};

const hasColumnNamed = (columns: ColumnDraft[], fieldName: string): boolean => (
    columns.some((column) => normalizeIdentifier(column.name) === normalizeIdentifier(fieldName))
);

const getOwnerFieldCandidates = (columns: ColumnDraft[]): string[] => {
    const known = new Set<string>();
    const ordered: string[] = [];

    for (const candidate of OWNER_FIELD_CANDIDATES) {
        const normalizedCandidate = normalizeIdentifier(candidate);
        if (normalizedCandidate && !known.has(normalizedCandidate)) {
            known.add(normalizedCandidate);
            ordered.push(normalizedCandidate);
        }
    }

    for (const column of columns) {
        const normalizedColumn = normalizeIdentifier(column.name);
        if (!normalizedColumn || known.has(normalizedColumn)) continue;
        known.add(normalizedColumn);
        ordered.push(normalizedColumn);
    }

    return ordered;
};

const ensurePolicyOwnerColumn = (columns: ColumnDraft[], fieldName: string): ColumnDraft[] => {
    const normalizedFieldName = normalizeIdentifier(fieldName);
    if (!normalizedFieldName || hasColumnNamed(columns, normalizedFieldName)) {
        return columns;
    }

    const defaultsByField: Record<string, Partial<ColumnDraft>> = {
        user_id: { type: 'uuid', defaultValue: '(auth.uid())', required: true },
        team_id: { type: 'uuid', defaultValue: 'auth.team_id()', required: true },
        workspace_id: { type: 'uuid', defaultValue: 'auth.workspace_id()', required: true },
    };
    const fieldDefaults = defaultsByField[normalizedFieldName] || { type: 'uuid', required: false };

    const ownerColumn = createColumn({
        name: normalizedFieldName,
        type: fieldDefaults.type || 'uuid',
        defaultValue: fieldDefaults.defaultValue || '',
        required: Boolean(fieldDefaults.required),
    });
    const createdAtIndex = columns.findIndex((column) => normalizeIdentifier(column.name) === 'created_at');
    if (createdAtIndex >= 0) {
        return [
            ...columns.slice(0, createdAtIndex),
            ownerColumn,
            ...columns.slice(createdAtIndex)
        ];
    }
    return [...columns, ownerColumn];
};

const buildUniqueIdentifiers = (values: Array<string | undefined>, fallbackPrefix: string): string[] => {
    const used = new Map<string, number>();
    return values.map((value: any, index: any) => {
        const baseRaw = normalizeIdentifier(value);
        const base = baseRaw || `${fallbackPrefix}_${index + 1}`;
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const next = count === 0 ? base : `${base}_${count + 1}`;
        return next.slice(0, 63);
    });
};

const normalizeColumnType = (value: unknown): string => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'text';

    if (normalized === 'timestampz' || normalized === 'timestamp with time zone') return 'timestamptz';
    if (normalized === 'boolean') return 'bool';
    if (normalized === 'bigint') return 'int8';
    if (normalized === 'integer') return 'int4';
    if (normalized === 'smallint') return 'int2';
    if (normalized === 'character varying') return 'varchar';
    if (normalized === 'double precision') return 'float8';
    if (normalized === 'real') return 'float4';
    if (normalized === 'array') return 'text_array';

    return normalized;
};

const createInitialRlsPolicies = (): RlsPolicies => createDisabledRlsPolicies();

const createRlsRolesForPreset = (presetKey: string): RlsPolicyRoles => {
    if (presetKey === 'public_read_owner_write') {
        return {
            select: ['public'],
            insert: ['authenticated'],
            update: ['authenticated'],
            delete: ['authenticated'],
        };
    }

    if (presetKey === 'public_read_only') {
        return {
            select: ['public'],
            insert: ['authenticated'],
            update: ['authenticated'],
            delete: ['authenticated'],
        };
    }

    if (presetKey === 'deny_all') {
        return {
            select: ['authenticated'],
            insert: ['authenticated'],
            update: ['authenticated'],
            delete: ['authenticated'],
        };
    }

    return {
        select: ['authenticated'],
        insert: ['authenticated'],
        update: ['authenticated'],
        delete: ['authenticated'],
    };
};

const createInitialRlsRoles = (): RlsPolicyRoles => createRlsRolesForPreset('custom');

const createDisabledRlsPolicies = (): RlsPolicies => ({
    select: '',
    insert: '',
    update: '',
    delete: '',
});

const normalizeDefaultValue = (value: unknown): string => String(value ?? '').trim();

const toEditableColumnState = (column: Pick<ColumnDraft, 'name' | 'type' | 'defaultValue' | 'required'>): EditableColumnState => ({
    name: normalizeIdentifier(column.name),
    type: normalizeColumnType(column.type),
    defaultValue: normalizeDefaultValue(column.defaultValue),
    required: Boolean(column.required),
});

const normalizePrimaryColumns = (columns: ColumnDraft[]): string[] => (
    columns
        .filter((column) => column.isPrimary)
        .map((column) => normalizeIdentifier(column.name))
        .filter(Boolean)
);

const areStringSlicesEqual = (left: string[], right: string[]): boolean => {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
};

const buildColumnUpdatePayload = (
    initial: EditableColumnState,
    current: EditableColumnState
): Record<string, unknown> | null => {
    const payload: Record<string, unknown> = {};

    if (current.name !== initial.name) {
        payload.next_name = current.name;
    }
    if (current.type !== initial.type) {
        payload.type = current.type;
    }
    if (current.required !== initial.required) {
        payload.required = current.required;
    }
    if (current.defaultValue !== initial.defaultValue) {
        if (current.defaultValue) {
            payload.default_mode = 'set';
            payload.default_value = current.defaultValue;
        } else if (initial.defaultValue) {
            payload.default_mode = 'drop';
        }
    }

    return Object.keys(payload).length > 0 ? payload : null;
};

const createColumnsFromSchema = (schemaItems: any[], tableMeta?: EditableTableSummary | null): ColumnDraft[] => {
    const drafts: ColumnDraft[] = [];
    const seen = new Set<string>();
    const normalizedPrimaryColumn = normalizeIdentifier(
        tableMeta?.primary_key_column || '',
    );
    const hasSinglePrimaryColumn = Boolean(tableMeta?.has_primary_id);

    (Array.isArray(schemaItems) ? schemaItems : []).forEach((column: any) => {
        const columnName = normalizeIdentifier(column?.name);
        if (!columnName || seen.has(columnName)) {
            return;
        }

        drafts.push(createColumn({
            name: columnName,
            type: normalizeColumnType(column?.type),
            defaultValue: normalizeDefaultValue(column?.default),
            isPrimary: hasSinglePrimaryColumn &&
                ((normalizedPrimaryColumn !== '' && columnName === normalizedPrimaryColumn) ||
                    (normalizedPrimaryColumn === '' && columnName === 'id')),
            isSystem: SYSTEM_COLUMN_NAMES.has(columnName) && columnName !== 'id',
            required: Boolean(column?.required),
            sourceName: columnName,
        }));
        seen.add(columnName);
    });

    if (tableMeta?.has_created_at && !seen.has('created_at')) {
        drafts.push(createColumn({
            name: 'created_at',
            type: 'timestamptz',
            defaultValue: 'now()',
            isSystem: false,
            sourceName: 'created_at',
        }));
        seen.add('created_at');
    }

    if (tableMeta?.has_updated_at && !seen.has('updated_at')) {
        drafts.push(createColumn({
            name: 'updated_at',
            type: 'timestamptz',
            defaultValue: 'now()',
            isSystem: true,
            sourceName: 'updated_at',
        }));
        seen.add('updated_at');
    }

    if (tableMeta?.has_deleted_at && !seen.has('deleted_at')) {
        drafts.push(createColumn({
            name: 'deleted_at',
            type: 'timestamptz',
            defaultValue: '',
            isSystem: true,
            sourceName: 'deleted_at',
        }));
    }

    return drafts.length > 0 ? drafts : getDefaultColumns();
};

const CreateTableModal: React.FC<CreateTableModalProps> = ({
    isOpen,
    onClose,
    onTableCreated,
    onMenuViewSelect,
    schema = 'public',
    mode = 'create',
    tableToEdit = null,
}: any) => {
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closingRef = React.useRef(false);
    const initialEditStateRef = React.useRef<InitialEditState | null>(null);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isRLSEnabled, setIsRLSEnabled] = useState(true);
    const [showAdvancedRls, setShowAdvancedRls] = useState(false);
    const [showSqlPolicyEditor, setShowSqlPolicyEditor] = useState(false);
    const [rlsPreset, setRlsPreset] = useState<RlsStrategy>('owner_only');
    const [securityPosture, setSecurityPosture] = useState<SecurityPosture>('secure');
    const [rlsForceEnabled, setRlsForceEnabled] = useState(false);
    const [rlsOwnerField, setRlsOwnerField] = useState(DEFAULT_OWNER_FIELD);
    const [rlsPolicies, setRlsPolicies] = useState(() => buildPoliciesForStrategy('owner_only', DEFAULT_OWNER_FIELD));
    const [rlsRoles, setRlsRoles] = useState(() => createRlsRolesForPreset('owner_only'));
    const [isRealtimeEnabled, setIsRealtimeEnabled] = useState(false);

    // Default columns
    const [columns, setColumns] = useState(() => getDefaultColumns());

    const [loading, setLoading] = useState(false);
    const [isHydrating, setIsHydrating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [csvRecords, setCsvRecords] = useState<CsvRecord[]>([]);
    const [allTables, setAllTables] = useState<CollectionSummary[]>([]); // For relations
    const [relationEditorIndex, setRelationEditorIndex] = useState<number | null>(null);
    const [isRelationModalOpen, setIsRelationModalOpen] = useState(false);
    const [selectedColumnForRelation, setSelectedColumnForRelation] = useState<ColumnDraft | null>(null);
    const [relationDraft, setRelationDraft] = useState('');
    const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; tone: 'error' | 'warning' | 'success' | 'info'; title?: string } | null>(null);
    const isEditMode = mode === 'edit' && Boolean(tableToEdit?.name);
    const normalizedTableName = useMemo(() => normalizeIdentifier(name), [name]);
    const ownerFieldCandidates = useMemo(() => getOwnerFieldCandidates(columns), [columns]);
    const ownerFieldTypeMap = useMemo(() => {
        const map = new Map<string, string>();
        columns.forEach((column: any) => {
            const normalizedName = normalizeIdentifier(column.name);
            if (!normalizedName) return;
            map.set(normalizedName, String(column.type || '').trim().toLowerCase() || 'unknown');
        });
        return map;
    }, [columns]);
    const requiredPolicyColumn = useMemo(() => resolveRequiredPolicyColumn(rlsPreset, rlsOwnerField), [rlsPreset, rlsOwnerField]);
    const requiresPolicyOwnerColumn = isRLSEnabled && requiredPolicyColumn !== '';
    const missingOwnerColumn = requiresPolicyOwnerColumn && !hasColumnNamed(columns, requiredPolicyColumn);
    const hasPrimaryKeySelected = useMemo(() => columns.some((column) => Boolean(column.isPrimary)), [columns]);
    const hasUnnamedColumns = useMemo(
        () => columns.some((column) => !column.isSystem && normalizeIdentifier(column.name) === ''),
        [columns]
    );

    const handleRlsPresetChange = (presetKey: RlsStrategy) => {
        setShowAdvancedRls(true);
        setShowSqlPolicyEditor(presetKey === 'custom');
        setRlsPreset(presetKey);
        setSecurityPosture('custom');
        const requiredColumn = resolveRequiredPolicyColumn(presetKey, rlsOwnerField);
        if (requiredColumn) {
            setRlsOwnerField(requiredColumn);
            setColumns((prev: any) => ensurePolicyOwnerColumn(prev, requiredColumn));
        }
        if (presetKey !== 'custom') {
            setRlsPolicies(buildPoliciesForStrategy(presetKey, rlsOwnerField));
            setRlsRoles(createRlsRolesForPreset(presetKey));
        }
    };

    const handleRlsEnabledChange = (enabled: boolean) => {
        setIsRLSEnabled(enabled);
        if (!enabled) {
            setShowAdvancedRls(false);
            setShowSqlPolicyEditor(false);
            return;
        }
    };

    const applySecurityPosture = (posture: SecurityPosture) => {
        setIsRLSEnabled(true);
        setSecurityPosture(posture);
        if (posture === 'easy') {
            setRlsOwnerField(DEFAULT_OWNER_FIELD);
            setRlsPreset('public_read_owner_write');
            setRlsPolicies(buildPoliciesForStrategy('public_read_owner_write', DEFAULT_OWNER_FIELD));
            setRlsRoles(createRlsRolesForPreset('public_read_owner_write'));
            setRlsForceEnabled(false);
            setShowAdvancedRls(false);
            setShowSqlPolicyEditor(false);
            return;
        }
        if (posture === 'secure') {
            setRlsOwnerField(DEFAULT_OWNER_FIELD);
            setRlsPreset('owner_only');
            setRlsPolicies(buildPoliciesForStrategy('owner_only', DEFAULT_OWNER_FIELD));
            setRlsRoles(createRlsRolesForPreset('owner_only'));
            setRlsForceEnabled(false);
            setShowAdvancedRls(false);
            setShowSqlPolicyEditor(false);
            setColumns((prev: any) => ensurePolicyOwnerColumn(prev, DEFAULT_OWNER_FIELD));
            return;
        }
        if (posture === 'fortress') {
            setRlsPreset('custom');
            setRlsPolicies(createDisabledRlsPolicies());
            setRlsRoles(createInitialRlsRoles());
            setRlsForceEnabled(true);
            setShowAdvancedRls(true);
            setShowSqlPolicyEditor(false);
        }
    };

    const handleRlsPolicyChange = (action: RlsAction, value: string) => {
        setShowAdvancedRls(true);
        setRlsPreset('custom');
        setSecurityPosture('custom');
        setRlsPolicies((prev: any) => ({ ...prev, [action]: value }));
    };

    const handleRlsRoleToggle = (action: RlsAction, role: RlsRole) => {
        setShowAdvancedRls(true);
        setRlsPreset('custom');
        setSecurityPosture('custom');
        setRlsRoles((prev: any) => {
            const current = new Set(prev[action] || []);
            if (current.has(role)) current.delete(role);
            else current.add(role);
            return { ...prev, [action]: Array.from(current) };
        });
    };

    const readResponseError = async (res: Response, fallback: string) => {
        const data: unknown = await res.json().catch(() => null);
        if (typeof data !== 'object' || data === null) {
            return fallback;
        }

        const body = data as JsonRecord;
        const message = typeof body.error === 'string' ? body.error : fallback;
        const errorCode = typeof body.error_code === 'string' ? body.error_code : '';
        const hint = typeof body.hint === 'string' ? body.hint : '';

        const parts = [message];
        if (errorCode) parts.push(`[${errorCode}]`);
        if (hint) parts.push(`Hint: ${hint}`);
        return parts.join(' ');
    };

    const runAuthenticatedRequest = React.useCallback(async (
        input: string,
        init: RequestInit,
        fallback: string
    ) => {
        const res = await fetchWithAuth(input, init);
        if (!res.ok) {
            throw new Error(await readResponseError(res, fallback));
        }
        return res;
    }, []);

    const resetFormState = React.useCallback(() => {
        initialEditStateRef.current = null;
        setLoading(false);
        setIsHydrating(false);
        setName('');
        setDescription('');
        setIsRLSEnabled(true);
        setShowAdvancedRls(false);
        setShowSqlPolicyEditor(false);
        setRlsPreset('owner_only');
        setSecurityPosture('secure');
        setRlsForceEnabled(false);
        setRlsOwnerField(DEFAULT_OWNER_FIELD);
        setRlsPolicies(buildPoliciesForStrategy('owner_only', DEFAULT_OWNER_FIELD));
        setRlsRoles(createRlsRolesForPreset('owner_only'));
        setIsRealtimeEnabled(false);
        setColumns(getDefaultColumns());
        setError(null);
        setCsvRecords([]);
        setRelationEditorIndex(null);
        setRelationDraft('');
        setDraggedColumnId(null);
    }, []);

    React.useEffect(() => {
        if (rlsPreset !== 'owner_only') return;
        const normalizedOwnerField = normalizeIdentifier(rlsOwnerField);
        if (!normalizedOwnerField) return;
        setRlsPolicies(buildPoliciesForStrategy(rlsPreset, normalizedOwnerField));
    }, [rlsOwnerField, rlsPreset]);

    React.useEffect(() => {
        if (!ownerFieldCandidates.length) return;
        if (ownerFieldCandidates.includes(normalizeIdentifier(rlsOwnerField))) return;
        setRlsOwnerField(ownerFieldCandidates[0]);
    }, [ownerFieldCandidates, rlsOwnerField]);

    React.useEffect(() => {
        if (!isRLSEnabled) return;
        if (securityPosture !== 'secure') return;
        setRlsOwnerField(DEFAULT_OWNER_FIELD);
        setColumns((prev: any) => ensurePolicyOwnerColumn(prev, DEFAULT_OWNER_FIELD));
    }, [isRLSEnabled, securityPosture]);

    React.useEffect(() => {
        if (!isOpen || isEditMode) return;
        setColumns((prev: any) => prev.map((column: any, index: any) => {
            if (index !== 0) return column;
            const isDefaultId = normalizeIdentifier(column.name) === 'id' && Boolean(column.isPrimary);
            if (!isDefaultId || !column.required) return column;
            return { ...column, required: false };
        }));
    }, [isEditMode, isOpen]);

    React.useEffect(() => {
        const fetchTables = async () => {
            try {
                const res = await fetchWithAuth('/api/collections');
                if (res.ok) {
                    const data: unknown = await res.json();
                    if (Array.isArray(data)) {
                        setAllTables(data.filter((item: any): item is CollectionSummary => (
                            typeof item === 'object' &&
                            item !== null &&
                            typeof (item as CollectionSummary).name === 'string'
                        )));
                    }
                }
            } catch (e: unknown) {
                console.error(e);
            }
        };
        if (isOpen) fetchTables();
    }, [isOpen]);

    React.useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (!isEditMode || !tableToEdit?.name) {
            resetFormState();
            return;
        }

        let isCancelled = false;
        setIsHydrating(true);
        setError(null);

        const loadEditableTable = async () => {
            try {
                const res = await fetchWithAuth(`/api/schema/${tableToEdit.name}`);
                if (!res.ok) {
                    throw new Error(await readResponseError(res, 'Failed to load table schema'));
                }

                const schemaItems = await res.json();
                if (isCancelled) {
                    return;
                }

                const nextColumns = createColumnsFromSchema(schemaItems, tableToEdit);
                const baseRule = String(tableToEdit.rls_rule || '').trim();
                const nextPolicies = tableToEdit.rls_enabled
                    ? {
                        select: baseRule,
                        insert: baseRule,
                        update: baseRule,
                        delete: baseRule,
                    }
                    : createDisabledRlsPolicies();

                setName(tableToEdit.display_name || tableToEdit.name);
                setDescription('');
                setIsRLSEnabled(Boolean(tableToEdit.rls_enabled));
                setRlsPreset('custom');
                setSecurityPosture('custom');
                setShowAdvancedRls(baseRule !== '');
                setShowSqlPolicyEditor(baseRule !== '');
                const nextOwnerCandidates = getOwnerFieldCandidates(nextColumns);
                setRlsOwnerField(nextOwnerCandidates[0] || DEFAULT_OWNER_FIELD);
                setRlsPolicies(nextPolicies);
                setRlsRoles(createInitialRlsRoles());
                setIsRealtimeEnabled(Boolean(tableToEdit.realtime_enabled));
                setColumns(nextColumns);
                setCsvRecords([]);
                setRelationEditorIndex(null);
                setRelationDraft('');
                setDraggedColumnId(null);

                initialEditStateRef.current = {
                    tableName: tableToEdit.name,
                    realtimeEnabled: Boolean(tableToEdit.realtime_enabled),
                    primaryColumns: normalizePrimaryColumns(nextColumns),
                    columns: new Map(
                        nextColumns
                            .filter((column: any) => column.sourceName && !column.isSystem)
                            .map((column: any) => [
                                String(column.sourceName),
                                toEditableColumnState(column)
                            ])
                    ),
                };
            } catch (err: unknown) {
                if (!isCancelled) {
                    setError(getErrorMessage(err, 'Failed to load table'));
                }
            } finally {
                if (!isCancelled) {
                    setIsHydrating(false);
                }
            }
        };

        void loadEditableTable();
        return () => {
            isCancelled = true;
        };
    }, [isEditMode, isOpen, resetFormState, tableToEdit]);

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

    const detectDelimiter = (sampleLines: string[]): string => {
        const candidates = [',', ';', '\t', '|'];
        const scores = new Map<string, number>(candidates.map((delim: any) => [delim, 0]));

        sampleLines.forEach((line: any) => {
            let inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' && line[i + 1] === '"') {
                    i++;
                    continue;
                }
                if (char === '"') {
                    inQuote = !inQuote;
                    continue;
                }
                if (!inQuote && scores.has(char)) {
                    scores.set(char, (scores.get(char) ?? 0) + 1);
                }
            }
        });

        let best = ',';
        for (const delim of candidates) {
            if ((scores.get(delim) ?? 0) > (scores.get(best) ?? 0)) best = delim;
        }
        return (scores.get(best) ?? 0) > 0 ? best : ',';
    };

    const splitCSVLine = (line: string, delimiter: string): string[] => {
        const result: string[] = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (char === '"') {
                inQuote = !inQuote;
            } else if (char === delimiter && !inQuote) {
                result.push(cur.trim());
                cur = '';
            } else {
                cur += char;
            }
        }
        result.push(cur.trim());
        return result;
    };

    const sanitizeColumnName = (value: unknown, index: number): string => {
        const cleaned = String(value || '')
            .replace(/^\ufeff/, '')
            .toLowerCase()
            .replace(/[^a-z0-9_ñáéíóúü]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        return cleaned || `column_${index + 1}`;
    };

    const uniqueColumnNames = (headers: string[]): string[] => {
        const seen = new Map<string, number>();
        return headers.map((header: any, index: any) => {
            const base = sanitizeColumnName(header, index);
            const count = seen.get(base) || 0;
            seen.set(base, count + 1);
            return count === 0 ? base : `${base}_${count + 1}`;
        });
    };

    const inferTypeFromSamples = (samples: Array<string | undefined | null>): string => {
        const values = samples.filter((v: any): v is string => v !== undefined && v !== null && String(v).trim() !== '');
        if (values.length === 0) return 'text';

        if (values.every((v: any) => /^-?\d+$/.test(v.trim()))) return 'int8';
        if (values.every((v: any) => /^-?\d+(\.\d+)?$/.test(v.trim()))) return 'numeric';
        if (values.every((v: any) => /^(true|false)$/i.test(v.trim()))) return 'boolean';
        if (values.every((v: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim()))) return 'uuid';
        if (values.every((v: any) => /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v.trim()))) return 'timestamptz';
        return 'text';
    };

    const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event: ProgressEvent<FileReader>) => {
            const text = event.target?.result;
            if (typeof text !== 'string') return;
            const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
            if (lines.length < 1) return;

            const delimiter = detectDelimiter(lines.slice(0, 5));
            const headers = splitCSVLine(lines[0], delimiter);
            const normalizedHeaders = uniqueColumnNames(headers);
            const allRecords: CsvRecord[] = [];
            const columnSamples: string[][] = normalizedHeaders.map(() => []);

            for (let i = 1; i < lines.length; i++) {
                const values = splitCSVLine(lines[i], delimiter);
                const record: CsvRecord = {};
                normalizedHeaders.forEach((header: any, idx: any) => {
                    const val = values[idx];
                    if (val !== undefined) {
                        record[header] = val;
                        if (columnSamples[idx].length < 20 && String(val).trim() !== '') {
                            columnSamples[idx].push(val);
                        }
                    }
                });
                if (Object.keys(record).length > 0) allRecords.push(record);
            }
            setCsvRecords(allRecords);

            const newCols = normalizedHeaders.map((header: any, idx: any) => {
                return createColumn({
                    name: header,
                    type: inferTypeFromSamples(columnSamples[idx])
                });
            });

            // Merge with default columns (removable)
            setColumns([
                ...newCols,
            ]);

            // Auto-suggest table name from file
            if (!name) {
                const fileName = file.name.split('.')[0];
                setName(fileName);
            }
        };
        reader.readAsText(file);
    };

    const moveColumn = (sourceId: string, targetId: string) => {
        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }

        setColumns((prev: any) => {
            const sourceIndex = prev.findIndex((column: any) => column.id === sourceId);
            const targetIndex = prev.findIndex((column: any) => column.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) {
                return prev;
            }

            const next = [...prev];
            const [moved] = next.splice(sourceIndex, 1);
            next.splice(targetIndex, 0, moved);
            return next;
        });
    };

    const handleAddOwnerColumn = () => {
        const normalizedOwnerField = normalizeIdentifier(requiredPolicyColumn || rlsOwnerField);
        if (!normalizedOwnerField) return;
        setColumns((prev: any) => ensurePolicyOwnerColumn(prev, normalizedOwnerField));
        setError(null);
    };

    if (!shouldRender) return null;

    const addColumn = () => {
        setColumns((prev: any) => [...prev, createColumn()]);
    };

    const removeColumn = (id: string) => {
        setColumns((prev: any) => prev.filter((col: any) => col.id !== id));
    };

    const updateColumn = (id: string, updates: Partial<ColumnDraft>) => {
        setColumns((prev: any) => prev.map((col: any) => {
            if (col.id !== id) return col;
            const next = { ...col, ...updates };
            // Ensure only one primary key if that was the change
            if (updates.isPrimary === true) {
                // This is a bit complex as we might need to unset others, 
                // but usually the UI handles single-pk toggle.
            }
            return next;
        }));
    };

    const handleColumnChange = (index: number, field: keyof ColumnDraft, value: ColumnDraft[keyof ColumnDraft]) => {
        setColumns((prev: any) => prev.map((col: any, i: any) => {
            if (field === 'isPrimary' && value === true) {
                return { ...col, isPrimary: i === index };
            }
            if (i !== index) return col;
            return { ...col, [field]: value };
        }));
    };

    const openRelationEditor = (index: number) => {
        setRelationEditorIndex(index);
        setRelationDraft(String(columns[index]?.references || ''));
    };

    const closeRelationEditor = () => {
        setRelationEditorIndex(null);
        setRelationDraft('');
    };

    const applyRelationDraft = () => {
        if (relationEditorIndex === null) {
            return;
        }
        handleColumnChange(relationEditorIndex, 'references', relationDraft.trim());
        closeRelationEditor();
    };

    const handleSave = async () => {
        if (!normalizedTableName || columns.length === 0 || loading) return;

        setLoading(true);
        setError(null);

        try {
            const shouldApplyPolicyTemplate = isRLSEnabled && (showAdvancedRls || rlsPreset !== 'custom');
            const payloadRlsRule = shouldApplyPolicyTemplate ? (rlsPolicies.select || '') : '';
            
            const payload: TableMutationPayload = {
                name: normalizedTableName,
                description: description.trim(),
                columns,
                rls_enabled: isRLSEnabled,
                rls_rule: payloadRlsRule,
                realtime_enabled: isRealtimeEnabled,
            };

            if (isEditMode && tableToEdit) {
                await updateTable(tableToEdit.name, payload);
            } else {
                await createTable(payload);
            }

            // If we have CSV records, import them
            if (csvRecords.length > 0) {
                await fetchWithAuth(`/api/tables/${normalizedTableName}/import`, {
                    method: 'POST',
                    body: JSON.stringify(csvRecords)
                });
            }

            setToast({ message: `Successfully ${isEditMode ? 'updated' : 'created'} table ${normalizedTableName}`, tone: 'success', title: 'Schema Sync' });
            dispatchProjectSync({
                health: true,
                coverage: true,
                reason: isEditMode ? 'table-updated' : 'table-created',
            });
            onTableCreated(normalizedTableName);
            requestClose();
        } catch (err: any) {
            console.error('Table mutation failed:', err);
            setToast({ message: err.message || 'Critical Allocation Failure', tone: 'error', title: 'Critical Allocation Failure' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-120 flex items-center justify-end p-0 transition-all duration-300 ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={(e: any) => e.target === e.currentTarget && requestClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div
                className={`relative h-full w-full max-w-4xl flex flex-col border-l border-border bg-zinc-900 shadow-2xl transition-transform duration-300 ease-in-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <Settings size={18} className="text-primary" />
                        </div>
                        <div>
                            <h2 className="text-[11px] font-bold text-white uppercase tracking-widest leading-none">
                                {isEditMode ? 'Edit Table' : 'Create Table'}
                            </h2>
                            <p className="mt-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">
                                Configure Schema & Security Policies
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={requestClose}
                        className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-8 bg-zinc-900">
                    <div className="mx-auto max-w-4xl space-y-10">
                        {/* Name & Identity */}
                        <div className="space-y-6">
                            <div className="group space-y-2.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Table Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e: any) => setName(e.target.value)}
                                    className="w-full rounded-md border border-border bg-zinc-950 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-white focus:border-primary/30 outline-none transition-all placeholder:text-zinc-800"
                                    placeholder="table_name"
                                />
                                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-tight text-zinc-600">
                                    <span>Database Identifier:</span>
                                    <span className="text-zinc-400 font-mono">{normalizedTableName || 'none'}</span>
                                    {isEditMode && <span className="text-amber-500/80 ml-2">Warning: Renaming existing table</span>}
                                </div>
                            </div>
                            <div className="group space-y-2.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Description (Optional)</label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e: any) => setDescription(e.target.value)}
                                    className="w-full rounded-md border border-border bg-zinc-950/50 px-4 py-3 text-[11px] text-zinc-400 focus:border-primary/20 outline-none transition-all placeholder:text-zinc-800"
                                    placeholder="Brief description of this table..."
                                />
                            </div>
                        </div>

                        {/* RLS Security Matrix */}
                        <div className="rounded-md border border-border bg-zinc-950/50 p-8 space-y-8">
                            <div className="flex items-start justify-between gap-6">
                                <div className="space-y-2">
                                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Row Level Security (RLS)</h3>
                                    <p className="text-[10px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed max-w-lg">
                                        Enforces granular row-level access control rules. <span className="text-zinc-400 underline decoration-primary/30 decoration-dashed underline-offset-4 cursor-help">Postgres policies enforced.</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">RLS Enabled</label>
                                    <button
                                        type="button"
                                        onClick={() => handleRlsEnabledChange(!isRLSEnabled)}
                                        className={`relative h-6 w-11 rounded-full transition-all duration-300 ${isRLSEnabled ? 'bg-primary' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 h-4 w-4 rounded-full bg-zinc-950 shadow-sm transition-all duration-300 ${isRLSEnabled ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>

                            {isRLSEnabled && (
                                <div className="space-y-8 animate-in fade-in duration-500">
                                    {!showAdvancedRls && (
                                        <div className="space-y-8">
                                            <div className="space-y-5">
                                                <div className="flex items-center gap-3">
                                                    <Shield size={14} className="text-primary" />
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Security Presets</span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    {SECURITY_POSTURE_CARDS.map((card) => {
                                                        const selected = securityPosture === card.key;
                                                        return (
                                                            <button
                                                                key={card.key}
                                                                type="button"
                                                                onClick={() => applySecurityPosture(card.key)}
                                                                className={`group relative rounded-md border p-5 text-left transition-all duration-300 ${
                                                                    selected 
                                                                        ? 'border-primary/40 bg-zinc-900 shadow-inner' 
                                                                        : 'border-border bg-zinc-950/30 hover:border-zinc-700 hover:bg-zinc-900/50'
                                                                }`}
                                                            >
                                                                <div className={`absolute top-0 left-0 h-1 w-full transition-all duration-500 ${selected ? 'bg-primary scale-x-100' : 'bg-zinc-800 scale-x-0 group-hover:scale-x-50'}`} />
                                                                <p className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${selected ? 'text-primary' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                                                                    {card.title}
                                                                </p>
                                                                <p className="mt-3 text-[9px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed">
                                                                    {card.copy}
                                                                </p>
                                                                {selected && (
                                                                    <div className="absolute bottom-3 right-3">
                                                                        <Check size={12} className="text-primary" strokeWidth={3} />
                                                                    </div>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {requiresPolicyOwnerColumn && missingOwnerColumn && (
                                                <div className="flex items-center justify-between gap-6 rounded-md border border-amber-500/20 bg-amber-500/5 p-5">
                                                    <div className="flex items-start gap-4">
                                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                                        <div className="space-y-1">
                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Missing Owner Column</p>
                                                            <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed">
                                                                Selected preset requires column <span className="text-zinc-300 font-mono">{requiredPolicyColumn}</span> (uuid) to map row ownership.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRlsOwnerField(requiredPolicyColumn || DEFAULT_OWNER_FIELD);
                                                            setColumns((prev: any) => ensurePolicyOwnerColumn(prev, requiredPolicyColumn || DEFAULT_OWNER_FIELD));
                                                            setError(null);
                                                        }}
                                                        className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-amber-400 transition-all active:scale-95 shrink-0"
                                                    >
                                                        Add Owner Column
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-4 pt-4 border-t border-border">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onMenuViewSelect('db_api');
                                                        requestClose();
                                                    }}
                                                    className="flex items-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border border-border hover:text-white hover:border-zinc-700 transition-all"
                                                >
                                                    <Info size={12} /> Documentation
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setShowAdvancedRls(true);
                                                        setShowSqlPolicyEditor(false);
                                                    }}
                                                    className="flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300 border border-border hover:bg-zinc-800 hover:border-zinc-600 transition-all"
                                                >
                                                    <Settings size={12} /> Advanced Rules
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {showAdvancedRls && (
                                        <div className="space-y-8 animate-in fade-in duration-500">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-3">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Security_Preset_Vector</label>
                                                    <OzySelect
                                                        value={rlsPreset}
                                                        onChange={(e: any) => handleRlsPresetChange(e.target.value as RlsStrategy)}
                                                        wrapperClassName="rounded-md"
                                                        selectClassName="h-11 text-[10px] font-bold uppercase tracking-widest"
                                                    >
                                                        <option value="owner_only">PRIVATE_OWNER</option>
                                                        <option value="team_scope">TEAM_SHARED</option>
                                                        <option value="workspace_scope">WORKSPACE_SHARED</option>
                                                        <option value="authenticated_full">AUTH_ONLY</option>
                                                        <option value="public_read_only">READ_ONLY</option>
                                                        <option value="public_read_owner_write">READ_PUBLIC_WRITE_AUTH</option>
                                                        <option value="deny_all">DENY_ALL</option>
                                                        <option value="custom">CUSTOM_SQL_KERNEL</option>
                                                    </OzySelect>
                                                </div>

                                                <div className="space-y-3">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Kernel_Privileges</label>
                                                    <div className="rounded-md border border-border bg-zinc-950 p-4">
                                                        <label className="flex items-center justify-between cursor-pointer group">
                                                            <div className="space-y-0.5">
                                                                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 group-hover:text-white transition-colors">Force_RLS_Matrix</span>
                                                                <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic">// Enforce policies for table owners.</p>
                                                            </div>
                                                            <input
                                                                type="checkbox"
                                                                checked={rlsForceEnabled}
                                                                onChange={(e: any) => {
                                                                    setRlsForceEnabled(e.target.checked);
                                                                    setSecurityPosture('custom');
                                                                }}
                                                                className="h-4 w-4 rounded border-border bg-zinc-900 text-primary accent-primary"
                                                            />
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowSqlPolicyEditor((prev) => !prev)}
                                                    className="flex items-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border border-border hover:text-white hover:border-zinc-700 transition-all"
                                                >
                                                    {showSqlPolicyEditor ? '[-] Hide_SQL_Matrix' : '[+] Edit_SQL_Matrix'}
                                                </button>
                                            </div>

                                            {showSqlPolicyEditor && rlsPreset === 'owner_only' && (
                                                <div className="space-y-3 animate-in fade-in duration-300">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Owner_Field_Vector</label>
                                                    <OzySelect
                                                        value={normalizeIdentifier(rlsOwnerField) || DEFAULT_OWNER_FIELD}
                                                        onChange={(e: any) => setRlsOwnerField(e.target.value)}
                                                        wrapperClassName="rounded-md"
                                                        selectClassName="h-11 text-[10px] font-bold uppercase tracking-widest"
                                                    >
                                                        {ownerFieldCandidates.map((field) => (
                                                            <option key={field} value={field}>{`${field} :: ${ownerFieldTypeMap.get(field) || 'UNKNOWN'}`}</option>
                                                        ))}
                                                    </OzySelect>
                                                </div>
                                            )}

                                            {showSqlPolicyEditor && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
                                                    {RLS_ACTIONS.map((action) => (
                                                        <div key={action} className="space-y-3 p-5 rounded-md border border-border bg-zinc-950/50">
                                                            <div className="flex items-center justify-between">
                                                                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">
                                                                    {action}_Policy
                                                                </label>
                                                                <div className="flex items-center gap-1.5">
                                                                    {RLS_ROLE_OPTIONS.map((roleOpt) => {
                                                                        const selected = (rlsRoles[action] || []).includes(roleOpt.value);
                                                                        return (
                                                                            <button
                                                                                key={`${action}_${roleOpt.value}`}
                                                                                type="button"
                                                                                onClick={() => handleRlsRoleToggle(action, roleOpt.value)}
                                                                                className={`px-2 py-0.5 rounded-md border text-[8px] font-bold uppercase tracking-widest transition-all ${
                                                                                    selected 
                                                                                        ? 'border-primary/50 bg-primary/10 text-primary' 
                                                                                        : 'border-border bg-zinc-900 text-zinc-700 hover:text-zinc-400 hover:border-zinc-700'
                                                                                }`}
                                                                            >
                                                                                {roleOpt.label}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                value={rlsPolicies[action] || ''}
                                                                onChange={(e: any) => handleRlsPolicyChange(action, e.target.value)}
                                                                className="w-full bg-zinc-950 border border-border rounded-md px-4 py-2.5 text-[11px] font-mono text-zinc-400 focus:border-primary/30 outline-none transition-all placeholder:text-zinc-900"
                                                                placeholder="false"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {showSqlPolicyEditor && (
                                                <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic">
                                                    // Kernel_Logic: Use SQL boolean expressions. Example: <span className="text-zinc-500">(select auth.uid()) = user_id</span> or <span className="text-zinc-500">true</span>.
                                                </p>
                                            )}

                                            {showSqlPolicyEditor && missingOwnerColumn && (
                                                <div className="flex items-start gap-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-4">
                                                    <Shield size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                                    <p className="text-[10px] font-bold uppercase tracking-tight text-zinc-600 italic leading-relaxed">
                                                        Preset mismatch: Expected vector <span className="text-zinc-400 font-mono">{requiredPolicyColumn || normalizeIdentifier(rlsOwnerField)}</span> is missing from schema.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Realtime Stream Node */}
                        <div className="rounded-md border border-border bg-zinc-950/50 p-8">
                            <div className="flex items-start justify-between gap-6">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <Zap size={14} className="text-primary" />
                                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Realtime Events</h3>
                                    </div>
                                    <p className="text-[10px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed max-w-lg">
                                        Broadcast row mutation events in real-time via WebSocket. <span className="text-zinc-400 underline decoration-primary/30 decoration-dashed underline-offset-4 cursor-help">Supabase Realtime enabled.</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Realtime Enabled</label>
                                    <button
                                        type="button"
                                        onClick={() => setIsRealtimeEnabled(!isRealtimeEnabled)}
                                        className={`relative h-6 w-11 rounded-full transition-all duration-300 ${isRealtimeEnabled ? 'bg-primary' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 h-4 w-4 rounded-full bg-zinc-950 shadow-sm transition-all duration-300 ${isRealtimeEnabled ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Column Schema Definition */}
                        <div className="space-y-6 pt-6">
                            <div className="flex items-center justify-between border-b border-border pb-4">
                                <div className="flex items-center gap-3">
                                    <Database size={16} className="text-primary" />
                                    <h3 className="text-[12px] font-bold uppercase tracking-[0.2em] text-white">Columns</h3>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 rounded-md border border-border bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white hover:border-zinc-700 transition-all cursor-pointer">
                                        <ArrowUpFromLine size={12} /> Import CSV
                                        <input
                                            type="file"
                                            accept=".csv"
                                            onChange={handleCSVImport}
                                            className="hidden"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={addColumn}
                                        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-primary/90 shadow-lg shadow-primary/10 transition-all active:scale-95"
                                    >
                                        <Plus size={14} /> Add Column
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4">
                                {csvRecords.length > 0 && (
                                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-emerald-500 animate-in fade-in zoom-in duration-500">
                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span>{csvRecords.length} Records ready for import</span>
                                        <button
                                            onClick={() => { setCsvRecords([]); setColumns(getDefaultColumns()); }}
                                            className="ml-2 text-emerald-500/50 hover:text-emerald-500 transition-colors"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {columns.filter((c: any) => c.isPrimary).length === 0 && (
                                <div className="flex items-center justify-between gap-6 rounded-md border border-amber-500/20 bg-amber-500/5 p-5 animate-in fade-in slide-in-from-top-4 duration-500">
                                    <div className="flex items-start gap-4">
                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Missing Primary Key</p>
                                            <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed">
                                                A primary key column is required to uniquely identify and mutate rows in this table.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                {/* Technical Header Matrix */}
                                <div className="grid grid-cols-12 gap-3 px-6 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                                    <div className="col-span-4">Column Name</div>
                                    <div className="col-span-3">Type</div>
                                    <div className="col-span-3">Default Value</div>
                                    <div className="col-span-2 flex justify-center">Constraints</div>
                                </div>
                            {/* Column Rows Matrix */}
                            <div className="space-y-3">
                                {columns.map((col: any, idx: any) => (
                                    <div 
                                        key={col.id} 
                                        draggable
                                        onDragStart={(e) => setDraggedColumnId(col.id)}
                                        onDragEnter={(e) => {
                                            e.preventDefault();
                                            if (draggedColumnId && draggedColumnId !== col.id) {
                                                moveColumn(draggedColumnId, col.id);
                                            }
                                        }}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => setDraggedColumnId(null)}
                                        onDragEnd={() => setDraggedColumnId(null)}
                                        className={`group grid grid-cols-12 gap-3 items-center rounded-md border px-4 py-3 transition-all duration-300 ${draggedColumnId === col.id ? 'border-primary/40 bg-zinc-950 scale-[1.01] shadow-2xl z-10' : 'bg-zinc-900/30 border-border hover:border-zinc-700 hover:bg-zinc-900/50'}`}
                                    >
                                        {/* Drag Handle */}
                                        <div className="col-span-1 flex justify-center cursor-grab active:cursor-grabbing text-zinc-800 group-hover:text-zinc-600 transition-colors">
                                            <GripVertical size={14} />
                                        </div>

                                        {/* Name & Identity */}
                                        <div className="col-span-3 relative group/input">
                                            <input
                                                type="text"
                                                value={col.name}
                                                onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                                                disabled={col.isSystem}
                                                className={`w-full bg-zinc-950 border border-border rounded-md px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white focus:border-primary/30 outline-none transition-all placeholder:text-zinc-800 ${col.isSystem ? 'opacity-40 cursor-not-allowed border-dashed' : ''}`}
                                                placeholder="column_name"
                                            />
                                            {col.isSystem && (
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-zinc-600">
                                                    <Lock size={10} /> SYS
                                                </div>
                                            )}
                                            {requiresPolicyOwnerColumn && normalizeIdentifier(col.name) === normalizeIdentifier(requiredPolicyColumn) && (
                                                <div className="absolute -top-2 -right-1 rounded bg-primary px-1 py-0.5 text-[7px] font-bold uppercase tracking-widest text-black shadow-lg">
                                                    RLS OWNER
                                                </div>
                                            )}
                                        </div>

                                        {/* Type Selector */}
                                        <div className="col-span-3">
                                            <OzySelect
                                                value={col.type}
                                                onChange={(e: any) => updateColumn(col.id, { type: e.target.value })}
                                                disabled={col.isSystem}
                                                wrapperClassName="rounded-md"
                                                selectClassName="h-9 text-[10px] font-bold uppercase tracking-widest"
                                            >
                                                {DATA_TYPES.map((type: any) => (
                                                    <option key={type} value={type}>{type.toUpperCase()}</option>
                                                ))}
                                            </OzySelect>
                                        </div>

                                        {/* Default Value */}
                                        <div className="col-span-3">
                                            <input
                                                type="text"
                                                value={col.defaultValue || ''}
                                                onChange={(e) => updateColumn(col.id, { defaultValue: e.target.value })}
                                                className="w-full bg-zinc-950/50 border border-border rounded-md px-3 py-2 text-[10px] font-mono text-zinc-400 focus:border-primary/20 outline-none transition-all placeholder:text-zinc-900"
                                                placeholder="NULL"
                                            />
                                        </div>

                                        {/* Controls */}
                                        <div className="col-span-2 flex items-center justify-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => updateColumn(col.id, { isPrimary: !col.isPrimary })}
                                                className={`flex h-6 w-6 items-center justify-center rounded border transition-all ${col.isPrimary ? 'border-primary bg-primary/10 text-primary shadow-[0_0_10px_rgba(251,191,36,0.2)]' : 'border-border bg-zinc-950 text-zinc-700 hover:border-zinc-700 hover:text-zinc-500'}`}
                                                title="Primary Key"
                                            >
                                                <Key size={12} strokeWidth={col.isPrimary ? 3 : 2} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateColumn(col.id, { required: !col.required })}
                                                className={`flex h-6 w-6 items-center justify-center rounded border transition-all ${col.required ? 'border-primary/50 bg-primary/5 text-primary' : 'border-border bg-zinc-950 text-zinc-700 hover:border-zinc-700 hover:text-zinc-500'}`}
                                                title="Required (NOT NULL)"
                                            >
                                                <div className="text-[10px] font-bold">!N</div>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedColumnForRelation(col);
                                                    setIsRelationModalOpen(true);
                                                }}
                                                className={`flex h-6 w-6 items-center justify-center rounded border transition-all ${col.references ? 'border-primary/50 bg-primary/5 text-primary' : 'border-border bg-zinc-950 text-zinc-700 hover:border-zinc-700 hover:text-zinc-500'}`}
                                                title="Relation"
                                            >
                                                <LinkIcon size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeColumn(col.id)}
                                                disabled={col.isSystem}
                                                className="flex h-6 w-6 items-center justify-center rounded border border-border bg-zinc-950 text-zinc-800 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                                                title="Delete Column"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addColumn}
                                    className="group flex w-full items-center justify-center gap-3 rounded-md border border-dashed border-border bg-zinc-950/20 py-4 transition-all hover:border-zinc-700 hover:bg-zinc-950/40"
                                >
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-zinc-700 group-hover:border-primary transition-colors">
                                        <Plus size={12} className="text-zinc-600 group-hover:text-primary transition-colors" />
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400 transition-colors">Add Column</span>
                                </button>
                            </div>
                        </div>
                    </div>
                        {/* Validation Errors Matrix */}
                        {error && (
                            <div className="flex items-center justify-between gap-6 rounded-md border border-red-500/20 bg-red-500/5 p-5 animate-in fade-in slide-in-from-top-2 duration-500">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Schema Validation Error</p>
                                        <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-500 leading-relaxed">
                                            {error}
                                        </p>
                                    </div>
                                </div>
                                {error.includes('requires a') && normalizeIdentifier(requiredPolicyColumn || rlsOwnerField) && (
                                    <button
                                        type="button"
                                        onClick={handleAddOwnerColumn}
                                        className="rounded-md bg-red-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-red-400 transition-all active:scale-95 shrink-0"
                                    >
                                        Fix Schema
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Operational Control */}
                <div className="border-t border-border bg-zinc-950/80 p-6 backdrop-blur-md">
                    <div className="mx-auto flex max-w-4xl items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`h-1.5 w-1.5 rounded-full ${loading || isHydrating ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'}`} />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                                {isHydrating ? 'Syncing...' : loading ? 'Saving...' : 'Status: Ready'}
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={requestClose}
                                className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white transition-all"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={loading || isHydrating || !name || !hasPrimaryKeySelected || hasUnnamedColumns}
                                className="rounded-md bg-primary px-8 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-black shadow-lg shadow-primary/10 hover:bg-primary/90 hover:shadow-primary/20 transition-all active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                                {isHydrating ? 'LOADING...' : loading ? (isEditMode ? 'SAVING...' : 'CREATING...') : isEditMode ? 'SAVE CHANGES' : 'CREATE TABLE'}
                            </button>
                        </div>
                    </div>
                </div>

                {(relationEditorIndex !== null || isRelationModalOpen) && (
                    <div className="absolute inset-0 z-100 flex items-center justify-center p-8 bg-zinc-950/60 backdrop-blur-sm animate-in fade-in duration-300">
                        <div className="relative w-full max-w-lg rounded-md border border-border bg-zinc-950 shadow-2xl animate-in zoom-in-95 duration-300">
                            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <LinkIcon size={14} className="text-primary" />
                                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Kernel_Link :: Foreign_Key</h3>
                                </div>
                                <button onClick={() => { closeRelationEditor(); setIsRelationModalOpen(false); }} className="text-zinc-600 hover:text-white transition-colors">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-8 space-y-8">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Reference_Vector</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={relationDraft}
                                        onChange={(event) => setRelationDraft(event.target.value)}
                                        placeholder="TABLE.COLUMN"
                                        className="w-full bg-zinc-900 border border-border rounded-md px-4 py-3 text-[12px] font-mono text-white focus:border-primary/30 outline-none transition-all placeholder:text-zinc-800"
                                    />
                                    <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic">// Protocol: Format must be target_table.target_column</p>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 italic">Discovered_Nodes</label>
                                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                        {allTables.map((table: any) => (
                                            <button
                                                key={table.name}
                                                type="button"
                                                onClick={() => setRelationDraft(`${table.name}.id`)}
                                                className="group flex items-center justify-between rounded-md border border-border bg-zinc-900/50 px-3 py-2 text-left hover:border-zinc-700 hover:bg-zinc-900 transition-all"
                                            >
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 group-hover:text-white transition-colors">{table.name}</span>
                                                <span className="text-[8px] font-bold text-zinc-700 group-hover:text-primary transition-colors">.id</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-border bg-zinc-900/30 p-6">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (relationEditorIndex !== null) {
                                            handleColumnChange(relationEditorIndex, 'references', '');
                                        } else if (selectedColumnForRelation) {
                                            updateColumn(selectedColumnForRelation.id, { references: '' });
                                        }
                                        closeRelationEditor();
                                        setIsRelationModalOpen(false);
                                    }}
                                    className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-red-400 transition-all"
                                >
                                    Clear_Link
                                </button>
                                <div className="flex items-center gap-4">
                                    <button
                                        type="button"
                                        onClick={() => { closeRelationEditor(); setIsRelationModalOpen(false); }}
                                        className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white transition-all"
                                    >
                                        Abort
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (relationEditorIndex !== null) {
                                                handleColumnChange(relationEditorIndex, 'references', relationDraft.trim());
                                            } else if (selectedColumnForRelation) {
                                                updateColumn(selectedColumnForRelation.id, { references: relationDraft.trim() });
                                            }
                                            closeRelationEditor();
                                            setIsRelationModalOpen(false);
                                        }}
                                        className="rounded-md bg-primary px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-primary/90 transition-all active:scale-95"
                                    >
                                        Commit_Link
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {toast ? (
                    <BrandedToast
                        tone={toast.tone}
                        title={toast.title}
                        message={toast.message}
                        onClose={() => setToast(null)}
                    />
                ) : null}
            </div>
        </div>
    );
};

export default CreateTableModal;


