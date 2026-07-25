import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
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
  RotateCcw,
  Server,
  ShieldCheck,
  X,
  ChevronRight,
  Terminal,
  MousePointerClick,
  MonitorCheck
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { fetchConnectionMetadata, revealProjectKey, verifyAdminIdentity, type ConnectionSummary } from '../services/connectionService';
import ConfirmModal from './ConfirmModal';

const buildConnectCommand = (apiUrl?: string | null) => {
  const baseUrl = String(apiUrl || '').trim().replace(/\/$/, '');
  return `npx ozybase connect --url ${baseUrl ? `${baseUrl}/api/project/mcp` : 'https://YOUR_DOMAIN/api/project/mcp'}`;
};

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

const KEY_ORDER: EssentialRole[] = ['anon', 'service_role'];

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
  const [activeTab, setActiveTab] = useState<'connection' | 'api'>('connection');
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
  const connectCommand = buildConnectCommand(connection?.api_url);

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
      setMessage({ tone: 'success', text: 'Admin verification confirmed. You now have temporary access to API keys.' });
    } catch (error: any) {
      console.error('Failed to verify admin password:', error);
      setMessage({ tone: 'error', text: error.message || 'The current admin password was rejected.' });
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!isVerified) {
      setMessage({ tone: 'error', text: 'Please unlock access with your admin password first.' });
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
      setMessage({ tone: 'error', text: 'Please unlock access with your admin password first.' });
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
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4 sm:p-6 backdrop-blur-md bg-black/75 transition-opacity duration-300">
      <div className="w-full max-w-5xl rounded-lg border border-border bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header Area */}
        <div className="border-b border-border bg-zinc-900/60 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-1.5">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse"></span>
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Connection Center</p>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Project connection & API keys</h1>
            <p className="mt-1 text-xs text-zinc-400">Manage your workspace configuration, verify database access, and rotate secrets securely.</p>
          </div>
          <button 
            onClick={onClose} 
            className="rounded-md border border-border bg-zinc-900 p-2 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-5 pb-2 border-b border-border/40 bg-zinc-900/30">
          <div className="inline-flex p-1 rounded-md bg-zinc-900 border border-border">
            {[
              { id: 'connection', label: 'Connection Status', icon: <Server size={14} /> },
              { id: 'api', label: 'API Keys', icon: <Key size={14} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-primary text-black shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {message ? (
            <div className={`mb-5 flex items-start gap-3 rounded-md border px-4 py-3 text-xs ${
              message.tone === 'success' 
                ? 'border-primary/30 bg-primary/10 text-primary' 
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}>
              {message.tone === 'success' ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              <p className="leading-relaxed">{message.text}</p>
            </div>
          ) : null}

          {/* CONNECTION TAB */}
          {activeTab === 'connection' ? (
            <div className="space-y-6">
              
              {/* Setup Flow */}
              <div className="rounded-md border border-border bg-zinc-900/40 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                      <Terminal size={18} className="text-primary" />
                      One-time project connection
                    </h2>
                    <p className="mt-1 text-xs text-zinc-400 max-w-xl">Run the npm bootstrap in your project terminal, confirm in the browser, and keep the MCP wired locally for every IDE.</p>
                  </div>
                  <div className={`rounded-md border px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 ${
                    connection?.last_verified_at 
                      ? 'border-primary/30 bg-primary/10 text-primary' 
                      : 'border-border bg-zinc-900 text-zinc-400'
                  }`}>
                    {connection?.last_verified_at ? <><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span></span> Connected</> : 'Not linked yet'}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { title: 'Run local command', desc: 'npx ozybase connect', icon: <Terminal size={16} />, badge: 'Terminal' },
                    { title: 'Browser approval', desc: 'Review connection summary', icon: <MousePointerClick size={16} />, badge: 'Browser' },
                    { title: 'Persist state', desc: 'Save project link locally', icon: <Database size={16} />, badge: 'Local' },
                    { title: 'MCP Ready', desc: 'IDE uses local stdio', icon: <MonitorCheck size={16} />, badge: 'Stdio' },
                  ].map((step, index, arr) => (
                    <div key={index} className="relative">
                      <div className="h-full rounded-md border border-border bg-zinc-900/80 p-4 transition-all hover:border-zinc-500">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-black/30 text-primary">
                            {step.icon}
                          </div>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Step {index + 1}</span>
                        </div>
                        <h3 className="text-xs font-bold text-white mb-1">{step.title}</h3>
                        <p className="text-[11px] text-zinc-400 font-mono">{step.desc}</p>
                        <div className="mt-3">
                          <span className="inline-block rounded-md border border-border bg-black/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">{step.badge}</span>
                        </div>
                      </div>
                      {index < arr.length - 1 && (
                        <div className="hidden lg:block absolute top-1/2 -right-2.5 -translate-y-1/2 z-20 text-zinc-600">
                          <ChevronRight size={16} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-md border border-border bg-zinc-950 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Copy command</p>
                      <p className="mt-0.5 text-xs text-zinc-400">Paste this in your project terminal to start the guided connection flow.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyValue(connectCommand, 'connect-command')}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-bold text-black transition-all hover:bg-primary/90 shrink-0"
                    >
                      {copied === 'connect-command' ? <Check size={14} /> : <Copy size={14} />}
                      {copied === 'connect-command' ? 'Copied' : 'Copy Command'}
                    </button>
                  </div>
                  <code className="mt-3 block rounded-md border border-border bg-black px-4 py-3 text-xs font-mono text-primary break-all">
                    {connectCommand}
                  </code>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <StatCard icon={<Database size={15} />} label="Database" value={connection?.connection?.database || 'Not loaded'} />
                <StatCard icon={<Server size={15} />} label="Host" value={connection?.connection?.host || 'Not loaded'} />
                <StatCard icon={<Globe size={15} />} label="API URL" value={connection?.api_url || 'Not loaded'} />
                <StatCard icon={<Hash size={15} />} label="SSL Status" value={connection?.connection?.ssl ? 'Enabled' : 'Disabled'} isActive={connection?.connection?.ssl} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatCard icon={<ShieldCheck size={15} />} label="Last verified" value={formatTimestamp(connection?.last_verified_at)} highlight />
                <StatCard icon={<Key size={15} />} label="Edge functions" value={String(connection?.edge_functions_count ?? '0')} />
                <StatCard icon={<Database size={15} />} label="Schemas" value={String(connection?.schemas_count ?? '0')} />
              </div>
              
            </div>
          ) : null}

          {/* API KEYS TAB */}
          {activeTab === 'api' ? (
            <div className="space-y-5">
              {!isVerified && (
                <div className="rounded-md border border-border bg-zinc-900/40 p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-black/40 text-primary shrink-0">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white tracking-tight">Unlock API Keys</h3>
                      <p className="mt-1 text-xs text-zinc-400">Confirm your admin password to reveal and manage project API keys.</p>
                    </div>
                  </div>

                  <form onSubmit={handleVerifyIdentity} className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Admin Password</label>
                      <input
                        type="password"
                        required
                        autoFocus
                        value={adminPassword}
                        onChange={(event) => setAdminPassword(event.target.value)}
                        placeholder="Enter your current admin password"
                        className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-xs text-white focus:outline-none focus:border-primary/50 transition-colors placeholder:text-zinc-600 font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={verifying || !adminPassword}
                      className="rounded-md bg-primary text-black hover:bg-primary/90 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {verifying ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
                      {verifying ? 'Verifying Identity...' : 'Unlock Access'}
                    </button>
                  </form>
                </div>
              )}

              {isVerified && (
                <>
                  <div className="rounded-md border border-primary/30 bg-primary/10 p-4 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Check size={18} className="text-primary" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Identity Verified</h4>
                      <p className="text-[11px] text-primary/80">Your session is unlocked until {formatTimestamp(verifiedUntil)}.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    {KEY_ORDER.map((role) => {
                      const summary = keysByRole[role];
                      const revealed = revealedByRole[role];
                      const meta = ROLE_LABELS[role];
                      const isBusy = loadingRole === role || rotatingRole === role;

                      return (
                        <div key={role} className="rounded-md border border-border bg-zinc-900/40 overflow-hidden flex flex-col">
                          <div className="border-b border-border px-5 py-4 flex items-start justify-between gap-4 bg-zinc-900/80">
                            <div>
                              <span className="inline-block rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary mb-2">
                                {meta.badge}
                              </span>
                              <h3 className="text-sm font-bold text-white">{meta.title}</h3>
                              <p className="mt-1 text-xs text-zinc-400 max-w-70 leading-relaxed">{meta.note}</p>
                            </div>
                            <div className={`rounded-md border border-border bg-black/40 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${revealed?.key ? 'text-primary' : 'text-zinc-500'}`}>
                              {revealed?.key ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}
                              {revealed?.key ? 'Revealed' : 'Masked'}
                            </div>
                          </div>
                          <div className="p-5 space-y-4 flex-1 flex flex-col">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <InfoPill label="Prefix" value={summary?.prefix || revealed?.prefix || 'Unavailable'} />
                              <InfoPill label="Last used" value={formatTimestamp(undefined)} />
                            </div>
                            
                            <div className="rounded-md border border-border bg-zinc-950 p-4 mt-auto">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Current Secret Key</p>
                              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <code className="text-xs font-mono text-zinc-200 break-all bg-black px-3 py-2 rounded border border-border flex-1 w-full sm:w-auto">
                                  {revealed?.key || formatMaskedValue(summary?.prefix)}
                                </code>
                                <div className="flex gap-2 w-full sm:w-auto shrink-0">
                                  <button
                                    onClick={() => {
                                      if (revealed?.key) {
                                        setRevealedByRole((current) => ({ ...current, [role]: undefined }));
                                        return;
                                      }
                                      void revealKey(role);
                                    }}
                                    disabled={isBusy}
                                    className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-200 hover:border-zinc-500 hover:text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                  >
                                    {isBusy && loadingRole === role ? <Loader2 size={13} className="animate-spin" /> : revealed?.key ? <EyeOff size={13} /> : <Eye size={13} />}
                                    {revealed?.key ? 'Hide' : 'Reveal'}
                                  </button>
                                  {revealed?.key && (
                                    <button
                                      onClick={() => void copyValue(revealed?.key, `${role}-secret`)}
                                      className="rounded-md bg-primary px-3 py-2 text-xs font-bold text-black hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                                    >
                                      {copied === `${role}-secret` ? <Check size={13} /> : <Copy size={13} />}
                                      {copied === `${role}-secret` ? 'Copied' : 'Copy'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="pt-1 flex justify-end">
                              <button
                                onClick={() => setPendingRotateRole(role)}
                                disabled={isBusy}
                                className="rounded-md border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {rotatingRole === role ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                Rotate Key
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmModal
        isOpen={pendingRotateRole !== null}
        onClose={() => setPendingRotateRole(null)}
        onConfirm={() => (pendingRotateRole ? rotateKey(pendingRotateRole) : Promise.resolve())}
        title={pendingRotateRole ? `Rotate ${ROLE_LABELS[pendingRotateRole].title}` : 'Rotate key'}
        message="This will issue a fresh key and immediately invalidate the previous one. Applications using the old key will lose access immediately."
        confirmText={rotatingRole ? 'Rotating...' : 'Yes, Rotate Key'}
        type="danger"
        closeOnConfirm={false}
      />
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; isActive?: boolean; highlight?: boolean }> = ({ icon, label, value, isActive, highlight }) => (
  <div className={`rounded-md border p-4 transition-all ${highlight ? 'border-primary/30 bg-primary/5' : 'border-border bg-zinc-900/50'}`}>
    <div className={`flex items-center gap-2 mb-2 ${highlight ? 'text-primary' : 'text-zinc-500'}`}>
      {icon}
      <p className="text-[9px] font-bold uppercase tracking-wider">{label}</p>
      {isActive && <span className="ml-auto flex h-2 w-2 rounded-full bg-primary shadow-sm"></span>}
    </div>
    <p className="text-xs font-mono font-bold text-zinc-200 break-all">{value}</p>
  </div>
);

const InfoPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md border border-border bg-zinc-950 p-3">
    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
    <p className="text-xs font-mono font-bold text-zinc-300 break-all">{value}</p>
  </div>
);

export default ConnectionModal;
