/**
 * Fraud Detection — Domain Types
 *
 * Central type definitions for the Fraud Detection & Risk Analytics module.
 * Feature-specific types live here; global types live in src/types/index.ts.
 */

// ── Risk Levels ────────────────────────────────────────────

export type FraudRiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ── Investigation Statuses ─────────────────────────────────

export type InvestigationStatus =
  | 'new'
  | 'under_review'
  | 'escalated'
  | 'cleared'
  | 'confirmed';

// ── Fraud Rule Identifiers ─────────────────────────────────

export type FraudRuleType =
  | 'duplicate_leads'
  | 'suspicious_commission_growth'
  | 'repeated_withdrawals'
  | 'settlement_failure_pattern'
  | 'tier_manipulation'
  | 'activity_anomaly';

// ── Rule Weights (centralized) ─────────────────────────────

export const FRAUD_RULE_WEIGHTS: Record<FraudRuleType, number> = {
  duplicate_leads: 25,
  suspicious_commission_growth: 20,
  repeated_withdrawals: 20,
  settlement_failure_pattern: 15,
  tier_manipulation: 10,
  activity_anomaly: 10,
};

export const FRAUD_RULE_LABELS: Record<FraudRuleType, string> = {
  duplicate_leads: 'Duplicate Lead Detection',
  suspicious_commission_growth: 'Suspicious Commission Growth',
  repeated_withdrawals: 'Repeated Withdrawal Requests',
  settlement_failure_pattern: 'Settlement Failure Pattern',
  tier_manipulation: 'Tier Manipulation Signals',
  activity_anomaly: 'Activity Pattern Monitoring',
};

// ── Individual Rule Result ─────────────────────────────────

export interface FraudRuleResult {
  ruleType: FraudRuleType;
  triggered: boolean;
  riskPoints: number;
  /** Human-readable explanation */
  explanation: string;
  /** Evidence details supporting the trigger */
  evidence: string[];
  severity: FraudRiskLevel;
}

// ── Complete Evaluation for One Partner ────────────────────

export interface FraudEvaluation {
  partnerId: string;
  partnerName: string;
  /** Overall risk score 0–100 */
  riskScore: number;
  riskLevel: FraudRiskLevel;
  triggeredRules: FraudRuleResult[];
  /** Number of rules that triggered */
  triggeredCount: number;
  /** Weighted rule contribution breakdown */
  ruleContributions: Record<FraudRuleType, number>;
  /** Investigation recommendations */
  recommendations: string[];
  /** When this evaluation was performed */
  evaluatedAt: string;
}

// ── Dashboard-Level Summary ────────────────────────────────

export interface FraudSummary {
  totalEvaluated: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  averageRiskScore: number;
  topRisks: FraudEvaluation[];
  openInvestigations: number;
  resolvedInvestigations: number;
  recentAlerts: FraudAlert[];
}

// ── Fraud Alert ────────────────────────────────────────────

export interface FraudAlert {
  id: string;
  partnerId: string;
  partnerName: string;
  riskScore: number;
  riskLevel: FraudRiskLevel;
  ruleTypes: FraudRuleType[];
  title: string;
  description: string;
  createdAt: string;
  isRead: boolean;
  investigationId?: string;
}

// ── Investigation Record ───────────────────────────────────

export interface FraudInvestigation {
  id: string;
  companyId: string;
  partnerId: string;
  partnerName: string;
  riskScore: number;
  riskLevel: FraudRiskLevel;
  triggeredRules: FraudRuleResult[];
  status: InvestigationStatus;
  assignedTo?: string;
  assignedToName?: string;
  notes: InvestigationNote[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
  isDeleted?: boolean;
}

export interface InvestigationNote {
  id: string;
  text: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

// ── Investigation Filters ──────────────────────────────────

export interface InvestigationFilters {
  status?: InvestigationStatus;
  riskLevel?: FraudRiskLevel;
  ruleType?: FraudRuleType;
  search?: string;
  dateRange?: string;
}
