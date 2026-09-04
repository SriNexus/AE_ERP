/**
 * singleStockWriter.test.ts — INVENTORY-05d (P1-4)
 * ================================================
 *
 * After the Phase-05 migration there must be EXACTLY ONE code path that writes a
 * `stock` summary or a `stock_ledger` row: `src/lib/inventory/stockMovementEngine.ts`
 * (`applyStockMovement` / `applyStockMovements`). Every other workflow — GRN
 * (05b), dispatch OUT (05c), manual add/adjust + order-cancel restore + `stockIn`
 * (05d) — calls the engine.
 *
 * This test greps the source tree for a direct `stock` / `stock_ledger` WRITE
 * outside the engine and fails if it finds one. It is the permanent guard
 * against a second stock writer being reintroduced (Plan §833 / §837).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = 'src/lib/inventory/stockMovementEngine.ts';

/** Direct write of a `stock` summary or `stock_ledger` row. */
const WRITE_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /createDocWithId\(\s*COLLECTIONS\.STOCK(_LEDGER)?\b/, what: 'createDocWithId(COLLECTIONS.STOCK…)' },
  { re: /updateDocById\(\s*COLLECTIONS\.STOCK(_LEDGER)?\b/, what: 'updateDocById(COLLECTIONS.STOCK…)' },
  { re: /(?:transaction|tx)\.(?:set|update)\(\s*[A-Za-z_.]*[Ss]tock(?:Ref|LedgerRef|SummaryRef|_ledgerRef)?\b/, what: 'transaction.set(stockRef…)' },
  { re: /(?:setDoc|updateDoc)\(\s*doc\([^)]*['"]stock(?:_ledger)?['"]/, what: "setDoc(doc(db,'stock'…))" },
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full.replace(/\\/g, '/'));
    }
  }
  return acc;
}

describe('INVENTORY-05d (P1-4) — single stock writer', () => {
  it('the movement engine is the ONLY module that writes stock / stock_ledger', () => {
    const files = collectSourceFiles('src');
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(ENGINE.replace('src/', '') ) || file.endsWith(ENGINE)) continue;
      const src = readFileSync(file, 'utf8');
      for (const { re, what } of WRITE_PATTERNS) {
        const m = src.match(re);
        if (m) offenders.push(`${file}  →  ${what}  (${m[0]})`);
      }
    }

    expect(offenders, `stock / stock_ledger is written outside ${ENGINE}:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the migrated workflows call the engine', () => {
    const grn = readFileSync('src/features/procurement/services/goodsReceiptWorkflow.ts', 'utf8');
    const dispatch = readFileSync('src/lib/dispatchWorkflow.ts', 'utf8');
    const stock = readFileSync('src/lib/stockWorkflow.ts', 'utf8');
    const manual = readFileSync('src/features/inventory/hooks/useInventory.ts', 'utf8');

    for (const [name, src] of [['GRN', grn], ['dispatch', dispatch], ['stockWorkflow', stock], ['manual', manual]] as const) {
      expect(src, `${name} should call the movement engine`).toMatch(/applyStockMovements?\(/);
    }
    // GRN no longer opens its own runTransaction at all.
    expect(grn).not.toMatch(/runTransaction\(/);
    // dispatchWorkflow keeps ONLY its non-stock transactions (closeDispatch / confirmDelivery).
    expect(dispatch.match(/runTransaction\(/g) || []).toHaveLength(2);
  });
});
