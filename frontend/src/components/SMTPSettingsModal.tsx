import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ServerCog,
  ShieldCheck,
  TestTube2,
  X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { BrandedToast } from './OverlayPrimitives';

interface SMTPSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface SMTPSettingsResponse {
  host?: string;
  port?: string;
  username?: string;
  from?: string;
  configured?: boolean;
  password_configured?: boolean;
  source?: string;
}

interface ToastState {
  tone: 'success' | 'error' | 'info';
  message: string;
}

const emptyForm = {
  host: '',
  port: '587',
  username: '',
  password: '',
  from: '',
};

const getDefaultTestEmail = () => {
  try {
    const raw = localStorage.getItem('ozy_user');
    if (!raw) {
      return '';
    }
    const parsed = JSON.parse(raw) as { email?: unknown } | null;
    return typeof parsed?.email === 'string' ? parsed.email : '';
  } catch {
    return '';
  }
};

const sourceLabel = (source?: string) => {
  switch (source) {
    case 'database':
      return 'SAVED_IN_PROJECT_SECRETS';
    case 'environment':
      return 'ENVIRONMENT_FALLBACK_ACTIVE';
    default:
      return 'LOCAL_CONSOLE_ONLY';
  }
};

const SMTPSettingsModal: React.FC<SMTPSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState('console');
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [clearStoredPassword, setClearStoredPassword] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [toast, setToast] = useState<ToastState | null>(null);

  const applySettings = (payload: SMTPSettingsResponse | null) => {
    setForm({
      host: payload?.host || '',
      port: payload?.port || '587',
      username: payload?.username || '',
      password: '',
      from: payload?.from || '',
    });
    setConfigured(Boolean(payload?.configured));
    setSource(payload?.source || 'console');
    setPasswordConfigured(Boolean(payload?.password_configured));
    setClearStoredPassword(false);
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/auth/smtp');
      const payload = (await res.json().catch(() => null)) as
        | (SMTPSettingsResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load SMTP settings');
      }
      applySettings(payload);
      if (!testEmail) {
        setTestEmail(getDefaultTestEmail());
      }
    } catch (error) {
      console.error('Failed to load SMTP settings', error);
      setToast({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to load SMTP settings',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setToast(null);
    void loadSettings();
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const trimmedHost = form.host.trim();
  const trimmedPort = form.port.trim();
  const trimmedFrom = form.from.trim();
  const trimmedRecipient = testEmail.trim();
  const preservePassword =
    form.password.trim() === '' && passwordConfigured && !clearStoredPassword;
  const canAttemptTest =
    trimmedRecipient.length > 0 &&
    trimmedHost.length > 0 &&
    trimmedPort.length > 0 &&
    trimmedFrom.length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/auth/smtp', {
        method: 'PUT',
        body: JSON.stringify({
          host: form.host,
          port: form.port,
          username: form.username,
          password: form.password,
          from: form.from,
          preserve_password: preservePassword,
          clear_password: clearStoredPassword,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (SMTPSettingsResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to save SMTP settings');
      }
      applySettings(payload);
      setToast({
        tone: 'success',
        message:
          'SMTP configurations synchronized. Validate delivery vector before deployment.',
      });
      onSaved?.();
    } catch (error) {
      console.error('Failed to save SMTP settings', error);
      setToast({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to save SMTP settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!trimmedRecipient) {
      setToast({
        tone: 'error',
        message: 'Recipient email required for packet transmission.',
      });
      return;
    }
    if (!trimmedHost || !trimmedPort || !trimmedFrom) {
      setToast({
        tone: 'info',
        message:
          'Incomplete transport parameters detected.',
      });
      return;
    }

    setTesting(true);
    try {
      const res = await fetchWithAuth('/api/auth/smtp/test', {
        method: 'POST',
        body: JSON.stringify({
          to: trimmedRecipient,
          host: trimmedHost,
          port: trimmedPort,
          username: form.username,
          password: form.password,
          from: trimmedFrom,
          use_stored_password: preservePassword,
          clear_password: clearStoredPassword,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string; to?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || 'Transmission failure');
      }
      setToast({
        tone: 'success',
        message: `Packet successfully delivered to ${payload?.to || trimmedRecipient}.`,
      });
    } catch (error) {
      setToast({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Transmission failure',
      });
    } finally {
      setTesting(false);
    }
  };

    return (
        <div
            className="fixed inset-0 z-120 flex items-center justify-center p-4"
            onClick={(event) => {
                if (event.target === event.currentTarget && !saving && !testing) {
                    onClose();
                }
            }}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div className="relative w-full max-w-4xl overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <ServerCog size={18} className="text-primary" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white italic">SMTP Mail Settings</h3>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic">Email Delivery Config</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving || testing}
                        className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="max-h-[75vh] overflow-y-auto p-8 custom-scrollbar bg-zinc-900 space-y-8">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 size={32} className="animate-spin text-primary" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">Syncing_Buffer...</span>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-md border border-border bg-zinc-950/50 p-4 space-y-2">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 italic">Transport_State</p>
                                    <div className="flex items-center gap-2">
                                        <div className={`h-2 w-2 rounded-full ${configured ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-800'}`} />
                                        <span className="text-[11px] font-bold text-white uppercase tracking-widest">{configured ? 'LIVE_TRANSCEIVER' : 'CONSOLE_EMULATION'}</span>
                                    </div>
                                    <p className="text-[8px] font-bold text-zinc-700 uppercase tracking-tighter truncate">{sourceLabel(source)}</p>
                                </div>

                                <div className="rounded-md border border-border bg-zinc-950/50 p-4 space-y-2">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 italic">Security_Layer</p>
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck size={14} className={passwordConfigured ? 'text-primary' : 'text-zinc-800'} />
                                        <span className="text-[11px] font-bold text-white uppercase tracking-widest">{passwordConfigured ? 'VAULTED_TOKEN' : 'PLAIN_TEXT'}</span>
                                    </div>
                                    <p className="text-[8px] font-bold text-zinc-700 uppercase tracking-tighter">ENCRYPTION_ACTIVE: RSA_2048</p>
                                </div>

                                <div className="rounded-md border border-border bg-zinc-950/50 p-4 space-y-2">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-700 italic">Probe_Target</p>
                                    <div className="flex items-center gap-2">
                                        <Mail size={14} className="text-zinc-700" />
                                        <span className="text-[11px] font-bold text-white uppercase tracking-widest truncate">{testEmail || 'NO_VECTOR'}</span>
                                    </div>
                                    <p className="text-[8px] font-bold text-zinc-700 uppercase tracking-tighter">PRIMARY_TEST_RECIPIENT</p>
                                </div>
                            </div>

                            {!configured && source === 'console' && (
                                <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-4">
                                    <AlertCircle size={18} className="text-primary shrink-0" />
                                    <div>
                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-primary italic">Simulation_Active</h4>
                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-tight text-zinc-600 leading-relaxed">
                                            External delivery is decoupled. All packets redirected to local console buffer. Enable transport layer to authorize production flows.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic whitespace-nowrap">Connection Settings</h3>
                                    <div className="h-px bg-zinc-800 w-full" />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                    <div className="space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Transport_Host</label>
                                        <input
                                            value={form.host}
                                            onChange={(e) => setForm(c => ({ ...c, host: e.target.value }))}
                                            placeholder="SMTP_SERVER_ADDRESS..."
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Network_Port</label>
                                        <input
                                            value={form.port}
                                            onChange={(e) => setForm(c => ({ ...c, port: e.target.value }))}
                                            placeholder="587"
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-mono font-bold text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Authenticator_UID</label>
                                        <input
                                            value={form.username}
                                            onChange={(e) => setForm(c => ({ ...c, username: e.target.value }))}
                                            placeholder="AUTH_USERNAME..."
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Sender Reference</label>
                                        <input
                                            value={form.from}
                                            onChange={(e) => setForm(c => ({ ...c, from: e.target.value }))}
                                            placeholder="NO_REPLY@DOMAIN.COM"
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Security_Token</label>
                                        <input
                                            type="password"
                                            value={form.password}
                                            onChange={(event) => {
                                                const nextValue = event.target.value;
                                                setForm((current) => ({ ...current, password: nextValue }));
                                                if (nextValue.trim() !== '') {
                                                    setClearStoredPassword(false);
                                                }
                                            }}
                                            placeholder={passwordConfigured ? 'TOKEN_VAULTED_EMPTY_TO_KEEP' : 'AUTH_PASSWORD...'}
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.3em] text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    {passwordConfigured && (
                                        <div className="flex items-center justify-between rounded-md border border-red-500/10 bg-red-500/5 p-4 mt-auto">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-red-500/60 italic">Purge_Vaulted_Token</span>
                                            <input
                                                type="checkbox"
                                                checked={clearStoredPassword}
                                                onChange={(e) => setClearStoredPassword(e.target.checked)}
                                                className="h-5 w-5 rounded-md border-zinc-800 bg-zinc-950 text-red-600 focus:ring-0 focus:ring-offset-0"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 italic whitespace-nowrap">Packet_Probe_Sequencer</h3>
                                    <div className="h-px bg-zinc-800 w-full" />
                                </div>

                                <div className="flex flex-col md:flex-row gap-4">
                                    <div className="flex-1 space-y-2.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">Recipient Address</label>
                                        <input
                                            value={testEmail}
                                            onChange={(e) => setTestEmail(e.target.value)}
                                            placeholder="TARGET_RECIPIENT@OZYBASE.IO"
                                            className="w-full rounded-md border border-border bg-zinc-950 px-4 py-3 text-[11px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleSendTest()}
                                        disabled={testing || loading || !canAttemptTest}
                                        className="h-[52px] mt-auto flex items-center gap-3 rounded-md border border-border bg-zinc-950 px-8 text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition-all hover:border-primary/30 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed group/test shadow-inner"
                                    >
                                        {testing ? (
                                            <Loader2 size={14} className="animate-spin text-primary" />
                                        ) : (
                                            <Send size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                                        )}
                                        <span>Initialize_Probe</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving || testing}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving || testing || loading}
                        className="flex items-center gap-2 rounded-md bg-primary px-8 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black shadow-[0_0_20px_rgba(254,254,0,0.1)] transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} strokeWidth={2.5} />}
                        Persist_Configuration
                    </button>
                </div>

                {toast ? (
                    <BrandedToast
                        tone={toast.tone}
                        message={toast.message}
                        onClose={() => setToast(null)}
                        position="top-right"
                    />
                ) : null}
            </div>
        </div>
    );
};

export default SMTPSettingsModal;


