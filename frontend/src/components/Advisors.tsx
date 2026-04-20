import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap,
  Lightbulb,
} from 'lucide-react';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';
import { applyHealthFix, formatHealthFixSuccessMessage, type HealthFixIssue } from '../utils/healthFix';
import { addProjectSyncListener } from '../utils/projectEvents';

type IssueType = 'security' | 'performance' | string;
type ToastType = 'success' | 'error' | 'warning';

interface HealthIssueResponse {
  type: IssueType;
  title: string;
  description: string;
  fixable?: boolean;
  reviewable?: boolean;
  review_key?: string;
  action_view?: string;
  action_label?: string;
  count?: number;
}

interface AdvisorIssue {
  id: number;
  type: IssueType;
  typeLabel: string;
  severity: 'Critical' | 'Warning';
  title: string;
  desc: string;
  status: 'Error' | 'Warning';
  fixable: boolean;
  reviewable: boolean;
  reviewKey?: string;
  actionView?: string;
  actionLabel?: string;
  count?: number;
}

interface AdvisorStats {
  tableCount: number;
  functionCount: number;
  schemaCount: number;
}

interface ToastState {
  message: string;
  type: ToastType;
}

interface SecurityAdvisorSummary {
  risk_score: number;
  total_tables: number;
  vulnerable_tables: number;
  permissive_policies: number;
  sensitive_without_uid: number;
  likely_orphaned_slots: number;
}

interface SecurityAdvisorTable {
  schema: string;
  table_name: string;
  category?: string;
  is_system?: boolean;
  rls_status: string;
  policy_count: number;
  permissive_read: boolean;
  uses_auth_uid: boolean;
  sensitive: boolean;
  risk_level: string;
  risk_reasons: string[];
  recommended_fix: string;
}

interface SecurityAdvisorInfra {
  slot_name: string;
  database_name: string;
  plugin: string;
  active: boolean;
  retained_bytes: number;
  likely_orphan: boolean;
}

interface SecurityAdvisorScanResponse {
  summary: SecurityAdvisorSummary;
  tables: SecurityAdvisorTable[];
  infra: SecurityAdvisorInfra[];
}

interface SecurityAdvisorFixResult {
  table_name: string;
  action: string;
  status: string;
  message?: string;
}

interface SecurityAdvisorFixResponse {
  dry_run: boolean;
  count: number;
  results: SecurityAdvisorFixResult[];
}

interface SecurityFixPreviewModalProps {
  isOpen: boolean;
  sqlStatements: string[];
  affectedTables: string[];
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

interface AdvisorsProps {
  onViewSelect?: (view: string) => void;
}

const DEFAULT_SCAN: SecurityAdvisorScanResponse = {
  summary: {
    risk_score: 100,
    total_tables: 0,
    vulnerable_tables: 0,
    permissive_policies: 0,
    sensitive_without_uid: 0,
    likely_orphaned_slots: 0,
  },
  tables: [],
  infra: [],
};

const ATTACK_SURFACE_COLORS = ['#ef4444', '#f59e0b', '#f97316', '#eab308'];

const isSystemAdvisorTable = (table: SecurityAdvisorTable): boolean => (
  table.is_system === true || table.category === 'system'
);

const isHealthIssueResponse = (value: unknown): value is HealthIssueResponse => (
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { title?: unknown }).title === 'string' &&
  typeof (value as { description?: unknown }).description === 'string'
);

const parseSecurityAdvisorScan = (value: unknown): SecurityAdvisorScanResponse => {
  if (typeof value !== 'object' || value === null) return DEFAULT_SCAN;
  const payload = value as {
    summary?: unknown;
    tables?: unknown;
    infra?: unknown;
  };

  const summaryRaw = (typeof payload.summary === 'object' && payload.summary !== null)
    ? payload.summary as Record<string, unknown>
    : {};

  const tablesRaw = Array.isArray(payload.tables) ? payload.tables : [];
  const infraRaw = Array.isArray(payload.infra) ? payload.infra : [];

  const tables: SecurityAdvisorTable[] = tablesRaw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      schema: typeof item.schema === 'string' ? item.schema : 'public',
      table_name: typeof item.table_name === 'string' ? item.table_name : '',
      category: typeof item.category === 'string' ? item.category : undefined,
      is_system: Boolean(item.is_system),
      rls_status: typeof item.rls_status === 'string' ? item.rls_status : 'UNKNOWN',
      policy_count: typeof item.policy_count === 'number' ? item.policy_count : 0,
      permissive_read: Boolean(item.permissive_read),
      uses_auth_uid: Boolean(item.uses_auth_uid),
      sensitive: Boolean(item.sensitive),
      risk_level: typeof item.risk_level === 'string' ? item.risk_level : 'low',
      risk_reasons: Array.isArray(item.risk_reasons)
        ? item.risk_reasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
      recommended_fix: typeof item.recommended_fix === 'string' ? item.recommended_fix : 'none',
    }))
    .filter((row) => row.table_name.trim() !== '');

  const infra: SecurityAdvisorInfra[] = infraRaw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      slot_name: typeof item.slot_name === 'string' ? item.slot_name : '',
      database_name: typeof item.database_name === 'string' ? item.database_name : '',
      plugin: typeof item.plugin === 'string' ? item.plugin : '',
      active: Boolean(item.active),
      retained_bytes: typeof item.retained_bytes === 'number' ? item.retained_bytes : 0,
      likely_orphan: Boolean(item.likely_orphan),
    }))
    .filter((slot) => slot.slot_name.trim() !== '');

  return {
    summary: {
      risk_score: typeof summaryRaw.risk_score === 'number' ? summaryRaw.risk_score : 100,
      total_tables: typeof summaryRaw.total_tables === 'number' ? summaryRaw.total_tables : tables.length,
      vulnerable_tables: typeof summaryRaw.vulnerable_tables === 'number' ? summaryRaw.vulnerable_tables : 0,
      permissive_policies: typeof summaryRaw.permissive_policies === 'number' ? summaryRaw.permissive_policies : 0,
      sensitive_without_uid: typeof summaryRaw.sensitive_without_uid === 'number' ? summaryRaw.sensitive_without_uid : 0,
      likely_orphaned_slots: typeof summaryRaw.likely_orphaned_slots === 'number' ? summaryRaw.likely_orphaned_slots : 0,
    },
    tables,
    infra,
  };
};

const parseSecurityFixResponse = (value: unknown): SecurityAdvisorFixResponse => {
  if (typeof value !== 'object' || value === null) {
    return { dry_run: false, count: 0, results: [] };
  }
  const raw = value as { dry_run?: unknown; count?: unknown; results?: unknown };
  const resultsRaw = Array.isArray(raw.results) ? raw.results : [];

  return {
    dry_run: Boolean(raw.dry_run),
    count: typeof raw.count === 'number' ? raw.count : 0,
    results: resultsRaw
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        table_name: typeof item.table_name === 'string' ? item.table_name : '',
        action: typeof item.action === 'string' ? item.action : 'ENABLE_RLS',
        status: typeof item.status === 'string' ? item.status : 'unknown',
        message: typeof item.message === 'string' ? item.message : undefined,
      }))
      .filter((row) => row.table_name.trim() !== ''),
  };
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const prettyBytes = (value: number): string => {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / (1024 ** exponent);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[exponent]}`;
};

const toQuotedQualifiedTable = (rawTableName: string): string => {
  const cleaned = rawTableName.trim();
  if (!cleaned) return '"public"."unknown_table"';
  const parts = cleaned.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    return `"public"."${parts[0].replace(/"/g, '""')}"`;
  }
  const schema = parts[0].replace(/"/g, '""');
  const table = parts[1].replace(/"/g, '""');
  return `"${schema}"."${table}"`;
};

const SecurityFixPreviewModal: React.FC<SecurityFixPreviewModalProps> = ({
  isOpen,
  sqlStatements,
  affectedTables,
  loading,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-110 flex items-center justify-center p-6"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ozy-overlay-backdrop absolute inset-0 backdrop-blur-md" />
      <div className="ozy-dialog-panel relative w-full max-w-3xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-zinc-900/40 px-8 py-6">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-white uppercase italic">Advisor Auto-Fix Preview</h3>
            <p className="mt-2 text-[10px] font-bold tracking-[0.18em] text-zinc-500 uppercase">
              Dry run result before applying schema changes
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-4 py-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase transition-all hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
        </div>

        <div className="space-y-6 p-8">
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-5">
            <p className="text-[11px] font-medium leading-relaxed text-amber-200/80">
              Estas a punto de activar RLS en {affectedTables.length} tablas. Si no existen politicas correctas, algunas rutas de acceso pueden dejar de responder hasta que ajustes sus reglas.
            </p>
          </div>

          <div>
            <p className="mb-3 text-[10px] font-bold tracking-[0.18em] text-zinc-500 uppercase">SQL plan</p>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-white/5 bg-black/40 p-4 custom-scrollbar">
              {sqlStatements.map((sql, index) => (
                <pre key={`${sql}-${index}`} className="rounded-md border border-white/5 bg-black px-4 py-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
                  {sql}
                </pre>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-black/30 px-8 py-5">
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-5 py-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase transition-all hover:text-white"
          >
            Keep dry-run only
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || affectedTables.length === 0}
            className="rounded-md bg-primary px-6 py-2 text-[10px] font-bold tracking-[0.18em] text-black uppercase transition-all hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Applying...' : 'Apply Fixes Now'}
          </button>
        </div>
      </div>
    </div>
  );
};

const Advisors: React.FC<AdvisorsProps> = ({ onViewSelect }) => {
  const [issues, setIssues] = useState<AdvisorIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdvisorStats>({
    tableCount: 0,
    functionCount: 0,
    schemaCount: 0,
  });

  const [fixingId, setFixingId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [advisorScan, setAdvisorScan] = useState<SecurityAdvisorScanResponse>(DEFAULT_SCAN);
  const [advisorRefreshing, setAdvisorRefreshing] = useState(false);
  const [advisorFixLoading, setAdvisorFixLoading] = useState(false);
  const [showFixPreview, setShowFixPreview] = useState(false);
  const [previewSqlStatements, setPreviewSqlStatements] = useState<string[]>([]);
  const [previewTargetTables, setPreviewTargetTables] = useState<string[]>([]);
  const [resolvedVulnerabilities, setResolvedVulnerabilities] = useState(0);

  const showToast = (message: string, type: ToastType = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const securityIssueCount = useMemo(
    () => issues.filter((i) => i.type === 'security').length,
    [issues],
  );
  const performanceIssueCount = useMemo(
    () => issues.filter((i) => i.type === 'performance').length,
    [issues],
  );
  const totalIssueCount = useMemo(() => issues.length, [issues]);

  const vulnerableTables = useMemo(
    () => advisorScan.tables.filter((table) => 
      !isSystemAdvisorTable(table) && 
      (table.rls_status !== 'PROTECTED' || table.permissive_read || (table.sensitive && !table.uses_auth_uid))
    ),
    [advisorScan.tables],
  );

  const userTables = useMemo(
    () => advisorScan.tables.filter((table) => !isSystemAdvisorTable(table)),
    [advisorScan.tables],
  );

  const systemTables = useMemo(
    () => advisorScan.tables.filter((table) => isSystemAdvisorTable(table)),
    [advisorScan.tables],
  );

  const weightedRisk = useMemo(() => {
    const rlsDisabled = userTables.filter((table) => table.rls_status !== 'PROTECTED').length;
    const permissiveSelectTrue = userTables.filter((table) => table.permissive_read).length;
    const sensitiveNoUid = userTables.filter((table) => table.sensitive && !table.uses_auth_uid).length;
    const orphanSlots = advisorScan.infra.filter((slot) => slot.likely_orphan).length;

    const penalties = (
      rlsDisabled * 30 +
      permissiveSelectTrue * 15 +
      sensitiveNoUid * 20 +
      orphanSlots * 10
    );

    return {
      score: clamp(100 - penalties, 0, 100),
      penalties,
      counters: {
        rlsDisabled,
        permissiveSelectTrue,
        sensitiveNoUid,
        orphanSlots,
      },
    };
  }, [advisorScan.infra, userTables]);

  const riskBand = useMemo(() => {
    if (weightedRisk.score <= 35) {
      return { label: 'Critical', chipClass: 'text-red-400 border-red-500/30 bg-red-500/10' };
    }
    if (weightedRisk.score <= 65) {
      return { label: 'Vulnerable', chipClass: 'text-amber-300 border-amber-400/30 bg-amber-500/10' };
    }
    if (weightedRisk.score <= 85) {
      return { label: 'Needs Attention', chipClass: 'text-orange-300 border-orange-400/30 bg-orange-500/10' };
    }
    return { label: 'Stable', chipClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
  }, [weightedRisk.score]);

  const attackSurfaceData = useMemo(() => {
    const identity = weightedRisk.counters.sensitiveNoUid * 20;
    const privacy = weightedRisk.counters.rlsDisabled * 30 + weightedRisk.counters.permissiveSelectTrue * 15;
    const infra = weightedRisk.counters.orphanSlots * 10;
    const total = identity + privacy + infra;

    if (total === 0) {
      return [
        { name: 'Hardening', value: 100, color: '#22c55e', details: 'Sin deuda de seguridad activa' },
      ];
    }

    return [
      { name: 'Identidad', value: identity, color: ATTACK_SURFACE_COLORS[2], details: `${weightedRisk.counters.sensitiveNoUid} tablas sensibles sin auth.uid()` },
      { name: 'Privacidad', value: privacy, color: ATTACK_SURFACE_COLORS[0], details: `${weightedRisk.counters.rlsDisabled} RLS OFF, ${weightedRisk.counters.permissiveSelectTrue} SELECT true` },
      { name: 'Infra', value: infra, color: ATTACK_SURFACE_COLORS[1], details: `${weightedRisk.counters.orphanSlots} slots WAL huerfanos` },
    ].filter((item) => item.value > 0);
  }, [weightedRisk.counters]);

  const fetchHealth = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(forceRefresh ? '/api/project/health?refresh=true' : '/api/project/health');
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        const parsed = data
          .filter(isHealthIssueResponse)
          .map((item, index): AdvisorIssue => ({
            id: index,
            type: item.type,
            typeLabel: item.type === 'security' ? 'Security' : 'Performance',
            severity: item.type === 'security' ? 'Critical' : 'Warning',
            title: item.title,
            desc: item.description,
            status: item.type === 'security' ? 'Error' : 'Warning',
            fixable: item.fixable !== false,
            reviewable: item.reviewable === true,
            reviewKey: item.review_key,
            actionView: item.action_view,
            actionLabel: item.action_label,
            count: typeof item.count === 'number' ? item.count : undefined,
          }));
        setIssues(parsed);
      }
    } catch (error) {
      console.error('Failed to fetch health issues:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetchWithAuth('/api/project/info');
      const data: unknown = await res.json();
      const payload = (typeof data === 'object' && data !== null)
        ? data as Record<string, unknown>
        : {};
      setStats({
        tableCount: typeof payload.table_count === 'number' ? payload.table_count : 0,
        functionCount: typeof payload.function_count === 'number' ? payload.function_count : 0,
        schemaCount: typeof payload.schema_count === 'number' ? payload.schema_count : 0,
      });
    } catch (error) {
      console.error('Failed to fetch project info:', error);
    }
  };

  const fetchAdvisorScan = async (silent = false) => {
    if (!silent) {
      setAdvisorRefreshing(true);
    }

    try {
      const res = await fetchWithAuth('/api/project/security/advisor/scan');
      if (!res.ok) {
        throw new Error('Failed to fetch advisor scan');
      }
      const payload: unknown = await res.json();
      setAdvisorScan(parseSecurityAdvisorScan(payload));
    } catch (error) {
      console.error('Failed to fetch advisor scan', error);
      showToast(getErrorMessage(error, 'Advisor scan failed'), 'error');
    } finally {
      if (!silent) {
        setAdvisorRefreshing(false);
      }
    }
  };

  const handleApplyFix = async (issue: HealthFixIssue) => {
    const issueId = typeof issue.id === 'number' ? issue.id : null;
    setFixingId(issueId);
    try {
      await applyHealthFix(issue);
      showToast(formatHealthFixSuccessMessage(issue), 'success');
      await fetchHealth(true);
    } catch (error) {
      console.error('Fix failed', error);
      showToast(getErrorMessage(error, 'Network error or server unavailable'), 'error');
    } finally {
      setFixingId(null);
    }
  };

  const handleReviewIssue = async (issue: AdvisorIssue) => {
    const issueId = typeof issue.id === 'number' ? issue.id : null;
    setFixingId(issueId);
    try {
      const res = await fetchWithAuth('/api/project/health/review', {
        method: 'POST',
        body: JSON.stringify({
          type: issue.type,
          issue: issue.title,
          review_key: issue.reviewKey || '',
        }),
      });
      if (!res.ok) {
        const errData: unknown = await res.json();
        const message = (
          typeof errData === 'object' &&
          errData !== null &&
          'error' in errData &&
          typeof (errData as { error?: unknown }).error === 'string'
        ) ? (errData as { error: string }).error : 'Failed to review alert';
        showToast(message, 'error');
        return;
      }
      showToast(`Reviewed: ${issue.title}`, 'success');
      await fetchHealth(true);
    } catch (error) {
      console.error('Review failed', error);
      showToast('Network error or server unavailable', 'error');
    } finally {
      setFixingId(null);
    }
  };

  const openFixPreview = async () => {
    const targetTables = vulnerableTables.map((table) => table.table_name);
    if (targetTables.length === 0) {
      showToast('No vulnerable tables to fix', 'warning');
      return;
    }

    setAdvisorFixLoading(true);
    try {
      const res = await fetchWithAuth('/api/project/security/advisor/fix', {
        method: 'POST',
        body: JSON.stringify({ dry_run: true, tables: targetTables }),
      });
      if (!res.ok) {
        throw new Error('Dry-run failed');
      }
      const payload: unknown = await res.json();
      const preview = parseSecurityFixResponse(payload);

      const statements = preview.results
        .map((result) => {
          const safeQualifiedTable = toQuotedQualifiedTable(result.table_name);
          return `ALTER TABLE ${safeQualifiedTable} ENABLE ROW LEVEL SECURITY;`;
        });

      setPreviewSqlStatements(statements);
      setPreviewTargetTables(preview.results.map((result) => result.table_name));
      setShowFixPreview(true);
    } catch (error) {
      console.error('Failed to prepare advisor dry-run', error);
      showToast(getErrorMessage(error, 'Dry-run failed'), 'error');
    } finally {
      setAdvisorFixLoading(false);
    }
  };

  const executeAdvisorFix = async () => {
    if (previewTargetTables.length === 0) {
      setShowFixPreview(false);
      return;
    }

    setAdvisorFixLoading(true);
    try {
      const res = await fetchWithAuth('/api/project/security/advisor/fix', {
        method: 'POST',
        body: JSON.stringify({ dry_run: false, tables: previewTargetTables }),
      });
      if (!res.ok) {
        throw new Error('Auto-fix failed');
      }
      const payload: unknown = await res.json();
      const result = parseSecurityFixResponse(payload);
      const appliedCount = result.results.filter((item) => item.status === 'applied').length;
      setResolvedVulnerabilities((prev) => prev + appliedCount);
      showToast(`Advisor hardened ${appliedCount} table(s)`, 'success');
      setShowFixPreview(false);
      await fetchAdvisorScan(true);
      await fetchHealth(true);
    } catch (error) {
      console.error('Failed to execute advisor auto-fix', error);
      showToast(getErrorMessage(error, 'Failed to execute advisor fix'), 'error');
    } finally {
      setAdvisorFixLoading(false);
    }
  };

  useEffect(() => {
    void fetchHealth();
    void fetchStats();
    void fetchAdvisorScan();
  }, []);

  useEffect(() => {
    const unsubscribe = addProjectSyncListener((detail) => {
      if (detail.health) {
        void fetchHealth(true);
      }
      if (detail.tables) {
        void fetchStats();
        void fetchAdvisorScan(true);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-background custom-scrollbar animate-in fade-in duration-700">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,rgba(254,254,0,0.04),transparent_45%),radial-gradient(circle_at_80%_10%,rgba(239,68,68,0.06),transparent_35%)]" />

      {toast ? (
        <BrandedToast
          message={toast.message}
          tone={toast.type}
          onClose={() => setToast(null)}
        />
      ) : null}

      <header className="relative flex items-center justify-between border-b border-white/5 bg-[#131313] px-12 py-12">
        <div>
          <div className="mb-4 flex items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-primary/30 bg-primary/20 shadow-[0_0_50px_rgba(254,254,0,0.1)]">
              <ShieldCheck className="text-primary" size={30} />
            </div>
            <div>
              <h1 className="text-4xl leading-none font-bold tracking-tighter text-white uppercase italic">Security Advisors</h1>
              <p className="mt-3 text-[10px] font-bold tracking-[0.22em] text-zinc-500 uppercase">
                Internal audit engine for data perimeter
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold tracking-[0.18em] text-zinc-400 uppercase">
            <Cpu size={12} className="text-zinc-500" />
            Risk score live from Security Advisor scan
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              void fetchAdvisorScan();
              void fetchHealth(true);
              void fetchStats();
            }}
            disabled={advisorRefreshing || loading}
            className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-8 py-3 text-[10px] font-bold tracking-widest text-zinc-300 uppercase transition-all hover:border-primary/50 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw size={14} className={advisorRefreshing || loading ? 'animate-spin' : ''} />
            Full Scan
          </button>

          <button
            onClick={() => void openFixPreview()}
            disabled={advisorFixLoading || vulnerableTables.length === 0}
            className="flex items-center gap-2 rounded-md bg-white px-7 py-3 text-[10px] font-bold tracking-[0.18em] text-black uppercase transition-all hover:bg-primary disabled:opacity-50"
          >
            {advisorFixLoading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
            Auto-Fix
          </button>
        </div>
      </header>

      <div className="space-y-12 px-12 py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <div className="rounded-md border border-white/5 bg-background p-8 shadow-2xl">
            <p className="text-[9px] font-bold tracking-[0.28em] text-zinc-500 uppercase">Risk Score</p>
            <div className="mt-3 flex items-end gap-3">
              <span className="text-5xl font-bold tracking-tighter text-white tabular-nums">{weightedRisk.score}</span>
              <span className="pb-1 text-sm font-bold text-zinc-500">/100</span>
            </div>
            <span className={`mt-4 inline-flex rounded-full border px-3 py-1 text-[9px] font-bold tracking-[0.16em] uppercase ${riskBand.chipClass}`}>
              {riskBand.label}
            </span>
            <p className="mt-5 text-[10px] leading-relaxed text-zinc-500">
              Score calculado con penalizacion por RLS desactivado, politicas SELECT true, tablas sensibles sin auth.uid() y slots WAL huerfanos.
            </p>
          </div>

          <div className="rounded-md border border-red-500/15 bg-red-500/5 p-8 shadow-2xl">
            <p className="text-[9px] font-bold tracking-[0.28em] text-zinc-400 uppercase">RLS Disabled</p>
            <p className="mt-3 text-4xl font-bold tracking-tighter text-red-400 tabular-nums">{weightedRisk.counters.rlsDisabled}</p>
            <p className="mt-2 text-[10px] text-zinc-500">-30 pts por tabla</p>
          </div>

          <div className="rounded-md border border-orange-500/15 bg-orange-500/5 p-8 shadow-2xl">
            <p className="text-[9px] font-bold tracking-[0.28em] text-zinc-400 uppercase">SELECT true / auth.uid()</p>
            <p className="mt-3 text-4xl font-bold tracking-tighter text-orange-300 tabular-nums">
              {weightedRisk.counters.permissiveSelectTrue + weightedRisk.counters.sensitiveNoUid}
            </p>
            <p className="mt-2 text-[10px] text-zinc-500">-15 / -20 pts en reglas de acceso</p>
          </div>

          <div className="rounded-md border border-amber-500/15 bg-amber-500/5 p-8 shadow-2xl">
            <p className="text-[9px] font-bold tracking-[0.28em] text-zinc-400 uppercase">Vulnerabilidades resueltas</p>
            <p className="mt-3 text-4xl font-bold tracking-tighter text-amber-300 tabular-nums">{resolvedVulnerabilities}</p>
            <p className="mt-2 text-[10px] text-zinc-500">Contador de hardening ejecutado</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
          <div className="rounded-[2.5rem] border border-white/5 bg-background p-8 shadow-2xl xl:col-span-2">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-white uppercase italic">Superficie de Ataque</h2>
              <ShieldAlert size={20} className="text-zinc-600" />
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={attackSurfaceData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={95}
                    paddingAngle={3}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                  >
                    {attackSurfaceData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: '#0a0a0a',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 12,
                      padding: '12px 16px',
                    }}
                    itemStyle={{
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                    }}
                    labelStyle={{
                      color: '#a1a1aa',
                      fontSize: '10px',
                      marginBottom: '4px',
                      textTransform: 'uppercase',
                    }}
                    formatter={(value: number) => `${value} pts`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6 space-y-2">
              {attackSurfaceData.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-md border border-white/5 bg-black/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <div>
                      <p className="text-xs font-bold text-white uppercase tracking-wider">{item.name}</p>
                      <p className="text-[10px] text-zinc-500">{item.details}</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-zinc-300 tabular-nums">{item.value} pts</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-white/5 bg-background p-8 shadow-2xl xl:col-span-3">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase italic">Advisor Findings</h2>
                <p className="mt-2 text-[10px] font-bold tracking-[0.16em] text-zinc-500 uppercase">
                  {vulnerableTables.length} tablas de usuario vulnerables, {advisorScan.infra.filter((slot) => slot.likely_orphan).length} slots huerfanos
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/40 px-4 py-1 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                backend score {advisorScan.summary.risk_score}
              </span>
            </div>

            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
              {userTables.length === 0 ? (
                <div className="rounded-md border border-white/5 bg-black/30 px-5 py-10 text-center text-[10px] font-bold tracking-[0.2em] text-zinc-600 uppercase">
                  Sin tablas de usuario para auditar
                </div>
              ) : (
                userTables.map((table) => {
                  const rlsOff = table.rls_status !== 'PROTECTED';
                  const isPermissive = table.permissive_read || (table.sensitive && !table.uses_auth_uid);
                  
                  let badgeLabel = 'PROTECTED';
                  let badgeClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
                  
                  if (rlsOff) {
                    badgeLabel = 'VULNERABLE / RLS OFF';
                    badgeClass = 'border-red-500/30 bg-red-500/10 text-red-300';
                  } else if (isPermissive) {
                    badgeLabel = 'WEAK POLICY / PERMISSIVE';
                    badgeClass = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
                  }

                  return (
                    <div
                      key={`${table.schema}.${table.table_name}`}
                      className={`group relative rounded-md border px-5 py-4 transition-all ${rlsOff ? 'border-red-500/20 bg-red-500/5' : isPermissive ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/5 bg-black/20'} hover:border-white/20`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="text-sm font-bold tracking-tight text-white">{table.schema}.{table.table_name}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badgeClass}`}>
                              {badgeLabel}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-zinc-400">
                            {table.risk_reasons.length > 0 ? table.risk_reasons.join(' • ') : 'No risk reasons'}
                          </p>
                        </div>
                        <div className="text-right text-[10px] text-zinc-500">
                          <p>Policies: {table.policy_count}</p>
                          <p>auth.uid(): {table.uses_auth_uid ? 'yes' : 'no'}</p>
                        </div>
                      </div>

                      {/* Recommendation Reveal on Hover */}
                      <div className="mt-4 hidden group-hover:block animate-in slide-in-from-top-1 duration-200 border-t border-white/5 pt-3">
                        <div className="flex items-center gap-2 text-[9px] font-bold text-primary uppercase tracking-[0.2em] mb-1">
                          <Lightbulb size={12} className="text-primary" />
                          Recommended Action
                        </div>
                        <p className="text-[11px] text-zinc-400 italic leading-relaxed">
                          {table.recommended_fix || "Review policy definitions for this table perimeter."}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {systemTables.length > 0 ? (
              <details className="mt-6 rounded-md border border-zinc-700/50 bg-zinc-900/40 p-4">
                <summary className="cursor-pointer list-none text-[10px] font-bold tracking-[0.16em] text-zinc-400 uppercase">
                  Infrastructure Logs ({systemTables.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {systemTables.map((table) => (
                    <div key={`${table.schema}.${table.table_name}`} className="rounded-md border border-zinc-800 bg-black/30 px-4 py-3 text-[11px] text-zinc-400">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-zinc-300">{table.schema}.{table.table_name}</span>
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[9px] font-bold tracking-widest text-zinc-500 uppercase">
                          system
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-500">
                        {table.risk_reasons.length > 0 ? table.risk_reasons.join(' • ') : 'No risk reasons'}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {advisorScan.infra.length > 0 ? (
              <div className="mt-6 rounded-md border border-amber-500/20 bg-amber-500/5 p-5">
                <p className="mb-3 text-[10px] font-bold tracking-[0.15em] text-amber-300 uppercase">Infra audit: replication slots</p>
                <div className="space-y-2">
                  {advisorScan.infra.map((slot) => (
                    <div key={slot.slot_name} className="flex items-center justify-between text-[11px] text-zinc-300">
                      <span>{slot.slot_name}</span>
                      <span className={slot.likely_orphan ? 'text-amber-300' : 'text-zinc-500'}>
                        {slot.likely_orphan ? 'Likely orphan' : 'Healthy'} • {prettyBytes(slot.retained_bytes)} retained
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[2.2rem] border border-white/5 bg-background p-8 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h4 className="text-[10px] font-bold tracking-[0.2em] text-white uppercase">Deployment Alert Registry</h4>
            <span className="text-[10px] font-bold tracking-[0.16em] text-zinc-500 uppercase">{issues.length} vectors</span>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-5 py-20">
                <RefreshCw size={38} className="animate-spin text-primary/40" />
                <span className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase">Scanning project health...</span>
              </div>
            ) : issues.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 size={56} className="mx-auto mb-5 text-emerald-500/30" />
                <p className="text-[11px] font-bold tracking-[0.25em] text-zinc-500 uppercase">No health findings</p>
              </div>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-white/5 bg-black/30 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-widest uppercase ${issue.type === 'security' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                        {issue.typeLabel}
                      </span>
                      {typeof issue.count === 'number' && issue.count > 1 ? (
                        <span className="rounded-full border border-white/10 bg-black px-2 py-0.5 text-[8px] font-bold tracking-widest text-zinc-500 uppercase">
                          {issue.count} events
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-sm font-bold tracking-tight text-white">{issue.title}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">{issue.desc}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    {issue.actionView && issue.reviewable ? (
                      <button
                        onClick={() => {
                          if (issue.actionView) {
                            onViewSelect?.(issue.actionView);
                          }
                        }}
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-widest text-zinc-300 uppercase transition-all hover:border-primary/40 hover:text-white"
                      >
                        {issue.actionLabel || 'OPEN'}
                      </button>
                    ) : null}

                    {issue.reviewable ? (
                      <button
                        onClick={() => void handleReviewIssue(issue)}
                        disabled={fixingId !== null}
                        className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold tracking-widest text-emerald-300 uppercase transition-all hover:border-emerald-400/40 disabled:opacity-50"
                      >
                        {fixingId === issue.id ? 'REVIEWING...' : 'MARK RESOLVED'}
                      </button>
                    ) : null}

                    {issue.fixable ? (
                      <button
                        onClick={() => void handleApplyFix(issue as HealthFixIssue)}
                        disabled={fixingId !== null}
                        className="rounded-md bg-white px-4 py-2 text-[10px] font-bold tracking-widest text-black uppercase transition-all hover:bg-primary disabled:opacity-50"
                      >
                        {fixingId === issue.id ? 'EXECUTING...' : 'AUTO FIX'}
                      </button>
                    ) : (!issue.reviewable ? (
                      <span className="rounded-md border border-white/10 px-4 py-2 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
                        MANUAL
                      </span>
                    ) : null)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {[
            { title: 'Aggregate Tables', value: stats.tableCount, icon: Database, color: 'text-indigo-400' },
            { title: 'Global Functions', value: stats.functionCount, icon: Zap, color: 'text-primary' },
            { title: 'Active Schemas', value: stats.schemaCount, icon: Terminal, color: 'text-sky-400' },
          ].map((item, index) => (
            <div key={index} className="flex items-center gap-6 rounded-md border border-white/5 bg-[#131313] p-6 shadow-xl transition-all hover:bg-white/1">
              <div className={`flex h-14 w-14 items-center justify-center rounded-md border border-white/5 bg-black ${item.color}`}>
                <item.icon size={24} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[9px] font-bold tracking-[0.25em] text-zinc-500 uppercase">{item.title}</p>
                <p className="mt-1 text-2xl font-bold tracking-tighter text-white tabular-nums">{item.value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-[2.2rem] border border-white/5 bg-background p-8">
          <h3 className="mb-5 text-lg font-bold tracking-tight text-white uppercase italic">Risk Formula</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-sm font-bold text-red-300">RLS disabled</p>
              <p className="mt-2 text-[10px] text-zinc-500">-30 pts por tabla</p>
            </div>
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-4">
              <p className="text-sm font-bold text-orange-300">SELECT true</p>
              <p className="mt-2 text-[10px] text-zinc-500">-15 pts por regla</p>
            </div>
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-4">
              <p className="text-sm font-bold text-orange-300">Sin auth.uid()</p>
              <p className="mt-2 text-[10px] text-zinc-500">-20 pts en tablas sensibles</p>
            </div>
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-bold text-amber-300">Slot WAL huerfano</p>
              <p className="mt-2 text-[10px] text-zinc-500">-10 pts por slot</p>
            </div>
          </div>
        </div>
      </div>

      <SecurityFixPreviewModal
        isOpen={showFixPreview}
        sqlStatements={previewSqlStatements}
        affectedTables={previewTargetTables}
        loading={advisorFixLoading}
        onClose={() => setShowFixPreview(false)}
        onConfirm={() => void executeAdvisorFix()}
      />
    </div>
  );
};

export default Advisors;


