import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  MoreVertical,
  Settings,
  Shield,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';
import OzySelect from './OzySelect';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  is_verified: boolean;
  created_at?: string;
}

interface AuthSession {
  id: string;
  user_agent?: string;
  ip_address?: string;
  last_used_at?: string;
}

interface AuthManagerProps {
  view?: string;
  onViewSelect?: (view: string) => void;
}

const EMPTY_USER_FORM = {
  email: '',
  password: '',
  role: 'user',
};

const MIN_RUNTIME_PASSWORD_LENGTH = 8;
const isUserAuthorized = (user: Pick<AuthUser, 'is_verified' | 'role'>) =>
  user.is_verified || user.role === 'admin';

const AuthManager: React.FC<AuthManagerProps> = ({
  view = 'users',
  onViewSelect,
}) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sessions'>(
    view === 'sessions' ? 'sessions' : 'users',
  );
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_USER_FORM);
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AuthUser | null>(
    null,
  );
  const [deleteConfirmationEmail, setDeleteConfirmationEmail] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);
  const [pendingPasswordResetUser, setPendingPasswordResetUser] =
    useState<AuthUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetForceLogout, setResetForceLogout] = useState(true);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  );

  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem('ozy_user');
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { id?: unknown } | null;
      return typeof parsed?.id === 'string' && parsed.id.trim()
        ? parsed.id
        : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setActiveTab(view === 'sessions' ? 'sessions' : 'users');
  }, [view]);

  useEffect(() => {
    if (activeTab === 'users') {
      void fetchUsers();
      return;
    }
    void fetchSessions();
  }, [activeTab]);

  const stats = useMemo(
    () => ({
      total: users.length,
      authorized: users.filter((user) => isUserAuthorized(user)).length,
      admins: users.filter((user) => user.role === 'admin').length,
      status: 'Operational',
    }),
    [users],
  );

  const showToast = (
    message: string,
    type: 'success' | 'error' = 'success',
  ) => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2500);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/auth/users?limit=1000');
      const payload = await res.json();
      const nextUsers = Array.isArray(payload?.data) ? payload.data : [];
      setUsers(nextUsers);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/auth/sessions');
      const payload = await res.json();
      setSessions(Array.isArray(payload) ? payload : []);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      const res = await fetchWithAuth(`/api/auth/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const error = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        showToast(error?.error || 'Failed to update role', 'error');
        return;
      }
      setUsers((current) =>
        current.map((user) => (user.id === userId ? { ...user, role } : user)),
      );
      showToast('User role updated');
    } catch (error) {
      console.error('Failed to update role:', error);
      showToast('Network error while updating role', 'error');
    }
  };

  const handleDeleteUser = async () => {
    if (!pendingDeleteUser) {
      return;
    }

    setDeletingUser(true);
    try {
      const res = await fetchWithAuth(
        `/api/auth/users/${pendingDeleteUser.id}`,
        {
          method: 'DELETE',
        },
      );
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        showToast(payload?.error || 'Failed to delete user', 'error');
        return;
      }

      setUsers((current) =>
        current.filter((user) => user.id !== pendingDeleteUser.id),
      );
      setPendingDeleteUser(null);
      setDeleteConfirmationEmail('');
      showToast(payload?.message || 'User deleted');
    } catch (error) {
      console.error('Failed to delete user:', error);
      showToast('Network error while deleting user', 'error');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: newUser.email,
          password: newUser.password,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        showToast(payload.error || 'Failed to create user', 'error');
        return;
      }

      if (newUser.role !== 'user') {
        await fetchWithAuth(`/api/auth/users/${payload.id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role: newUser.role }),
        });
      }

      setShowCreateUser(false);
      setNewUser(EMPTY_USER_FORM);
      await fetchUsers();
      showToast('User created');
    } catch (error) {
      console.error('Failed to create user:', error);
      showToast('Network error while creating user', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetchWithAuth(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        showToast('Failed to revoke session', 'error');
        return;
      }
      await fetchSessions();
      showToast('Session revoked');
    } catch (error) {
      console.error('Failed to revoke session:', error);
      showToast('Network error while revoking session', 'error');
    }
  };

  const handleResetUserPassword = async () => {
    if (!pendingPasswordResetUser) {
      return;
    }

    const manualPassword = resetPasswordValue.trim();
    if (manualPassword !== '' && manualPassword.length < 12) {
      showToast('Manual password must be at least 12 characters', 'error');
      return;
    }

    setResettingPassword(true);
    try {
      const res = await fetchWithAuth(
        `/api/auth/users/${pendingPasswordResetUser.id}/reset-password`,
        {
          method: 'POST',
          body: JSON.stringify({
            password: manualPassword || undefined,
            force_logout: resetForceLogout,
          }),
        },
      );

      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        temporary_password?: string;
        sessions_terminated?: number;
        refresh_tokens_revoked?: number;
      } | null;

      if (!res.ok) {
        showToast(payload?.error || 'Failed to reset user password', 'error');
        return;
      }

      if (payload?.temporary_password) {
        setGeneratedPassword(payload.temporary_password);
      }

      const sessionsTerminated = Number(payload?.sessions_terminated || 0);
      const refreshRevoked = Number(payload?.refresh_tokens_revoked || 0);
      showToast(
        `Password reset complete. Sessions terminated: ${sessionsTerminated}. Refresh revoked: ${refreshRevoked}.`,
      );
      setResetPasswordValue('');
      await fetchSessions();
    } catch (error) {
      console.error('Failed to reset user password:', error);
      showToast('Network error while resetting password', 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleCopyGeneratedPassword = async () => {
    if (!generatedPassword) {
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedPassword);
      showToast('Temporary password copied');
    } catch (error) {
      console.error('Failed to copy temporary password:', error);
      showToast('Unable to copy temporary password', 'error');
    }
  };

  return (
    <div className="animate-in fade-in relative flex h-full flex-col overflow-hidden bg-background">
      {/* Header Section */}
      <div className="border-b border-border bg-background px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900">
              <Users className="text-primary" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white uppercase italic">
                Authentication
              </h1>
              <p className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
                Identity & Access Management
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onViewSelect?.('policies')}
              className="flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase transition-all hover:bg-zinc-800 hover:text-white"
            >
              <Settings size={12} />
              RBAC Console
            </button>
            <button
              onClick={() => setShowCreateUser(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[10px] font-bold tracking-wider text-black uppercase transition-all hover:bg-[#d2f20b] active:scale-95"
            >
              <UserPlus size={14} strokeWidth={2.5} />
              Add User
            </button>
          </div>
        </div>

        {/* Stats Section */}
        <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            {
              label: 'Total Users',
              value: stats.total,
              icon: Users,
              color: 'text-zinc-400',
            },
            {
              label: 'Authorized',
              value: stats.authorized,
              icon: BadgeCheck,
              color: 'text-green-500',
            },
            {
              label: 'System Admin',
              value: stats.admins,
              icon: Shield,
              color: 'text-blue-500',
            },
            {
              label: 'Status',
              value: stats.status,
              icon: Activity,
              color: 'text-primary',
            },
          ].map((item) => (
            <div
              key={item.label}
              className="group flex items-center justify-between rounded-md border border-border bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-900"
            >
              <div>
                <p className="mb-1 text-[9px] font-bold tracking-widest text-zinc-500 uppercase">
                  {item.label}
                </p>
                <p className="text-lg font-bold tracking-tight text-white">
                  {item.value}
                </p>
              </div>
              <item.icon
                size={18}
                className={`${item.color} opacity-40 group-hover:opacity-100 transition-opacity`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="overflow-hidden rounded-md border border-border bg-zinc-900/30">
          <div className="flex items-center justify-between border-b border-border bg-zinc-900 px-6 py-3">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('users')}
                className={`text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'users' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                User Accounts
              </button>
              <button
                onClick={() => setActiveTab('sessions')}
                className={`text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'sessions' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Active Sessions
              </button>
            </div>
            <button
              onClick={
                activeTab === 'users'
                  ? () => void fetchUsers()
                  : () => void fetchSessions()
              }
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 transition-colors hover:text-primary"
            >
              Refresh
            </button>
          </div>

          {activeTab === 'users' ? (
            <table className="w-full text-left">
              <thead>
                <tr className="font-medium] border-b border-border bg-background text-[10px] text-zinc-600">
                  <th className="px-8 py-5">Identities</th>
                  <th className="px-8 py-5">Verification</th>
                  <th className="px-8 py-5">Role</th>
                  <th className="px-8 py-5">Joined</th>
                  <th className="px-8 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-zinc-400">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Loader2
                          className="animate-spin text-primary"
                          size={28}
                        />
                        <p className="text-[10px] font-medium text-zinc-600">
                          Synchronizing Identity Vault...
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <p className="text-[10px] font-medium text-zinc-600">
                        No users found
                      </p>
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user.id}
                      className="group transition-colors hover:bg-zinc-900/40"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-600 transition-colors group-hover:text-primary">
                            <User size={18} />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold tracking-tight text-zinc-100">
                              {user.email}
                            </h3>
                            <p className="mt-1 font-mono text-[10px] leading-none tracking-widest text-zinc-600">
                              {user.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase ${isUserAuthorized(user) ? 'border-green-500/20 bg-green-500/10 text-green-500' : 'border-zinc-700 bg-zinc-800 text-zinc-500'}`}
                        >
                          {user.role === 'admin'
                            ? 'Authenticated'
                            : user.is_verified
                              ? 'Verified'
                              : 'Pending'}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <OzySelect
                          value={user.role}
                          onChange={(event) =>
                            void handleRoleChange(user.id, event.target.value)
                          }
                          disabled={user.role === 'admin' && stats.admins <= 1}
                          wrapperClassName="min-w-[120px] rounded-md border-border bg-zinc-900"
                          selectClassName="h-8 px-2 text-[9px] tracking-wider uppercase font-bold"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="editor">Editor</option>
                        </OzySelect>
                      </td>
                      <td className="px-8 py-5 text-xs font-bold tracking-tight text-zinc-600 uppercase">
                        {user.created_at
                          ? new Date(user.created_at).toLocaleDateString()
                          : 'Unknown'}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="relative inline-flex">
                          <button
                            onClick={() =>
                              setOpenMenuUserId((current) =>
                                current === user.id ? null : user.id,
                              )
                            }
                            className="p-2 text-zinc-700 transition-colors hover:text-zinc-200"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openMenuUserId === user.id && (
                            <div className="ozy-floating-panel absolute top-10 right-0 z-60 w-48 border border-border bg-zinc-900 p-1 shadow-2xl rounded-md">
                              <button
                                onClick={() => {
                                  setSelectedUser(user);
                                  setOpenMenuUserId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase transition-all hover:bg-zinc-800 hover:text-white"
                              >
                                <Eye size={12} />
                                View Detail
                              </button>
                              <button
                                onClick={() => {
                                  void handleRoleChange(
                                    user.id,
                                    user.role === 'admin' ? 'user' : 'admin',
                                  );
                                  setOpenMenuUserId(null);
                                }}
                                disabled={
                                  user.role === 'admin' && stats.admins <= 1
                                }
                                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase transition-all hover:bg-zinc-800 hover:text-white"
                              >
                                <Shield size={12} />
                                {user.role === 'admin'
                                  ? 'Demote'
                                  : 'Promote'}
                              </button>
                              <button
                                onClick={() => {
                                  setPendingPasswordResetUser(user);
                                  setResetPasswordValue('');
                                  setResetForceLogout(true);
                                  setGeneratedPassword(null);
                                  setOpenMenuUserId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase transition-all hover:bg-zinc-800 hover:text-white"
                              >
                                <KeyRound size={12} />
                                Reset Pass
                              </button>
                              <button
                                onClick={() => {
                                  setPendingDeleteUser(user);
                                  setDeleteConfirmationEmail('');
                                  setOpenMenuUserId(null);
                                }}
                                disabled={
                                  user.id === currentUserId ||
                                  (user.role === 'admin' && stats.admins <= 1)
                                }
                                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-wider text-red-400 uppercase transition-all hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <X size={12} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="font-medium] border-b border-border bg-background text-[10px] text-zinc-600">
                  <th className="px-8 py-5">Session Info</th>
                  <th className="px-8 py-5">Device / OS</th>
                  <th className="px-8 py-5">IP Address</th>
                  <th className="px-8 py-5">Last Active</th>
                  <th className="px-8 py-5 text-right">Protection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-zinc-400">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-10 text-center">
                      <Loader2 className="mx-auto animate-spin text-primary" />
                    </td>
                  </tr>
                ) : sessions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-8 py-10 text-center text-[10px] font-bold text-zinc-600 uppercase"
                    >
                      No secondary sessions found
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="group transition-colors hover:bg-zinc-900/40"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-900 text-zinc-600">
                            <Activity size={14} />
                          </div>
                          <span className="max-w-[180px] truncate text-xs font-bold tracking-tighter text-zinc-200">
                            {session.id}
                          </span>
                        </div>
                      </td>
                      <td className="max-w-[200px] truncate px-8 py-5 text-[10px] font-bold text-zinc-500 uppercase">
                        {session.user_agent || 'Generic Agent / OzyBase CLI'}
                      </td>
                      <td className="px-8 py-5 font-mono text-xs text-zinc-500">
                        {session.ip_address || 'Unknown'}
                      </td>
                      <td className="px-8 py-5 text-[10px] font-bold text-zinc-600 uppercase">
                        {session.last_used_at
                          ? new Date(session.last_used_at).toLocaleString()
                          : 'Unknown'}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => setPendingSessionId(session.id)}
                          className="rounded border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-medium text-red-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/20"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreateUser && (
        <div className="fixed inset-0 z-120 flex items-center justify-center p-6">
          <div
            className="ozy-overlay-backdrop absolute inset-0 backdrop-blur-md"
            onClick={() => setShowCreateUser(false)}
          />
          <form
            onSubmit={handleCreateUser}
            className="ozy-dialog-panel relative w-full max-w-md overflow-hidden border border-border bg-zinc-900 rounded-md"
          >
            <div className="flex items-center justify-between border-b border-border bg-zinc-900 px-6 py-4">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-white uppercase">
                  Create User
                </h2>
                <p className="mt-1 text-[9px] font-medium text-zinc-500 uppercase tracking-tight">
                  Provision new identity
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateUser(false)}
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  Email
                </label>
                <input
                  required
                  type="email"
                  value={newUser.email}
                  onChange={(event) =>
                    setNewUser((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-black px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  Temporary Password
                </label>
                <input
                  required
                  minLength={MIN_RUNTIME_PASSWORD_LENGTH}
                  type="password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder={`Min ${MIN_RUNTIME_PASSWORD_LENGTH} chars`}
                  className="w-full rounded-md border border-border bg-black px-3 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  Role
                </label>
                <OzySelect
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  wrapperClassName="rounded-md border-border bg-black"
                  selectClassName="text-[10px] font-bold uppercase tracking-wider"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="editor">Editor</option>
                </OzySelect>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-zinc-900 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowCreateUser(false)}
                className="px-4 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[10px] font-bold text-black uppercase tracking-wider transition-all hover:bg-[#d2f20b] disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <UserPlus size={12} />
                )}
                {submitting ? 'Creating' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-110 flex items-center justify-center p-6">
          <div
            className="ozy-overlay-backdrop absolute inset-0 backdrop-blur-md"
            onClick={() => setSelectedUser(null)}
          />
          <div className="ozy-dialog-panel relative w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-[#131313] px-8 py-6">
              <h2 className="text-xl font-bold tracking-tight text-white uppercase">
                User Detail
              </h2>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 p-8 text-sm">
              <div>
                <p className="text-[10px] font-medium text-zinc-500">Email</p>
                <p className="mt-1 text-white">{selectedUser.email}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-zinc-500">Role</p>
                <p className="mt-1 text-white">{selectedUser.role}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-zinc-500">User ID</p>
                <code className="break-all text-zinc-300">
                  {selectedUser.id}
                </code>
              </div>
              <div>
                <p className="text-[10px] font-medium text-zinc-500">
                  Created At
                </p>
                <p className="mt-1 text-white">
                  {selectedUser.created_at
                    ? new Date(selectedUser.created_at).toLocaleString()
                    : 'Unknown'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingSessionId}
        onClose={() => setPendingSessionId(null)}
        onConfirm={() =>
          pendingSessionId ? handleRevokeSession(pendingSessionId) : undefined
        }
        title="Terminate Session"
        message="This token will be revoked immediately and the client will need to authenticate again."
        confirmText="Revoke Session"
        type="danger"
      />

      {pendingDeleteUser && (
        <div className="fixed inset-0 z-120 flex items-center justify-center p-6">
          <div
            className="ozy-overlay-backdrop absolute inset-0 backdrop-blur-md"
            onClick={() => !deletingUser && setPendingDeleteUser(null)}
          />
          <div className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-[#131313] px-8 py-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase">
                  Delete User
                </h2>
                <p className="mt-1 text-[10px] font-medium text-zinc-600">
                  Type the exact email to confirm permanent removal
                </p>
              </div>
              <button
                type="button"
                onClick={() => !deletingUser && setPendingDeleteUser(null)}
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5 p-8">
              <div className="rounded-md border border-red-500/20 bg-red-500/6 p-4">
                <p className="text-[10px] font-bold tracking-[0.18em] text-red-200 uppercase">
                  Danger Zone
                </p>
                <p className="mt-3 text-sm text-red-100/85">
                  Remove{' '}
                  <span className="font-bold">{pendingDeleteUser.email}</span>{' '}
                  from OzyBase. Sessions, auth identities, table views, and
                  workspace memberships for this user are deleted as part of the
                  cleanup.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-zinc-500">
                  Confirmation Email
                </label>
                <input
                  autoFocus
                  type="email"
                  value={deleteConfirmationEmail}
                  onChange={(event) =>
                    setDeleteConfirmationEmail(event.target.value)
                  }
                  placeholder={pendingDeleteUser.email}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white focus:border-red-500/50 focus:outline-none"
                />
                <p className="text-[10px] text-zinc-600">
                  Protected accounts cannot delete themselves, and the last
                  remaining admin cannot be removed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-border bg-[#131313] px-8 py-5">
              <button
                type="button"
                onClick={() => !deletingUser && setPendingDeleteUser(null)}
                className="px-5 py-2.5 text-[10px] font-medium text-zinc-500 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteUser()}
                disabled={
                  deletingUser ||
                  deleteConfirmationEmail.trim().toLowerCase() !==
                    pendingDeleteUser.email.trim().toLowerCase()
                }
                className="flex items-center gap-2 rounded-md bg-red-600 px-6 py-2.5 text-[10px] font-medium text-white disabled:opacity-60"
              >
                {deletingUser ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <X size={14} />
                )}
                {deletingUser ? 'Deleting' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPasswordResetUser && (
        <div className="fixed inset-0 z-120 flex items-center justify-center p-6">
          <div
            className="ozy-overlay-backdrop absolute inset-0 backdrop-blur-md"
            onClick={() =>
              !resettingPassword && setPendingPasswordResetUser(null)
            }
          />
          <div className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-[#131313] px-8 py-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white uppercase">
                  Reset Password
                </h2>
                <p className="mt-1 text-[10px] font-medium text-zinc-600">
                  Reset credentials for {pendingPasswordResetUser.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  !resettingPassword && setPendingPasswordResetUser(null)
                }
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-8">
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-zinc-500">
                  New Password (optional)
                </label>
                <input
                  type="password"
                  value={resetPasswordValue}
                  onChange={(event) => setResetPasswordValue(event.target.value)}
                  placeholder="Leave empty to auto-generate secure temporary password"
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none"
                />
                <p className="text-[10px] text-zinc-600">
                  Manual password must be 12+ chars. Empty field generates a secure temporary credential.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
                <input
                  type="checkbox"
                  checked={resetForceLogout}
                  onChange={(event) => setResetForceLogout(event.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="text-[10px] font-bold tracking-widest text-zinc-300 uppercase">
                    Detonate active sessions
                  </span>
                  <span className="mt-1 block text-[10px] text-zinc-500">
                    Revokes refresh tokens and closes active sessions immediately.
                  </span>
                </span>
              </label>

              {generatedPassword ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="text-[10px] font-bold tracking-widest text-amber-200 uppercase">
                    Temporary password generated
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <code className="flex-1 break-all rounded-md bg-black/40 px-3 py-2 text-sm text-amber-100">
                      {generatedPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyGeneratedPassword()}
                      className="inline-flex items-center gap-2 rounded-md border border-amber-400/40 px-3 py-2 text-[10px] font-bold tracking-widest text-amber-200 uppercase transition-colors hover:bg-amber-500/20"
                    >
                      <Copy size={12} />
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-border bg-[#131313] px-8 py-5">
              <button
                type="button"
                onClick={() =>
                  !resettingPassword && setPendingPasswordResetUser(null)
                }
                className="px-5 py-2.5 text-[10px] font-medium text-zinc-500 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleResetUserPassword()}
                disabled={resettingPassword}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-[10px] font-medium text-black disabled:opacity-60"
              >
                {resettingPassword ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <KeyRound size={14} />
                )}
                {resettingPassword ? 'Resetting' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast ? (
        <BrandedToast
          tone={toast.type === 'error' ? 'error' : 'success'}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
};

export default AuthManager;


