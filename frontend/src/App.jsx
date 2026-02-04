import React, { useState, useEffect } from 'react'
import Layout from './components/Layout'
import TableEditor from './components/TableEditor'
import Login from './components/Login'

import Overview from './components/Overview'
import SQLEditor from './components/SQLEditor'
import AuthManager from './components/AuthManager'
import StorageManager from './components/StorageManager'
import EdgeFunctions from './components/EdgeFunctions'
import RealtimeInspector from './components/RealtimeInspector'
import Advisors from './components/Advisors'
import Observability from './components/Observability'
import LogsAnalytics from './components/LogsAnalytics'
import SchemaVisualizer from './components/SchemaVisualizer';

import Settings from './components/Settings'
import ApiDocs from './components/ApiDocs'
import Integrations from './components/Integrations'
import SecurityManager from './components/SecurityManager'
import SecurityDashboard from './components/SecurityDashboard'
import PermissionManager from './components/PermissionManager'
import NotificationSettings from './components/NotificationSettings'
import TwoFactorAuth from './components/TwoFactorAuth'
import IntegrationsManager from './components/IntegrationsManager'
import SetupWizard from './components/SetupWizard'
import FirewallManager from './components/FirewallManager'

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('ozy_token'));
    const [isSystemInitialized, setIsSystemInitialized] = useState(true); // Default true to avoid flash
    const [checkingSystem, setCheckingSystem] = useState(true);
    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState(null);

    useEffect(() => {
        checkSystemStatus();
    }, []);

    const checkSystemStatus = async () => {
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
    };

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
            localStorage.setItem('ozy_token', token);
            // Clear URL params without reload
            window.history.replaceState({}, document.title, window.location.pathname);
            setIsAuthenticated(true);
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

    const handleTableSelect = (tableName) => {
        setSelectedTable(tableName);
        setSelectedView(tableName === '__visualizer__' ? 'visualizer' : 'table');
    };

    const renderView = () => {
        switch (selectedView) {
            case 'table': return <TableEditor tableName={selectedTable} />;
            case 'tables': return <TableEditor tableName={null} />;
            case 'visualizer': return <SchemaVisualizer />;
            case 'overview': return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
            case 'sql': return <SQLEditor />;
            case 'auth': return <AuthManager />;
            case 'storage': return <StorageManager />;
            case 'edge': return <EdgeFunctions />;
            case 'realtime': return <RealtimeInspector />;
            case 'advisors': return <Advisors />;
            case 'observability': return <Observability />;
            case 'logs': return <LogsAnalytics />;
            case 'policies': return <PermissionManager />;
            case 'security': return <SecurityDashboard />;
            case 'security_policies': return <SecurityManager />;
            case 'firewall': return <FirewallManager />;
            case 'security_notifications': return <NotificationSettings />;
            case 'integrations': return <IntegrationsManager />;
            case 'two_factor': return <TwoFactorAuth />;
            case 'settings': return <Settings />;
            case 'docs':
            case 'intro':
            case 'auth_api':
            case 'db_api':
            case 'storage_api':
            case 'realtime_api':
            case 'edge_api':
            case 'sdk':
                return <ApiDocs page={selectedView === 'docs' ? 'intro' : selectedView} />;
            case 'integrations':
            case 'wrappers':
            case 'webhooks':
            case 'cron':
            case 'extensions':
            case 'vault':
            case 'graphql':
                return <Integrations page={selectedView === 'integrations' ? 'wrappers' : selectedView} />;
            default: return <Overview onTableSelect={handleTableSelect} />;
        }
    };

    return (
        <Layout
            selectedView={selectedView}
            selectedTable={selectedTable}
            onTableSelect={handleTableSelect}
            onMenuViewSelect={(view) => {
                setSelectedView(view);
                setSelectedTable(null);
            }}
        >
            {renderView()}
        </Layout>
    )
}

export default App
