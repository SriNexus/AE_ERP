/**
 * searchIndex.ts — Search adapter layer
 *
 * Phase 0F.1: Delegates all search execution to WorkspaceSearchEngine.
 * No duplicate search logic — WorkspaceSearchEngine is the single source of truth.
 *
 * This file exists to:
 * 1. Provide the runGlobalSearch adapter that converts WorkspaceSearchGroup[]
 *    to the Partial<Record<SearchCategory, SearchResult[]>> format expected by useGlobalSearch
 * 2. Provide recent search utilities (localStorage)
 *
 * Migration note: New consumers should use WorkspaceSearchEngine directly
 * or the useWorkspaceSearch React Query wrapper.
 */

import { workspaceSearchEngine } from '../../../engines/WorkspaceSearchEngine';
import {
  type SearchResult,
  type SearchCategory,
} from '../types';

// ─── Aggregate search — delegates to WorkspaceSearchEngine ──

/**
 * Run a global search across all categories.
 * Adapts WorkspaceSearchEngine's grouped results into the
 * Partial<Record<SearchCategory, SearchResult[]>> format
 * expected by useGlobalSearch.
 */
export async function runGlobalSearch(
  q: string,
  companyId: string,
): Promise<Partial<Record<SearchCategory, SearchResult[]>>> {
  if (!companyId || !q || q.trim().length < 2) return {};

  const groups = await workspaceSearchEngine.search(q, companyId);

  const result: Partial<Record<SearchCategory, SearchResult[]>> = {};
  for (const group of groups) {
    const cat = group.category as SearchCategory;
    result[cat] = group.results as SearchResult[];
  }
  return result;
}

// ─── Individual category search — delegates to WorkspaceSearchEngine ──

export async function searchTasks(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'tasks');
  return groups as SearchResult[];
}

export async function searchLeads(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'leads');
  return groups as SearchResult[];
}

export async function searchCustomers(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'customers');
  return groups as SearchResult[];
}

export async function searchOrders(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'orders');
  return groups as SearchResult[];
}

export async function searchQuotations(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'quotations');
  return groups as SearchResult[];
}

export async function searchInvoices(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'invoices');
  return groups as SearchResult[];
}

export async function searchProducts(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'products');
  return groups as SearchResult[];
}

export async function searchCategories(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'categories');
  return groups as SearchResult[];
}

export async function searchWarehouses(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'warehouses');
  return groups as SearchResult[];
}

export async function searchStock(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'stock');
  return groups as SearchResult[];
}

export async function searchDispatch(q: string, companyId: string): Promise<SearchResult[]> {
  const groups = await workspaceSearchEngine.searchScope(q, companyId, 'dispatch');
  return groups as SearchResult[];
}

// ─── Recent searches (localStorage) — keep local ──────────

const RECENT_KEY = 'csgpl-recent-searches';
const MAX_RECENT = 8;

export function loadRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch { return []; }
}

export function saveRecentSearch(q: string): void {
  try {
    const prev = loadRecentSearches().filter((r) => r !== q);
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

export function clearRecentSearches(): void {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}
