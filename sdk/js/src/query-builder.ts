/**
 * OzyBase Query Builder
 * Fluent API for database operations (Supabase-style)
 * 
 * Usage:
 *   const { data, error } = await client
 *     .from('products')
 *     .select('*')
 *     .eq('active', true)
 *     .order('created_at', { ascending: false })
 *     .limit(10);
 */

import type {
    OzyBaseResponse,
    FilterOperator,
    FilterCondition,
    Row,
    InsertPayload,
    UpdatePayload,
} from './types';
import type { OzyBaseClient } from './client';

export class OzyBaseQueryBuilder<T extends Record<string, unknown> = Record<string, unknown>> {
    private _table: string;
    private _client: OzyBaseClient;
    private _columns: string = '*';
    private _filters: FilterCondition[] = [];
    private _order: { column: string; ascending: boolean }[] = [];
    private _limit?: number;
    private _offset?: number;
    private _single: boolean = false;
    private _count: 'exact' | 'planned' | 'estimated' | null = null;
    private _method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET';
    private _body?: unknown;

    constructor(client: OzyBaseClient, table: string) {
        this._client = client;
        this._table = table;
    }

    // ============================================================================
    // SELECT Operations
    // ============================================================================

    /**
     * Select columns to return
     * @param columns - Comma-separated column names or '*' for all
     */
    select(columns: string = '*'): this {
        this._columns = columns;
        this._method = 'GET';
        return this;
    }

    // ============================================================================
    // INSERT Operations
    // ============================================================================

    /**
     * Insert a new row or rows
     * @param data - Single object or array of objects to insert
     */
    insert(data: InsertPayload<T> | InsertPayload<T>[]): this {
        this._method = 'POST';
        this._body = data;
        return this;
    }

    // ============================================================================
    // UPDATE Operations
    // ============================================================================

    /**
     * Update existing rows (must be combined with filters)
     * @param data - Object with fields to update
     */
    update(data: UpdatePayload<T>): this {
        this._method = 'PATCH';
        this._body = data;
        return this;
    }

    // ============================================================================
    // DELETE Operations
    // ============================================================================

    /**
     * Delete rows (must be combined with filters)
     */
    delete(): this {
        this._method = 'DELETE';
        return this;
    }

    // ============================================================================
    // UPSERT Operations
    // ============================================================================

    /**
     * Insert or update based on conflict
     * @param data - Data to upsert
     * @param options - Upsert options
     */
    upsert(
        data: InsertPayload<T> | InsertPayload<T>[],
        options?: { onConflict?: string }
    ): this {
        this._method = 'POST';
        this._body = {
            _upsert: true,
            _onConflict: options?.onConflict,
            data,
        };
        return this;
    }

    // ============================================================================
    // Filter Operations (Chainable)
    // ============================================================================

    /**
     * Filter where column equals value
     */
    eq(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'eq', value });
        return this;
    }

    /**
     * Filter where column does not equal value
     */
    neq(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'neq', value });
        return this;
    }

    /**
     * Filter where column is greater than value
     */
    gt(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'gt', value });
        return this;
    }

    /**
     * Filter where column is greater than or equal to value
     */
    gte(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'gte', value });
        return this;
    }

    /**
     * Filter where column is less than value
     */
    lt(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'lt', value });
        return this;
    }

    /**
     * Filter where column is less than or equal to value
     */
    lte(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'lte', value });
        return this;
    }

    /**
     * Filter where column matches pattern (case-sensitive)
     */
    like(column: string, pattern: string): this {
        this._filters.push({ column, operator: 'like', value: pattern });
        return this;
    }

    /**
     * Filter where column matches pattern (case-insensitive)
     */
    ilike(column: string, pattern: string): this {
        this._filters.push({ column, operator: 'ilike', value: pattern });
        return this;
    }

    /**
     * Filter where column is in array of values
     */
    in(column: string, values: unknown[]): this {
        this._filters.push({ column, operator: 'in', value: values });
        return this;
    }

    /**
     * Filter where column is null or not null
     */
    is(column: string, value: null | boolean): this {
        this._filters.push({ column, operator: 'is', value });
        return this;
    }

    /**
     * Filter where array column contains value
     */
    contains(column: string, value: unknown): this {
        this._filters.push({ column, operator: 'contains', value });
        return this;
    }

    /**
     * Filter where array column is contained by value
     */
    containedBy(column: string, value: unknown[]): this {
        this._filters.push({ column, operator: 'containedBy', value });
        return this;
    }

    /**
     * Filter with custom condition
     */
    filter(column: string, operator: FilterOperator, value: unknown): this {
        this._filters.push({ column, operator, value });
        return this;
    }

    /**
     * Apply OR logic (for next filter group)
     */
    or(filters: string): this {
        // Parse filters string like Supabase: "id.eq.1,name.eq.test"
        this._filters.push({ column: '_or', operator: 'eq', value: filters });
        return this;
    }

    // ============================================================================
    // Ordering & Pagination
    // ============================================================================

    /**
     * Order results by column
     * @param column - Column to order by
     * @param options - Order options
     */
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
        this._order.push({
            column,
            ascending: options?.ascending ?? true,
        });
        return this;
    }

    /**
     * Limit number of rows returned
     * @param count - Maximum number of rows
     */
    limit(count: number): this {
        this._limit = count;
        return this;
    }

    /**
     * Offset for pagination
     * @param start - Number of rows to skip
     */
    range(start: number, end?: number): this {
        this._offset = start;
        if (end !== undefined) {
            this._limit = end - start + 1;
        }
        return this;
    }

    // ============================================================================
    // Result Modifiers
    // ============================================================================

    /**
     * Return only a single row (error if more than one)
     */
    single(): this {
        this._single = true;
        this._limit = 1;
        return this;
    }

    /**
     * Return single row or null (no error if not found)
     */
    maybeSingle(): this {
        this._single = true;
        this._limit = 1;
        return this;
    }

    // ============================================================================
    // Execution
    // ============================================================================

    /**
     * Execute the query and return results
     */
    async then<TResult = OzyBaseResponse<T[]>>(
        resolve?: (value: OzyBaseResponse<T[]>) => TResult | PromiseLike<TResult>,
        reject?: (reason: unknown) => TResult | PromiseLike<TResult>
    ): Promise<TResult> {
        const result = await this.execute();
        return resolve ? resolve(result as OzyBaseResponse<T[]>) : result as unknown as TResult;
    }

    /**
     * Internal execute method
     */
    private async execute(): Promise<OzyBaseResponse<T | T[] | null>> {
        try {
            const url = this.buildUrl();
            const options = this.buildRequestOptions();

            const response = await this._client.request<T | T[]>(url, options);

            // Handle single row expectation
            if (this._single) {
                if (Array.isArray(response) && response.length > 0) {
                    return { data: response[0] as T, error: null };
                }
                if (Array.isArray(response) && response.length === 0) {
                    return {
                        data: null,
                        error: { message: 'No rows found', code: 'PGRST116' }
                    };
                }
            }

            return { data: response, error: null };
        } catch (err) {
            const error = err as Error;
            return {
                data: null,
                error: {
                    message: error.message,
                    code: 'UNKNOWN',
                },
            };
        }
    }

    /**
     * Build the request URL with query params
     */
    private buildUrl(): string {
        const base = `/api/collections/${this._table}/records`;
        const params = new URLSearchParams();

        // Add columns selection
        if (this._columns !== '*') {
            params.set('select', this._columns);
        }

        // Add filters
        for (const filter of this._filters) {
            if (filter.column === '_or') {
                params.set('or', String(filter.value));
            } else {
                const value = this.formatFilterValue(filter.operator, filter.value);
                params.set(filter.column, `${filter.operator}.${value}`);
            }
        }

        // Add ordering
        if (this._order.length > 0) {
            const orderStr = this._order
                .map((o) => (o.ascending ? o.column : `${o.column}.desc`))
                .join(',');
            params.set('order', orderStr);
        }

        // Add pagination
        if (this._limit !== undefined) {
            params.set('limit', String(this._limit));
        }
        if (this._offset !== undefined) {
            params.set('offset', String(this._offset));
        }

        const queryString = params.toString();
        return queryString ? `${base}?${queryString}` : base;
    }

    /**
     * Build fetch request options
     */
    private buildRequestOptions(): RequestInit {
        const options: RequestInit = {
            method: this._method,
        };

        if (this._body !== undefined) {
            options.body = JSON.stringify(this._body);
        }

        return options;
    }

    /**
     * Format filter value for URL
     */
    private formatFilterValue(operator: FilterOperator, value: unknown): string {
        if (operator === 'in' && Array.isArray(value)) {
            return `(${value.join(',')})`;
        }
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'boolean') {
            return String(value);
        }
        return String(value);
    }
}

/**
 * Create a new query builder for a table
 */
export function createQueryBuilder<T extends Record<string, unknown> = Record<string, unknown>>(
    client: OzyBaseClient,
    table: string
): OzyBaseQueryBuilder<T> {
    return new OzyBaseQueryBuilder<T>(client, table);
}

