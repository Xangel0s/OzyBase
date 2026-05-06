import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  Globe,
  Hash,
  Key,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { fetchConnectionMetadata, revealProjectKey, verifyAdminIdentity, type ConnectionSummary } from '../services/connectionService';
import ConfirmModal from './ConfirmModal';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspaceId?: string | null;
}

type EssentialRole = 'anon' | 'service_role';

interface EssentialKeySummary {
  prefix: string;
}

interface RevealedKeyPayload {
  key: string;
  prefix: string;
  warning?: string;
}

const ROLE_LABELS: Record<EssentialRole, { title: string; badge: string; note: string }> = {
  anon: {
    title: 'Anon / Publishable',
    badge: 'Client safe',
    note: 'Use this in browser and public SDKs under RLS.',
  },
  service_role: {
    title: 'Private / Secret',
    badge: 'Server only',
    note: 'Use this only in trusted backends and admin automation.',
  },
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const formatMaskedValue = (value?: string | null) => {
  const clean = String(value || '').trim();
  if (!clean) return 'Locked until verification';
  return `${clean}••••••••••••••••`;
};

const ConnectionModal: React.FC<ConnectionModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'connection' | 'api' | 'access'>('connection');
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [keysByRole, setKeysByRole] = useState<Record<EssentialRole, EssentialKeySummary | null>>({
    anon: { prefix: '' },
    service_role: { prefix: '' },
  });
  const [revealedByRole, setRevealedByRole] = useState<Partial<Record<EssentialRole, RevealedKeyPayload>>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState<EssentialRole | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [rotatingRole, setRotatingRole] = useState<EssentialRole | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [pendingRotateRole, setPendingRotateRole] = useState<EssentialRole | null>(null);

  const isVerified = Boolean(verifiedUntil && new Date(verifiedUntil).getTime() > Date.now());

  const loadMetadata = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchConnectionMetadata();
      setConnection(data);
      setKeysByRole({
        anon: { prefix: data.anon_key_prefix || '' },
        service_role: { prefix: data.service_role_key_prefix || '' },
      });
      setVerifiedUntil(data.last_verified_at || null);
    } catch (error: any) {
      console.error('Failed to load connection metadata:', error);
      setMessage({ tone: 'error', text: error.message || 'Failed to load connection metadata.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('connection');
    setRevealedByRole({});
    void loadMetadata();
  }, [isOpen]);

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const handleVerifyIdentity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminPassword || verifying) return;
    setVerifying(true);
    setMessage(null);
    try {
      const data = await verifyAdminIdentity(adminPassword);
      setVerifiedUntil(data.verified_until);
      setVerificationToken(data.verification_token || null);
      setAdminPassword('');
      setMessage({ tone: 'success', text: 'Admin verification confirmed.' });
      setActiveTab('api');
    } catch (error: any) {
      console.error('Failed to verify admin password:', error);
      setMessage({ tone: 'error', text: error.message || 'The current admin password was rejected.' });
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!isVerified) {
      setActiveTab('access');
      setMessage({ tone: 'error', text: 'Verify the admin password first.' });
      return;
    }
    setLoadingRole(role);
    try {
      const data = await revealProjectKey(role, verificationToken);
      setRevealedByRole((current) => ({ ...current, [role]: data }));
    } catch (error: any) {
      console.error('Failed to reveal project key:', error);
      setMessage({ tone: 'error', text: error.message || 'The key could not be revealed right now.' });
    } finally {
      setLoadingRole(null);
    }
  };

  const rotateKey = async (role: EssentialRole) => {
    if (!isVerified || !verificationToken) {
      setActiveTab('access');
      setMessage({ tone: 'error', text: 'Verify the admin password first.' });
      return;
    }
    setRotatingRole(role);
    try {
      const res = await fetchWithAuth(`/api/project/keys/essential/${role}/rotate`, {
        method: 'POST',
        body: JSON.stringify({ verification_token: verificationToken, reason: 'modal_rotation' }),
      });
      const payload = await res.json().catch(() => null) as (RevealedKeyPayload & { error?: string }) | null;
      if (!res.ok || !payload?.key) {
        throw new Error(payload?.error || 'The key rotation failed.');
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
      await loadMetadata();
      setMessage({ tone: 'success', text: payload.warning || 'The essential key rotated successfully.' });
    } catch (error: any) {
      console.error('Failed to rotate project key:', error);
      setMessage({ tone: 'error', text: error.message || 'The key rotation failed.' });
    } finally {
      setPendingRotateRole(null);
      setRotatingRole(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-5xl rounded-lg border border-zinc-800 bg-[#09090b] shadow-2xl overflow-hidden">
        <div className="border-b border-zinc-800 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">Connection Center</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Project connection and API keys</h1>
            <p className="mt-2 text-sm text-zinc-500">View connection details, verify access, reveal keys, and rotate secrets.</p>
          </div>
          <button onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-2 text-zinc-400 hover:text-white hover:bg-zinc-900">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-zinc-800 px-6 py-3 flex flex-wrap gap-2">
          {[
            { id: 'connection', label: 'Connection' },
            { id: 'api', label: 'API Keys' },
            { id: 'access', label: 'Access' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`rounded-md border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
          {message ? (
            <div className={`rounded-md border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-red-500/20 bg-red-500/10 text-red-200'}`}>
              {message.text}
            </div>
          ) : null}

          {activeTab === 'connection' ? (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/20 bg-primary/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">Recommended setup</p>
                    <h2 className="mt-2 text-lg font-semibold text-white">One-time project connection</h2>
                    <p className="mt-2 text-sm text-zinc-400">Run the npm bootstrap in your project terminal, confirm in the browser, and keep the MCP wired locally for every IDE.</p>
                  </div>
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-200">
                    {connection?.last_verified_at ? 'Connected' : 'Not linked yet'}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-4">
                  {[
                    'Run `npx ozybase connect` in the project terminal.',
                    'Review the summary in the browser confirmation.',
                    'Approve once and persist the local project link.',
                    'Let the IDE use the local MCP stdio endpoint.',
                  ].map((step, index) => (
                    <div key={step} className="rounded-md border border-zinc-800 bg-black/30 p-4">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] text-white">{index + 1}</span>
                        <ArrowRight size={12} />
                      </div>
                      <p className="mt-3 text-sm text-zinc-200 leading-relaxed">{step}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest">
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">Terminal first</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">Browser approval</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">Local state persisted</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">MCP by stdio</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard icon={<Database size={16} />} label="Database" value={connection?.connection?.database || 'Not loaded'} />
                <StatCard icon={<Server size={16} />} label="Host" value={connection?.connection?.host || 'Not loaded'} />
                <StatCard icon={<Globe size={16} />} label="API URL" value={connection?.api_url || 'Not loaded'} />
                <StatCard icon={<Hash size={16} />} label="SSL" value={connection?.connection?.ssl ? 'Enabled' : 'Disabled'} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={<ShieldCheck size={16} />} label="Last verified" value={formatTimestamp(connection?.last_verified_at)} />
                <StatCard icon={<Key size={16} />} label="Edge functions" value={String(connection?.edge_functions_count ?? '0')} />
                <StatCard icon={<Database size={16} />} label="Schemas" value={String(connection?.schemas_count ?? '0')} />
              </div>
              <div className="rounded-md border border-zinc-800 bg-[#0d0d0d] p-5 text-sm text-zinc-400">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className="mt-0.5 text-amber-300" />
                  <p>Connection metadata is read-only here. Use the API Keys and Access tabs for reveal and verification actions.</p>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'api' ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {KEY_ORDER.map((role) => {
                const summary = keysByRole[role];
                const revealed = revealedByRole[role];
                const meta = ROLE_LABELS[role];
                const isBusy = loadingRole === role || rotatingRole === role;

                return (
                  <div key={role} className="rounded-md border border-zinc-800 bg-[#0d0d0d] overflow-hidden">
                    <div className="border-b border-zinc-800 px-5 py-4 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-medium text-zinc-500">{meta.badge}</p>
                        <h3 className="mt-1 text-base font-bold text-white">{meta.title}</h3>
                        <p className="mt-1 text-[11px] text-zinc-500">{meta.note}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-black/40 px-3 py-2 text-[10px] font-medium text-zinc-300">v{revealed?.key ? 'active' : 'locked'}</div>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <InfoPill label="Prefix" value={summary?.prefix || revealed?.prefix || 'Unavailable'} />
                        <InfoPill label="Last used" value={formatTimestamp(undefined)} />
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-black/40 p-4">
                        <p className="text-[10px] font-medium text-zinc-500 mb-2">Current key</p>
                        <div className="flex items-center justify-between gap-4">
                          <code className="text-xs text-white break-all">{revealed?.key || formatMaskedValue(summary?.prefix)}</code>
                          <button
                            onClick={() => {
                              if (revealed?.key) {
                                setRevealedByRole((current) => ({ ...current, [role]: undefined }));
                                return;
                              }
                              void revealKey(role);
                            }}
                            disabled={isBusy}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:text-white disabled:opacity-60 flex items-center gap-2"
                          >
                            {isBusy && loadingRole === role ? <Loader2 size={12} className="animate-spin" /> : revealed?.key ? <EyeOff size={12} /> : <Eye size={12} />}
                            {revealed?.key ? 'Hide' : 'Reveal'}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => void copyValue(revealed?.key, `${role}-secret`)}
                          disabled={!revealed?.key}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:text-white disabled:opacity-40 flex items-center gap-2"
                        >
                          {copiedKey === `${role}-secret` ? <Check size={12} /> : <Copy size={12} />}
                          {copiedKey === `${role}-secret` ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          onClick={() => setPendingRotateRole(role)}
                          disabled={isBusy}
                          className="rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-200 hover:bg-amber-500/15 disabled:opacity-60 flex items-center gap-2"
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
          ) : null}

          {activeTab === 'access' ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-md border border-zinc-800 bg-[#0d0d0d] p-5">
                <div className="flex items-start gap-3">
                  <LockKeyhole size={16} className="mt-0.5 text-primary" />
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Verify admin</h3>
                    <p className="mt-1 text-sm text-zinc-500">Unlock the key actions with the current admin password.</p>
                  </div>
                </div>
                <form onSubmit={handleVerifyIdentity} className="mt-5 space-y-4">
                  <input
                    type="password"
                    required
                    autoFocus
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="Current admin password"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40"
                  />
                  <button
                    type="submit"
                    disabled={verifying}
                    className="rounded-md bg-primary px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-60 flex items-center gap-2"
                  >
                    {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                    {verifying ? 'Verifying' : 'Unlock'}
                  </button>
                </form>
              </div>

              <div className="rounded-md border border-zinc-800 bg-[#0d0d0d] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={16} className="mt-0.5 text-emerald-300" />
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Session</h3>
                    <p className="mt-1 text-sm text-zinc-500">{isVerified ? `Unlocked until ${formatTimestamp(verifiedUntil)}` : 'Locked until verification completes.'}</p>
                  </div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-black/40 px-4 py-3 text-[11px] text-zinc-400 leading-relaxed">
                  Successful verification enables key reveal and rotation for a short window.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmModal
        isOpen={pendingRotateRole !== null}
        onClose={() => setPendingRotateRole(null)}
        onConfirm={() => (pendingRotateRole ? rotateKey(pendingRotateRole) : Promise.resolve())}
        title={pendingRotateRole ? `Rotate ${ROLE_LABELS[pendingRotateRole].title}` : 'Rotate key'}
        message="This will issue a fresh key and immediately invalidate the previous one."
        confirmText={rotatingRole ? 'Rotating' : 'Rotate now'}
        type="danger"
        closeOnConfirm={false}
      />
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-md border border-zinc-800 bg-[#0d0d0d] p-4">
    <div className="flex items-center gap-2 text-zinc-500">
      {icon}
      <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
    </div>
    <p className="mt-3 text-sm text-white break-all">{value}</p>
  </div>
);

const InfoPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md border border-zinc-800 bg-black/40 p-4">
    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</p>
    <p className="mt-2 text-sm text-white break-all">{value}</p>
  </div>
);

export default ConnectionModal;
