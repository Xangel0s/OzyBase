import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';
import SMTPSettingsModal from './SMTPSettingsModal';

const SETTING_CARDS = [
  {
    id: 'smtp_configured',
    label: 'SMTP Delivery',
    icon: Mail,
    description: 'Transactional email sending for auth flows.',
    view: 'smtp',
    missingCta: 'Configure SMTP',
    readyCta: 'Open SMTP Lab',
  },
  {
    id: 'oauth_enabled',
    label: 'OAuth Providers',
    icon: Lock,
    description: 'External identity provider support.',
    view: 'providers',
    missingCta: 'Open providers',
    readyCta: 'Review providers',
  },
  {
    id: 'email_verification_enabled',
    label: 'Email Verification',
    icon: CheckCircle2,
    description: 'Email confirmation on signup.',
    view: 'templates',
    missingCta: 'Review templates',
    readyCta: 'Open templates',
  },
  {
    id: 'mfa_supported',
    label: 'Multi-Factor Auth',
    icon: ShieldCheck,
    description: '2FA challenge support for user sessions.',
    view: 'two_factor',
    missingCta: 'Open 2FA',
    readyCta: 'Manage 2FA',
  },
];

interface AuthRuntimeConfig {
  smtp_configured?: boolean;
  oauth_enabled?: boolean;
  email_verification_enabled?: boolean;
  mfa_supported?: boolean;
}

interface AuthSettingsViewProps {
  onViewSelect?: (view: string) => void;
}

const AuthSettingsView: React.FC<AuthSettingsViewProps> = ({
  onViewSelect,
}) => {
  const [config, setConfig] = useState<AuthRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSMTPModalOpen, setIsSMTPModalOpen] = useState(false);

  const handleCardAction = (cardId: string, view: string) => {
    if (cardId === 'smtp_configured') {
      setIsSMTPModalOpen(true);
      return;
    }
    onViewSelect?.(view);
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/auth/config');
      const data = await res.json();
      setConfig(data);
    } catch (error) {
      console.error('Failed to load auth config:', error);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  return (
    <ModuleScrollContainer
      width="5xl"
      innerClassName="animate-in fade-in duration-500"
    >
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter text-white uppercase italic">
            Auth Settings
          </h1>
          <p className="mt-1 text-[10px] font-medium text-zinc-500">
            Secure deployment summary from the running backend
          </p>
        </div>
        <button
          onClick={() => void loadConfig()}
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-5 py-2.5 text-[10px] font-medium text-zinc-400 transition-all hover:text-white"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {SETTING_CARDS.map((card) => {
              const active = Boolean(
                config?.[card.id as keyof AuthRuntimeConfig],
              );
              return (
                <div
                  key={card.id}
                  className={`group relative flex items-start justify-between gap-6 overflow-hidden rounded-md border bg-background p-6 text-left transition-all duration-300 ${active ? 'border-border hover:border-green-500/20 hover:shadow-[0_18px_45px_rgba(0,0,0,0.22)]' : 'border-red-500/15 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_24px_55px_rgba(0,0,0,0.28)]'}`}
                >
                  <div
                    className={`pointer-events-none absolute inset-x-8 top-0 h-px ${active ? 'bg-linear-to-r from-transparent via-green-500/20 to-transparent' : 'bg-linear-to-r from-transparent via-primary/30 to-transparent'}`}
                  />
                  <div>
                    <div className="mb-3 flex items-center gap-3">
                      <div
                        className={`rounded-md border p-3 transition-transform duration-300 group-hover:scale-105 ${active ? 'border-green-500/20 bg-green-500/10 text-green-500' : 'border-zinc-800 bg-zinc-900 text-zinc-600 group-hover:text-primary'}`}
                      >
                        <card.icon size={18} />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold tracking-tight text-white uppercase">
                          {card.label}
                        </h2>
                        <p className="mt-1 text-[10px] font-medium text-zinc-600">
                          {card.description}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCardAction(card.id, card.view)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/6 bg-black/20 px-3 py-1 text-[9px] font-bold tracking-[0.2em] text-zinc-400 uppercase transition-colors hover:text-white"
                    >
                      {active ? card.readyCta : card.missingCta}
                      <ArrowUpRight
                        size={12}
                        className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      />
                    </button>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-[9px] font-medium ${active ? 'border-green-500/20 bg-green-500/10 text-green-500' : 'border-red-500/20 bg-red-500/10 text-red-500'}`}
                  >
                    {active ? 'Ready' : 'Missing'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="rounded-md border border-border bg-background p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-zinc-500">
                {config?.smtp_configured ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <XCircle size={20} />
                )}
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-widest text-white uppercase">
                  Operational Note
                </h3>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  This screen exposes only safe runtime status. Secret material
                  such as SMTP passwords, OAuth secrets, service keys or
                  database credentials is intentionally excluded from the API
                  contract.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      <SMTPSettingsModal
        isOpen={isSMTPModalOpen}
        onClose={() => setIsSMTPModalOpen(false)}
        onSaved={() => {
          void loadConfig();
        }}
      />
    </ModuleScrollContainer>
  );
};

export default AuthSettingsView;


