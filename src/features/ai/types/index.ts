/**
 * P10-05 — AI Features: Type Definitions
 *
 * Types for lead scoring, demand forecasting, and project anomaly detection.
 * All features are rule-based/statistical — not ML — until sufficient data exists.
 */

// ══════════════════════════════════════════════════════════
//  LEAD SCORING
// ══════════════════════════════════════════════════════════

export type ScoreBand = 'hot' | 'warm' | 'cold';

export interface LeadScoreFactor {
  label: string;
  score: number;
  description: string;
}

export interface LeadScoreResult {
  /** Overall score 0–100 */
  score: number;
  /** Score band */
  band: ScoreBand;
  /** Data quality / confidence indicator */
  confidence: 'high' | 'medium' | 'low';
  /** Breakdown of positive and negative factors */
  factors: LeadScoreFactor[];
  /** Rule/model version identifier */
  modelVersion: string;
  /** Timestamp of evaluation */
  evaluatedAt: string;
}

export interface LeadScoringConfig {
  weights: {
    intent: number;
    completeness: number;
    engagement: number;
    commercialPotential: number;
    urgency: number;
  };
  thresholds: {
    hot: number;
    warm: number;
  };
  version: string;
}

// ══════════════════════════════════════════════════════════
//  DEMAND FORECASTING
// ══════════════════════════════════════════════════════════

export type TrendDirection = 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';

export type ForecastConfidence = 'high' | 'medium' | 'low' | 'insufficient_data';

export interface HistoricalPeriod {
  period: string;       // e.g. "Jul 2026"
  totalQty: number;
  dispatchQty: number;
  poQty: number;
  projectQty: number;
}

export interface DemandForecast {
  productId: string;
  productName: string;
  unit: string;
  /** Forecasted demand for the next period */
  forecastQty: number;
  /** Historical basis used */
  historicalPeriods: HistoricalPeriod[];
  /** Trend direction */
  trend: TrendDirection;
  /** Confidence level */
  confidence: ForecastConfidence;
  /** Risk indicator (0–100) */
  stockoutRisk: number;
  /** Reorder recommendation */
  reorderRecommendation?: {
    recommendedQty: number;
    reason: string;
  };
  /** Explanation of how the forecast was calculated */
  explanation: string;
  /** Forecast period description */
  forecastPeriod: string;
  /** Timestamp */
  generatedAt: string;
  /** Data sufficiency description */
  dataSufficiency: string;
}

export interface DemandForecastConfig {
  /** Number of historical months to analyze */
  lookbackMonths: number;
  /** Minimum historical data months required for confidence > low */
  minDataMonths: number;
  /** Weight for most recent month in weighted moving average */
  recentMonthWeight: number;
  /** Stockout risk threshold for reorder recommendation */
  stockoutRiskThreshold: number;
}

// ══════════════════════════════════════════════════════════
//  PROJECT ANOMALY DETECTION
// ══════════════════════════════════════════════════════════

export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AnomalyType =
  | 'stage_duration_above_historical_norm'
  | 'unexpected_backward_stage_movement'
  | 'repeated_status_changes'
  | 'missing_downstream_activity'
  | 'payment_progress_mismatch'
  | 'unusual_inactivity'
  | 'deadline_risk'
  | 'repeated_failed_qc';

export interface AnomalyEvidence {
  metric: string;
  expected: string;
  observed: string;
}

export interface AnomalyResult {
  id: string;
  projectId: string;
  projectName: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  confidence: ForecastConfidence;
  evidence: AnomalyEvidence[];
  explanation: string;
  recommendedAction: string;
  detectedAt: string;
  detectionVersion: string;
}

export interface AnomalyDetectionSummary {
  totalAnomalies: number;
  bySeverity: Record<AnomalySeverity, number>;
  byType: Record<string, number>;
  anomalies: AnomalyResult[];
  generatedAt: string;
}

// ══════════════════════════════════════════════════════════
//  AI INTELLIGENCE DASHBOARD
// ══════════════════════════════════════════════════════════

export interface AiIntelligenceSummary {
  /** Lead scoring stats */
  leadScoring: {
    totalScored: number;
    hotLeads: number;
    warmLeads: number;
    coldLeads: number;
    avgScore: number;
    evaluatedAt: string;
  };
  /** Demand forecast alerts */
  demandAlerts: Array<{
    productId: string;
    productName: string;
    stockoutRisk: number;
    recommendation: string;
  }>;
  /** Anomaly summary */
  anomalies: AnomalyDetectionSummary;
  /** Generated timestamp */
  generatedAt: string;
  /** Beta notice */
  betaNotice: string;
}
