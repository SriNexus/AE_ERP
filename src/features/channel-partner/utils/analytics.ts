/**
 * analytics — Shared partner analytics utilities
 *
 * Centralized analytics functions for partner performance scoring,
 * grading, and distribution computations.
 *
 * All functions are pure — they consume data and return results.
 * No side effects. No Firestore access.
 *
 * Import anywhere analytics are needed:
 *   import { computePartnerScore, gradePartner, scoreDistribution } from './analytics';
 */

// ── Types ──────────────────────────────────────────────────

export interface PartnerScoreInput {
  id: string;
  leadsCount: number;
  convertedCount: number;
  completedInstallations: number;
  settledAmount: number;
  paidCommissionsCount: number;
}

export interface PartnerScoreResult {
  /** Numeric score 0–100 */
  numeric: number;
  /** Letter grade: A+, A, B, C, D */
  score: string;
}

// ── Score Factors (weights) ────────────────────────────────

const WEIGHTS = {
  conversionRate: 0.25,
  leadVolume: 0.15,
  installations: 0.20,
  settlement: 0.20,
  commissionHistory: 0.20,
} as const;

// ── Pure functions ─────────────────────────────────────────

/**
 * Compute a partner performance score (0–100).
 * Pure function — no side effects, no Firestore access.
 *
 * Factors:
 *   25% — Conversion rate (0–100 scale)
 *   15% — Lead volume (capped at 50 leads → 100)
 *   20% — Completed installations (capped at 10 → 100)
 *   20% — Settlement amount (capped at ₹5,00,000 → 100)
 *   20% — Paid commissions history (capped at 5 → 100)
 */
export function computePartnerScore(input: PartnerScoreInput): PartnerScoreResult {
  const convRate = input.leadsCount > 0 ? input.convertedCount / input.leadsCount : 0;
  const convScore = convRate * 100;
  const leadScore = Math.min(input.leadsCount * 2, 100);
  const installScore = Math.min(input.completedInstallations * 10, 100);
  const settlementScore = Math.min(input.settledAmount / 5000, 100);
  const commissionScore = Math.min(input.paidCommissionsCount * 20, 100);

  const total =
    convScore * WEIGHTS.conversionRate +
    leadScore * WEIGHTS.leadVolume +
    installScore * WEIGHTS.installations +
    settlementScore * WEIGHTS.settlement +
    commissionScore * WEIGHTS.commissionHistory;

  return {
    numeric: Math.round(total * 10) / 10,
    score: gradePartner(total),
  };
}

/**
 * Convert a numeric score to a letter grade.
 */
export function gradePartner(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/**
 * Compute score distribution across a set of partners.
 * Returns count and percentage for each grade.
 */
export function scoreDistribution(
  scores: PartnerScoreResult[],
): { grade: string; count: number; pct: number }[] {
  const dist: Record<string, number> = { 'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
  scores.forEach((s) => {
    dist[s.score] = (dist[s.score] || 0) + 1;
  });
  const total = scores.length || 1;
  return Object.entries(dist)
    .filter(([, count]) => count > 0)
    .map(([grade, count]) => ({ grade, count, pct: Math.round((count / total) * 100) }));
}

/**
 * Helper: build a PartnerScoreInput from raw domain data.
 */
export function buildPartnerScoreInput(
  partnerId: string,
  allLeads: any[],
  allSettlements: any[],
  allCommissionRecords: any[],
): PartnerScoreInput {
  const partnerLeads = allLeads.filter((l: any) => l.partnerId === partnerId);
  const leadsCount = partnerLeads.length;
  const convertedCount = partnerLeads.filter((l: any) => l.status === 'Converted' || l.status === 'Won').length;
  const completedInstallations = partnerLeads.filter(
    (l: any) => l.installationStatus === 'installation_complete' || l.installationStatus === 'closed',
  ).length;
  const settledAmount = allSettlements
    .filter((s: any) => s.partnerId === partnerId && s.status === 'completed')
    .reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0);
  const paidCommissionsCount = allCommissionRecords.filter(
    (r: any) => r.partnerId === partnerId && r.status === 'paid',
  ).length;

  return {
    id: partnerId,
    leadsCount,
    convertedCount,
    completedInstallations,
    settledAmount,
    paidCommissionsCount,
  };
}

// ── Grade styles (reusable for UI badges) ──────────────────

export const GRADE_STYLES: Record<string, string> = {
  'A+': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'A': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'B': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'C': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'D': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default {
  computePartnerScore,
  gradePartner,
  scoreDistribution,
  buildPartnerScoreInput,
  GRADE_STYLES,
};
