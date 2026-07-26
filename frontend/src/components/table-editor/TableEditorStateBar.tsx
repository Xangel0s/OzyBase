import React from 'react';

interface TableEditorStateBarProps {
    isDenseViewport: boolean;
    activeViewId: string | null;
    searchTerm: string;
    hiddenColumnCount: number;
    pinnedColumnNames: string[];
    filtersCount: number;
    sorts: Array<{ column?: string; direction?: string }>;
    selectedCount: number;
    onReset: () => void;
}

const TableEditorStateBar: React.FC<TableEditorStateBarProps> = ({
    isDenseViewport,
    activeViewId,
    searchTerm,
    hiddenColumnCount,
    pinnedColumnNames,
    filtersCount,
    sorts,
    selectedCount,
    onReset,
}) => {
    const visibleSorts = sorts.filter((sort) => sort.column && sort.direction);
    const hasState =
        hiddenColumnCount > 0 ||
        pinnedColumnNames.length > 0 ||
        filtersCount > 0 ||
        visibleSorts.length > 0 ||
        selectedCount > 0 ||
        searchTerm.trim() !== '' ||
        !!activeViewId;

    if (!hasState) {
        return null;
    }

    const pinnedLabel =
        pinnedColumnNames.length <= 2
            ? pinnedColumnNames.join(', ')
            : `${pinnedColumnNames.slice(0, 2).join(', ')} +${pinnedColumnNames.length - 2}`;

    return (
        <div className="border-b border-border bg-zinc-950 px-6 py-1.5">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                <span className="mr-1 italic shrink-0">Active:</span>
                {activeViewId && (
                    <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                        Saved View
                    </span>
                )}
                {searchTerm.trim() !== '' && (
                    <span className="shrink-0 rounded-md border border-border bg-zinc-900 px-2.5 py-1 text-zinc-300">
                        Search: {searchTerm.trim()}
                    </span>
                )}
                {hiddenColumnCount > 0 && (
                    <span className="shrink-0 rounded-md border border-border bg-zinc-900 px-2.5 py-1 text-zinc-400">
                        {hiddenColumnCount} hidden columns
                    </span>
                )}
                {pinnedColumnNames.length > 0 && (
                    <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                        Pinned: {pinnedLabel}
                    </span>
                )}
                {filtersCount > 0 && (
                    <span className="shrink-0 rounded-md border border-border bg-zinc-900 px-2.5 py-1 text-zinc-300">
                        {filtersCount} {filtersCount === 1 ? 'filter' : 'filters'}
                    </span>
                )}
                {visibleSorts.map((sort) => (
                    <span
                        key={`${sort.column}-${sort.direction}`}
                        className="shrink-0 rounded-md border border-border bg-zinc-900 px-2.5 py-1 text-zinc-300"
                    >
                        Sort: {sort.column} {sort.direction}
                    </span>
                ))}
                {selectedCount > 0 && (
                    <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                        {selectedCount} selected
                    </span>
                )}
                <button
                    onClick={onReset}
                    className="ml-auto shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1 text-zinc-500 transition-all hover:text-white hover:border-zinc-600 uppercase tracking-widest"
                >
                    Clear All
                </button>
            </div>
        </div>
    );
};

export default TableEditorStateBar;

