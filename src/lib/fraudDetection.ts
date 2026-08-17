/**
 * fraudDetection — Centralized Fraud Detection & Risk Analytics Engine
 *
 * Architecture:
 *   - Pure rule functions (no side effects, no Firestore)
 *   - Service layer for evaluation, investigation, and scheduler integration
 *   - Reuses existing: analytics utility, notification system, audit system, activity logging
 *
 * Design Principle:
 *   Fraud logic lives HERE only. UI components consume processed results.
 *   No scattered fraud calculations in pages.
 */

import { getAll, getOne, createDocWithId, updateDocById, genId, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { recordSettlementAudit } from './settlementAudit';
import type {
  FraudRuleType,
  FraudRuleResult,
  FraudEvaluation,
  FraudSummary,
  FraudAlert,
  FraudInvestigation,
  InvestigationNote,
  InvestigationStatus,
  FraudRiskLevel,
  InvestigationFilters,
} from '../features/channel-partner/types/fraud';
import { FRAUD_RULE_WEIGHTS, FRAUD_RULE_LABELS } from '../features/channel-partner/types/fraud';

// ═══════════════════════════════════════════════════════════
//  PURE RULE FUNCTIONS — No side effects, no Firestore access
// ═══════════════════════════════════════════════════════════

type RiskInput = { partnerId: string };

/**
 * Detect duplicate leads — same phone/email submitted multiple times.
 */
export function detectDuplicateLeads(input: RiskInput, allLeads: any[]): FraudRuleResult {
  const partnerLeads = allLeads.filter((l: any) => l.partnerId === input.partnerId);
  const recentLeads = partnerLeads.filter((l: any) => {
    if (!l.createdAt) return true;
    return Date.now() - new Date(l.createdAt).getTime() < 90 * 86400000;
  });

  // Check for same phone across partner's leads
  const phoneCounts: Record<string, number> = {};
  const emailCounts: Record<string, number> = {};
  const evidence: string[] = [];
  let duplicateScore = 0;

  partnerLeads.forEach((l: any) => {
    if (l.phone) {
      phoneCounts[l.phone] = (phoneCounts[l.phone] || 0) + 1;
      if (phoneCounts[l.phone] === 2) {
        evidence.push(`Same phone "${l.phone}" appears in ${Object.values(phoneCounts).reduce((a, b) => a + b, 0)} leads`);
      }
    }
    if (l.email) {
      emailCounts[l.email] = (emailCounts[l.email] || 0) + 1;
      if (emailCounts[l.email] === 2) {
        evidence.push(`Same email "${l.email}" appears in multiple leads`);
      }
    }
  });

  const duplicates = Object.values(phoneCounts).filter(c => c > 1).length +
    Object.values(emailCounts).filter(c => c > 1).length;

  if (duplicates > 0) {
    duplicateScore = Math.min(duplicates * 10, 25);
  }

  // High volume of recent leads is suspicious
  if (recentLeads.length > 15) {
    duplicateScore += 10;
    evidence.push(`Unusually high lead volume: ${recentLeads.length} in 90 days`);
  }

  const triggered = duplicateScore >= 10;
  return {
    ruleType: 'duplicate_leads',
    triggered,
    riskPoints: triggered ? Math.round(duplicateScore) : 0,
    explanation: triggered
      ? `Duplicate lead activity detected (${evidence.length} signal(s))`
      : 'No duplicate lead patterns detected',
    evidence: evidence.length > 0 ? evidence : ['Normal lead submission pattern'],
    severity: duplicateScore >= 20 ? 'high' : duplicateScore >= 10 ? 'medium' : 'low',
  };
}

/**
 * Detect suspicious commission growth — abnormal jump or trend.
 */
export function detectSuspiciousCommissionGrowth(input: RiskInput, allCommissionRecords: any[]): FraudRuleResult {
  const records = allCommissionRecords
    .filter((r: any) => r.partnerId === input.partnerId && !r.isDeleted)
    .sort((a: any, b: any) => new Date(a.generatedDate || a.createdAt).getTime() - new Date(b.generatedDate || b.createdAt).getTime());

  if (records.length < 3) {
    return {
      ruleType: 'suspicious_commission_growth',
      triggered: false,
      riskPoints: 0,
      explanation: 'Insufficient commission history for analysis (minimum 3 records)',
      evidence: [`Only ${records.length} commission records available`],
      severity: 'low',
    };
  }

  const evidence: string[] = [];
  let growthScore = 0;

  // Check for sudden jump (recent avg vs historical avg)
  const mid = Math.floor(records.length / 2);
  const historical = records.slice(0, mid);
  const recent = records.slice(mid);

  const histAvg = historical.reduce((s: number, r: any) => s + (r.amount || 0), 0) / Math.max(historical.length, 1);
  const recentAvg = recent.reduce((s: number, r: any) => s + (r.amount || 0), 0) / Math.max(recent.length, 1);

  if (histAvg > 0 && recentAvg > histAvg * 2) {
    growthScore += 15;
    evidence.push(`Commission avg jumped from ${Math.round(histAvg)} to ${Math.round(recentAvg)} (${Math.round((recentAvg / histAvg) * 100)}% increase)`);
  }

  // Check for unusually large individual payout
  const maxAmount = Math.max(...records.map((r: any) => r.amount || 0));
  const overallAvg = records.reduce((s: number, r: any) => s + (r.amount || 0), 0) / records.length;
  if (overallAvg > 0 && maxAmount > overallAvg * 5) {
    growthScore += 10;
    evidence.push(`Unusually large payout: ${Math.round(maxAmount)} (${Math.round(maxAmount / overallAvg)}x average)`);
  }

  // Check for rapid approval (status changes too quickly)
  const fastApprovals = records.filter((r: any) => {
    if (r.status === 'paid' && r.generatedDate && r.paidAt) {
      return new Date(r.paidAt).getTime() - new Date(r.generatedDate).getTime() < 86400000;
    }
    return false;
  });
  if (fastApprovals.length > 2) {
    growthScore += 5;
    evidence.push(`${fastApprovals.length} commissions approved within 24 hours of generation`);
  }

  const triggered = growthScore >= 10;
  return {
    ruleType: 'suspicious_commission_growth',
    triggered,
    riskPoints: triggered ? Math.min(growthScore, 20) : 0,
    explanation: triggered
      ? `Suspicious commission growth pattern detected (score: ${growthScore})`
      : 'Commission growth pattern appears normal',
    evidence: evidence.length > 0 ? evidence : ['Normal commission distribution'],
    severity: growthScore >= 20 ? 'high' : growthScore >= 10 ? 'medium' : 'low',
  };
}

/**
 * Detect repeated withdrawal requests — excessive frequency.
 */
export function detectRepeatedWithdrawals(input: RiskInput, allWalletTxns: any[]): FraudRuleResult {
  const withdrawals = allWalletTxns.filter(
    (t: any) => t.partnerId === input.partnerId && t.type === 'withdrawal_request' && !t.isDeleted,
  ).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (withdrawals.length < 2) {
    return {
      ruleType: 'repeated_withdrawals',
      triggered: false,
      riskPoints: 0,
      explanation: 'Insufficient withdrawal history for analysis',
      evidence: [`${withdrawals.length} withdrawal(s) found`],
      severity: 'low',
    };
  }

  const evidence: string[] = [];
  let withdrawalScore = 0;

  // Check withdrawal frequency (more than 4 in 30 days)
  const recentWithdrawals = withdrawals.filter((w: any) => {
    return Date.now() - new Date(w.createdAt).getTime() < 30 * 86400000;
  });
  if (recentWithdrawals.length > 4) {
    withdrawalScore += 15;
    evidence.push(`${recentWithdrawals.length} withdrawals in last 30 days (threshold: 4)`);
  }

  // Check repeated failed attempts
  const failedAttempts = withdrawals.filter((w: any) => w.withdrawalStatus === 'rejected');
  if (failedAttempts.length > 3) {
    withdrawalScore += 10;
    evidence.push(`${failedAttempts.length} failed/rejected withdrawal attempts`);
  }

  // Check for small withdrawals close together (structuring)
  const smallWds = recentWithdrawals.filter((w: any) => Math.abs(w.amount || 0) < 5000);
  if (smallWds.length > 3) {
    withdrawalScore += 10;
    evidence.push(`${smallWds.length} small withdrawals (< ₹5K) in short period — possible structuring`);
  }

  // Unusual timing (nighttime withdrawals)
  const nightWds = withdrawals.filter((w: any) => {
    if (!w.createdAt) return false;
    const hour = new Date(w.createdAt).getHours();
    return hour >= 22 || hour <= 5;
  });
  if (nightWds.length > withdrawals.length * 0.5) {
    withdrawalScore += 5;
    evidence.push(`${nightWds.length} withdrawals occurred during nighttime hours (10PM-5AM)`);
  }

  const triggered = withdrawalScore >= 10;
  return {
    ruleType: 'repeated_withdrawals',
    triggered,
    riskPoints: triggered ? Math.min(withdrawalScore, 20) : 0,
    explanation: triggered
      ? `Suspicious withdrawal pattern detected (score: ${withdrawalScore})`
      : 'Withdrawal pattern appears normal',
    evidence: evidence.length > 0 ? evidence : ['Normal withdrawal pattern'],
    severity: withdrawalScore >= 20 ? 'high' : withdrawalScore >= 10 ? 'medium' : 'low',
  };
}

/**
 * Detect repeated settlement failures.
 */
export function detectSettlementFailures(input: RiskInput, allWalletTxns: any[]): FraudRuleResult {
  const settlements = allWalletTxns.filter(
    (t: any) => t.partnerId === input.partnerId && t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted,
  );

  if (settlements.length < 2) {
    return {
      ruleType: 'settlement_failure_pattern',
      triggered: false,
      riskPoints: 0,
      explanation: 'Insufficient settlement history for analysis',
      evidence: [`${settlements.length} settlement(s) found`],
      severity: 'low',
    };
  }

  const evidence: string[] = [];
  let failureScore = 0;

  const failed = settlements.filter((s: any) => s.status === 'failed');
  const failedRate = failed.length / settlements.length;

  if (failedRate > 0.5 && failed.length >= 2) {
    failureScore += 15;
    evidence.push(`${failed.length} of ${settlements.length} settlements failed (${Math.round(failedRate * 100)}%)`);
  }

  // High failure count per partner
  if (failed.length > 3) {
    failureScore += 10;
    evidence.push(`Repeated failure pattern: ${failed.length} failed settlements`);
  }

  // Failures with different reasons (possible manipulation)
  const uniqueReasons = new Set(failed.map((s: any) => s.failureReason || 'unknown'));
  if (uniqueReasons.size >= 3) {
    failureScore += 5;
    evidence.push(`${uniqueReasons.size} different failure reasons — possible pattern manipulation`);
  }

  // No success ever
  const hasSuccess = settlements.some((s: any) => s.status === 'completed');
  if (!hasSuccess && settlements.length >= 3) {
    failureScore += 5;
    evidence.push('No successful settlements ever — all failed');
  }

  const triggered = failureScore >= 10;
  return {
    ruleType: 'settlement_failure_pattern',
    triggered,
    riskPoints: triggered ? Math.min(failureScore, 15) : 0,
    explanation: triggered
      ? `Settlement failure pattern detected (score: ${failureScore})`
      : 'Settlement pattern appears normal',
    evidence: evidence.length > 0 ? evidence : ['Normal settlement success rate'],
    severity: failureScore >= 15 ? 'high' : failureScore >= 10 ? 'medium' : 'low',
  };
}

/**
 * Detect tier manipulation signals — suspicious tier changes.
 */
export function detectTierManipulation(input: RiskInput, tierHistory: any[]): FraudRuleResult {
  if (!tierHistory || tierHistory.length < 2) {
    return {
      ruleType: 'tier_manipulation',
      triggered: false,
      riskPoints: 0,
      explanation: 'Insufficient tier change history for analysis',
      evidence: [`${tierHistory?.length || 0} tier change(s) found`],
      severity: 'low',
    };
  }

  const evidence: string[] = [];
  let manipScore = 0;

  // Frequent manual overrides
  const manualChanges = tierHistory.filter((t: any) => t.changeType === 'manual');
  if (manualChanges.length > 2) {
    manipScore += 15;
    evidence.push(`${manualChanges.length} manual overrides — unusual frequency`);
  }

  // Rapid tier changes (upgrade then downgrade in short period)
  const sorted = [...tierHistory].sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
  for (let i = 1; i < sorted.length; i++) {
    const days = (new Date(sorted[i].changedAt).getTime() - new Date(sorted[i - 1].changedAt).getTime()) / 86400000;
    if (days < 30) {
      manipScore += 8;
      evidence.push(`Rapid tier change: ${sorted[i - 1].oldTier}→${sorted[i - 1].newTier} then ${sorted[i].oldTier}→${sorted[i].newTier} in ${Math.round(days)} days`);
      break;
    }
  }

  // Upgrade followed by downgrade (yo-yo pattern)
  for (let i = 1; i < sorted.length; i++) {
    const levels: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
    const prevDir = (levels[sorted[i - 1]?.newTier] || 0) > (levels[sorted[i - 1]?.oldTier] || 0) ? 'up' : 'down';
    const currDir = (levels[sorted[i]?.newTier] || 0) > (levels[sorted[i]?.oldTier] || 0) ? 'up' : 'down';
    if (prevDir !== currDir) {
      manipScore += 5;
      evidence.push('Yo-yo tier pattern detected (upgrade followed by downgrade)');
      break;
    }
  }

  const triggered = manipScore >= 10;
  return {
    ruleType: 'tier_manipulation',
    triggered,
    riskPoints: triggered ? Math.min(manipScore, 10) : 0,
    explanation: triggered
      ? `Tier manipulation signals detected (score: ${manipScore})`
      : 'No tier manipulation signals detected',
    evidence: evidence.length > 0 ? evidence : ['Normal tier change pattern'],
    severity: manipScore >= 15 ? 'high' : manipScore >= 10 ? 'medium' : 'low',
  };
}

/**
 * Detect activity anomalies — excessive edits, unusual patterns.
 */
export function detectActivityAnomalies(input: RiskInput, allAuditLogs: any[]): FraudRuleResult {
  const partnerLogs = allAuditLogs.filter(
    (l: any) => l.entityId === input.partnerId || l.metadata?.partnerId === input.partnerId,
  );

  if (partnerLogs.length < 10) {
    return {
      ruleType: 'activity_anomaly',
      triggered: false,
      riskPoints: 0,
      explanation: 'Insufficient activity history for analysis',
      evidence: [`${partnerLogs.length} activity log(s) found`],
      severity: 'low',
    };
  }

  const evidence: string[] = [];
  let anomalyScore = 0;

  // Excessive edits (more than 20 in a week)
  const weekAgo = Date.now() - 7 * 86400000;
  const recentLogs = partnerLogs.filter((l: any) => {
    const ts = l.timestamp || l.createdAt;
    return ts && new Date(ts).getTime() > weekAgo;
  });
  if (recentLogs.length > 20) {
    anomalyScore += 10;
    evidence.push(`${recentLogs.length} activities in last 7 days — unusually high`);
  }

  // Unusual edit patterns
  const editActions = ['updated', 'modified', 'edited', 'changed'];
  const editCount = partnerLogs.filter((l: any) => {
    const action = (l.action || '').toLowerCase();
    return editActions.some((e) => action.includes(e));
  }).length;
  if (editCount > partnerLogs.length * 0.6) {
    anomalyScore += 8;
    evidence.push(`High edit ratio: ${Math.round((editCount / partnerLogs.length) * 100)}% of activities are edits`);
  }

  // Activity bursts (many actions in short period)
  const timestamps = partnerLogs
    .map((l: any) => l.timestamp || l.createdAt)
    .filter(Boolean)
    .sort();
  let burstCount = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const diff = new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime();
    if (diff < 60000) burstCount++; // within 1 minute
  }
  if (burstCount > 5) {
    anomalyScore += 7;
    evidence.push(`${burstCount} rapid activities within 1 minute intervals — possible automation`);
  }

  const triggered = anomalyScore >= 10;
  return {
    ruleType: 'activity_anomaly',
    triggered,
    riskPoints: triggered ? Math.min(anomalyScore, 10) : 0,
    explanation: triggered
      ? `Abnormal activity pattern detected (score: ${anomalyScore})`
      : 'Activity pattern appears normal',
    evidence: evidence.length > 0 ? evidence : ['Normal activity pattern'],
    severity: anomalyScore >= 15 ? 'high' : anomalyScore >= 10 ? 'medium' : 'low',
  };
}

// ═══════════════════════════════════════════════════════════
//  RISK SCORING — Pure function
// ═══════════════════════════════════════════════════════════

const RISK_LEVEL_THRESHOLDS = { critical: 70, high: 45, medium: 20, low: 0 };

/**
 * Determine risk level from numeric score.
 */
export function determineRiskLevel(score: number): FraudRiskLevel {
  if (score >= RISK_LEVEL_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_LEVEL_THRESHOLDS.high) return 'high';
  if (score >= RISK_LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Calculate weighted risk score from rule results.
 * Pure function — no side effects.
 */
export function calculateRiskScore(ruleResults: FraudRuleResult[]): {
  totalScore: number;
  riskLevel: FraudRiskLevel;
  contributions: Record<FraudRuleType, number>;
} {
  const contributions: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of ruleResults) {
    const weight = FRAUD_RULE_WEIGHTS[result.ruleType] || 10;
    const severityMultiplier = result.severity === 'critical' ? 1.5
      : result.severity === 'high' ? 1.2
      : result.severity === 'medium' ? 1.0
      : 0.5;

    const contribution = result.triggered
      ? Math.round((result.riskPoints / 25) * weight * severityMultiplier)
      : 0;

    contributions[result.ruleType] = contribution;
    weightedSum += contribution;
    totalWeight += weight;
  }

  // Normalize to 0-100
  const normalizedScore = totalWeight > 0
    ? Math.round(Math.min((weightedSum / totalWeight) * 100, 100))
    : 0;

  // Severity escalation for multiple triggered rules
  const triggeredCount = ruleResults.filter((r) => r.triggered).length;
  const escalationBonus = triggeredCount >= 4 ? 10 : triggeredCount >= 3 ? 5 : 0;
  const finalScore = Math.min(normalizedScore + escalationBonus, 100);

  return {
    totalScore: finalScore,
    riskLevel: determineRiskLevel(finalScore),
    contributions: contributions as Record<FraudRuleType, number>,
  };
}

/**
 * Generate investigation recommendations based on triggered rules.
 */
export function generateRecommendations(ruleResults: FraudRuleResult[]): string[] {
  const recommendations: string[] = [];
  const triggered = ruleResults.filter((r) => r.triggered);

  if (triggered.length === 0) {
    recommendations.push('No action required — no fraud signals detected');
    return recommendations;
  }

  if (triggered.some((r) => r.ruleType === 'duplicate_leads')) {
    recommendations.push('Review lead submissions for duplicate phone/email entries');
    recommendations.push('Consider implementing duplicate lead detection on submission');
  }
  if (triggered.some((r) => r.ruleType === 'suspicious_commission_growth')) {
    recommendations.push('Audit recent commission calculations and approvals');
    recommendations.push('Verify deal values and conversion details for large payouts');
  }
  if (triggered.some((r) => r.ruleType === 'repeated_withdrawals')) {
    recommendations.push('Review withdrawal frequency and implement cooldown period if needed');
    recommendations.push('Verify bank account details for unusual withdrawal patterns');
  }
  if (triggered.some((r) => r.ruleType === 'settlement_failure_pattern')) {
    recommendations.push('Investigate settlement failures and check commission statuses');
    recommendations.push('Review if failures are technical issues or intentional');
  }
  if (triggered.some((r) => r.ruleType === 'tier_manipulation')) {
    recommendations.push('Audit manual tier override justifications');
    recommendations.push('Consider requiring higher-level approval for manual overrides');
  }
  if (triggered.some((r) => r.ruleType === 'activity_anomaly')) {
    recommendations.push('Review user activity logs for automated or unusual patterns');
  }

  if (triggered.length >= 3) {
    recommendations.push('HIGH PRIORITY: Multiple fraud signals detected — escalate for immediate review');
  }

  return recommendations;
}

// ═══════════════════════════════════════════════════════════
//  FULL EVALUATION — Run all rules for one partner
// ═══════════════════════════════════════════════════════════

/**
 * Evaluate all fraud rules for a single partner.
 * Pure data transformation — no side effects.
 */
export function evaluatePartnerFraud(
  partnerId: string,
  partnerName: string,
  data: {
    leads: any[];
    commissionRecords: any[];
    walletTxns: any[];
    tierHistory: any[];
    auditLogs: any[];
  },
): FraudEvaluation {
  const rules: FraudRuleResult[] = [
    detectDuplicateLeads({ partnerId }, data.leads),
    detectSuspiciousCommissionGrowth({ partnerId }, data.commissionRecords),
    detectRepeatedWithdrawals({ partnerId }, data.walletTxns),
    detectSettlementFailures({ partnerId }, data.walletTxns),
    detectTierManipulation({ partnerId }, data.tierHistory),
    detectActivityAnomalies({ partnerId }, data.auditLogs),
  ];

  const { totalScore, riskLevel, contributions } = calculateRiskScore(rules);
  const triggeredRules = rules.filter((r) => r.triggered);

  return {
    partnerId,
    partnerName,
    riskScore: totalScore,
    riskLevel,
    triggeredRules,
    triggeredCount: triggeredRules.length,
    ruleContributions: contributions,
    recommendations: generateRecommendations(rules),
    evaluatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════
//  SERVICE FUNCTIONS — Firestore and side effects
// ═══════════════════════════════════════════════════════════

/**
 * Run fraud evaluation for all partners.
 * Returns evaluations and persists alerts for threshold breaches.
 */
export async function runFraudEvaluation(): Promise<{
  evaluations: FraudEvaluation[];
  alertsCreated: number;
  errors: string[];
}> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const [partners, leads, commissionRecords, settlements, auditLogs] = await Promise.all([
    getAll<any>(COLLECTIONS.CHANNEL_PARTNERS),
    getAll<any>(COLLECTIONS.LEADS),
    getAll<any>(COLLECTIONS.COMMISSION_RECORDS),
    getAll<any>(COLLECTIONS.SETTLEMENTS),
    getAll<any>(COLLECTIONS.AUDIT_LOGS),
  ]);

  // Fallback: if settlements collection is empty, read from legacy wallet transactions
  let walletTxns = settlements;
  if (walletTxns.length === 0) {
    walletTxns = await getAll<any>(COLLECTIONS.PARTNER_WALLET_TXNS);
  }

  const activePartners = partners.filter((p: any) => !p.isDeleted && (p.status === 'active' || p.status === 'pending_approval'));
  const evaluations: FraudEvaluation[] = [];
  const errors: string[] = [];

  for (const p of activePartners) {
    try {
      const evaluation = evaluatePartnerFraud(
        p.id,
        p.firmName || p.contactPerson || p.id,
        {
          leads,
          commissionRecords,
          walletTxns,
          tierHistory: p.tierHistory || [],
          auditLogs,
        },
      );
      evaluations.push(evaluation);
    } catch (err) {
      errors.push(`Failed to evaluate ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Create alerts for critical and high risk partners
  let alertsCreated = 0;
  for (const ev of evaluations) {
    if (ev.riskLevel === 'critical' || ev.riskLevel === 'high') {
      try {
        await createFraudAlert(ev, companyId);
        alertsCreated++;
      } catch { /* alert creation is best-effort */ }
    }
  }

  // Log the evaluation run
  await logActivity('Fraud Detection', 'Fraud Evaluation Run', 'system', {
    partnersEvaluated: evaluations.length,
    criticalCount: evaluations.filter((e) => e.riskLevel === 'critical').length,
    highCount: evaluations.filter((e) => e.riskLevel === 'high').length,
    alertsCreated,
    errors: errors.length,
    actionLabel: `Fraud evaluation: ${evaluations.length} partners, ${alertsCreated} alerts`,
  });

  return { evaluations, alertsCreated, errors };
}

/**
 * Create a fraud alert for a partner evaluation.
 */
async function createFraudAlert(evaluation: FraudEvaluation, companyId: string): Promise<void> {
  const state = useAppStore.getState();
  const id = genId.generic('FRA');

  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    id,
    companyId,
    entityType: 'fraud_alert',
    partnerId: evaluation.partnerId,
    partnerName: evaluation.partnerName,
    riskScore: evaluation.riskScore,
    riskLevel: evaluation.riskLevel,
    ruleTypes: evaluation.triggeredRules.map((r) => r.ruleType),
    title: `${evaluation.riskLevel === 'critical' ? 'Critical' : 'High'} Risk Alert: ${evaluation.partnerName}`,
    description: `Risk score ${evaluation.riskScore}/100 — ${evaluation.triggeredCount} rule(s) triggered`,
    createdAt: new Date().toISOString(),
    isRead: false,
    isDeleted: false,
  });

  // Notify admins for critical risks
  if (evaluation.riskLevel === 'critical') {
    void notifyRoleUsers(
      ['Admin', 'Director'],
      NotificationType.FRAUD_CRITICAL_RISK,
      'Critical fraud risk detected',
      `${evaluation.partnerName} scored ${evaluation.riskScore}/100 — ${evaluation.triggeredCount} fraud rule(s) triggered. Immediate review required.`,
      'fraud',
      evaluation.partnerId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Create a new investigation for a partner.
 */
export async function createInvestigation(
  evaluation: FraudEvaluation,
  companyId: string,
): Promise<string> {
  const state = useAppStore.getState();
  const id = genId.generic('INV');

  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    id,
    companyId,
    entityType: 'fraud_investigation',
    partnerId: evaluation.partnerId,
    partnerName: evaluation.partnerName,
    riskScore: evaluation.riskScore,
    riskLevel: evaluation.riskLevel,
    triggeredRules: evaluation.triggeredRules,
    status: 'new',
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: state.user?.id || 'system',
    isDeleted: false,
  });

  await logActivity('Fraud Detection', 'Investigation Created', id, {
    partnerId: evaluation.partnerId,
    partnerName: evaluation.partnerName,
    riskScore: evaluation.riskScore,
    riskLevel: evaluation.riskLevel,
    triggeredCount: evaluation.triggeredCount,
    actionLabel: `Fraud investigation created for ${evaluation.partnerName}`,
  });

  void notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.FRAUD_NEW_INVESTIGATION,
    'New fraud investigation',
    `Investigation opened for ${evaluation.partnerName} — Risk score: ${evaluation.riskScore}/100 (${evaluation.riskLevel})`,
    'fraud',
    id,
    companyId,
  ).catch(() => {});

  return id;
}

/**
 * Update an investigation status, assignee, or add notes.
 */
export async function updateInvestigation(
  investigationId: string,
  updates: {
    status?: InvestigationStatus;
    assignedTo?: string;
    assignedToName?: string;
    note?: string;
    noteAuthor?: string;
    noteAuthorName?: string;
    resolution?: string;
  },
): Promise<void> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const existing = await getOne<any>(COLLECTIONS.ENTITIES, investigationId);
  if (!existing) throw new Error(`Investigation ${investigationId} not found`);

  const currentNotes: InvestigationNote[] = existing.notes || [];
  const updatePayload: Record<string, any> = {
    updatedAt: new Date().toISOString(),
    updatedBy: state.user?.id || 'system',
  };

  if (updates.status !== undefined) {
    updatePayload.status = updates.status;
    if (updates.status === 'cleared' || updates.status === 'confirmed') {
      updatePayload.resolvedAt = new Date().toISOString();
      updatePayload.resolvedBy = state.user?.id || 'system';
      updatePayload.resolution = updates.resolution || `Marked as ${updates.status}`;
    }
  }
  if (updates.assignedTo !== undefined) {
    updatePayload.assignedTo = updates.assignedTo;
    updatePayload.assignedToName = updates.assignedToName || '';
  }
  if (updates.note) {
    const note: InvestigationNote = {
      id: genId.generic('NT'),
      text: updates.note,
      createdBy: updates.noteAuthor || state.user?.id || 'system',
      createdByName: updates.noteAuthorName || state.user?.name || 'System',
      createdAt: new Date().toISOString(),
    };
    currentNotes.push(note);
    updatePayload.notes = currentNotes;
  }

  await updateDocById(COLLECTIONS.ENTITIES, investigationId, updatePayload);

  // Audit
  await recordSettlementAudit(
    investigationId,
    'settlement' as 'settlement' | 'withdrawal',
    `investigation_${updates.status || 'updated'}`,
    existing.status || 'new',
    updates.status || 'updated',
    updates.resolution || updates.note || '',
  ).catch(() => {});

  // Notify on status changes
  const actionLabels: Record<string, string> = {
    under_review: 'Under Review',
    escalated: 'Escalated',
    cleared: 'Cleared',
    confirmed: 'Confirmed',
  };
  if (updates.status && actionLabels[updates.status]) {
    void notifyRoleUsers(
      ['Admin', 'Director'],
      updates.status === 'cleared' ? NotificationType.FRAUD_INVESTIGATION_RESOLVED
        : updates.status === 'escalated' ? NotificationType.FRAUD_RISK_ESCALATION
        : NotificationType.FRAUD_STATUS_CHANGE,
      `Investigation ${actionLabels[updates.status]}`,
      `Investigation for ${existing.partnerName} is now ${actionLabels[updates.status]}${updates.resolution ? `. Resolution: ${updates.resolution}` : ''}`,
      'fraud',
      investigationId,
      companyId,
    ).catch(() => {});
  }

  await logActivity('Fraud Detection', 'Investigation Updated', investigationId, {
    status: updates.status,
    assignedTo: updates.assignedTo,
    hasNote: !!updates.note,
    partnerName: existing.partnerName,
    actionLabel: `Fraud investigation updated: ${updates.status || 'note added'}`,
  });
}

/**
 * Load investigations with optional filters.
 * Supports tenant isolation via companyId filter.
 */
export async function loadInvestigations(
  filters?: InvestigationFilters,
): Promise<FraudInvestigation[]> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);

  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const currentCompanyId = resolveWriteCompanyId();

  let list = allEntities
    .filter((e: any) =>
      e.entityType === 'fraud_investigation' &&
      !e.isDeleted &&
      e.companyId === currentCompanyId)
    .map((e: any) => ({
      id: e.id,
      companyId: e.companyId,
      partnerId: e.partnerId,
      partnerName: e.partnerName,
      riskScore: e.riskScore,
      riskLevel: e.riskLevel as FraudRiskLevel,
      triggeredRules: e.triggeredRules || [],
      status: (e.status || 'new') as InvestigationStatus,
      assignedTo: e.assignedTo,
      assignedToName: e.assignedToName,
      notes: e.notes || [],
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      createdBy: e.createdBy,
      resolvedAt: e.resolvedAt,
      resolvedBy: e.resolvedBy,
      resolution: e.resolution,
      isDeleted: e.isDeleted,
    }))
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (filters) {
    if (filters.status) list = list.filter((i: any) => i.status === filters.status);
    if (filters.riskLevel) list = list.filter((i: any) => i.riskLevel === filters.riskLevel);
    if (filters.ruleType) {
      list = list.filter((i: any) =>
        i.triggeredRules?.some((r: any) => r.ruleType === filters.ruleType),
      );
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((i: any) =>
        (i.partnerName || '').toLowerCase().includes(q),
      );
    }
  }

  return list;
}

/**
 * Load fraud alerts.
 * Supports tenant isolation via companyId filter.
 */
export async function loadFraudAlerts(options?: { unreadOnly?: boolean; limit?: number }): Promise<FraudAlert[]> {
  const allEntities = await getAll<any>(COLLECTIONS.ENTITIES);

  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const currentCompanyId = resolveWriteCompanyId();

  let alerts = allEntities
    .filter((e: any) =>
      e.entityType === 'fraud_alert' &&
      !e.isDeleted &&
      e.companyId === currentCompanyId)
    .map((e: any) => ({
      id: e.id,
      partnerId: e.partnerId,
      partnerName: e.partnerName,
      riskScore: e.riskScore,
      riskLevel: e.riskLevel as FraudRiskLevel,
      ruleTypes: e.ruleTypes || [],
      title: e.title,
      description: e.description,
      createdAt: e.createdAt,
      isRead: e.isRead || false,
      investigationId: e.investigationId,
    }))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (options?.unreadOnly) alerts = alerts.filter((a: any) => !a.isRead);
  if (options?.limit) alerts = alerts.slice(0, options.limit);

  return alerts;
}

/**
 * Get fraud summary for dashboard — PURE READ ONLY.
 *
 * Does NOT call runFraudEvaluation().
 * Does NOT create alerts, log activity, or send notifications.
 * Reads existing fraud alerts and investigations from the entities collection.
 * Falls back to partner counts for total evaluated.
 */
export async function getFraudSummary(): Promise<FraudSummary> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const [allEntities, allPartners] = await Promise.all([
    getAll<any>(COLLECTIONS.ENTITIES),
    getAll<any>(COLLECTIONS.CHANNEL_PARTNERS),
  ]);

  const alerts: FraudAlert[] = allEntities
    .filter((e: any) => e.entityType === 'fraud_alert' && !e.isDeleted && e.companyId === companyId)
    .map((e: any) => ({
      id: e.id,
      partnerId: e.partnerId,
      partnerName: e.partnerName,
      riskScore: e.riskScore,
      riskLevel: e.riskLevel as FraudRiskLevel,
      ruleTypes: e.ruleTypes || [],
      title: e.title,
      description: e.description,
      createdAt: e.createdAt,
      isRead: e.isRead || false,
    }))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const investigations: any[] = allEntities
    .filter((e: any) => e.entityType === 'fraud_investigation' && !e.isDeleted && e.companyId === companyId);

  const activePartners = allPartners.filter((p: any) => !p.isDeleted && p.status === 'active');

  const criticalCount = alerts.filter((a) => a.riskLevel === 'critical').length;
  const highCount = alerts.filter((a) => a.riskLevel === 'high').length;
  const mediumCount = alerts.filter((a) => a.riskLevel === 'medium').length;
  const lowCount = alerts.filter((a) => a.riskLevel === 'low').length;

  const totalScore = alerts.reduce((s, a) => s + a.riskScore, 0);
  const averageRiskScore = alerts.length > 0
    ? Math.round(totalScore / alerts.length)
    : 0;

  // Derive top risks from existing alerts (sorted by riskScore descending)
  const topRisks: FraudEvaluation[] = alerts
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5)
    .map((a) => ({
      partnerId: a.partnerId,
      partnerName: a.partnerName,
      riskScore: a.riskScore,
      riskLevel: a.riskLevel,
      triggeredRules: a.ruleTypes.map((t) => ({
        ruleType: t,
        triggered: true,
        riskPoints: 0,
        explanation: '',
        evidence: [],
        severity: 'medium' as FraudRiskLevel,
      })),
      triggeredCount: a.ruleTypes.length,
      ruleContributions: {} as Record<FraudRuleType, number>,
      recommendations: [],
      evaluatedAt: a.createdAt || '',
    }));

  const openInvestigations = investigations.filter((i: any) => !['cleared', 'confirmed'].includes(i.status)).length;
  const resolvedInvestigations = investigations.filter((i: any) => ['cleared', 'confirmed'].includes(i.status)).length;

  return {
    totalEvaluated: activePartners.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    averageRiskScore,
    topRisks,
    openInvestigations,
    resolvedInvestigations,
    recentAlerts: alerts.slice(0, 10),
  };
}

export default {
  // Pure functions
  evaluatePartnerFraud,
  calculateRiskScore,
  determineRiskLevel,
  generateRecommendations,
  detectDuplicateLeads,
  detectSuspiciousCommissionGrowth,
  detectRepeatedWithdrawals,
  detectSettlementFailures,
  detectTierManipulation,
  detectActivityAnomalies,
  // Service functions
  runFraudEvaluation,
  createInvestigation,
  updateInvestigation,
  loadInvestigations,
  loadFraudAlerts,
  getFraudSummary,
};
