/**
 * INVENTORY-05a — Stock Movement Engine.
 *
 * The single controlled write boundary for `stock` + `stock_ledger`
 * (Plan §4.1). Every stock-changing operation calls ONLY `applyStockMovement`
 * / `applyStockMovements`; direct `transaction.set(stockRef, …)` outside this
 * module is an anti-pattern (asserted by singleStockWriter.test.ts from 05d).
 *
 * Migrated callers: GRN (05b), dispatch OUT (05c), manual + cancel-restore
 * (05d). `stockWorkflow.stockIn` is a thin wrapper over `applyStockMovement`.
 *
 * Guarantees (Plan §5, §9, §10):
 *  - ONE `runTransaction` covering every stock summary + every ledger row +
 *    the in-transaction idempotency check — never a state where stock changed
 *    but the ledger did not, or vice-versa (INV-7).
 *  - Deterministic, injective ledger doc id — a repeated invocation is a
 *    no-op that returns the prior result (INV-8).
 *  - INV-1 (`onHandQty >= 0`) and INV-2 (`reservedQty >= 0`) enforced inside
 *    the transaction; a violation aborts it with zero partial mutation.
 *  - INV-3 / INV-4 gated behind `reservationsEnabled` (FALSE for Phases 05–06:
 *    `availableQty == onHandQty`, `reservedQty` stays 0). Phase 07 flips it.
 *  - `companyId` + `groupId` stamped manually (raw transaction bypasses
 *    auto-stamping — HR-9).
 *  - Legacy ledger fields (`type`, `referenceType`/`referenceId`, `date`,
 *    `beforeQty`/`afterQty`) dual-written so existing consumers keep working.
 *
 * INVENTORY-05a.1 — generic transaction participation. A caller that must
 * atomically read + validate + write its OWN business state (GRN → the
 * `purchase_orders` receivedQty + status; dispatch → the `dispatch` doc status)
 * passes a `MovementParticipant` to `applyStockMovements`. The participant runs
 * inside the engine's single `runTransaction` but is handed a `MovementWriter`
 * that REJECTS `stock` / `stock_ledger` — the engine stays the sole owner of
 * every stock-summary and ledger mutation.
 */
import { COLLECTIONS, firebaseEnv } from '../firebase';
import { createDocWithId, genId, getAll, getOne, resolveWriteGroupId, updateDocById } from '../firestore';
import { sanitizeFirestoreData } from '../sanitizer';
import { useAppStore } from '../../store/useAppStore';
import { resolveWorkflowCompanyId, stockSummaryId, type WorkflowRecord } from '../workflow';
import { buildIdempotencyKey, movementLedgerId } from './idempotency';
import { isReservationsEnabled } from './reservationConfig';
import {
  MOVEMENT_DIRECTION, REASON_CODE_REQUIRED,
  type BatchMovementResult, type MovementDirection, type MovementParticipant,
  type MovementPlanEntry, type MovementReadContext, type MovementResult,
  type MovementType, type MovementWriter, type StockMovementInput,
} from './types';

const EPSILON = 1e-6;

/**
 * Given the canonical `SUM-{company}-{product}-{warehouse}` id and every `stock`
 * summary doc that matches (company, product, warehouse), return the id to
 * write. A single legacy-id summary is respected; the canonical id is used when
 * none exists; two live summaries for the same tuple is a hard error.
 * (Moved here from `stockWorkflow.ts` in INVENTORY-05d to break the import cycle
 * once `stockWorkflow` started calling the engine.)
 */
export function resolveStockSummaryDocumentId(
  canonicalId: string,
  matches: Array<{ id?: string; isDeleted?: boolean }>,
): string {
  const active = matches.filter((row) => row.isDeleted !== true && String(row.id || '').trim());
  if (active.length > 1) throw new Error('Duplicate stock summaries exist for the same company, product, and warehouse');
  return active[0]?.id || canonicalId;
}

function resolveDirection(movementType: MovementType, signedQty: number): MovementDirection {
  if (movementType === 'RECONCILE_ADJUST') return signedQty >= 0 ? 'IN' : 'OUT';
  return MOVEMENT_DIRECTION[movementType as Exclude<MovementType, 'RECONCILE_ADJUST'>];
}

/** Legacy `stock_ledger.type` value dual-written for existing consumers ('IN' | 'OUT'). */
function legacyType(direction: MovementDirection): 'IN' | 'OUT' {
  return direction === 'OUT' || direction === 'RELEASE' ? 'OUT' : 'IN';
}

interface PreparedMovement {
  input: StockMovementInput;
  companyId: string;
  groupId: string;
  actorId: string;
  direction: MovementDirection;
  absQty: number;
  idempotencyKey: string;
  ledgerId: string;
  reservationsEnabled: boolean;
  clampToStock: boolean;
}

function prepare(input: StockMovementInput): PreparedMovement {
  const state = useAppStore.getState();
  const companyId = String(input.companyId || resolveWorkflowCompanyId() || '');
  if (!companyId) throw new Error('Active company is required for a stock movement');
  const groupId = resolveWriteGroupId(companyId);
  const actorId = String(input.actorId || state.user?.id || 'system');

  if (!input.movementType) throw new Error('movementType is required');
  if (!input.productId) throw new Error('productId is required for a stock movement');
  if (!input.warehouseId) throw new Error('warehouseId is required for a stock movement');
  if (!input.sourceType || !input.sourceId) throw new Error('sourceType and sourceId are required for a stock movement');
  if (!input.unit) throw new Error('unit is required for a stock movement');

  const signedQty = Number(input.qty);
  if (!Number.isFinite(signedQty)) throw new Error('Movement quantity must be a finite number');
  const direction = resolveDirection(input.movementType, signedQty);
  const absQty = Math.abs(signedQty);
  if (absQty <= EPSILON) throw new Error('Movement quantity must be greater than zero');
  if (input.movementType !== 'RECONCILE_ADJUST' && signedQty <= 0) {
    throw new Error('Movement quantity must be greater than zero');
  }
  if (REASON_CODE_REQUIRED.includes(input.movementType) && !String(input.reasonCode || '').trim()) {
    throw new Error(`${input.movementType} requires a reasonCode`);
  }

  const idempotencyKey = String(
    input.idempotencyKey
      || buildIdempotencyKey(input.movementType, input.sourceType, input.sourceId, input.lineKey),
  );

  return {
    input, companyId, groupId, actorId, direction, absQty,
    idempotencyKey, ledgerId: movementLedgerId(idempotencyKey),
    // INVENTORY-07: an explicit per-call value still wins; otherwise the global
    // `reservationsEnabled` feature flag decides (Phase 07 defaults it ON).
    reservationsEnabled: input.reservationsEnabled ?? isReservationsEnabled(),
    clampToStock: input.clampToStock === true,
  };
}

function applyDelta(direction: MovementDirection, onHandBefore: number, reservedBefore: number, absQty: number) {
  let onHandAfter = onHandBefore;
  let reservedAfter = reservedBefore;
  if (direction === 'IN') onHandAfter = onHandBefore + absQty;
  else if (direction === 'OUT') onHandAfter = onHandBefore - absQty;
  else if (direction === 'RESERVE') reservedAfter = reservedBefore + absQty;
  else if (direction === 'RELEASE') reservedAfter = reservedBefore - absQty;
  return { onHandAfter, reservedAfter };
}

/** INV-1 / INV-2 — asserted per applied entry (a transient negative is a bug). */
function assertEntryInvariants(prep: PreparedMovement, onHandAfter: number, reservedAfter: number) {
  // INV-1 — negative on-hand is prohibited for Neozy.
  if (onHandAfter < -EPSILON) {
    throw new Error(`Insufficient stock: this ${prep.direction} movement would drive onHandQty to ${onHandAfter}`);
  }
  // INV-2 — cannot release more than is reserved.
  if (reservedAfter < -EPSILON) {
    throw new Error(`Invalid release: this movement would drive reservedQty to ${reservedAfter}`);
  }
}

/** `availableQty` cache. Phases 05–06: `= onHandQty` (reserved 0). Phase 07: `= onHandQty − reservedQty`. */
function deriveAvailable(prep: PreparedMovement, onHandAfter: number, reservedAfter: number): number {
  return prep.reservationsEnabled ? onHandAfter - reservedAfter : onHandAfter;
}

function buildLedgerRow(args: {
  prep: PreparedMovement;
  input: StockMovementInput;
  transactionId: string;
  dateIso: string;
  movementAt: unknown;
  createdAt: unknown;
  stockId: string;
  /** Actually-applied absolute quantity (clamped for a partial reserve/release). */
  qty: number;
  before: { onHand: number; reserved: number };
  after: { onHand: number; reserved: number };
}) {
  const { prep, input, before, after } = args;
  const qty = Number.isFinite(args.qty) ? args.qty : prep.absQty;
  return {
    id: prep.ledgerId,
    companyId: prep.companyId,
    ...(prep.groupId ? { groupId: prep.groupId } : {}),
    productId: input.productId,
    warehouseId: input.warehouseId,
    stockId: args.stockId,
    unit: input.unit,
    movementType: input.movementType,
    direction: prep.direction,
    qty,
    onHandBefore: before.onHand,
    onHandAfter: after.onHand,
    reservedBefore: before.reserved,
    reservedAfter: after.reserved,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: prep.idempotencyKey,
    ...(input.reasonCode ? { reasonCode: String(input.reasonCode) } : {}),
    actorId: prep.actorId,
    transactionId: args.transactionId,        // firestore.rules: transactionId is string
    movementAt: args.movementAt,              // firestore.rules: movementAt != null
    createdAt: args.createdAt,
    createdBy: prep.actorId,
    isDeleted: false,
    // INVENTORY-06: audit flag on a reconciliation correction row.
    ...(input.movementType === 'RECONCILE_ADJUST' ? { auditReconciliation: true } : {}),
    // ── legacy compatibility (dual-write during migration) ──
    type: legacyType(prep.direction),
    referenceType: input.sourceType,
    referenceId: input.sourceId,
    beforeQty: before.onHand,
    afterQty: after.onHand,
    date: args.dateIso,
    notes: input.notes || '',
    // ── caller pass-through (legacy consumers: e.g. GRN referenceType override) ──
    ...(input.ledgerExtra || {}),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Internal plan + result helpers
 * ────────────────────────────────────────────────────────────────────────── */

interface PlannedEntry {
  prep: PreparedMovement;
  input: StockMovementInput;
  stockId: string;
  applied: boolean;
  /** Absolute quantity actually applied — `prep.absQty`, or the clamped grant
   *  for a partial SALES_RESERVE / SALES_RELEASE (INVENTORY-07). */
  effectiveQty: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  priorRow: WorkflowRecord | null;
}

function toPublicPlan(entries: PlannedEntry[]): MovementPlanEntry[] {
  return entries.map((e) => ({
    input: e.input,
    applied: e.applied,
    direction: e.prep.direction,
    qty: e.effectiveQty,
    stockId: e.stockId,
    ledgerId: e.prep.ledgerId,
    idempotencyKey: e.prep.idempotencyKey,
    onHandBefore: e.onHandBefore,
    onHandAfter: e.onHandAfter,
    reservedBefore: e.reservedBefore,
    reservedAfter: e.reservedAfter,
  }));
}

function resultFor(e: PlannedEntry, skipped: boolean): MovementResult {
  const onHandAfter = skipped ? e.onHandBefore : e.onHandAfter;
  const reservedAfter = skipped ? e.reservedBefore : e.reservedAfter;
  return {
    applied: e.applied && !skipped,
    ...(skipped ? { skipped: true } : {}),
    movementType: e.input.movementType,
    direction: e.prep.direction,
    stockId: e.stockId,
    ledgerId: e.prep.ledgerId,
    idempotencyKey: e.prep.idempotencyKey,
    productId: e.input.productId,
    warehouseId: e.input.warehouseId,
    companyId: e.prep.companyId,
    qty: e.effectiveQty,
    onHandBefore: e.onHandBefore,
    onHandAfter,
    reservedBefore: e.reservedBefore,
    reservedAfter,
    availableAfter: deriveAvailable(e.prep, onHandAfter, reservedAfter),
  };
}

const summaryKey = (productId: string, warehouseId: string) => `${productId} ${warehouseId}`;

function assertParticipantCollection(collection: string) {
  if (collection === COLLECTIONS.STOCK || collection === COLLECTIONS.STOCK_LEDGER) {
    throw new Error(
      `A movement participant may not write "${collection}" — the stock movement engine is the sole owner of stock / stock_ledger`,
    );
  }
}

/**
 * Compute the per-input plan (which inputs are idempotent no-ops, and the
 * onHand/reserved before/after each applied input, coalesced per stock summary).
 * Throws (INV-1/2/3) if an applied movement would violate an invariant.
 */
function planEntries(
  preps: PreparedMovement[],
  stockIdByKey: Map<string, string>,
  existingByStockId: Map<string, WorkflowRecord | null>,
  priorLedgerByLedgerId: Map<string, WorkflowRecord | null>,
): PlannedEntry[] {
  const running = new Map<string, { onHand: number; reserved: number }>();
  for (const [stockId, existing] of existingByStockId) {
    running.set(stockId, {
      onHand: Number(existing?.onHandQty ?? existing?.availableQty ?? existing?.available) || 0,
      reserved: Number(existing?.reservedQty ?? existing?.reserved) || 0,
    });
  }
  const seenLedgerInBatch = new Set<string>();
  return preps.map((prep) => {
    const stockId = stockIdByKey.get(summaryKey(prep.input.productId, prep.input.warehouseId)) as string;
    const cur = running.get(stockId) || { onHand: 0, reserved: 0 };
    if (!running.has(stockId)) running.set(stockId, cur);
    const priorRow = priorLedgerByLedgerId.get(prep.ledgerId) || null;
    const dupInBatch = seenLedgerInBatch.has(prep.ledgerId);
    seenLedgerInBatch.add(prep.ledgerId);

    if (priorRow || dupInBatch) {
      const num = (v: unknown, fallback: number) => {
        const x = Number(v);
        return Number.isFinite(x) ? x : fallback;
      };
      const onHandBefore = priorRow ? num(priorRow.onHandBefore, cur.onHand) : cur.onHand;
      const onHandAfter = priorRow ? num(priorRow.onHandAfter, cur.onHand) : cur.onHand;
      const reservedBefore = priorRow ? num(priorRow.reservedBefore, cur.reserved) : cur.reserved;
      const reservedAfter = priorRow ? num(priorRow.reservedAfter, cur.reserved) : cur.reserved;
      const effectiveQty = priorRow ? num(priorRow.qty, prep.absQty) : prep.absQty;
      return { prep, input: prep.input, stockId, applied: false, effectiveQty, onHandBefore, onHandAfter, reservedBefore, reservedAfter, priorRow };
    }

    const onHandBefore = cur.onHand;
    const reservedBefore = cur.reserved;

    // INVENTORY-07 — feature-flag gate (Plan §07 J): with reservations OFF the
    // engine skips RESERVE / RELEASE entirely — reservedQty stays inert,
    // availableQty == onHandQty, and a stray reserve/release input is a benign
    // no-op (no ledger row).
    if (!prep.reservationsEnabled && (prep.direction === 'RESERVE' || prep.direction === 'RELEASE')) {
      return {
        prep, input: prep.input, stockId, applied: false, effectiveQty: 0,
        onHandBefore, onHandAfter: onHandBefore, reservedBefore, reservedAfter: reservedBefore, priorRow: null,
      };
    }

    // INVENTORY-07 — partial reserve / release: clamp the grant to what the
    // summary can support, INSIDE the plan (the summary txn is the concurrency
    // boundary, so two racing reserves each see the other's committed effect).
    let effectiveQty = prep.absQty;
    if (prep.clampToStock && prep.direction === 'RESERVE') {
      effectiveQty = Math.max(0, Math.min(prep.absQty, onHandBefore - reservedBefore));
    } else if (prep.clampToStock && prep.direction === 'RELEASE') {
      effectiveQty = Math.max(0, Math.min(prep.absQty, reservedBefore));
    }
    if (effectiveQty <= EPSILON) {
      // Clamped to nothing — benign no-op: no ledger row, summary untouched.
      return {
        prep, input: prep.input, stockId, applied: false, effectiveQty: 0,
        onHandBefore, onHandAfter: onHandBefore, reservedBefore, reservedAfter: reservedBefore, priorRow: null,
      };
    }
    const { onHandAfter, reservedAfter } = applyDelta(prep.direction, onHandBefore, reservedBefore, effectiveQty);
    cur.onHand = onHandAfter;
    cur.reserved = reservedAfter;
    return { prep, input: prep.input, stockId, applied: true, effectiveQty, onHandBefore, onHandAfter, reservedBefore, reservedAfter, priorRow: null };
  });
}

/**
 * INV-1 / INV-2 / INV-3 — asserted AFTER `participant.validate` has had its
 * chance to benignly abort, but BEFORE any write. A violation aborts the whole
 * transaction with zero partial mutation.
 *
 * INV-1 (`onHandQty >= 0`) and INV-2 (`reservedQty >= 0`) are checked per
 * applied entry. INV-3 (`reservedQty <= onHandQty`, Phase 07) is checked on the
 * FINAL per-summary state only: a dispatch batch legitimately passes through an
 * intermediate state where DISPATCH_OUT has dropped onHand but the matching
 * SALES_RELEASE consume has not landed yet — only the end state must hold INV-3.
 */
function assertPlanInvariants(plan: PlannedEntry[]) {
  const finalByStock = new Map<string, { onHand: number; reserved: number; enforce: boolean }>();
  for (const e of plan) {
    if (!e.applied) continue;
    assertEntryInvariants(e.prep, e.onHandAfter, e.reservedAfter);
    finalByStock.set(e.stockId, {
      onHand: e.onHandAfter,
      reserved: e.reservedAfter,
      enforce: e.prep.reservationsEnabled,
    });
  }
  for (const [, s] of finalByStock) {
    if (s.enforce && s.reserved > s.onHand + EPSILON) {
      throw new Error(`Over-reservation: reservedQty ${s.reserved} would exceed onHandQty ${s.onHand}`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Apply ONE stock movement. Idempotent by the deterministic ledger doc id;
 * atomic over (stock summary + ledger row [+ any participant writes]). Returns
 * `{ applied: false }` when the movement was already recorded, or
 * `{ applied: false, skipped: true }` when a participant aborted benignly.
 */
export async function applyStockMovement(
  input: StockMovementInput,
  participant?: MovementParticipant,
): Promise<MovementResult> {
  const batch = await applyStockMovements([input], participant);
  return batch.results[0];
}

/**
 * Apply a BATCH of stock movements as ONE transaction (configured branch).
 * Every (stock summary + ledger row) in the batch, plus any `participant`
 * reads/validation/writes, commit together or not at all (INV-7). Used by GRN
 * (multi-line receipt + PO update) and dispatch (multi-line OUT + dispatch doc).
 */
export async function applyStockMovements(
  inputs: StockMovementInput[],
  participant?: MovementParticipant,
): Promise<BatchMovementResult> {
  if (!inputs.length) return { applied: false, skipped: false, results: [] };
  const preps = inputs.map((i) => prepare(i));
  const companyId = preps[0].companyId;
  for (const p of preps) {
    if (p.companyId !== companyId) throw new Error('All movements in one batch must share the same companyId');
  }
  const nowIso = new Date().toISOString();

  const batch = firebaseEnv.isConfigured
    ? await applyBatchConfigured(preps, companyId, participant, nowIso)
    : await applyBatchDemo(preps, companyId, participant, nowIso);

  // INVENTORY-10 (§10d) — best-effort, AFTER the transaction has already
  // committed; the core txn logic above is completely untouched. Awaited
  // (not fire-and-forget) so it is deterministic for callers/tests, but its
  // own internal try/catch means a notification failure can never surface as
  // an error from a movement that already committed successfully.
  if (batch.applied) {
    const { checkLowStockAndNotify } = await import('./lowStockAlerts');
    await checkLowStockAndNotify(batch.results);
  }

  return batch;
}

/* ── configured branch — one real runTransaction ── */

async function applyBatchConfigured(
  preps: PreparedMovement[],
  companyId: string,
  participant: MovementParticipant | undefined,
  nowIso: string,
): Promise<BatchMovementResult> {
  const { db } = await import('../firebase');
  const { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');

  // Resolve the authoritative stock-summary doc id for each DISTINCT (product, warehouse).
  const stockIdByKey = new Map<string, string>();
  for (const prep of preps) {
    const k = summaryKey(prep.input.productId, prep.input.warehouseId);
    if (stockIdByKey.has(k)) continue;
    const canonicalId = stockSummaryId(companyId, prep.input.productId, prep.input.warehouseId);
    const matches = await getDocs(query(
      collection(db, COLLECTIONS.STOCK),
      where('companyId', '==', companyId),
      where('productId', '==', prep.input.productId),
      where('warehouseId', '==', prep.input.warehouseId),
    ));
    const active = matches.docs.filter((entry) => (entry.data() as WorkflowRecord).isDeleted !== true);
    if (active.length > 1) throw new Error('Duplicate stock summaries exist for the same company, product, and warehouse');
    stockIdByKey.set(k, active[0]?.id || canonicalId);
  }
  const distinctStockIds = Array.from(new Set(stockIdByKey.values()));

  const outcome = await runTransaction(db, async (transaction) => {
    // ── READ PHASE (all reads precede all writes) ──
    const priorLedgerByLedgerId = new Map<string, WorkflowRecord | null>();
    for (const prep of preps) {
      if (priorLedgerByLedgerId.has(prep.ledgerId)) continue;
      const snap = await transaction.get(doc(db, COLLECTIONS.STOCK_LEDGER, prep.ledgerId));
      priorLedgerByLedgerId.set(prep.ledgerId, snap.exists() ? (snap.data() as WorkflowRecord) : null);
    }
    const existingByStockId = new Map<string, WorkflowRecord | null>();
    for (const stockId of distinctStockIds) {
      const snap = await transaction.get(doc(db, COLLECTIONS.STOCK, stockId));
      existingByStockId.set(stockId, snap.exists() ? (snap.data() as WorkflowRecord) : null);
    }
    let participantCtx: unknown;
    if (participant) {
      const readCtx: MovementReadContext = {
        get: async (col, id) => {
          const s = await transaction.get(doc(db, col, id));
          return s.exists() ? (s.data() as never) : null;
        },
      };
      participantCtx = await participant.read(readCtx);
    }

    // ── PLAN + INVARIANTS ──
    const plan = planEntries(preps, stockIdByKey, existingByStockId, priorLedgerByLedgerId);
    const publicPlan = toPublicPlan(plan);

    // ── VALIDATE PHASE (participant first, then invariants) ──
    if (participant?.validate) {
      const verdict = participant.validate(participantCtx, publicPlan);
      if (verdict === false) {
        return { skipped: true as const, applied: false as const, plan };
      }
    }
    if (!plan.some((e) => e.applied)) {
      return { skipped: false as const, applied: false as const, plan };
    }
    assertPlanInvariants(plan);

    // ── WRITE PHASE — one stock write per distinct summary that moved ──
    const running = new Map<string, { onHand: number; reserved: number }>();
    for (const e of plan) {
      const cur = running.get(e.stockId) || {
        onHand: Number(existingByStockId.get(e.stockId)?.onHandQty
          ?? existingByStockId.get(e.stockId)?.availableQty
          ?? existingByStockId.get(e.stockId)?.available) || 0,
        reserved: Number(existingByStockId.get(e.stockId)?.reservedQty
          ?? existingByStockId.get(e.stockId)?.reserved) || 0,
      };
      if (e.applied) { cur.onHand = e.onHandAfter; cur.reserved = e.reservedAfter; }
      running.set(e.stockId, cur);
    }
    const movedStockIds = new Set(plan.filter((e) => e.applied).map((e) => e.stockId));
    for (const stockId of movedStockIds) {
      const anchor = plan.find((e) => e.stockId === stockId) as PlannedEntry;
      const existing = existingByStockId.get(stockId);
      const final = running.get(stockId) as { onHand: number; reserved: number };
      const summaryBase = { ...(existing || {}) };
      delete (summaryBase as WorkflowRecord).available;
      delete (summaryBase as WorkflowRecord).reserved;
      transaction.set(doc(db, COLLECTIONS.STOCK, stockId), sanitizeFirestoreData({
        ...summaryBase,
        id: stockId, companyId, ...(anchor.prep.groupId ? { groupId: anchor.prep.groupId } : {}),
        productId: anchor.input.productId, warehouseId: anchor.input.warehouseId, unit: anchor.input.unit,
        onHandQty: final.onHand, reservedQty: final.reserved,
        availableQty: deriveAvailable(anchor.prep, final.onHand, final.reserved),
        updatedBy: anchor.prep.actorId, updatedAt: serverTimestamp(),
        createdAt: existing?.createdAt ?? serverTimestamp(),
        isDeleted: false,
      }));
    }
    const txnId = genId.generic('TXN');
    for (const e of plan) {
      if (!e.applied) continue;
      transaction.set(doc(db, COLLECTIONS.STOCK_LEDGER, e.prep.ledgerId), sanitizeFirestoreData(buildLedgerRow({
        prep: e.prep, input: e.input, transactionId: txnId, dateIso: nowIso,
        movementAt: serverTimestamp(), createdAt: serverTimestamp(), stockId: e.stockId,
        qty: e.effectiveQty,
        before: { onHand: e.onHandBefore, reserved: e.reservedBefore },
        after: { onHand: e.onHandAfter, reserved: e.reservedAfter },
      })));
    }

    // ── PARTICIPANT COMMIT ──
    if (participant?.commit) {
      const writer: MovementWriter = {
        set: (col, id, data, options) => {
          assertParticipantCollection(col);
          transaction.set(doc(db, col, id), sanitizeFirestoreData(data), options || {});
        },
        update: (col, id, data) => {
          assertParticipantCollection(col);
          transaction.update(doc(db, col, id), sanitizeFirestoreData(data));
        },
      };
      participant.commit(participantCtx, publicPlan, writer);
    }

    return { skipped: false as const, applied: true as const, plan };
  });

  const results = outcome.plan.map((e) => resultFor(e, outcome.skipped));
  return { applied: outcome.applied, skipped: outcome.skipped, results };
}

/* ── demo / non-configured branch — sequential, still idempotent ── */

async function applyBatchDemo(
  preps: PreparedMovement[],
  companyId: string,
  participant: MovementParticipant | undefined,
  nowIso: string,
): Promise<BatchMovementResult> {
  const allStock = await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK);
  const stockIdByKey = new Map<string, string>();
  for (const prep of preps) {
    const k = summaryKey(prep.input.productId, prep.input.warehouseId);
    if (stockIdByKey.has(k)) continue;
    const matching = allStock.filter((row) =>
      row.companyId === companyId && row.productId === prep.input.productId && row.warehouseId === prep.input.warehouseId);
    stockIdByKey.set(k, resolveStockSummaryDocumentId(
      stockSummaryId(companyId, prep.input.productId, prep.input.warehouseId), matching));
  }
  const distinctStockIds = Array.from(new Set(stockIdByKey.values()));

  const priorLedgerByLedgerId = new Map<string, WorkflowRecord | null>();
  for (const prep of preps) {
    if (priorLedgerByLedgerId.has(prep.ledgerId)) continue;
    let row: WorkflowRecord | null = null;
    try { row = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK_LEDGER, prep.ledgerId); } catch { row = null; }
    priorLedgerByLedgerId.set(prep.ledgerId, row);
  }
  const existingByStockId = new Map<string, WorkflowRecord | null>();
  for (const stockId of distinctStockIds) {
    let row: WorkflowRecord | null = allStock.find((r) => r.id === stockId) || null;
    if (!row) {
      try { row = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK, stockId); } catch { row = null; }
    }
    existingByStockId.set(stockId, row);
  }

  let participantCtx: unknown;
  if (participant) {
    const readCtx: MovementReadContext = {
      get: async (col, id) => { try { return (await getOne(col, id)) as never; } catch { return null; } },
    };
    participantCtx = await participant.read(readCtx);
  }

  const plan = planEntries(preps, stockIdByKey, existingByStockId, priorLedgerByLedgerId);
  const publicPlan = toPublicPlan(plan);

  if (participant?.validate) {
    if (participant.validate(participantCtx, publicPlan) === false) {
      return { applied: false, skipped: true, results: plan.map((e) => resultFor(e, true)) };
    }
  }
  if (!plan.some((e) => e.applied)) {
    return { applied: false, skipped: false, results: plan.map((e) => resultFor(e, false)) };
  }
  assertPlanInvariants(plan);

  const running = new Map<string, { onHand: number; reserved: number }>();
  for (const stockId of distinctStockIds) {
    const existing = existingByStockId.get(stockId);
    running.set(stockId, {
      onHand: Number(existing?.onHandQty ?? existing?.availableQty ?? existing?.available) || 0,
      reserved: Number(existing?.reservedQty ?? existing?.reserved) || 0,
    });
  }
  const txnId = genId.generic('TXN');
  for (const e of plan) {
    if (!e.applied) continue;
    const existing = existingByStockId.get(e.stockId);
    const cur = running.get(e.stockId) as { onHand: number; reserved: number };
    cur.onHand = e.onHandAfter;
    cur.reserved = e.reservedAfter;
    const summaryBase = { ...(existing || {}) };
    delete (summaryBase as WorkflowRecord).available;
    delete (summaryBase as WorkflowRecord).reserved;
    await createDocWithId(COLLECTIONS.STOCK, e.stockId, sanitizeFirestoreData({
      ...summaryBase,
      id: e.stockId, companyId, ...(e.prep.groupId ? { groupId: e.prep.groupId } : {}),
      productId: e.input.productId, warehouseId: e.input.warehouseId, unit: e.input.unit,
      onHandQty: cur.onHand, reservedQty: cur.reserved,
      availableQty: deriveAvailable(e.prep, cur.onHand, cur.reserved),
      updatedBy: e.prep.actorId, isDeleted: false,
    }));
    await createDocWithId(COLLECTIONS.STOCK_LEDGER, e.prep.ledgerId, sanitizeFirestoreData(buildLedgerRow({
      prep: e.prep, input: e.input, transactionId: txnId, dateIso: nowIso, movementAt: nowIso, createdAt: nowIso,
      stockId: e.stockId, qty: e.effectiveQty,
      before: { onHand: e.onHandBefore, reserved: e.reservedBefore },
      after: { onHand: e.onHandAfter, reserved: e.reservedAfter },
    })));
    existingByStockId.set(e.stockId, {
      ...(existing || {}), onHandQty: cur.onHand, reservedQty: cur.reserved,
      availableQty: deriveAvailable(e.prep, cur.onHand, cur.reserved),
    } as WorkflowRecord);
  }

  if (participant?.commit) {
    const pending: Array<() => Promise<unknown>> = [];
    const writer: MovementWriter = {
      set: (col, id, data, options) => {
        assertParticipantCollection(col);
        const payload = sanitizeFirestoreData(data);
        pending.push(() => (options?.merge
          ? updateDocById(col, id, payload)
          : createDocWithId(col, id, payload)));
      },
      update: (col, id, data) => {
        assertParticipantCollection(col);
        const payload = sanitizeFirestoreData(data);
        pending.push(() => updateDocById(col, id, payload));
      },
    };
    participant.commit(participantCtx, publicPlan, writer);
    for (const run of pending) await run();
  }

  return { applied: true, skipped: false, results: plan.map((e) => resultFor(e, false)) };
}
