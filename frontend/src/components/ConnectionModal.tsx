import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TerminalSquare,
  X,
  Server,
  Hash
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { fetchConnectionMetadata, verifyAdminIdentity, revealProjectKey, type ConnectionSummary } from '../services/connectionService';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ConnectionInfo {
  database?: string;
  host?: string;
  port?: number;
  user?: string;
  api_url?: string;
  direct_uri_template?: string;
  pooler_uri_template?: string;
  edge_functions_count?: number;
  schemas_count?: number;
}

type EssentialRole = 'anon' | 'service_role';

interface EssentialKeySummary {
  id?: string;
  role?: EssentialRole;
  label?: string;
  prefix: string;
  key_version?: number;
  is_active?: boolean;
  created_at?: string;
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
  vscode_config?: string;
  servers_config?: string;
  mcp_servers_config?: string;
}

type MCPEditorTab = 'vscode' | 'cursor' | 'antigravity' | 'windsurf';

interface RevealedKeyPayload {
  id: string;
  role: EssentialRole;
  label: string;
  key: string;
  prefix: string;
  key_version: number;
  created_at: string;
  warning?: string;
  mcp?: MCPConfig;
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
    note: 'Use this only in trusted backends, MCP and admin automation.',
  },
};

const maskValue = (prefix?: string | null) => {
  const clean = String(prefix || '').trim();
  if (!clean) {
    return 'Locked until verification';
  }
  return `${clean}••••••••••••••••`;
};

const formatVerifiedUntil = (value?: string | null) => {
  if (!value) return 'Verification not active';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Verification not active';
  return `Verified until ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
};

const ConnectionModal: React.FC<ConnectionModalProps & { activeWorkspaceId?: string | null }> = ({
  isOpen,
  onClose,
  activeWorkspaceId,
}) => {
  const [activeTab, setActiveTab] = useState<'connection' | 'api' | 'access'>('connection');
  const [showAdvancedMCP, setShowAdvancedMCP] = useState(false);
  const [mcpEditorTab, setMCPEditorTab] = useState<MCPEditorTab>('vscode');
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
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
  const [showRawSecret, setShowRawSecret] = useState<Record<string, boolean>>({});

  const ROLE_LABELS: Record<EssentialRole, { title: string; badge: string; note: string }> = {
    anon: {
      title: 'Anon / Publishable',
      badge: 'Client safe',
      note: 'Publicly accessible key. Safe for browser usage and edge clients.',
    },
    service_role: {
      title: 'Private / Secret',
      badge: 'Server only',
      note: 'Full administrative bypass key. Never expose in browsers or public repos.',
    },
  };

  const looksPlaceholderValue = (val?: string) => {
    if (!val) return true;
    const lower = val.toLowerCase();
    return lower.includes('placeholder') || lower.includes('changeme') || val.length < 10;
  };

  const formatMaskedValue = (val?: string) => {
    if (!val) return '********************************';
    return `${val}********************************`;
  };

  const isVerified = Boolean(
    verifiedUntil
    && new Date(verifiedUntil).getTime() > Date.now(),
  );

  const serviceRoleReveal = revealedByRole.service_role;
  const serviceRoleMCP = serviceRoleReveal?.mcp;
  const fallbackServerURL = serviceRoleMCP?.server_url || connection?.api_url || '';
  const fallbackSecret = serviceRoleReveal?.key || '';

  const stdioServersConfigJSON = useMemo(() => JSON.stringify({
    servers: {
      ozybase: {
        command: 'ozybase',
        args: ['mcp', 'bridge', '--url', fallbackServerURL],
        env: {
          OZYBASE_API_KEY: fallbackSecret,
        },
      },
    },
  }, null, 2), [fallbackSecret, fallbackServerURL]);

  const stdioMCPServersConfigJSON = useMemo(() => JSON.stringify({
    mcpServers: {
      ozybase: {
        command: 'ozybase',
        args: ['mcp', 'bridge', '--url', fallbackServerURL],
        env: {
          OZYBASE_API_KEY: fallbackSecret,
        },
      },
    },
  }, null, 2), [fallbackSecret, fallbackServerURL]);

  const mcpEditorOptions = useMemo(() => ([
    {
      id: 'vscode' as const,
      label: 'VS Code',
      logo: '/integrations/editors/vscode.png',
      rootKey: 'servers',
      copyKey: 'mcp-vscode-config',
      description: 'STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).',
      config: stdioServersConfigJSON,
    },
    {
      id: 'cursor' as const,
      label: 'Cursor',
      logo: '/integrations/editors/cursor.png',
      rootKey: 'mcpServers',
      copyKey: 'mcp-cursor-config',
      description: 'STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).',
      config: stdioMCPServersConfigJSON,
    },
    {
      id: 'antigravity' as const,
      label: 'Antigravity',
      logo: '/integrations/editors/antigravity.png',
      rootKey: 'mcpServers',
      copyKey: 'mcp-antigravity-config',
      description: 'STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).',
      config: stdioMCPServersConfigJSON,
    },
    {
      id: 'windsurf' as const,
      label: 'Windsurf',
      logo: '/integrations/editors/windsurf.png',
      rootKey: 'mcpServers',
      copyKey: 'mcp-windsurf-config',
      description: 'STDIO moderno con módulo oficial de OzyBase (sin archivo puente local).',
      config: stdioMCPServersConfigJSON,
    },
  ]), [stdioMCPServersConfigJSON, stdioServersConfigJSON]);

  const selectedMCPEditor = useMemo(() => {
    return mcpEditorOptions.find((opt) => opt.id === mcpEditorTab) || mcpEditorOptions[0];
  }, [mcpEditorOptions, mcpEditorTab]);

  const refreshEssentialKeys = async () => {
    try {
      const workspaceId = activeWorkspaceId || localStorage.getItem('ozy_workspace_id');
      if (!workspaceId) {
        throw new Error('MISSING_CONTEXT: No active project/workspace detected.');
      }
      const data = await fetchConnectionMetadata();
      setConnection(data.connection || null);
      setKeysByRole({
        anon: { prefix: data.anon_key_prefix || '' },
        service_role: { prefix: data.service_role_key_prefix || '' },
      });
      setVerifiedUntil(data.last_verified_at || null);
    } catch (err: any) {
      console.error('Refresh failed:', err);
      setMessage({
        tone: 'error',
        text: err.message || 'CRITICAL_ERROR: Metadata buffer unreachable.',
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setMessage(null);
    setRevealedByRole({});
    refreshEssentialKeys().finally(() => setLoading(false));
  }, [isOpen]);

  const copyValue = async (value: string, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const handleVerifyIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword || verifying) return;

    setVerifying(true);
    setMessage(null);
    try {
      const data = await verifyAdminIdentity(adminPassword);
      setVerifiedUntil(data.verified_until);
      if (data.verification_token) setVerificationToken(data.verification_token);
      setAdminPassword('');
      setMessage({
        tone: 'success',
        text: 'Admin verification confirmed. Reveal and copy keys from this modal.',
      });
    } catch (error: any) {
      console.error('Failed to verify admin password:', error);
      setMessage({
        tone: 'error',
        text: error.message || 'The modal could not verify the current admin password.',
      });
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!isVerified) {
      setActiveTab('access');
      setMessage({
        tone: 'error',
        text: 'Verify the admin password first to reveal project keys.',
      });
      return;
    }

    setLoadingRole(role);
    setMessage(null);
    try {
      const data = await revealProjectKey(role, verificationToken);
      setRevealedByRole((current) => ({ ...current, [role]: data as any }));
    } catch (error: any) {
      console.error('Failed to reveal essential key:', error);
      setMessage({
        tone: 'error',
        text: error.message || 'The key could not be revealed right now.',
      });
    } finally {
      setLoadingRole(null);
    }
  };

  const rotateKey = async (role: EssentialRole) => {
    if (!verificationToken || !isVerified) {
      setActiveTab('access');
      setMessage({
        tone: 'error',
        text: 'Verify the admin password first to rotate project keys.',
      });
      return;
    }

    setRotatingRole(role);
    setMessage(null);
    try {
      const res = await fetchWithAuth(`/api/project/keys/essential/${role}/rotate`, {
        method: 'POST',
        onUnauthorized: 'passthrough',
        body: JSON.stringify({
          verification_token: verificationToken,
          reason: 'replace placeholder key material',
        }),
      });
      const payload = await res.json().catch(() => null) as (RevealedKeyPayload & { error?: string; warning?: string }) | null;
      if (!res.ok || !payload?.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setMessage({
          tone: 'error',
          text: payload?.error || 'The key could not be rotated right now.',
        });
        return;
      }

      setRevealedByRole((current) => ({ ...current, [role]: payload }));
      setShowRawSecret((current) => ({ ...current, [role]: false }));
      await refreshEssentialKeys();
      setMessage({
        tone: 'success',
        text: payload.warning || `${role} key rotated successfully with fresh material.`,
      });
    } catch (error) {
      console.error('Failed to rotate essential key:', error);
      setMessage({
        tone: 'error',
        text: 'The key could not be rotated right now.',
      });
    } finally {
      setRotatingRole(null);
    }
  };

  const accessRows = useMemo(() => ([
    {
      label: 'API URL',
      value: connection?.api_url || '',
      key: 'api-url',
    },
    {
      label: 'Current Session Token',
      value: localStorage.getItem('ozy_token') || '',
      key: 'session-token',
    },
  ]), [connection?.api_url]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
              <Database size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-white italic">Project_Access_Kernel</h3>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic">Ozy_Kernel :: Connection_Metadata_Buffer</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border bg-zinc-950/30 px-6 py-3">
          {[
            ['connection', 'Connect_Matrix'],
            ['api', 'API_Vector'],
            ['access', 'Identity_Access'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as 'connection' | 'api' | 'access')}
              className={`rounded-md px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeTab === id
                  ? 'bg-zinc-800 text-primary border border-primary/20 shadow-[0_0_15px_rgba(254,254,0,0.05)]'
                  : 'text-zinc-600 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="custom-scrollbar flex-1 min-h-0 overflow-y-auto p-8 bg-zinc-900">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : activeTab === 'connection' ? (
            <div className="mx-auto max-w-4xl space-y-10">
              <div>
                <h3 className="mb-5 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic border-b border-border pb-2">Infrastructure_Matrix</h3>
                <div className="space-y-6">
                  {[
                    {
                      label: 'Direct_Connection_URI',
                      value: connection?.direct_uri_template || '',
                      key: 'direct',
                      hint: 'Directly connects to primary DB instance. Optimized for low-latency mutations.',
                    },
                    {
                      label: 'Transactional_Pooler_URI',
                      value: connection?.pooler_uri_template || '',
                      key: 'pooler',
                      hint: connection?.pooler_uri_template
                        ? 'High-performance transaction pooling enabled. Recommended for high-scale app nodes.'
                        : 'Configure DB_POOLER_URL for pgBouncer / Supavisor integration.',
                    },
                  ].map((item) => (
                    <div key={item.key} className="group space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">{item.label}</label>
                        <button
                          onClick={() => void copyValue(item.value, item.key)}
                          className="flex items-center gap-1.5 rounded-md bg-zinc-950 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600 border border-border hover:text-white hover:border-zinc-700 transition-all"
                        >
                          {copied === item.key ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                          {copied === item.key ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="relative">
                        <code className="block w-full rounded-md border border-border bg-zinc-950 px-4 py-3.5 font-mono text-[11px] text-zinc-400 break-all transition-all hover:border-primary/20">
                          {item.value || 'NOT_CONFIGURED'}
                        </code>
                      </div>
                      <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic leading-relaxed">
                        // {item.hint}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-5 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic border-b border-border pb-2">Project_Node_Metadata</h3>
                <div className="overflow-hidden rounded-md border border-border bg-zinc-950/50">
                  <table className="w-full">
                    <tbody className="divide-y divide-border text-[10px]">
                      {[
                        ['Database', connection?.database || ''],
                        ['Host', connection?.host || ''],
                        ['Port', String(connection?.port || '')],
                        ['User', connection?.user || ''],
                        ['Edge Functions', String(connection?.edge_functions_count ?? 0)],
                        ['Project Schemas', String(connection?.schemas_count ?? 0)],
                      ].map(([label, value]) => (
                        <tr key={label} className="group hover:bg-zinc-900/50">
                          <td className="w-48 px-6 py-3.5 font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400 transition-colors">
                            {label}
                          </td>
                          <td className="px-6 py-3.5 font-mono text-zinc-400 group-hover:text-white transition-colors">
                            {value}
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <button
                              onClick={() => void copyValue(value, label)}
                              className="text-zinc-700 hover:text-primary transition-all opacity-0 group-hover:opacity-100"
                            >
                              {copied === label ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === 'api' ? (
            <div className="mx-auto max-w-4xl space-y-10">
              <div>
                <h3 className="mb-5 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic border-b border-border pb-2">Endpoint_Vector_Settings</h3>
                <div className="space-y-6">
                  {accessRows.map((item) => (
                    <div key={item.key} className="group space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">{item.label}</label>
                        <button
                          onClick={() => void copyValue(item.value, item.key)}
                          className="flex items-center gap-1.5 rounded-md bg-zinc-950 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600 border border-border hover:text-white hover:border-zinc-700 transition-all"
                        >
                          {copied === item.key ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                          {copied === item.key ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="relative">
                        <code className="block w-full rounded-md border border-border bg-zinc-950 px-4 py-3.5 font-mono text-[11px] text-zinc-400 break-all transition-all hover:border-primary/20">
                          {item.value || 'NOT_AVAILABLE'}
                        </code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-border bg-zinc-950/50 p-6 flex items-start gap-5 transition-all hover:bg-zinc-900/50">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-zinc-900 text-primary shadow-inner">
                  <Key size={20} />
                </div>
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-white">Security_First_Protocol</h3>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-tight text-zinc-600 leading-relaxed max-w-lg">
                    Project keys for public (anon) and secret (service_role) access are managed under the <span className="text-white italic">IDENTITY_ACCESS</span> layer for enhanced kernel-level verification.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-8">
              {/* Admin verification banner */}
              {!isVerified ? (
                <div className="overflow-hidden rounded-md border border-amber-500/20 bg-zinc-950 p-5 flex items-center gap-5 transition-all hover:border-amber-500/40">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-500">
                    <AlertTriangle size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-500">Sensitive_Material_Locked</p>
                    <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic">Verify administrator identity to authorize secret key rotation and MCP access.</p>
                  </div>
                  <form className="flex items-center gap-3" onSubmit={handleVerifyIdentity}>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="ADMIN_PASS_KEY..."
                      className="w-48 rounded-md border border-border bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white focus:border-amber-500/30 outline-none transition-all placeholder:text-zinc-800"
                    />
                    <button
                      type="submit"
                      disabled={verifying || !adminPassword}
                      className="flex items-center gap-2 rounded-md bg-amber-500 px-6 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-amber-400 transition-all disabled:opacity-50 active:scale-95"
                    >
                      {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} strokeWidth={2.5} />}
                      Authorize
                    </button>
                  </form>
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-emerald-500/20 bg-zinc-950 p-5 flex items-center gap-5 border-dashed">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-500">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-500">Identity_Verified</p>
                    <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic">{formatVerifiedUntil(verifiedUntil)}</p>
                  </div>
                  {message?.tone === 'success' && (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
                      <Check size={10} /> ACCESS_GRANTED
                    </div>
                  )}
                </div>
              )}

              {message && (
                <div className={`rounded-md border p-4 text-[10px] font-bold uppercase tracking-widest ${
                  message.tone === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                    : 'border-red-500/20 bg-red-500/5 text-red-400'
                }`}>
                  // {message.text}
                </div>
              )}

              {/* API Keys */}
              <div>
                <h3 className="mb-5 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic border-b border-border pb-2">Infrastructure_Access_Keys</h3>
                <div className="space-y-8">
                  {(['anon', 'service_role'] as EssentialRole[]).map((role) => {
                    const summary = keysByRole[role];
                    const revealed = revealedByRole[role];
                    const showRaw = showRawSecret[role];
                    const roleMeta = ROLE_LABELS[role];
                    const isPlaceholderMaterial = looksPlaceholderValue(revealed?.key || summary?.prefix);
                    const visibleValue = revealed?.key
                      ? (showRaw ? revealed.key : formatMaskedValue(revealed.prefix || revealed.key.slice(0, 14)))
                      : formatMaskedValue(summary?.prefix);

                    return (
                      <div key={role} className="group space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-white">{role}</span>
                            <span className={`rounded-md border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.2em] ${
                              role === 'anon'
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                                : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                            }`}>
                              {role === 'anon' ? 'PUBLIC_VECTOR' : 'SECRET_VAULT'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 opacity-0 transition-all duration-200 group-hover:opacity-100">
                            <button
                              onClick={() => void revealKey(role)}
                              disabled={loadingRole === role}
                              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white transition-all disabled:opacity-30"
                            >
                              {loadingRole === role ? <Loader2 size={10} className="animate-spin" /> : <LockKeyhole size={10} />}
                              {revealed?.key ? 'Re_Sync' : 'Reveal_Vector'}
                            </button>
                            {isVerified && (
                              <button
                                onClick={() => void rotateKey(role)}
                                disabled={rotatingRole === role}
                                className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-500/60 hover:text-amber-500 transition-all disabled:opacity-30"
                              >
                                {rotatingRole === role ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
                                Rotate_Material
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-700 italic leading-relaxed max-w-2xl">
                          // {roleMeta.note}
                        </p>
                        {isPlaceholderMaterial && (
                          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-amber-500/80">
                            <AlertTriangle size={10} /> PLACEHOLDER_DETECTED: ROTATION_RECOMMENDED
                          </div>
                        )}
                        <div className="relative group/key">
                          <code className="block w-full rounded-md border border-border bg-zinc-950 px-4 py-4 pr-24 font-mono text-[11px] text-zinc-400 break-all transition-all group-hover/key:border-primary/20">
                            {visibleValue}
                          </code>
                          <div className="absolute top-1/2 -translate-y-1/2 right-3 flex items-center gap-2">
                            {revealed?.key && (
                              <button
                                onClick={() => setShowRawSecret((current) => ({ ...current, [role]: !current[role] }))}
                                className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all"
                              >
                                {showRaw ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            )}
                            <button
                              onClick={() => void copyValue(revealed?.key || '', `${role}-key`)}
                              disabled={!revealed?.key}
                              className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {copied === `${role}-key` ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* MCP Configuration */}
              {serviceRoleMCP && (
                <div className="pt-8 border-t border-zinc-800 space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic">MCP_Quick_Access_Vector</h3>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-[9px] font-bold uppercase tracking-widest text-emerald-500 shadow-inner">
                      <TerminalSquare size={12} /> Live_Tools: {serviceRoleMCP.tool_count}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-zinc-950/50 border border-border rounded-md overflow-hidden group">
                      <div className="flex items-center justify-between px-5 py-3 bg-zinc-950/50 border-b border-border">
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                            <div className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                            <div className="h-2.5 w-2.5 rounded-full bg-zinc-800" />
                          </div>
                          <span className="ml-2 text-[9px] font-bold text-zinc-600 font-mono uppercase tracking-widest italic">mcp.json_buffer</span>
                        </div>
                        <button
                          onClick={() => void copyValue(selectedMCPEditor.config, selectedMCPEditor.copyKey)}
                          className="flex items-center gap-2 py-1.5 rounded-md border border-border hover:border-zinc-700 bg-zinc-900 px-4 text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-all active:scale-95"
                        >
                          {copied === selectedMCPEditor.copyKey ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          Copy_Full_Config
                        </button>
                      </div>
                      <div className="p-6 space-y-6">
                        <p className="text-[9px] font-bold uppercase tracking-tight text-zinc-600 italic leading-relaxed">
                          // Select target environment vector to generate the appropriate MCP integration manifest.
                        </p>
                        
                        <div className="flex flex-wrap gap-2">
                          {mcpEditorOptions.map((editor) => (
                            <button
                              key={editor.id}
                              type="button"
                              onClick={() => setMCPEditorTab(editor.id)}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[9px] font-bold uppercase tracking-widest transition-all ${
                                mcpEditorTab === editor.id
                                  ? 'border-primary/40 bg-zinc-800 text-primary shadow-inner'
                                  : 'border-border bg-zinc-950/50 text-zinc-600 hover:border-zinc-700 hover:text-zinc-200'
                              }`}
                            >
                              <img src={editor.logo} alt="" className="h-3.5 w-3.5 grayscale invert opacity-50" />
                              <span>{editor.label}</span>
                            </button>
                          ))}
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-border/50 pb-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 italic">
                              {selectedMCPEditor.rootKey} :: {selectedMCPEditor.label}
                            </p>
                          </div>
                          <code className="block p-5 rounded-md bg-zinc-950 border border-border font-mono text-[11px] text-zinc-400 whitespace-pre overflow-x-auto custom-scrollbar">
                            {selectedMCPEditor.config}
                          </code>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-zinc-950/30 p-4">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedMCP((current) => !current)}
                        className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        {showAdvancedMCP ? '[-] Hide_Advanced_Endpoints' : '[+] Show_Advanced_Endpoints'}
                      </button>
                      {showAdvancedMCP && (
                        <div className="mt-4 space-y-2.5 text-[10px] font-mono text-zinc-500">
                          <div className="flex gap-4"><span className="w-24 font-bold text-zinc-700 uppercase">Server_URL</span> <span className="text-zinc-400">{serviceRoleMCP.server_url || connection?.api_url || 'N/A'}</span></div>
                          <div className="flex gap-4"><span className="w-24 font-bold text-zinc-700 uppercase">Tools_URL</span> <span className="text-zinc-400">{serviceRoleMCP.tools_url || 'N/A'}</span></div>
                          <div className="flex gap-4"><span className="w-24 font-bold text-zinc-700 uppercase">Invoke_URL</span> <span className="text-zinc-400">{serviceRoleMCP.invoke_url || 'N/A'}</span></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-zinc-950/50 px-6 py-4">
          <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-700 italic">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Kernel_Status: Operational :: {connection?.database || 'NULL_PROJECT'}
          </div>
          <p className="text-[8px] font-bold uppercase tracking-widest text-zinc-800">
            OzyBase_Nexus_Access_Manager_v2.0
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConnectionModal;


