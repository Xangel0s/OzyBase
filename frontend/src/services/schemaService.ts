import { fetchWithAuth } from '../utils/api';

export interface ColumnDraft {
    id: string;
    name: string;
    type: string;
    defaultValue: string;
    isPrimary: boolean;
    isSystem: boolean;
    unique: boolean;
    required: boolean;
    references: string;
    sourceName?: string;
}

export interface TableMutationPayload {
    name: string;
    description?: string;
    columns: ColumnDraft[];
    rls_enabled: boolean;
    rls_rule?: string;
    realtime_enabled: boolean;
}

export const createTable = async (payload: TableMutationPayload): Promise<void> => {
    // Transform frontend payload to backend CreateCollectionRequest
    const backendPayload = {
        name: payload.name,
        display_name: payload.name, // Use name as default display name
        schema: payload.columns.map(col => ({
            name: col.name,
            type: col.type,
            required: col.required,
            unique: col.unique,
            is_primary: col.isPrimary,
            default: col.defaultValue || undefined,
            references: col.references || undefined
        })),
        list_rule: 'public', // Default rules
        create_rule: 'admin',
        rls_enabled: payload.rls_enabled,
        rls_rule: payload.rls_rule,
        realtime_enabled: payload.realtime_enabled
    };

    const res = await fetchWithAuth('/api/collections', {
        method: 'POST',
        body: JSON.stringify(backendPayload),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create table');
    }
};

export const updateTable = async (tableName: string, payload: Partial<TableMutationPayload>): Promise<void> => {
    const res = await fetchWithAuth(`/api/tables/${tableName}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update table');
    }
};

export const fetchTableSchema = async (tableName: string): Promise<any[]> => {
    const res = await fetchWithAuth(`/api/schema/${tableName}`);
    if (!res.ok) {
        throw new Error('Failed to load table schema');
    }
    return res.json();
};

export const fetchTableDefinition = async (tableName: string): Promise<{ editor_sql?: string; definition_sql?: string }> => {
    const res = await fetchWithAuth(`/api/schema/${encodeURIComponent(tableName)}/definition`);
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load table definition');
    }
    return res.json();
};
