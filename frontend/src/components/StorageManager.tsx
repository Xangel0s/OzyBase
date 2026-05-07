import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
    Download,
    FileIcon,
    FolderOpen,
    Globe,
    HardDrive,
    Image as ImageIcon,
    LayoutGrid,
    List,
    Lock,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Shield,
    Trash2,
    Upload,
    Maximize2,
    Clock,
    Zap,
    Cpu,
    ShieldAlert,
    Database,
    MoreVertical,
    Activity,
    Info,
    ArrowRight,
    X,
    ChevronRight,
    FolderPlus,
    Copy,
    ExternalLink,
    MoveHorizontal,
    Type
} from 'lucide-react';

import ConfirmModal from './ConfirmModal';
import OzySelect from './OzySelect';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';
import { useDenseDesktopViewport } from '../utils/denseViewport';

type ToastTone = 'success' | 'error' | 'warning';
type BucketDialogMode = 'create' | 'edit';
type BucketPolicyProfile = 'visibility_only' | 'owner_only' | 'admin_only' | 'deny_all' | 'custom';

interface StorageBucket {
    id: string;
    name: string;
    public: boolean;
    rls_enabled: boolean;
    rls_rule: string;
    max_file_size_bytes: number;
    max_total_size_bytes: number;
    lifecycle_delete_after_days: number;
    usage_ratio_pct?: number;
    created_at?: string;
    object_count: number;
    total_size: number;
}

interface StorageObject {
    id: string;
    name: string;
    size: number;
    content_type: string;
    path: string;
    download_url: string;
    storage_key: string;
    created_at?: string;
    is_folder?: boolean;
}

interface StorageSignedReadResponse {
    signed_url?: string;
    token?: string;
    error?: string;
}

interface BucketFormState {
    name: string;
    isPublic: boolean;
    policyProfile: BucketPolicyProfile;
    rlsRule: string;
    maxFileSizeMB: string;
    maxTotalSizeMB: string;
    lifecycleDeleteAfterDays: string;
}

const DEFAULT_RLS_RULE = "auth.uid() = owner_id";
const ADMIN_BUCKET_RLS_RULE = "auth.role() = 'admin'";
const EMPTY_BUCKET_FORM: BucketFormState = { name: '', isPublic: false, policyProfile: 'visibility_only', rlsRule: DEFAULT_RLS_RULE, maxFileSizeMB: '', maxTotalSizeMB: '', lifecycleDeleteAfterDays: '' };

const formatSize = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const parseMaxFileSizeMB = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * 1024 * 1024);
};

const parsePositiveInt = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

const inferBucketPolicyProfile = (enabled: boolean, rule: string): BucketPolicyProfile => {
    if (!enabled) return 'visibility_only';
    const normalized = rule.trim();
    switch (normalized) {
        case '': case 'true': return 'visibility_only';
        case DEFAULT_RLS_RULE: return 'owner_only';
        case ADMIN_BUCKET_RLS_RULE: return 'admin_only';
        case 'false': return 'deny_all';
        default: return 'custom';
    }
};

const resolveBucketPolicyRule = (profile: BucketPolicyProfile, customRule: string): string => {
    switch (profile) {
        case 'visibility_only': return 'true';
        case 'owner_only': return DEFAULT_RLS_RULE;
        case 'admin_only': return ADMIN_BUCKET_RLS_RULE;
        case 'deny_all': return 'false';
        case 'custom': default: return customRule.trim();
    }
};

const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;
const FOLDER_MARKER_PREFIX = '.ozy_folder_';

const isFolderMarker = (name: string): boolean => (
    name.trim().toLowerCase().startsWith(FOLDER_MARKER_PREFIX)
);

const normalizeObjectKey = (raw: string): string => (
    raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
);

const resolveObjectKey = (file: Pick<StorageObject, 'storage_key' | 'name'>): string => {
    const storageKey = normalizeObjectKey(file.storage_key || '');
    if (storageKey) return storageKey;
    return normalizeObjectKey(file.name || '');
};

const encodeObjectKeyForURL = (key: string): string => (
    key
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/')
);

const collectFolderObjectKeys = (allFiles: StorageObject[], folderKey: string): string[] => {
    const normalizedFolderKey = normalizeObjectKey(folderKey);
    if (!normalizedFolderKey) return [];
    const prefix = `${normalizedFolderKey}/`;
    const keys = allFiles
        .map((file) => resolveObjectKey(file))
        .filter((key) => key.startsWith(prefix));
    return Array.from(new Set(keys));
};

const normalizeFolderInput = (raw: string): string => (
    raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
);

const normalizeBucketIdentifier = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, '-');

const formatDate = (value?: string): string => {
    if (!value) return 'RECENT_IO';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'RECENT_IO';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date).toUpperCase();
};

const extractError = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
};

const StorageManager = () => {
    const isDenseViewport = useDenseDesktopViewport();
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearch = useDeferredValue(searchQuery);
    const [files, setFiles] = useState<StorageObject[]>([]);
    const [buckets, setBuckets] = useState<StorageBucket[]>([]);
    const [selectedBucketName, setSelectedBucketName] = useState('default');
    const [loadingBuckets, setLoadingBuckets] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [bucketDialogMode, setBucketDialogMode] = useState<BucketDialogMode | null>(null);
    const [bucketForm, setBucketForm] = useState<BucketFormState>(EMPTY_BUCKET_FORM);
    const [isSavingBucket, setIsSavingBucket] = useState(false);
    const [bucketPendingDelete, setBucketPendingDelete] = useState<StorageBucket | null>(null);
    const [filePendingDelete, setFilePendingDelete] = useState<StorageObject | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadSummary, setUploadSummary] = useState('');
    const [toast, setToast] = useState<{ message: string; type: ToastTone } | null>(null);
    const [currentPath, setCurrentPath] = useState<string[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: StorageObject } | null>(null);
    const [showNewFolderModal, setShowNewFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [renamingFile, setRenamingFile] = useState<StorageObject | null>(null);
    const [newNameValue, setNewNameValue] = useState('');
    const [movingFile, setMovingFile] = useState<StorageObject | null>(null);
    const [movingTarget, setMovingTarget] = useState('');
    const [previewObject, setPreviewObject] = useState<StorageObject | null>(null);
    const [bucketNameError, setBucketNameError] = useState('');

    const fileInputRef = React.useRef<HTMLInputElement | null>(null);

    const showToast = useCallback((message: string, type: ToastTone) => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const fetchBuckets = useCallback(async (preferredBucket?: string) => {
        setLoadingBuckets(true);
        try {
            const response = await fetchWithAuth('/api/files/buckets');
            const payload = await response.json().catch(() => []) as StorageBucket[];
            const safeBuckets = Array.isArray(payload) ? payload : [];
            setBuckets(safeBuckets);
            setSelectedBucketName((current) => {
                const desired = preferredBucket ?? current;
                return safeBuckets.some((bucket) => bucket.name === desired) ? desired : safeBuckets[0]?.name ?? 'default';
            });
        } catch (e) { console.error(e); }
        finally { setLoadingBuckets(false); }
    }, []);

    const fetchFiles = useCallback(async (bucketName: string) => {
        setLoadingFiles(true);
        try {
            const response = await fetchWithAuth(`/api/files?bucket=${encodeURIComponent(bucketName)}`);
            const payload = await response.json().catch(() => []) as StorageObject[];
            setFiles(Array.isArray(payload) ? payload : []);
        } catch (e) {
            console.error(e);
            setFiles([]);
        } finally { setLoadingFiles(false); }
    }, []);

    useEffect(() => { fetchBuckets(); }, [fetchBuckets]);
    useEffect(() => { fetchFiles(selectedBucketName); }, [fetchFiles, selectedBucketName]);

    const selectedBucket = useMemo<StorageBucket>(() => (
        buckets.find((bucket) => bucket.name === selectedBucketName) ?? {
            id: 'default', name: selectedBucketName || 'default', public: true, rls_enabled: false, rls_rule: 'true',
            max_file_size_bytes: 0, max_total_size_bytes: 0, lifecycle_delete_after_days: 0, object_count: files.length,
            total_size: files.reduce((sum, file) => sum + file.size, 0),
        }
    ), [buckets, files, selectedBucketName]);

    const filteredFiles = useMemo(() => {
        const prefix = currentPath.length > 0 ? currentPath.join('/') + '/' : '';
        const folders = new Set<string>();
        const objects: StorageObject[] = [];
        
        files.forEach(f => {
            const objectKey = resolveObjectKey(f);
            if (!objectKey) return;
            if (prefix && !objectKey.startsWith(prefix)) return;

            const relative = prefix ? objectKey.slice(prefix.length) : objectKey;
            const parts = relative.split('/').filter(Boolean);
            if (parts.length === 0) return;
             
            if (parts.length > 1) {
                folders.add(parts[0]);
            } else {
                const leafName = parts[0];
                if (isFolderMarker(leafName)) return;
                const displayName = normalizeObjectKey(f.name || '').split('/').filter(Boolean).pop() || leafName;
                objects.push({ ...f, name: displayName, storage_key: objectKey });
            }
        });
        
        const folderList = Array.from(folders).map(name => {
            const folderPrefix = `${prefix}${name}/`;
            const originalFile = files.find((file) => {
                const key = resolveObjectKey(file);
                return key.startsWith(folderPrefix) && isFolderMarker(key.slice(folderPrefix.length));
            });
            return {
                id: `folder-${folderPrefix}`,
                name,
                size: 0,
                content_type: 'directory',
                path: folderPrefix,
                download_url: '#',
                storage_key: folderPrefix,
                is_folder: true,
                created_at: originalFile?.created_at
            };
        });
        
        let result = [...folderList, ...objects];

        if (deferredSearch) {
            const q = deferredSearch.toLowerCase();
            result = result.filter(f => f.name.toLowerCase().includes(q));
        }

        result.sort((a, b) => {
            if (Boolean(a.is_folder) !== Boolean(b.is_folder)) {
                return a.is_folder ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return result;
    }, [files, currentPath, deferredSearch]);

    const handleCreateFolder = async () => {
        const folderName = normalizeFolderInput(newFolderName);
        if (!folderName) {
            showToast('Folder name is required', 'warning');
            return;
        }
        if (folderName.includes('..')) {
            showToast('Folder name cannot include ".."', 'error');
            return;
        }
        if (folderName.split('/').some((segment) => !segment.trim())) {
            showToast('Folder path is invalid', 'error');
            return;
        }

        const basePrefix = currentPath.length > 0 ? currentPath.join('/') + '/' : '';
        const targetFolderPath = `${basePrefix}${folderName}`;
        const markerName = `${FOLDER_MARKER_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

        try {
            // 1) Upload lightweight marker in selected bucket
            const markerFile = new File(['folder'], markerName, { type: 'text/plain' });
            const formData = new FormData();
            formData.append('file', markerFile, markerName);

            const uploadRes = await fetchWithAuth(`/api/files?bucket=${encodeURIComponent(selectedBucketName)}`, {
                method: 'POST',
                body: formData,
            });
            if (!uploadRes.ok) {
                const error = await extractError(uploadRes, 'Folder marker upload failed');
                showToast(error, 'error');
                return;
            }

            // 2) Move marker to target folder path to preserve virtual directory hierarchy
            const uploaded = await uploadRes.json().catch(() => null) as { name?: string; storage_key?: string } | null;
            const uploadedName = uploaded?.name?.trim() || markerName;
            const moveRes = await moveObjectPath(selectedBucketName, uploadedName, `${targetFolderPath}/${markerName}`);
            if (!moveRes.ok) {
                const error = await extractError(moveRes, 'Folder creation failed');
                showToast(error, 'error');
                return;
            }

            setShowNewFolderModal(false);
            setNewFolderName('');
            await Promise.all([fetchFiles(selectedBucketName), fetchBuckets(selectedBucketName)]);
            showToast('Namespace mapped', 'success');
        } catch {
            showToast('Folder creation failed', 'error');
        }
    };

    const moveObjectPath = useCallback(async (bucket: string, oldPath: string, newPath: string): Promise<Response> => {
        const payload = JSON.stringify({ old_path: oldPath, new_path: newPath });
        const moveEndpoint = `/api/files/${encodeURIComponent(bucket)}/move`;
        const moveRes = await fetchWithAuth(moveEndpoint, {
            method: 'POST',
            body: payload,
        });
        if (moveRes.ok || (moveRes.status !== 404 && moveRes.status !== 405)) {
            return moveRes;
        }

        // Backward compatibility: older backends may only expose /rename
        const renameEndpoint = `/api/files/${encodeURIComponent(bucket)}/rename`;
        return fetchWithAuth(renameEndpoint, {
            method: 'POST',
            body: payload,
        });
    }, []);

    const deleteObjectByKey = useCallback(async (bucket: string, objectKey: string): Promise<Response> => {
        const encodedKey = encodeObjectKeyForURL(objectKey);
        return fetchWithAuth(`/api/files/${encodeURIComponent(bucket)}/${encodedKey}`, { method: 'DELETE' });
    }, []);

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files ?? []);
        if (selectedFiles.length === 0) return;
        setIsUploading(true);
        const prefix = currentPath.length > 0 ? currentPath.join('/') + '/' : '';
        try {
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('file', file);

                const uploadRes = await fetchWithAuth(`/api/files?bucket=${encodeURIComponent(selectedBucket.name)}`, {
                    method: 'POST',
                    body: formData,
                });
                if (!uploadRes.ok) {
                    const error = await extractError(uploadRes, 'Upload failed');
                    showToast(error, 'error');
                    continue;
                }

                // Preserve virtual folder path by moving after upload.
                if (prefix) {
                    const uploaded = await uploadRes.json().catch(() => null) as { name?: string } | null;
                    const uploadedName = uploaded?.name?.trim() || file.name;
                    const moveRes = await moveObjectPath(selectedBucket.name, uploadedName, `${prefix}${file.name}`);
                    if (!moveRes.ok) {
                        const error = await extractError(moveRes, 'Upload relocation failed');
                        showToast(error, 'error');
                    }
                }
            }
            await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
            showToast('Files synchronized to edge storage', 'success');
        } catch (e) {
            showToast('Upload failure', 'error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteFile = async () => {
        if (!filePendingDelete) return;
        try {
            const objectKey = resolveObjectKey(filePendingDelete);
            if (!objectKey) {
                showToast('Invalid object path', 'error');
                return;
            }
            if (filePendingDelete.is_folder) {
                const folderObjectKeys = collectFolderObjectKeys(files, objectKey);
                if (folderObjectKeys.length === 0) {
                    setFilePendingDelete(null);
                    showToast('Folder has no deletable objects', 'warning');
                    return;
                }

                const failedDeletions: string[] = [];
                for (const key of folderObjectKeys) {
                    const deleteRes = await deleteObjectByKey(selectedBucket.name, key);
                    if (!deleteRes.ok) {
                        const error = await extractError(deleteRes, `Deletion failed for ${key}`);
                        failedDeletions.push(error);
                    }
                }

                if (failedDeletions.length > 0) {
                    showToast(failedDeletions[0], 'error');
                    return;
                }

                await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
                setFilePendingDelete(null);
                showToast('Folder purged from bucket', 'success');
                return;
            }

            const res = await deleteObjectByKey(selectedBucket.name, objectKey);
            if (res.ok) {
                await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
                setFilePendingDelete(null);
                showToast('Object purged from bucket', 'success');
                return;
            }

            const error = await extractError(res, 'Deletion failed');
            showToast(error, 'error');
        } catch (e) { showToast('Deletion failed', 'error'); }
    };

    const handleRename = async () => {
        if (!renamingFile || !newNameValue) return;
        const newName = normalizeObjectKey(newNameValue);
        if (!newName || newName.includes('/')) {
            showToast('Rename only accepts a file/folder name', 'warning');
            return;
        }
        try {
            const oldPath = resolveObjectKey(renamingFile);
            if (!oldPath) {
                showToast('Rename target path is invalid', 'error');
                return;
            }
            const pathParts = oldPath.split('/').filter(Boolean);
            const parentPrefix = pathParts.length > 1 ? `${pathParts.slice(0, -1).join('/')}/` : '';
            const res = await fetchWithAuth(`/api/files/${selectedBucketName}/rename`, {
                method: 'POST',
                body: JSON.stringify({ old_path: oldPath, new_path: parentPrefix + newName }),
            });
            if (res.ok) {
                fetchFiles(selectedBucketName);
                setRenamingFile(null);
                setNewNameValue('');
                showToast('Knowledge unit renamed', 'success');
            }
        } catch (e) { showToast('Rename failed', 'error'); }
    };

    const handleMove = async () => {
        if (!movingFile) return;
        try {
            const oldPath = resolveObjectKey(movingFile);
            if (!oldPath) {
                showToast('Relocation target path is invalid', 'error');
                return;
            }
            const baseName = oldPath.split('/').filter(Boolean).pop() || movingFile.name;
            const targetPrefix = normalizeObjectKey(movingTarget);
            const nextPath = targetPrefix ? `${targetPrefix}/${baseName}` : baseName;
            const res = await moveObjectPath(
                selectedBucketName,
                oldPath,
                nextPath,
            );
            if (res.ok) {
                fetchFiles(selectedBucketName);
                setMovingFile(null);
                setMovingTarget('');
                showToast('Knowledge unit relocated', 'success');
            }
        } catch (e) { showToast('Relocation failed', 'error'); }
    };

    const handleCopyURL = async (file: StorageObject) => {
        try {
            const objectPath = resolveObjectKey(file);
            if (!objectPath) {
                showToast('Object path is invalid', 'error');
                return;
            }
            const res = await fetchWithAuth('/api/files/sign', {
                method: 'POST',
                body: JSON.stringify({ operation: 'read', bucket: selectedBucketName, object_path: objectPath, expires_in: 86400 }),
            });
            const data = await res.json().catch(() => null) as StorageSignedReadResponse | null;
            const signedPath = data?.signed_url?.trim();
            if (!res.ok || !signedPath) {
                throw new Error(data?.error || 'URL acquisition failed');
            }
            const signedURL = window.location.origin + signedPath;
            await navigator.clipboard.writeText(signedURL);
            showToast('Secure link copied to buffer', 'success');
        } catch (e) { showToast('URL acquisition failed', 'error'); }
    };

    const handleBucketSave = async () => {
        const cleanedName = normalizeBucketIdentifier(bucketForm.name);
        if (!cleanedName) {
            setBucketNameError('Bucket identifier is required');
            showToast('Bucket identifier is required', 'warning');
            return;
        }
        if (cleanedName !== bucketForm.name.trim().toLowerCase()) {
            setBucketNameError('Use lowercase letters, numbers, dots, dashes or underscores. Spaces become dashes.');
        } else {
            setBucketNameError('');
        }

        const payload = {
            name: cleanedName,
            public: bucketForm.isPublic,
            rls_enabled: bucketForm.policyProfile !== 'visibility_only',
            rls_rule: resolveBucketPolicyRule(bucketForm.policyProfile, bucketForm.rlsRule),
            max_file_size_bytes: parseMaxFileSizeMB(bucketForm.maxFileSizeMB) || 0,
            max_total_size_bytes: parseMaxFileSizeMB(bucketForm.maxTotalSizeMB) || 0,
            lifecycle_delete_after_days: parsePositiveInt(bucketForm.lifecycleDeleteAfterDays) || 0,
        };

        setIsSavingBucket(true);
        try {
            const method = bucketDialogMode === 'create' ? 'POST' : 'PATCH';
            const endpoint = bucketDialogMode === 'create' ? '/api/files/buckets' : `/api/files/buckets/${encodeURIComponent(selectedBucket.name)}`;
            const res = await fetchWithAuth(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                await fetchBuckets(payload.name);
                setBucketDialogMode(null);
                showToast(`Bucket ${bucketDialogMode === 'create' ? 'deployed' : 'updated'}`, 'success');
            } else {
                const error = await extractError(res, 'Bucket synchronization failed');
                showToast(error, 'error');
            }
        } catch (e) {
            showToast('Request failed', 'error');
        } finally {
            setIsSavingBucket(false);
        }
    };

    const handleDeleteBucket = async () => {
        if (!bucketPendingDelete) return;
        try {
            const res = await fetchWithAuth(`/api/files/buckets/${encodeURIComponent(bucketPendingDelete.name)}`, { method: 'DELETE' });
            if (res.ok) {
                await fetchBuckets();
                setBucketPendingDelete(null);
                showToast('Bucket enclave purged', 'success');
            } else {
                const error = await extractError(res, 'Purge operation failed');
                showToast(error, 'error');
            }
        } catch (e) { showToast('Request failure', 'error'); }
    };

    useEffect(() => {
        if (bucketDialogMode === 'edit') {
            setBucketNameError('');
            setBucketForm({
                name: selectedBucket.name,
                isPublic: selectedBucket.public,
                policyProfile: inferBucketPolicyProfile(selectedBucket.rls_enabled, selectedBucket.rls_rule),
                rlsRule: selectedBucket.rls_rule || DEFAULT_RLS_RULE,
                maxFileSizeMB: selectedBucket.max_file_size_bytes ? (selectedBucket.max_file_size_bytes / 1024 / 1024).toString() : '',
                maxTotalSizeMB: selectedBucket.max_total_size_bytes ? (selectedBucket.max_total_size_bytes / 1024 / 1024).toString() : '',
                lifecycleDeleteAfterDays: selectedBucket.lifecycle_delete_after_days ? selectedBucket.lifecycle_delete_after_days.toString() : '',
            });
        } else if (bucketDialogMode === 'create') {
            setBucketNameError('');
            setBucketForm(EMPTY_BUCKET_FORM);
        }
    }, [bucketDialogMode, selectedBucket]);

    return (
        <div className="flex h-full bg-background animate-in fade-in duration-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(254,254,0,0.02),transparent_50%)] pointer-events-none" />
            
            {/* Sidebar Navigator */}
            <aside className="w-72 border-r border-white/5 bg-linear-to-b from-white/2 to-transparent flex flex-col relative z-10 shrink-0">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <h2 className="text-[11px] font-bold text-white uppercase tracking-[0.3em] italic leading-none">Buckets</h2>
                        <p className="mt-2 text-[9px] font-bold text-zinc-300 uppercase tracking-widest leading-none">Storage Registry</p>
                    </div>
                    <button 
                        onClick={() => setBucketDialogMode('create')}
                        className="w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary hover:bg-primary hover:text-black transition-all shadow-lg active:scale-95"
                    >
                        <Plus size={18} strokeWidth={3} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    {loadingBuckets ? (
                        <div className="py-12 text-center text-zinc-400 font-bold text-[9px] uppercase tracking-[0.4em] animate-pulse italic">Resolving Nodes...</div>
                    ) : buckets.map((bucket) => (
                        <div 
                            key={bucket.id} 
                            onClick={() => setSelectedBucketName(bucket.name)}
                            className={`group relative rounded-md border p-4 cursor-pointer transition-all duration-500 ${selectedBucketName === bucket.name ? 'bg-primary border-primary shadow-[0_20px_40px_rgba(254,254,0,0.15)]' : 'bg-white/2 border-white/5 hover:border-white/20'}`}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className={`w-10 h-10 rounded-md flex items-center justify-center border transition-all ${selectedBucketName === bucket.name ? 'bg-black/20 border-black/10 text-black' : 'bg-black border-white/5 text-zinc-500 group-hover:text-white'}`}>
                                    <HardDrive size={20} strokeWidth={1.5} />
                                </div>
                                <div className="flex items-center gap-2">
                                    {!bucket.public && <Lock size={12} className={selectedBucketName === bucket.name ? 'text-black/60' : 'text-zinc-300'} />}
                                    {bucket.rls_enabled && <Shield size={12} className={selectedBucketName === bucket.name ? 'text-black' : 'text-primary'} />}
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setBucketDialogMode('edit');
                                        }}
                                        className={`p-1 rounded-md transition-all ${selectedBucketName === bucket.name ? 'hover:bg-black/10' : 'hover:bg-white/5 opacity-0 group-hover:opacity-100'}`}
                                    >
                                        <Settings size={12} className={selectedBucketName === bucket.name ? 'text-black' : 'text-zinc-400'} />
                                    </button>
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setBucketPendingDelete(bucket);
                                        }}
                                        className={`p-1 rounded-md transition-all ${selectedBucketName === bucket.name ? 'hover:bg-black/10' : 'hover:bg-white/5 opacity-0 group-hover:opacity-100 text-red-500'}`}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                            <h3 className={`text-sm font-bold italic tracking-tight uppercase leading-none truncate ${selectedBucketName === bucket.name ? 'text-black' : 'text-white'}`}>
                                {bucket.name}
                            </h3>
                            <div className="mt-2 flex items-center justify-between">
                                <span className={`text-[9px] font-bold uppercase tracking-widest ${selectedBucketName === bucket.name ? 'text-black/40' : 'text-zinc-300'}`}>{bucket.object_count} OBS</span>
                                <span className={`text-[9px] font-bold italic tabular-nums ${selectedBucketName === bucket.name ? 'text-black' : 'text-zinc-300'}`}>{formatSize(bucket.total_size)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* Main Object Explorer */}
            <main className="flex-1 flex flex-col min-w-0 relative z-10">
                <header className="px-8 py-10 border-b border-white/5 flex items-end justify-between gap-8 bg-linear-to-b from-zinc-900/50 to-transparent relative overflow-hidden">
                    <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
                    <div className="flex items-center gap-8">
                        <div className="w-16 h-16 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_50px_rgba(254,254,0,0.1)] relative z-10">
                            <FolderOpen size={28} strokeWidth={1} />
                        </div>
                        <div className="relative z-10">
                             <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-300 uppercase italic">Ozy Kernel :: Storage Node</p>
                             <h1 className="mt-2 text-3xl font-bold text-white uppercase italic tracking-tighter leading-none">{selectedBucket.name}</h1>
                             <div className="mt-6 flex items-center gap-6">
                                <span className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest italic border ${selectedBucket.public ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
                                    {selectedBucket.public ? 'Public_Access_Unlocked' : 'Encrypted_Vault_Locked'}
                                </span>
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-[0.2em]">{selectedBucket.object_count} REGISTERED_BLOBS</span>
                             </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex bg-black/40 p-2 rounded-md border border-white/5 shadow-inner mr-4">
                            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}><LayoutGrid size={16} /></button>
                            <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}><List size={16} /></button>
                        </div>
                        <button 
                             onClick={() => fileInputRef.current?.click()}
                             disabled={isUploading}
                             className={`h-11 flex items-center gap-4 px-8 rounded-md font-bold text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg group ${isUploading ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed' : 'bg-white text-black hover:scale-105 active:scale-95'}`}
                        >
                            {isUploading ? (
                                <RefreshCw size={18} strokeWidth={3} className="animate-spin" />
                            ) : (
                                <Upload size={18} strokeWidth={3} className="group-hover:-translate-y-1 transition-transform" />
                            )}
                            {isUploading ? (
                                <span className="animate-pulse">Transmitting Data...</span>
                            ) : (
                                'Upload Packet'
                            )}
                        </button>
                        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-8 flex flex-col gap-8">
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-3 px-2 py-1 bg-white/2 rounded-md border border-white/5 w-fit">
                        <button 
                            onClick={() => setCurrentPath([])}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tighter transition-all ${currentPath.length === 0 ? 'text-primary bg-primary/10 shadow-[0_0_15px_rgba(254,254,0,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            <Database size={12} />
                            Root Level
                        </button>
                        {currentPath.map((part, index) => (
                            <React.Fragment key={index}>
                                <ChevronRight size={12} className="text-zinc-700" />
                                <button 
                                    onClick={() => setCurrentPath(currentPath.slice(0, index + 1))}
                                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tighter transition-all ${index === currentPath.length - 1 ? 'text-primary bg-primary/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {part}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="flex items-center justify-between gap-8">
                         <div className="flex-1 h-11 bg-black/40 rounded-md border border-white/5 flex items-center px-5 gap-4 group focus-within:border-primary/30 transition-all shadow-inner">
                            <Search size={18} className="text-zinc-700 group-focus-within:text-primary transition-colors" />
                            <input 
                                type="text" 
                                placeholder="Identify object vector..." 
                                value={searchQuery} 
                                onChange={(e) => setSearchQuery(e.target.value)} 
                                className="bg-transparent border-none text-[11px] font-bold text-white focus:outline-none w-full uppercase tracking-widest placeholder:text-zinc-600" 
                            />
                        </div>
                        <div className="flex items-center gap-4">
                            <button 
                                onClick={() => setShowNewFolderModal(true)}
                                className="h-11 flex items-center gap-3 bg-white/5 border border-white/10 text-zinc-400 px-6 rounded-md font-bold text-[10px] uppercase tracking-[0.2em] hover:bg-white/10 hover:text-white transition-all group"
                            >
                                <FolderPlus size={16} className="group-hover:scale-110 transition-transform" />
                                New Folder
                            </button>
                            <div className="flex items-center gap-6 py-3 px-8 bg-[#131313] border border-white/5 rounded-md">
                                <div className="text-center">
                                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Weight</p>
                                    <p className="text-sm font-bold text-zinc-300 italic tabular-nums mt-2">{formatSize(selectedBucket.total_size)}</p>
                                </div>
                                <div className="w-px h-8 bg-white/5" />
                                <div className="text-center">
                                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest leading-none">Health</p>
                                    <p className="text-sm font-bold text-emerald-500 italic uppercase mt-2">NOMINAL</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {loadingFiles ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-50 grayscale animate-pulse py-20">
                            <Activity size={48} className="text-primary" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.4em] italic">Scanning_Kernel_Storage...</span>
                        </div>
                    ) : filteredFiles.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-[48px] bg-white/1 gap-8 py-32 opacity-70 grayscale hover:opacity-100 transition-opacity">
                            <Database size={64} strokeWidth={1} />
                            <div className="text-center">
                                <h4 className="text-[12px] font-bold text-white uppercase tracking-[0.5em] italic">No Objects Detected</h4>
                                <p className="mt-4 text-[9px] font-medium text-zinc-400 uppercase tracking-widest">Vault perimeter is currently vacant of registered vectors.</p>
                            </div>
                        </div>
                    ) : viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {(filteredFiles as any[]).map((file) => (
                                <div 
                                    key={file.id} 
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setContextMenu({ x: e.clientX, y: e.clientY, file });
                                    }}
                                    onClick={() => {
                                        if (file.is_folder) {
                                            setCurrentPath([...currentPath, file.name]);
                                        } else if (file.content_type?.startsWith('image/')) {
                                            setPreviewObject(file);
                                        } else {
                                            window.open(file.download_url, '_blank');
                                        }
                                    }}
                                    className={`group relative rounded-md border border-white/5 bg-[#131313] p-5 transition-all hover:bg-white/3 hover:border-white/10 shadow-2xl overflow-hidden cursor-pointer ${file.is_folder ? 'border-primary/5 hover:border-primary/20' : ''}`}
                                >
                                     <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                     <div className="flex items-start justify-between mb-6">
                                         <div className={`w-12 h-12 rounded-md bg-black border border-white/10 flex items-center justify-center transition-all group-hover:scale-110 ${file.is_folder ? 'text-primary' : 'text-zinc-600 group-hover:text-primary'}`}>
                                            {file.is_folder ? <FolderOpen size={24} strokeWidth={1.5} /> : file.content_type?.startsWith('image/') ? <ImageIcon size={24} strokeWidth={1.5} /> : <FileIcon size={24} strokeWidth={1.5} />}
                                         </div>
                                         <div className="flex gap-2">
                                             <button onClick={(e) => { e.stopPropagation(); window.open(file.download_url); }} className="w-9 h-9 rounded-md bg-white/3 border border-white/5 flex items-center justify-center text-zinc-600 hover:text-white transition-all opacity-0 group-hover:opacity-100"><Download size={14} /></button>
                                             <div className="relative group/menu">
                                                <button onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }} className="w-9 h-9 rounded-md bg-white/3 border border-white/5 flex items-center justify-center text-zinc-600 hover:text-white transition-all opacity-0 group-hover:opacity-100"><MoreVertical size={14} /></button>
                                             </div>
                                         </div>
                                     </div>
                                     <h4 className="text-[13px] font-bold text-white italic tracking-tight uppercase truncate leading-none mb-3">{file.name}</h4>
                                     {!file.is_folder && (
                                         <div className="flex items-center justify-between">
                                             <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest truncate max-w-[120px]">{file.content_type}</span>
                                             <span className="text-[10px] font-bold text-zinc-400 italic tabular-nums">{formatSize(file.size)}</span>
                                         </div>
                                     )}
                                     <div className="mt-5 pt-4 border-t border-white/5 opacity-40 flex items-center justify-between">
                                         <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">{file.created_at ? new Date(file.created_at).toLocaleDateString() : 'UNKNOWN_TIMESTAMP'}</span>
                                         {!file.is_folder && (
                                             <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-all">
                                                <span className="text-[8px] font-bold text-primary uppercase italic">Synchronized</span>
                                                <Zap size={8} className="text-primary" />
                                             </div>
                                         )}
                                     </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="bg-[#131313] border border-white/5 rounded-[32px] overflow-hidden shadow-2xl relative">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-white/3 border-b border-white/5">
                                        <th className="px-10 py-6 text-[9px] font-bold text-zinc-400 uppercase tracking-[0.4em] italic">Vector_Identity</th>
                                        <th className="px-10 py-6 text-[9px] font-bold text-zinc-400 uppercase tracking-[0.4em] italic">Classification</th>
                                        <th className="px-10 py-6 text-[9px] font-bold text-zinc-400 uppercase tracking-[0.4em] italic">Scale</th>
                                        <th className="px-10 py-6 text-[9px] font-bold text-zinc-400 uppercase tracking-[0.4em] italic text-right">Sequence</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {(filteredFiles as any[]).map((file) => (
                                        <tr 
                                            key={file.id} 
                                            onClick={() => {
                                                if (file.is_folder) {
                                                    setCurrentPath([...currentPath, file.name]);
                                                } else if (file.content_type?.startsWith('image/')) {
                                                    setPreviewObject(file);
                                                } else {
                                                    window.open(file.download_url, '_blank');
                                                }
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setContextMenu({ x: e.clientX, y: e.clientY, file });
                                            }}
                                            className="group hover:bg-white/2 transition-all cursor-pointer"
                                        >
                                            <td className="px-10 py-5">
                                                <div className="flex items-center gap-5">
                                                    <div className={`transition-all ${file.is_folder ? 'text-primary' : 'text-zinc-600 group-hover:text-primary'}`}>
                                                        {file.is_folder ? <FolderOpen size={18} /> : file.content_type?.startsWith('image/') ? <ImageIcon size={18} /> : <FileIcon size={18} />}
                                                    </div>
                                                    <span className="text-[12px] font-bold text-white italic tracking-tight truncate max-w-sm uppercase">{file.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-10 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{file.is_folder ? 'DIRECTORY_KERNEL' : file.content_type}</td>
                                            <td className="px-10 py-5 text-[11px] text-zinc-200 font-bold tabular-nums italic">{file.is_folder ? '--' : formatSize(file.size)}</td>
                                            <td className="px-10 py-5 text-right">
                                                <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={(e) => { e.stopPropagation(); window.open(file.download_url); }} className="p-2.5 rounded-md bg-white/5 text-zinc-500 hover:text-white transition-all"><Download size={14} /></button>
                                                    <button onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }} className="p-2.5 rounded-md bg-white/5 text-zinc-500 hover:text-white transition-all"><MoreVertical size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Registry Sections */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                         <section className="rounded-md border border-white/5 bg-background p-6 shadow-2xl relative overflow-hidden group/reg">
                            <div className="absolute inset-0 bg-linear-to-br from-indigo-500/3 to-transparent pointer-events-none" />
                            <div className="flex items-start justify-between mb-8 relative z-10">
                                <div>
                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none">Access Control Matrix</p>
                                    <h3 className="mt-3 text-xl font-bold text-white uppercase italic tracking-tighter">Bucket Identity</h3>
                                </div>
                                <div className="w-10 h-10 rounded-md bg-indigo-500/5 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                    <Shield size={20} />
                                </div>
                            </div>
                            <div className="space-y-3 relative z-10">
                                <div className="flex items-center justify-between p-5 rounded-md bg-black/40 border border-white/5">
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Visibility_Mode</span>
                                    <span className={`text-[10px] font-bold uppercase italic tracking-widest ${selectedBucket.public ? 'text-primary' : 'text-zinc-500'}`}>{selectedBucket.public ? 'PUBLIC_READS' : 'PRIVATE'}</span>
                                </div>
                                <div className="flex items-center justify-between p-5 rounded-md bg-black/40 border border-white/5">
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">ACL_Enforcement</span>
                                    <span className={`text-[10px] font-bold uppercase italic tracking-widest ${selectedBucket.rls_enabled ? 'text-emerald-500' : 'text-zinc-500'}`}>{selectedBucket.rls_enabled ? 'RLS_ACTIVE' : 'OFF'}</span>
                                </div>
                                <div className="p-5 rounded-md bg-black border border-white/5 font-mono">
                                     <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest mb-2 italic">Active_Kernel_Rule</p>
                                     <code className="text-[10px] text-zinc-400 break-all">{selectedBucket.rls_rule || 'TRUE'}</code>
                                </div>
                            </div>
                         </section>

                         <section className="rounded-md border border-white/5 bg-background p-6 shadow-2xl relative overflow-hidden group/reg">
                            <div className="absolute inset-0 bg-linear-to-br from-red-500/3 to-transparent pointer-events-none" />
                            <div className="flex items-start justify-between mb-8 relative z-10">
                                <div>
                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none">Resource Quotas</p>
                                    <h3 className="mt-3 text-xl font-bold text-white uppercase italic tracking-tighter">Enforced Limits</h3>
                                </div>
                                <div className="w-10 h-10 rounded-md bg-red-500/5 border border-red-500/20 flex items-center justify-center text-red-500">
                                    <Activity size={20} />
                                </div>
                            </div>
                            <div className="space-y-3 relative z-10">
                                <div className="flex items-center justify-between p-5 rounded-md bg-black/40 border border-white/5">
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Transmission_Cap</span>
                                    <span className="text-[10px] font-bold text-white uppercase italic tracking-widest tabular-nums">{selectedBucket.max_file_size_bytes > 0 ? formatSize(selectedBucket.max_file_size_bytes) : 'INF'}</span>
                                </div>
                                <div className="flex items-center justify-between p-5 rounded-md bg-black/40 border border-white/5">
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Aggregate_Quota</span>
                                    <span className="text-[10px] font-bold text-white uppercase italic tracking-widest tabular-nums">{selectedBucket.max_total_size_bytes > 0 ? formatSize(selectedBucket.max_total_size_bytes) : 'ELASTIC'}</span>
                                </div>
                                <div className="p-5 rounded-md bg-black/60 border border-white/5 flex flex-col items-center gap-3">
                                     <div className="w-full bg-white/2 h-1.5 rounded-full overflow-hidden border border-white/5">
                                        <div className="bg-primary h-full transition-all duration-1000 shadow-[0_0_10px_rgba(254,254,0,0.3)]" style={{ width: `${selectedBucket.usage_ratio_pct || 0}%` }} />
                                     </div>
                                     <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest italic">{selectedBucket.usage_ratio_pct || 0}% CONSUMED</p>
                                </div>
                            </div>
                         </section>
                    </div>
                </div>
            </main>

            {/* Bucket Dialog (Modal) */}
            {bucketDialogMode && (
                <div className="fixed inset-0 z-120 flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl animate-in fade-in duration-500">
                     <div className="absolute inset-0 pointer-events-auto" onClick={() => !isSavingBucket && setBucketDialogMode(null)} />
                     <div className="relative w-full max-w-4xl bg-[#131313] border border-white/10 rounded-[48px] overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-700">
                         <header className="px-12 py-10 border-b border-white/5 flex items-center justify-between bg-white/2">
                            <div className="flex items-center gap-5">
                                <div className="w-14 h-14 rounded-[22px] bg-primary/5 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                                    <HardDrive size={28} strokeWidth={1.5} />
                                </div>
                                 <div>
                                    <h2 className="text-3xl font-bold text-white italic tracking-tighter uppercase leading-none">{bucketDialogMode === 'create' ? 'Provision_Bucket' : 'Reconfigure_Node'}</h2>
                                    <p className="text-[10px] text-zinc-400 uppercase font-bold mt-3 tracking-widest leading-none">Registering edge-compatible storage namespace</p>
                                </div>
                            </div>
                            <button onClick={() => !isSavingBucket && setBucketDialogMode(null)} className="px-6 py-2 rounded-md bg-white/3 text-zinc-500 hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest border border-white/5">CANCEL</button>
                         </header>

                         <div className="p-12 space-y-10 max-h-[60vh] overflow-y-auto custom-scrollbar">
                             <div className="space-y-4">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">Bucket Identifier</label>
                                <div className={`p-8 rounded-2xl bg-black border border-white/5 shadow-inner transition-opacity ${bucketDialogMode === 'edit' ? 'opacity-40' : ''}`}>
                                    <input 
                                        type="text" 
                                        disabled={bucketDialogMode === 'edit'}
                                        value={bucketForm.name}
                                        onChange={(e) => {
                                            const nextValue = e.target.value;
                                            setBucketForm({ ...bucketForm, name: nextValue });
                                            if (!nextValue.trim()) {
                                                setBucketNameError('Bucket identifier is required');
                                            } else {
                                                setBucketNameError('');
                                            }
                                        }}
                                        placeholder="e.g. assets-protocol" 
                                        className="w-full bg-transparent border-none p-0 text-lg font-bold text-white outline-none placeholder:text-zinc-700 tracking-[0.2em] font-mono uppercase" 
                                    />
                                    <p className="mt-4 text-[10px] uppercase tracking-[0.35em] text-zinc-500 leading-5">
                                        Spaces are converted to dashes. Use lowercase letters, numbers, dots, dashes or underscores.
                                    </p>
                                    {bucketNameError ? (
                                        <p className="mt-3 text-[10px] uppercase tracking-[0.35em] text-amber-400 leading-5">
                                            {bucketNameError}
                                        </p>
                                    ) : null}
                                </div>
                             </div>

                              <div className="grid grid-cols-2 gap-10">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">Visibility_Vector</label>
                                    <div 
                                        onClick={() => setBucketForm({ ...bucketForm, isPublic: !bucketForm.isPublic })}
                                        className={`p-8 rounded-[32px] border cursor-pointer transition-all ${bucketForm.isPublic ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-black border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold uppercase italic tracking-widest">{bucketForm.isPublic ? 'PUBLIC_ACCESS' : 'PRIVATE_VAULT'}</span>
                                            {bucketForm.isPublic ? <Globe size={20} /> : <Lock size={20} />}
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">ACL_Profile</label>
                                    <OzySelect
                                        value={bucketForm.policyProfile}
                                        onChange={(e: any) => setBucketForm({ ...bucketForm, policyProfile: e.target.value as BucketPolicyProfile })}
                                        wrapperClassName="rounded-[32px] border-white/5 bg-black overflow-hidden"
                                        selectClassName="h-20 px-8 text-sm font-bold uppercase tracking-widest italic text-zinc-200"
                                    >
                                        <option value="visibility_only">VISIBILITY_ONLY</option>
                                        <option value="owner_only">OWNER_ISOLATION</option>
                                        <option value="admin_only">ADMIN_CONSOLE_ONLY</option>
                                        <option value="deny_all">SEALED_NODE</option>
                                    </OzySelect>
                                </div>
                             </div>

                              <div className="grid grid-cols-3 gap-6">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">Max_Object (MB)</label>
                                    <div className="p-6 bg-black border border-white/5 rounded-2xl">
                                        <input type="number" value={bucketForm.maxFileSizeMB} onChange={(e) => setBucketForm({ ...bucketForm, maxFileSizeMB: e.target.value })} placeholder="0_INF" className="w-full bg-transparent border-none text-base font-bold text-white font-mono text-center focus:outline-none placeholder:text-zinc-800" />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">Quota (MB)</label>
                                    <div className="p-6 bg-black border border-white/5 rounded-2xl">
                                        <input type="number" value={bucketForm.maxTotalSizeMB} onChange={(e) => setBucketForm({ ...bucketForm, maxTotalSizeMB: e.target.value })} placeholder="0_INF" className="w-full bg-transparent border-none text-base font-bold text-white font-mono text-center focus:outline-none placeholder:text-zinc-800" />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] italic leading-none ml-2">Retention (Days)</label>
                                    <div className="p-6 bg-black border border-white/5 rounded-2xl">
                                        <input type="number" value={bucketForm.lifecycleDeleteAfterDays} onChange={(e) => setBucketForm({ ...bucketForm, lifecycleDeleteAfterDays: e.target.value })} placeholder="0_INF" className="w-full bg-transparent border-none text-base font-bold text-white font-mono text-center focus:outline-none placeholder:text-zinc-800" />
                                    </div>
                                </div>
                             </div>
                         </div>

                         <footer className="p-12 bg-black/40 border-t border-white/5">
                             <button
                                onClick={handleBucketSave}
                                disabled={isSavingBucket}
                                className="w-full h-16 bg-white text-black rounded-[32px] font-bold text-[12px] uppercase tracking-[0.4em] hover:scale-[1.02] active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-4 italic disabled:opacity-50"
                             >
                                {isSavingBucket ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} fill="currentColor" />}
                                {isSavingBucket ? 'SYNCHRONIZING_NODE...' : bucketDialogMode === 'create' ? 'CREATE BUCKET' : 'SAVE CHANGES'}
                             </button>
                         </footer>
                     </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!bucketPendingDelete}
                onClose={() => setBucketPendingDelete(null)}
                onConfirm={handleDeleteBucket}
                title="PURGE_BUCKET_ENCLAVE"
                message={`CRITICAL: This will immediately delete [${bucketPendingDelete?.name || ''}] and all contained objects. This action is irreversible within the current storage cycle.`}
                confirmText="Purge Enclave"
                type="danger"
            />

            <ConfirmModal
                isOpen={!!filePendingDelete}
                onClose={() => setFilePendingDelete(null)}
                onConfirm={handleDeleteFile}
                title="RELEASE_OBJECT_VECTOR"
                message={`Unregister [${filePendingDelete?.name || ''}] from edge storage?`}
                confirmText="Unregister Object"
                type="danger"
            />

            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-150" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
                    <div 
                        className="fixed z-160 min-w-56 bg-[#1A1A1A] border border-white/10 rounded-md shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <div className="p-2 border-b border-white/5 bg-white/2">
                            <p className="px-4 py-2 text-[8px] font-bold text-zinc-500 uppercase tracking-widest leading-none">{contextMenu.file.is_folder ? 'DIRECTORY_KERNEL' : 'OBJECT_VECTOR'}</p>
                            <p className="px-4 pb-2 text-[10px] font-bold text-white truncate max-w-[200px] leading-none mt-1">{contextMenu.file.name}</p>
                        </div>
                        <div className="p-1.5">
                            {!contextMenu.file.is_folder && (
                                <>
                                    <button onClick={() => { handleCopyURL(contextMenu.file); setContextMenu(null); }} className="w-full flex items-center justify-between px-4 py-3 rounded-md hover:bg-white/5 transition-colors group">
                                        <div className="flex items-center gap-3">
                                            <ExternalLink size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Get_URL</span>
                                        </div>
                                        <Copy size={12} className="text-zinc-700 opacity-40" />
                                    </button>
                                    <button onClick={() => { window.open(contextMenu.file.download_url); setContextMenu(null); }} className="w-full flex items-center justify-between px-4 py-3 rounded-md hover:bg-white/5 transition-colors group">
                                        <div className="flex items-center gap-3">
                                            <Download size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Download</span>
                                        </div>
                                    </button>
                                </>
                            )}
                            <button onClick={() => { setRenamingFile(contextMenu.file); setNewNameValue(contextMenu.file.name); setContextMenu(null); }} className="w-full flex items-center justify-between px-4 py-3 rounded-md hover:bg-white/5 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <Type size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Rename</span>
                                </div>
                            </button>
                            <button onClick={() => { setMovingFile(contextMenu.file); setMovingTarget(''); setContextMenu(null); }} className="w-full flex items-center justify-between px-4 py-3 rounded-md hover:bg-white/5 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <MoveHorizontal size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Relocate</span>
                                </div>
                            </button>
                            <div className="my-1 border-t border-white/5" />
                            <button onClick={() => { setFilePendingDelete(contextMenu.file); setContextMenu(null); }} className="w-full flex items-center justify-between px-4 py-3 rounded-md hover:bg-red-500/10 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <Trash2 size={14} className="text-red-500/50 group-hover:text-red-500 transition-colors" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-red-500/70 group-hover:text-red-500">Purge</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Rename Modal */}
            {renamingFile && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[#131313] border border-white/10 rounded-[32px] p-10 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white italic uppercase tracking-tighter mb-6 underline decoration-primary/30 decoration-4 underline-offset-8">Rename Object</h3>
                        <div className="p-5 bg-black border border-white/5 rounded-md mb-8">
                            <input 
                                type="text"
                                autoFocus
                                value={newNameValue}
                                onChange={(e) => setNewNameValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                                className="w-full bg-transparent border-none text-[12px] font-bold text-white uppercase tracking-widest focus:outline-none placeholder:text-zinc-700"
                                placeholder="New name..."
                            />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setRenamingFile(null)} className="flex-1 h-14 rounded-md bg-white/5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-all border border-white/5">Cancel</button>
                            <button onClick={handleRename} className="flex-1 h-14 rounded-md bg-primary text-black text-[10px] font-bold uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-primary/10">Save Name</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Relocation Modal */}
            {movingFile && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[#131313] border border-white/10 rounded-[32px] p-10 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white italic uppercase tracking-tighter mb-6 underline decoration-emerald-500/30 decoration-4 underline-offset-8">Move Object</h3>
                        <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-4 font-bold">Target Namespace (e.g. storage/assets)</p>
                        <div className="p-5 bg-black border border-white/5 rounded-md mb-8">
                            <input 
                                type="text"
                                autoFocus
                                value={movingTarget}
                                onChange={(e) => setMovingTarget(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleMove()}
                                className="w-full bg-transparent border-none text-[12px] font-bold text-white uppercase tracking-widest focus:outline-none placeholder:text-zinc-700"
                                placeholder="Target path..."
                            />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setMovingFile(null)} className="flex-1 h-14 rounded-md bg-white/5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-all border border-white/5">Cancel</button>
                            <button onClick={handleMove} className="flex-1 h-14 rounded-md bg-primary text-black text-[10px] font-bold uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-primary/10">Move Object</button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Folder Modal */}
            {showNewFolderModal && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[#131313] border border-white/10 rounded-[32px] p-10 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white italic uppercase tracking-tighter mb-6 underline decoration-indigo-500/30 decoration-4 underline-offset-8">Create Folder</h3>
                        <div className="p-5 bg-black border border-white/5 rounded-md mb-8">
                            <input 
                                type="text"
                                autoFocus
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                                className="w-full bg-transparent border-none text-[12px] font-bold text-white uppercase tracking-widest focus:outline-none placeholder:text-zinc-700 font-mono"
                                placeholder="Folder name..."
                            />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowNewFolderModal(false)} className="flex-1 h-14 rounded-md bg-white/5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-all border border-white/5">Cancel</button>
                            <button onClick={handleCreateFolder} className="flex-1 h-14 rounded-md bg-primary text-black text-[10px] font-bold uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-primary/10">Create Folder</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Preview Modal */}
            {previewObject && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200"
                    onClick={() => setPreviewObject(null)}
                >
                    <div 
                        className="relative max-w-7xl max-h-[90vh] w-full flex flex-col items-center gap-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button 
                            onClick={() => setPreviewObject(null)}
                            className="fixed top-8 right-8 z-100 p-4 bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full text-white transition-all border border-white/10 shadow-2xl active:scale-90"
                        >
                            <X size={24} />
                        </button>

                        {/* Image container */}
                        <div className="relative group bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">
                            <img 
                                src={previewObject.download_url} 
                                alt={previewObject.name}
                                className="max-w-full max-h-[70vh] object-contain select-none"
                            />
                        </div>

                        {/* Controls/Info */}
                        <div className="flex flex-col items-center gap-4 bg-[#131313] border border-white/10 p-6 rounded-[24px] shadow-2xl min-w-[340px]">
                            <h4 className="text-sm font-bold text-white uppercase tracking-widest italic">{previewObject.name}</h4>
                            <div className="flex items-center gap-6">
                                <div className="text-center">
                                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Type</p>
                                    <p className="text-[10px] font-bold text-zinc-300 uppercase mt-1">{previewObject.content_type}</p>
                                </div>
                                <div className="w-px h-6 bg-white/10" />
                                <div className="text-center">
                                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Scale</p>
                                    <p className="text-[10px] font-bold text-zinc-300 mt-1 tabular-nums">{formatSize(previewObject.size)}</p>
                                </div>
                            </div>
                            
                            <div className="flex gap-3 w-full mt-2">
                                <button 
                                    onClick={() => window.open(previewObject.download_url, '_blank')}
                                    className="flex-1 h-12 rounded-lg bg-white/5 border border-white/10 text-[9px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                                >
                                    <ExternalLink size={14} />
                                    Open Raw
                                </button>
                                <button 
                                    onClick={() => {
                                        const link = document.createElement('a');
                                        link.href = previewObject.download_url;
                                        link.download = previewObject.name;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                    }}
                                    className="flex-1 h-12 rounded-lg bg-primary text-black text-[9px] font-bold uppercase tracking-widest hover:scale-105 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/10"
                                >
                                    <Download size={14} />
                                    Download
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StorageManager;


