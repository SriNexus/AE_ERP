/**
 * contextResolver.ts — Pure utility functions for module context
 *
 * Manages sessionStorage keys for the current module and entity.
 * Used by ContextResolver React context to persist state across
 * tab switches and page refreshes within the same browser session.
 *
 * Keys:
 *   csgpl-current-module  — The active App workspace module (e.g. 'leads', 'customers')
 *   csgpl-current-entity  — The active entity ID within that module (e.g. 'LD-240701-A7F3')
 *   csgpl-current-tab     — The last active bottom-nav tab ('home', 'app', 'create', 'recent')
 */

const MODULE_KEY = 'csgpl-current-module';
const ENTITY_KEY = 'csgpl-current-entity';

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private browsing or quota exceeded — silently ignore
  }
}

function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // silently ignore
  }
}

/** Read the current module from sessionStorage (or null). */
export function getCurrentModule(): string | null {
  return safeGet(MODULE_KEY);
}

/** Persist the current module to sessionStorage. */
export function setCurrentModule(module: string): void {
  safeSet(MODULE_KEY, module);
}

/** Clear the current module from sessionStorage. */
export function clearCurrentModule(): void {
  safeRemove(MODULE_KEY);
}

/** Read the current entity ID from sessionStorage (or null). */
export function getCurrentEntityId(): string | null {
  return safeGet(ENTITY_KEY);
}

/** Persist the current entity ID to sessionStorage. */
export function setCurrentEntityId(entityId: string): void {
  safeSet(ENTITY_KEY, entityId);
}

/** Clear the current entity ID from sessionStorage. */
export function clearCurrentEntityId(): void {
  safeRemove(ENTITY_KEY);
}

/** Clear all resolver sessionStorage keys. */
export function clearAll(): void {
  safeRemove(MODULE_KEY);
  safeRemove(ENTITY_KEY);
}
