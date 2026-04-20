import React from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import OzySelect from '../OzySelect';

interface TableEditorFooterProps {
    isDenseViewport: boolean;
    totalRecords: number;
    hasMoreRecords: boolean;
    isTotalExact: boolean;
    visibleColumnCount: number;
    totalColumnCount: number;
    pageStartRecord: number;
    pageEndRecord: number;
    pageSize: number;
    pageSizeOptions: number[];
    setPageSize: (pageSize: number) => void;
    currentPage: number;
    totalPages: number;
    goToPage: (page: number) => void;
    pageJumpInput: string;
    setPageJumpInput: (value: string) => void;
    onOpenDefinition?: () => void;
    tableName: string | null;
    realtimeEnabled: boolean;
    onExportCSV: () => void;
}

const formatNumber = (value: number) => value.toLocaleString();

const TableEditorFooter: React.FC<TableEditorFooterProps> = ({
    isDenseViewport,
    totalRecords,
    hasMoreRecords,
    isTotalExact,
    visibleColumnCount,
    totalColumnCount,
    pageStartRecord,
    pageEndRecord,
    pageSize,
    pageSizeOptions,
    setPageSize,
    currentPage,
    totalPages,
    goToPage,
    pageJumpInput,
    setPageJumpInput,
    onOpenDefinition,
    tableName,
    realtimeEnabled,
    onExportCSV,
}) => {
    const pageCountLabel = isTotalExact ? String(Math.max(totalPages, 1)) : hasMoreRecords ? '+' : String(currentPage);
    const recordsLabel = isTotalExact
        ? `${formatNumber(pageStartRecord)}-${formatNumber(pageEndRecord)} / ${formatNumber(totalRecords)} records`
        : `${formatNumber(pageStartRecord)}-${formatNumber(pageEndRecord)} / ${formatNumber(Math.max(pageEndRecord, totalRecords))}+ records`;

    return (
        <div
            data-testid="table-editor-footer"
            className="border-t border-border bg-[#111111] px-6 py-1.5"
        >
            <div className="flex items-center justify-between gap-6">
                {/* Left Section: Pagination */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        disabled={currentPage === 1}
                        onClick={() => goToPage(currentPage - 1)}
                        className="p-1.5 text-zinc-600 hover:text-white transition-colors disabled:opacity-20"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span>Page</span>
                        <span className="text-zinc-200 font-medium">{currentPage}</span>
                        <span>of</span>
                        <span className="text-zinc-200 font-medium">{Math.max(totalPages, 1)}</span>
                    </div>
                    <button
                        disabled={isTotalExact ? currentPage >= totalPages : !hasMoreRecords}
                        onClick={() => goToPage(currentPage + 1)}
                        className="p-1.5 text-zinc-600 hover:text-white transition-colors disabled:opacity-20"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Center Section: Stats */}
                <div className="flex items-center gap-4 text-xs font-medium">
                    <div className="flex items-center gap-2">
                        <OzySelect
                            density="compact"
                            value={pageSize}
                            onChange={(event) => setPageSize(Number(event.target.value))}
                            wrapperClassName="border-none bg-transparent shadow-none"
                            selectClassName="h-6 px-1 text-xs text-zinc-300 hover:text-white focus:ring-0"
                        >
                            {pageSizeOptions.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </OzySelect>
                        <span className="text-zinc-600">rows</span>
                    </div>
                    <div className="w-px h-3 bg-zinc-800" />
                    <div className="flex items-center gap-1">
                        <span className="text-zinc-300">{formatNumber(totalRecords)}</span>
                        <span className="text-zinc-600">records</span>
                    </div>
                </div>

                {/* Right Section: View Toggle */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-[#0c0c0c] border border-zinc-800 rounded-lg p-0.5 overflow-hidden">
                        <button
                            className="px-3 py-1 text-[11px] font-bold text-zinc-100 bg-zinc-900 rounded-md shadow-sm"
                        >
                            Data
                        </button>
                        <button
                            onClick={() => onOpenDefinition?.()}
                            disabled={!tableName}
                            className="px-3 py-1 text-[11px] font-bold text-zinc-600 hover:text-zinc-400 disabled:opacity-30 transition-colors"
                        >
                            Definition
                        </button>
                    </div>

                    <button
                        onClick={onExportCSV}
                        className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Export CSV"
                    >
                        <Download size={16} />
                    </button>
                </div>
            </div>
        </div>

    );
};

export default TableEditorFooter;

