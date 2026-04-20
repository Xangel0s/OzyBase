import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Key,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { fetchWithAuth, readJsonIfOk } from "../utils/api";
import ConfirmModal from "./ConfirmModal";
import { BrandedToast, type BrandedToastTone } from "./OverlayPrimitives";

type EssentialRole = "anon" | "service_role";
type MCPEditorTab = "vscode" | "cursor" | "antigravity" | "windsurf";

interface EssentialKeySummary {
  id: string;
  role: EssentialRole;
  label: string;
  prefix: string;
  key_version: number;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
}

interface EssentialKeysResponse {
  keys?: EssentialKeySummary[];
}

interface MCPConfig {
  runtime: string;
  transport?: string;
  server_url?: string;
  tools_url: string;
  invoke_url: string;
  auth_header: string;
  tool_count: number;
  sample_server?: string;
  sample_tools: string;
  sample_invoke: string;
  vscode_config?: string;
  servers_config?: string;
  mcp_servers_config?: string;
}

interface RevealedKeyPayload {
  id: string;
  role: EssentialRole;
  label: string;
  key: string;
  prefix: string;
  key_version: number;
  created_at: string;
  last_used_at?: string | null;
  warning?: string;
  mcp?: MCPConfig;
}

interface ToastState {
  message: string;
  tone: BrandedToastTone;
  title?: string;
}

interface MCPPendingApproval {
  id: string;
  token_security_level: string;
  tool: string;
  arguments?: Record<string, unknown>;
  status: string;
  reason?: string;
  created_at: string;
  updated_at: string;
  tool_risk?: string;
}

interface TypeHint {
  raw: string;
  normalized: string;
  supported: boolean;
}

const KEY_ORDER: EssentialRole[] = ["anon", "service_role"];

const MCP_SUPPORTED_TYPES = [
  "int2",
  "int4",
  "int8",
  "float4",
  "float8",
  "numeric",
  "json",
  "jsonb",
  "text",
  "varchar",
  "uuid",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "bool",
  "boolean",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "interval",
  "money",
  "text_array",
  "int_array",
] as const;

const MCP_TYPE_ALIASES: Record<string, string> = {
  bigint: "int8",
  integer: "int4",
  smallint: "int2",
  "double precision": "float8",
  real: "float4",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "character varying": "varchar",
  array: "text_array",
};

const MCP_SUPPORTED_TYPE_SET = new Set<string>(MCP_SUPPORTED_TYPES);

const normalizeMCPType = (value: unknown): string => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return MCP_TYPE_ALIASES[raw] || raw;
};

const formatApprovalReason = (item: MCPPendingApproval): string => {
  const reason = String(item.reason || "").trim();
  if (!reason) return "Pending manual approval.";
  if (reason.toLowerCase().includes("requires approval")) {
    return "This write action needs an explicit human approval before execution.";
  }
  return reason;
};

const buildTypeHints = (item: MCPPendingApproval): TypeHint[] => {
  const schema = Array.isArray(item.arguments?.schema)
    ? (item.arguments?.schema as Array<Record<string, unknown>>)
    : [];

  const seen = new Set<string>();
  const hints: TypeHint[] = [];
  schema.forEach((column) => {
    const rawType = String(column?.type || "").trim();
    if (!rawType) return;
    const key = rawType.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const normalized = normalizeMCPType(rawType);
    hints.push({
      raw: rawType,
      normalized,
      supported: MCP_SUPPORTED_TYPE_SET.has(normalized),
    });
  });
  return hints;
};

const FALLBACK_LABELS: Record<EssentialRole, string> = {
  anon: "Publishable key",
  service_role: "Secret key",
};

interface RolePresentation {
  label: string;
  eyebrow: string;
  badge: string;
  description: string;
  valueLabel: string;
  valuePlaceholder: string;
  accentClass: string;
  badgeClass: string;
  actionClass: string;
  noteClass: string;
  warningTitle: string;
  warningBody: string;
  rotateTitle: string;
  rotateMessage: string;
}

const ROLE_PRESENTATION: Record<EssentialRole, RolePresentation> = {
  anon: {
    label: "Publishable key",
    eyebrow: "Client/Public",
    badge: "Browser safe with RLS",
    description:
      "Use this key in browser apps, mobile clients and public SDKs. It should stay constrained by RLS and never be used for server-level administration.",
    valueLabel: "Current Key",
    valuePlaceholder:
      "Locked. Verify the current admin password to reveal this publishable key.",
    accentClass: "bg-gradient-to-br from-sky-500/14 via-sky-500/4 to-transparent",
    badgeClass: "bg-sky-500/10 border-sky-500/20 text-sky-300",
    actionClass:
      "bg-sky-500/12 border-sky-500/25 text-sky-100 hover:bg-sky-500/18",
    noteClass: "border-sky-500/20 bg-sky-500/8 text-sky-100/95",
    warningTitle: "Public client profile",
    warningBody:
      "Ship this key only to clients that should respect public-facing policies. Rotation cuts over immediately, so deployed apps must switch to the new publishable key.",
    rotateTitle: "Rotate Publishable Key",
    rotateMessage:
      "This will issue a fresh publishable key and the previous key will stop working immediately for browser and public clients.",
  },
  service_role: {
    label: "Secret key",
    eyebrow: "Server/Admin",
    badge: "Server only",
    description:
      "Use this key only in trusted servers, internal automation and MCP clients. Never embed it in browsers, mobile bundles or public repositories.",
    valueLabel: "Current Secret",
    valuePlaceholder:
      "Locked. Verify the current admin password to reveal this secret key.",
    accentClass:
      "bg-gradient-to-br from-amber-500/16 via-amber-500/5 to-transparent",
    badgeClass: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    actionClass:
      "bg-amber-500/12 border-amber-500/25 text-amber-50 hover:bg-amber-500/18",
    noteClass:
      "border-amber-500/25 bg-gradient-to-br from-amber-500/14 via-[#1b1406] to-[#0e0e0e] text-amber-50",
    warningTitle: "Never expose this key",
    warningBody:
      "This secret unlocks MCP, automation and admin-grade workloads. Keep it on servers only. Rotation immediately cuts off existing secret-key traffic until consumers deploy the new secret.",
    rotateTitle: "Rotate Secret Key",
    rotateMessage:
      "This will issue a fresh secret key and the previous secret will stop working immediately for MCP and server workloads.",
  },
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatRotationTimestamp = (value?: string | null, version?: number) => {
  if (!value) {
    return "Unknown";
  }
  if ((version || 1) <= 1) {
    return "Not rotated yet";
  }
  return formatTimestamp(value);
};

const EssentialApiKeysPanel: React.FC = () => {
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysByRole, setKeysByRole] = useState<
    Record<EssentialRole, EssentialKeySummary | null>
  >({
    anon: null,
    service_role: null,
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<{
    runtime: string;
    count: number;
  } | null>(null);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<MCPPendingApproval[]>(
    [],
  );
  const [approvalsActioningID, setApprovalsActioningID] = useState<
    string | null
  >(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null,
  );
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [revealedByRole, setRevealedByRole] = useState<
    Partial<Record<EssentialRole, RevealedKeyPayload>>
  >({});
  const [loadingRole, setLoadingRole] = useState<EssentialRole | null>(null);
  const [rotatingRole, setRotatingRole] = useState<EssentialRole | null>(null);
  const [pendingRotateRole, setPendingRotateRole] =
    useState<EssentialRole | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [mcpEditorTab, setMCPEditorTab] = useState<MCPEditorTab>("vscode");
  const [toast, setToast] = useState<ToastState | null>(null);

  const isVerified = Boolean(
    verificationToken &&
    verifiedUntil &&
    new Date(verifiedUntil).getTime() > Date.now(),
  );

  const setFeedback = (
    message: string,
    tone: BrandedToastTone,
    title?: string,
  ) => {
    setToast({ message, tone, title });
    window.setTimeout(() => setToast(null), 3200);
  };

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/keys/essential");
      const payload = await readJsonIfOk<EssentialKeysResponse>(res);
      if (!payload) {
        throw new Error("Failed to load essential API keys");
      }
      const next: Record<EssentialRole, EssentialKeySummary | null> = {
        anon: null,
        service_role: null,
      };
      for (const item of Array.isArray(payload.keys) ? payload.keys : []) {
        next[item.role] = item;
      }
      setKeysByRole(next);
    } catch (error) {
      console.error("Failed to load essential API keys:", error);
      setKeysByRole({ anon: null, service_role: null });
      setFeedback(
        "The dashboard could not load the essential project keys.",
        "error",
        "API Keys",
      );
    } finally {
      setKeysLoading(false);
    }
  };

  const loadMCPStatus = async () => {
    setMcpLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/mcp/tools");
      const payload = await readJsonIfOk<{ 
        runtime?: string;
        count?: number;
      }>(res);
      if (!payload) {
        throw new Error("Failed to load MCP tools");
      }
      setMcpStatus({
        runtime: payload.runtime || "native",
        count: Number(payload.count || 0),
      });
    } catch (error) {
      console.error("Failed to load MCP status:", error);
      setMcpStatus(null);
    } finally {
      setMcpLoading(false);
    }
  };

  const loadPendingApprovals = async () => {
    setApprovalsLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/mcp/approvals/pending");
      const payload = await readJsonIfOk<{
        items?: MCPPendingApproval[];
      }>(res);
      if (!payload) {
        throw new Error("Failed to load pending approvals");
      }
      setPendingApprovals(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      console.error("Failed to load MCP approvals:", error);
      setPendingApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  };

  const resolvePendingApproval = async (
    requestID: string,
    action: "approve" | "reject",
  ) => {
    setApprovalsActioningID(requestID);
    try {
      const res = await fetchWithAuth("/api/project/mcp/approvals/action", {
        method: "POST",
        body: JSON.stringify({
          request_id: requestID,
          action,
          note: `dashboard_${action}`,
        }),
      });
      const payload = await readJsonIfOk<{
        error?: string;
        tool?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(payload?.error || "Approval action failed");
      }
      setFeedback(
        action === "approve"
          ? `Approved ${payload?.tool || "request"} and executed it.`
          : `Rejected ${payload?.tool || "request"}.`,
        "success",
        "Approval Chamber",
      );
      await Promise.all([loadPendingApprovals(), loadMCPStatus()]);
    } catch (error) {
      console.error("Failed to resolve MCP approval:", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "The approval action failed.",
        "error",
        "Approval Chamber",
      );
    } finally {
      setApprovalsActioningID(null);
    }
  };

  useEffect(() => {
    void Promise.all([loadKeys(), loadMCPStatus(), loadPendingApprovals()]);
  }, []);

  const ensureVerified = () => {
    if (isVerified) {
      return true;
    }
    setShowVerifyModal(true);
    return false;
  };

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVerifying(true);
    try {
      const res = await fetchWithAuth("/api/project/keys/essential/verify", {
        method: "POST",
        onUnauthorized: "passthrough",
        body: JSON.stringify({ password: adminPassword }),
      });
      const payload = await readJsonIfOk<{
        error?: string;
        verification_token?: string;
        verified_until?: string;
      }>(res);
      const nextPayload = payload ?? {};
      if (!res.ok || !nextPayload.verification_token) {
        setFeedback(
          nextPayload.error || "The current admin password was rejected.",
          "error",
          "Verification",
        );
        return;
      }
      setVerificationToken(nextPayload.verification_token);
      setVerifiedUntil(nextPayload.verified_until || null);
      setAdminPassword("");
      setShowVerifyModal(false);
      setFeedback(
        "Admin verification confirmed. You can reveal or rotate the essential keys now.",
        "success",
        "Verification",
      );
    } catch (error) {
      console.error("Failed to verify admin password:", error);
      setFeedback(
        "The dashboard could not verify the admin password.",
        "error",
        "Verification",
      );
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) {
      return;
    }
    setLoadingRole(role);
    try {
      const res = await fetchWithAuth(
        `/api/project/keys/essential/${role}/reveal`,
        {
          method: "POST",
          onUnauthorized: "passthrough",
          body: JSON.stringify({ verification_token: verificationToken }),
        },
      );
      const payload = await readJsonIfOk<RevealedKeyPayload & {
        error?: string;
      }>(res);
      if (!res.ok || !payload?.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(
          payload?.error || "The key could not be revealed.",
          "error",
          "API Keys",
        );
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
    } catch (error) {
      console.error("Failed to reveal essential API key:", error);
      setFeedback(
        "The key could not be revealed right now.",
        "error",
        "API Keys",
      );
    } finally {
      setLoadingRole(null);
    }
  };

  const rotateKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) {
      return;
    }
    setRotatingRole(role);
    try {
      const res = await fetchWithAuth(
        `/api/project/keys/essential/${role}/rotate`,
        {
          method: "POST",
          onUnauthorized: "passthrough",
          body: JSON.stringify({
            verification_token: verificationToken,
            reason: "dashboard_rotation",
          }),
        },
      );
      const payload = await readJsonIfOk<RevealedKeyPayload & {
        error?: string;
      }>(res);
      if (!res.ok || !payload?.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(
          payload?.error || "The key rotation failed.",
          "error",
          "Rotation",
        );
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
      await loadKeys();
      setFeedback(
        payload.warning || "The essential key rotated successfully.",
        "success",
        "Rotation",
      );
    } catch (error) {
      console.error("Failed to rotate essential API key:", error);
      setFeedback("The key rotation failed.", "error", "Rotation");
    } finally {
      setPendingRotateRole(null);
      setRotatingRole(null);
    }
  };

  const serviceRoleReveal = revealedByRole.service_role;
  const serviceRoleMCP = serviceRoleReveal?.mcp;
  const fallbackServerURL =
    serviceRoleMCP?.server_url || serviceRoleMCP?.invoke_url || "";
  const fallbackSecret = serviceRoleReveal?.key || "";
  const stdioServersConfigJSON = JSON.stringify(
    {
      servers: {
        ozybase: {
          command: "ozybase",
          args: ["mcp", "bridge", "--url", fallbackServerURL],
          env: {
            OZYBASE_API_KEY: fallbackSecret,
          },
        },
      },
    },
    null,
    2,
  );
  const stdioMCPServersConfigJSON = JSON.stringify(
    {
      mcpServers: {
        ozybase: {
          command: "ozybase",
          args: ["mcp", "bridge", "--url", fallbackServerURL],
          env: {
            OZYBASE_API_KEY: fallbackSecret,
          },
        },
      },
    },
    null,
    2,
  );
  const mcpEditorOptions = [
    {
      id: "vscode" as const,
      label: "VS Code",
      logo: "/integrations/editors/vscode.png",
      rootKey: "servers",
      copyKey: "mcp-vscode-config",
      description: "STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).",
      config: stdioServersConfigJSON,
    },
    {
      id: "cursor" as const,
      label: "Cursor",
      logo: "/integrations/editors/cursor.png",
      rootKey: "mcpServers",
      copyKey: "mcp-cursor-config",
      description: "STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).",
      config: stdioMCPServersConfigJSON,
    },
    {
      id: "antigravity" as const,
      label: "Antigravity",
      logo: "/integrations/editors/antigravity.png",
      rootKey: "mcpServers",
      copyKey: "mcp-antigravity-config",
      description: "STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).",
      config: stdioMCPServersConfigJSON,
    },
    {
      id: "windsurf" as const,
      label: "Windsurf",
      logo: "/integrations/editors/windsurf.png",
      rootKey: "mcpServers",
      copyKey: "mcp-windsurf-config",
      description: "STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).",
      config: stdioMCPServersConfigJSON,
    },
  ];
  const selectedMCPEditor =
    mcpEditorOptions.find((option) => option.id === mcpEditorTab) ||
    mcpEditorOptions[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)] relative overflow-hidden transition-all hover:border-white/10 group">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between relative z-10">
          <div className="flex items-start gap-6">
            <div className="w-14 h-14 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
              <ShieldCheck size={24} />
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary italic">
                Verified reveal flow
              </p>
              <h3 className="text-lg font-bold text-white tracking-tight italic">
                Essential key vault
              </h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed max-w-2xl">
                Manual key creation was retired. Reveal and rotate only the
                current publishable and secret keys after confirming the
                current admin password.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void loadKeys()}
              className="px-5 py-2.5 bg-black/40 border border-white/10 rounded-md text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-all flex items-center gap-2"
            >
              {keysLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh
            </button>
            <button
              onClick={() => setShowVerifyModal(true)}
              data-testid="verify-admin-button"
              className={`px-5 py-2.5 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                isVerified
                  ? "bg-primary text-black shadow-lg"
                  : "bg-black/60 border border-white/10 text-white hover:border-primary/40"
              }`}
            >
              <LockKeyhole size={12} />
              {isVerified ? "Verified" : "Verify Admin"}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-white/5 bg-white/5 px-4 py-3 flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
          <span className="font-bold uppercase tracking-widest text-zinc-500 text-[9px]">
            Session
          </span>
          <span>
            {isVerified
              ? `Unlocked until ${formatTimestamp(verifiedUntil)}`
              : "Locked until the current admin password is confirmed."}
          </span>
          <span className="text-zinc-600">
            Current session tokens are not project keys and never replace the
            publishable or secret key.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {KEY_ORDER.map((role) => {
          const summary = keysByRole[role];
          const revealed = revealedByRole[role];
          const roleMeta = ROLE_PRESENTATION[role];
          const label = roleMeta.label || summary?.label || FALLBACK_LABELS[role];
          const isBusy = loadingRole === role || rotatingRole === role;
          const keyVersion =
            summary?.key_version || revealed?.key_version || 1;
          const createdAt = summary?.created_at || revealed?.created_at;

          return (
            <div
              key={role}
              data-testid={`essential-key-card-${role}`}
              className="relative bg-black/20 border border-white/5 rounded-md overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
            >
              <div className={`absolute inset-x-0 top-0 h-24 pointer-events-none ${roleMeta.accentClass}`} />
              <div className="px-6 py-5 border-b border-border bg-background/50 flex items-start justify-between gap-4 relative">
                <div className="space-y-2">
                  <p className="text-[10px] font-medium text-zinc-500">
                    {roleMeta.eyebrow}
                  </p>
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    {label}
                  </h3>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    {roleMeta.description}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div
                    className={`px-3 py-2 rounded-md border text-[10px] font-medium ${roleMeta.badgeClass}`}
                  >
                    {roleMeta.badge}
                  </div>
                  <div className="px-3 py-2 rounded-md border border-zinc-800 bg-[#0e0e0e]/90 text-[10px] font-medium text-zinc-300">
                    v{keyVersion}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">
                      Key Prefix
                    </p>
                    <code className="text-sm text-white">
                      {summary?.prefix || revealed?.prefix || "Unavailable"}
                    </code>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      Visible identifier only.
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">
                      Last Rotated
                    </p>
                    <p className="text-sm text-white">
                      {formatRotationTimestamp(createdAt, keyVersion)}
                    </p>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      {keyVersion > 1
                        ? `Version v${keyVersion} is active now.`
                        : `Initial issue ${formatTimestamp(createdAt)}.`}
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">
                      Last Used
                    </p>
                    <p className="text-sm text-white">
                      {formatTimestamp(
                        summary?.last_used_at || revealed?.last_used_at,
                      )}
                    </p>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      Updated after authenticated traffic.
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4 sm:col-span-3">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">
                      {roleMeta.valueLabel}
                    </p>
                    <div className="flex items-center justify-between gap-4">
                      <code
                        data-testid={`essential-key-secret-${role}`}
                        className="text-xs text-white break-all"
                      >
                        {revealed?.key || roleMeta.valuePlaceholder}
                      </code>
                      <button
                        onClick={() => {
                          if (revealed?.key) {
                            setRevealedByRole((current) => ({
                              ...current,
                              [role]: undefined,
                            }));
                            return;
                          }
                          void revealKey(role);
                        }}
                        disabled={isBusy}
                        data-testid={`essential-key-reveal-${role}`}
                        className={`px-4 py-2 rounded-md border text-[10px] font-medium transition-all flex items-center gap-2 disabled:opacity-60 ${roleMeta.actionClass}`}
                      >
                        {isBusy && loadingRole === role ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : revealed?.key ? (
                          <EyeOff size={12} />
                        ) : (
                          <Eye size={12} />
                        )}
                        {revealed?.key ? "Hide" : "Reveal"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`rounded-md border px-4 py-4 ${roleMeta.noteClass}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md border border-white/10 bg-black/20 flex items-center justify-center shrink-0">
                      {role === "service_role" ? (
                        <AlertTriangle size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium">
                        {roleMeta.warningTitle}
                      </p>
                      <p className="text-[11px] leading-relaxed opacity-80">
                        {roleMeta.warningBody}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() =>
                      void copyValue(revealed?.key, `${role}-secret`)
                    }
                    disabled={!revealed?.key}
                    data-testid={`essential-key-copy-${role}`}
                    className={`px-4 py-2 rounded-md border text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${roleMeta.actionClass}`}
                  >
                    {copiedKey === `${role}-secret` ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedKey === `${role}-secret` ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => {
                      if (!ensureVerified()) {
                        return;
                      }
                      setPendingRotateRole(role);
                    }}
                    disabled={isBusy}
                    data-testid={`essential-key-rotate-${role}`}
                    className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2 disabled:opacity-60"
                  >
                    {rotatingRole === role ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Rotate
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-background/50 border border-border rounded-md overflow-hidden shadow-2xl">
        <div className="px-6 py-5 border-b border-border bg-background/50 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium text-zinc-500 mb-2">
              AI + Automation
            </p>
            <h3 className="text-lg font-bold text-white tracking-tight">
              MCP Gateway
            </h3>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Native MCP tools are exposed by the backend. Use the active
              secret key to let an AI client inspect collections, create schema
              and run deterministic NLQ operations.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-medium">
            {mcpLoading ? (
              <span className="text-zinc-500 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading
              </span>
            ) : (
              <span className="text-primary flex items-center gap-2">
                <TerminalSquare size={12} />{" "}
                {mcpStatus
                  ? `${mcpStatus.runtime} / ${mcpStatus.count} tools`
                  : "Unavailable"}
              </span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-md border border-amber-500/25 bg-linear-to-r from-amber-500/12 via-[#17110a] to-[#0f0f0f] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-md border border-amber-500/20 bg-black/20 text-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-amber-300">
                  Secret key only
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  This is a security boundary, not a broken state. MCP access
                  is limited to trusted AI agents, editors, and server-side
                  automation because the gateway can operate with backend
                  privileges. Keep it out of browser bundles and public
                  repositories.
                </p>
              </div>
            </div>
          </div>
          {!serviceRoleMCP ? (
            <div className="rounded-md border border-dashed border-[#343434] bg-[#101010] px-5 py-6 text-sm text-zinc-500">
              Reveal the active secret key to generate copyable MCP commands
              and production-ready invoke snippets.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5">
                  <p className="text-[10px] font-medium text-zinc-500 mb-2">
                    VS Code MCP Server
                  </p>
                  <code className="text-xs text-white break-all">
                    {serviceRoleMCP.server_url || serviceRoleMCP.invoke_url}
                  </code>
                  <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                    Use this remote HTTP endpoint in VS Code MCP settings with
                    the secret key in the <code>apikey</code> header.
                  </p>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.server_url || serviceRoleMCP.invoke_url,
                        "mcp-server-url",
                      )
                    }
                    className="mt-4 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                  >
                    {copiedKey === "mcp-server-url" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy URL
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5">
                  <p className="text-[10px] font-medium text-zinc-500 mb-2">
                    Tools Endpoint
                  </p>
                  <code className="text-xs text-white break-all">
                    {serviceRoleMCP.tools_url}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(serviceRoleMCP.tools_url, "mcp-tools")
                    }
                    className="mt-4 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                  >
                    {copiedKey === "mcp-tools" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy URL
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5">
                  <p className="text-[10px] font-medium text-zinc-500 mb-2">
                    Invoke Endpoint
                  </p>
                  <code className="text-xs text-white break-all">
                    {serviceRoleMCP.invoke_url}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(serviceRoleMCP.invoke_url, "mcp-invoke")
                    }
                    className="mt-4 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                  >
                    {copiedKey === "mcp-invoke" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy URL
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5 space-y-3 xl:col-span-2">
                  <p className="text-[10px] font-medium text-zinc-500">
                    Select your editor and copy the exact MCP schema.
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    <TerminalSquare size={12} />
                    STDIO module
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mcpEditorOptions.map((editor) => (
                      <button
                        key={editor.id}
                        type="button"
                        onClick={() => setMCPEditorTab(editor.id)}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all ${
                          mcpEditorTab === editor.id
                            ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_rgba(254,254,0,0.12)]"
                            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        <img
                          src={editor.logo}
                          alt={`${editor.label} logo`}
                          className="h-4 w-4 rounded-sm object-cover"
                        />
                        <span>{editor.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-medium text-zinc-500">
                        {selectedMCPEditor.label} (root:{" "}
                        <code>{selectedMCPEditor.rootKey}</code>)
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {selectedMCPEditor.description}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        void copyValue(
                          selectedMCPEditor.config,
                          selectedMCPEditor.copyKey,
                        )
                      }
                      className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                    >
                      {copiedKey === selectedMCPEditor.copyKey ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                      Copy {selectedMCPEditor.rootKey}
                    </button>
                  </div>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {selectedMCPEditor.config}
                  </code>
                </div>
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5 space-y-3">
                  <p className="text-[10px] font-medium text-zinc-500">
                    JSON-RPC Discovery
                  </p>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {serviceRoleMCP.sample_server || serviceRoleMCP.sample_tools}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.sample_server || serviceRoleMCP.sample_tools,
                        "mcp-sample-server",
                      )
                    }
                    className="px-4 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2"
                  >
                    {copiedKey === "mcp-sample-server" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy Command
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5 space-y-3">
                  <p className="text-[10px] font-medium text-zinc-500">
                    Discovery Command
                  </p>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {serviceRoleMCP.sample_tools}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.sample_tools,
                        "mcp-sample-tools",
                      )
                    }
                    className="px-4 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2"
                  >
                    {copiedKey === "mcp-sample-tools" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy Command
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-border rounded-md p-5 space-y-3">
                  <p className="text-[10px] font-medium text-zinc-500">
                    Invoke Command
                  </p>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {serviceRoleMCP.sample_invoke}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.sample_invoke,
                        "mcp-sample-invoke",
                      )
                    }
                    className="px-4 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2"
                  >
                    {copiedKey === "mcp-sample-invoke" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy Command
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-background/50 border border-border rounded-md overflow-hidden shadow-2xl">
        <div className="px-6 py-5 border-b border-border bg-background/50 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium text-zinc-500 mb-2">
              Human-in-the-loop
            </p>
            <h3 className="text-lg font-bold text-white tracking-tight">
              MCP Approval Chamber
            </h3>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Pending guardrail requests are queued here. Approve to execute the
              MCP tool now, or reject to keep the operation blocked.
            </p>
          </div>
          <button
            onClick={() => void loadPendingApprovals()}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-[10px] font-medium text-zinc-400 hover:text-white transition-all flex items-center gap-2"
          >
            {approvalsLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh Queue
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/8 px-5 py-4 space-y-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-cyan-300">
              Approval Flow, Simplified
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div className="rounded-md border border-cyan-500/20 bg-black/20 px-3 py-3 text-zinc-200">
                <p className="font-medium text-cyan-200">1) Agent level</p>
                <p className="mt-1 text-zinc-300">
                  `restringido` allows read only. `medio` requires approval for writes. `libre` executes writes directly.
                </p>
              </div>
              <div className="rounded-md border border-cyan-500/20 bg-black/20 px-3 py-3 text-zinc-200">
                <p className="font-medium text-cyan-200">2) Pending approval</p>
                <p className="mt-1 text-zinc-300">
                  Write actions move here and wait for human review.
                </p>
              </div>
              <div className="rounded-md border border-cyan-500/20 bg-black/20 px-3 py-3 text-zinc-200">
                <p className="font-medium text-cyan-200">3) Approve + Execute</p>
                <p className="mt-1 text-zinc-300">
                  Approval executes immediately. Reject keeps the action blocked.
                </p>
              </div>
            </div>
          </div>

          {approvalsLoading && pendingApprovals.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#343434] bg-[#101010] px-5 py-6 text-sm text-zinc-500 flex items-center gap-3">
              <Loader2 size={14} className="animate-spin" />
              Loading pending approvals...
            </div>
          ) : pendingApprovals.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#343434] bg-[#101010] px-5 py-6 text-sm text-zinc-500">
              Queue is clear. No MCP actions are waiting for approval.
            </div>
          ) : (
            pendingApprovals.map((item) => {
              const argsPreview = JSON.stringify(item.arguments || {}, null, 2);
              const typeHints = buildTypeHints(item);
              const unsupportedHints = typeHints.filter((hint) => !hint.supported);
              const reasonText = formatApprovalReason(item);
              const needsLevelUpgrade =
                String(item.token_security_level || "").toLowerCase() === "restringido";
              const risk = (item.tool_risk || "read").toLowerCase();
              const riskClass =
                risk === "dangerous"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                  : risk === "safe_write"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-sky-500/25 bg-sky-500/10 text-sky-200";

              return (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-[#0f0f0f] p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-zinc-500">
                        Request {item.id}
                      </p>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {item.tool}
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        Queued at {formatTimestamp(item.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium">
                      <span className={`px-3 py-1 rounded-md border ${riskClass}`}>
                        {risk}
                      </span>
                      <span className="px-3 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300">
                        level: {item.token_security_level}
                      </span>
                      <span className="px-3 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300">
                        {item.status}
                      </span>
                    </div>
                  </div>

                  {item.reason ? (
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
                      {reasonText}
                    </div>
                  ) : null}

                  {needsLevelUpgrade ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      Current level is <strong>restringido</strong> (read-only). For schema writes, switch this MCP agent to <strong>medio</strong> (approval) or <strong>libre</strong> (direct).
                    </div>
                  ) : null}

                  {typeHints.length > 0 ? (
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3 space-y-2">
                      <p className="text-[10px] font-medium text-zinc-500">Schema Type Check</p>
                      <div className="flex flex-wrap gap-2">
                        {typeHints.map((hint) => {
                          const hasAliasRewrite = hint.raw.toLowerCase() !== hint.normalized;
                          const cls = hint.supported
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-rose-500/30 bg-rose-500/10 text-rose-200";
                          return (
                            <span
                              key={`${item.id}-${hint.raw}`}
                              className={`px-2.5 py-1 rounded-md border text-[10px] font-medium ${cls}`}
                            >
                              {hasAliasRewrite
                                ? `${hint.raw} -> ${hint.normalized}`
                                : hint.raw}
                            </span>
                          );
                        })}
                      </div>
                      {unsupportedHints.length > 0 ? (
                        <p className="text-[11px] text-rose-200">
                          One or more types are not supported by OzyBase schema mapping. Replace them before approving.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">
                      Arguments
                    </p>
                    <code className="block text-[11px] text-zinc-200 whitespace-pre-wrap break-all leading-relaxed">
                      {argsPreview}
                    </code>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => void resolvePendingApproval(item.id, "approve")}
                      disabled={approvalsActioningID === item.id}
                      className="px-4 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2 disabled:opacity-60"
                    >
                      {approvalsActioningID === item.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={12} />
                      )}
                      Approve + Execute
                    </button>
                    <button
                      onClick={() => void resolvePendingApproval(item.id, "reject")}
                      disabled={approvalsActioningID === item.id}
                      className="px-4 py-2 rounded-md border border-rose-500/30 bg-rose-500/12 text-rose-100 text-[10px] font-medium flex items-center gap-2 disabled:opacity-60"
                    >
                      {approvalsActioningID === item.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <XCircle size={12} />
                      )}
                      Reject
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <div className="rounded-md border border-zinc-800 bg-[#101010] px-5 py-4 space-y-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Supported MCP Schema Types
            </p>
            <div className="flex flex-wrap gap-2">
              {MCP_SUPPORTED_TYPES.map((typeName) => (
                <span
                  key={typeName}
                  className="px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 text-[10px] font-medium"
                >
                  {typeName}
                </span>
              ))}
            </div>
            <div className="text-[11px] text-zinc-400 space-y-1">
              <p>Common aliases auto-normalized in UI: bigint -&gt; int8, integer -&gt; int4, smallint -&gt; int2, timestamp with time zone -&gt; timestamptz.</p>
              <p>For array fields, use text_array or int_array.</p>
            </div>
          </div>
        </div>
      </div>

      {showVerifyModal && (
        <div
          className="fixed inset-0 z-220 flex items-center justify-center p-4"
          onClick={(event) =>
            event.target === event.currentTarget && setShowVerifyModal(false)
          }
        >
          <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
          <div className="ozy-dialog-panel w-full max-w-md relative">
            <div className="px-6 py-5 border-b border-border bg-background/90 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                  <LockKeyhole size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-primary">
                    Quick Admin Check
                  </p>
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                    Confirm current password
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowVerifyModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleVerify} className="p-6 space-y-5">
              <p className="text-sm text-zinc-400 leading-relaxed">
                The dashboard only reveals or rotates the essential project keys
                after a short admin re-verification window.
              </p>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-zinc-500">
                  Admin Password
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  data-testid="verify-admin-password"
                  placeholder="Re-enter the current admin password"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40"
                />
              </div>
              <div className="rounded-md border border-border bg-background/80 px-4 py-4 text-[11px] text-zinc-500 leading-relaxed">
                Successful verification unlocks reveal and rotation for a short
                window without exposing the publishable or secret key by
                default.
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(false)}
                  className="px-4 py-2 text-[10px] font-medium text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifying}
                  data-testid="verify-admin-submit"
                  className="px-5 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2 disabled:opacity-60"
                >
                  {verifying ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  {verifying ? "Verifying" : "Unlock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={pendingRotateRole !== null}
        onClose={() => setPendingRotateRole(null)}
        onConfirm={() =>
          pendingRotateRole ? rotateKey(pendingRotateRole) : Promise.resolve()
        }
        title={
          pendingRotateRole
            ? ROLE_PRESENTATION[pendingRotateRole].rotateTitle
            : "Rotate Key"
        }
        message={
          pendingRotateRole
            ? ROLE_PRESENTATION[pendingRotateRole].rotateMessage
            : "This will issue a fresh project key and immediately disable the previous one."
        }
        confirmText={rotatingRole ? "Rotating" : "Rotate Now"}
        type="danger"
        closeOnConfirm={false}
      />

      {toast && (
        <BrandedToast
          message={toast.message}
          tone={toast.tone}
          title={toast.title}
          onClose={() => setToast(null)}
          position="bottom-right"
          durationMs={3200}
        />
      )}
    </div>
  );
};

export default EssentialApiKeysPanel;


