import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield,
  Globe,
  MapPin,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  ShieldAlert,
  Activity,
  RefreshCw,
  ShieldCheck,
  Lock,
  Unlock,
  Zap,
  MoreHorizontal,
  UserX,
  ServerCrash,
  Loader2,
  ShieldBan,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';
import ConfirmModal from './ConfirmModal';
import AccessRequestsTable from './AccessRequestsTable';

interface CountryStat {
  country: string;
  count: number;
}

interface TopIpStat {
  ip: string;
  count: number;
}

interface SecurityStats {
  total_checks: number;
  blocked_requests: number;
  last_breach_at?: string | null;
  top_countries: CountryStat[];
  top_ips: TopIpStat[];
}

interface SecurityAlert {
  id: string;
  type: string;
  severity: string;
  message: string;
  time?: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
}

interface AuthSession {
  id: string;
  ip_address?: string;
  user_agent?: string;
  last_used_at?: string;
}

interface SessionGroup {
  ip: string;
  sessions: AuthSession[];
  latestActivity: number;
}

interface TerminationResponse {
  sessions_terminated?: number;
  refresh_tokens_revoked?: number;
}

interface SecurityDashboardProps {
  onViewSelect?: (view: string) => void;
}

const DEFAULT_STATS: SecurityStats = {
  total_checks: 0,
  blocked_requests: 0,
  last_breach_at: null,
  top_countries: [],
  top_ips: [],
};

const isCountryStat = (value: unknown): value is CountryStat =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { country?: unknown }).country === 'string' &&
  typeof (value as { count?: unknown }).count === 'number';

const isTopIpStat = (value: unknown): value is TopIpStat =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { ip?: unknown }).ip === 'string' &&
  typeof (value as { count?: unknown }).count === 'number';

const parseSecurityStats = (payload: unknown): SecurityStats => {
  if (typeof payload !== 'object' || payload === null) return DEFAULT_STATS;
  const raw = payload as Record<string, unknown>;
  const totalChecks =
    typeof raw.total_checks === 'number' ? raw.total_checks : 0;
  const blockedRequests =
    typeof raw.blocked_requests === 'number' ? raw.blocked_requests : 0;
  const lastBreach =
    typeof raw.last_breach_at === 'string' ? raw.last_breach_at : null;
  const topCountries = Array.isArray(raw.top_countries)
    ? raw.top_countries.filter(isCountryStat)
    : [];
  const topIps = Array.isArray(raw.top_ips)
    ? raw.top_ips.filter(isTopIpStat)
    : [];

  return {
    total_checks: totalChecks,
    blocked_requests: blockedRequests,
    last_breach_at: lastBreach,
    top_countries: topCountries,
    top_ips: topIps,
  };
};

const parseAuthSessions = (payload: unknown): AuthSession[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.filter((value): value is AuthSession => {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const row = value as Record<string, unknown>;
    return typeof row.id === 'string' && row.id.trim().length > 0;
  });
};

const normalizeCountryCode = (value: string): string | null => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }
  return normalized;
};

const asNumber = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const SecurityDashboard: React.FC<SecurityDashboardProps> = ({
  onViewSelect,
}) => {
  const accessRequestsRef = useRef<HTMLDivElement | null>(null);
  const [stats, setStats] = useState<SecurityStats>(DEFAULT_STATS);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'ip' | 'country';
    label: string;
  } | null>(null);

  const fetchData = useCallback(async (isAutoRefresh: any = false) => {
    if (!isAutoRefresh) setRefreshing(true);
    try {
      const [statsRes, alertsRes, sessionsRes] = await Promise.all([
        fetchWithAuth('/api/project/security/stats'),
        fetchWithAuth('/api/project/security/alerts'),
        fetchWithAuth('/api/auth/sessions'),
      ]);
      if (statsRes.ok) {
        const data: unknown = await statsRes.json();
        setStats(parseSecurityStats(data));
      }
      if (alertsRes.ok) {
        const data: unknown = await alertsRes.json();
        setAlerts(Array.isArray(data) ? (data as SecurityAlert[]) : []);
      }
      if (sessionsRes.ok) {
        const data: unknown = await sessionsRes.json();
        setSessions(parseAuthSessions(data));
      }
    } catch (error) {
      console.error('Failed to fetch security stats', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000); // 30s refresh
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const handleNavigateIntent = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string; target?: string }>).detail;
      if (detail?.view !== 'security' || detail?.target !== 'access_requests') {
        return;
      }
      accessRequestsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.addEventListener('ozy:navigate-intent', handleNavigateIntent as EventListener);
    return () => window.removeEventListener('ozy:navigate-intent', handleNavigateIntent as EventListener);
  }, []);

  const statsGrid = useMemo(
    () => [
      {
        label: 'Total Checks',
        value: stats.total_checks,
        icon: Activity,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
      },
      {
        label: 'Blocked Threats',
        value: stats.blocked_requests,
        icon: ShieldAlert,
        color: 'text-red-500',
        bg: 'bg-red-500/10',
      },
      {
        label: 'Open Alerts',
        value: alerts.length,
        icon: ShieldCheck,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        label: 'Last Breach',
        value: stats.last_breach_at
          ? new Date(stats.last_breach_at).toLocaleTimeString()
          : 'Never',
        icon: Zap,
        color: 'text-amber-500',
        bg: 'bg-amber-500/10',
      },
    ],
    [alerts.length, stats],
  );

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const groups = new Map<string, SessionGroup>();

    sessions.forEach((session) => {
      const ip = session.ip_address?.trim() || 'Unknown';
      const timestamp = session.last_used_at
        ? new Date(session.last_used_at).getTime()
        : 0;
      const existing = groups.get(ip);
      if (existing) {
        existing.sessions.push(session);
        existing.latestActivity = Math.max(existing.latestActivity, timestamp);
        return;
      }

      groups.set(ip, {
        ip,
        sessions: [session],
        latestActivity: timestamp,
      });
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (b.sessions.length !== a.sessions.length) {
        return b.sessions.length - a.sessions.length;
      }
      return b.latestActivity - a.latestActivity;
    });
  }, [sessions]);

  const triggerTerminateByIP = useCallback(async (ip: string) => {
    const normalizedIP = ip.trim();
    if (!normalizedIP || normalizedIP === 'Unknown') {
      setToast({
        tone: 'error',
        message: 'Invalid IP target for kill switch action',
      });
      return;
    }

    setActionBusyKey(`ip:${normalizedIP}`);
    try {
      const res = await fetchWithAuth('/api/project/security/sessions/terminate-by-ip', {
        method: 'POST',
        body: JSON.stringify({ ip: normalizedIP, dry_run: false }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (TerminationResponse & { error?: string })
        | null;
      if (!res.ok) {
        setToast({
          tone: 'error',
          message: payload?.error || `Failed to terminate sessions for ${normalizedIP}`,
        });
        return;
      }

      const terminated = asNumber(payload?.sessions_terminated);
      const revoked = asNumber(payload?.refresh_tokens_revoked);
      setToast({
        tone: 'success',
        message: `Kill Switch executed for ${normalizedIP}: ${terminated} sessions terminated, ${revoked} refresh tokens revoked.`,
      });
      await fetchData(true);
    } catch (error) {
      console.error('Failed to terminate sessions by ip', error);
      setToast({
        tone: 'error',
        message: `Network error while terminating sessions for ${normalizedIP}`,
      });
    } finally {
      setActionBusyKey(null);
    }
  }, [fetchData]);

  const triggerTerminateByCountry = useCallback(async (country: string) => {
    const normalizedCountry = normalizeCountryCode(country);
    if (!normalizedCountry) {
      setToast({
        tone: 'error',
        message: 'Country code must follow ISO-2 format',
      });
      return;
    }

    setActionBusyKey(`country:${normalizedCountry}`);
    try {
      const res = await fetchWithAuth('/api/project/security/sessions/terminate-by-country', {
        method: 'POST',
        body: JSON.stringify({ country_code: normalizedCountry, dry_run: false }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (TerminationResponse & { error?: string })
        | null;
      if (!res.ok) {
        setToast({
          tone: 'error',
          message:
            payload?.error ||
            `Failed to execute country kill switch for ${normalizedCountry}`,
        });
        return;
      }

      const terminated = asNumber(payload?.sessions_terminated);
      const revoked = asNumber(payload?.refresh_tokens_revoked);
      setToast({
        tone: 'success',
        message: `Country kill switch ${normalizedCountry}: ${terminated} sessions terminated, ${revoked} refresh tokens revoked.`,
      });
      await fetchData(true);
    } catch (error) {
      console.error('Failed to terminate sessions by country', error);
      setToast({
        tone: 'error',
        message: `Network error while terminating sessions for ${country}`,
      });
    } finally {
      setActionBusyKey(null);
    }
  }, [fetchData]);

  const latestAlerts = alerts.slice(0, 3);
  const quickActions = [
    {
      title: 'Manage Roles',
      description: 'Review collection permissions and RBAC guardrails.',
      view: 'policies',
      icon: Unlock,
    },
    {
      title: 'Geo-Fencing',
      description: 'Block specific countries and inspect breach paths.',
      view: 'security_policies',
      icon: Globe,
    },
    {
      title: 'Alert Routing',
      description:
        'Add recipients for security incidents and review delivery targets.',
      view: 'security_notifications',
      icon: Lock,
    },
    {
      title: 'Session Vault',
      description: 'Inspect active sessions and apply targeted kill switch actions.',
      view: 'auth',
      icon: UserX,
    },
  ];

  if (loading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
        <div className="relative">
          <Shield size={48} className="text-primary/20" />
          <Activity
            size={24}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse text-primary"
          />
        </div>
        <span className="font-medium] animate-pulse text-[10px]">
          Scanning Security Perimeter...
        </span>
      </div>
    );

  return (
    <ModuleScrollContainer
      width="7xl"
      innerClassName="animate-in fade-in duration-500 pb-20"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
            <div className="relative rounded-md border border-primary/20 bg-zinc-900 p-3">
              <ShieldAlert className="text-primary" size={32} />
            </div>
          </div>
          <div>
            <h1 className="text-4xl leading-none font-bold tracking-tighter text-white uppercase italic">
              Global Security
            </h1>
            <p className="font-medium] mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
              <Activity size={12} className="text-green-500" />
              Perimeter Monitoring Active
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData()}
          className={`rounded-md border border-border bg-zinc-900 p-3 transition-all hover:border-primary/50 ${refreshing ? 'animate-spin' : ''}`}
        >
          <RefreshCw size={18} className="text-zinc-400" />
        </button>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {statsGrid.map((s: any, i: any) => (
          <div
            key={i}
            className="group relative overflow-hidden rounded-md border border-border bg-background p-6 transition-all hover:border-primary/20"
          >
            <div
              className={`absolute -top-4 -right-4 h-24 w-24 opacity-20 blur-3xl ${s.bg}`}
            />
            <div className="relative mb-4 flex items-center justify-between">
              <div className={`rounded-md border border-white/5 p-2 ${s.bg}`}>
                <s.icon className={s.color} size={20} />
              </div>
              <TrendingUp size={14} className="text-zinc-700" />
            </div>
            <div className="relative">
              <div className="text-2xl font-bold tracking-tighter text-white italic">
                {s.value}
              </div>
              <div className="mt-1 text-[9px] font-bold tracking-widest text-zinc-600 uppercase">
                {s.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div ref={accessRequestsRef} data-testid="security-access-requests-anchor">
        <AccessRequestsTable />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Traffic Source Map View - Simplified */}
        <div className="relative overflow-hidden rounded-[2.5rem] border border-border bg-background p-8 lg:col-span-2">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase italic">
                  Threat Distribution
                </h2>
                <p className="mt-1 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
                  Geographic source of security events
                </p>
                <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-zinc-500">
                  Each bar shows the share of total perimeter checks attributed to
                  that country over the current audit dataset.
                </p>
              </div>
              <Globe size={24} className="text-zinc-800" />
            </div>

          <div className="space-y-4">
            {stats.top_countries.length > 0 ? (
              stats.top_countries.map((g: any, i: any) => {
                const rawCountryCode = String(g.country_code || '').trim().toUpperCase();
                const inferredCountryCode = normalizeCountryCode(String(g.country || ''));
                const countryCode = rawCountryCode.length === 2 ? rawCountryCode : inferredCountryCode || 'LO';

                return (
                <div key={i} className="group cursor-default">
                  <div className="mb-2 flex items-center justify-between px-2 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary ring-4 ring-primary/10" />
                      <span className="font-bold tracking-tighter text-zinc-300 uppercase">
                        {g.country}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block font-mono text-zinc-500">
                        {g.count} events
                      </span>
                      <span className="block text-[9px] font-bold tracking-widest text-zinc-700 uppercase">
                        {stats.total_checks > 0
                          ? `${Math.round((g.count / stats.total_checks) * 100)}% of checks`
                          : '0% of checks'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmAction({ type: 'country', label: countryCode });
                        }}
                        disabled={actionBusyKey === `country:${countryCode}`}
                        className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[9px] font-bold tracking-widest text-red-300 uppercase transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {actionBusyKey === `country:${countryCode}` ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <ServerCrash size={10} />
                        )}
                        Detonate
                      </button>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full border border-white/5 bg-zinc-900">
                    <div
                      className="h-full bg-linear-to-r from-primary/40 to-primary transition-all duration-1000 group-hover:from-primary group-hover:to-white"
                      style={{
                        width: `${stats.total_checks > 0 ? Math.min((g.count / stats.total_checks) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-zinc-800 py-20 text-zinc-700">
                <Globe size={32} strokeWidth={1} />
                <span className="text-[10px] font-medium">
                  No global data collected yet
                </span>
              </div>
            )}
          </div>

          {/* Breach Alerts Feed */}
          <div className="mt-12">
            <div className="mb-4 flex items-center justify-between px-2">
              <h3 className="text-[10px] font-bold tracking-[0.2em] text-zinc-500 uppercase">
                Latest Breach Alerts
              </h3>
            </div>
            <div className="grid gap-2">
              {latestAlerts.length === 0 ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-[10px] font-medium tracking-[0.18em] text-zinc-600 uppercase">
                  No breach alerts recorded yet
                </div>
              ) : (
                latestAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => onViewSelect?.('alerts')}
                    className="flex items-center justify-between rounded-md border border-red-500/10 bg-red-500/5 p-4 text-left transition-all hover:border-red-500/25 hover:bg-red-500/8"
                  >
                    <div className="flex items-center gap-4">
                      <div className="rounded-md bg-red-500/20 p-2 text-red-500">
                        <UserX size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">
                          {alert.message || 'Security alert detected'}
                        </p>
                        <p className="text-[9px] font-bold tracking-widest text-zinc-600 uppercase">
                          {String(alert.type || 'security').replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-600">
                      {alert.created_at
                        ? new Date(alert.created_at).toLocaleTimeString()
                        : alert.time || 'recent'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-8">
          {/* Top Offenders (IPs) */}
          <div className="rounded-[2.5rem] border border-border bg-background p-8">
            <div className="mb-8 flex items-center gap-3">
              <div className="rounded-md bg-amber-500/10 p-2 text-amber-500">
                <Lock size={18} />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-white uppercase italic">
                Top Offenders
              </h2>
            </div>
            <div className="space-y-2">
              {stats.top_ips.map((ip: any, i: any) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-zinc-700">
                      #0{i + 1}
                    </span>
                    <span className="font-mono text-xs text-zinc-300">
                      {ip.ip}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] font-bold text-zinc-500">
                      {ip.count}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmAction({ type: 'ip', label: String(ip.ip || '') })}
                      disabled={actionBusyKey === `ip:${String(ip.ip || '').trim()}`}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[9px] font-bold tracking-widest text-red-300 uppercase transition-colors hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {actionBusyKey === `ip:${String(ip.ip || '').trim()}` ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <UserX size={10} />
                      )}
                      Kill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-border bg-background p-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-red-500/10 p-2 text-red-400">
                  <ShieldBan size={18} />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-white uppercase italic">
                  Session Manager
                </h2>
              </div>
              <span className="text-[9px] font-bold tracking-widest text-zinc-600 uppercase">
                grouped by ip
              </span>
            </div>
            <div className="space-y-2">
              {sessionGroups.length === 0 ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
                  No active sessions detected
                </div>
              ) : (
                sessionGroups.slice(0, 6).map((group) => (
                  <div
                    key={group.ip}
                    className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] font-bold text-zinc-200">
                          {group.ip}
                        </p>
                        <p className="mt-1 text-[9px] font-bold tracking-widest text-zinc-600 uppercase">
                          {group.sessions.length} session(s)
                          {group.latestActivity > 0
                            ? ` • last seen ${new Date(group.latestActivity).toLocaleTimeString()}`
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ type: 'ip', label: group.ip })}
                        disabled={group.ip === 'Unknown' || actionBusyKey === `ip:${group.ip}`}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[9px] font-bold tracking-widest text-red-300 uppercase transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {actionBusyKey === `ip:${group.ip}` ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <ShieldAlert size={11} />
                        )}
                        Kill Group
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-red-500/20 bg-red-500/5 p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-md bg-red-500/20 p-2 text-red-300">
                <AlertTriangle size={18} />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-white uppercase italic">
                Emergency Actions
              </h2>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  const topIp = String(stats.top_ips[0]?.ip || '').trim();
                  if (!topIp) {
                    setToast({ tone: 'error', message: 'No IP candidate available in threat meter' });
                    return;
                  }
                  setConfirmAction({ type: 'ip', label: topIp });
                }}
                className="flex w-full items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-left transition-colors hover:bg-red-500/20"
              >
                <span className="text-[10px] font-bold tracking-widest text-red-200 uppercase">
                  Kill top offender IP
                </span>
                <UserX size={14} className="text-red-300" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const firstValidCountry = stats.top_countries
                    .map((entry) => normalizeCountryCode(String(entry.country || '')))
                    .find((code): code is string => Boolean(code));

                  if (firstValidCountry) {
                    setConfirmAction({ type: 'country', label: firstValidCountry });
                    return;
                  }

                  const hasLoopbackActivity = sessionGroups.some((group) => {
                    const candidate = String(group.ip || '').trim();
                    return candidate === '127.0.0.1' || candidate === '::1' || candidate.toLowerCase() === 'localhost';
                  });
                  if (hasLoopbackActivity) {
                    setConfirmAction({ type: 'country', label: 'LO' });
                    return;
                  }

                  setToast({ tone: 'error', message: 'No valid ISO-2 country candidate available' });
                }}
                className="flex w-full items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-left transition-colors hover:bg-red-500/20"
              >
                <span className="text-[10px] font-bold tracking-widest text-red-200 uppercase">
                  Detonate top country
                </span>
                <ServerCrash size={14} className="text-red-300" />
              </button>
            </div>
          </div>

          {/* RBAC Quick View */}
          <div className="group relative overflow-hidden rounded-[2.5rem] border border-primary/10 bg-primary/5 p-8 transition-all hover:bg-primary/[0.07]">
            <div className="absolute -bottom-4 -left-4 h-32 w-32 bg-primary opacity-10 blur-3xl" />
            <div className="relative mb-6 flex items-center gap-3">
              <Unlock className="text-primary" size={20} strokeWidth={2.5} />
              <h2 className="text-lg font-bold tracking-tight text-white uppercase italic">
                RBAC Guard
              </h2>
            </div>
            <div className="relative space-y-4">
              <div className="flex items-center justify-between border-b border-primary/10 pb-3">
                <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  Authenticated Users
                </span>
                <span className="text-xs font-bold text-primary italic">
                  Enabled
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-primary/10 pb-3">
                <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  Anonymous Access
                </span>
                <span className="text-xs font-bold text-red-500 italic">
                  Restricted
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  Admin Overrides
                </span>
                <span className="text-xs font-bold text-primary italic">
                  Active
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onViewSelect?.('policies')}
              className="font-medium] mt-8 w-full rounded-md bg-primary py-3 text-[10px] text-black shadow-[0_0_20px_rgba(254,254,0,0.1)] transition-all hover:scale-[1.02]"
            >
              Manage Roles
            </button>
          </div>

          <div className="space-y-3">
            {quickActions.map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => onViewSelect?.(action.view)}
                className="group/action w-full overflow-hidden rounded-[2rem] border border-zinc-800 bg-[linear-gradient(180deg,rgba(18,18,18,0.96),rgba(10,10,10,0.96))] p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_18px_45px_rgba(0,0,0,0.28)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold tracking-tight text-white uppercase">
                      {action.title}
                    </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                      {action.description}
                    </p>
                  </div>
                  <action.icon
                    size={18}
                    className="mt-1 shrink-0 text-zinc-600 transition-all duration-300 group-hover/action:translate-x-0.5 group-hover/action:text-primary"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {toast ? (
        <BrandedToast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
          position="bottom-right"
        />
      ) : null}

      <ConfirmModal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction) {
            return;
          }

          if (confirmAction.type === 'ip') {
            await triggerTerminateByIP(confirmAction.label);
          } else {
            await triggerTerminateByCountry(confirmAction.label);
          }
          setConfirmAction(null);
        }}
        title={confirmAction?.type === 'country' ? 'Nuclear Session Kill Switch' : 'Targeted Session Kill Switch'}
        message={confirmAction
          ? confirmAction.type === 'country'
            ? `Terminate all active sessions mapped to country ${confirmAction.label}? This action revokes refresh tokens and cannot be undone.`
            : `Terminate all active sessions for IP ${confirmAction.label}? This action revokes refresh tokens and cannot be undone.`
          : ''}
        confirmText={confirmAction?.type === 'country' ? 'Detonate Country' : 'Kill Sessions'}
        cancelText="Abort"
        type="danger"
        closeOnConfirm={false}
      />
    </ModuleScrollContainer>
  );
};

export default SecurityDashboard;


