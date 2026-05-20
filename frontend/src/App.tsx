import React, { useCallback, useEffect, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import AppShell from './components/AppShell';
import Login from './components/Login';
import NoProjectAccessState from './components/NoProjectAccessState';
import SetupWizard from './components/SetupWizard';
import { useAuthSession } from './hooks/useAuthSession';
import { useSystemStatus } from './hooks/useSystemStatus';
import { useWorkspaceResolution } from './hooks/useWorkspaceResolution';
import { fetchWithAuth, isAbortLikeError } from './utils/api';
import { addProjectSyncListener } from './utils/projectEvents';

function AppContent() {
    const { isAuthenticated, setIsAuthenticated } = useAuthSession();
    const { checkingSystem, isSystemInitialized, setIsSystemInitialized } = useSystemStatus();
    const {
        workspaceId,
        setWorkspaceId,
        workspaceResolved,
        workspaceAccessIssue,
        createWorkspace,
    } = useWorkspaceResolution(isAuthenticated);

    const [tables, setTables] = useState<any[]>([]);
    const [creatingProject, setCreatingProject] = useState(false);
    const [requestingAccess, setRequestingAccess] = useState(false);
    const [accessRequested, setAccessRequested] = useState(false);
    const loadTables = useCallback((signal?: AbortSignal) => {
        fetchWithAuth('/api/collections', { signal })
            .then((res) => res.json())
            .then((data) => setTables(Array.isArray(data) ? data : []))
            .catch((err) => {
                if (isAbortLikeError(err, signal)) {
                    return;
                }
                console.error('Failed to load tables', err);
            });
    }, []);

    useEffect(() => {
        if (!isAuthenticated || !workspaceResolved || !workspaceId) {
            setTables([]);
            return;
        }

        const controller = new AbortController();
        loadTables(controller.signal);

        return () => {
            controller.abort();
        };
    }, [isAuthenticated, loadTables, workspaceId, workspaceResolved]);

    useEffect(() => {
        const unsubscribe = addProjectSyncListener((detail) => {
            if (!detail.tables || !isAuthenticated || !workspaceResolved || !workspaceId) {
                return;
            }
            loadTables();
        });
        return unsubscribe;
    }, [isAuthenticated, loadTables, workspaceId, workspaceResolved]);

    const handleCreateProject = useCallback(async (name: string) => {
        setCreatingProject(true);
        try {
            await createWorkspace(name);
        } finally {
            setCreatingProject(false);
        }
    }, [createWorkspace]);

    const handleRequestAccess = useCallback(async (message: string, workspaceId?: string) => {
        setRequestingAccess(true);
        try {
            const res = await fetchWithAuth('/api/workspaces/request-access', {
                method: 'POST',
                body: JSON.stringify({
                    message,
                    workspace_id: workspaceId || undefined,
                }),
            });
            const payload = await res.json().catch(() => null) as { error?: string } | null;
            if (!res.ok) {
                throw new Error(String(payload?.error || 'Failed to submit access request'));
            }
            setAccessRequested(true);
        } finally {
            setRequestingAccess(false);
        }
    }, []);

    useEffect(() => {
        if (workspaceId) {
            setAccessRequested(false);
        }
    }, [workspaceId]);

    if (checkingSystem) {
        return <div className="h-screen w-screen flex items-center justify-center bg-black text-white">Loading OzyBase...</div>;
    }

    if (!isSystemInitialized) {
        return (
            <SetupWizard
                onComplete={({ token, workspaceId: nextWorkspaceId }: { token: string; workspaceId: string | null; workspaceName: string | null }) => {
                    setWorkspaceId(nextWorkspaceId);
                    if (token) {
                        localStorage.setItem('ozy_token', token);
                        if (nextWorkspaceId) localStorage.setItem('ozy_workspace_id', nextWorkspaceId);
                        setIsAuthenticated(true);
                    }
                    setIsSystemInitialized(true);
                }}
            />
        );
    }

    if (!isAuthenticated) {
        return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
    }

    if (!workspaceResolved) {
        return <div className="h-screen w-screen flex items-center justify-center bg-black text-white">Resolving project context...</div>;
    }

    if (!workspaceId) {
        return (
            <NoProjectAccessState
                issueMessage={workspaceAccessIssue?.message || 'Unable to resolve a project right now. Please try again.'}
                canCreateProject={Boolean(workspaceAccessIssue?.canCreateProject)}
                creatingProject={creatingProject}
                requestingAccess={requestingAccess}
                accessRequestSubmitted={accessRequested}
                onCreateProject={workspaceAccessIssue?.canCreateProject ? handleCreateProject : undefined}
                onRequestAccess={!workspaceAccessIssue?.canCreateProject ? (message: string) => handleRequestAccess(message, workspaceAccessIssue?.availableWorkspaceId) : undefined}
            />
        );
    }

    return (
        <AppShell
            tables={tables}
            workspaceId={workspaceId}
            refreshTables={loadTables}
            onWorkspaceChange={setWorkspaceId}
        />
    );
}

function App() {
    return (
        <HashRouter>
            <AppContent />
        </HashRouter>
    );
}

export default App;
