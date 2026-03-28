import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react'
import Layout from './components/Layout'
import Login from './components/Login'
import { fetchWithAuth } from './utils/api'
import { getViewMeta } from './viewRegistry'

// Dynamic imports for bundle optimization (bundle-dynamic-imports)
const TableEditor = lazy(() => import('./components/TableEditor'));
const Overview = lazy(() => import('./components/Overview'));
const SqlTerminal = lazy(() => import('./components/SqlTerminal'));
const AuthManager = lazy(() => import('./components/AuthManager'));
const StorageManager = lazy(() => import('./components/StorageManager'));
const EdgeFunctions = lazy(() => import('./components/EdgeFunctions'));
const RealtimeInspector = lazy(() => import('./components/RealtimeInspector'));
const Advisors = lazy(() => import('./components/Advisors'));
const Observability = lazy(() => import('./components/Observability'));
const LogsAnalytics = lazy(() => import('./components/LogsAnalytics'));
const SchemaVisualizer = lazy(() => import('./components/SchemaVisualizer'));
const Settings = lazy(() => import('./components/Settings'));
const ApiDocs = lazy(() => import('./components/ApiDocs'));
const Integrations = lazy(() => import('./components/Integrations'));
const SecurityManager = lazy(() => import('./components/SecurityManager'));
const SecurityDashboard = lazy(() => import('./components/SecurityDashboard'));
const PermissionManager = lazy(() => import('./components/PermissionManager'));
const NotificationSettings = lazy(() => import('./components/NotificationSettings'));
const TwoFactorAuth = lazy(() => import('./components/TwoFactorAuth'));
const IntegrationsManager = lazy(() => import('./components/IntegrationsManager'));
const AuthProvidersView = lazy(() => import('./components/AuthProvidersView'));
const EmailTemplatesView = lazy(() => import('./components/EmailTemplatesView'));
const AuthSettingsView = lazy(() => import('./components/AuthSettingsView'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));
const FirewallManager = lazy(() => import('./components/FirewallManager'));
const WorkspaceManager = lazy(() => import('./components/WorkspaceManager'));
const WorkspaceSettings = lazy(() => import('./components/WorkspaceSettings'));

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('ozy_token'));
    const [isSystemInitialized, setIsSystemInitialized] = useState(true);
    const [checkingSystem, setCheckingSystem] = useState(true);
    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState(null);
    const [tables, setTables] = useState([]);
    const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('ozy_workspace_id'));

    const loadTables = useCallback(() => {
        fetchWithAuth('/api/collections')
            .then(res => res.json())
            .then(data => setTables(Array.isArray(data) ? data : []))
            .catch(err => console.error("Failed to load tables", err));
    }, []);

    const checkSystemStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/system/status');
            if (res.ok) {
                const data = await res.json();
                setIsSystemInitialized(data.initialized);
            }
        } catch (e) {
            console.error("Failed to check system status", e);
        } finally {
            setCheckingSystem(false);
        }
    }, []);

    useEffect(() => {
        checkSystemStatus();
        if (isAuthenticated) {
            loadTables();
        }
    }, [isAuthenticated, workspaceId, loadTables, checkSystemStatus]);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
            localStorage.setItem('ozy_token', token);
            window.history.replaceState({}, document.title, window.location.pathname);
            setIsAuthenticated(true);
        }
    }, []);

    const handleTableSelect = useCallback((tableName) => {
        setSelectedTable(tableName);
        if (tableName === '__visualizer__' || tableName === '__visualizer_system__') {
            setSelectedView('visualizer');
        } else if (tableName) {
            setSelectedView('table');
        }
    }, []);

    if (checkingSystem) {
        return <div className="h-screen w-screen flex items-center justify-center bg-black text-white">Loading OzyBase...</div>;
    }

    if (!isSystemInitialized) {
        return <SetupWizard onComplete={(token) => {
            if (token) {
                localStorage.setItem('ozy_token', token);
                setIsAuthenticated(true);
            }
            setIsSystemInitialized(true);
        }} />;
    }

    if (!isAuthenticated) {
        return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
    }

    const renderView = () => {
        const viewMeta = getViewMeta(selectedView);
        const props = viewMeta.props || {};

        switch (viewMeta.component) {
            case 'TableEditor':
                return <TableEditor tableName={selectedView === 'table' ? selectedTable : null} onTableSelect={handleTableSelect} allTables={tables} />;
            case 'SchemaVisualizer':
                return <SchemaVisualizer viewMode={selectedTable === '__visualizer_system__' ? 'system' : 'user'} />;
            case 'Overview':
                return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
            case 'SqlTerminal':
                return <SqlTerminal />;
            case 'AuthManager':
                return <AuthManager view={props.view} onViewSelect={setSelectedView} />;
            case 'AuthProvidersView':
                return <AuthProvidersView />;
            case 'TwoFactorAuth':
                return <TwoFactorAuth />;
            case 'EmailTemplatesView':
                return <EmailTemplatesView />;
            case 'AuthSettingsView':
                return <AuthSettingsView />;
            case 'StorageManager':
                return <StorageManager view={props.view} />;
            case 'EdgeFunctions':
                return <EdgeFunctions view={props.view} />;
            case 'RealtimeInspector':
                return <RealtimeInspector view={props.view} />;
            case 'Advisors':
                return <Advisors />;
            case 'Observability':
                return <Observability onViewSelect={setSelectedView} />;
            case 'LogsAnalytics':
                return <LogsAnalytics view={props.view} />;
            case 'PermissionManager':
                return <PermissionManager />;
            case 'SecurityDashboard':
                return <SecurityDashboard />;
            case 'SecurityManager':
                return <SecurityManager />;
            case 'FirewallManager':
                return <FirewallManager />;
            case 'NotificationSettings':
                return <NotificationSettings />;
            case 'Settings':
                return <Settings view={props.view} onViewSelect={setSelectedView} />;
            case 'ApiDocs':
                return <ApiDocs page={props.page} />;
            case 'Integrations':
                return <Integrations page={props.page} />;
            case 'IntegrationsManager':
                return <IntegrationsManager />;
            case 'WorkspaceManager':
                return <WorkspaceManager onWorkspaceChange={(id) => setWorkspaceId(id)} onViewSelect={setSelectedView} view={props.view} />;
            case 'WorkspaceSettings':
                return <WorkspaceSettings workspaceId={workspaceId} onViewSelect={setSelectedView} onWorkspaceChange={(id) => setWorkspaceId(id)} view={props.view} />;
            default:
                return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
        }
    };

    return (
        <Layout
            selectedView={selectedView}
            selectedTable={selectedTable}
            workspaceId={workspaceId}
            onTableSelect={handleTableSelect}
            tables={tables}
            refreshTables={loadTables}
            onWorkspaceChange={(id) => setWorkspaceId(id)}
            onMenuViewSelect={(view) => {
                setSelectedView(view);
                setSelectedTable(null);
            }}
        >
            <Suspense fallback={
                <div className="h-full w-full flex items-center justify-center bg-transparent">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Loading Module...</span>
                    </div>
                </div>
            }>
                {renderView()}
            </Suspense>
        </Layout>
    );
}

export default App;
