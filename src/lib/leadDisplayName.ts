/**
 * leadDisplayName — a lead's `name` field may legitimately be blank.
 *
 * A Channel Partner can submit a lead with only a phone number captured
 * (`PartnerCreateLeadModal.tsx`'s own validation only requires "name OR
 * phone", never both — a partner may not have the customer's name yet).
 * `partnerLeadIntegration.ts` already treats this as valid, everyday data:
 * its own activity-log and notification text fall back to `input.phone`
 * whenever `input.name` is blank. `PartnerDashboard.tsx`'s recent-leads row
 * did NOT apply the same fallback — `(lead.name ?? '?')[0].toUpperCase()`
 * only guards `null`/`undefined`, not an empty string (`??` doesn't fall
 * through on falsy-but-defined values), so a phone-only lead crashed the
 * whole dashboard with `Cannot read properties of undefined (reading
 * 'toUpperCase')` (`''[0]` is `undefined`).
 *
 * PURE, zero-import — one implementation of the fallback rule, reused by
 * every consumer instead of each re-deriving its own ad hoc `name || phone`.
 */
export function leadDisplayName(lead: { name?: unknown; phone?: unknown } | null | undefined): string {
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return pick(lead?.name) || pick(lead?.phone) || 'Unnamed Lead';
}

/** The avatar-initial for a lead row. `leadDisplayName` never returns an
 *  empty string, so indexing `[0]` here is always safe by construction —
 *  no defensive optional chaining needed. */
export function leadInitial(lead: { name?: unknown; phone?: unknown } | null | undefined): string {
  return leadDisplayName(lead)[0].toUpperCase();
}
