import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import Layout from './Layout';
import { getViewMeta } from '../viewRegistry';
import { useTableTabs } from '../hooks/useTableTabs';
import { useViewRouting } from '../hooks/useViewRouting';

const lazyAny = (
  loader: () => Promise<{ default: React.ComponentType<any> }>,
): React.ComponentType<any> => lazy(loader) as React.ComponentType<any>;

const TableEditor = lazyAny(() => import('./TableEditor'));
const Overview = lazyAny(() => import('./Overview'));
const SqlTerminal = lazyAny(() => import('./SqlTerminal'));
const AuthManager = lazyAny(() => import('./AuthManager'));
const StorageManager = lazyAny(() => import('./StorageManager'));
const EdgeFunctions = lazyAny(() => import('./EdgeFunctions'));
const RealtimeInspector = lazyAny(() => import('./RealtimeInspector'));
const SchemaVisualizer = lazyAny(() => import('./SchemaVisualizer'));
const Settings = lazyAny(() => import('./Settings'));
const ApiDocs = lazyAny(() => import('./ApiDocs'));
const PermissionManager = lazyAny(() => import('./PermissionManager'));
const TwoFactorAuth = lazyAny(() => import('./TwoFactorAuth'));
const AuthProvidersView = lazyAny(() => import('./AuthProvidersView'));
const EmailTemplatesView = lazyAny(() => import('./EmailTemplatesView'));
const AuthSettingsView = lazyAny(() => import('./AuthSettingsView'));
const WorkspaceManager = lazyAny(() => import('./WorkspaceManager'));
const WorkspaceSettings = lazyAny(() => import('./WorkspaceSettings'));

interface AppShellProps {
  tables: any[];
  workspaceId: string | null;
  refreshTables: (signal?: AbortSignal) => void;
  onWorkspaceChange: (id: string | null) => void;
}

const AppShell: React.FC<AppShellProps> = ({
  tables,
  workspaceId,
  refreshTables,
  onWorkspaceChange,
}) => {
  const availableTableNames = useMemo(
    () =>
      (Array.isArray(tables) ? tables : [])
        .map((table: any) => String(table?.name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [tables],
  );

  const [, setUrlView] = useViewRouting();

  const {
    selectedView,
    setSelectedView,
    selectedTable,
    setSelectedTable,
    openTableTabs,
    handleTableSelect,
    handleCloseTab,
    handleOpenSqlEditor,
    initialSqlQuery,
  } = useTableTabs({
    scopeKey: workspaceId ? `workspace_${workspaceId}` : 'workspace_none',
    availableTables: availableTableNames,
  });

  // Sync selectedView to URL
  useEffect(() => {
    setUrlView(selectedView);
  }, [selectedView, setUrlView]);

  const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
  const [tableModalMode, setTableModalMode] = useState<'create' | 'edit'>(
    'create',
  );
  const [tableBeingEdited, setTableBeingEdited] = useState<any | null>(null);

  const renderView = () => {
    const viewMeta = getViewMeta(selectedView);
    const props = viewMeta.props || {};

    switch (viewMeta.component) {
      case 'TableEditor':
        return (
          <TableEditor
            tableName={selectedView === 'table' ? selectedTable : null}
            onTableSelect={handleTableSelect}
            onOpenSqlEditor={handleOpenSqlEditor}
            onViewSelect={setSelectedView}
            allTables={tables}
            openTableTabs={openTableTabs}
            onCloseTab={handleCloseTab}
            onRefreshTables={refreshTables}
            onOpenCreateTable={() => {
              setTableModalMode('create');
              setTableBeingEdited(null);
              setIsCreateTableModalOpen(true);
            }}
          />
        );
      case 'SchemaVisualizer':
        return (
          <SchemaVisualizer
            viewMode={
              selectedTable === '__visualizer_system__' ? 'system' : 'user'
            }
          />
        );
      case 'Overview':
        return (
          <Overview
            onTableSelect={handleTableSelect}
            onViewSelect={setSelectedView}
          />
        );
      case 'SqlTerminal':
        return (
          <SqlTerminal
            onSchemaChange={() => refreshTables()}
            initialTableName={selectedTable}
            initialQuery={initialSqlQuery}
          />
        );
      case 'AuthManager':
        return (
          <AuthManager
            view={String(props.view || 'users')}
            onViewSelect={setSelectedView}
          />
        );
      case 'AuthProvidersView':
        return <AuthProvidersView />;
      case 'TwoFactorAuth':
        return <TwoFactorAuth />;
      case 'EmailTemplatesView':
        return <EmailTemplatesView />;
      case 'AuthSettingsView':
        return <AuthSettingsView onViewSelect={setSelectedView} />;
      case 'StorageManager':
        return <StorageManager view={props.view} />;
      case 'EdgeFunctions':
        return <EdgeFunctions view={props.view} />;
      case 'RealtimeInspector':
        return <RealtimeInspector view={props.view} />;
      case 'PermissionManager':
        return <PermissionManager />;
      case 'Settings':
        return (
          <Settings
            view={String(props.view || 'general')}
            onViewSelect={setSelectedView}
          />
        );
      case 'ApiDocs':
        return <ApiDocs page={props.page} onViewSelect={setSelectedView} />;
      case 'WorkspaceManager':
        return (
          <WorkspaceManager
            onWorkspaceChange={onWorkspaceChange}
            onViewSelect={setSelectedView}
            view={String(props.view || 'wm_overview')}
          />
        );
      case 'WorkspaceSettings':
        return (
          <WorkspaceSettings
            workspaceId={workspaceId}
            onViewSelect={setSelectedView}
            onWorkspaceChange={onWorkspaceChange}
            view={String(props.view || 'ws_general')}
          />
        );
      default:
        return (
          <Overview
            onTableSelect={handleTableSelect}
            onViewSelect={setSelectedView}
          />
        );
    }
  };

  return (
    <Layout
      selectedView={selectedView}
      selectedTable={selectedTable}
      workspaceId={workspaceId}
      onTableSelect={handleTableSelect}
      tables={tables}
      refreshTables={refreshTables}
      onWorkspaceChange={onWorkspaceChange}
      onMenuViewSelect={(view: string) => {
        setSelectedView(view);
        if (view !== 'visualizer') {
          setSelectedTable(null);
        }
      }}
      isCreateTableModalOpen={isCreateTableModalOpen}
      setIsCreateTableModalOpen={setIsCreateTableModalOpen}
      tableModalMode={tableModalMode}
      setTableModalMode={setTableModalMode}
      tableBeingEdited={tableBeingEdited}
      setTableBeingEdited={setTableBeingEdited}
    >
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-transparent">
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-md border-2 border-primary/20 border-t-primary" />
              <span className="text-[9px] font-bold tracking-[0.2em] text-zinc-500 uppercase">
                Loading Module
              </span>
            </div>
          </div>
        }
      >
        {renderView()}
      </Suspense>
    </Layout>
  );
};

export default AppShell;
