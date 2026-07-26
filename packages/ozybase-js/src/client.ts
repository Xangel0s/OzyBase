export interface OzyBaseConfig {
  baseUrl: string;
  apiKey?: string;
  autoAuthHeader?: boolean;
}

export interface UserSession {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    created_at?: string;
  };
}

export class OzyBaseClient {
  public baseUrl: string;
  public apiKey?: string;
  private token: string | null = null;

  constructor(config: OzyBaseConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;

    // Auto-restore session from localStorage if in browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      this.token = localStorage.getItem('ozy_auth_token');
    }
  }

  public setAuthToken(token: string | null): void {
    this.token = token;
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        localStorage.setItem('ozy_auth_token', token);
      } else {
        localStorage.removeItem('ozy_auth_token');
      }
    }
  }

  public getAuthToken(): string | null {
    return this.token;
  }

  public async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});

    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    if (this.apiKey && !headers.has('x-api-key')) {
      headers.set('x-api-key', this.apiKey);
    }

    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    return fetch(url, { ...options, headers });
  }

  // --- Table Query Builder ---
  public from<T = Record<string, any>>(tableName: string) {
    return new OzyQueryBuilder<T>(this, tableName);
  }

  // --- Auth Namespace ---
  public get auth() {
    return new OzyAuthNamespace(this);
  }

  // --- Storage Namespace ---
  public storage(bucketName: string) {
    return new OzyStorageBucket(this, bucketName);
  }
}

// --- Query Builder Helper Class ---
export class OzyQueryBuilder<T = Record<string, any>> {
  private client: OzyBaseClient;
  private tableName: string;
  private queryParams: Record<string, string> = {};

  constructor(client: OzyBaseClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  public limit(count: number): this {
    this.queryParams.limit = String(count);
    return this;
  }

  public offset(count: number): this {
    this.queryParams.offset = String(count);
    return this;
  }

  public order(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.queryParams.sort = `${direction === 'desc' ? '-' : ''}${column}`;
    return this;
  }

  public filter(column: string, operator: 'eq' | 'gt' | 'lt' | 'like', value: any): this {
    this.queryParams[`filter[${column}][${operator}]`] = String(value);
    return this;
  }

  public async select(): Promise<{ data: T[]; error: string | null }> {
    const searchParams = new URLSearchParams(this.queryParams);
    const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const res = await this.client.fetch(`/api/collections/${this.tableName}/records${queryString}`);
    
    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { data: [], error: errPayload.error || 'Failed to fetch records' };
    }

    const payload = await res.json();
    return { data: Array.isArray(payload) ? payload : payload.items || [], error: null };
  }

  public async insert(record: Partial<T>): Promise<{ data: T | null; error: string | null }> {
    const res = await this.client.fetch(`/api/collections/${this.tableName}/records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { data: null, error: errPayload.error || 'Failed to insert record' };
    }

    const data = await res.json();
    return { data, error: null };
  }

  public async update(id: string | number, record: Partial<T>): Promise<{ data: T | null; error: string | null }> {
    const res = await this.client.fetch(`/api/collections/${this.tableName}/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { data: null, error: errPayload.error || 'Failed to update record' };
    }

    const data = await res.json();
    return { data, error: null };
  }

  public async delete(id: string | number): Promise<{ success: boolean; error: string | null }> {
    const res = await this.client.fetch(`/api/collections/${this.tableName}/records/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: errPayload.error || 'Failed to delete record' };
    }

    return { success: true, error: null };
  }
}

// --- Auth Namespace Helper Class ---
export class OzyAuthNamespace {
  private client: OzyBaseClient;

  constructor(client: OzyBaseClient) {
    this.client = client;
  }

  public async login(email: string, password: string): Promise<{ session: UserSession | null; error: string | null }> {
    const res = await this.client.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { session: null, error: errPayload.error || 'Login failed' };
    }

    const session: UserSession = await res.json();
    if (session.token) {
      this.client.setAuthToken(session.token);
    }
    return { session, error: null };
  }

  public logout(): void {
    this.client.setAuthToken(null);
  }
}

// --- Storage Bucket Helper Class ---
export class OzyStorageBucket {
  private client: OzyBaseClient;
  private bucketName: string;

  constructor(client: OzyBaseClient, bucketName: string) {
    this.client = client;
    this.bucketName = bucketName;
  }

  public getPublicUrl(path: string): string {
    return `${this.client.baseUrl}/api/files/download/${this.bucketName}/${path}`;
  }

  public async upload(file: File | Blob, filename: string): Promise<{ url: string | null; error: string | null }> {
    const formData = new FormData();
    formData.append('file', file, filename);

    const res = await this.client.fetch(`/api/files/upload/${this.bucketName}`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({ error: res.statusText }));
      return { url: null, error: errPayload.error || 'Upload failed' };
    }

    const data = await res.json();
    return { url: data.url || this.getPublicUrl(filename), error: null };
  }
}
