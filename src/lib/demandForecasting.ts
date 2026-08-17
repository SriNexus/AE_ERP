/**
 * P10-05 — Demand Forecasting Engine
 *
 * Statistical demand forecasting using historical ERP data.
 * Uses simple and weighted moving averages with trend detection.
 *
 * Pure functions — no Firestore, no React, no side effects.
 *
 * BETA — Statistical estimates, not ML predictions.
 * "Insufficient data" warnings shown when historical data is sparse.
 */

import { daysBetween, safeNumber } from './analyticsCore';
import type {
  DemandForecast,
  HistoricalPeriod,
  TrendDirection,
  ForecastConfidence,
  DemandForecastConfig,
} from '../features/ai/types';

// ══════════════════════════════════════════════════════════
//  DEFAULT CONFIG
// ══════════════════════════════════════════════════════════

export const DEFAULT_FORECAST_CONFIG: DemandForecastConfig = {
  lookbackMonths: 6,
  minDataMonths: 3,
  recentMonthWeight: 0.4,
  stockoutRiskThreshold: 60,
};

// ══════════════════════════════════════════════════════════
//  INPUT TYPES
// ══════════════════════════════════════════════════════════

export interface DemandDataPoint {
  /** Period key (e.g. "2026-01") */
  period: string;
  /** Quantity consumed/dispatched in this period */
  qty: number;
}

export interface ProductDemandInput {
  productId: string;
  productName: string;
  unit: string;
  /** Monthly demand history (at least 1 month required) */
  monthlyHistory: DemandDataPoint[];
  /** Current stock level (if available) */
  currentStock?: number;
  /** Low stock threshold (if configured) */
  lowStockThreshold?: number;
  /** Upcoming project demand (known pipeline) */
  pipelineQty?: number;
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════

function parsePeriod(period: string): Date {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function periodLabel(period: string): string {
  const date = parsePeriod(period);
  return date.toLocaleString('default', { month: 'short', year: 'numeric' });
}

function isIncreasing(values: number[]): boolean {
  if (values.length < 3) return false;
  // Check if the second half is generally higher than the first half
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalf = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
  return secondHalf > firstHalf * 1.1; // 10% threshold
}

function isDecreasing(values: number[]): boolean {
  if (values.length < 3) return false;
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalf = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
  return secondHalf < firstHalf * 0.9; // 10% threshold
}

function computeSimpleMovingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeWeightedMovingAverage(values: number[], recentWeight: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const weights = values.map((_, i) => {
    // Most recent gets 'recentWeight', oldest gets (1 - recentWeight) distributed
    const position = i / (values.length - 1);
    return recentWeight * position + (1 - recentWeight) * (1 - position);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, val, i) => sum + val * weights[i], 0) / totalWeight;
}

// ══════════════════════════════════════════════════════════
//  HISTORICAL PERIOD BUILDER
// ══════════════════════════════════════════════════════════

function buildHistoricalPeriods(
  monthlyHistory: DemandDataPoint[],
  dispatchHistory: DemandDataPoint[],
  poHistory: DemandDataPoint[],
  projectHistory: DemandDataPoint[],
): HistoricalPeriod[] {
  // Merge all data by period
  const periodMap = new Map<string, { totalQty: number; dispatchQty: number; poQty: number; projectQty: number }>();

  monthlyHistory.forEach((dp) => {
    const entry = periodMap.get(dp.period) || { totalQty: 0, dispatchQty: 0, poQty: 0, projectQty: 0 };
    entry.totalQty += dp.qty;
    periodMap.set(dp.period, entry);
  });
  dispatchHistory.forEach((dp) => {
    const entry = periodMap.get(dp.period) || { totalQty: 0, dispatchQty: 0, poQty: 0, projectQty: 0 };
    entry.dispatchQty += dp.qty;
    periodMap.set(dp.period, entry);
  });
  poHistory.forEach((dp) => {
    const entry = periodMap.get(dp.period) || { totalQty: 0, dispatchQty: 0, poQty: 0, projectQty: 0 };
    entry.poQty += dp.qty;
    periodMap.set(dp.period, entry);
  });
  projectHistory.forEach((dp) => {
    const entry = periodMap.get(dp.period) || { totalQty: 0, dispatchQty: 0, poQty: 0, projectQty: 0 };
    entry.projectQty += dp.qty;
    periodMap.set(dp.period, entry);
  });

  return Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period: periodLabel(period),
      ...data,
    }));
}

// ══════════════════════════════════════════════════════════
//  MAIN FORECAST FUNCTION
// ══════════════════════════════════════════════════════════

/**
 * Forecast demand for a single product using historical data.
 * Pure function — no side effects.
 *
 * BETA — Statistical estimate. Not ML.
 */
export function forecastProductDemand(
  input: ProductDemandInput,
  config: DemandForecastConfig = DEFAULT_FORECAST_CONFIG,
): DemandForecast {
  const { monthlyHistory, productId, productName, unit, currentStock, lowStockThreshold, pipelineQty } = input;
  const months = monthlyHistory.length;
  const lookback = Math.min(months, config.lookbackMonths);
  const recent = monthlyHistory.slice(-lookback);
  const quantities = recent.map((dp) => dp.qty);

  // Determine data sufficiency
  const dataSufficiency = months >= config.minDataMonths ? 'sufficient' : 'insufficient';

  // Trend direction
  let trend: TrendDirection;
  if (months < 2) {
    trend = 'insufficient_data';
  } else if (isIncreasing(quantities)) {
    trend = 'increasing';
  } else if (isDecreasing(quantities)) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  // Confidence
  let confidence: ForecastConfidence;
  if (months >= config.minDataMonths * 2) {
    confidence = 'high';
  } else if (months >= config.minDataMonths) {
    confidence = 'medium';
  } else if (months >= 1) {
    confidence = 'low';
  } else {
    confidence = 'insufficient_data';
  }

  // Forecast using weighted moving average
  const forecast = months >= 1
    ? Math.round(computeWeightedMovingAverage(quantities, config.recentMonthWeight))
    : 0;

  // Adjust for pipeline demand
  const pipelineAdjustment = safeNumber(pipelineQty);
  const adjustedForecast = forecast + pipelineAdjustment;

  // Stockout risk (0–100)
  let stockoutRisk = 0;
  if (currentStock !== undefined && currentStock >= 0 && adjustedForecast > 0) {
    const coverageMonths = currentStock / adjustedForecast;
    if (coverageMonths <= 1) {
      stockoutRisk = 90; // Critical
    } else if (coverageMonths <= 2) {
      stockoutRisk = 60; // High
    } else if (coverageMonths <= 3) {
      stockoutRisk = 30; // Medium
    } else {
      stockoutRisk = 10; // Low
    }
  }

  // Reorder recommendation
  let reorderRecommendation: { recommendedQty: number; reason: string } | undefined;
  if (stockoutRisk >= config.stockoutRiskThreshold && adjustedForecast > 0) {
    const recommendedQty = lowStockThreshold
      ? Math.max(adjustedForecast * 2, lowStockThreshold * 2)
      : adjustedForecast * 2;
    reorderRecommendation = {
      recommendedQty: Math.round(recommendedQty),
      reason: stockoutRisk >= 80
        ? `Critical stockout risk (${stockoutRisk}/100). Current stock covers <1 month of forecasted demand.`
        : `High stockout risk (${stockoutRisk}/100). Consider reordering ${Math.round(recommendedQty)} units to maintain ${Math.round(adjustedForecast > 0 ? (currentStock || 0) / adjustedForecast : 0)} months of coverage.`,
    };
  }

  // Build historical periods
  const historicalPeriods = buildHistoricalPeriods(
    monthlyHistory.slice(-lookback),
    [], // dispatch history (could be added)
    [], // PO history (could be added)
    [], // project history (could be added)
  );

  // Build explanation
  const explanation = buildForecastExplanation(trend, months, forecast, adjustedForecast, pipelineQty, quantities, config);

  // Next period label
  const lastPeriod = monthlyHistory.length > 0 ? monthlyHistory[monthlyHistory.length - 1].period : '';
  const nextDate = lastPeriod ? parsePeriod(lastPeriod) : new Date();
  nextDate.setMonth(nextDate.getMonth() + 1);
  const forecastPeriod = nextDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return {
    productId,
    productName,
    unit,
    forecastQty: adjustedForecast,
    historicalPeriods,
    trend,
    confidence,
    stockoutRisk,
    reorderRecommendation,
    explanation,
    forecastPeriod,
    generatedAt: new Date().toISOString(),
    dataSufficiency: dataSufficiency === 'sufficient'
      ? `Based on ${months} months of historical data`
      : `Insufficient data: only ${months} month(s) available (minimum ${config.minDataMonths} required for reliable forecast)`,
  };
}

function buildForecastExplanation(
  trend: TrendDirection,
  months: number,
  rawForecast: number,
  adjustedForecast: number,
  pipelineQty: number | undefined,
  quantities: number[],
  config: DemandForecastConfig,
): string {
  const parts: string[] = [];
  parts.push(`Forecast calculated using weighted moving average over ${months} month(s).`);

  if (quantities.length > 0) {
    parts.push(`Historical average: ${Math.round(computeSimpleMovingAverage(quantities))} units/month.`);
  }

  if (trend === 'increasing') parts.push('Trend: Increasing demand detected.');
  else if (trend === 'decreasing') parts.push('Trend: Decreasing demand detected.');
  else if (trend === 'stable') parts.push('Trend: Demand is stable.');
  else parts.push('Trend: Insufficient data to determine trend.');

  if (pipelineQty && pipelineQty > 0) {
    parts.push(`Pipeline adjustment: +${pipelineQty} units from known upcoming projects.`);
  }

  parts.push(`This is a statistical estimate — not an ML prediction.`);

  return parts.join(' ');
}

/**
 * Forecast demand for multiple products.
 */
export function forecastDemand(
  products: ProductDemandInput[],
  config?: DemandForecastConfig,
): DemandForecast[] {
  return products.map((p) => forecastProductDemand(p, config));
}

/**
 * Get products at risk of stockout.
 */
export function getStockoutRisks(
  forecasts: DemandForecast[],
  threshold = DEFAULT_FORECAST_CONFIG.stockoutRiskThreshold,
): DemandForecast[] {
  return forecasts
    .filter((f) => f.stockoutRisk >= threshold && f.confidence !== 'insufficient_data')
    .sort((a, b) => b.stockoutRisk - a.stockoutRisk);
}
