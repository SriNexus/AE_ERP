/**
 * INVENTORY-05a — deterministic movement identity + idempotency (Plan §10).
 *
 * The `stock_ledger` document id IS the idempotency record: the engine, inside
 * its `runTransaction`, does `transaction.get(ledgerRef)` — if the row exists
 * the movement is already applied and the transaction re-applies nothing.
 */
import type { MovementType } from './types';

/**
 * `{movementType}:{sourceType}:{sourceId}[:{lineKey}]` — the canonical key
 * (Plan §10). Empty / nullish `lineKey` is omitted (a single-line movement).
 */
export function buildIdempotencyKey(
  movementType: MovementType,
  sourceType: string,
  sourceId: string,
  lineKey?: string | number | null,
): string {
  const base = `${movementType}:${sourceType}:${sourceId}`;
  if (lineKey === undefined || lineKey === null || String(lineKey) === '') return base;
  return `${base}:${lineKey}`;
}

/**
 * Deterministic, **injective** `stock_ledger` doc id for a movement.
 * `encodeURIComponent` is reversible, so two different idempotency keys can
 * never map to the same id — INV-8 ("no two ledger rows share an
 * idempotencyKey") holds by construction, not by hope. The `STKMV-` prefix
 * keeps the id clear of Firestore's reserved forms (`.`, `..`, `__*__`).
 */
export function movementLedgerId(idempotencyKey: string): string {
  return `STKMV-${encodeURIComponent(idempotencyKey)}`;
}
