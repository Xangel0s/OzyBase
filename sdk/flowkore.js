/**
 * FlowKore JS SDK
 * A lightweight client for interacting with FlowKore BAAS
 */
export class FlowKore {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = localStorage.getItem('flowkore_auth_token') || null;
        this.user = JSON.parse(localStorage.getItem('flowkore_auth_user')) || null;
    }

    /**
     * Authentication helpers
     */
    get auth() {
        return {
            signup: async (email, password) => {
                const res = await this._request('/api/auth/signup', 'POST', { email, password }, false);
                return res;
            },
            login: async (email, password) => {
                const res = await this._request('/api/auth/login', 'POST', { email, password }, false);
                if (res.token) {
                    this.token = res.token;
                    this.user = res.user;
                    localStorage.setItem('flowkore_auth_token', res.token);
                    localStorage.setItem('flowkore_auth_user', JSON.stringify(res.user));
                }
                return res;
            },
            logout: () => {
                this.token = null;
                this.user = null;
                localStorage.removeItem('flowkore_auth_token');
                localStorage.removeItem('flowkore_auth_user');
            },
            isValid: () => !!this.token
        };
    }

    /**
     * Collection and Records management
     */
    collection(name) {
        return {
            getList: () => this._request(`/api/collections/${name}/records`),
            getOne: (id) => this._request(`/api/collections/${name}/records/${id}`),
            create: (data) => this._request(`/api/collections/${name}/records`, 'POST', data),
            
            /**
             * Subscribe to realtime events using SSE
             */
            subscribe: (callback) => {
                const eventSource = new EventSource(`${this.baseUrl}/api/realtime`);
                
                eventSource.onmessage = (e) => {
                    const event = JSON.parse(e.data);
                    // Filter events for this collection if needed
                    // Currently backend sends all events to all subscribers
                    callback(event);
                };

                eventSource.onerror = (err) => {
                    console.error("SSE connection error:", err);
                    eventSource.close();
                };

                return () => eventSource.close(); // Unsubscribe function
            }
        };
    }

    /**
     * File management
     */
    get files() {
        return {
            upload: async (file) => {
                const formData = new FormData();
                formData.append('file', file);

                const headers = {};
                if (this.token) {
                    headers['Authorization'] = `Bearer ${this.token}`;
                }

                const response = await fetch(`${this.baseUrl}/api/files`, {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Upload failed');
                }

                return await response.json();
            },
            getUrl: (filename) => `${this.baseUrl}/api/files/${filename}`
        };
    }

    /**
     * Internal request helper
     */
    async _request(path, method = 'GET', body = null, auth = true) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            'Content-Type': 'application/json'
        };

        if (auth && this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const options = {
            method,
            headers
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    }
}
