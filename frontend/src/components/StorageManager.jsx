import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    FolderOpen,
    Plus,
    Search,
    HardDrive,
    Shield,
    FileIcon,
    Image as ImageIcon,
    Lock,
    Settings,
    MoreHorizontal,
    LayoutGrid,
    List,
    RefreshCw,
    BarChart3,
    Database,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const VIEW_META = {
    buckets: {
        title: 'Storage',
        subtitle: 'Object storage engine',
        accent: FolderOpen,
    },
    policies: {
        title: 'Storage Policies',
        subtitle: 'Bucket visibility and RLS coverage',
        accent: Shield,
    },
    usage: {
        title: 'Storage Usage',
        subtitle: 'Capacity and object consumption',
        accent: BarChart3,
    },
    settings: {
        title: 'Storage Settings',
        subtitle: 'Bucket configuration summary',
        accent: Settings,
    },
};

const StorageManager = ({ view = 'buckets' }) => {
    const [viewMode, setViewMode] = useState('grid');
    const [files, setFiles] = useState([]);
    const [buckets, setBuckets] = useState([]);
    const [selectedBucket, setSelectedBucket] = useState('default');
    const [loading, setLoading] = useState(true);
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchBuckets();
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [selectedBucket]);

    const fetchBuckets = async () => {
        try {
            const res = await fetchWithAuth('/api/files/buckets');
            const data = await res.json();
            const safeBuckets = Array.isArray(data) ? data : [];
            setBuckets(safeBuckets);

            const availableNames = new Set(['default', ...safeBuckets.map((bucket) => bucket.name)]);
            if (!availableNames.has(selectedBucket)) {
                setSelectedBucket(safeBuckets[0]?.name || 'default');
            }
        } catch (error) {
            console.error('Failed to fetch buckets:', error);
        }
    };

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth(`/api/files?bucket=${selectedBucket}`);
            const data = await res.json();
            setFiles(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch files:', error);
            setFiles([]);
        } finally {
            setLoading(false);
        }
    };

    const createBucket = async () => {
        const name = prompt('Enter bucket name:');
        if (!name) {
            return;
        }

        const isPublic = confirm('Make bucket public?');
        const enableRLS = confirm('Enable Row Level Security (RLS)?');
        const rlsRule = enableRLS
            ? prompt(
                "Enter RLS rule (default: auth.uid() = owner_id)",
                'auth.uid() = owner_id',
            ) || 'auth.uid() = owner_id'
            : '';

        try {
            const res = await fetchWithAuth('/api/files/buckets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    public: isPublic,
                    rls_enabled: enableRLS,
                    rls_rule: rlsRule,
                }),
            });

            if (res.ok) {
                await fetchBuckets();
                setSelectedBucket(name);
            }
        } catch (error) {
            console.error('Failed to create bucket:', error);
        }
    };

    const handleUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        setLoading(true);
        try {
            const res = await fetchWithAuth(`/api/files?bucket=${selectedBucket}`, {
                method: 'POST',
                body: formData,
            });

            if (res.ok) {
                await fetchFiles();
            }
        } catch (error) {
            console.error('Upload error:', error);
        } finally {
            setLoading(false);
            event.target.value = '';
        }
    };

    const triggerUpload = () => {
        fileInputRef.current?.click();
    };

    const formatSize = (bytes) => {
        if (!bytes) {
            return '0 Bytes';
        }
        const base = 1024;
        const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);
        return `${parseFloat((bytes / Math.pow(base, index)).toFixed(2))} ${units[index]}`;
    };

    const allBuckets = useMemo(
        () => [{ name: 'default', public: true }, ...buckets.filter((bucket) => bucket.name !== 'default')],
        [buckets],
    );

    const totalBytes = useMemo(
        () => files.reduce((sum, file) => sum + Number(file.size || 0), 0),
        [files],
    );

    const selectedBucketDetails = useMemo(
        () => allBuckets.find((bucket) => bucket.name === selectedBucket) || allBuckets[0] || { name: 'default', public: true },
        [allBuckets, selectedBucket],
    );

    const meta = VIEW_META[view] || VIEW_META.buckets;

    const renderBuckets = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Accessing storage nodes...</p>
                </div>
            );
        }

        if (files.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-900 rounded-3xl gap-4">
                    <FolderOpen size={48} className="text-zinc-800" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Storage is empty</p>
                    <button
                        onClick={triggerUpload}
                        className="text-primary text-[10px] font-black uppercase tracking-widest hover:underline"
                    >
                        Click to upload
                    </button>
                </div>
            );
        }

        return (
            <div className={`grid ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'} gap-6`}>
                {files.map((file, index) => (
                    <div
                        key={`${file.path || file.name}-${index}`}
                        className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl hover:border-primary/30 transition-all group relative overflow-hidden"
                    >
                        <div className="relative z-10">
                            <div className="flex items-start justify-between mb-6">
                                <div className="p-4 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                                    {file.name?.match(/\.(jpg|jpeg|png|gif|svg)$/i) ? <ImageIcon size={24} /> : <FileIcon size={24} />}
                                </div>
                                <button className="text-zinc-700 hover:text-zinc-200">
                                    <MoreHorizontal size={20} />
                                </button>
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tighter italic uppercase truncate mb-1" title={file.name}>
                                {(file.name || '').split('_').pop() || file.name}
                            </h3>
                            <div className="flex items-center gap-3 mb-6">
                                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{formatSize(file.size)}</span>
                            </div>
                            <div className="flex items-center justify-between mt-auto">
                                <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800">
                                    <Lock size={10} className="text-zinc-600" />
                                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Active</span>
                                </div>
                                <a href={file.path} target="_blank" rel="noreferrer" className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:underline">
                                    View Asset
                                </a>
                            </div>
                        </div>
                        <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                            <HardDrive size={120} />
                        </div>
                    </div>
                ))}
                <div
                    onClick={triggerUpload}
                    className="border-2 border-dashed border-zinc-900 rounded-3xl p-6 flex flex-col items-center justify-center gap-4 group cursor-pointer hover:border-primary/20 transition-all"
                >
                    <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-700 group-hover:text-primary transition-colors">
                        <Plus size={24} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700 group-hover:text-zinc-400">Add asset</span>
                </div>
            </div>
        );
    };

    const renderPolicies = () => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {allBuckets.map((bucket) => (
                <div key={bucket.name} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl">
                    <div className="flex items-start justify-between mb-5">
                        <div>
                            <h3 className="text-xl font-black text-white tracking-tight">{bucket.name}</h3>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mt-1">
                                {bucket.public ? 'Public bucket' : 'Private bucket'}
                            </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${bucket.rls_enabled ? 'bg-primary/10 text-primary border-primary/20' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                            {bucket.rls_enabled ? 'RLS enabled' : 'No RLS'}
                        </span>
                    </div>
                    <div className="space-y-3 text-xs">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                            <span className="text-zinc-500 uppercase tracking-widest text-[9px] font-black">Visibility</span>
                            <span className="text-white font-bold">{bucket.public ? 'Direct URL access' : 'Authenticated access'}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                            <span className="text-zinc-500 uppercase tracking-widest text-[9px] font-black">Rule</span>
                            <code className="text-primary text-[11px]">{bucket.rls_rule || 'Not configured'}</code>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-zinc-500 uppercase tracking-widest text-[9px] font-black">Selected bucket</span>
                            <span className={bucket.name === selectedBucket ? 'text-primary font-bold' : 'text-zinc-500'}>
                                {bucket.name === selectedBucket ? 'Current' : 'Idle'}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    const renderUsage = () => (
        <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: 'Buckets', value: allBuckets.length, icon: Database },
                    { label: 'Files in bucket', value: files.length, icon: FileIcon },
                    { label: 'Selected usage', value: formatSize(totalBytes), icon: HardDrive },
                ].map((item) => (
                    <div key={item.label} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                            <item.icon size={20} />
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">{item.label}</p>
                            <p className="text-2xl font-black text-white italic">{item.value}</p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden">
                <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Current bucket footprint</h3>
                </div>
                <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Bucket</span>
                        <span className="font-bold text-white">{selectedBucket}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Object count</span>
                        <span className="font-bold text-white">{files.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Estimated size</span>
                        <span className="font-bold text-primary">{formatSize(totalBytes)}</span>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderSettings = () => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6">
                <h3 className="text-lg font-black text-white uppercase tracking-tight mb-5">Bucket configuration</h3>
                <div className="space-y-4 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Bucket name</span>
                        <span className="font-bold text-white">{selectedBucketDetails.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Access mode</span>
                        <span className="font-bold text-white">{selectedBucketDetails.public ? 'Public' : 'Private'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-zinc-500">RLS</span>
                        <span className="font-bold text-white">{selectedBucketDetails.rls_enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Rule</span>
                        <code className="text-primary">{selectedBucketDetails.rls_rule || 'Not configured'}</code>
                    </div>
                </div>
            </div>
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6">
                <h3 className="text-lg font-black text-white uppercase tracking-tight mb-5">Operational notes</h3>
                <ul className="space-y-4 text-sm text-zinc-400">
                    <li>Uploads target the currently selected bucket.</li>
                    <li>Public buckets expose direct file URLs.</li>
                    <li>Private buckets require authenticated requests and can be reinforced with RLS.</li>
                    <li>For bulk policy changes, create the bucket with the right visibility first, then review the rules in the Policies tab.</li>
                </ul>
            </div>
        </div>
    );

    const renderContent = () => {
        switch (view) {
            case 'policies':
                return renderPolicies();
            case 'usage':
                return renderUsage();
            case 'settings':
                return renderSettings();
            case 'buckets':
            default:
                return renderBuckets();
        }
    };

    return (
        <div className="flex h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col p-6">
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Buckets</h3>
                    <button onClick={createBucket} className="text-zinc-600 hover:text-primary">
                        <Plus size={14} />
                    </button>
                </div>
                <div className="space-y-2">
                    {allBuckets.map((bucket) => (
                        <button
                            key={bucket.name}
                            onClick={() => setSelectedBucket(bucket.name)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all ${
                                selectedBucket === bucket.name
                                    ? 'bg-primary/10 text-primary border border-primary/20'
                                    : 'text-zinc-500 hover:bg-zinc-900 border border-transparent'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <HardDrive size={16} className={selectedBucket === bucket.name ? 'text-primary' : 'text-zinc-700'} />
                                {bucket.name}
                            </div>
                            {bucket.public ? <Settings size={12} className="opacity-40" /> : <Lock size={12} className="opacity-40" />}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                    <div className="flex items-center justify-between mb-10">
                        <div className="flex items-center gap-6">
                            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                                <meta.accent className="text-primary" size={28} />
                            </div>
                            <div>
                                <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">{meta.title}</h1>
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                    <Shield size={12} className="text-primary" />
                                    {meta.subtitle}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={fetchFiles}
                                className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all"
                            >
                                <RefreshCw size={18} />
                            </button>
                            {view === 'buckets' && (
                                <button
                                    onClick={triggerUpload}
                                    className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]"
                                >
                                    <Plus size={16} strokeWidth={3} />
                                    Upload File
                                </button>
                            )}
                            <input type="file" className="hidden" ref={fileInputRef} onChange={handleUpload} />
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
                                    placeholder="Search files..."
                                    className="bg-transparent border-none text-xs font-bold uppercase tracking-widest text-zinc-300 focus:outline-none w-64 placeholder:text-zinc-700"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-8">
                            <div className="text-right">
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Selected bucket</p>
                                <p className="text-sm font-black text-zinc-200">{selectedBucket}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Objects</p>
                                <p className="text-sm font-black text-zinc-200">{files.length} ITEMS</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">{renderContent()}</div>
            </div>
        </div>
    );
};

export default StorageManager;
