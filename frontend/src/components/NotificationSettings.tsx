import React, { useState, useEffect } from 'react';
import {
  Bell,
  Mail,
  Plus,
  Trash2,
  Shield,
  Check,
  AlertCircle,
  Loader2,
  Info,
  BellRing,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';

interface NotificationRecipient {
  id: string;
  email: string;
  alert_types?: string[];
}

type ToastType = 'success' | 'error';

interface ToastState {
  message: string;
  type: ToastType;
}

interface AuthRuntimeConfig {
  smtp_configured?: boolean;
}

const NotificationSettings = () => {
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [smtpConfigured, setSMTPConfigured] = useState(false);

  const fetchRecipients = async () => {
    try {
      const [res, configRes] = await Promise.all([
        fetchWithAuth('/api/project/security/notifications'),
        fetchWithAuth('/api/auth/config'),
      ]);
      const data: unknown = await res.json();
      const authConfig = (await configRes.json().catch(() => null)) as
        | AuthRuntimeConfig
        | null;
      setRecipients(
        Array.isArray(data) ? (data as NotificationRecipient[]) : [],
      );
      setSMTPConfigured(Boolean(authConfig?.smtp_configured));
    } catch (error) {
      console.error('Failed to fetch recipients', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipients();
  }, []);

  const addRecipient = async () => {
    const trimmedEmail = newEmail.trim();
    const wasSMTPConfigured = smtpConfigured;
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setToast({ message: 'Invalid email address', type: 'error' });
      return;
    }

    setAdding(true);
    try {
      const res = await fetchWithAuth('/api/project/security/notifications', {
        method: 'POST',
        body: JSON.stringify({
          email: trimmedEmail,
          alert_types: [
            'geo_breach',
            'unauthorized_access',
            'rate_limit_exceeded',
          ],
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.ok) {
        setNewEmail('');
        await fetchRecipients();
        setToast({
          message: wasSMTPConfigured
            ? 'Recipient added successfully.'
            : 'Recipient added. SMTP is still pending, so alerts will only be logged locally for now.',
          type: 'success',
        });
      } else {
        setToast({
          message: payload?.error || 'Failed to add recipient',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Failed to add recipient', error);
      setToast({ message: 'Network error', type: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const deleteRecipient = async (id: string) => {
    try {
      const res = await fetchWithAuth(
        `/api/project/security/notifications/${id}`,
        {
          method: 'DELETE',
        },
      );
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.ok) {
        await fetchRecipients();
        setToast({ message: 'Recipient removed', type: 'success' });
      } else {
        setToast({
          message: payload?.error || 'Failed to delete',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Failed to delete recipient', error);
      setToast({ message: 'Failed to delete', type: 'error' });
    }
  };

  if (loading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
        <Loader2 className="animate-spin text-primary" size={32} />
        <span className="text-[10px] font-medium">
          Loading Notification Settings...
        </span>
      </div>
    );

  return (
    <ModuleScrollContainer
      width="4xl"
      innerClassName="animate-in fade-in duration-700"
    >
      <div className="space-y-10 pb-20 relative">
        <div className="absolute inset-x-0 top-0 h-96 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />
        
        {/* Header */}
        <header className="px-10 py-16 border-b border-white/5 bg-linear-to-b from-zinc-900/50 to-transparent relative z-10 overflow-hidden rounded-[48px]">
          <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-8">
              <div className="w-20 h-20 rounded-[32px] bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_50px_rgba(254,254,0,0.1)]">
                <BellRing size={40} strokeWidth={1} />
              </div>
              <div className="relative z-10">
                <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase italic mb-3">Ozy_Kernel :: Security_Alerts</p>
                <h1 className="text-5xl font-bold tracking-tighter text-white uppercase italic leading-none">
                  Notification Hub
                </h1>
                <div className="mt-6 flex items-center gap-6">
                  <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 group cursor-help">
                    <Shield size={12} className="text-primary" />
                    <span className="text-primary text-[9px] font-bold uppercase tracking-widest italic">Monitoring_Active</span>
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em] italic tabular-nums">{recipients.length}_ENFORCED_RECIPIENTS</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Info Box */}
        <div className="flex items-start gap-6 rounded-[32px] border border-white/5 bg-black/40 p-8 relative overflow-hidden group shadow-inner">
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="mt-1 rounded-md bg-white/5 p-3 text-zinc-400 group-hover:text-primary transition-colors">
            <Info size={20} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold tracking-widest text-white uppercase italic leading-none">
                Real-Time Email Alerts
            </h3>
            <p className="text-[11px] leading-relaxed font-medium text-zinc-500">
                When a security breach is detected (e.g., <span className="text-zinc-300">geo-fencing violation</span>), 
                all active recipients will receive an instant email notification 
                with detailed packet information via the delivery lab.
            </p>
          </div>
        </div>

        {!smtpConfigured ? (
            <div className="flex items-start gap-6 rounded-[32px] border border-amber-500/10 bg-amber-500/5 p-8 relative overflow-hidden group">
                <div className="w-12 h-12 rounded-md bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0 text-amber-400">
                    <AlertCircle size={24} />
                </div>
                <div>
                    <h3 className="mb-2 text-xs font-bold tracking-widest text-white uppercase italic leading-none">
                        SMTP Pending :: Local Fallback
                    </h3>
                    <p className="text-[11px] leading-relaxed font-medium text-zinc-500">
                        Notification delivery will switch from console fallback to high-assurance email as soon as the <span className="text-amber-500/80 font-bold">Delivery Lab</span> protocol is finalized in Auth Settings.
                    </p>
                </div>
            </div>
        ) : null}

        {/* Add New Recipient */}
        <div className="rounded-[48px] border border-white/5 bg-background p-10 relative overflow-hidden group shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/5 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
            
            <h2 className="mb-8 flex items-center gap-3 text-2xl font-bold tracking-tighter text-white uppercase italic leading-none relative z-10">
                <Plus size={24} className="text-primary" />
                Enroll Recipient
            </h2>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void addRecipient();
                }}
                className="flex gap-4 relative z-10"
            >
                <div className="flex-1 p-5 rounded-[24px] bg-black/40 border border-white/5 shadow-inner group/input focus-within:border-primary/30 transition-all">
                    <input
                        type="email"
                        placeholder="auditor@company.io"
                        value={newEmail}
                        onChange={(e: any) => setNewEmail(e.target.value)}
                        className="w-full bg-transparent border-none p-0 text-sm font-bold text-white outline-none placeholder:text-zinc-800 tracking-wide"
                    />
                </div>
                <button
                    type="submit"
                    disabled={adding}
                    className="group/btn inline-flex items-center gap-4 rounded-[24px] bg-primary px-10 py-5 text-[11px] font-bold text-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-[0_20px_40px_rgba(254,254,0,0.1)] disabled:opacity-50"
                >
                    {adding ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <Mail size={16} className="group-hover:translate-x-1 group-hover:-translate-y-0.5 transition-transform" />
                    )}
                    {adding ? 'ENROLLING' : 'VALIDATE_AND_ENROLL'}
                </button>
            </form>
        </div>

        {/* Recipients List */}
        <div className="rounded-[48px] border border-white/5 bg-background p-10 relative overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
            <h2 className="mb-8 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <Bell size={24} className="text-zinc-600" />
                    <span className="text-2xl font-bold tracking-tighter text-white uppercase italic leading-none">Security Vector List</span>
                </div>
                <span className="px-4 py-1 rounded-full border border-white/5 bg-black/40 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{recipients.length} SIGNALS</span>
            </h2>

            {recipients.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-6 rounded-[32px] border-2 border-dashed border-white/5 py-24 text-zinc-800 bg-black/20 group">
                    <Mail size={64} strokeWidth={0.5} className="text-zinc-900 group-hover:text-zinc-800 transition-colors" />
                    <div className="text-center">
                        <p className="text-lg font-bold text-zinc-700 uppercase italic tracking-tighter">No Active Signals</p>
                        <p className="text-[10px] font-bold text-zinc-800 uppercase tracking-[0.4em] mt-3 leading-none">Add a security recipient to initialize delivery</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4 relative z-10">
                    {recipients.map((recipient: any) => (
                        <div
                            key={recipient.id}
                            className="group flex items-center justify-between rounded-md border border-white/5 bg-black/40 p-6 transition-all duration-500 hover:border-white/10 hover:bg-black/60 shadow-inner"
                        >
                            <div className="flex items-center gap-6">
                                <div className="w-12 h-12 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.1)] transition-all">
                                    <Check size={20} strokeWidth={2.5} />
                                </div>
                                <div>
                                    <p className="text-base font-bold text-white italic tracking-tighter">{recipient.email}</p>
                                    <p className="mt-1 text-[9px] font-bold tracking-[0.2em] text-zinc-600 uppercase italic">
                                        {recipient.alert_types?.join(' :: ') || 'FULL_ACCESS_LIST'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => deleteRecipient(recipient.id)}
                                className="w-10 h-10 flex items-center justify-center bg-red-500/5 hover:bg-red-500/10 text-red-500/40 hover:text-red-500 rounded-md border border-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                            >
                                <Trash2 size={16} strokeWidth={2} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Alert Types Reference */}
        <div className="rounded-[40px] border border-white/5 bg-zinc-900/10 p-8">
            <h3 className="mb-6 text-[11px] font-bold tracking-[0.4em] text-zinc-700 uppercase italic text-center">Protocol Reference</h3>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {[
                    { name: 'Geo_Breach', desc: 'Protocol violation via out-of-bounds geo-entry' },
                    { name: 'Auth_Failure', desc: 'Critical saturation of failed access attempts' },
                    { name: 'Rate_Saturation', desc: 'Suspicious request frequency detected' }
                ].map((alert, i) => (
                    <div key={i} className="p-5 rounded-md border border-white/5 bg-black/20 hover:border-primary/20 transition-colors group/type">
                        <p className="mb-2 text-xs font-bold text-zinc-400 group-hover:text-white transition-colors">{alert.name}</p>
                        <p className="text-[10px] font-medium text-zinc-600 leading-relaxed font-mono">{alert.desc}</p>
                    </div>
                ))}
            </div>
        </div>
      </div>

      {toast ? (
        <BrandedToast
          tone={toast.type === 'success' ? 'success' : 'error'}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      ) : null}
    </ModuleScrollContainer>
  );
};

export default NotificationSettings;


