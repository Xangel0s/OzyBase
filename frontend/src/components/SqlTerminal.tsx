import React, { useState } from 'react';
import {
    Terminal,
    Play,
    Save,
    History,
    Database,
    Search,
    ChevronRight,
    Loader2,
    CheckCircle2,
    XCircle,
    Copy,
    Trash2,
    Download,
    Plus,
    RefreshCcw,
    Sparkles,
    Table,
    Activity,
    BookMarked,
    Code,
    Zap,
    AlertTriangle,
    ShieldCheck,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import SqlResultsHeader from './sql-terminal/SqlResultsHeader';
import { BrandedToast } from './OverlayPrimitives';
import { useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// Force local Monaco bundle instead of CDN loader to satisfy strict CSP.
loader.config({ monaco });

const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
    'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'HAVING', 'DISTINCT', 'AS', 'ON', 'IN', 'NOT IN', 'EXISTS',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE', 'VALUES', 'SET', 'AND', 'OR', 'NOT', 'NULL',
    'TRUE', 'FALSE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW()', 'CURRENT_DATE'
];

const DEFAULT_SQL_FALLBACK_QUERY = 'SELECT current_database() AS database, now() AS server_time;';
const LEGACY_SQL_STARTER_QUERY = 'SELECT * FROM users LIMIT 10;';
const CATALOG_REFRESH_STATEMENTS = new Set(['ALTER', 'CREATE', 'DROP', 'TRUNCATE', 'RENAME']);

type SQLResultsState = {
    columns: string[];
    rows: any[][];
    rowCount: number;
    resultLimit: number;
    truncated: boolean;
    executionTime: string;
    command: string;
    statementKind: string;
    rowsAffected: number;
    hasResultSet: boolean;
    message: string;
};

type SQLExecutionMode = 'auto' | 'safe' | 'dangerous';
type SQLIntent = 'read' | 'mutation' | 'destructive';

const DANGEROUS_SQL_KIND = new Set(['DROP', 'TRUNCATE']);
const MUTATING_SQL_KIND = new Set([
    'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'GRANT', 'REVOKE', 'COMMENT', 'VACUUM',
    'CALL', 'DO', 'COPY', 'REFRESH', 'REINDEX', 'CLUSTER', 'SET', 'RESET', 'LISTEN', 'UNLISTEN', 'NOTIFY'
]);
const UNSAFE_WITH_KEYWORDS = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|VACUUM|CALL|DO|COPY|REFRESH|REINDEX|CLUSTER|SET|RESET|LISTEN|UNLISTEN|NOTIFY)\b/i;
const SELECT_INTO_PATTERN = /^\s*SELECT\b[\s\S]*\bINTO\b/i;

const splitSQLStatements = (raw: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        const next = raw[i + 1];

        if (!inSingle && !inDouble && ch === '-' && next === '-') {
            while (i < raw.length && raw[i] !== '\n') i++;
            continue;
        }
        if (!inSingle && !inDouble && ch === '/' && next === '*') {
            i += 2;
            while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
            i++;
            continue;
        }

        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }

        if (ch === ';' && !inSingle && !inDouble) {
            const trimmed = current.trim();
            if (trimmed) out.push(trimmed);
            current = '';
            continue;
        }

        current += ch;
    }

    const tail = current.trim();
    if (tail) out.push(tail);
    return out;
};

const statementKind = (statement: string): string => {
    const trimmed = statement.trim();
    if (!trimmed) return 'UNKNOWN';
    const match = trimmed.match(/^([a-zA-Z]+)/);
    return (match?.[1] || 'UNKNOWN').toUpperCase();
};

const explainTarget = (statement: string): string => {
    const trimmed = statement.trim();
    if (!/^EXPLAIN\b/i.test(trimmed)) return '';
    const afterExplain = trimmed.replace(/^EXPLAIN\s*/i, '').trim();
    if (!afterExplain) return '';
    return afterExplain.replace(/^\([^)]*\)\s*/i, '').trim();
};

const statementIsReadOnly = (statement: string): boolean => {
    const kind = statementKind(statement);
    if (kind === 'SELECT') {
        return !SELECT_INTO_PATTERN.test(statement);
    }
    if (kind === 'SHOW' || kind === 'VALUES' || kind === 'TABLE') return true;
    if (kind === 'WITH') {
        return !UNSAFE_WITH_KEYWORDS.test(statement) && !SELECT_INTO_PATTERN.test(statement);
    }
    if (kind === 'EXPLAIN') {
        const target = explainTarget(statement);
        return target !== '' && statementIsReadOnly(target);
    }
    return false;
};

const classifySQLIntent = (query: string): SQLIntent => {
    const statements = splitSQLStatements(query);
    if (statements.length === 0) return 'read';

    let intent: SQLIntent = 'read';
    for (const stmt of statements) {
        const kind = statementKind(stmt);
        if (DANGEROUS_SQL_KIND.has(kind)) return 'destructive';
        if (MUTATING_SQL_KIND.has(kind) || !statementIsReadOnly(stmt)) {
            intent = 'mutation';
        }
    }
    return intent;
};

const intentBadgeMeta = (intent: SQLIntent) => {
    if (intent === 'destructive') {
        return {
            label: 'DESTRUCTIVE',
            className: 'border border-red-500/30 bg-red-500/10 text-red-300',
        };
    }
    if (intent === 'mutation') {
        return {
            label: 'MUTATION',
            className: 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
        };
    }
    return {
        label: 'READ',
        className: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    };
};

const quoteIdentifier = (identifier: string) => `"${String(identifier || '').replace(/"/g, '""')}"`;

const buildDefaultSQLQuery = (tables: string[], preferredTableName?: string | null) => {
    const preferredTable = preferredTableName && tables.includes(preferredTableName)
        ? preferredTableName
        : tables[0];
    if (!preferredTable) {
        return DEFAULT_SQL_FALLBACK_QUERY;
    }
    return `SELECT * FROM ${quoteIdentifier(preferredTable)} LIMIT 50;`;
};

const shouldRefreshCatalogAfterStatement = (statementKind: string) => {
    return CATALOG_REFRESH_STATEMENTS.has(String(statementKind || '').toUpperCase());
};

const BarChart = ({ data, columns }: any) => {
    if (!data || data.length === 0) return null;

    const numericIndices: number[] = [];
    if (data[0]) {
        data[0].forEach((val: any, i: any) => {
            const numericVal = Number(val);
            if (!isNaN(numericVal) && typeof val !== 'boolean' && val !== null && val !== '') {
                numericIndices.push(i);
            }
        });
    }

    if (numericIndices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="w-16 h-16 rounded-md bg-zinc-900 flex items-center justify-center text-zinc-600 mb-2 border border-border">
                    <Activity size={32} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">No Numeric Data</h3>
                <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed uppercase tracking-widest font-medium">
                    This view requires at least one column with numbers to generate a chart.
                    Try a query with counts or sums (e.g., <span className="text-primary">SELECT count(*), role FROM users GROUP BY 2</span>).
                </p>
            </div>
        );
    }

    const chartIndex = numericIndices[0];
    let labelIndex = -1;
    const nonNumericIndices: number[] = [];
    columns.forEach((col: any, i: any) => {
        if (!numericIndices.includes(i)) nonNumericIndices.push(i);
    });

    const labelKeywords = ['name', 'label', 'id', 'date', 'fecha', 'email', 'category', 'title', 'key', 'code'];
    const findByKeyword = (indices: any) => {
        return indices.find((idx: any) =>
            labelKeywords.some((kw: any) => columns[idx].toLowerCase().includes(kw))
        );
    };

    labelIndex = findByKeyword(nonNumericIndices);
    if (labelIndex === undefined || labelIndex === -1) labelIndex = nonNumericIndices[0];
    if (labelIndex === undefined || labelIndex === -1) labelIndex = findByKeyword(numericIndices.filter((i: any) => i !== chartIndex));
    if (labelIndex === undefined || labelIndex === -1) labelIndex = 0;

    const maxVal = Math.max(...data.map((r: any) => Number(r[chartIndex]) || 0), 1);
    const chartHeight = 200;


    return (
        <div className="relative bg-background border border-border p-6 rounded-md overflow-x-auto custom-scrollbar">
            <div className="flex items-end gap-2 h-[220px] min-w-max pb-6">
                {data.slice(0, 20).map((row: any, i: any) => {
                    const val = Number(row[chartIndex]) || 0;
                    const height = (val / maxVal) * chartHeight;
                    const rawLabel = row[labelIndex];
                    const label = (rawLabel !== null && rawLabel !== undefined && rawLabel !== '') ? String(rawLabel).slice(0, 12) : `Row ${i + 1}`;
                    return (
                        <div key={i} className="flex flex-col items-center gap-3 group">
                            <div className="relative w-10 flex flex-col justify-end h-full">
                                <div className="bg-primary/20 border-t-2 border-primary group-hover:bg-primary/40 transition-all duration-500 rounded-t-sm relative" style={{ height: `${height}px` }}>
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[9px] font-bold pointer-events-none text-primary">{val}</div>
                                </div>
                            </div>
                            <span className="text-[8px] font-bold text-zinc-600 group-hover:text-zinc-300 transition-colors uppercase tracking-widest rotate-45 origin-left whitespace-nowrap">{label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface SqlTerminalProps {
    onSchemaChange?: () => void;
    initialTableName?: string | null;
    initialQuery?: string | null;
}

interface SidebarResource {
    id: string;
    title: string;
    description: string;
    query: string;
    label: string;
}

const SqlTerminal: React.FC<SqlTerminalProps> = ({ onSchemaChange, initialTableName, initialQuery }) => {
    const [query, setQuery] = useState(initialQuery || DEFAULT_SQL_FALLBACK_QUERY);
    const [results, setResults] = useState<SQLResultsState | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<any>(null);
    // Initial load from localStorage via functional initializers
    const [history, setHistory] = useState<any[]>(() => {
        const saved = localStorage.getItem('ozy_sql_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [savedQueries, setSavedQueries] = useState<any[]>(() => {
        const saved = localStorage.getItem('ozy_sql_saved');
        return saved ? JSON.parse(saved) : [];
    });

    const [syncing, setSyncing] = useState(false);
    const [syncSuccess, setSyncSuccess] = useState(false);
    const [panelHeight, setPanelHeight] = useState(300);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [resultSearchTerm, setResultSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('results'); // 'results' | 'explain' | 'visualize'
    const [explainData, setExplainData] = useState<any>(null);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
    const [isDangerConfirmOpen, setIsDangerConfirmOpen] = useState(false);
    const [pendingDangerousQuery, setPendingDangerousQuery] = useState<string | null>(null);
    const [pendingDangerMeta, setPendingDangerMeta] = useState<{ intent?: string; estimatedRows?: number; affectedTables?: string[] } | null>(null);
    const [exportFormat, setExportFormat] = useState<string | null>(null);
    const [queryName, setQueryName] = useState('');
    const [timeRange, setTimeRange] = useState(60); // minutes
    const [showTimeMenu, setShowTimeMenu] = useState(false);
    const [communitySection, setCommunitySection] = useState<'templates' | 'quickstarts'>('templates');
    const [catalog, setCatalog] = useState<{ tables: string[]; userTables: string[]; columnsByTable: Record<string, string[]>; allColumns: string[] }>({ tables: [], userTables: [], columnsByTable: {}, allColumns: [] });
    const [queryTouched, setQueryTouched] = useState(false);
    const [isHistorySyncing, setIsHistorySyncing] = useState(false);
    const isResizing = useRef<boolean>(false);
    const monacoRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    const completionProviderRef = useRef<any>(null);

    // Derived states for filtering
    const filteredSaved = savedQueries.filter((item: any) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.query.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredHistory = history.filter((item: any) =>
        item.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const runIntent = React.useMemo<SQLIntent>(() => classifySQLIntent(query), [query]);

    const primaryTable = initialTableName || catalog.userTables[0] || catalog.tables[0] || 'your_table';
    const templateResources = React.useMemo<SidebarResource[]>(() => ([
        {
            id: 'inspect-table',
            title: 'Table Preview',
            description: 'Fast preview for the active table.',
            query: `SELECT * FROM ${quoteIdentifier(primaryTable)} ORDER BY 1 DESC LIMIT 100;`,
            label: 'preview',
        },
        {
            id: 'schema-columns',
            title: 'Schema Columns',
            description: 'List public columns and types.',
            query: `SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;`,
            label: 'info',
        },
        {
            id: 'recent-audit',
            title: 'Audit Events',
            description: 'Latest system activity logs.',
            query: `SELECT id, created_at, method, path, status
FROM _v_audit_logs
ORDER BY created_at DESC
LIMIT 50;`,
            label: 'logs',
        },
    ]), [primaryTable]);

    const quickstartResources = React.useMemo<SidebarResource[]>(() => ([
        {
            id: 'table-volume',
            title: 'Table Volume',
            description: 'Analyze biggest tables by row count.',
            query: `SELECT schemaname, relname AS table_name, n_live_tup AS estimated_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 20;`,
            label: 'stat',
        },
        {
            id: 'database-health',
            title: 'Engine Health',
            description: 'Version, time and active clients.',
            query: `SELECT
  current_database() AS database_name,
  version() AS postgres_version,
  now() AS server_time,
  (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') AS active_sessions;`,
            label: 'status',
        },
        {
            id: 'largest-tables',
            title: 'Storage Size',
            description: 'Largest relations in the database.',
            query: `SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;`,
            label: 'storage',
        },
    ]), []);

    const activeCommunityResources = React.useMemo(
        () => (communitySection === 'templates' ? templateResources : quickstartResources),
        [communitySection, quickstartResources, templateResources],
    );

    const filteredCommunityResources = React.useMemo(
        () => activeCommunityResources.filter((item) =>
            `${item.title} ${item.description} ${item.query}`.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
        [activeCommunityResources, searchQuery],
    );

    // Close menus on outside click
    useEffect(() => {
        const handleOutsideClick = () => {
            setShowExportMenu(false);
            setShowTimeMenu(false);
        };
        if (showExportMenu || showTimeMenu) {
            window.addEventListener('click', handleOutsideClick);
        }
        return () => window.removeEventListener('click', handleOutsideClick);
    }, [showExportMenu, showTimeMenu]);

    // Save to localStorage
    useEffect(() => {
        localStorage.setItem('ozy_sql_history', JSON.stringify(history));
    }, [history]);

    useEffect(() => {
        localStorage.setItem('ozy_sql_saved', JSON.stringify(savedQueries));
    }, [savedQueries]);

    const normalizeToken = useCallback((value: any) => {
        return String(value || '').toLowerCase().replace(/_/g, '');
    }, []);

    const isSubsequence = useCallback((needle: any, haystack: any) => {
        if (!needle) return true;
        let i = 0;
        let j = 0;
        while (i < needle.length && j < haystack.length) {
            if (needle[i] === haystack[j]) i++;
            j++;
        }
        return i === needle.length;
    }, []);

    const buildFilterText = useCallback((value: any) => {
        const raw = String(value || '');
        const lower = raw.toLowerCase();
        const normalized = normalizeToken(raw);
        const spaced = lower.replace(/_/g, ' ');
        return `${raw} ${lower} ${normalized} ${spaced}`;
    }, [normalizeToken]);

    const rankSuggestion = useCallback((needle: any, candidate: any) => {
        if (!needle) return 50;
        const a = needle.toLowerCase();
        const b = candidate.toLowerCase();
        const an = normalizeToken(a);
        const bn = normalizeToken(b);
        if (b.startsWith(a)) return 0;
        if (b.includes(a)) return 1;
        if (bn.startsWith(an)) return 2;
        if (bn.includes(an)) return 3;
        if (isSubsequence(an, bn)) return 4;
        if (isSubsequence(a, b)) return 5;
        return 9;
    }, [normalizeToken, isSubsequence]);

    const fetchCatalog = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/collections');
            if (!res.ok) return;
            const data = await res.json();
            const tables: string[] = [];
            const userTables: string[] = [];
            const columnsByTable: Record<string, string[]> = {};
            const allColumnsSet = new Set<string>();

            (Array.isArray(data) ? data : []).forEach((collection: any) => {
                const tableName = collection?.name;
                if (!tableName) return;
                tables.push(tableName);
                if (!collection?.is_system) {
                    userTables.push(tableName);
                }
                const schemaCols = Array.isArray(collection?.schema)
                    ? collection.schema.map((field: any) => field?.name).filter(Boolean)
                    : [];
                columnsByTable[tableName] = schemaCols;
                schemaCols.forEach((col: string) => allColumnsSet.add(col));
            });

            setCatalog({
                tables,
                userTables,
                columnsByTable,
                allColumns: Array.from(allColumnsSet)
            });
        } catch (e) {
            console.error('Failed to load SQL autocomplete catalog', e);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/sql/history');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setHistory(data.map(item => item.query));
                }
            }
        } catch (e) {
            console.error('Failed to load SQL history', e);
        }
    }, []);

    useEffect(() => {
        fetchCatalog();
        fetchHistory();
    }, [fetchCatalog, fetchHistory]);

    useEffect(() => {
        if (syncSuccess) {
            fetchCatalog();
        }
    }, [syncSuccess, fetchCatalog]);

    useEffect(() => {
        if (queryTouched) return;
        const nextDefaultQuery = initialQuery || buildDefaultSQLQuery(catalog.userTables, initialTableName);
        setQuery((prev) => {
            const trimmed = prev.trim();
            if (
                trimmed === '' ||
                prev === DEFAULT_SQL_FALLBACK_QUERY ||
                prev === LEGACY_SQL_STARTER_QUERY ||
                (initialQuery && prev !== initialQuery)
            ) {
                return nextDefaultQuery;
            }
            return prev;
        });
    }, [catalog.userTables, initialTableName, queryTouched, initialQuery]);

    const updateQuery = useCallback((nextQuery: string) => {
        setQueryTouched(true);
        setQuery(nextQuery);
    }, []);

    const registerCompletionProvider = useCallback(() => {
        if (!monacoRef.current) return;

        if (completionProviderRef.current) {
            completionProviderRef.current.dispose();
        }

        completionProviderRef.current = monacoRef.current.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.', '_'],
            provideCompletionItems: (model: any, position: any) => {
                const linePrefix = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });
                const word = model.getWordUntilPosition(position);
                const typed = (word.word || '').toLowerCase();
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                };

                const fullTextUntilCursor = model.getValueInRange({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });

                const aliasMap: Record<string, string> = {};
                const aliasRegex = /\b(?:from|join)\s+([a-zA-Z_][\w]*)\s+(?:as\s+)?([a-zA-Z_][\w]*)/gi;
                let aliasMatch;
                while ((aliasMatch = aliasRegex.exec(fullTextUntilCursor)) !== null) {
                    aliasMap[aliasMatch[2]] = aliasMatch[1];
                }

                const dotMatch = linePrefix.match(/([a-zA-Z_][\w]*)\.([a-zA-Z_0-9]*)$/i);
                let tableScopedColumns: string[] | null = null;
                if (dotMatch) {
                    const token = dotMatch[1];
                    const resolvedTable = aliasMap[token] || token;
                    tableScopedColumns = catalog.columnsByTable[resolvedTable] || [];
                }

                const keywordSuggestions = SQL_KEYWORDS.map((keyword: any) => ({
                    label: keyword,
                    kind: monacoRef.current.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range,
                    filterText: buildFilterText(keyword),
                    sortText: `k_${String(rankSuggestion(typed, keyword)).padStart(2, '0')}_${keyword.toLowerCase()}`
                }));

                const tableSuggestions = catalog.tables.map((table: any) => ({
                    label: table,
                    kind: monacoRef.current.languages.CompletionItemKind.Class,
                    insertText: table,
                    detail: 'Table',
                    documentation: `Normalized: ${normalizeToken(table)}`,
                    range,
                    filterText: buildFilterText(table),
                    sortText: `t_${String(rankSuggestion(typed, table)).padStart(2, '0')}_${table}`
                }));

                const columnSource = tableScopedColumns || catalog.allColumns;
                const columnSuggestions = columnSource.map((column: any) => ({
                    label: column,
                    kind: monacoRef.current.languages.CompletionItemKind.Field,
                    insertText: column,
                    detail: tableScopedColumns ? 'Column (table scope)' : 'Column',
                    documentation: `Normalized: ${normalizeToken(column)}`,
                    range,
                    filterText: buildFilterText(column),
                    sortText: `c_${String(rankSuggestion(typed, column)).padStart(2, '0')}_${column}`
                }));

                const tableColumnSuggestions = tableScopedColumns
                    ? []
                    : catalog.tables.flatMap((table: any) => (catalog.columnsByTable[table] || []).map((column: any) => ({
                        label: `${table}.${column}`,
                        kind: monacoRef.current.languages.CompletionItemKind.Property,
                        insertText: `${table}.${column}`,
                        detail: 'Table.Column',
                        documentation: `Normalized: ${normalizeToken(`${table}.${column}`)}`,
                        range,
                        filterText: buildFilterText(`${table}.${column}`),
                        sortText: `p_${String(rankSuggestion(typed, `${table}.${column}`)).padStart(2, '0')}_${table}_${column}`
                    })));

                const suggestions = dotMatch
                    ? columnSuggestions
                    : [...tableSuggestions, ...columnSuggestions, ...tableColumnSuggestions, ...keywordSuggestions];

                return { suggestions };
            }
        });
    }, [catalog, rankSuggestion, buildFilterText, normalizeToken]);

    useEffect(() => {
        registerCompletionProvider();
        return () => {
            if (completionProviderRef.current) {
                completionProviderRef.current.dispose();
                completionProviderRef.current = null;
            }
        };
    }, [registerCompletionProvider]);

    const runQuery = async (customQuery?: string | null, mode: SQLExecutionMode = 'auto', confirmDanger = false) => {
        // Handle cases where an event object might be passed if called directly in onClick
        const targetQuery = (typeof customQuery === 'string' ? customQuery : query) || '';
        if (!targetQuery.trim()) return;
        setLoading(true);
        setError(null);
        setActiveTab('results');
        try {
            const res = await fetchWithAuth('/api/sql', {
                method: 'POST',
                body: JSON.stringify({
                    query: targetQuery,
                    mode,
                    confirm_danger: confirmDanger,
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                if (res.status === 409 && errorData?.error_code === 'SQL_CONFIRMATION_REQUIRED') {
                    setPendingDangerousQuery(targetQuery);
                    setPendingDangerMeta({
                        intent: typeof errorData.intent === 'string' ? errorData.intent : runIntent,
                        estimatedRows: Number(errorData.estimated_rows || 0),
                        affectedTables: Array.isArray(errorData.affected_tables) ? errorData.affected_tables : [],
                    });
                    setIsDangerConfirmOpen(true);
                    return;
                }
                throw new Error(errorData?.error || 'Failed to execute query');
            }

            const data = await res.json();
            const isExplainQuery = String(data.statementKind || '').toUpperCase() === 'EXPLAIN' || targetQuery.toLowerCase().includes('explain');

            // Keep Smart Run history complete across read/mutation/destructive paths.
            // We record every successful execution once with whitespace-normalized dedupe.
            const normalizedTarget = targetQuery.trim();
            setHistory((prev: any) => {
                const list = Array.isArray(prev) ? prev : [];
                const last = String(list[0] || '').trim();
                if (last === normalizedTarget) return list;
                return [normalizedTarget, ...list].slice(0, 50);
            });

            if (isExplainQuery) {
                setExplainData(data.rows);
                setActiveTab('explain');
            } else {
                setExplainData(null);
                const nextResults: SQLResultsState = {
                    columns: data.columns || [],
                    rows: data.rows || [],
                    rowCount: data.rowCount || 0,
                    resultLimit: data.resultLimit || 0,
                    truncated: Boolean(data.truncated),
                    executionTime: data.executionTime || '0ms',
                    command: data.command || data.statementKind || 'SQL',
                    statementKind: data.statementKind || 'UNKNOWN',
                    rowsAffected: data.rowsAffected || 0,
                    hasResultSet: Boolean(data.hasResultSet),
                    message: data.message || 'Statement executed successfully.'
                };
                setResults(nextResults);
                setResultSearchTerm('');

                if (shouldRefreshCatalogAfterStatement(nextResults.statementKind)) {
                    await fetchCatalog();
                    onSchemaChange?.();
                }
            }
            setSelectedRows(new Set());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExplain = () => {
        const explainQuery = `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${query}`;
        void runQuery(explainQuery, 'safe');
    };

    const handleSmartRun = () => {
        void runQuery(undefined, 'auto');
    };

    const confirmDangerousRun = () => {
        if (!pendingDangerousQuery) {
            setIsDangerConfirmOpen(false);
            return;
        }

        const targetQuery = pendingDangerousQuery;
        setPendingDangerousQuery(null);
        setPendingDangerMeta(null);
        setIsDangerConfirmOpen(false);
        void runQuery(targetQuery, 'auto', true);
    };

    const handleSaveQuery = () => {
        setIsSaveModalOpen(true);
    };

    const confirmSaveQuery = () => {
        if (!queryName.trim()) return;

        const newSaved = {
            id: crypto.randomUUID(),
            name: queryName,
            query,
            timestamp: new Date().toISOString()
        };

        setSavedQueries((prev: any) => [newSaved, ...prev]);
        showToast('Query saved successfully', 'success');
        setIsSaveModalOpen(false);
        setQueryName('');
    };

    const deleteSavedQuery = (e: any, id: any) => {
        e.stopPropagation();
        setSavedQueries((prev: any) => prev.filter((q: any) => q.id !== id));
        showToast('Query deleted', 'warning');
    };

    const clearHistory = () => {
        setHistory([]);
        showToast('History cleared', 'info');
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncSuccess(false);
        setError(null);
        try {
            const res = await fetchWithAuth('/api/sql/sync', {
                method: 'POST'
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to sync system schema');
            }

            setSyncSuccess(true);
            onSchemaChange?.();
            setTimeout(() => setSyncSuccess(false), 3000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    const startResizing = () => {
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = useCallback((e: any) => {
        if (!isResizing.current) return;

        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 100 && newHeight < window.innerHeight - 200) {
            setPanelHeight(newHeight);
        }
    }, []);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    }, [handleMouseMove]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    const initiateExport = (format: any) => {
        setExportFormat(format);
        setIsExportConfirmOpen(true);
    };

    const confirmExport = () => {
        if (exportFormat === 'csv') exportToCSV();
        else if (exportFormat === 'json') exportToJSON();
        else if (exportFormat === 'txt') exportToTXT();
        setIsExportConfirmOpen(false);
    };

    const exportToCSV = () => {
        if (!results?.hasResultSet || (results?.columns?.length || 0) === 0) return;
        const headers = results.columns.join(',');
        const rows = results.rows.map((row: any) =>
            row.map((val: any) => {
                const s = String(val).replace(/"/g, '""');
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
            }).join(',')
        ).join('\n');
        downloadFile(`${headers}\n${rows}`, 'export.csv', 'text/csv');
        setShowExportMenu(false);
    };

    const exportToJSON = () => {
        if (!results?.hasResultSet || (results?.columns?.length || 0) === 0) return;
        const data = results.rows.map((row: any) => {
            const obj: Record<string, any> = {};
            results.columns.forEach((col: any, i: any) => {
                obj[col] = row[i];
            });
            return obj;
        });
        downloadFile(JSON.stringify(data, null, 2), 'export.json', 'application/json');
        setShowExportMenu(false);
    };

    const exportToTXT = () => {
        if (!results?.hasResultSet || (results?.columns?.length || 0) === 0) return;
        const headers = results.columns.join('\t');
        const rows = results.rows.map((row: any) => row.join('\t')).join('\n');
        downloadFile(`${headers}\n${rows}`, 'export.txt', 'text/plain');
        setShowExportMenu(false);
    };

    const downloadFile = (content: any, fileName: any, contentType: any) => {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const toggleRow = (index: any) => {
        const next = new Set(selectedRows);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setSelectedRows(next);
    };

    const toggleAllRows = () => {
        if (!results?.hasResultSet) return;
        const visibleIndices = filteredResultRows.map(({ index }: any) => index);
        if (visibleIndices.length === 0) {
            return;
        }
        const allVisibleSelected = visibleIndices.every((index: number) => selectedRows.has(index));
        if (allVisibleSelected) {
            const next = new Set(selectedRows);
            visibleIndices.forEach((index: number) => next.delete(index));
            setSelectedRows(next);
        } else {
            const next = new Set(selectedRows);
            visibleIndices.forEach((index: number) => next.add(index));
            setSelectedRows(next);
        }
    };

    const handleCopyAllPreviewRows = (format: any) => {
        if (!results?.hasResultSet || filteredResultRows.length === 0) return;

        const previewRows = filteredResultRows.map(({ row }: any) => row);
        let content = '';

        if (format === 'json') {
            const data = previewRows.map((row: any) => {
                const obj: Record<string, any> = {};
                results.columns.forEach((col: any, i: any) => {
                    obj[col] = row[i];
                });
                return obj;
            });
            content = JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
            const headers = results.columns.join(',');
            const rows = previewRows.map((row: any) =>
                row.map((val: any) => {
                    const s = String(val).replace(/"/g, '""');
                    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
                }).join(',')
            ).join('\n');
            content = `${headers}\n${rows}`;
        } else {
            const headers = results.columns.join('\t');
            const rows = previewRows.map((row: any) => row.join('\t')).join('\n');
            content = `${headers}\n${rows}`;
        }

        navigator.clipboard.writeText(content);
        showToast(`Copied ${filteredResultRows.length} preview rows`, 'success');
    };

    const copySelected = (format: any) => {
        if (!results?.hasResultSet || selectedRows.size === 0) return;

        const selectedData = results.rows.filter((_: any, i: any) => selectedRows.has(i));
        let content = '';

        if (format === 'json') {
            const data = selectedData.map((row: any) => {
                const obj: Record<string, any> = {};
                results.columns.forEach((col: any, i: any) => {
                    obj[col] = row[i];
                });
                return obj;
            });
            content = JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
            const headers = results.columns.join(',');
            const rows = selectedData.map((row: any) =>
                row.map((val: any) => {
                    const s = String(val).replace(/"/g, '""');
                    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
                }).join(',')
            ).join('\n');
            content = `${headers}\n${rows}`;
        } else {
            const headers = results.columns.join('\t');
            const rows = selectedData.map((row: any) => row.join('\t')).join('\n');
            content = `${headers}\n${rows}`;
        }

        navigator.clipboard.writeText(content);
        showToast(`Copied ${selectedRows.size} rows to clipboard`, 'success');
    };

    const showToast = (message: string, tone: 'success' | 'error' | 'warning' | 'info' = 'success') => {
        setToast({ message, tone });
    };

    const applyVisualizeTimeRange = useCallback((minutes: number) => {
        setTimeRange(minutes);
        setShowTimeMenu(false);
        const timeFilter = `WHERE created_at > NOW() - INTERVAL '${minutes} minutes'`;
        if (query.toLowerCase().includes('where')) {
            showToast(`Append AND created_at clause to your query`, 'warning');
            return;
        }
        if (query.toLowerCase().includes('from')) {
            const parts = query.split(/LIMIT|GROUP BY|ORDER BY/i);
            const base = parts[0].trim();
            const suffix = query.substring(base.length);
            updateQuery(`${base} ${timeFilter} ${suffix.trim()};`.replace(/;;$/, ';'));
            showToast(`Applied ${minutes}m filter`, 'success');
        }
    }, [query, updateQuery]);

    const handleClearSelection = () => {
        setSelectedRows(new Set());
        showToast('Selection cleared', 'warning');
    };

    const handleLoadResource = useCallback((resource: SidebarResource) => {
        updateQuery(resource.query);
        showToast(`Loaded ${resource.title}`, 'success');
    }, [updateQuery]);

    const runningQueriesQuery = `SELECT pid, usename, state, wait_event_type, wait_event, query_start, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start DESC
LIMIT 25;`;

    const hasTabularResults = Boolean(results?.hasResultSet && (results?.columns?.length || 0) > 0);
    const hasResultRows = Boolean(hasTabularResults && (results?.rows?.length || 0) > 0);
    const canExportResults = Boolean(hasTabularResults);
    const normalizedResultSearch = resultSearchTerm.trim().toLowerCase();
    const filteredResultRows = React.useMemo(() => {
        if (!hasTabularResults || !results) {
            return [];
        }

        return results.rows
            .map((row: any, index: number) => ({ row, index }))
            .filter(({ row }: any) => {
                if (!normalizedResultSearch) {
                    return true;
                }
                return row.some((value: any) =>
                    String(value ?? '').toLowerCase().includes(normalizedResultSearch),
                );
            });
    }, [hasTabularResults, normalizedResultSearch, results]);
    const selectedVisibleCount = React.useMemo(
        () => filteredResultRows.filter(({ index }: any) => selectedRows.has(index)).length,
        [filteredResultRows, selectedRows],
    );


    return (
    <div className="flex h-full w-full bg-background animate-in fade-in duration-500 overflow-hidden font-sans">
        {/* Left Resource Sidebar */}
        <div className="hidden lg:flex w-80 border-r border-border bg-background flex-col shrink-0">
            <div className="p-6 border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary">
                        <Terminal size={20} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-tight italic">SQL Terminal</h2>
                        <p className="text-[10px] font-medium tracking-wider text-zinc-600 uppercase italic">Collections & Labs</p>
                    </div>
                </div>
                
                <div className="mt-6 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700" size={12} />
                    <input
                        type="text"
                        placeholder="Search resources..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-zinc-900/50 border border-border rounded-md pl-9 pr-4 py-2 text-[11px] text-white placeholder:text-zinc-800 focus:outline-none focus:border-zinc-600 transition-all font-bold uppercase tracking-wider"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
                {/* Saved Queries Section */}
                <div>
                    <div className="flex items-center justify-between px-2 mb-3">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest italic">Library</h3>
                        <span className="text-[9px] font-bold text-zinc-800">{savedQueries.length}</span>
                    </div>
                    <div className="space-y-1">
                        {filteredSaved.length === 0 ? (
                            <div className="px-2 py-4 text-[10px] font-medium text-zinc-700 uppercase tracking-widest text-center border border-dashed border-border rounded-md">
                                Library empty
                            </div>
                        ) : (
                            filteredSaved.map((q: any) => (
                                <div
                                    key={q.id}
                                    onClick={() => updateQuery(q.query)}
                                    className="group flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-zinc-900 cursor-pointer transition-all border border-transparent hover:border-border"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 group-hover:bg-primary transition-colors" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-bold text-zinc-400 group-hover:text-zinc-200 truncate uppercase tracking-tight">{q.name}</div>
                                            <div className="text-[9px] text-zinc-700 font-mono truncate uppercase">{q.query}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e: any) => deleteSavedQuery(e, q.id)}
                                        className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Quick Resources Section */}
                <div>
                    <div className="flex items-center gap-1 p-1 bg-zinc-900/50 border border-border rounded-md mb-4">
                        <button
                            onClick={() => setCommunitySection('templates')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${communitySection === 'templates' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                            <BookMarked size={12} />
                            Templates
                        </button>
                        <button
                            onClick={() => setCommunitySection('quickstarts')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${communitySection === 'quickstarts' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                            <Sparkles size={12} />
                            Quickstarts
                        </button>
                    </div>

                    <div className="space-y-1">
                        {filteredCommunityResources.map((resource) => (
                            <button
                                key={resource.id}
                                onClick={() => handleLoadResource(resource)}
                                className="w-full rounded-md border border-border bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-zinc-900"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-tight">{resource.title}</span>
                                </div>
                                <p className="mt-1 text-[9px] text-zinc-600 font-medium uppercase tracking-tight leading-relaxed">
                                    {resource.description}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Query History */}
                <div>
                    <div className="flex items-center justify-between px-2 mb-3">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest italic">History</h3>
                        {history.length > 0 && (
                            <button onClick={clearHistory} className="text-[9px] font-bold text-zinc-700 hover:text-red-500 uppercase tracking-widest transition-colors">
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="space-y-1">
                        {filteredHistory.length === 0 ? (
                            <div className="px-2 py-4 text-[10px] font-medium text-zinc-700 uppercase tracking-widest italic">
                                No history yet
                            </div>
                        ) : (
                            filteredHistory.map((h: any, i: any) => (
                                (() => {
                                    const queryText = String(h || '');
                                    const intent = classifySQLIntent(queryText);
                                    const badge = intentBadgeMeta(intent);

                                    return (
                                <div
                                    key={i}
                                    onClick={() => updateQuery(queryText)}
                                    className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-900 cursor-pointer transition-all border border-transparent hover:border-border"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 group-hover:bg-primary/50 transition-colors" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-zinc-400 group-hover:text-zinc-200 truncate font-mono">{queryText}</div>
                                    </div>
                                    <span className={`rounded-md px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${badge.className}`}>
                                        {badge.label}
                                    </span>
                                </div>
                                    );
                                })()
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-auto p-4 bg-background">
                <button
                    onClick={() => {
                        updateQuery(runningQueriesQuery);
                        void runQuery(runningQueriesQuery);
                    }}
                    className="w-full py-2 text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] transition-all hover:text-primary flex items-center justify-center gap-2"
                >
                    <Activity size={12} />
                    Active Queries
                </button>
            </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* Toolbar */}
            <div className="h-12 border-b border-border bg-background flex items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900 border border-border rounded-md">
                        <Database size={12} className="text-primary" />
                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Main DB</span>
                    </div>
                    {initialTableName && (
                        <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 border border-primary/20 rounded-md">
                            <Table size={12} className="text-primary" />
                            <span className="text-[9px] font-bold text-primary uppercase tracking-wider">
                                {initialTableName}
                            </span>
                        </div>
                    )}
                    <div className="h-4 w-px bg-border mx-1" />
                    <button
                        onClick={handleSmartRun}
                        disabled={loading}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-bold text-[10px] uppercase tracking-widest transition-all ${
                            runIntent === 'destructive'
                                ? 'bg-red-500/20 text-red-500 border border-red-500/40 hover:bg-red-500/30'
                                : runIntent === 'mutation'
                                    ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40 hover:bg-amber-500/30'
                                    : 'bg-primary text-black hover:bg-primary/90'
                        }`}
                    >
                        {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                        Run
                    </button>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            if (!query.trim()) return;
                            const formatted = query
                                .replace(/\s+/g, ' ')
                                .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|GROUP BY|ORDER BY|LIMIT|OFFSET|HAVING|INSERT INTO|UPDATE|DELETE FROM|VALUES|SET|CREATE TABLE|ALTER TABLE|DROP TABLE)\b/gi, '\n$1')
                                .trim();
                            updateQuery(formatted);
                            showToast('SQL Formatted', 'success');
                        }}
                        title="Format SQL (Sparkles)"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-border text-zinc-500 hover:text-primary hover:border-primary/40 text-[9px] font-bold uppercase tracking-wider transition-all"
                    >
                        <Sparkles size={12} className="text-primary" />
                        Format
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all
                            ${syncSuccess
                                ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                                : 'bg-zinc-900 border border-border text-zinc-500 hover:text-white hover:border-zinc-600'}
                        `}
                    >
                        {syncing ? <Loader2 size={12} className="animate-spin" /> : syncSuccess ? <Sparkles size={12} /> : <RefreshCcw size={12} />}
                        {syncSuccess ? 'Synced' : 'Sync'}
                    </button>
                    <div className="h-4 w-px bg-border" />
                    <button onClick={handleSaveQuery} title="Save Query" className="p-2 text-zinc-700 hover:text-primary transition-colors"><Save size={16} /></button>
                    <button onClick={() => updateQuery('')} title="Clear Editor" className="p-2 text-zinc-700 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                </div>
            </div>

            {/* Quick Snippets Bar */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-zinc-950/60 overflow-x-auto scrollbar-hide">
                <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest shrink-0 mr-1">Snippets:</span>
                <button onClick={() => updateQuery(`SELECT * FROM ${catalog.userTables[0] || 'users'} LIMIT 50;`)} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary hover:border-primary/40 transition-all shrink-0">+ Select 50</button>
                <button onClick={() => updateQuery(`SELECT count(*) FROM ${catalog.userTables[0] || 'users'};`)} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary hover:border-primary/40 transition-all shrink-0">+ Count Rows</button>
                <button onClick={() => updateQuery(`SELECT pg_size_pretty(pg_total_relation_size('${catalog.userTables[0] || 'users'}'));`)} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary hover:border-primary/40 transition-all shrink-0">+ Table Size</button>
                <button onClick={() => updateQuery(`CREATE INDEX idx_${catalog.userTables[0] || 'users'}_created ON ${catalog.userTables[0] || 'users'} (created_at);`)} className="px-2 py-0.5 rounded border border-border bg-zinc-900 text-[9px] font-bold text-zinc-400 hover:text-primary hover:border-primary/40 transition-all shrink-0">+ Create Index</button>
            </div>

                {/* SQL Input (Monaco Editor - Lazy Loaded) */}
                <div className="flex-1 relative flex flex-col overflow-hidden bg-background">
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center bg-background">
                            <span className="text-[10px] font-medium text-zinc-600 animate-pulse">Loading Editor...</span>
                        </div>
                    }>
                        <MonacoEditor
                            height="100%"
                            defaultLanguage="sql"
                            value={query}
                            onChange={(value: any) => updateQuery(value || '')}
                            theme="vs-dark"
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                lineHeight: 24,
                                padding: { top: 16 },
                                fontFamily: 'monospace',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                wordWrap: 'on',
                                renderLineHighlight: 'line',
                                overviewRulerLanes: 0,
                                hideCursorInOverviewRuler: true,
                                overviewRulerBorder: false,
                                scrollbar: {
                                    vertical: 'hidden',
                                    horizontal: 'auto',
                                    verticalScrollbarSize: 0,
                                },
                            }}
                            beforeMount={(monaco: any) => {
                                monaco.editor.defineTheme('ozy-dark', {
                                    base: 'vs-dark',
                                    inherit: true,
                                    rules: [],
                                    colors: {
                                        'editor.background': '#111111',
                                        'editor.lineHighlightBackground': '#1a1a1a',
                                    }
                                });
                            }}
                            onMount={(editor: any, monaco: any) => {
                                editorRef.current = editor;
                                monacoRef.current = monaco;
                                monaco.editor.setTheme('ozy-dark');
                                registerCompletionProvider();
                                editor.addAction({
                                    id: 'run-sql-query-shortcut',
                                    label: 'Run SQL Query',
                                    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
                                    run: () => {
                                        handleSmartRun();
                                    }
                                });
                            }}
                        />
                    </Suspense>
                </div>

                {/* Resizer Handle */}
                <div
                    onMouseDown={startResizing}
                    className="h-[2px] w-full bg-border hover:bg-primary cursor-row-resize transition-colors group relative z-20"
                >
                    <div className="absolute inset-x-0 -top-1 -bottom-1" /> {/* Larger hit area */}
                </div>

                {/* Results Panel */}
                <div
                    style={{ height: `${panelHeight}px` }}
                    className="border-t border-border bg-[#131313] flex flex-col"
                >
                    <SqlResultsHeader
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        results={results}
                        hasTabularResults={hasTabularResults}
                        canExportResults={canExportResults}
                        resultSearchTerm={resultSearchTerm}
                        setResultSearchTerm={setResultSearchTerm}
                        timeRange={timeRange}
                        showTimeMenu={showTimeMenu}
                        setShowTimeMenu={setShowTimeMenu}
                        onApplyTimeRange={applyVisualizeTimeRange}
                        showExportMenu={showExportMenu}
                        setShowExportMenu={setShowExportMenu}
                        onInitiateExport={initiateExport}
                    />

                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <div className="min-w-full inline-block align-middle">
                            <div className="overflow-x-auto">
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
                                        <Loader2 className="animate-spin text-primary" size={24} />
                                        <span className="text-[10px] font-medium] text-zinc-600 animate-pulse">Consulting the Oracle...</span>
                                    </div>
                                ) : error ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center py-20">
                                        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
                                            <XCircle size={24} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Syntax Error or Connection Failure</p>
                                            <p className="text-xs text-zinc-500 font-mono tracking-tight">{error}</p>
                                        </div>
                                    </div>
                                ) : activeTab === 'results' && results ? (
                                    hasTabularResults ? (
                                        <>
                                            {hasResultRows && (
                                                <div className="border-b border-border bg-zinc-900/20 px-4 py-1.5">
                                                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-zinc-600">
                                                        <span className="px-2 py-0.5 rounded border border-border bg-background text-zinc-400">
                                                            {filteredResultRows.length}/{results.rows.length} rows preview
                                                        </span>
                                                        {resultSearchTerm.trim() !== '' && (
                                                            <button
                                                                onClick={() => setResultSearchTerm('')}
                                                                className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary transition-colors hover:bg-primary/15"
                                                            >
                                                                clear preview filter
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            <table className="min-w-full text-left border-collapse table-auto">
                                                <thead className="sticky top-0 bg-background z-10 border-b border-border">
                                                    <tr>
                                                        <th className="w-10 px-6 py-3 border-r border-border">
                                                            <input
                                                                type="checkbox"
                                                                className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 checked:bg-primary checked:border-primary focus:ring-0 transition-all cursor-pointer accent-primary"
                                                                checked={filteredResultRows.length > 0 && selectedVisibleCount === filteredResultRows.length}
                                                                onChange={toggleAllRows}
                                                            />
                                                        </th>
                                                        {results.columns?.map((col: any) => (
                                                            <th key={col} className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-r border-border whitespace-nowrap italic">
                                                                {col}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border">
                                                    {filteredResultRows.map(({ row, index }: any) => (
                                                        <tr
                                                            key={index}
                                                            className={`transition-colors cursor-pointer ${selectedRows.has(index) ? 'bg-primary/5' : 'hover:bg-zinc-900/50'}`}
                                                            onClick={() => toggleRow(index)}
                                                        >
                                                            <td className="w-10 px-6 py-3 border-r border-border" onClick={(e: any) => e.stopPropagation()}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 checked:bg-primary checked:border-primary focus:ring-0 transition-all cursor-pointer accent-primary"
                                                                    checked={selectedRows.has(index)}
                                                                    onChange={() => toggleRow(index)}
                                                                />
                                                            </td>
                                                            {row.map((val: any, cellIdx: any) => (
                                                                <td key={cellIdx} className="px-6 py-3 text-xs font-mono text-zinc-400 border-r border-border whitespace-nowrap max-w-[400px] overflow-hidden text-ellipsis uppercase tracking-tight">
                                                                    {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                    {filteredResultRows.length === 0 && (
                                                        <tr>
                                                            <td
                                                                colSpan={(results.columns?.length || 0) + 1}
                                                                className="px-6 py-16 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700"
                                                            >
                                                                No preview rows match this filter.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-center bg-emerald-500/5">
                                            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                                <CheckCircle2 size={16} />
                                                <span className="text-[10px] font-bold uppercase tracking-widest italic">{results.message}</span>
                                            </div>
                                            <div className="flex items-center gap-6 mt-2">
                                                {[
                                                    { label: 'Command', value: results.command },
                                                    { label: 'Rows Affected', value: results.rowsAffected },
                                                    { label: 'Time', value: results.executionTime },
                                                ].map((item) => (
                                                    <div key={item.label} className="text-left">
                                                        <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter mb-0.5">{item.label}</p>
                                                        <p className="text-[11px] font-mono font-bold text-zinc-300 uppercase">{item.value}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full gap-2 py-20">
                                        <Play size={24} className="text-zinc-800" />
                                        <span className="text-[10px] font-medium] text-zinc-600">Run a query to see results</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Floating Multi-action Bar */}
                    {hasResultRows && selectedRows.size > 0 && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-background border border-primary/20 rounded-full px-6 py-3 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300 z-50">
                            <span className="text-[10px] font-medium text-primary border-r border-zinc-800 pr-6 mr-2">
                                {selectedRows.size} Rows Selected
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => copySelected('txt')}
                                    className="flex items-center gap-2 px-4 py-1.5 bg-primary text-black rounded-full text-[9px] font-medium hover:bg-[#E6E600] active:scale-95 transition-all"
                                >
                                    <Copy size={12} />
                                    Copy Selected
                                </button>
                                <button
                                    onClick={() => handleCopyAllPreviewRows('csv')}
                                    className="px-4 py-1.5 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 rounded-full text-[9px] font-medium transition-all"
                                >
                                    Copy Preview
                                </button>
                                <button
                                    onClick={handleClearSelection}
                                    className="px-4 py-1.5 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 rounded-full text-[9px] font-medium transition-all"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Toast Notification */}
                    {toast && (
                        <BrandedToast
                            message={toast.message}
                            tone={toast.tone}
                            onClose={() => setToast(null)}
                        />
                    )}
                </div>
            </div>

            {/* Professional Modals */}
            {isSaveModalOpen && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setIsSaveModalOpen(false)} />
                    <div className="ozy-dialog-panel relative w-full max-w-md p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                                <Save size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Save Query</h3>
                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Store this query for later use</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-1.5 block">Query Name</label>
                                <input
                                    type="text"
                                    value={queryName}
                                    onChange={(e: any) => setQueryName(e.target.value)}
                                    placeholder="e.g., Get All Users"
                                    className="w-full bg-background border border-border rounded-md px-4 py-2.5 text-xs text-white placeholder:text-zinc-800 focus:outline-none focus:border-primary/50 transition-all font-bold"
                                    autoFocus
                                />
                            </div>
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={() => setIsSaveModalOpen(false)}
                                    className="flex-1 px-4 py-2.5 rounded-md text-[10px] font-medium text-zinc-500 hover:bg-zinc-900 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmSaveQuery}
                                    disabled={!queryName.trim()}
                                    className="flex-1 px-4 py-2.5 bg-primary text-black rounded-md text-[10px] font-medium hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save Query
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isDangerConfirmOpen && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md"
                        onClick={() => {
                            setIsDangerConfirmOpen(false);
                            setPendingDangerousQuery(null);
                            setPendingDangerMeta(null);
                        }}
                    />
                    <div className="ozy-dialog-panel relative w-full max-w-lg p-6">
                        <div className="flex items-start gap-4">
                            <div className="mt-1 flex h-12 w-12 items-center justify-center rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-400">
                                <AlertTriangle size={22} />
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-white">Confirmacion requerida</h3>
                                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Esta accion puede cambiar o eliminar datos inmediatamente.</p>
                                </div>
                                <p className="text-sm leading-relaxed text-zinc-300">
                                    {pendingDangerMeta?.intent === 'destructive'
                                        ? `Estas por ejecutar una accion destructiva${pendingDangerMeta.estimatedRows && pendingDangerMeta.estimatedRows > 0 ? ` sobre aproximadamente ${pendingDangerMeta.estimatedRows.toLocaleString()} registros` : ''}.`
                                        : 'Estas por ejecutar una mutacion de datos o esquema.'}
                                </p>
                                {pendingDangerMeta?.affectedTables && pendingDangerMeta.affectedTables.length > 0 && (
                                    <p className="text-[10px] text-zinc-500">Tablas detectadas: {pendingDangerMeta.affectedTables.join(', ')}</p>
                                )}
                                <div className="rounded-md border border-border bg-background p-4">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-500">Pending statement</p>
                                    <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{pendingDangerousQuery}</pre>
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 flex items-center gap-3">
                            <button
                                onClick={() => {
                                    setIsDangerConfirmOpen(false);
                                    setPendingDangerousQuery(null);
                                    setPendingDangerMeta(null);
                                }}
                                className="flex-1 rounded-md px-4 py-2.5 text-[10px] font-medium text-zinc-500 transition-all hover:bg-zinc-900"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDangerousRun}
                                className="flex-1 rounded-md bg-amber-400 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-amber-300 active:scale-95"
                            >
                                Confirmar ejecucion
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isExportConfirmOpen && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setIsExportConfirmOpen(false)} />
                    <div className="ozy-dialog-panel relative w-full max-w-sm p-6">
                        <div className="flex flex-col items-center text-center gap-4 py-4">
                            <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                                <Download size={32} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-1">Export Data</h3>
                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                                    You are about to download the results as <span className="text-primary font-bold">.{exportFormat}</span>. Is that correct?
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 mt-4">
                            <button
                                onClick={() => setIsExportConfirmOpen(false)}
                                className="flex-1 px-4 py-2.5 rounded-md text-[10px] font-medium text-zinc-500 hover:bg-zinc-900 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmExport}
                                className="flex-1 px-4 py-2.5 bg-primary text-black rounded-md text-[10px] font-medium hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]"
                            >
                                Confirm Export
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SqlTerminal;


