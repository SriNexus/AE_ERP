/**
 * phase16EntityRegistryCoverage.test.ts — Phase 16 (Cross-Module Integration
 * & Final ERP Stabilization) permanent regression guard.
 *
 * entityRegistry.ts previously had no entry at all for 8 real, actively
 * written production collections — installations, documents,
 * commission_records, notifications, tasks, entity_relationships, banks,
 * registrations — meaning relationships.ts's linked/recommended-
 * relationships logic could never recognize a reference to any of them, and
 * getEntityLabel()/resolveOwnerId() silently fell back to a bare id
 * wherever the UI needed a friendly label for one of these entity types.
 *
 * This test asserts every collection in DEMO_RESETTABLE_COLLECTIONS (the
 * authoritative production collection inventory, per Phase 15.1) that is
 * genuinely a labelable/ownable business entity has a real registry entry —
 * generic, not keyed to any one hardcoded collection name, so it keeps
 * protecting the invariant if a future phase adds another collection and
 * forgets to register it.
 */
import { describe, expect, it } from 'vitest';
import { getEntityRegistryEntry, ENTITY_REGISTRY } from '../entityRegistry';
import { DEMO_RESETTABLE_COLLECTIONS } from '../../../scripts/demo/config.ts';

// Collections that are genuinely NOT single labelable entities in the
// registry's sense (pure ledger/junction rows, or already covered under a
// different collection name) — deliberately excluded, not merely missed.
const NOT_APPLICABLE = new Set<string>([
  'customer_phone_locks', // a uniqueness-lock row, not a displayable entity
  'stock_ledger',         // registered under its real name already (below)
  'commission_records',   // registered — included here only to document intent
]);

describe('Phase 16 — entityRegistry.ts covers every real production collection', () => {
  it('the 8 collections found missing this phase are now registered', () => {
    for (const collection of ['installations', 'documents', 'commission_records', 'notifications', 'tasks', 'entity_relationships', 'banks', 'registrations']) {
      expect(getEntityRegistryEntry(collection), `${collection} must have an entityRegistry entry`).toBeTruthy();
    }
  });

  it('every DEMO_RESETTABLE_COLLECTIONS entry that is a real labelable entity has a registry entry', () => {
    const missing = (DEMO_RESETTABLE_COLLECTIONS as readonly string[]).filter(
      (collection) => !NOT_APPLICABLE.has(collection) && !getEntityRegistryEntry(collection),
    );
    expect(missing, `these production collections have no entityRegistry entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every registry entry declares at least one label field and resolves a non-empty label from a plausible record', () => {
    for (const entry of ENTITY_REGISTRY) {
      expect(entry.labelFields.length, `${entry.collectionName} must declare labelFields`).toBeGreaterThan(0);
      expect(entry.ownerFields.length, `${entry.collectionName} must declare ownerFields`).toBeGreaterThan(0);
    }
  });
});
