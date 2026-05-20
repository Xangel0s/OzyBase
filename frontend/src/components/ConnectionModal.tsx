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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 backdrop-blur-xl bg-black/60 transition-opacity duration-300">
      <div className="w-full max-w-5xl rounded-xl border border-white/[0.08] bg-[#111111] shadow-[0_0_100px_rgba(210,242,11,0.05)] overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header Area */}
        <div className="relative border-b border-white/[0.05] bg-gradient-to-b from-white/[0.03] to-transparent px-8 py-6 flex items-start justify-between gap-4">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(255,255,255,0.04)_0%,_transparent_50%)] pointer-events-none"></div>
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full bg-[#d2f20b] animate-pulse shadow-[0_0_10px_rgba(210,242,11,0.6)]"></span>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#d2f20b]">Connection Center</p>
            </div>
            <h1 className="text-3xl font-semibold text-white tracking-tight">Project connection & API keys</h1>
            <p className="mt-1 text-sm text-zinc-400">Manage your workspace configuration, verify database access, and rotate secrets securely.</p>
          </div>
          <button onClick={onClose} className="relative z-10 rounded-full bg-white/5 p-2.5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white hover:rotate-90">
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-8 pt-6 pb-2">
          <div className="inline-flex p-1.5 rounded-2xl bg-white/[0.03] border border-white/[0.05] w-full sm:w-auto overflow-x-auto no-scrollbar">
            {[
              { id: 'connection', label: 'Connection Status', icon: <Server size={14} /> },
              { id: 'api', label: 'API Keys', icon: <Key size={14} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`relative flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold tracking-wide transition-all duration-300 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-[#d2f20b]/15 text-[#d2f20b] shadow-[0_2px_10px_rgba(210,242,11,0.1)]'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
          {message ? (
            <div className={`mb-6 flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm animate-in fade-in slide-in-from-top-2 ${
              message.tone === 'success' 
                ? 'border-[#d2f20b]/20 bg-[#d2f20b]/10 text-[#d2f20b]' 
                : 'border-red-500/20 bg-red-500/10 text-red-200'
            }`}>
              {message.tone === 'success' ? <Check size={18} className="mt-0.5" /> : <AlertTriangle size={18} className="mt-0.5" />}
              <p className="leading-relaxed">{message.text}</p>
            </div>
          ) : null}

          {/* CONNECTION TAB */}
          {activeTab === 'connection' ? (
            <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
              
              {/* Setup Flow */}
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-6 lg:p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#d2f20b]/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
                
                <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
                  <div>
                    <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
                      <Terminal size={20} className="text-[#d2f20b]" />
                      One-time project connection
                    </h2>
                    <p className="mt-1.5 text-sm text-zinc-400 max-w-xl">Run the npm bootstrap in your project terminal, confirm in the browser, and keep the MCP wired locally for every IDE.</p>
                  </div>
                  <div className={`rounded-xl border px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 ${
                    connection?.last_verified_at 
                      ? 'border-[#d2f20b]/30 bg-[#d2f20b]/10 text-[#d2f20b]' 
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                  }`}>
                    {connection?.last_verified_at ? <><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#d2f20b] opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-[#d2f20b]"></span></span> Connected</> : 'Not linked yet'}
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                  {[
                    { title: 'Run local command', desc: 'npx ozybase connect', icon: <Terminal size={16} />, badge: 'Terminal' },
                    { title: 'Browser approval', desc: 'Review connection summary', icon: <MousePointerClick size={16} />, badge: 'Browser' },
                    { title: 'Persist state', desc: 'Save project link locally', icon: <Database size={16} />, badge: 'Local' },
                    { title: 'MCP Ready', desc: 'IDE uses local stdio', icon: <MonitorCheck size={16} />, badge: 'Stdio' },
                  ].map((step, index, arr) => (
                    <div key={index} className="relative group">
                      <div className="h-full rounded-2xl border border-white/[0.05] bg-[#151515] p-5 transition-all duration-300 hover:bg-[#1a1a1a] hover:border-white/[0.1] hover:shadow-lg hover:-translate-y-1">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-[#d2f20b] group-hover:bg-[#d2f20b]/20 transition-colors">
                            {step.icon}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Step {index + 1}</span>
                        </div>
                        <h3 className="text-sm font-semibold text-white mb-1">{step.title}</h3>
                        <p className="text-xs text-zinc-400 font-mono">{step.desc}</p>
                        <div className="mt-4">
                          <span className="inline-block rounded-md bg-white/[0.05] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{step.badge}</span>
                        </div>
                      </div>
                      {index < arr.length - 1 && (
                        <div className="hidden lg:block absolute top-1/2 -right-3 -translate-y-1/2 z-20 text-zinc-700">
                          <ChevronRight size={20} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-2xl border border-[#d2f20b]/15 bg-black/40 p-4 relative z-10">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#d2f20b]">Copy command</p>
                      <p className="mt-1 text-sm text-zinc-400">Paste this in your project terminal to start the guided connection flow.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyValue(connectCommand, 'connect-command')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/[0.1]"
                    >
                      {copied === 'connect-command' ? <Check size={14} className="text-[#d2f20b]" /> : <Copy size={14} />}
                      {copied === 'connect-command' ? 'Copied' : 'Copy command'}
                    </button>
                  </div>
                  <code className="mt-4 block rounded-xl border border-white/[0.06] bg-[#0b0b0b] px-4 py-3 text-sm font-mono text-[#d2f20b] break-all">
                    {connectCommand}
                  </code>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard icon={<Database size={16} />} label="Database" value={connection?.connection?.database || 'Not loaded'} />
                <StatCard icon={<Server size={16} />} label="Host" value={connection?.connection?.host || 'Not loaded'} />
                <StatCard icon={<Globe size={16} />} label="API URL" value={connection?.api_url || 'Not loaded'} />
                <StatCard icon={<Hash size={16} />} label="SSL Status" value={connection?.connection?.ssl ? 'Enabled' : 'Disabled'} isActive={connection?.connection?.ssl} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={<ShieldCheck size={16} />} label="Last verified" value={formatTimestamp(connection?.last_verified_at)} highlight />
                <StatCard icon={<Key size={16} />} label="Edge functions" value={String(connection?.edge_functions_count ?? '0')} />
                <StatCard icon={<Database size={16} />} label="Schemas" value={String(connection?.schemas_count ?? '0')} />
              </div>
              
            </div>
          ) : null}

          {/* API KEYS TAB */}
          {activeTab === 'api' ? (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
              {!isVerified && (
                <div className="rounded-xl border border-white/[0.05] bg-[#151515] p-8 overflow-hidden relative shadow-lg">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-[#d2f20b]/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
                  
                  <div className="flex items-start gap-4 mb-8 relative z-10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] text-zinc-400">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white tracking-tight">Unlock API Keys</h3>
                      <p className="mt-1 text-sm text-zinc-400">Confirm your admin password to reveal and manage project API keys.</p>
                    </div>
                  </div>

                  <form onSubmit={handleVerifyIdentity} className="space-y-5 relative z-10">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2 pl-1">Admin Password</label>
                      <input
                        type="password"
                        required
                        autoFocus
                        value={adminPassword}
                        onChange={(event) => setAdminPassword(event.target.value)}
                        placeholder="Enter your current admin password"
                        className="w-full rounded-2xl border border-white/[0.1] bg-black/40 px-5 py-4 text-sm text-white focus:outline-none focus:border-[#d2f20b]/50 focus:bg-black/60 transition-all placeholder:text-zinc-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={verifying || !adminPassword}
                      className="w-full rounded-2xl bg-[#d2f20b] text-black hover:bg-[#c0e00a] px-5 py-4 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:hover:bg-[#d2f20b] flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(210,242,11,0.1)]"
                    >
                      {verifying ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
                      {verifying ? 'Verifying Identity...' : 'Unlock Access'}
                    </button>
                  </form>
                </div>
              )}

              {isVerified && (
                <>
                  <div className="rounded-2xl border border-[#d2f20b]/20 bg-[#d2f20b]/5 p-6 relative z-10 flex flex-col items-center justify-center text-center">
                    <div className="h-16 w-16 rounded-full bg-[#d2f20b]/20 flex items-center justify-center mb-4">
                      <Check size={32} className="text-[#d2f20b]" />
                    </div>
                    <h4 className="text-lg font-medium text-white mb-2">Identity Verified</h4>
                    <p className="text-sm text-[#d2f20b]/70 mb-2">Your session is unlocked until {formatTimestamp(verifiedUntil)}.</p>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {KEY_ORDER.map((role) => {
                      const summary = keysByRole[role];
                      const revealed = revealedByRole[role];
                      const meta = ROLE_LABELS[role];
                      const isBusy = loadingRole === role || rotatingRole === role;
                      const isAnon = role === 'anon';

                      return (
                        <div key={role} className="rounded-xl border border-white/[0.05] bg-[#151515] overflow-hidden flex flex-col transition-all hover:border-white/[0.08]">
                          <div className={`border-b border-white/[0.05] px-6 py-5 flex items-start justify-between gap-4 ${isAnon ? 'bg-[#d2f20b]/[0.02]' : 'bg-blue-500/[0.02]'}`}>
                            <div>
                              <span className={`inline-block rounded-md px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest mb-3 ${isAnon ? 'bg-[#d2f20b]/10 text-[#d2f20b]' : 'bg-blue-500/10 text-blue-400'}`}>
                                {meta.badge}
                              </span>
                              <h3 className="text-lg font-semibold text-white">{meta.title}</h3>
                              <p className="mt-1 text-xs text-zinc-400 max-w-[280px] leading-relaxed">{meta.note}</p>
                            </div>
                            <div className={`rounded-xl border border-white/[0.05] bg-black/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${revealed?.key ? 'text-[#d2f20b]' : 'text-zinc-500'}`}>
                              {revealed?.key ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}
                              {revealed?.key ? 'Revealed' : 'Masked'}
                            </div>
                          </div>
                          <div className="p-6 space-y-5 flex-1 flex flex-col">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <InfoPill label="Prefix" value={summary?.prefix || revealed?.prefix || 'Unavailable'} />
                              <InfoPill label="Last used" value={formatTimestamp(undefined)} />
                            </div>
                            
                            <div className="rounded-2xl border border-white/[0.05] bg-black/50 p-5 mt-auto">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Current Secret Key</p>
                              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <code className="text-sm font-mono text-white/90 break-all bg-white/[0.02] px-3 py-2 rounded-lg border border-white/[0.02] flex-1 w-full sm:w-auto">
                                  {revealed?.key || formatMaskedValue(summary?.prefix)}
                                </code>
                                <div className="flex gap-2 w-full sm:w-auto">
                                  <button
                                    onClick={() => {
                                      if (revealed?.key) {
                                        setRevealedByRole((current) => ({ ...current, [role]: undefined }));
                                        return;
                                      }
                                      void revealKey(role);
                                    }}
                                    disabled={isBusy}
                                    className={`flex-1 sm:flex-none rounded-xl border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:bg-white/[0.1] hover:text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2`}
                                  >
                                    {isBusy && loadingRole === role ? <Loader2 size={14} className="animate-spin" /> : revealed?.key ? <EyeOff size={14} /> : <Eye size={14} />}
                                    {revealed?.key ? 'Hide' : 'Reveal'}
                                  </button>
                                  {revealed?.key && (
                                    <button
                                      onClick={() => void copyValue(revealed?.key, `${role}-secret`)}
                                      className="flex-1 sm:flex-none rounded-xl bg-white/[0.08] hover:bg-white/[0.12] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-colors flex items-center justify-center gap-2"
                                    >
                                      {copied === `${role}-secret` ? <Check size={14} className="text-[#d2f20b]" /> : <Copy size={14} />}
                                      {copied === `${role}-secret` ? 'Copied' : 'Copy'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="pt-2 flex justify-end">
                               <button
                                onClick={() => setPendingRotateRole(role)}
                                disabled={isBusy}
                                className="rounded-xl border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center gap-2"
                              >
                                {rotatingRole === role ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
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
  <div className={`rounded-2xl border p-5 transition-all duration-300 hover:bg-white/[0.03] ${highlight ? 'border-[#d2f20b]/20 bg-[#d2f20b]/[0.02]' : 'border-white/[0.05] bg-[#151515]'}`}>
    <div className={`flex items-center gap-2 mb-3 ${highlight ? 'text-[#d2f20b]' : 'text-zinc-500'}`}>
      {icon}
      <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
      {isActive && <span className="ml-auto flex h-2 w-2 rounded-full bg-[#d2f20b] shadow-[0_0_8px_rgba(210,242,11,0.8)]"></span>}
    </div>
    <p className={`text-sm font-medium break-all ${highlight ? 'text-white/90' : 'text-white/90'}`}>{value}</p>
  </div>
);

const InfoPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-white/[0.03] bg-white/[0.02] p-4">
    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{label}</p>
    <p className="text-sm font-medium text-white/80 break-all">{value}</p>
  </div>
);

export default ConnectionModal;
