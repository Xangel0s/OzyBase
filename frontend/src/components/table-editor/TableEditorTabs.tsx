import React from 'react';
import { X, Plus, Table2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface TableEditorTabsProps {
    openTabs: string[];
    activeTab: string | null;
    onTabSelect: (tableName: string) => void;
    onTabClose: (tableName: string) => void;
    onNewTable: () => void;
}

const TableEditorTabs: React.FC<TableEditorTabsProps> = ({
    openTabs,
    activeTab,
    onTabSelect,
    onTabClose,
    onNewTable
}) => {
    return (
        <div className="flex items-center h-10 bg-[#0c0c0c] border-b border-border px-2 gap-1 overflow-x-auto scrollbar-hide shrink-0">
            {/* Collapse Sidebar Placeholder (Supabase style button on the far left) */}
            <button className="p-1.5 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 rounded-md transition-all mr-1">
                <PanelLeftOpen size={14} />
            </button>

            <div className="h-4 w-px bg-zinc-800 mx-1" />

            {openTabs.map((tab) => (
                <div
                    key={tab}
                    className={`group relative flex items-center h-8 min-w-[120px] max-w-[200px] px-3 rounded-t-lg transition-all cursor-pointer border-x border-t ${
                        activeTab === tab
                            ? 'bg-[#161616] border-zinc-800 text-primary font-bold shadow-[0_-2px_10px_rgba(0,0,0,0.5)]'
                            : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                    }`}
                    onClick={() => onTabSelect(tab)}
                >
                    <Table2 size={13} className={`mr-2 shrink-0 ${activeTab === tab ? 'text-primary' : 'text-zinc-600'}`} />
                    <span className="truncate text-[11px] tracking-tight">{tab}</span>
                    
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onTabClose(tab);
                        }}
                        className={`ml-2 p-0.5 rounded-md hover:bg-zinc-800 hover:text-white transition-all opacity-0 group-hover:opacity-100 ${
                            activeTab === tab ? 'text-zinc-500' : 'text-zinc-700'
                        }`}
                    >
                        <X size={10} />
                    </button>

                    {activeTab === tab && (
                        <div className="absolute -bottom-px left-0 w-full h-px bg-primary shadow-[0_0_8px_rgba(62,207,142,0.4)]" />
                    )}
                </div>
            ))}

            <button
                onClick={onNewTable}
                className="flex items-center justify-center w-8 h-8 text-zinc-600 hover:text-primary hover:bg-zinc-900 rounded-lg transition-all ml-1"
                title="Open new table"
            >
                <Plus size={16} />
            </button>
        </div>
    );
};

export default TableEditorTabs;
