/**
 * phase20StaleDataSweep.test.ts
 *
 * loadSafeDeletionDocuments() (scripts/demo/runner.ts, pre-existing) only
 * ever looks up ids that are part of the CURRENT canonical demo plan — a
 * record left behind by an older generator version, or created via a
 * user's own demo-mode CRUD testing, has an id the plan never mentions and
 * was therefore permanently unreachable by any reset (npm run demo:reset /
 * the scheduled GitHub Actions workflow), no matter how many times it ran.
 * loadStaleCompanyScopedDocuments() closes that gap with a plain companyId
 * sweep per resettable collection, matching api/demo-reset.ts's
 * already-correct approach (the client/login-triggered reset path never
 * had this gap). Wired into both resetDemoData.ts and cleanupDemoData.ts.
 */
import { describe, expect, it } from 'vitest';
import { loadStaleCompanyScopedDocuments } from '../../../scripts/demo/runner.ts';

function fakeDb(collections: Record<string, Array<{ id: string; companyId: string }>>) {
  return {
    collection(name: string) {
      const docs = collections[name] || [];
      return {
        where(field: string, _op: string, value: string) {
          return {
            async get() {
              return {
                docs: docs
                  .filter((d) => (d as any)[field] === value)
                  .map((d) => ({ id: d.id, data: () => d })),
              };
            },
          };
        },
      };
    },
  };
}

describe('loadStaleCompanyScopedDocuments', () => {
  it('returns a demo-company document whose id was never part of the current plan', async () => {
    const db = fakeDb({
      customers: [
        { id: 'DEMO-V1-CUS-001', companyId: 'company-demo-neozy' }, // already in the plan
        { id: 'LEGACY-CUS-9', companyId: 'company-demo-neozy' },    // stale — different id scheme entirely
      ],
    });
    const alreadyIncluded = new Set(['customers/DEMO-V1-CUS-001']);
    const stale = await loadStaleCompanyScopedDocuments(db as any, ['customers'], 'company-demo-neozy', alreadyIncluded);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ collection: 'customers', id: 'LEGACY-CUS-9' });
  });

  it('never returns a document belonging to a different company (tenant isolation preserved)', async () => {
    const db = fakeDb({
      customers: [
        { id: 'OTHER-CO-CUS-1', companyId: 'some-real-production-company' },
      ],
    });
    const stale = await loadStaleCompanyScopedDocuments(db as any, ['customers'], 'company-demo-neozy', new Set());
    expect(stale).toHaveLength(0);
  });

  it('sweeps every listed resettable collection, not just one', async () => {
    const db = fakeDb({
      leads: [{ id: 'STALE-LEAD-1', companyId: 'company-demo-neozy' }],
      orders: [{ id: 'STALE-ORD-1', companyId: 'company-demo-neozy' }],
    });
    const stale = await loadStaleCompanyScopedDocuments(db as any, ['leads', 'orders'], 'company-demo-neozy', new Set());
    expect(stale.map((d) => `${d.collection}/${d.id}`).sort()).toEqual(['leads/STALE-LEAD-1', 'orders/STALE-ORD-1']);
  });
});
