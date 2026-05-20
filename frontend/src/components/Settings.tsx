import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Info,
  Key,
  Loader2,
  Server,
  Settings as SettingsIcon,
  Database,
  Zap
} from "lucide-react";
import { fetchWithAuth, readJsonIfOk } from "../utils/api";
import EssentialApiKeysPanel from "./EssentialApiKeysPanel";
import ModuleSegmentedNav from "./ModuleSegmentedNav";
import ModuleScrollContainer from "./ModuleScrollContainer";

const MENU_ITEMS = [
  { id: "general", name: "General", icon: SettingsIcon },
  { id: "infrastructure", name: "Infrastructure", icon: Server },
  { id: "usage", name: "Usage & Limits", icon: Activity },
  { id: "api_keys", name: "API Keys", icon: Key },
];

const SETTINGS_TAB_ITEMS = [
  { id: "general", label: "General", hint: "Project status and launch readiness." },
  { id: "infrastructure", label: "Infrastructure", hint: "Connection endpoints and runtime facts." },
  { id: "usage", label: "Usage & Limits", hint: "Project-scoped quotas on shared self-hosted infrastructure." },
  { id: "api_keys", label: "API Keys", hint: "Publishable and secret keys in one place." },
] as const;

interface SettingsProps {
  view?: string;
  onViewSelect?: (view: string) => void;
}

interface ProjectInfo {
  database?: string;
  version?: string;
  project_scope_mode?: string;
  capabilities?: {
    supports_dedicated_schema?: boolean;
    supports_dedicated_database?: boolean;
    supports_managed_billing?: boolean;
    supports_managed_pitr?: boolean;
    supports_read_replicas_ui?: boolean;
    supports_failover_ui?: boolean;
  };
  production?: ProductionReadiness;
}

interface WorkspaceLimits {
  warning_threshold_pct?: number;
  rows_hard_limit?: number;
  storage_bytes_hard_limit?: number;
  api_requests_soft_limit?: number;
  realtime_events_soft_limit?: number;
  function_invocations_soft_limit?: number;
}

interface WorkspaceUsageWarning {
  metric: string;
  current: number;
  limit: number;
  severity: string;
  usage_pct: number;
}

interface WorkspaceUsage {
  workspace_id?: string;
  window?: string;
  window_started_at?: string;
  rows?: number;
  storage_bytes?: number;
  api_requests?: number;
  realtime_events?: number;
  function_invocations?: number;
  warnings?: WorkspaceUsageWarning[];
}

interface ProductionReadiness {
  status?: string;
  launch_ready?: boolean;
  mvp_ready?: boolean;
  saas_ready?: boolean;
  profile?: string;
  deployment_mode?: string;
  storage_runtime?: string;
  realtime_runtime?: string;
  strict_security?: boolean;
  managed_secrets?: boolean;
  https_site_url?: boolean;
  placeholder_domains?: boolean;
  smtp_configured?: boolean;
  pooler_configured?: boolean;
  warnings?: string[];
}

interface ConnectionInfo {
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  api_url?: string;
  direct_uri_template?: string;
  pooler_uri_template?: string;
  app_version?: string;
  git_commit?: string;
}

interface UpdateStatus {
  update_available?: boolean;
  latest_version?: string;
  current_version?: string;
  release_url?: string;
  status?: string;
  message?: string;
}

const formatDeploymentProfile = (profile?: string) => {
  switch (profile) {
    case "azure_cloud":
      return "Private Cloud";
    case "install_to_play":
      return "Install to Play";
    case "custom":
      return "Custom Runtime";
    case "single_project_local":
    case "self_host":
    default:
      return "Single-project local";
  }
};

const formatRuntimeLabel = (value?: string) => {
  switch (value) {
    case "s3":
      return "S3 Compatible";
    case "redis":
      return "Redis Cluster";
    case "local":
      return "Local Node";
    default:
      return value || "unknown";
  }
};

const formatLimitValue = (value?: number, fallback = "Unlimited") => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return new Intl.NumberFormat("en-US").format(num);
};

const formatBytesValue = (value?: number, fallback = "Unlimited") => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return fallback;
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = bytes;
  let unitIndex = -1;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(scaled < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const Settings: React.FC<SettingsProps> = ({
  view = "general",
  onViewSelect,
}) => {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [workspaceUsage, setWorkspaceUsage] = useState<WorkspaceUsage | null>(null);
  const [workspaceLimits, setWorkspaceLimits] = useState<WorkspaceLimits | null>(null);
  const [limitsDraft, setLimitsDraft] = useState<WorkspaceLimits | null>(null);
  const [savingLimits, setSavingLimits] = useState(false);

  const normalizedView = view === "billing" ? "usage" : view;

  const currentView = useMemo(
    () => (MENU_ITEMS.some((item) => item.id === normalizedView) ? normalizedView : "general"),
    [normalizedView],
  );

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const loadProjectData = async () => {
    setLoading(true);
    try {
      const nextWorkspaceId = String(localStorage.getItem("ozy_workspace_id") || "").trim();
      setActiveWorkspaceId(nextWorkspaceId);

      const [infoRes, connectionRes, updateRes, usageRes, limitsRes] = await Promise.all([
        fetchWithAuth("/api/project/info"),
        fetchWithAuth("/api/project/connection"),
        fetchWithAuth("/api/project/update-status"),
        nextWorkspaceId ? fetchWithAuth(`/api/workspaces/${nextWorkspaceId}/usage`) : Promise.resolve(null),
        nextWorkspaceId ? fetchWithAuth(`/api/workspaces/${nextWorkspaceId}/limits`) : Promise.resolve(null),
      ]);

      const [info, connection, update, usage, limits] = await Promise.all([
        readJsonIfOk<ProjectInfo>(infoRes),
        readJsonIfOk<any>(connectionRes),
        readJsonIfOk<UpdateStatus>(updateRes),
        usageRes ? readJsonIfOk<WorkspaceUsage>(usageRes) : Promise.resolve(null),
        limitsRes ? readJsonIfOk<WorkspaceLimits>(limitsRes) : Promise.resolve(null),
      ]);

      setProjectInfo(info);
      setConnectionInfo(connection);
      setUpdateStatus(update);
      setWorkspaceUsage(usage);
      setWorkspaceLimits(limits);
      setLimitsDraft(limits);
    } catch (error) {
      console.error("Failed to load project settings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjectData();
  }, []);

  // Auto-scroll to top when switching sub-views
  useEffect(() => {
    const scrollRoot = document.querySelector('[data-module-scroll-root]');
    if (scrollRoot) scrollRoot.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentView]);

  const renderGeneral = () => (
    <ModuleScrollContainer width="full" className="animate-in fade-in duration-500">
      <header className="px-8 py-6 border-b border-border flex items-center justify-between gap-4 bg-background shrink-0 -mx-4 -mt-5 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 xl:-mx-10 xl:-mt-10 mb-8">
          <div className="flex items-center gap-4">
              <div className="flex w-10 h-10 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary">
                  <SettingsIcon size={20} />
              </div>
              <div>
                  <h1 className="text-xl font-bold text-white uppercase tracking-tight italic">
                      General Settings
                  </h1>
                  <p className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase italic">Project Configuration</p>
              </div>
          </div>
          <div className="flex items-center gap-2 py-1 px-3 bg-zinc-900 border border-border rounded-md text-zinc-500">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Action Required</span>
          </div>
      </header>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Project ID</p>
            <div className="flex items-center justify-between">
              <p className="text-lg font-bold text-white uppercase tracking-tight italic">{activeWorkspaceId || "ozybase"}</p>
              <button onClick={() => void copyValue(activeWorkspaceId || "ozybase", "pid")} className="p-2 rounded-md hover:bg-white/5 transition-colors">
                {copied === "pid" ? <Check size={14} className="text-primary" /> : <Copy size={14} className="text-zinc-600" />}
              </button>
            </div>
          </div>
          <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Postgres Version</p>
            <p className="text-lg font-bold text-white uppercase tracking-tight italic">18.0</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">App Version</p>
            <p className="text-lg font-bold text-white uppercase tracking-tight italic">dev</p>
          </div>
          <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Git Commit</p>
            <p className="text-lg font-bold text-white uppercase tracking-tight italic">none</p>
          </div>
        </div>

        <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-xl">
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Core Release Channel</p>
              <h3 className="text-lg font-bold text-white uppercase tracking-tight italic">Release Status</h3>
              <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">This instance is running a development build.</p>
            </div>
            <div className="rounded-full bg-zinc-900 border border-border px-3 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-widest italic shrink-0">Current</div>
          </div>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/5 border border-white/5 rounded-md p-6">
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Current Core</p>
              <p className="text-lg font-bold text-white uppercase tracking-tight italic">dev</p>
            </div>
            <div className="bg-white/5 border border-white/5 rounded-md p-6">
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Latest Release</p>
              <p className="text-lg font-bold text-white uppercase tracking-tight italic">v1.1.1</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
             <button className="px-5 py-2.5 rounded-md bg-primary text-black text-[9px] uppercase tracking-widest font-bold hover:scale-105 active:scale-95 transition-all shadow-lg">View Release</button>
             <button className="px-5 py-2.5 rounded-md border border-white/10 text-zinc-300 text-[9px] uppercase tracking-widest font-bold hover:border-primary/30 hover:text-primary transition-all bg-black/40 hover:bg-black/60">Review Runtime</button>
          </div>
        </div>

      </div>
    </ModuleScrollContainer>
  );

  const renderInfrastructure = () => (
    <ModuleScrollContainer width="full" className="animate-in fade-in duration-500">
      <header className="px-8 py-6 border-b border-border flex items-center justify-between gap-4 bg-background shrink-0 -mx-4 -mt-5 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 xl:-mx-10 xl:-mt-10 mb-8">
          <div className="flex items-center gap-4">
              <div className="flex w-10 h-10 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary">
                  <Server size={20} />
              </div>
              <div>
                  <h1 className="text-xl font-bold text-white uppercase tracking-tight italic">
                      Infrastructure
                  </h1>
                  <p className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase italic">Endpoints & Runtimes</p>
              </div>
          </div>
          {connectionInfo?.api_url ? (
              <div className="flex items-center gap-2 py-1 px-3 bg-green-500/10 border border-green-500/20 rounded-md">
                  <Check size={12} className="text-green-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-green-500">API Active</span>
              </div>
          ) : (
              <div className="flex items-center gap-2 py-1 px-3 bg-[#d2f20b]/10 border border-[#d2f20b]/20 rounded-md">
                  <AlertTriangle size={12} className="text-[#d2f20b]" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#d2f20b]">API Missing</span>
              </div>
          )}
      </header>

      <div className="bg-black/20 border border-white/5 rounded-md overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
        <div className="p-8 space-y-6">
          {[
            {
              label: "Direct URI",
              value: connectionInfo?.direct_uri_template,
              copyKey: "direct-uri",
            },
            {
              label: "Pooler URI",
              value: connectionInfo?.pooler_uri_template,
              copyKey: "pooler-uri",
              hint: connectionInfo?.pooler_uri_template
                ? undefined
                : "Set DB_POOLER_URL when using PgBouncer, Supavisor, or Azure connection pooling.",
            },
            {
              label: "API URL",
              value: connectionInfo?.api_url,
              copyKey: "api-url",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-white/5 border border-white/5 rounded-md p-5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    {item.label}
                  </p>
                  <code className="text-sm font-semibold text-zinc-200">
                    {item.value || "not available"}
                  </code>
                  {item.hint && (
                    <p className="text-[11px] text-zinc-500 mt-2 max-w-2xl">
                      {item.hint}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void copyValue(item.value, item.copyKey)}
                  className="p-2 rounded-md bg-black/40 border border-white/10 text-zinc-400 hover:text-white hover:border-primary/50 transition-all shrink-0"
                >
                  {copied === item.copyKey ? (
                    <Check size={14} className="text-primary" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ["Host", connectionInfo?.host],
              ["Port", connectionInfo?.port],
              ["Database", connectionInfo?.database],
              ["User", connectionInfo?.user],
            ].map(([label, value]) => (
              <div
                key={label}
                className="bg-white/5 border border-white/5 rounded-md p-5 hover:bg-white/10 transition-colors"
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                  {label}
                </p>
                <div className="flex items-center justify-between gap-4">
                  <code className="text-sm font-semibold text-zinc-200 break-all">
                    {value || "unknown"}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        typeof value === "string" ? value : undefined,
                        String(label),
                      )
                    }
                    className="p-2 rounded-md bg-black/40 border border-white/10 text-zinc-400 hover:text-white hover:border-primary/50 transition-all shrink-0"
                  >
                    {copied === label ? (
                      <Check size={14} className="text-primary" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModuleScrollContainer>
  );

  const saveUsageLimits = async () => {
    if (!activeWorkspaceId || !limitsDraft) {
      return;
    }
    setSavingLimits(true);
    try {
      const response = await fetchWithAuth(`/api/workspaces/${activeWorkspaceId}/limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limitsDraft),
      });
      const payload = await readJsonIfOk<WorkspaceLimits>(response);
      if (!response.ok || !payload) {
        throw new Error("Failed to update project limits");
      }
      setWorkspaceLimits(payload);
      setLimitsDraft(payload);
      await loadProjectData();
    } catch (error) {
      console.error("Failed to save project limits:", error);
    } finally {
      setSavingLimits(false);
    }
  };

  const renderUsage = () => (
    <ModuleScrollContainer width="full" className="animate-in fade-in duration-500">
      <header className="px-8 py-6 border-b border-border flex items-center justify-between gap-4 bg-background shrink-0 -mx-4 -mt-5 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 xl:-mx-10 xl:-mt-10 mb-8">
          <div className="flex items-center gap-4">
              <div className="flex w-10 h-10 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary">
                  <Activity size={20} />
              </div>
              <div>
                  <h1 className="text-xl font-bold text-white uppercase tracking-tight italic">
                      Usage & Limits
                  </h1>
                  <p className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase italic">Project Quotas</p>
              </div>
          </div>
          <div className="flex items-center gap-2 py-1 px-3 bg-zinc-900 border border-border rounded-md text-zinc-500">
              <Database size={12} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Self-Hosted</span>
          </div>
      </header>

      {!activeWorkspaceId ? (
        <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-start gap-4">
            <Info size={18} className="text-primary mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest italic">
                Select a project first
              </h3>
              <p className="text-[11px] text-zinc-500 leading-relaxed mt-2">
                Usage and limit controls are project-scoped. Pick an active project from the switcher before editing quotas.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 pb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {[
              { label: "Rows", value: formatLimitValue(workspaceUsage?.rows, "0"), hint: `Hard limit: ${formatLimitValue(workspaceLimits?.rows_hard_limit)}` },
              { label: "Storage", value: formatBytesValue(workspaceUsage?.storage_bytes, "0 B"), hint: `Hard limit: ${formatBytesValue(workspaceLimits?.storage_bytes_hard_limit)}` },
              { label: "API Requests", value: formatLimitValue(workspaceUsage?.api_requests, "0"), hint: `30d soft limit: ${formatLimitValue(workspaceLimits?.api_requests_soft_limit)}` },
              { label: "Realtime", value: formatLimitValue(workspaceUsage?.realtime_events, "0"), hint: `30d soft limit: ${formatLimitValue(workspaceLimits?.realtime_events_soft_limit)}` },
              { label: "Functions", value: formatLimitValue(workspaceUsage?.function_invocations, "0"), hint: `30d soft limit: ${formatLimitValue(workspaceLimits?.function_invocations_soft_limit)}` },
            ].map((item) => (
              <div key={item.label} className="bg-black/20 border border-white/5 rounded-md p-5 shadow-[0_20px_40px_rgba(0,0,0,0.4)] group hover:border-primary/20 transition-all">
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{item.label}</p>
                <p className="text-2xl font-bold text-white italic tracking-tight">{item.value}</p>
                <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">{item.hint}</p>
              </div>
            ))}
          </div>

          <div data-testid="settings-selfhosted-scope-note" className="bg-white/5 border border-primary/20 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <div className="flex items-start gap-4">
              <Zap size={18} className="text-primary mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-primary uppercase tracking-widest italic">
                  Single-project local scope
                </h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed mt-2">
                  Project scopes people, metadata, API keys, saved views and usage counters. It does not provision another PostgreSQL database or dedicated schema in local single-project mode.
                </p>
              </div>
            </div>
          </div>

          {workspaceUsage?.warnings && workspaceUsage.warnings.length > 0 ? (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300 mb-4">
                Near limit
              </p>
              <div className="space-y-3">
                {workspaceUsage.warnings.map((warning) => (
                  <div key={`${warning.metric}-${warning.limit}`} className="rounded-md border border-amber-500/10 bg-black/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-white">{warning.metric.replace(/_/g, " ")}</p>
                        <p className="mt-1 text-[11px] text-zinc-400 mb-0">
                          {formatLimitValue(warning.current, "0")} used of {warning.metric === "storage_bytes" ? formatBytesValue(warning.limit) : formatLimitValue(warning.limit)}
                        </p>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${warning.severity === "critical" ? "bg-red-500/10 text-red-300 border border-red-500/20" : "bg-amber-500/10 text-amber-300 border border-amber-500/20"}`}>
                        {Math.round(warning.usage_pct)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Project quotas</p>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight italic">Usage + Limits</h3>
                <p className="text-[11px] text-zinc-400 mt-2 max-w-2xl leading-relaxed">
                  Hard limits block writes for rows and storage. Soft limits raise warnings first for API requests, realtime and function invocations over the rolling 30-day window.
                </p>
              </div>
              <button
                onClick={() => void saveUsageLimits()}
                disabled={savingLimits || !limitsDraft}
                className="px-5 py-2.5 rounded-md bg-primary text-black text-[9px] uppercase tracking-widest font-bold hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:hover:scale-100"
              >
                {savingLimits ? "Saving..." : "Save limits"}
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[
                { key: "rows_hard_limit", label: "Rows hard limit", value: limitsDraft?.rows_hard_limit ?? 0, hint: "0 = unlimited" },
                { key: "storage_bytes_hard_limit", label: "Storage hard limit (bytes)", value: limitsDraft?.storage_bytes_hard_limit ?? 0, hint: "Shared DB + shared object store, project-capped" },
                { key: "api_requests_soft_limit", label: "API requests soft limit", value: limitsDraft?.api_requests_soft_limit ?? 0, hint: "Rolling 30d" },
                { key: "realtime_events_soft_limit", label: "Realtime soft limit", value: limitsDraft?.realtime_events_soft_limit ?? 0, hint: "Rolling 30d" },
                { key: "function_invocations_soft_limit", label: "Function soft limit", value: limitsDraft?.function_invocations_soft_limit ?? 0, hint: "Rolling 30d" },
                { key: "warning_threshold_pct", label: "Warning threshold %", value: limitsDraft?.warning_threshold_pct ?? 80, hint: "Raise warnings near exhaustion" },
              ].map((item) => (
                <div key={item.key} className="bg-white/5 border border-white/5 rounded-md p-5 hover:bg-white/10 transition-colors">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{item.label}</p>
                  <input
                    type="number"
                    min={0}
                    max={item.key === "warning_threshold_pct" ? 100 : undefined}
                    value={String(item.value)}
                    onChange={(event) => {
                      const numeric = Number(event.target.value || 0);
                      setLimitsDraft((current) => ({
                        ...(current || {}),
                        [item.key]: Number.isFinite(numeric) ? numeric : 0,
                      }));
                    }}
                    className="w-full bg-black/40 border border-white/10 rounded-md px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all font-mono"
                  />
                  <p className="mt-2 text-[11px] text-zinc-500">{item.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ModuleScrollContainer>
  );

  const renderApiKeys = () => (
    <ModuleScrollContainer width="full" className="animate-in fade-in duration-500">
      <header className="px-8 py-6 border-b border-border flex items-center justify-between gap-4 bg-background shrink-0 -mx-4 -mt-5 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 xl:-mx-10 xl:-mt-10 mb-8">
          <div className="flex items-center gap-4">
              <div className="flex w-10 h-10 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary">
                  <Key size={20} />
              </div>
              <div>
                  <h1 className="text-xl font-bold text-white uppercase tracking-tight italic">
                      API Keys
                  </h1>
                  <p className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase italic">Credentials</p>
              </div>
          </div>
      </header>

      <div className="space-y-6 pb-12">
        <EssentialApiKeysPanel />
      </div>
    </ModuleScrollContainer>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 size={28} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 w-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.02),transparent_50%)] pointer-events-none" />

      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="hidden xl:flex w-64 border-r border-border bg-background flex-col shrink-0 min-h-0">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-[10px] font-bold tracking-wider uppercase italic text-zinc-500">System Settings</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {MENU_ITEMS.map((item) => {
            const isActive = currentView === item.id;
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                onClick={() => onViewSelect?.(item.id)}
                className={`group flex items-center gap-3 rounded-md px-4 py-2 cursor-pointer transition-all ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}
              >
                <Icon size={14} className={isActive ? 'text-primary' : 'text-zinc-600 group-hover:text-zinc-400'} />
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  {item.name}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* MAIN VIEW AREA */}
      <main className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
        {/* MOBILE NAV (Visible only below XL) */}
        <div className="xl:hidden shrink-0 border-b border-border bg-[#0a0a0a]/50 p-4 sticky top-0 z-20 backdrop-blur-md">
            <ModuleSegmentedNav
                items={SETTINGS_TAB_ITEMS}
                activeId={currentView}
                onSelect={(id) => onViewSelect?.(id)}
            />
        </div>

        {currentView === "general" && renderGeneral()}
        {currentView === "infrastructure" && renderInfrastructure()}
        {currentView === "usage" && renderUsage()}
        {currentView === "api_keys" && renderApiKeys()}
      </main>
    </div>
  );
};

export default Settings;


