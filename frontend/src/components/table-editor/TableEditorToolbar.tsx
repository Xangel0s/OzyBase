import React, { useEffect, useMemo, useRef } from 'react';
import {
    ArrowDownUp,
    ChevronDown,
    Columns3,
    Database,
    FileUp,
    Filter,
    Lightbulb,
    ListPlus,
    MousePointer2,
    Plus,
    RefreshCw,
    Search,
    Shield,
    SlidersHorizontal,
    Wifi,
    X,
} from 'lucide-react';
import OzySelect from '../OzySelect';
import TableEditorColumnsPanel from './TableEditorColumnsPanel';

interface TableEditorToolbarProps {
    isDenseViewport: boolean;
    currentTableLabel: string | null;
    tableName: string | null;
    allTables: any[];
    onTableSelect: (tableName: string) => void;
    isTableSwitcherOpen: boolean;
    setIsTableSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isViewsOpen: boolean;
    setIsViewsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    views: any[];
    activeViewId: string | null;
    applyView: (view: any) => void;
    viewName: string;
    setViewName: React.Dispatch<React.SetStateAction<string>>;
    onCreateView: () => Promise<void>;
    onUpdateView: () => Promise<void>;
    onSetDefaultView: () => Promise<void>;
    onDeleteView: () => Promise<void>;
    onResetViewControls: () => void;
    isInsertDropdownOpen: boolean;
    setIsInsertDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
    rowIdentityEnabled: boolean;
    rlsEnabled: boolean;
    onOpenInsertRow: () => void;
    onOpenAddColumn: () => void;
    handleCSVImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    csvInputRef: React.RefObject<HTMLInputElement | null>;
    isFilterOpen: boolean;
    setIsFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
    filters: any[];
    setFilters: React.Dispatch<React.SetStateAction<any[]>>;
    isSortOpen: boolean;
    setIsSortOpen: React.Dispatch<React.SetStateAction<boolean>>;
    schema: any[];
    sorts: any[];
    setSorts: React.Dispatch<React.SetStateAction<any[]>>;
    isColumnsPanelOpen: boolean;
    setIsColumnsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    visibleColumnCount: number;
    totalColumnCount: number;
    hiddenColumnCount: number;
    columnSearchTerm: string;
    setColumnSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    filteredColumnOptions: any[];
    hiddenColumnSet: Set<string>;
    pinnedColumnSet: Set<string>;
    primaryIdColumn: string;
    getTypeIcon: (type: string) => React.ReactNode;
    showAllColumns: () => void;
    resetColumnLayout: () => void;
    toggleColumnVisibility: (columnName: string) => void;
    togglePinnedColumn: (columnName: string) => void;
    realtimeEnabled: boolean;
    isRealtimeLoading: boolean;
    onToggleRealtime: () => void | Promise<void>;
    onOpenPolicies: () => void;
    onOpenDefinition: () => void;
    searchTerm: string;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    fetchData: () => Promise<void>;
    loading: boolean;
    onResetDataView: () => void;
}

const TableEditorToolbar: React.FC<TableEditorToolbarProps> = ({
    isDenseViewport,
    currentTableLabel,
    tableName,
    allTables = [],
    onTableSelect,
    isTableSwitcherOpen,
    setIsTableSwitcherOpen,
    isViewsOpen,
    setIsViewsOpen,
    views = [],
    activeViewId,
    applyView,
    viewName,
    setViewName,
    onCreateView,
    onUpdateView,
    onSetDefaultView,
    onDeleteView,
    onResetViewControls,
    isInsertDropdownOpen,
    setIsInsertDropdownOpen,
    rowIdentityEnabled,
    rlsEnabled,
    onOpenInsertRow,
    onOpenAddColumn,
    handleCSVImport,
    csvInputRef,
    isFilterOpen,
    setIsFilterOpen,
    filters = [],
    setFilters,
    isSortOpen,
    setIsSortOpen,
    schema = [],
    sorts = [],
    setSorts,
    isColumnsPanelOpen,
    setIsColumnsPanelOpen,
    visibleColumnCount,
    totalColumnCount,
    hiddenColumnCount,
    columnSearchTerm,
    setColumnSearchTerm,
    filteredColumnOptions,
    hiddenColumnSet,
    pinnedColumnSet,
    primaryIdColumn,
    getTypeIcon,
    showAllColumns,
    resetColumnLayout,
    toggleColumnVisibility,
    togglePinnedColumn,
    realtimeEnabled,
    isRealtimeLoading,
    onToggleRealtime,
    onOpenPolicies,
    onOpenDefinition,
    searchTerm = '',
    setSearchTerm,
    fetchData,
    loading,
    onResetDataView,
}) => {
    const filterPanelRef = useRef<HTMLDivElement | null>(null);
    const sortPanelRef = useRef<HTMLDivElement | null>(null);
    const activeSortCount = useMemo(
        () => sorts.filter((sort) => sort.column && sort.direction).length,
        [sorts],
    );
    const activeFilterCount = useMemo(
        () => filters.filter((filter) => filter.column && filter.value !== undefined && filter.value !== '').length,
        [filters],
    );
    const isSystemTable = useMemo(() => {
        const currentEntry = allTables.find((entry: any) => entry.name === tableName);
        return Boolean(currentEntry?.is_system || tableName?.startsWith('_v_') || tableName?.startsWith('_ozy_'));
    }, [allTables, tableName]);
    const scopedTableOptions = useMemo(
        () =>
            allTables.filter((entry: any) =>
                isSystemTable
                    ? Boolean(entry?.is_system || entry?.name?.startsWith('_v_') || entry?.name?.startsWith('_ozy_'))
                    : !(entry?.is_system || entry?.name?.startsWith('_v_') || entry?.name?.startsWith('_ozy_')),
            ),
        [allTables, isSystemTable],
    );
    const compactClass = isDenseViewport ? 'px-2.5 py-1.5 text-[9px]' : 'px-3 py-1.5 text-[10px]';
    const buttonClass = `inline-flex items-center gap-2 rounded-md border border-border bg-zinc-900/40 ${compactClass} font-bold uppercase tracking-widest text-zinc-400 transition-all hover:border-zinc-700 hover:text-white shrink-0`;
    const FILTER_OPS = [
        { label: 'Equals', value: 'eq' },
        { label: 'Not equal', value: 'neq' },
        { label: 'Greater than', value: 'gt' },
        { label: 'Greater or equal', value: 'gte' },
        { label: 'Less than', value: 'lt' },
        { label: 'Less or equal', value: 'lte' },
        { label: 'Contains', value: 'ilike' },
    ];

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (filterPanelRef.current?.contains(target) || sortPanelRef.current?.contains(target)) {
                return;
            }
            setIsFilterOpen(false);
            setIsSortOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [setIsFilterOpen, setIsSortOpen]);

    return (
        <div className="shrink-0 bg-[#111111] border-b border-zinc-800">
            {/* SEARCH ROW */}
            <div className="px-6 py-3 border-b border-zinc-900">
                <div className="relative w-full group font-sans">
                    <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={16} />
                    <input
                        type="text"
                        placeholder={`Filter by ${primaryIdColumn || 'id'}, ${schema[1]?.name || 'name'}... or ask AI`}
                        value={searchTerm}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(event.target.value)}
                        className="w-full bg-transparent pl-8 pr-3 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none transition-all"
                    />
                </div>
            </div>

            {/* ACTIONS ROW */}
            <div className="flex items-center justify-between px-6 py-2 bg-[#111111]">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    {/* FILTER */}
                    <div className="relative" ref={filterPanelRef}>
                        <button
                            onClick={() => {
                                setIsSortOpen(false);
                                setIsFilterOpen((current) => !current);
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                                isFilterOpen || filters.length > 0
                                    ? 'border-primary/30 bg-primary/10 text-primary'
                                    : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                            }`}
                        >
                            <Filter size={14} />
                            <span>Filter</span>
                            {filters.length > 0 && (
                                <span className="ml-1 rounded-full bg-primary text-black w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                                    {filters.length}
                                </span>
                            )}
                        </button>
                        <TableEditorFilterPanel
                            isOpen={isFilterOpen}
                            onClose={() => setIsFilterOpen(false)}
                            schema={schema}
                            filters={filters}
                            setFilters={setFilters}
                        />
                    </div>

                    {/* SORT */}
                    <div className="relative" ref={sortPanelRef}>
                        <button
                            onClick={() => {
                                setIsFilterOpen(false);
                                setIsSortOpen((current) => !current);
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                                isSortOpen || sorts.length > 0
                                    ? 'border-primary/30 bg-primary/10 text-primary'
                                    : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                            }`}
                        >
                            <ArrowDownUp size={14} />
                            <span>Sort</span>
                            {sorts.length > 0 && (
                                <span className="ml-1 rounded-full bg-primary text-black w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                                    {sorts.length}
                                </span>
                            )}
                        </button>
                        <TableEditorSortPanel
                            isOpen={isSortOpen}
                            onClose={() => setIsSortOpen(false)}
                            schema={schema}
                            sorts={sorts}
                            setSorts={setSorts}
                        />
                    </div>

                    <div className="h-4 w-px bg-zinc-800 mx-1" />

                    {/* RLS POLICIES */}
                    <button
                        onClick={onOpenPolicies}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                            rlsEnabled
                                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                                : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                    >
                        <Shield size={14} />
                        <span className="flex items-center gap-1.5">
                            <span className="bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 font-bold tracking-tighter">4</span>
                            RLS policies
                        </span>
                    </button>

                    <div className="h-4 w-px bg-zinc-800 mx-1" />

                    {/* REALTIME TOGGLE */}
                    <button
                        onClick={onToggleRealtime}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                            realtimeEnabled
                                ? 'border-primary/30 bg-primary/10 text-primary shadow-[0_0_10px_rgba(62,207,142,0.1)]'
                                : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                    >
                        <Wifi size={14} className={realtimeEnabled ? 'animate-pulse' : ''} />
                        <span>{realtimeEnabled ? 'Realtime on' : 'Realtime off'}</span>
                    </button>

                    {/* ROLE SELECTOR */}
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-500">
                        <span>Role</span>
                        <button className="flex items-center gap-1.5 px-2 py-0.5 bg-[#0c0c0c] border border-zinc-800 rounded text-zinc-300 hover:border-zinc-700 transition-all">
                            postgres
                            <ChevronDown size={12} className="text-zinc-600" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-4">
                    {/* FIELDS (COLUMNS) */}
                    <button
                        onClick={() => setIsColumnsPanelOpen((current) => !current)}
                        className={`p-2 rounded-lg border transition-all ${
                            isColumnsPanelOpen
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                        title="Manage columns"
                    >
                        <Columns3 size={16} />
                    </button>

                    {/* REFRESH */}
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="p-2 rounded-lg border border-zinc-800 bg-[#161616] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all disabled:opacity-50"
                        title="Refresh data"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>

                    {/* INSERT */}
                    <div className="relative">
                        <button
                            onClick={() => setIsInsertDropdownOpen(!isInsertDropdownOpen)}
                            className="flex items-center gap-2 rounded-lg bg-[#d2f20b] hover:bg-[#c0e00a] px-4 py-1.5 text-xs font-bold text-black transition-all shadow-[0_2px_10px_rgba(210,242,11,0.2)] ml-2"
                        >
                            <Plus size={14} strokeWidth={3} />
                            Insert
                            <ChevronDown size={12} className={`ml-1 opacity-70 transition-transform ${isInsertDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isInsertDropdownOpen && (
                            <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-zinc-800 bg-[#161616] shadow-2xl animate-in fade-in slide-in-from-top-1 duration-100">
                                <div className="space-y-0.5 p-1.5">
                                    <button
                                        onClick={() => {
                                            onOpenInsertRow();
                                            setIsInsertDropdownOpen(false);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                                    >
                                        <Plus size={14} /> Insert Row
                                    </button>
                                    <button
                                        onClick={() => {
                                            onOpenAddColumn();
                                            setIsInsertDropdownOpen(false);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                                    >
                                        <Columns3 size={14} /> Add Column
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <TableEditorColumnsPanel
                isOpen={isColumnsPanelOpen}
                onClose={() => setIsColumnsPanelOpen(false)}
                visibleColumnCount={visibleColumnCount}
                totalColumnCount={totalColumnCount}
                hiddenColumnCount={hiddenColumnCount}
                columnSearchTerm={columnSearchTerm}
                setColumnSearchTerm={setColumnSearchTerm}
                filteredColumnOptions={filteredColumnOptions}
                rowIdentityEnabled={rowIdentityEnabled}
                hiddenColumnSet={hiddenColumnSet}
                pinnedColumnSet={pinnedColumnSet}
                getTypeIcon={getTypeIcon}
                showAllColumns={showAllColumns}
                resetColumnLayout={resetColumnLayout}
                toggleColumnVisibility={toggleColumnVisibility}
                togglePinnedColumn={togglePinnedColumn}
                openAddColumn={() => {
                    setIsColumnsPanelOpen(false);
                    onOpenAddColumn();
                }}
            />
        </div>
    );
};

// --- Sub-components for Panels ---

const TableEditorSortPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    schema: any[];
    sorts: any[];
    setSorts: (sorts: any[]) => void;
}> = ({ isOpen, onClose, schema, sorts, setSorts }) => {
    if (!isOpen) return null;

    const addSort = () => {
        const firstCol = schema[0]?.name;
        if (!firstCol) return;
        setSorts([...sorts, { column: firstCol, direction: 'asc' }]);
    };

    const removeSort = (index: number) => {
        const next = [...sorts];
        next.splice(index, 1);
        setSorts(next);
    };

    const updateSort = (index: number, updates: any) => {
        const next = [...sorts];
        next[index] = { ...next[index], ...updates };
        setSorts(next);
    };

    return (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-zinc-800 bg-[#111111] shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Sort by</span>
                <button onClick={onClose} className="text-zinc-600 hover:text-white"><X size={14} /></button>
            </div>
            <div className="max-h-60 overflow-y-auto p-3 space-y-2">
                {sorts.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 italic text-center py-4">No sorts applied</p>
                ) : (
                    sorts.map((sort, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <select
                                value={sort.column}
                                onChange={(e) => updateSort(i, { column: e.target.value })}
                                className="flex-1 bg-[#0c0c0c] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-primary/50"
                            >
                                {schema.map((col) => (
                                    <option key={col.name} value={col.name}>{col.name}</option>
                                ))}
                            </select>
                            <select
                                value={sort.direction}
                                onChange={(e) => updateSort(i, { direction: e.target.value })}
                                className="w-20 bg-[#0c0c0c] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-primary/50"
                            >
                                <option value="asc">Asc</option>
                                <option value="desc">Desc</option>
                            </select>
                            <button onClick={() => removeSort(i)} className="text-zinc-600 hover:text-red-400 p-1"><X size={12} /></button>
                        </div>
                    ))
                )}
            </div>
            <div className="border-t border-zinc-800 p-2">
                <button
                    onClick={addSort}
                    className="flex w-full items-center justify-center gap-2 rounded bg-zinc-900 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                >
                    <Plus size={12} /> Add sort
                </button>
            </div>
        </div>
    );
};

const TableEditorFilterPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    schema: any[];
    filters: any[];
    setFilters: (filters: any[]) => void;
}> = ({ isOpen, onClose, schema, filters, setFilters }) => {
    if (!isOpen) return null;

    const FILTER_OPS = [
        { label: 'Equals', value: 'eq' },
        { label: 'Not equal', value: 'neq' },
        { label: 'Greater than', value: 'gt' },
        { label: 'Greater or equal', value: 'gte' },
        { label: 'Less than', value: 'lt' },
        { label: 'Less or equal', value: 'lte' },
        { label: 'Contains', value: 'ilike' },
    ];

    const addFilter = () => {
        const firstCol = schema[0]?.name;
        if (!firstCol) return;
        setFilters([...filters, { column: firstCol, op: 'eq', value: '' }]);
    };

    const removeFilter = (index: number) => {
        const next = [...filters];
        next.splice(index, 1);
        setFilters(next);
    };

    const updateFilter = (index: number, updates: any) => {
        const next = [...filters];
        next[index] = { ...next[index], ...updates };
        setFilters(next);
    };

    return (
        <div className="absolute left-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-lg border border-zinc-800 bg-[#111111] shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Filters</span>
                <button onClick={onClose} className="text-zinc-600 hover:text-white"><X size={14} /></button>
            </div>
            <div className="max-h-80 overflow-y-auto p-3 space-y-2">
                {filters.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 italic text-center py-4">No filters applied</p>
                ) : (
                    filters.map((filter, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <select
                                value={filter.column}
                                onChange={(e) => updateFilter(i, { column: e.target.value })}
                                className="w-1/3 bg-[#0c0c0c] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-primary/50"
                            >
                                {schema.map((col) => (
                                    <option key={col.name} value={col.name}>{col.name}</option>
                                ))}
                            </select>
                            <select
                                value={filter.op}
                                onChange={(e) => updateFilter(i, { op: e.target.value })}
                                className="w-1/4 bg-[#0c0c0c] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-primary/50"
                            >
                                {FILTER_OPS.map((op) => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                ))}
                            </select>
                            <input
                                type="text"
                                value={filter.value}
                                onChange={(e) => updateFilter(i, { value: e.target.value })}
                                placeholder="Value..."
                                className="flex-1 min-w-0 bg-[#0c0c0c] border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-primary/50"
                            />
                            <button onClick={() => removeFilter(i)} className="text-zinc-600 hover:text-red-400 p-1"><X size={12} /></button>
                        </div>
                    ))
                )}
            </div>
            <div className="border-t border-zinc-800 p-2">
                <button
                    onClick={addFilter}
                    className="flex w-full items-center justify-center gap-2 rounded bg-zinc-900 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                >
                    <Plus size={12} /> Add filter
                </button>
            </div>
        </div>
    );
};

export default TableEditorToolbar;
