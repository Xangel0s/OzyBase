import React, { useState } from 'react';
import {
    FolderOpen,
    Plus,
    Search,
    HardDrive,
    Shield,
    FileIcon,
    Image as ImageIcon,
    Video,
    Lock,
    Settings,
    MoreHorizontal,
    LayoutGrid,
    List
} from 'lucide-react';

const StorageManager = () => {
    const [viewMode, setViewMode] = useState('grid');
    const [buckets] = useState([
        { id: 1, name: 'user-uploads', files: 1242, size: '21.4 GB', public: true },
        { id: 2, name: 'avatars', files: 89, size: '450 MB', public: true },
        { id: 3, name: 'system-logs', files: 4, size: '1.2 GB', public: false }
    ]);

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header Controls */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-10">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <FolderOpen className="text-primary" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Storage</h1>
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                <Shield size={12} className="text-primary" />
                                Amazon S3 Compatible Object Storage
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all"><Settings size={18} /></button>
                        <button className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]">
                            <Plus size={16} strokeWidth={3} />
                            Create Bucket
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-300'}`}
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-300'}`}
                        >
                            <List size={18} />
                        </button>
                        <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Search buckets..."
                                className="bg-transparent border-none text-xs font-bold uppercase tracking-widest text-zinc-300 focus:outline-none w-64 placeholder:text-zinc-700"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-8">
                        <div className="text-right">
                            <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Storage Used</p>
                            <p className="text-sm font-black text-zinc-200">23.05 GB / 100 GB</p>
                        </div>
                        <div className="w-40 h-1.5 bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
                            <div className="w-[23%] h-full bg-primary shadow-[0_0_10px_rgba(254,254,0,0.4)]" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Buckets Explorer */}
            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {buckets.map((b) => (
                        <div key={b.id} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl hover:border-primary/30 transition-all group relative overflow-hidden">
                            <div className="relative z-10">
                                <div className="flex items-start justify-between mb-6">
                                    <div className={`p-4 rounded-2xl ${b.public ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                                        <HardDrive size={24} />
                                    </div>
                                    <button className="text-zinc-700 hover:text-zinc-200"><MoreHorizontal size={20} /></button>
                                </div>
                                <h3 className="text-xl font-black text-white tracking-tighter italic uppercase truncate mb-1">{b.name}</h3>
                                <div className="flex items-center gap-3 mb-6">
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{b.files} Files</span>
                                    <div className="w-1 h-1 rounded-full bg-zinc-800" />
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{b.size}</span>
                                </div>

                                <div className="flex items-center justify-between mt-auto">
                                    <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800">
                                        <Lock size={10} className={b.public ? "text-zinc-600" : "text-primary"} />
                                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                                            {b.public ? 'Public' : 'Protected'}
                                        </span>
                                    </div>
                                    <button className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:underline">Open Bucket</button>
                                </div>
                            </div>
                            <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                                <FolderOpen size={120} />
                            </div>
                        </div>
                    ))}

                    {/* Add New Mock */}
                    <div className="border-2 border-dashed border-zinc-900 rounded-3xl p-6 flex flex-col items-center justify-center gap-4 group cursor-pointer hover:border-primary/20 transition-all">
                        <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-700 group-hover:text-primary transition-colors">
                            <Plus size={24} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700 group-hover:text-zinc-400">Add bucket</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StorageManager;
