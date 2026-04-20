import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface AccessRequest {
  id: string;
  user_id: string;
  email?: string;
  user_email?: string;
  message?: string;
  source_ip?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  created_at: string;
  updated_at?: string;
  processed_at?: string;
  processed_email?: string;
}

interface AccessRequestsTableProps {
  onPendingCountChange?: (count: number) => void;
}

const isAccessRequest = (value: unknown): value is AccessRequest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.user_id === 'string' &&
    typeof row.status === 'string' &&
    typeof row.created_at === 'string'
  );
};

const AccessRequestsTable: React.FC<AccessRequestsTableProps> = ({
  onPendingCountChange,
}) => {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [selectedRoleByRequestId, setSelectedRoleByRequestId] = useState<
    Record<string, 'admin' | 'member' | 'viewer'>
  >({});
  const [notice, setNotice] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null);

  const refreshTimeoutRef = useRef<number | null>(null);

  const loadRequests = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }
    try {
      const res = await fetchWithAuth('/api/project/security/requests');
      const payload = (await res.json().catch(() => null)) as
        | { requests?: unknown; error?: string }
        | null;

      if (!res.ok) {
        if (!silent) {
          setNotice({
            tone: 'error',
            message: payload?.error || 'Failed to load access requests',
          });
        }
        return;
      }

      const rows = Array.isArray(payload?.requests)
        ? payload.requests.filter(isAccessRequest)
        : [];
      setRequests(rows);
    } catch (error) {
      console.error('Failed to load access requests', error);
      if (!silent) {
        setNotice({
          tone: 'error',
          message: 'Network error while loading access requests',
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const pendingRequests = useMemo(
    () => requests.filter((request) => String(request.status).toUpperCase() === 'PENDING'),
    [requests],
  );

  const historyRequests = useMemo(
    () => requests.filter((request) => String(request.status).toUpperCase() !== 'PENDING'),
    [requests],
  );

  useEffect(() => {
    onPendingCountChange?.(pendingRequests.length);
  }, [onPendingCountChange, pendingRequests.length]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;

    const openRealtimeStream = async () => {
      const workspaceId = localStorage.getItem('ozy_workspace_id')?.trim().toLowerCase() || '';
      const requestedChannels = workspaceId ? [`workspace:${workspaceId}`] : [];

      const sessionRes = await fetchWithAuth('/api/realtime/session', {
        method: 'POST',
        body: JSON.stringify({
          channels: requestedChannels,
          expires_in: 300,
        }),
      });

      if (disposed) {
        return;
      }

      if (sessionRes.status === 404 || sessionRes.status === 405) {
        eventSource = new EventSource('/api/realtime');
      } else if (sessionRes.ok) {
        const sessionPayload = (await sessionRes.json().catch(() => null)) as {
          token?: unknown;
          channels?: unknown;
        } | null;
        const token = typeof sessionPayload?.token === 'string' ? sessionPayload.token.trim() : '';
        if (!token) {
          throw new Error('Realtime session did not return a token');
        }

        const grantedChannels = Array.isArray(sessionPayload?.channels)
          ? sessionPayload.channels
              .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
              .map((item) => item.trim())
          : [];
        const streamUrl = new URL('/api/realtime', window.location.origin);
        streamUrl.searchParams.set('token', token);
        if (grantedChannels.length > 0) {
          streamUrl.searchParams.set('channels', grantedChannels.join(','));
        }
        eventSource = new EventSource(`${streamUrl.pathname}${streamUrl.search}`);
      } else {
        return;
      }

      if (!eventSource || disposed) {
        return;
      }

      eventSource.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data || '{}') as {
            table?: unknown;
            action?: unknown;
            record?: Record<string, unknown>;
          };
          const tableName = String(payload?.table || '');
          const action = String(payload?.action || '').toUpperCase();
          if (tableName !== '_v_access_requests') {
            return;
          }
          if (!['INSERT', 'UPDATE', 'DELETE'].includes(action)) {
            return;
          }

          if (refreshTimeoutRef.current !== null) {
            return;
          }
          refreshTimeoutRef.current = window.setTimeout(() => {
            refreshTimeoutRef.current = null;
            void loadRequests(true);
          }, 320);
        } catch (error) {
          console.error('Failed to parse access request realtime payload', error);
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
      };
    };

    void openRealtimeStream().catch((error) => {
      console.error('Access requests realtime bootstrap failed', error);
    });

    return () => {
      disposed = true;
      eventSource?.close();
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [loadRequests]);

  const decideRequest = useCallback(
    async (requestId: string, decision: 'APPROVED' | 'REJECTED') => {
      setBusyRequestId(requestId);
      try {
        const res = await fetchWithAuth(`/api/project/security/requests/${requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            decision,
            role: selectedRoleByRequestId[requestId] || 'member',
          }),
        });
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; status?: string }
          | null;

        if (!res.ok) {
          setNotice({
            tone: 'error',
            message: payload?.error || 'Unable to process access request',
          });
          return;
        }

        setNotice({
          tone: 'ok',
          message:
            decision === 'APPROVED'
              ? 'Access request approved and membership granted.'
              : 'Access request rejected.',
        });
        await loadRequests(true);
      } catch (error) {
        console.error('Failed to decide access request', error);
        setNotice({
          tone: 'error',
          message: 'Network error while processing access request',
        });
      } finally {
        setBusyRequestId(null);
      }
    },
    [loadRequests, selectedRoleByRequestId],
  );

  const rows = activeTab === 'pending' ? pendingRequests : historyRequests;

  return (
    <div className="rounded-[2.5rem] border border-border bg-background p-8 lg:col-span-3">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white uppercase italic">
            Access Requests
          </h2>
          <p className="mt-1 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
            approval queue and decision history
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-2 text-[10px] font-bold tracking-widest text-zinc-300 uppercase transition-colors hover:text-white disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`rounded-md border px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
            activeTab === 'pending'
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Pending ({pendingRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`rounded-md border px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
            activeTab === 'history'
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          History ({historyRequests.length})
        </button>
      </div>

      {notice ? (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-[11px] font-bold ${
            notice.tone === 'ok'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/40 py-12 text-zinc-500">
          <Loader2 size={18} className="animate-spin" />
          <span className="ml-2 text-[10px] font-bold tracking-widest uppercase">Loading requests...</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 py-14 text-zinc-600">
          <ShieldAlert size={20} />
          <span className="text-[10px] font-bold tracking-widest uppercase">No requests in this view</span>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((request) => {
            const rowEmail = String(request.email || request.user_email || 'unknown').trim();
            const status = String(request.status || '').toUpperCase();
            const createdAtLabel = new Date(request.created_at).toLocaleString();
            const isPending = status === 'PENDING';
            const isBusy = busyRequestId === request.id;

            return (
              <div
                key={request.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold tracking-tight text-white">{rowEmail}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest uppercase ${
                          status === 'PENDING'
                            ? 'bg-amber-500/15 text-amber-300'
                            : status === 'APPROVED'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
                      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1">
                        <Clock3 size={10} />
                        {createdAtLabel}
                      </span>
                      <span className="rounded-md border border-zinc-800 px-2 py-1">
                        IP {request.source_ip || 'unknown'}
                      </span>
                    </div>
                    <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-zinc-400">
                      {request.message?.trim() || 'No message provided'}
                    </p>
                    {!isPending && request.processed_email ? (
                      <p className="mt-2 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
                        processed by {request.processed_email}
                      </p>
                    ) : null}
                  </div>

                  {isPending ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedRoleByRequestId[request.id] || 'member'}
                        onChange={(event) =>
                          setSelectedRoleByRequestId((prev) => ({
                            ...prev,
                            [request.id]: event.target.value as 'admin' | 'member' | 'viewer',
                          }))
                        }
                        className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] font-bold tracking-widest text-zinc-300 uppercase"
                        disabled={isBusy}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void decideRequest(request.id, 'APPROVED')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold tracking-widest text-emerald-300 uppercase disabled:opacity-60"
                      >
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideRequest(request.id, 'REJECTED')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-[10px] font-bold tracking-widest text-red-300 uppercase disabled:opacity-60"
                      >
                        <X size={12} />
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AccessRequestsTable;


