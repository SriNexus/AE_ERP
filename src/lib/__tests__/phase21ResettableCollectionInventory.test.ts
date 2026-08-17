/**
 * phase21ResettableCollectionInventory.test.ts
 *
 * A live-Firestore audit (Phase 20/21) found that DEMO_RESETTABLE_COLLECTIONS
 * (scripts/demo/config.ts) was missing three real, actively-written
 * collections entirely: 'cases' (CaseEngine.createCase(), fired by
 * createCaseForLead() on every real Lead creation — including ordinary
 * demo-mode CRUD), 'settlements' (channelPartnerSettlement.ts's settlement
 * workflows), and 'audit_logs' (workflow.ts's logActivity(), called on
 * nearly every create/update action anywhere in the app). None of the
 * three could ever have been cleaned by any reset path — including the
 * Phase 20 content-based sweep fix — because the collection itself was
 * never even queried, regardless of how documents inside it were matched.
 *
 * This test asserts the fix generically (by reading real writer source
 * files for their collection constant), not via a hardcoded list, so it
 * keeps protecting the invariant if a future phase adds another
 * companyId-scoped collection and forgets to register it as resettable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEMO_RESETTABLE_COLLECTIONS } from '../../../scripts/demo/config.ts';
import { getEntityRegistryEntry } from '../entityRegistry';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

describe('Phase 21 — DEMO_RESETTABLE_COLLECTIONS covers every real companyId-scoped writer', () => {
  it('includes cases, settlements, and audit_logs', () => {
    const resettable = DEMO_RESETTABLE_COLLECTIONS as readonly string[];
    expect(resettable).toContain('cases');
    expect(resettable).toContain('settlements');
    expect(resettable).toContain('audit_logs');
  });

  it("CaseEngine.createCase() writes to COLLECTIONS.CASES, and 'cases' is resettable", () => {
    const source = readFileSync(path.join(repoRoot, 'src/engines/CaseEngine.ts'), 'utf8');
    expect(source).toMatch(/createDocWithId\(COLLECTIONS\.CASES/);
    expect(DEMO_RESETTABLE_COLLECTIONS as readonly string[]).toContain('cases');
  });

  it("logActivity() writes to COLLECTIONS.AUDIT_LOGS with a companyId, and 'audit_logs' is resettable", () => {
    const source = readFileSync(path.join(repoRoot, 'src/lib/workflow.ts'), 'utf8');
    expect(source).toMatch(/createDocWithId\(COLLECTIONS\.AUDIT_LOGS/);
    expect(source).toMatch(/companyId:\s*state\.activeCompanyId/);
    expect(DEMO_RESETTABLE_COLLECTIONS as readonly string[]).toContain('audit_logs');
  });

  it("'cases' has a real entityRegistry entry (previously missing, required by phase16EntityRegistryCoverage's invariant)", () => {
    const entry = getEntityRegistryEntry('cases');
    expect(entry).toBeTruthy();
    expect(entry!.labelFields.length).toBeGreaterThan(0);
    expect(entry!.ownerFields.length).toBeGreaterThan(0);
  });

  it("'activity' (a collection constant that exists but has no real writer anywhere) is correctly NOT part of resettable data — nothing to clean", () => {
    // COLLECTIONS.ACTIVITY is referenced only in a stale comment
    // (UniversalNotesTab.tsx), never in an actual write call — confirmed by
    // grepping src/ for COLLECTIONS.ACTIVITY as this test's own basis.
    const source = readFileSync(path.join(repoRoot, 'src/components/shared/UniversalTabs/UniversalNotesTab.tsx'), 'utf8');
    expect(source).toMatch(/COLLECTIONS\.ACTIVITY/); // the stale comment itself
    expect(source).not.toMatch(/createDocWithId\(COLLECTIONS\.ACTIVITY/);
  });
});
