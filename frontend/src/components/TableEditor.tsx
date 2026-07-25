import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Key,
  AtSign,
  Calendar,
  CheckCircle2,
  Plus,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Search,
  RefreshCw,
  Code2,
  Download,
  Hash,
  Database,
  Trash2,
  FileUp,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ListPlus,
  Globe,
  DollarSign,
  Layers,
  Cpu,
  GripVertical,
  Pin,
  PinOff,
  Settings2,
  Wifi,
  CheckSquare,
  X,
  LayoutGrid,
  Copy,
  Edit3,
} from "lucide-react";

import AddRowModal from "./AddRowModal";
import AddColumnModal from "./AddColumnModal";
import ConfirmModal from "./ConfirmModal";
import BulkEditModal from "./BulkEditModal";
import InlineCellEditor from "./InlineCellEditor";
import CSVImportModal from "./CSVImportModal";
import EditColumnModal from "./EditColumnModal";
import { BrandedToast } from "./OverlayPrimitives";
import TableEditorFooter from "./table-editor/TableEditorFooter";
import TableEditorToolbar from "./table-editor/TableEditorToolbar";
import TableEditorTabs from "./table-editor/TableEditorTabs";
import { fetchWithAuth } from "../utils/api";
import { findRLSIssueForTable, type HealthIssueLike } from "../utils/healthIssues";
import { useDenseDesktopViewport } from "../utils/denseViewport";

// --- Custom Hooks ---

function useDebounce(value: any, delay: any) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// localStorage key for column widths
const getStorageKey = (tableName: any) => `ozybase_column_widths_${tableName}`;
const getHiddenColumnsStorageKey = (tableName: any) =>
  `ozybase_hidden_columns_${tableName}`;
const getPinnedColumnsStorageKey = (tableName: any) =>
  `ozybase_pinned_columns_${tableName}`;

// Default column widths by type
const getDefaultWidth = (colName: any, colType: any) => {
  const type = (colType || "text").toLowerCase();
  if (colName === "id") return 280;
  if (type.includes("uuid")) return 280;
  if (type.includes("bool")) return 100;
  if (type.includes("int") || type.includes("num")) return 120;
  if (type.includes("date") || type.includes("time")) return 180;
  if (type.includes("json")) return 250;
  return 180; // default for text
};

const MAX_COLUMN_WIDTH = 5000;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const VIRTUAL_OVERSCAN_ROWS = 8;
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000, 2000];
const CHECKBOX_COLUMN_WIDTH = 40;
const ACTIONS_COLUMN_WIDTH = 80;
const TABLE_DENSITY_STORAGE_KEY = "ozybase_table_density";
const ROW_DENSITY_OPTIONS: Record<
  string,
  { label: string; rowHeight: number }
> = {
  compact: { label: "Compact", rowHeight: 36 },
  standard: { label: "Standard", rowHeight: 45 },
  comfortable: { label: "Comfortable", rowHeight: 56 },
};
const PROTECTED_SYSTEM_COLUMNS = new Set([
  "updated_at",
  "deleted_at",
]);

// Dynamic minimum width based on header content
const calculateMinColumnWidth = (_columnName?: string) => {
  return 60;
};

const SkeletonRow = ({
  columns,
  getColumnWidth,
  rowHeight,
  showSelection = true,
  showActions = true,
}: any) => (
  <div
    className="flex border-b border-border/50"
    style={{ height: `${rowHeight}px` }}
  >
    {showSelection && (
      <div className="w-10 px-4 flex items-center shrink-0 bg-background border-r border-border/40">
        <div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" />
      </div>
    )}
    {columns.map((col: any, i: any) => (
      <div
        key={i}
        className="px-4 flex items-center shrink-0"
        style={{ width: `${getColumnWidth(col.name, col.type)}px` }}
      >
        <div className="h-4 bg-zinc-800 rounded animate-pulse w-[80%]" />
      </div>
    ))}
    {showActions && (
      <div className="w-20 px-4 flex items-center justify-end shrink-0 bg-background border-l border-border/40" />
    )}
  </div>
);

interface TableEditorProps {
  tableName: string | null;
  openTableTabs?: string[];
  onCloseTab?: (tableName: string) => void;
  onTableSelect: (tableName: string) => void;
  onOpenSqlEditor?: (
    tableName: string | null,
    initialQuery?: string | null,
  ) => void;
  onViewSelect?: (view: string) => void;
  allTables?: any[];
  onRefreshTables?: () => void;
  onOpenCreateTable?: () => void;
}

const TableEditor: React.FC<TableEditorProps> = ({
  tableName,
  openTableTabs = [],
  onCloseTab,
  onTableSelect,
  onOpenSqlEditor,
  onViewSelect,
  allTables = [],
  onRefreshTables,
  onOpenCreateTable,
}: any) => {
  const [data, setData] = useState<any[]>([]);
  const [schema, setSchema] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [isColumnsPanelOpen, setIsColumnsPanelOpen] = useState(false);
  const [isInsertDropdownOpen, setIsInsertDropdownOpen] = useState(false);
  const [isTableSwitcherOpen, setIsTableSwitcherOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [pageJumpInput, setPageJumpInput] = useState("1");
  const [confirmDeleteId, setConfirmDeleteId] = useState<any>(null);
  const [alertMessage, setAlertMessage] = useState<any>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [isRealtimeLoading, setIsRealtimeLoading] = useState(false);
  const [realtimeConnectionState, setRealtimeConnectionState] = useState<
    "off" | "connecting" | "live" | "error"
  >("off");
  const [liveToast, setLiveToast] = useState<{
    message: string;
    key: number;
  } | null>(null);
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(
    new Set(),
  );
  const [dismissedManagementBanners, setDismissedManagementBanners] = useState<
    Set<string>
  >(new Set());
  const [tablePolicyIssue, setTablePolicyIssue] = useState<HealthIssueLike | null>(
    null,
  );
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [filters, setFilters] = useState<any[]>([]);
  const [sorts, setSorts] = useState<any[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [views, setViews] = useState<any[]>([]);
  const [activeViewId, setActiveViewId] = useState<any>(null);
  const [viewName, setViewName] = useState("");
  const [isViewsOpen, setIsViewsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [csvImport, setCsvImport] = useState<any>(null);
  const [columnSearchTerm, setColumnSearchTerm] = useState("");
  const [rowDensity, setRowDensity] = useState(() => {
    if (typeof window === "undefined") return "standard";
    const saved = window.localStorage.getItem(TABLE_DENSITY_STORAGE_KEY);
    return saved && ROW_DENSITY_OPTIONS[saved] ? saved : "standard";
  });
  const isDenseViewport = useDenseDesktopViewport();
  const hasTables = Array.isArray(allTables) && allTables.length > 0;
  const availableTables = hasTables
    ? allTables
        .map((table: any) => String(table?.name || "").trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Pagination State
  const [pageSize, setPageSize] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [hasMoreRecords, setHasMoreRecords] = useState(false);
  const [isTotalExact, setIsTotalExact] = useState(true);

  // --- NEW: Column Widths & Inline Editing State ---
  const [columnWidths, setColumnWidths] = useState<Record<string, any>>({});
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<any>(null); // { rowId, colName }
  const [resizingColumn, setResizingColumn] = useState<any>(null);
  const [activeHeaderMenu, setActiveHeaderMenu] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<any>(null);
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState<any>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const columnWidthsRef = useRef<Record<string, any>>({});
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: any;
    colName: string;
  } | null>(null);
  const fetchDataRef = useRef<() => Promise<void>>(async () => undefined);
  const liveRefreshTimeoutRef = useRef<number | null>(null);
  const liveToastTimeoutRef = useRef<number | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  // Load saved column widths from localStorage
  useEffect(() => {
    if (tableName) {
      const saved = localStorage.getItem(getStorageKey(tableName));
      if (saved) {
        try {
          setColumnWidths(JSON.parse(saved));
        } catch {
          setColumnWidths({});
        }
      } else {
        setColumnWidths({});
      }
    }
  }, [tableName]);

  // Save column widths to localStorage
  const saveColumnWidths = useCallback(
    (widths: Record<string, any>) => {
      if (tableName) {
        localStorage.setItem(getStorageKey(tableName), JSON.stringify(widths));
      }
    },
    [tableName],
  );

  const saveHiddenColumns = useCallback(
    (nextHiddenColumns: string[]) => {
      if (tableName) {
        localStorage.setItem(
          getHiddenColumnsStorageKey(tableName),
          JSON.stringify(nextHiddenColumns),
        );
      }
    },
    [tableName],
  );

  const savePinnedColumns = useCallback(
    (nextPinnedColumns: string[]) => {
      if (tableName) {
        localStorage.setItem(
          getPinnedColumnsStorageKey(tableName),
          JSON.stringify(nextPinnedColumns),
        );
      }
    },
    [tableName],
  );

  useEffect(() => {
    if (!tableName) {
      setHiddenColumns([]);
      return;
    }
    const saved = localStorage.getItem(getHiddenColumnsStorageKey(tableName));
    if (!saved) {
      setHiddenColumns([]);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setHiddenColumns(
        Array.isArray(parsed)
          ? parsed.filter((value: any) => typeof value === "string")
          : [],
      );
    } catch {
      setHiddenColumns([]);
    }
  }, [tableName, schema.length]);

  useEffect(() => {
    if (!tableName) {
      setPinnedColumns([]);
      return;
    }
    const saved = localStorage.getItem(getPinnedColumnsStorageKey(tableName));
    if (!saved) {
      setPinnedColumns([]);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setPinnedColumns(
        Array.isArray(parsed)
          ? parsed.filter((value: any) => typeof value === "string")
          : [],
      );
    } catch {
      setPinnedColumns([]);
    }
  }, [tableName, schema.length]);

  useEffect(() => {
    window.localStorage.setItem(TABLE_DENSITY_STORAGE_KEY, rowDensity);
  }, [rowDensity]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const showLiveToast = useCallback((message: string) => {
    setLiveToast({ message, key: Date.now() });
    if (liveToastTimeoutRef.current !== null) {
      window.clearTimeout(liveToastTimeoutRef.current);
    }
    liveToastTimeoutRef.current = window.setTimeout(() => {
      setLiveToast(null);
      liveToastTimeoutRef.current = null;
    }, 2600);
  }, []);

  const fetchRealtimeStatus = useCallback(async () => {
    if (!tableName) return;
    try {
      const res = await fetchWithAuth("/api/collections");
      const collections = await res.json();
      const current = collections.find((c: any) => c.name === tableName);
      setRealtimeEnabled(Boolean(current?.realtime_enabled));
    } catch (e) {
      console.error(e);
    }
  }, [tableName]);

  const applyView = useCallback((view: any) => {
    const config = view?.config || {};
    setFilters(Array.isArray(config.filters) ? config.filters : []);
    setSorts(Array.isArray(config.sorts) ? config.sorts : []);
    setSearchTerm(
      typeof config.searchTerm === "string" ? config.searchTerm : "",
    );
    setPageSize(Number.isFinite(config.pageSize) ? config.pageSize : 100);
    setCurrentPage(1);
    setActiveViewId(view?.id || null);
    setIsViewsOpen(false);
  }, []);

  const fetchViews = useCallback(async () => {
    if (!tableName) return;
    try {
      const res = await fetchWithAuth(`/api/tables/${tableName}/views`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setViews(list);
      const defaultView = list.find((v: any) => v.is_default);
      if (defaultView) {
        applyView(defaultView);
      } else if (activeViewId) {
        const stillExists = list.find((v: any) => v.id === activeViewId);
        if (!stillExists) setActiveViewId(null);
      }
    } catch (e) {
      console.error("Failed to fetch table views", e);
    }
  }, [tableName, activeViewId, applyView]);

  const currentViewConfig = useMemo(
    () => ({
      filters,
      sorts,
      searchTerm,
      pageSize,
    }),
    [filters, sorts, searchTerm, pageSize],
  );

  if (!tableName) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#0c0c0c] px-6 py-10 overflow-hidden">
        <div className="w-full max-w-lg rounded-xl border border-[#2e2e2e] bg-[#111111] px-10 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database size={20} />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Table Editor</p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {hasTables ? "Select a table to start editing" : "Create your first table"}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {hasTables
              ? "Pick an existing table below or switch back to the overview to continue."
              : "This project has no tables yet. Create the first table to begin storing data."}
          </p>

          {hasTables ? (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {availableTables.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onTableSelect(name)}
                  className="rounded-md border border-[#2e2e2e] bg-[#171717] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => onOpenCreateTable?.()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-black transition-colors hover:bg-primary/90"
            >
              <Plus size={14} />
              Create first table
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleCreateView = useCallback(async () => {
    if (!tableName || !viewName.trim()) {
      return;
    }
    const res = await fetchWithAuth(`/api/tables/${tableName}/views`, {
      method: "POST",
      body: JSON.stringify({
        name: viewName.trim(),
        config: currentViewConfig,
      }),
    });
    if (!res.ok) {
      return;
    }
    setViewName("");
    fetchViews();
  }, [currentViewConfig, fetchViews, tableName, viewName]);

  const handleUpdateView = useCallback(async () => {
    if (!tableName || !activeViewId) {
      return;
    }
    const res = await fetchWithAuth(
      `/api/tables/${tableName}/views/${activeViewId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ config: currentViewConfig }),
      },
    );
    if (res.ok) {
      fetchViews();
    }
  }, [activeViewId, currentViewConfig, fetchViews, tableName]);

  const handleSetDefaultView = useCallback(async () => {
    if (!tableName || !activeViewId) {
      return;
    }
    const res = await fetchWithAuth(
      `/api/tables/${tableName}/views/${activeViewId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ is_default: true }),
      },
    );
    if (res.ok) {
      fetchViews();
    }
  }, [activeViewId, fetchViews, tableName]);

  const handleDeleteView = useCallback(async () => {
    if (!tableName || !activeViewId) {
      return;
    }
    const res = await fetchWithAuth(
      `/api/tables/${tableName}/views/${activeViewId}`,
      {
        method: "DELETE",
      },
    );
    if (!res.ok) {
      return;
    }
    setActiveViewId(null);
    fetchViews();
  }, [activeViewId, fetchViews, tableName]);

  const resetViewControls = useCallback(() => {
    setFilters([]);
    setSorts([]);
    setSearchTerm("");
    setPageSize(100);
    setCurrentPage(1);
    setActiveViewId(null);
  }, []);

  const fetchData = useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    try {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      params.set("count_mode", "auto");
      if (debouncedSearch) params.set("q", debouncedSearch);

      const orderParam = sorts
        .filter((s: any) => s.column && s.direction)
        .map((s: any) => `${s.column}.${s.direction}`)
        .join(",");
      if (orderParam) params.set("order", orderParam);

      filters
        .filter((f: any) => f.column && f.value !== undefined && f.value !== "")
        .forEach((f: any) => {
          params.append(f.column, `${f.op}.${f.value}`);
        });

      const [schemaRes, dataRes] = await Promise.all([
        fetchWithAuth(`/api/schema/${tableName}`),
        fetchWithAuth(`/api/tables/${tableName}?${params.toString()}`),
      ]);

      if (!schemaRes.ok)
        throw new Error(`Table '${tableName}' schema lookup failed`);
      if (!dataRes.ok) throw new Error("Failed to fetch data");

      const [schemaItems, result] = await Promise.all([
        schemaRes.json(),
        dataRes.json(),
      ]);

      setSchema(schemaItems);
      setData(Array.isArray(result.data) ? result.data : []);
      setTotalRecords(typeof result.total === "number" ? result.total : 0);
      setHasMoreRecords(Boolean(result.hasMore));
      setIsTotalExact(Boolean(result.totalExact ?? true));
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tableName, pageSize, currentPage, debouncedSearch, filters, sorts]);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (contextMenu) {
      const handleGlobalClick = () => handleCloseContextMenu();
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleCloseContextMenu();
      };
      window.addEventListener("click", handleGlobalClick);
      window.addEventListener("keydown", handleGlobalKeyDown);
      return () => {
        window.removeEventListener("click", handleGlobalClick);
        window.removeEventListener("keydown", handleGlobalKeyDown);
      };
    }
  }, [contextMenu, handleCloseContextMenu]);

  const handleContextMenu = (e: React.MouseEvent, row: any, colName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, row, colName });
  };

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    if (tableName) {
      fetchData();
    }
  }, [tableName, fetchData]);

  useEffect(() => {
    if (tableName) {
      fetchRealtimeStatus();
    }
  }, [tableName, fetchRealtimeStatus]);

  useEffect(() => {
    setRealtimeEnabled(false);
    setRealtimeConnectionState("off");
  }, [tableName]);

  const openTableDefinition = useCallback(async () => {
    if (!tableName) {
      return;
    }

    try {
      const res = await fetchWithAuth(
        `/api/schema/${encodeURIComponent(tableName)}/definition`,
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Failed to load table definition");
      }

      const payload = (await res.json()) as {
        editor_sql?: string;
        definition_sql?: string;
      };
      const rawDefinition =
        typeof payload.editor_sql === "string" && payload.editor_sql.trim()
          ? payload.editor_sql
          : payload.definition_sql;

      const schemaSummary = Array.isArray(schema)
        ? schema
            .map((column: any) => {
              const name = String(column?.name || "").trim();
              const type = String(column?.type || "text").trim() || "text";
              if (!name) return "";
              return `${name} : ${type}`;
            })
            .filter(Boolean)
        : [];

      const summaryHeader = schemaSummary.length
        ? `-- Columns (name : type)\n${schemaSummary
            .map((item: any) => `-- ${item}`)
            .join("\n")}\n\n`
        : "";

      const initialQuery = rawDefinition
        ? `${summaryHeader}${rawDefinition}`
        : rawDefinition;

      onOpenSqlEditor?.(tableName, initialQuery || null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load table definition";
      setAlertMessage({
        title: "Definition unavailable",
        message,
        type: "danger",
      });
    }
  }, [onOpenSqlEditor, schema, tableName]);

  useEffect(() => {
    if (tableName) {
      fetchViews();
      setEditingCell(null); // Clear editing state when table changes
      setIsColumnsPanelOpen(false);
      setColumnSearchTerm("");
      setActiveHeaderMenu(null);
    }
  }, [tableName, fetchViews]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.closest("[data-column-menu-root]")
      )
        return;
      setActiveHeaderMenu(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const toggleRealtime = useCallback(async () => {
    setIsRealtimeLoading(true);
    try {
      const res = await fetchWithAuth("/api/collections/realtime", {
        method: "PATCH",
        body: JSON.stringify({ name: tableName, enabled: !realtimeEnabled }),
      });
      if (res.ok) {
        setRealtimeEnabled(!realtimeEnabled);
        showLiveToast(
          !realtimeEnabled
            ? "Realtime enabled for this table."
            : "Realtime disabled for this table.",
        );
        // Refresh global tables list to update sidebar icon
        onRefreshTables?.();
      }
    } catch (e) {
      console.error(e);
    }
    setIsRealtimeLoading(false);
  }, [tableName, realtimeEnabled, showLiveToast, onRefreshTables]);

  const requestRealtimeToggle = useCallback(() => {
    if (
      isRealtimeLoading ||
      !tableName ||
      String(tableName).startsWith("_v_")
    ) {
      return;
    }
    toggleRealtime();
  }, [isRealtimeLoading, tableName, toggleRealtime]);

  useEffect(() => {
    const canStreamRealtime =
      Boolean(tableName) &&
      realtimeEnabled &&
      !String(tableName).startsWith("_v_") &&
      isDocumentVisible;

    if (!canStreamRealtime) {
      setRealtimeConnectionState("off");
      if (liveRefreshTimeoutRef.current !== null) {
        window.clearTimeout(liveRefreshTimeoutRef.current);
        liveRefreshTimeoutRef.current = null;
      }
      return undefined;
    }

    let disposed = false;
    let eventSource: EventSource | null = null;
    const activeTable = String(tableName);

    const attachHandlers = (source: EventSource) => {
      source.onopen = () => {
        if (!disposed) {
          setRealtimeConnectionState("live");
        }
      };

      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data || "{}");
          const eventTable = String(payload?.table || "");
          const eventAction = String(payload?.action || "").toUpperCase();

          if (eventTable !== activeTable) {
            return;
          }
          if (!["INSERT", "UPDATE", "DELETE"].includes(eventAction)) {
            return;
          }
          if (liveRefreshTimeoutRef.current !== null) {
            return;
          }

          liveRefreshTimeoutRef.current = window.setTimeout(() => {
            liveRefreshTimeoutRef.current = null;
            void fetchDataRef.current().then(() => {
              if (!disposed) {
                showLiveToast("Live update applied");
              }
            });
          }, 450);
        } catch (err) {
          console.error("Failed to parse realtime event", err);
        }
      };

      source.onerror = (err) => {
        if (!disposed) {
          setRealtimeConnectionState("error");
        }
        console.error("Table editor realtime stream error", err);
      };
    };

    const openRealtimeStream = async () => {
      setRealtimeConnectionState("connecting");
      const workspaceId =
        localStorage.getItem("ozy_workspace_id")?.trim().toLowerCase() || "";
      const requestedChannels = workspaceId
        ? [`workspace:${workspaceId}`, `table:${workspaceId}:${activeTable.toLowerCase()}`]
        : [];

      const sessionRes = await fetchWithAuth("/api/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          channels: requestedChannels,
          expires_in: 300,
        }),
      });

      if (disposed) {
        return;
      }

      if (sessionRes.status === 404 || sessionRes.status === 405) {
        eventSource = new EventSource("/api/realtime");
        attachHandlers(eventSource);
        return;
      }

      if (!sessionRes.ok) {
        const payload = await sessionRes
          .json()
          .catch(() => null) as { error?: unknown } | null;
        throw new Error(
          String(
            payload?.error ||
              `Failed to create realtime session (${sessionRes.status})`,
          ),
        );
      }

      const sessionPayload = await sessionRes
        .json()
        .catch(() => null) as { token?: unknown; channels?: unknown } | null;
      const token =
        typeof sessionPayload?.token === "string"
          ? sessionPayload.token.trim()
          : "";
      if (!token) {
        throw new Error("Realtime session did not return a token");
      }

      const grantedChannels = Array.isArray(sessionPayload?.channels)
        ? sessionPayload.channels
            .filter(
              (item: unknown): item is string =>
                typeof item === "string" && item.trim().length > 0,
            )
            .map((item) => item.trim())
        : [];
      const streamUrl = new URL("/api/realtime", window.location.origin);
      streamUrl.searchParams.set("token", token);
      if (grantedChannels.length > 0) {
        streamUrl.searchParams.set("channels", grantedChannels.join(","));
      }

      eventSource = new EventSource(`${streamUrl.pathname}${streamUrl.search}`);
      attachHandlers(eventSource);
    };

    void openRealtimeStream().catch((err) => {
      if (!disposed) {
        setRealtimeConnectionState("error");
      }
      console.error("Table editor realtime bootstrap error", err);
    });

    return () => {
      disposed = true;
      eventSource?.close();
      setRealtimeConnectionState("off");
      if (liveRefreshTimeoutRef.current !== null) {
        window.clearTimeout(liveRefreshTimeoutRef.current);
        liveRefreshTimeoutRef.current = null;
      }
    };
  }, [
    activeViewId,
    isDocumentVisible,
    realtimeEnabled,
    showLiveToast,
    tableName,
  ]);

  useEffect(
    () => () => {
      if (liveRefreshTimeoutRef.current !== null) {
        window.clearTimeout(liveRefreshTimeoutRef.current);
      }
      if (liveToastTimeoutRef.current !== null) {
        window.clearTimeout(liveToastTimeoutRef.current);
      }
    },
    [],
  );

  // --- Column Resize Handlers ---
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setResizingColumn(colName);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current =
        columnWidths[colName] ||
        getDefaultWidth(
          colName,
          schema.find((c: any) => c.name === colName)?.type,
        );
    },
    [columnWidths, schema],
  );

  useEffect(() => {
    if (!resizingColumn) return;

    const handleResizeMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const minWidth = calculateMinColumnWidth(resizingColumn);
      const newWidth = Math.max(
        minWidth,
        Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + delta),
      );

      setColumnWidths((prev: any) => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };

    const handleResizeEnd = () => {
      saveColumnWidths(columnWidthsRef.current);
      setResizingColumn(null);
    };

    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);

    return () => {
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [resizingColumn, saveColumnWidths]);

  // --- Virtualization Logic ---
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowHeight =
    ROW_DENSITY_OPTIONS[rowDensity]?.rowHeight ||
    ROW_DENSITY_OPTIONS.standard.rowHeight;
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const [horizontalOverflow, setHorizontalOverflow] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateHorizontalOverflow = useCallback(
    (node?: HTMLDivElement | null) => {
      if (!node) {
        setHorizontalOverflow({ canScrollLeft: false, canScrollRight: false });
        return;
      }
      const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
      setHorizontalOverflow({
        canScrollLeft: node.scrollLeft > 6,
        canScrollRight: node.scrollLeft < maxScrollLeft - 6,
      });
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const node = containerRef.current;
    const updateViewportHeight = () => {
      const nextHeight = node.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
      setViewportHeight(Math.max(rowHeight * 4, nextHeight));
      updateHorizontalOverflow(node);
    };

    updateViewportHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportHeight);
      return () => window.removeEventListener("resize", updateViewportHeight);
    }

    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rowHeight, updateHorizontalOverflow]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = 0;
    containerRef.current.scrollLeft = 0;
    setScrollTop(0);
    updateHorizontalOverflow(containerRef.current);
  }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

  const currentTableMeta = useMemo(
    () => allTables.find((t: any) => t.name === tableName),
    [allTables, tableName],
  );

  useEffect(() => {
    if (!tableName) {
      setTablePolicyIssue(null);
      return undefined;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadPolicyIssue = async () => {
      try {
        const response = await fetchWithAuth("/api/project/health", {
          signal: controller.signal,
        });

        if (!response.ok) {
          if (isActive) {
            setTablePolicyIssue(null);
          }
          return;
        }

        const payload = await response.json();
        if (!isActive) {
          return;
        }

        const issues = Array.isArray(payload) ? payload : [];
        setTablePolicyIssue(findRLSIssueForTable(issues, tableName));
      } catch (err: any) {
        if (!isActive || controller.signal.aborted || err?.name === "AbortError") {
          return;
        }
        console.error("Failed to load policy health issue for table", err);
        setTablePolicyIssue(null);
      }
    };

    void loadPolicyIssue();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [
    tableName,
    currentTableMeta?.rls_enabled,
    currentTableMeta?.list_rule,
    currentTableMeta?.create_rule,
  ]);

  const showsManagementAccessNotice = useMemo(
    () => Boolean(tableName && tablePolicyIssue),
    [tableName, tablePolicyIssue],
  );
  const managementAccessMessage = useMemo(() => {
    if (!tablePolicyIssue) {
      return "";
    }

    const rawTitle = String(tablePolicyIssue?.title || "").trim();
    const rawDescription = String(tablePolicyIssue?.description || "").trim();
    const normalizedTitle = rawTitle.replace(/^table\s+`[^`]+`\s*/i, "").trim();

    if (rawDescription && normalizedTitle) {
      return `Policy issue detected: ${normalizedTitle}. ${rawDescription}`;
    }
    if (rawDescription) {
      return `Policy issue detected: ${rawDescription}`;
    }
    if (normalizedTitle) {
      return `Policy issue detected: ${normalizedTitle}`;
    }

    return "Policy issue detected on this table. Review Runtime Policies before continuing.";
  }, [tablePolicyIssue]);
  const primaryKeyColumn = currentTableMeta?.primary_key_column || null;
  const hasPrimaryRowIdentity = Boolean(
    currentTableMeta?.has_primary_id && primaryKeyColumn,
  );
  const hasGenericIDColumn = Boolean(currentTableMeta?.has_id);
  const primaryIdColumn = hasGenericIDColumn
    ? "id"
    : hasPrimaryRowIdentity
      ? primaryKeyColumn
      : null;
  const rowIdentityEnabled = Boolean(primaryIdColumn);
  const isFallbackRowIdentity = Boolean(
    rowIdentityEnabled && hasGenericIDColumn && !hasPrimaryRowIdentity,
  );
  const getRowIdentityValue = useCallback(
    (row: Record<string, any>) =>
      primaryIdColumn ? row?.[primaryIdColumn] : undefined,
    [primaryIdColumn],
  );
  const getRowIdentityString = useCallback(
    (row: Record<string, any>) => {
      const value = getRowIdentityValue(row);
      return value === undefined || value === null ? "" : String(value);
    },
    [getRowIdentityValue],
  );
  const createdAtEnabled = currentTableMeta?.has_created_at ?? true;
  const selectionColumnWidth = rowIdentityEnabled ? CHECKBOX_COLUMN_WIDTH : 0;
  const actionsColumnWidth = rowIdentityEnabled ? ACTIONS_COLUMN_WIDTH : 0;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

  useEffect(() => {
    if (!rowIdentityEnabled) {
      setSelectedIds(new Set());
    }
  }, [rowIdentityEnabled]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
      updateHorizontalOverflow(e.currentTarget);
    },
    [updateHorizontalOverflow],
  );

  const scrollGridToStart = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({ left: 0, behavior: "smooth" });
  }, []);

  const scrollGridForward = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    node.scrollBy({
      left: Math.max(260, Math.round(node.clientWidth * 0.72)),
      behavior: "smooth",
    });
  }, []);

  const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN_ROWS,
  );
  const endIndex = Math.min(
    data.length,
    startIndex + visibleRowCount + VIRTUAL_OVERSCAN_ROWS * 2,
  );
  const visibleData = useMemo(
    () => data.slice(startIndex, endIndex),
    [data, startIndex, endIndex],
  );
  const topPadding = startIndex * rowHeight;
  const bottomPadding = (data.length - endIndex) * rowHeight;
  const totalPages = isTotalExact
    ? Math.max(1, Math.ceil(totalRecords / pageSize))
    : Math.max(currentPage, currentPage + (hasMoreRecords ? 1 : 0));
  const pageStartRecord =
    data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEndRecord =
    data.length === 0 ? 0 : (currentPage - 1) * pageSize + data.length;
  const visibleIds = useMemo(
    () =>
      rowIdentityEnabled
        ? visibleData
            .map((row: any) => getRowIdentityString(row))
            .filter(Boolean)
        : [],
    [getRowIdentityString, rowIdentityEnabled, visibleData],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id: any) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id: any) => selectedIds.has(id));
  const selectedCount = rowIdentityEnabled ? selectedIds.size : 0;

  useEffect(() => {
    if (isTotalExact && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, isTotalExact, totalPages]);

  useEffect(() => {
    setPageJumpInput(String(currentPage));
  }, [currentPage]);

  const goToPage = useCallback(
    (rawPage: number) => {
      const maxPage = isTotalExact ? totalPages : Math.max(1, rawPage);
      const nextPage = Math.min(maxPage, Math.max(1, rawPage));
      setCurrentPage(nextPage);
      setPageJumpInput(String(nextPage));
    },
    [isTotalExact, totalPages],
  );

  const resetDataView = useCallback(() => {
    setSearchTerm("");
    setFilters([]);
    setSorts([]);
    setCurrentPage(1);
    setActiveViewId(null);
    setHiddenColumns([]);
    setPinnedColumns([]);
    saveHiddenColumns([]);
    savePinnedColumns([]);
    setAlertMessage({
      title: "View Reset",
      message:
        "Search, filters, sorts, page, hidden columns and frozen columns were reset for this table.",
      type: "success",
    });
  }, [saveHiddenColumns, savePinnedColumns]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate =
      !allVisibleSelected && someVisibleSelected;
  }, [allVisibleSelected, someVisibleSelected]);

  // --- Cell Editing Handlers ---
  const handleCellClick = useCallback(
    (rowId: any, colName: any) => {
      if (!rowIdentityEnabled) return;
      // Don't allow editing protected system columns
      if (PROTECTED_SYSTEM_COLUMNS.has(colName)) return;
      setEditingCell({ rowId, colName });
    },
    [rowIdentityEnabled, primaryIdColumn],
  );

  const handleCellSave = useCallback(
    (rowId: any, colName: any, newValue: any) => {
      if (!rowIdentityEnabled) return;
      setData((prev: any) =>
        prev.map((row: any) =>
          String(row[primaryIdColumn]) === String(rowId)
            ? { ...row, [colName]: newValue }
            : row,
        ),
      );
      setEditingCell(null);
    },
    [rowIdentityEnabled, primaryIdColumn],
  );

  const handleCellCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  const normalizeHeader = useCallback((value: any) => {
    return String(value || "")
      .toLowerCase()
      .replace(/^\ufeff/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }, []);

  const buildInitialMapping = useCallback(
    (headers: any, schemaColumns: any) => {
      const normalizedSchema = new Map();
      schemaColumns.forEach((col: any) => {
        normalizedSchema.set(normalizeHeader(col), col);
      });

      const mapping: Record<number, string> = {};
      headers.forEach((header: any) => {
        const normalized = normalizeHeader(header.raw || header.label);
        if (normalizedSchema.has(normalized)) {
          mapping[header.index] = normalizedSchema.get(normalized);
          return;
        }
        const alt = normalized.replace(/_/g, "");
        const fallback = [...normalizedSchema.entries()].find(
          ([key]: any) => key.replace(/_/g, "") === alt,
        );
        mapping[header.index] = fallback ? fallback[1] : "";
      });
      return mapping;
    },
    [normalizeHeader],
  );

  const handleCSVImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!rowIdentityEnabled) return;
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event: ProgressEvent<FileReader>) => {
        const text = event.target?.result;
        if (typeof text !== "string") return;
        const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
        if (lines.length < 1) return;

        const detectDelimiter = (sampleLine: any) => {
          const candidates = [",", ";", "\t", "|"];
          const counts = candidates.map((delim: any) => {
            let count = 0;
            let inQuote = false;
            for (let i = 0; i < sampleLine.length; i++) {
              const char = sampleLine[i];
              if (char === '"' && sampleLine[i + 1] === '"') {
                i++;
                continue;
              }
              if (char === '"') {
                inQuote = !inQuote;
                continue;
              }
              if (!inQuote && char === delim) count++;
            }
            return count;
          });
          let bestIndex = 0;
          counts.forEach((count: any, idx: any) => {
            if (count > counts[bestIndex]) bestIndex = idx;
          });
          return counts[bestIndex] > 0 ? candidates[bestIndex] : ",";
        };

        const parseCsv = (
          rawLines: string[],
          delimiter: string,
          useHeaderRow: boolean,
          headerRowIndex: number,
        ) => {
          const splitLine = (line: string) => {
            const result: string[] = [];
            let cur = "";
            let inQuote = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
              } else if (char === '"') {
                inQuote = !inQuote;
              } else if (char === delimiter && !inQuote) {
                result.push(cur.trim());
                cur = "";
              } else {
                cur += char;
              }
            }
            result.push(cur.trim());
            return result;
          };

          const headerRow = Math.max(1, headerRowIndex || 1);
          const headerLine = useHeaderRow ? rawLines[headerRow - 1] || "" : "";
          const headerValues = useHeaderRow ? splitLine(headerLine) : [];
          const firstRowValues = useHeaderRow ? null : splitLine(rawLines[0]);
          const columnCount = Math.max(
            headerValues.length,
            firstRowValues?.length || 0,
          );

          const rawHeaders = (
            useHeaderRow
              ? headerValues
              : Array.from(
                  { length: columnCount },
                  (_: any, i: any) => `Column ${i + 1}`,
                )
          ).map((header: any, index: any) => {
            const label = header?.trim() || `Column ${index + 1}`;
            return {
              raw: header || "",
              label,
              index,
              sampleValues: [] as string[],
            };
          });

          const parsedRows: string[][] = [];
          const startIndex = useHeaderRow ? headerRow : 0;
          for (let i = startIndex; i < rawLines.length; i++) {
            const values = splitLine(rawLines[i]);
            if (values.length === 1 && values[0] === "") continue;
            parsedRows.push(values);
            rawHeaders.forEach((header: any) => {
              if (header.sampleValues.length < 3) {
                const value = values[header.index];
                if (value !== undefined && value !== "") {
                  header.sampleValues.push(value);
                }
              }
            });
          }

          return { rawHeaders, parsedRows };
        };

        const detectedDelimiter = detectDelimiter(lines[0]);
        const useHeaderRow = true;
        const headerRowIndex = 1;
        const { rawHeaders, parsedRows } = parseCsv(
          lines,
          detectedDelimiter,
          useHeaderRow,
          headerRowIndex,
        );

        const editableColumns = schema
          .map((col: any) => col.name)
          .filter((col: any) => !PROTECTED_SYSTEM_COLUMNS.has(col));

        setCsvImport({
          fileName: file.name,
          lines,
          delimiter: "auto",
          detectedDelimiter,
          useHeaderRow,
          headerRowIndex,
          headers: rawHeaders,
          rows: parsedRows,
          totalRows: parsedRows.length,
          columns: editableColumns,
          initialMapping: buildInitialMapping(rawHeaders, editableColumns),
        });
        setIsCsvImportOpen(true);
        setIsInsertDropdownOpen(false);
        if (csvInputRef.current) {
          csvInputRef.current.value = "";
        }
      };
      reader.readAsText(file);
    },
    [buildInitialMapping, rowIdentityEnabled, schema],
  );

  const updateCsvImport = useCallback(
    (
      nextDelimiter: string,
      nextUseHeaderRow: boolean,
      nextHeaderRowIndex: number,
    ) => {
      setCsvImport((prev: any) => {
        if (!prev) return prev;
        const effectiveDelimiter =
          nextDelimiter === "auto"
            ? prev.detectedDelimiter || ","
            : nextDelimiter;

        const splitLine = (line: string) => {
          const result: string[] = [];
          let cur = "";
          let inQuote = false;
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else if (char === '"') {
              inQuote = !inQuote;
            } else if (char === effectiveDelimiter && !inQuote) {
              result.push(cur.trim());
              cur = "";
            } else {
              cur += char;
            }
          }
          result.push(cur.trim());
          return result;
        };

        const headerRow = Math.max(1, nextHeaderRowIndex || 1);
        const headerLine = nextUseHeaderRow
          ? prev.lines[headerRow - 1] || ""
          : "";
        const headerValues = nextUseHeaderRow ? splitLine(headerLine) : [];
        const firstRowValues = nextUseHeaderRow
          ? null
          : splitLine(prev.lines[0]);
        const columnCount = Math.max(
          headerValues.length,
          firstRowValues?.length || 0,
        );

        const rawHeaders = (
          nextUseHeaderRow
            ? headerValues
            : Array.from(
                { length: columnCount },
                (_: any, i: any) => `Column ${i + 1}`,
              )
        ).map((header: any, index: any) => {
          const label = header?.trim() || `Column ${index + 1}`;
          return {
            raw: header || "",
            label,
            index,
            sampleValues: [] as string[],
          };
        });

        const parsedRows: string[][] = [];
        const startIndex = nextUseHeaderRow ? headerRow : 0;
        for (let i = startIndex; i < prev.lines.length; i++) {
          const values = splitLine(prev.lines[i]);
          if (values.length === 1 && values[0] === "") continue;
          parsedRows.push(values);
          rawHeaders.forEach((header: any) => {
            if (header.sampleValues.length < 3) {
              const value = values[header.index];
              if (value !== undefined && value !== "") {
                header.sampleValues.push(value);
              }
            }
          });
        }

        return {
          ...prev,
          delimiter: nextDelimiter,
          useHeaderRow: nextUseHeaderRow,
          headerRowIndex: headerRow,
          headers: rawHeaders,
          rows: parsedRows,
          totalRows: parsedRows.length,
          initialMapping: buildInitialMapping(rawHeaders, prev.columns),
        };
      });
    },
    [buildInitialMapping],
  );

  const handleCSVImportConfirm = useCallback(
    async (mapping: Record<number, string>) => {
      if (!rowIdentityEnabled) return;
      if (!csvImport) return;
      const { headers, rows } = csvImport;

      const records = rows
        .map((values: any) => {
          const record: Record<string, any> = {};
          headers.forEach((header: any) => {
            const target = mapping[header.index];
            if (!target) return;
            const val = values[header.index];
            if (val !== undefined && val !== "") {
              record[target] = val;
            }
          });
          return record;
        })
        .filter((record: any) => Object.keys(record).length > 0);

      if (records.length === 0) {
        setAlertMessage({
          title: "Import Failed",
          message: "No valid columns mapped for import.",
          type: "danger",
        });
        return;
      }

      try {
        setLoading(true);
        const res = await fetchWithAuth(`/api/tables/${tableName}/import`, {
          method: "POST",
          body: JSON.stringify(records),
        });
        if (res.ok) {
          setAlertMessage({
            title: "Success",
            message: "Imported successfully!",
            type: "success",
          });
          fetchData();
          setIsCsvImportOpen(false);
          setCsvImport(null);
        } else {
          const err = await res.json();
          setAlertMessage({
            title: "Import Failed",
            message: err.error || "Import failed",
            type: "danger",
          });
        }
      } catch {
        setAlertMessage({
          title: "Error",
          message: "Import failed due to network error",
          type: "danger",
        });
      } finally {
        setLoading(false);
      }
    },
    [csvImport, fetchData, rowIdentityEnabled, tableName],
  );

  const handleDeleteRow = useCallback(
    (id: string | number) => {
      if (!rowIdentityEnabled) return;
      setConfirmDeleteId(id);
    },
    [rowIdentityEnabled],
  );

  const toggleSelectRow = useCallback(
    (id: string | number) => {
      if (!rowIdentityEnabled) return;
      const rowId = String(id);
      setSelectedIds((prev) => {
        const next = new Set<string>(prev);
        if (next.has(rowId)) {
          next.delete(rowId);
        } else {
          next.add(rowId);
        }
        return next;
      });
    },
    [rowIdentityEnabled],
  );

  const toggleSelectAllVisible = useCallback(() => {
    if (!rowIdentityEnabled) return;
    setSelectedIds((prev) => {
      const next = new Set<string>(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id: any) => next.delete(id));
      } else {
        visibleIds.forEach((id: any) => next.add(id));
      }
      return next;
    });
  }, [allVisibleSelected, rowIdentityEnabled, visibleIds]);

  const confirmRowDeletion = useCallback(async () => {
    if (!rowIdentityEnabled) return;
    const id = confirmDeleteId;
    try {
      const res = await fetchWithAuth(`/api/tables/${tableName}/rows/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchData();
      } else {
        setAlertMessage({
          title: "Error",
          message: "Failed to delete row",
          type: "danger",
        });
      }
    } catch (err: any) {
      console.error(err);
      setAlertMessage({
        title: "Error",
        message: "Network error during deletion",
        type: "danger",
      });
    }
  }, [confirmDeleteId, fetchData, rowIdentityEnabled, tableName]);

  const handleExportCSV = useCallback(() => {
    if (data.length === 0) return;

    const headers = [
      ...(rowIdentityEnabled ? [primaryIdColumn] : []),
      ...schema.map((c: any) => c.name),
      ...(createdAtEnabled ? ["created_at"] : []),
    ];
    const csvRows = [
      headers.join(","),
      ...data.map((row: any) =>
        headers
          .map((h: any) => {
            const val = row[h];
            return typeof val === "string"
              ? `"${val.replace(/"/g, '""')}"`
              : val;
          })
          .join(","),
      ),
    ];

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}_export.csv`;
    a.click();
  }, [
    createdAtEnabled,
    data,
    primaryIdColumn,
    rowIdentityEnabled,
    schema,
    tableName,
  ]);

  const handleExportSelected = useCallback(() => {
    if (!rowIdentityEnabled) return;
    if (selectedIds.size === 0) return;
    const headers = [
      primaryIdColumn,
      ...schema.map((c: any) => c.name),
      ...(createdAtEnabled ? ["created_at"] : []),
    ];
    const selectedRows = data.filter((row: any) =>
      selectedIds.has(getRowIdentityString(row)),
    );
    const csvRows = [
      headers.join(","),
      ...selectedRows.map((row: any) =>
        headers
          .map((h: any) => {
            const val = row[h];
            return typeof val === "string"
              ? `"${val.replace(/"/g, '""')}"`
              : val;
          })
          .join(","),
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}_selected_export.csv`;
    a.click();
  }, [
    createdAtEnabled,
    data,
    getRowIdentityString,
    primaryIdColumn,
    rowIdentityEnabled,
    schema,
    selectedIds,
    tableName,
  ]);

  const handleBulkDelete = useCallback(async () => {
    if (!rowIdentityEnabled) return;
    if (selectedIds.size === 0) return;
    try {
      const res = await fetchWithAuth(`/api/tables/${tableName}/rows/bulk`, {
        method: "POST",
        body: JSON.stringify({
          action: "delete",
          ids: Array.from(selectedIds),
        }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setIsBulkDeleteOpen(false);
        fetchData();
      } else {
        setAlertMessage({
          title: "Bulk Delete Failed",
          message: "Could not delete selected rows.",
          type: "danger",
        });
      }
    } catch (err: any) {
      console.error(err);
      setAlertMessage({
        title: "Bulk Delete Failed",
        message: "Network error during bulk delete.",
        type: "danger",
      });
    }
  }, [fetchData, rowIdentityEnabled, selectedIds, tableName]);

  const applyHeaderSort = useCallback(
    (columnName: string, direction: "asc" | "desc") => {
      setSorts((prev) => {
        const remaining = prev.filter(
          (item: any) => item.column !== columnName,
        );
        return [
          { id: Date.now(), column: columnName, direction },
          ...remaining,
        ];
      });
      setActiveHeaderMenu(null);
    },
    [],
  );

  const confirmColumnDeletionAction = useCallback(async () => {
    if (!confirmDeleteColumn || !tableName) return;
    try {
      const res = await fetchWithAuth(
        `/api/tables/${tableName}/columns/${confirmDeleteColumn.name}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        await fetchData();
        setAlertMessage({
          title: "Column deleted",
          message: `${confirmDeleteColumn.name} was removed from ${tableName}.`,
          type: "success",
        });
        setConfirmDeleteColumn(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setAlertMessage({
        title: "Delete column failed",
        message:
          payload?.error || "Could not remove this column from the table.",
        type: "danger",
      });
    } catch (err: any) {
      console.error(err);
      setAlertMessage({
        title: "Delete column failed",
        message: "Network error while deleting the column.",
        type: "danger",
      });
    }
  }, [confirmDeleteColumn, fetchData, tableName]);

  const handleBulkUpdate = useCallback(
    async (payload: Record<string, any>) => {
      if (!rowIdentityEnabled) return;
      try {
        const res = await fetchWithAuth(`/api/tables/${tableName}/rows/bulk`, {
          method: "POST",
          body: JSON.stringify({
            action: "update",
            ids: Array.from(selectedIds),
            data: payload,
          }),
        });
        if (res.ok) {
          setSelectedIds(new Set());
          setIsBulkEditOpen(false);
          fetchData();
        } else {
          setAlertMessage({
            title: "Bulk Update Failed",
            message: "Could not update selected rows.",
            type: "danger",
          });
        }
      } catch (err: any) {
        console.error(err);
        setAlertMessage({
          title: "Bulk Update Failed",
          message: "Network error during bulk update.",
          type: "danger",
        });
      }
    },
    [fetchData, rowIdentityEnabled, selectedIds, tableName],
  );

  const handleEditRow = useCallback(
    (row: Record<string, any>) => {
      if (!rowIdentityEnabled) return;
      setEditingRow(row);
      setIsModalOpen(true);
    },
    [rowIdentityEnabled],
  );

  const getTypeIcon = useCallback((type: string) => {
    const t = (type || "text").toLowerCase();
    if (t.includes("uuid")) return <Key size={14} className="text-primary" />;
    if (t.includes("text") || t.includes("char"))
      return <AtSign size={14} className="text-primary" />;
    if (t.includes("time") || t.includes("date") || t.includes("interval"))
      return <Calendar size={14} className="text-primary" />;
    if (t.includes("bool"))
      return <CheckCircle2 size={14} className="text-primary" />;
    if (t.includes("num") || t.includes("int") || t.includes("float"))
      return <Hash size={14} className="text-primary" />;
    if (t.includes("inet") || t.includes("cidr"))
      return <Globe size={14} className="text-primary" />;
    if (t.includes("money"))
      return <DollarSign size={14} className="text-primary" />;
    if (t.includes("array"))
      return <Layers size={14} className="text-primary" />;
    if (t.includes("macaddr"))
      return <Cpu size={14} className="text-primary" />;
    if (t.includes("json")) return <Code2 size={14} className="text-primary" />;
    return <Database size={14} className="text-primary" />;
  }, []);

  const standardColumns = useMemo(() => {
    const schemaColumnNames = new Set(
      schema.map((col: any) => col.name.toLowerCase()),
    );
    const cols = [...schema];

    // Only prepend primary key if it exists in DB but NOT yet in schema metadata
    // (though now it should be in schema, we keep this for backward compatibility or virtual PKs)
    if (rowIdentityEnabled && !schemaColumnNames.has(primaryIdColumn)) {
      cols.unshift({ name: primaryIdColumn, type: "text" });
    }

    // Only append 'created_at' if it exists in DB but NOT yet in schema metadata
    if (createdAtEnabled && !schemaColumnNames.has("created_at")) {
      cols.push({ name: "created_at", type: "datetime" });
    }

    return cols;
  }, [createdAtEnabled, primaryIdColumn, rowIdentityEnabled, schema]);

  const hiddenColumnSet = useMemo(
    () => new Set(hiddenColumns),
    [hiddenColumns],
  );
  const pinnedColumnSet = useMemo(
    () => new Set(pinnedColumns),
    [pinnedColumns],
  );
  const visibleColumns = useMemo(
    () =>
      standardColumns.filter((col: any) => {
        return !hiddenColumnSet.has(col.name);
      }),
    [hiddenColumnSet, standardColumns],
  );
  const visibleColumnCount = visibleColumns.length;
  const totalColumnCount = standardColumns.length;
  const filteredColumnOptions = useMemo(() => {
    const needle = columnSearchTerm.trim().toLowerCase();
    if (!needle) {
      return standardColumns;
    }
    return standardColumns.filter((col: any) => {
      const haystack = `${col.name} ${col.type || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [columnSearchTerm, standardColumns]);

  useEffect(() => {
    if (standardColumns.length === 0) {
      return;
    }
    const allowed = new Set(standardColumns.map((col: any) => col.name));
    setHiddenColumns((prev: any) => {
      const next = prev.filter((name: string) => allowed.has(name));
      if (next.length !== prev.length) {
        saveHiddenColumns(next);
      }
      return next;
    });
  }, [saveHiddenColumns, standardColumns]);

  useEffect(() => {
    if (standardColumns.length === 0) {
      return;
    }
    const visible = new Set(visibleColumns.map((col: any) => col.name));
    const allowed = new Set(standardColumns.map((col: any) => col.name));
    setPinnedColumns((prev: any) => {
      const next = prev.filter(
        (name: string) => allowed.has(name) && visible.has(name),
      );
      if (next.length !== prev.length) {
        savePinnedColumns(next);
      }
      return next;
    });
  }, [savePinnedColumns, standardColumns, visibleColumns]);

  // Get column width with fallback to default
  const getColumnWidth = useCallback(
    (colName: string, colType: string) => {
      return columnWidths[colName] || getDefaultWidth(colName, colType);
    },
    [columnWidths],
  );

  // Calculate total table width
  const totalWidth = useMemo(
    () =>
      visibleColumns.reduce(
        (acc: any, col: any) => acc + getColumnWidth(col.name, col.type),
        0,
      ) +
      selectionColumnWidth +
      actionsColumnWidth,
    [actionsColumnWidth, getColumnWidth, selectionColumnWidth, visibleColumns],
  );
  const currentTableLabel = currentTableMeta?.display_name || tableName;
  const readOnlyCompatibilityMessage = currentTableMeta && !rowIdentityEnabled
    ? "This SQL table does not expose a writable row identity (an `id` column or a single-column primary key), so Table Editor is running in read-only mode. Use SQL Editor for writes until the table has a standard row identity."
    : null;
  const fallbackIdentityMessage = isFallbackRowIdentity
    ? "Editing is enabled using the `id` column, but this table still has no primary key. Keep `id` unique to avoid ambiguous updates."
    : null;
  const hiddenColumnCount = Math.max(0, totalColumnCount - visibleColumnCount);
  const hasQueryModifiers =
    searchTerm.trim() !== "" || filters.length > 0 || sorts.length > 0;
  const currentTableCopy = currentTableLabel || "this table";
  const deleteRecordMessage = `Delete this record from ${currentTableCopy}? This permanently removes the row and any downstream automations reading it.`;
  const deleteSelectedMessage = `Delete ${selectedCount} selected record${selectedCount === 1 ? "" : "s"} from ${currentTableCopy}? The selection is limited to the current page and the removal cannot be undone.`;
  const frozenColumnNames = useMemo(() => {
    return visibleColumns
      .filter((col: any) => pinnedColumnSet.has(col.name))
      .map((col: any) => col.name);
  }, [pinnedColumnSet, visibleColumns]);
  const pinnedOffsets = useMemo(() => {
    let nextOffset = selectionColumnWidth;
    const offsets: Record<string, number> = {};

    visibleColumns.forEach((col: any) => {
      const isPinned = pinnedColumnSet.has(col.name);
      if (!isPinned) {
        return;
      }
      offsets[col.name] = nextOffset;
      nextOffset += getColumnWidth(col.name, col.type);
    });

    return offsets;
  }, [getColumnWidth, pinnedColumnSet, selectionColumnWidth, visibleColumns]);

  useEffect(() => {
    updateHorizontalOverflow(containerRef.current);
  }, [
    data.length,
    totalRecords,
    totalWidth,
    updateHorizontalOverflow,
    visibleColumns.length,
  ]);

  const resetColumnLayout = useCallback(() => {
    setColumnWidths({});
    setPinnedColumns([]);
    if (tableName) {
      localStorage.removeItem(getStorageKey(tableName));
      localStorage.removeItem(getPinnedColumnsStorageKey(tableName));
    }
  }, [tableName]);

  const showAllColumns = useCallback(() => {
    setHiddenColumns([]);
    saveHiddenColumns([]);
  }, [saveHiddenColumns]);

  const toggleColumnVisibility = useCallback(
    (columnName: string) => {
      if (pinnedColumnSet.has(columnName)) {
        setAlertMessage({
          title: "Column Is Frozen",
          message:
            "Unfreeze this column before hiding it so the sticky layout stays predictable.",
          type: "info",
        });
        return;
      }
      setHiddenColumns((prev: any) => {
        const nextSet = new Set(prev);
        if (nextSet.has(columnName)) {
          nextSet.delete(columnName);
        } else {
          const currentlyVisible = standardColumns.filter((col: any) => {
            return !nextSet.has(col.name);
          }).length;
          if (currentlyVisible <= 1) {
            setAlertMessage({
              title: "Keep One Column Visible",
              message:
                "Table Editor needs at least one visible data column. Use SQL Editor for schema-wide inspection if you want a raw query view.",
              type: "info",
            });
            return prev;
          }
          nextSet.add(columnName);
        }
        const next = Array.from(nextSet) as string[];
        saveHiddenColumns(next);
        return next;
      });
    },
    [pinnedColumnSet, saveHiddenColumns, standardColumns],
  );

  const togglePinnedColumn = useCallback(
    (columnName: string) => {
      setPinnedColumns((prev: any) => {
        const nextSet = new Set(prev);
        if (nextSet.has(columnName)) {
          nextSet.delete(columnName);
        } else {
          nextSet.add(columnName);
        }
        const next = Array.from(nextSet) as string[];
        savePinnedColumns(next);
        return next;
      });
      setHiddenColumns((prev: any) => {
        if (!prev.includes(columnName)) {
          return prev;
        }
        const next = prev.filter((name: string) => name !== columnName);
        saveHiddenColumns(next);
        return next;
      });
  },
    [saveHiddenColumns, savePinnedColumns],
  );

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c] overflow-hidden">
      <TableEditorTabs
        openTabs={openTableTabs}
        activeTab={tableName}
        onTabSelect={onTableSelect}
        onTabClose={(tab) => onCloseTab?.(tab)}
        onNewTable={() => onOpenCreateTable?.()}
      />

      {/* Dynamic Alerts Area */}
      {((!rowIdentityEnabled && tableName && !dismissedBanners.has(tableName)) || isFallbackRowIdentity || showsManagementAccessNotice) && (
        <div className="shrink-0 flex flex-col gap-1 p-3 bg-[#0c0c0c] border-b border-border">
            {!rowIdentityEnabled && tableName && !dismissedBanners.has(tableName) && (
                <div className="flex items-center gap-3 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                    <p className="flex-1 text-[10px] text-zinc-500 leading-none uppercase tracking-tight">
                        <span className="font-bold text-amber-500 italic mr-2">READ_ONLY:</span>
                        {readOnlyCompatibilityMessage}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => onOpenSqlEditor?.(tableName, `-- Fix: Enable editing by adding a primary key...`)}
                            className="px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[8px] font-bold uppercase tracking-wider rounded transition-all hover:bg-amber-500 hover:text-black"
                        >
                            SQL_FIX
                        </button>
                        <button
                            onClick={() => setDismissedBanners((prev) => new Set(prev).add(tableName))}
                            className="p-0.5 text-zinc-600 hover:text-zinc-400"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}
            {isFallbackRowIdentity && (
                <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                    <AlertTriangle size={12} className="text-zinc-500 shrink-0" />
                    <p className="flex-1 text-[10px] text-zinc-500 leading-none uppercase tracking-tight">
                        <span className="font-bold text-white italic mr-2">IDENTITY:</span>
                        {fallbackIdentityMessage}
                    </p>
                </div>
            )}
            {showsManagementAccessNotice && tableName && !dismissedManagementBanners.has(tableName) && (
                <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                    <AlertTriangle size={12} className="text-primary shrink-0" />
                    <p className="flex-1 text-[10px] text-zinc-500 leading-none uppercase tracking-tight">
                        <span className="font-bold text-primary italic mr-2">POLICY:</span>
                        {managementAccessMessage}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => {
                                if (tableName) localStorage.setItem("ozy_policies_focus_table", tableName);
                                onViewSelect?.("policies");
                            }}
                            className="px-2 py-0.5 bg-zinc-800 text-zinc-300 border border-zinc-700 text-[8px] font-bold uppercase tracking-wider rounded hover:bg-zinc-700 transition-all"
                        >
                            RESOLVE
                        </button>
                        <button
                            onClick={() => setDismissedManagementBanners((prev) => new Set(prev).add(tableName))}
                            className="p-0.5 text-zinc-600 hover:text-zinc-400"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}
        </div>
      )}

      <TableEditorToolbar
        isDenseViewport={isDenseViewport}
        currentTableLabel={currentTableLabel}
        tableName={tableName}
        allTables={allTables}
        onTableSelect={onTableSelect}
        isTableSwitcherOpen={isTableSwitcherOpen}
        setIsTableSwitcherOpen={setIsTableSwitcherOpen}
        isViewsOpen={isViewsOpen}
        setIsViewsOpen={setIsViewsOpen}
        views={views}
        activeViewId={activeViewId}
        applyView={applyView}
        viewName={viewName}
        setViewName={setViewName}
        onCreateView={handleCreateView}
        onUpdateView={handleUpdateView}
        onSetDefaultView={handleSetDefaultView}
        onDeleteView={handleDeleteView}
        onResetViewControls={resetViewControls}
        isInsertDropdownOpen={isInsertDropdownOpen}
        setIsInsertDropdownOpen={setIsInsertDropdownOpen}
        rowIdentityEnabled={rowIdentityEnabled}
        rlsEnabled={currentTableMeta?.rls_enabled ?? false}
        onOpenInsertRow={() => {
          setEditingRow(null);
          setIsModalOpen(true);
        }}
        onOpenAddColumn={() => setIsColumnModalOpen(true)}
        handleCSVImport={handleCSVImport}
        csvInputRef={csvInputRef}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        filters={filters}
        setFilters={setFilters}
        isSortOpen={isSortOpen}
        setIsSortOpen={setIsSortOpen}
        schema={schema}
        sorts={sorts}
        setSorts={setSorts}
        isColumnsPanelOpen={isColumnsPanelOpen}
        setIsColumnsPanelOpen={setIsColumnsPanelOpen}
        visibleColumnCount={visibleColumnCount}
        totalColumnCount={totalColumnCount}
        hiddenColumnCount={hiddenColumnCount}
        columnSearchTerm={columnSearchTerm}
        setColumnSearchTerm={setColumnSearchTerm}
        filteredColumnOptions={filteredColumnOptions}
        hiddenColumnSet={hiddenColumnSet}
        pinnedColumnSet={pinnedColumnSet}
        primaryIdColumn={primaryIdColumn}
        getTypeIcon={getTypeIcon}
        showAllColumns={showAllColumns}
        resetColumnLayout={resetColumnLayout}
        toggleColumnVisibility={toggleColumnVisibility}
        togglePinnedColumn={togglePinnedColumn}
        realtimeEnabled={realtimeEnabled}
        isRealtimeLoading={isRealtimeLoading}
        onToggleRealtime={requestRealtimeToggle}
        onOpenPolicies={() => onViewSelect?.("policies")}
        onOpenDefinition={() => onViewSelect?.("definition")}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        fetchData={fetchData}
        loading={loading}
        onResetDataView={resetDataView}
        records={data}
      />

      {/* Bulk Actions Bar */}
      {rowIdentityEnabled && selectedCount > 0 && (
        <div className="border-b border-border bg-zinc-950 px-6 py-2.5 flex items-center justify-between animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-4">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-black">
                    <CheckSquare size={12} />
                </div>
                <div>
                    <p className="text-[10px] font-bold text-white uppercase tracking-widest italic leading-none">{selectedCount} Selected_Manifest</p>
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5">Vector: {currentTableCopy} // Active_Page</p>
                </div>
            </div>
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => setSelectedIds(new Set())}
                    className="h-8 px-3 flex items-center gap-2 bg-zinc-900 border border-border rounded-md text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                >
                    <X size={12} />
                    Cancel
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button
                    onClick={() => setIsBulkEditOpen(true)}
                    className="h-8 px-3 flex items-center gap-2 bg-zinc-900 border border-border rounded-md text-[9px] font-bold uppercase tracking-wider text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all"
                >
                    <Edit3 size={12} />
                    Bulk Edit
                </button>
                <button
                    onClick={handleExportSelected}
                    className="h-8 px-3 flex items-center gap-2 bg-zinc-900 border border-border rounded-md text-[9px] font-bold uppercase tracking-wider text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all"
                >
                    <Download size={12} />
                    Export
                </button>
                <button
                    onClick={() => setIsBulkDeleteOpen(true)}
                    className="h-8 px-3 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-md text-[9px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/20 transition-all"
                >
                    <Trash2 size={12} />
                    Delete
                </button>
            </div>
        </div>
      )}

      {/* Table Content - Dynamic Width */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-background">
        {horizontalOverflow.canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-40 w-10 bg-linear-to-r from-[#171717] via-[#171717]/90 to-transparent" />
        )}
        {horizontalOverflow.canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-40 w-10 bg-linear-to-l from-[#171717] via-[#171717]/90 to-transparent" />
        )}
        {horizontalOverflow.canScrollLeft && (
          <div className="absolute bottom-4 left-4 z-50">
            <button
              onClick={scrollGridToStart}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-2 text-[10px] font-medium] text-zinc-200 shadow-2xl backdrop-blur-sm transition-colors hover:border-zinc-500 hover:text-white"
            >
              <ChevronLeft size={14} />
              Start
            </button>
          </div>
        )}
        {horizontalOverflow.canScrollRight && (
          <div className="absolute bottom-4 right-4 z-50">
            <button
              onClick={scrollGridForward}
              className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-[10px] font-medium] text-primary shadow-2xl backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-primary/15"
            >
              More Columns
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onContextMenu={(e) => handleContextMenu(e, null, "")}
          onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(true); }}
          className="h-full overflow-auto custom-scrollbar"
          
        >
          <div style={{ minWidth: `${totalWidth}px`, minHeight: "100%" }} onContextMenu={(e) => { if (e.target === e.currentTarget) handleContextMenu(e, null, ""); }}>
            {/* Table Header */}
            <div className="sticky top-0 bg-background z-40 border-b border-border flex w-fit min-w-full">
              {rowIdentityEnabled && (
                <div className="w-10 px-4 py-3 flex items-center shrink-0 bg-background border-r border-border/60">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="rounded border-border bg-transparent accent-primary"
                  />
                </div>
              )}

              {/* Dynamic columns */}
              {visibleColumns.map((col: any) => {
                const width = getColumnWidth(col.name, col.type);
                const isResizingColumn = resizingColumn === col.name;
                const isPinnedColumn = pinnedOffsets[col.name] !== undefined;
                const activeSort = sorts.find(
                  (sort: any) => sort.column === col.name && sort.direction,
                );
                const isProtectedColumn = PROTECTED_SYSTEM_COLUMNS.has(
                  col.name,
                );

                return (
                  <div
                    key={col.name}
                    data-testid={`table-header-${col.name}`}
                    data-column-name={col.name}
                    data-column-menu-root
                    className={`relative flex items-center shrink-0 ${isPinnedColumn ? "sticky z-40 bg-background border-r border-border/60 shadow-[10px_0_16px_-14px_rgba(0,0,0,0.85)]" : ""}`}
                    style={{
                      width: `${width}px`,
                      ...(isPinnedColumn
                        ? { left: `${pinnedOffsets[col.name]}px` }
                        : {}),
                    }}
                  >
                    <div className="flex-1 px-3 py-2.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-100 overflow-hidden font-sans">
                      <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden px-1">
                        {getTypeIcon(col.type)}
                        <span className="truncate">{col.name}</span>
                        {activeSort?.direction === "asc" ? (
                          <ArrowUp
                            size={12}
                            className="shrink-0 text-primary"
                          />
                        ) : null}
                        {activeSort?.direction === "desc" ? (
                          <ArrowDown
                            size={12}
                            className="shrink-0 text-primary"
                          />
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveHeaderMenu((current) =>
                            current === col.name ? null : col.name,
                          )
                        }
                        className={`relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          activeHeaderMenu === col.name || activeSort
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
                        }`}
                        aria-label={`Open column actions for ${col.name}`}
                      >
                        <ChevronDown
                          size={13}
                          className={`transition-transform ${activeHeaderMenu === col.name ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>

                    {activeHeaderMenu === col.name ? (
                      <div className="absolute left-3 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-md border border-[#2c2c2c] bg-background shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
                        <div className="p-1.5 text-xs">
                          <button
                            type="button"
                            onClick={() => applyHeaderSort(col.name, "asc")}
                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                          >
                            <ArrowUp size={14} className="text-zinc-400" />
                            Sort ascending
                          </button>
                          <button
                            type="button"
                            onClick={() => applyHeaderSort(col.name, "desc")}
                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                          >
                            <ArrowDown size={14} className="text-zinc-400" />
                            Sort descending
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingColumn({
                                ...col,
                                isPrimary:
                                  Boolean(currentTableMeta?.has_primary_id) &&
                                  currentTableMeta?.primary_key_column === col.name,
                                isSystem: isProtectedColumn,
                              });
                              setActiveHeaderMenu(null);
                            }}
                            disabled={isProtectedColumn}
                            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                              isProtectedColumn
                                ? "cursor-not-allowed text-zinc-700"
                                : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                            }`}
                          >
                            <Settings2 size={14} className="text-zinc-400" />
                            Edit column
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              togglePinnedColumn(col.name);
                              setActiveHeaderMenu(null);
                            }}
                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                          >
                            {isPinnedColumn ? (
                              <PinOff size={14} className="text-zinc-500" />
                            ) : (
                              <Pin size={14} className="text-zinc-500" />
                            )}
                            {isPinnedColumn
                              ? "Unfreeze column"
                              : "Freeze column"}
                          </button>
                          <div className="my-1 h-px bg-[#2b2b2b]" />
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteColumn(col);
                              setActiveHeaderMenu(null);
                            }}
                            disabled={isProtectedColumn}
                            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                              isProtectedColumn
                                ? "cursor-not-allowed text-zinc-700"
                                : "text-red-300 hover:bg-red-500/10 hover:text-red-200"
                            }`}
                          >
                            <Trash2
                              size={14}
                              className={
                                isProtectedColumn
                                  ? "text-zinc-700"
                                  : "text-red-400"
                              }
                            />
                            Delete column
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Resize Handle */}
                    <div
                      data-testid={`table-resize-${col.name}`}
                      onMouseDown={(e: any) => handleResizeStart(e, col.name)}
                      className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group/resize flex items-center justify-center
                                            ${isResizingColumn ? "bg-primary" : "hover:bg-primary/50"} transition-colors`}
                    >
                      <div
                        className={`w-[2px] h-4 rounded-full transition-colors
                                            ${isResizingColumn ? "bg-primary" : "bg-zinc-700 group-hover/resize:bg-primary"}`}
                      />
                    </div>
                  </div>
                );
              })}

              {rowIdentityEnabled && (
                <div className="w-20 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 shrink-0 bg-background border-l border-border/60 shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.85)]">
                  Actions
                </div>
              )}
            </div>

            {/* Table Body */}
            <div
              className="divide-y divide-border/50 font-mono"
              
            >
              {loading && data.length === 0 ? (
                <div className="space-y-0">
                  <div className="border-b border-border/60 bg-background px-4 py-3 text-[10px] font-medium] text-zinc-500">
                    loading rows {pageStartRecord}-
                    {Math.max(pageStartRecord, pageEndRecord)}
                  </div>
                  {[...Array(10)].map((_: any, i: any) => (
                    <SkeletonRow
                      key={i}
                      columns={visibleColumns}
                      getColumnWidth={getColumnWidth}
                      rowHeight={rowHeight}
                      showSelection={rowIdentityEnabled}
                      showActions={rowIdentityEnabled}
                    />
                  ))}
                </div>
              ) : error ? (
                <div className="py-32 text-center">
                  <div className="max-w-xs mx-auto space-y-4">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
                      <Code2 size={24} />
                    </div>
                    <p className="text-red-500/70 uppercase tracking-widest font-bold text-[10px]">
                      API Error: {error}
                    </p>
                  </div>
                </div>
              ) : data.length === 0 ? (
                <div
                  className="flex h-[calc(100vh-250px)] min-h-[400px] flex-col items-center justify-center space-y-4 font-sans"
                  onContextMenu={(e) => handleContextMenu(e, null, "")}
                >
                  <h4 className="text-sm font-semibold text-zinc-100">
                    {hasQueryModifiers ? "No matching results found" : "This table is empty"}
                  </h4>
                  {!hasQueryModifiers && (                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="group flex h-11 items-center gap-3 rounded-md border border-[#1a1a1a] bg-background px-6 py-2 text-xs font-bold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white"
                    aria-label="Add Row"
                    data-testid="add-row-empty-button"
                  >
                    <Plus
                      size={14}
                      className="text-zinc-600 group-hover:text-primary transition-colors"
                    />
                    Add row
                  </button>)}
                  {hasQueryModifiers ? (
                    <button
                      onClick={resetDataView}
                      className="rounded-md border border-border bg-[#161616] px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                      Reset View
                    </button>
                  ) : rowIdentityEnabled ? (
                    <div className="flex flex-col items-center gap-4 mt-2">
                      <label className="cursor-pointer rounded-full border border-border bg-sidebar px-6 py-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-[#222]">
                        Import data from CSV
                        <input
                          ref={csvInputRef}
                          type="file"
                          accept=".csv"
                          onChange={handleCSVImport}
                          className="hidden"
                        />
                      </label>
                      <p className="text-xs text-zinc-500">
                        or drag and drop a CSV file here.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {/* Virtual Top Padding */}
                  {topPadding > 0 && (
                    <div style={{ height: `${topPadding}px` }} />
                  )}

                  {visibleData.map((row: any, visibleIndex: any) => {
                    const rowIdentityValue = getRowIdentityValue(row);
                    const rowIdentityString = getRowIdentityString(row);
                    const canAddressRow =
                      rowIdentityEnabled && rowIdentityString !== "";
                    const isEditing =
                      canAddressRow &&
                      String(editingCell?.rowId ?? "") === rowIdentityString;
                    const rowKey = canAddressRow
                      ? rowIdentityString
                      : `row-${startIndex + visibleIndex}`;

                    return (
                      <div
                        key={rowKey}
                        className="flex transition-colors group border-b border-border/30 hover:bg-[#1b1b1b]"
                        style={{ height: `${rowHeight}px` }}
                        onContextMenu={(e) => handleContextMenu(e, row, "")}
                      >
                        {rowIdentityEnabled && (
                          <div className="w-10 px-4 flex items-center shrink-0 bg-background border-r border-border/40 group-hover:bg-[#1b1b1b]">
                            <input
                              type="checkbox"
                              checked={
                                canAddressRow &&
                                selectedIds.has(rowIdentityString)
                              }
                              onChange={() => {
                                if (canAddressRow) {
                                  toggleSelectRow(rowIdentityValue);
                                }
                              }}
                              disabled={!canAddressRow}
                              className="rounded border-border bg-transparent accent-primary"
                            />
                          </div>
                        )}

                        {/* Data cells */}
                        {visibleColumns.map((col: any) => {
                          const val = row[col.name];
                          const width = getColumnWidth(col.name, col.type);
                          const isCellEditing =
                            isEditing && editingCell?.colName === col.name;
                          const isEditable =
                            canAddressRow &&
                            rowIdentityValue !== undefined &&
                            rowIdentityValue !== null &&
                            col.name !== primaryIdColumn &&
                            !PROTECTED_SYSTEM_COLUMNS.has(col.name);
                          const isPinnedColumn =
                            pinnedOffsets[col.name] !== undefined;

                          return (
                            <div
                              key={col.name}
                              onClick={() =>
                                isEditable &&
                                handleCellClick(rowIdentityValue, col.name)
                              }
                              onContextMenu={(e) =>
                                handleContextMenu(e, row, col.name)
                              }
                              className={`px-4 flex items-center text-xs shrink-0 overflow-hidden
                                                            ${isEditable ? "cursor-cell hover:bg-zinc-800/30" : "cursor-default"}
                                                            ${isCellEditing ? "bg-zinc-800/50 ring-1 ring-primary/30" : ""}
                                                            ${isPinnedColumn ? "sticky z-10 bg-background border-r border-border/40 group-hover:bg-[#1b1b1b] shadow-[10px_0_16px_-14px_rgba(0,0,0,0.75)]" : ""}`}
                              style={{
                                width: `${width}px`,
                                ...(isPinnedColumn
                                  ? { left: `${pinnedOffsets[col.name]}px` }
                                  : {}),
                              }}
                            >
                              <InlineCellEditor
                                value={val}
                                columnName={col.name}
                                columnType={col.type}
                                rowId={rowIdentityValue}
                                primaryKeyColumn={primaryIdColumn}
                                tableName={tableName || ""}
                                isEditing={isCellEditing}
                                onSave={(newVal: any) =>
                                  handleCellSave(
                                    rowIdentityValue,
                                    col.name,
                                    newVal,
                                  )
                                }
                                onCancel={handleCellCancel}
                              />
                            </div>
                          );
                        })}

                        {rowIdentityEnabled && (
                          <div className="w-20 px-4 flex items-center justify-end gap-2 shrink-0 bg-background border-l border-border/40 group-hover:bg-[#1b1b1b] shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.75)]">
                            <div className="flex items-center gap-1 transition-opacity">
                              <button
                                onClick={() => handleEditRow(row)}
                                className="p-1.5 hover:text-primary transition-colors hover:bg-zinc-800 rounded"
                                title="Edit in modal"
                              >
                                <GripVertical size={12} />
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteRow(rowIdentityValue)
                                }
                                className="p-1.5 hover:text-red-500 transition-colors hover:bg-zinc-800 rounded"
                                title="Delete row"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Virtual Bottom Padding */}
                  {bottomPadding > 0 && (
                    <div style={{ height: `${bottomPadding}px` }} />
                  )}
                  {/* Bottom Add Row Area */}
                                    {/* Ghost Header for Row Addition */}
                  <div 
                    className="flex group/add-row border-t border-border/10 hover:bg-zinc-900/30 cursor-pointer transition-colors h-10 items-center px-4 gap-3 text-zinc-500 hover:text-zinc-300"
                    onClick={() => setIsModalOpen(true)}
                  >
                    <Plus size={14} className="text-zinc-600 group-hover/add-row:text-primary transition-colors" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Add new row...</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <TableEditorFooter
        isDenseViewport={isDenseViewport}
        totalRecords={totalRecords}
        hasMoreRecords={hasMoreRecords}
        isTotalExact={isTotalExact}
        visibleColumnCount={visibleColumnCount}
        totalColumnCount={totalColumnCount}
        pageStartRecord={pageStartRecord}
        pageEndRecord={pageEndRecord}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        setPageSize={(nextPageSize) => {
          setPageSize(nextPageSize);
          setCurrentPage(1);
        }}
        currentPage={currentPage}
        totalPages={totalPages}
        goToPage={goToPage}
        pageJumpInput={pageJumpInput}
        setPageJumpInput={setPageJumpInput}
        onOpenDefinition={() => {
          void openTableDefinition();
        }}
        tableName={tableName}
        realtimeEnabled={realtimeEnabled}
        onExportCSV={handleExportCSV}
      />

      {liveToast ? (
        <BrandedToast
          key={liveToast.key}
          tone="info"
          title="Realtime"
          message={liveToast.message}
          position="bottom-right"
          durationMs={2600}
          onClose={() => setLiveToast(null)}
        />
      ) : null}

      <AddRowModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingRow(null);
        }}
        schema={schema}
        tableName={tableName || ""}
        initialData={editingRow}
        onRecordAdded={fetchData}
        rowIdColumn={primaryIdColumn}
      />

      <AddColumnModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        tableName={tableName || ""}
        onColumnAdded={fetchData}
      />

      <EditColumnModal
        isOpen={!!editingColumn}
        onClose={() => setEditingColumn(null)}
        tableName={tableName || ""}
        column={editingColumn}
        onColumnUpdated={fetchData}
      />

      <BulkEditModal
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
        schema={schema}
        onSubmit={handleBulkUpdate}
      />

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={confirmRowDeletion}
        title={
          currentTableLabel
            ? `Delete From ${currentTableLabel}`
            : "Delete Record"
        }
        message={deleteRecordMessage}
        confirmText="Delete Record"
      />

      <ConfirmModal
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedCount} Record${selectedCount === 1 ? "" : "s"}`}
        message={deleteSelectedMessage}
        confirmText="Delete Records"
      />





      <ConfirmModal
        isOpen={!!confirmDeleteColumn}
        onClose={() => setConfirmDeleteColumn(null)}
        onConfirm={confirmColumnDeletionAction}
        title={
          confirmDeleteColumn
            ? `Delete ${confirmDeleteColumn.name}`
            : "Delete Column"
        }
        message={
          confirmDeleteColumn
            ? `Remove ${confirmDeleteColumn.name} from ${currentTableCopy}? Existing data in this column will be lost permanently.`
            : ""
        }
        confirmText="Delete Column"
        type="danger"
      />

      <ConfirmModal
        isOpen={!!alertMessage}
        onClose={() => setAlertMessage(null)}
        onConfirm={() => setAlertMessage(null)}
        title={alertMessage?.title}
        message={alertMessage?.message}
        confirmText="Dismiss"
        type={alertMessage?.type || "success"}
      />

      {contextMenu && (
        <div
          className="fixed z-100 min-w-[200px] overflow-hidden rounded-md border border-zinc-800 bg-background p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
            <button
                onClick={() => {
                setIsModalOpen(true);
                handleCloseContextMenu();
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
                <Plus size={13} className="text-zinc-400" />
                <span>Add row</span>
            </button>

          {contextMenu.row && (
            <>
              <div className="my-1 h-px bg-zinc-800/50" />
              {contextMenu.colName && (
                  <button
                    onClick={() => {
                        const val = contextMenu.row[contextMenu.colName];
                        navigator.clipboard.writeText(String(val ?? ""));
                        handleCloseContextMenu();
                        showLiveToast("Copied cell value");
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                    <Copy size={13} className="text-zinc-400" />
                    <span>Copy cell</span>
                    </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    JSON.stringify(contextMenu.row, null, 2),
                  );
                  handleCloseContextMenu();
                  showLiveToast("Copied row as JSON");
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                <Copy size={13} className="text-zinc-400" />
                <span>Copy row</span>
              </button>
              <div className="my-1 h-px bg-zinc-800/50" />
              {rowIdentityEnabled ? (
                <>
                  <button
                    onClick={() => {
                      handleEditRow(contextMenu.row);
                      handleCloseContextMenu();
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                  >
                    <Edit3 size={13} className="text-zinc-500" />
                    <span>Edit row</span>
                  </button>
                  <button
                    onClick={() => {
                      const id = getRowIdentityValue(contextMenu.row);
                      handleDeleteRow(id);
                      handleCloseContextMenu();
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                  >
                    <Trash2 size={13} className="text-red-500/60" />
                    <span>Delete row</span>
                  </button>
                </>
              ) : (
                <p className="px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
                  Row actions require a writable row identity.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <CSVImportModal
        key={`${csvImport?.fileName || "csv"}-${csvImport?.delimiter || "auto"}-${csvImport?.headerRowIndex || 1}-${csvImport?.useHeaderRow ? "h1" : "h0"}`}
        isOpen={isCsvImportOpen}
        onClose={() => {
          setIsCsvImportOpen(false);
          setCsvImport(null);
        }}
        fileName={csvImport?.fileName}
        headers={csvImport?.headers || []}
        sampleRows={(csvImport?.rows || []).slice(0, 10)}
        totalRows={csvImport?.totalRows || 0}
        columnOptions={csvImport?.columns || []}
        initialMapping={csvImport?.initialMapping || {}}
        delimiter={csvImport?.delimiter}
        detectedDelimiter={csvImport?.detectedDelimiter}
        useHeaderRow={csvImport?.useHeaderRow}
        headerRowIndex={csvImport?.headerRowIndex}
        onDelimiterChange={(value: any) =>
          updateCsvImport(
            value,
            csvImport?.useHeaderRow ?? true,
            csvImport?.headerRowIndex ?? 1,
          )
        }
        onHeaderToggle={(value: any) =>
          updateCsvImport(
            csvImport?.delimiter || "auto",
            value,
            csvImport?.headerRowIndex ?? 1,
          )
        }
        onHeaderRowChange={(value: any) =>
          updateCsvImport(
            csvImport?.delimiter || "auto",
            csvImport?.useHeaderRow ?? true,
            value,
          )
        }
        onConfirm={handleCSVImportConfirm}
      />
    </div>
  );
};

export default TableEditor;


