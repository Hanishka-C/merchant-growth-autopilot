import { AsyncLocalStorage } from 'async_hooks';

export const tenantStore = new AsyncLocalStorage<string>();

export function getTenantId(): string | undefined {
  return tenantStore.getStore();
}

export function runWithTenant<T>(tenantId: string, callback: () => T): T {
  return tenantStore.run(tenantId, callback);
}
