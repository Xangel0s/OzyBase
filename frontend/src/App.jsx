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

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('ozy_token'));
    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState(null);

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
            case 'overview': return <Overview onTableSelect={handleTableSelect} />;
            case 'sql': return <SQLEditor />;
            case 'auth': return <AuthManager />;
            case 'storage': return <StorageManager />;
            case 'edge': return <EdgeFunctions />;
            case 'realtime': return <RealtimeInspector />;
            case 'advisors': return <Advisors />;
            case 'observability': return <Observability />;
            case 'logs': return <LogsAnalytics />;
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
