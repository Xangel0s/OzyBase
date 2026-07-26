import React from 'react';
import { Pin, Search } from 'lucide-react';

interface ColumnOption {
    name: string;
    type: string;
}

interface TableEditorColumnsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    visibleColumnCount: number;
    totalColumnCount: number;
    hiddenColumnCount: number;
    columnSearchTerm: string;
    setColumnSearchTerm: (value: string) => void;
    filteredColumnOptions: ColumnOption[];
    rowIdentityEnabled: boolean;
    hiddenColumnSet: Set<string>;
    pinnedColumnSet: Set<string>;
    getTypeIcon: (type: string) => React.ReactNode;
    showAllColumns: () => void;
    resetColumnLayout: () => void;
    toggleColumnVisibility: (columnName: string) => void;
    togglePinnedColumn: (columnName: string) => void;
    openAddColumn: () => void;
}

const TableEditorColumnsPanel: React.FC<TableEditorColumnsPanelProps> = ({
    isOpen,
    onClose,
    visibleColumnCount,
    totalColumnCount,
    hiddenColumnCount,
    columnSearchTerm,
    setColumnSearchTerm,
    filteredColumnOptions,
    rowIdentityEnabled,
    hiddenColumnSet,
    pinnedColumnSet,
    getTypeIcon,
    showAllColumns,
    resetColumnLayout,
    toggleColumnVisibility,
    togglePinnedColumn,
    openAddColumn,
}) => {
    if (!isOpen) {
        return null;
    }

    return (
        <>
            <div className="fixed inset-0 z-40 outline-none" onClick={onClose} />
            <div className="absolute right-0 top-full z-50 mt-1.5 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl sm:left-0 sm:right-auto">
                <div className="border-b border-border px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest italic">Columns</p>
                            <p className="mt-1 text-[11px] font-bold text-zinc-300 uppercase tracking-tight">
                                {visibleColumnCount}/{totalColumnCount} ACTIVE
                                {hiddenColumnCount > 0 && <span className="text-zinc-600"> · {hiddenColumnCount} HIDDEN</span>}
                            </p>
                        </div>
                        <button
                            onClick={openAddColumn}
                            className="rounded-md border border-border bg-zinc-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-all hover:text-white hover:border-zinc-600"
                        >
                            Add Column
                        </button>
                    </div>
                    <div className="relative mt-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700" size={12} />
                        <input
                            type="text"
                            value={columnSearchTerm}
                            onChange={(event) => setColumnSearchTerm(event.target.value)}
                            placeholder="Search columns..."
                            className="w-full rounded-md border border-border bg-zinc-950 py-2 pl-9 pr-3 text-[10px] font-bold uppercase tracking-tight text-white placeholder:text-zinc-800 focus:border-primary/30 focus:outline-none"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 border-b border-border bg-zinc-900/50 px-4 py-3">
                    <button
                        onClick={showAllColumns}
                        className="rounded-md border border-border bg-zinc-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-all hover:text-white hover:border-zinc-600"
                    >
                        Show All
                    </button>
                    <button
                        onClick={resetColumnLayout}
                        className="rounded-md border border-border bg-zinc-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-all hover:text-zinc-300 hover:border-zinc-600"
                    >
                        Reset
                    </button>
                </div>

                <div className="max-h-80 overflow-y-auto custom-scrollbar p-1.5 bg-zinc-950/50">
                    {filteredColumnOptions.length === 0 ? (
                        <div className="px-3 py-8 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700 italic">
                            No columns found
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {filteredColumnOptions.map((column) => {
                                const isIdentityColumn = rowIdentityEnabled && column.name === 'id';
                                const isPinned = isIdentityColumn || pinnedColumnSet.has(column.name);
                                const checked = isIdentityColumn || !hiddenColumnSet.has(column.name);

                                return (
                                    <div
                                        key={column.name}
                                        data-testid={`column-option-${column.name}`}
                                        className={`group flex items-center gap-3 rounded-md px-3 py-2 transition-all ${
                                            checked ? 'bg-zinc-900/50 text-zinc-300' : 'text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400'
                                        }`}
                                    >
                                        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                                            <input
                                                data-testid={`column-visibility-${column.name}`}
                                                type="checkbox"
                                                checked={checked}
                                                disabled={isIdentityColumn}
                                                onChange={() => toggleColumnVisibility(column.name)}
                                                className="peer h-4 w-4 rounded-sm border-zinc-700 bg-zinc-950 text-primary focus:ring-0 focus:ring-offset-0 disabled:opacity-30"
                                            />
                                        </div>
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <div className="text-zinc-600 group-hover:text-primary transition-colors shrink-0">
                                                {getTypeIcon(column.type)}
                                            </div>
                                            <div className="min-w-0 flex flex-col">
                                                <span className="truncate text-[10px] font-bold uppercase tracking-widest">{column.name}</span>
                                                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-tighter">{column.type || 'TEXT'}</span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            data-testid={`column-freeze-${column.name}`}
                                            onClick={() => togglePinnedColumn(column.name)}
                                            disabled={isIdentityColumn}
                                            className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[9px] font-bold uppercase tracking-widest transition-all ${
                                                isPinned
                                                    ? 'border-primary/30 bg-primary/10 text-primary'
                                                    : 'border-border bg-zinc-900 text-zinc-600 hover:border-zinc-700 hover:text-zinc-300 opacity-0 group-hover:opacity-100'
                                            } ${isIdentityColumn ? 'cursor-not-allowed opacity-30!' : ''}`}
                                        >
                                            <Pin size={10} strokeWidth={isPinned ? 3 : 2} />
                                            <span>{isPinned ? 'Pinned' : 'Pin'}</span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default TableEditorColumnsPanel;

