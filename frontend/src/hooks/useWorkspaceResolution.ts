import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth, isAbortLikeError } from '../utils/api';

export interface WorkspaceAccessIssue {
    code: string;
    message: string;
    canCreateProject: boolean;
    availableWorkspaceId?: string;
    availableWorkspaceName?: string;
}

const normalizeWorkspaceId = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : null;
};

const readCurrentUserRole = (): string => {
    const raw = localStorage.getItem('ozy_user');
    if (!raw) {
        return '';
    }

    try {
        const parsed = JSON.parse(raw);
        return String(parsed?.role || '').trim().toLowerCase();
    } catch {
        return '';
    }
};

const buildAccessIssue = (
    code: string,
    message: string,
    availableWorkspaceId?: string | null,
    availableWorkspaceName?: string | null,
): WorkspaceAccessIssue => {
    const normalizedWorkspaceId = normalizeWorkspaceId(availableWorkspaceId);
    return {
        code,
        message,
        canCreateProject: readCurrentUserRole() === 'admin',
        availableWorkspaceId: normalizedWorkspaceId ?? undefined,
        availableWorkspaceName: availableWorkspaceName ? String(availableWorkspaceName).trim() : undefined,
    };
};

export const useWorkspaceResolution = (isAuthenticated: boolean) => {
    const [workspaceId, setWorkspaceIdState] = useState<string | null>(normalizeWorkspaceId(localStorage.getItem('ozy_workspace_id')));
    const [workspaceResolved, setWorkspaceResolved] = useState(!isAuthenticated);
    const [workspaceAccessIssue, setWorkspaceAccessIssue] = useState<WorkspaceAccessIssue | null>(null);

    const persistWorkspace = useCallback((nextWorkspaceId: string | null) => {
        if (nextWorkspaceId) {
            localStorage.setItem('ozy_workspace_id', nextWorkspaceId);
        } else {
            localStorage.removeItem('ozy_workspace_id');
        }

        setWorkspaceIdState(nextWorkspaceId);
        setWorkspaceResolved(true);
        return nextWorkspaceId;
    }, []);

    const setWorkspaceId = useCallback((nextWorkspaceId: string | null) => {
        setWorkspaceAccessIssue(null);
        return persistWorkspace(normalizeWorkspaceId(nextWorkspaceId));
    }, [persistWorkspace]);

    const resolveWorkspaceContext = useCallback(async (signal?: AbortSignal) => {
        try {
            // In single-tenant mode, skip workspace listing and go directly to bootstrap
            const storedId = normalizeWorkspaceId(localStorage.getItem('ozy_workspace_id'));
            if (storedId) {
                setWorkspaceAccessIssue(null);
                return persistWorkspace(storedId);
            }

            const workspacesResponse = await fetchWithAuth('/api/workspaces', { signal });
            const workspacesPayload = await (workspacesResponse.ok ? workspacesResponse.json() : Promise.resolve([]));
            if (signal?.aborted) {
                return null;
            }

            const workspaces = Array.isArray(workspacesPayload) ? workspacesPayload : [];
            if (workspaces.length > 0) {
                const storedWorkspaceId = normalizeWorkspaceId(localStorage.getItem('ozy_workspace_id'));
                const nextWorkspace = workspaces.find((workspace: any) => normalizeWorkspaceId(workspace?.id) === storedWorkspaceId) || workspaces[0];
                setWorkspaceAccessIssue(null);
                return persistWorkspace(normalizeWorkspaceId(nextWorkspace?.id));
            }

            const bootstrapResponse = await fetchWithAuth('/api/workspaces/bootstrap', { method: 'POST', signal });
            const bootstrapPayload = await bootstrapResponse.json().catch(() => null) as Record<string, unknown> | null;
            if (signal?.aborted) {
                return null;
            }

            if (bootstrapResponse.ok) {
                setWorkspaceAccessIssue(null);
                return persistWorkspace(normalizeWorkspaceId(bootstrapPayload?.workspace_id));
            }

            if (bootstrapResponse.status === 409 && bootstrapPayload?.error_code === 'WORKSPACE_ACCESS_REQUIRED') {
                setWorkspaceAccessIssue(buildAccessIssue(
                    'WORKSPACE_ACCESS_REQUIRED',
                    String(bootstrapPayload?.error || 'You need access to an existing project before continuing.'),
                    normalizeWorkspaceId(bootstrapPayload?.available_workspace_id),
                    bootstrapPayload?.available_workspace_name ? String(bootstrapPayload.available_workspace_name) : undefined,
                ));
                return persistWorkspace(null);
            }

            const errorCode = String(bootstrapPayload?.error_code || 'WORKSPACE_RESOLUTION_FAILED');
            const message = String(bootstrapPayload?.error || 'Unable to resolve a project right now.');
            setWorkspaceAccessIssue(buildAccessIssue(errorCode, message));
        } catch (err) {
            if (isAbortLikeError(err, signal)) {
                return null;
            }

            console.error('Failed to resolve workspace context', err);
            setWorkspaceAccessIssue(buildAccessIssue(
                'WORKSPACE_RESOLUTION_FAILED',
                'Unable to resolve a project right now. Please try again.',
            ));
        }

        return persistWorkspace(null);
    }, [persistWorkspace]);

    const createWorkspace = useCallback(async (name: string) => {
        const normalizedName = String(name || '').trim();
        if (!normalizedName) {
            throw new Error('Project name is required');
        }

        const res = await fetchWithAuth('/api/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: normalizedName }),
        });
        const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (!res.ok) {
            throw new Error(String(payload?.error || 'Failed to create project'));
        }

        const nextWorkspaceId = normalizeWorkspaceId(payload?.id);
        if (!nextWorkspaceId) {
            throw new Error('Project was created without an identifier');
        }

        setWorkspaceAccessIssue(null);
        persistWorkspace(nextWorkspaceId);
        return payload;
    }, [persistWorkspace]);

    useEffect(() => {
        if (!isAuthenticated) {
            setWorkspaceAccessIssue(null);
            setWorkspaceResolved(false);
            setWorkspaceIdState(null);
            return;
        }

        setWorkspaceResolved(false);
        const controller = new AbortController();
        void resolveWorkspaceContext(controller.signal);

        return () => {
            controller.abort();
        };
    }, [isAuthenticated, resolveWorkspaceContext]);

    return {
        workspaceId,
        setWorkspaceId,
        workspaceResolved,
        workspaceAccessIssue,
        createWorkspace,
        refreshWorkspaceContext: resolveWorkspaceContext,
    };
};

