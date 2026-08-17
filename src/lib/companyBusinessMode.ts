/**
 * Company Business Mode — Phase 1 foundation.
 *
 * Each Company operates in exactly one of three modes. This is a property of
 * the COMPANY (a tenant), not of a Customer or Project — never conflate this
 * with `Customer.type` (B2B/B2C classification, Phase 2) or `Project.projectType`
 * (Residential/Commercial/Industrial, Phase 4). See
 * docs/NEOZY_MASTER_IMPLEMENTATION_BLUEPRINT.md §8 for the full enforcement table.
 */
import type { Module } from './permissions';

export type CompanyBusinessMode = 'B2B' | 'B2C' | 'Both';

export const COMPANY_BUSINESS_MODES: CompanyBusinessMode[] = ['B2B', 'B2C', 'Both'];

/** Locked at Phase 0: existing companies default to 'Both' so no capability is silently narrowed. */
export const DEFAULT_BUSINESS_MODE: CompanyBusinessMode = 'Both';

/**
 * Modules that exist ONLY for the B2C (Neozy performs the installation) workflow.
 * A B2B-mode company (material distribution only, no Project) must never reach these.
 *
 * Deliberately NOT included: 'orders' | 'quotations' | 'dispatch' | 'invoices' | 'payments'.
 * Both B2B and B2C use these shared financial/logistics modules (a B2C Order is simply
 * Project-linked) — hiding them for a B2C-mode company would break the B2C flow itself.
 * The locked Phase 0 rule ("B2C is Project-only", i.e. a B2C-mode company may not create
 * a standalone Order/Quotation without a Project) is enforced at the Order/Quotation
 * creation entry point in Phase 3/4, not by hiding these pages at the nav/route level.
 */
export const B2C_ONLY_MODULES: Module[] = [
  'projects',
  'surveys',
  'engineering',
  'installations',
  'qc',
  'commissioning',
  'net_metering',
  'subsidy',
  'service_tickets',
  'loan_applications',
  // Phase 2 (Channel Partner spec §8.1, LOCKED): the Vendor Lock /
  // Registration stage module is a project-stage module — B2B-mode companies
  // are gated identically to projects/surveys/registrations. Partner-created
  // projects are not partner-specific-B2C; they follow the company
  // businessMode and customer-type rules exactly like every other role.
  'scheme_registration',
];

/** Resolves a company's business mode with a safe default for records created before Phase 1. */
export function resolveBusinessMode(company: { businessMode?: string } | null | undefined): CompanyBusinessMode {
  const mode = company?.businessMode;
  return mode === 'B2B' || mode === 'B2C' ? mode : DEFAULT_BUSINESS_MODE;
}

/**
 * Whether a module's pages/routes should be reachable for a company in the given mode.
 * Only the B2B -> hide-B2C-only-modules direction is enforced here. The B2C -> restrict
 * standalone-Order-without-Project direction is a creation-time/service-layer rule
 * (Phase 3/4), not a page-visibility rule — see B2C_ONLY_MODULES doc comment above.
 */
export function isModuleAllowedForBusinessMode(module: Module, mode: CompanyBusinessMode): boolean {
  if (mode === 'B2B') return !B2C_ONLY_MODULES.includes(module);
  return true;
}
