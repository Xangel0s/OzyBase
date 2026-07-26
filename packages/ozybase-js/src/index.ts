import { OzyBaseClient, OzyBaseConfig } from './client.js';

export { OzyBaseClient, OzyQueryBuilder, OzyAuthNamespace, OzyStorageBucket } from './client.js';
export type { OzyBaseConfig, UserSession } from './client.js';

export function createClient(baseUrl: string, apiKey?: string) {
  return new OzyBaseClient({ baseUrl, apiKey });
}
