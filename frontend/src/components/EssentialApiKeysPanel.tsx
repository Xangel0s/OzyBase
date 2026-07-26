import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  X,
} from "lucide-react";
import { fetchWithAuth, readJsonIfOk } from "../utils/api";
import ConfirmModal from "./ConfirmModal";
import { BrandedToast, type BrandedToastTone } from "./OverlayPrimitives";

type EssentialRole = "anon" | "service_role";

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
}

interface ToastState {
  message: string;
  tone: BrandedToastTone;
  title?: string;
}

const KEY_ORDER: EssentialRole[] = ["anon", "service_role"];

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
      "Use this key only in trusted servers and internal automation. Never embed it in browsers, mobile bundles or public repositories.",
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
      "This secret unlocks automation and admin-grade workloads. Keep it on servers only. Rotation immediately cuts off existing secret-key traffic until consumers deploy the new secret.",
    rotateTitle: "Rotate Secret Key",
    rotateMessage:
      "This will issue a fresh secret key and the previous secret will stop working immediately for server workloads.",
  },
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatRotationTimestamp = (value?: string | null, version?: number) => {
  if (!value) return "Unknown";
  if ((version || 1) <= 1) return "Not rotated yet";
  return formatTimestamp(value);
};

const EssentialApiKeysPanel: React.FC = () => {
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysByRole, setKeysByRole] = useState<Record<EssentialRole, EssentialKeySummary | null>>({
    anon: null,
    service_role: null,
  });
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [revealedByRole, setRevealedByRole] = useState<Partial<Record<EssentialRole, RevealedKeyPayload>>>({});
  const [loadingRole, setLoadingRole] = useState<EssentialRole | null>(null);
  const [rotatingRole, setRotatingRole] = useState<EssentialRole | null>(null);
  const [pendingRotateRole, setPendingRotateRole] = useState<EssentialRole | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const isVerified = Boolean(
    verificationToken && verifiedUntil && new Date(verifiedUntil).getTime() > Date.now(),
  );

  const setFeedback = (message: string, tone: BrandedToastTone, title?: string) => {
    setToast({ message, tone, title });
    window.setTimeout(() => setToast(null), 3200);
  };

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/keys/essential");
      const payload = await readJsonIfOk<EssentialKeysResponse>(res);
      if (!payload) throw new Error("Failed to load essential API keys");
      const next: Record<EssentialRole, EssentialKeySummary | null> = { anon: null, service_role: null };
      for (const item of Array.isArray(payload.keys) ? payload.keys : []) {
        next[item.role] = item;
      }
      setKeysByRole(next);
    } catch (error) {
      console.error("Failed to load essential API keys:", error);
      setKeysByRole({ anon: null, service_role: null });
      setFeedback("The dashboard could not load the essential project keys.", "error", "API Keys");
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, []);

  const ensureVerified = () => {
    if (isVerified) return true;
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
      const payload = await readJsonIfOk<{ error?: string; verification_token?: string; verified_until?: string }>(res);
      const nextPayload = payload ?? {};
      if (!res.ok || !nextPayload.verification_token) {
        setFeedback(nextPayload.error || "The current admin password was rejected.", "error", "Verification");
        return;
      }
      setVerificationToken(nextPayload.verification_token);
      setVerifiedUntil(nextPayload.verified_until || null);
      setAdminPassword("");
      setShowVerifyModal(false);
      setFeedback("Admin verification confirmed. You can reveal or rotate the essential keys now.", "success", "Verification");
    } catch (error) {
      console.error("Failed to verify admin password:", error);
      setFeedback("The dashboard could not verify the admin password.", "error", "Verification");
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) return;
    setLoadingRole(role);
    try {
      const res = await fetchWithAuth(`/api/project/keys/essential/${role}/reveal`, {
        method: "POST",
        onUnauthorized: "passthrough",
        body: JSON.stringify({ verification_token: verificationToken }),
      });
      const payload = await readJsonIfOk<RevealedKeyPayload & { error?: string }>(res);
      if (!res.ok || !payload?.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(payload?.error || "The key could not be revealed.", "error", "API Keys");
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
    } catch (error) {
      console.error("Failed to reveal essential API key:", error);
      setFeedback("The key could not be revealed right now.", "error", "API Keys");
    } finally {
      setLoadingRole(null);
    }
  };

  const rotateKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) return;
    setRotatingRole(role);
    try {
      const res = await fetchWithAuth(`/api/project/keys/essential/${role}/rotate`, {
        method: "POST",
        onUnauthorized: "passthrough",
        body: JSON.stringify({ verification_token: verificationToken, reason: "dashboard_rotation" }),
      });
      const payload = await readJsonIfOk<RevealedKeyPayload & { error?: string }>(res);
      if (!res.ok || !payload?.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(payload?.error || "The key rotation failed.", "error", "Rotation");
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
      await loadKeys();
      setFeedback(payload.warning || "The essential key rotated successfully.", "success", "Rotation");
    } catch (error) {
      console.error("Failed to rotate essential API key:", error);
      setFeedback("The key rotation failed.", "error", "Rotation");
    } finally {
      setPendingRotateRole(null);
      setRotatingRole(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <div className="bg-black/20 border border-white/5 rounded-md p-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)] relative overflow-hidden transition-all hover:border-white/10 group">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between relative z-10">
          <div className="flex items-start gap-6">
            <div className="w-14 h-14 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
              <ShieldCheck size={24} />
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary italic">Verified reveal flow</p>
              <h3 className="text-lg font-bold text-white tracking-tight italic">Essential key vault</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed max-w-2xl">
                Manual key creation was retired. Reveal and rotate only the current publishable and secret keys after confirming the current admin password.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void loadKeys()}
              className="px-5 py-2.5 bg-black/40 border border-white/10 rounded-md text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-all flex items-center gap-2"
            >
              {keysLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
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
          <span className="font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Session</span>
          <span>{isVerified ? `Unlocked until ${formatTimestamp(verifiedUntil)}` : "Locked until the current admin password is confirmed."}</span>
          <span className="text-zinc-600">Current session tokens are not project keys and never replace the publishable or secret key.</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {KEY_ORDER.map((role) => {
          const summary = keysByRole[role];
          const revealed = revealedByRole[role];
          const roleMeta = ROLE_PRESENTATION[role];
          const label = roleMeta.label || summary?.label || FALLBACK_LABELS[role];
          const isBusy = loadingRole === role || rotatingRole === role;
          const keyVersion = summary?.key_version || revealed?.key_version || 1;
          const createdAt = summary?.created_at || revealed?.created_at;

          return (
            <div key={role} data-testid={`essential-key-card-${role}`} className="relative bg-black/20 border border-white/5 rounded-md overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.6)]">
              <div className={`absolute inset-x-0 top-0 h-24 pointer-events-none ${roleMeta.accentClass}`} />
              <div className="px-6 py-5 border-b border-border bg-background/50 flex items-start justify-between gap-4 relative">
                <div className="space-y-2">
                  <p className="text-[10px] font-medium text-zinc-500">{roleMeta.eyebrow}</p>
                  <h3 className="text-lg font-bold text-white tracking-tight">{label}</h3>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">{roleMeta.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className={`px-3 py-2 rounded-md border text-[10px] font-medium ${roleMeta.badgeClass}`}>{roleMeta.badge}</div>
                  <div className="px-3 py-2 rounded-md border border-zinc-800 bg-[#0e0e0e]/90 text-[10px] font-medium text-zinc-300">v{keyVersion}</div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">Key Prefix</p>
                    <code className="text-sm text-white">{summary?.prefix || revealed?.prefix || "Unavailable"}</code>
                    <p className="mt-2 text-[10px] text-zinc-500">Visible identifier only.</p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">Last Rotated</p>
                    <p className="text-sm text-white">{formatRotationTimestamp(createdAt, keyVersion)}</p>
                    <p className="mt-2 text-[10px] text-zinc-500">{keyVersion > 1 ? `Version v${keyVersion} is active now.` : `Initial issue ${formatTimestamp(createdAt)}.`}</p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">Last Used</p>
                    <p className="text-sm text-white">{formatTimestamp(summary?.last_used_at || revealed?.last_used_at)}</p>
                    <p className="mt-2 text-[10px] text-zinc-500">Updated after authenticated traffic.</p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border rounded-md p-4 sm:col-span-3">
                    <p className="text-[10px] font-medium text-zinc-500 mb-2">{roleMeta.valueLabel}</p>
                    <div className="flex items-center justify-between gap-4">
                      <code data-testid={`essential-key-secret-${role}`} className="text-xs text-white break-all">
                        {revealed?.key || (role === "anon" && summary?.copy_value ? summary.copy_value : roleMeta.valuePlaceholder)}
                      </code>
                      <button
                        onClick={() => {
                          if (revealed?.key) {
                            setRevealedByRole((current) => ({ ...current, [role]: undefined }));
                            return;
                          }
                          void revealKey(role);
                        }}
                        disabled={isBusy}
                        data-testid={`essential-key-reveal-${role}`}
                        className={`px-4 py-2 rounded-md border text-[10px] font-medium transition-all flex items-center gap-2 disabled:opacity-60 ${roleMeta.actionClass}`}
                      >
                        {isBusy && loadingRole === role ? <Loader2 size={12} className="animate-spin" /> : revealed?.key ? <EyeOff size={12} /> : <Eye size={12} />}
                        {revealed?.key ? "Hide" : "Reveal"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`rounded-md border px-4 py-4 ${roleMeta.noteClass}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md border border-white/10 bg-black/20 flex items-center justify-center shrink-0">
                      {role === "service_role" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium">{roleMeta.warningTitle}</p>
                      <p className="text-[11px] leading-relaxed opacity-80">{roleMeta.warningBody}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const activeKeyVal = revealed?.key || (role === "anon" && summary?.copy_value ? summary.copy_value : undefined);
                    return (
                      <button
                        onClick={() => void copyValue(activeKeyVal, `${role}-secret`)}
                        disabled={!activeKeyVal}
                        data-testid={`essential-key-copy-${role}`}
                        className={`px-4 py-2 rounded-md border text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${roleMeta.actionClass}`}
                      >
                        {copiedKey === `${role}-secret` ? <Check size={12} /> : <Copy size={12} />}
                        {copiedKey === `${role}-secret` ? "Copied" : "Copy"}
                      </button>
                    );
                  })()}
                  <button
                    onClick={() => {
                      if (!ensureVerified()) return;
                      setPendingRotateRole(role);
                    }}
                    disabled={isBusy}
                    data-testid={`essential-key-rotate-${role}`}
                    className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 hover:text-white transition-all flex items-center gap-2 disabled:opacity-60"
                  >
                    {rotatingRole === role ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Rotate
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showVerifyModal && (
        <div className="fixed inset-0 z-220 flex items-center justify-center p-4" onClick={(event) => event.target === event.currentTarget && setShowVerifyModal(false)}>
          <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
          <div className="ozy-dialog-panel w-full max-w-md relative">
            <div className="px-6 py-5 border-b border-border bg-background/90 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                  <LockKeyhole size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-primary">Quick Admin Check</p>
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest">Confirm current password</h3>
                </div>
              </div>
              <button onClick={() => setShowVerifyModal(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleVerify} className="p-6 space-y-5">
              <p className="text-sm text-zinc-400 leading-relaxed">
                The dashboard only reveals or rotates the essential project keys after a short admin re-verification window.
              </p>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-zinc-500">Admin Password</label>
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
                Successful verification unlocks reveal and rotation for a short window without exposing the publishable or secret key by default.
              </div>
              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={() => setShowVerifyModal(false)} className="px-4 py-2 text-[10px] font-medium text-zinc-500 hover:text-zinc-200 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={verifying} data-testid="verify-admin-submit" className="px-5 py-2 rounded-md bg-primary text-black text-[10px] font-medium flex items-center gap-2 disabled:opacity-60">
                  {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
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
        onConfirm={() => (pendingRotateRole ? rotateKey(pendingRotateRole) : Promise.resolve())}
        title={pendingRotateRole ? ROLE_PRESENTATION[pendingRotateRole].rotateTitle : "Rotate Key"}
        message={pendingRotateRole ? ROLE_PRESENTATION[pendingRotateRole].rotateMessage : "This will issue a fresh project key and immediately disable the previous one."}
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
