/**
 * Tests for P10-05 Demand Forecasting Engine
 *
 * Tests cover: sufficient data, insufficient data, stable/increasing/decreasing demand,
 * zero demand, sparse history, forecast confidence, deterministic output, stockout risk.
 */

import { describe, it, expect } from 'vitest';
import { forecastProductDemand, forecastDemand, getStockoutRisks, DEFAULT_FORECAST_CONFIG } from '../demandForecasting';
import type { ProductDemandInput, DemandDataPoint } from '../demandForecasting';

function buildHistory(months: number, baseQty = 100, trend: 'stable' | 'increasing' | 'decreasing' = 'stable'): DemandDataPoint[] {
  const history: DemandDataPoint[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // i goes from months-1 (oldest) down to 0 (newest)
    // For increasing: oldest has +0*10, newest has +(months-1)*10
    // For decreasing: oldest has -0*10, newest has -(months-1)*10
    const position = months - 1 - i;
    let qty = baseQty;
    if (trend === 'increasing') qty += position * 10;
    if (trend === 'decreasing') qty -= position * 10;
    history.push({ period, qty: Math.max(1, qty) });
  }
  return history;
}

function makeInput(overrides: Partial<ProductDemandInput> = {}): ProductDemandInput {
  return {
    productId: 'prod-1',
    productName: 'Solar Panel 500W',
    unit: 'PCS',
    monthlyHistory: buildHistory(6, 100, 'stable'),
    currentStock: 200,
    lowStockThreshold: 50,
    ...overrides,
  };
}

describe('Demand Forecasting — Sufficient historical data', () => {
  it('should provide a forecast with medium or high confidence for ≥3 months data', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.confidence).toBe('high'); // 6 >= 3*2
    expect(result.forecastQty).toBeGreaterThan(0);
  });

  it('should detect stable demand', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.trend).toBe('stable');
  });

  it('should detect increasing demand', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'increasing') });
    const result = forecastProductDemand(input);
    expect(result.trend).toBe('increasing');
  });

  it('should detect decreasing demand', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'decreasing') });
    const result = forecastProductDemand(input);
    expect(result.trend).toBe('decreasing');
  });

  it('should calculate meaningful stockout risk when stock is low', () => {
    const input = makeInput({ currentStock: 50, monthlyHistory: buildHistory(6, 200, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.stockoutRisk).toBeGreaterThan(60);
  });

  it('should calculate low stockout risk when stock is sufficient', () => {
    const input = makeInput({ currentStock: 2000, monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.stockoutRisk).toBeLessThan(30);
  });

  it('should provide a reorder recommendation when stockout risk exceeds threshold', () => {
    const input = makeInput({ currentStock: 50, monthlyHistory: buildHistory(6, 200, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.reorderRecommendation).toBeDefined();
    expect(result.reorderRecommendation!.recommendedQty).toBeGreaterThan(0);
    expect(result.reorderRecommendation!.reason).toBeTruthy();
  });
});

describe('Demand Forecasting — Insufficient data', () => {
  it('should mark confidence as insufficient_data when no history exists', () => {
    const input = makeInput({ monthlyHistory: [] });
    const result = forecastProductDemand(input);
    expect(result.confidence).toBe('insufficient_data');
    expect(result.forecastQty).toBe(0);
    expect(result.dataSufficiency).toContain('Insufficient');
  });

  it('should mark confidence as low when only 1 month of data exists', () => {
    const input = makeInput({ monthlyHistory: buildHistory(1, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.confidence).toBe('low');
  });

  it('should mark confidence as medium when between min and 2x min months', () => {
    const input = makeInput({ monthlyHistory: buildHistory(4, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.confidence).toBe('medium');
  });

  it('should provide a forecast even with minimal data', () => {
    const input = makeInput({ monthlyHistory: buildHistory(1, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.forecastQty).toBeGreaterThan(0);
    expect(result.dataSufficiency).toContain('Insufficient');
  });

  it('should set trend to insufficient_data with less than 2 months', () => {
    const input = makeInput({ monthlyHistory: buildHistory(1, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.trend).toBe('insufficient_data');
  });
});

describe('Demand Forecasting — Zero demand', () => {
  it('should handle zero demand across all periods', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 0, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.forecastQty).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.stockoutRisk)).toBe(true);
  });

  it('should not provide reorder recommendation for zero demand', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 0, 'stable'), currentStock: 10 });
    const result = forecastProductDemand(input);
    expect(result.reorderRecommendation).toBeUndefined();
  });
});

describe('Demand Forecasting — Sparse history', () => {
  it('should handle sparse history with gaps', () => {
    const input = makeInput({
      monthlyHistory: [
        { period: '2026-01', qty: 50 },
        { period: '2026-03', qty: 60 },
        { period: '2026-05', qty: 55 },
      ],
    });
    const result = forecastProductDemand(input);
    expect(result.forecastQty).toBeGreaterThan(0);
    expect(Number.isFinite(result.forecastQty)).toBe(true);
  });

  it('should handle single large demand spike', () => {
    const input = makeInput({
      monthlyHistory: [
        { period: '2026-01', qty: 5 },
        { period: '2026-02', qty: 200 },
        { period: '2026-03', qty: 8 },
      ],
    });
    const result = forecastProductDemand(input);
    expect(result.forecastQty).toBeGreaterThan(0);
  });
});

describe('Demand Forecasting — Deterministic output', () => {
  it('should produce the same forecast for the same input', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result1 = forecastProductDemand(input);
    const result2 = forecastProductDemand(input);
    expect(result1.forecastQty).toBe(result2.forecastQty);
    expect(result1.trend).toBe(result2.trend);
    expect(result1.confidence).toBe(result2.confidence);
    expect(result1.stockoutRisk).toBe(result2.stockoutRisk);
  });
});

describe('Demand Forecasting — Forecast explanation', () => {
  it('should provide an explanation', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.explanation.length).toBeGreaterThan(20);
    expect(result.explanation).toContain('statistical');
  });

  it('should include forecast period', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.forecastPeriod).toBeTruthy();
  });

  it('should include generatedAt timestamp', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.generatedAt).toBeTruthy();
    expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
  });

  it('should include data sufficiency description', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(result.dataSufficiency).toBeTruthy();
  });
});

describe('Demand Forecasting — Pipeline adjustment', () => {
  it('should adjust forecast for pipeline demand', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable'), pipelineQty: 50 });
    const result = forecastProductDemand(input);
    expect(result.forecastQty).toBeGreaterThan(100); // base ~100 + 50 pipeline
  });

  it('should mention pipeline adjustment in explanation', () => {
    const input = makeInput({ monthlyHistory: buildHistory(6, 100, 'stable'), pipelineQty: 50 });
    const result = forecastProductDemand(input);
    expect(result.explanation).toContain('Pipeline');
  });
});

describe('Demand Forecasting — forecastDemand (batch)', () => {
  it('should forecast multiple products', () => {
    const products = [
      makeInput({ productId: 'p1', productName: 'Panel A', monthlyHistory: buildHistory(6, 100, 'stable') }),
      makeInput({ productId: 'p2', productName: 'Panel B', monthlyHistory: buildHistory(3, 50, 'increasing') }),
    ];
    const results = forecastDemand(products);
    expect(results).toHaveLength(2);
    expect(Number.isFinite(results[0].forecastQty)).toBe(true);
    expect(Number.isFinite(results[1].forecastQty)).toBe(true);
  });

  it('should return empty array for empty input', () => {
    const results = forecastDemand([]);
    expect(results).toHaveLength(0);
  });
});

describe('Demand Forecasting — getStockoutRisks', () => {
  it('should return products above threshold sorted by risk', () => {
    const forecasts = [
      { productId: 'p1', productName: 'P1', unit: 'PCS', forecastQty: 100, historicalPeriods: [], trend: 'stable' as const, confidence: 'medium' as const, stockoutRisk: 80, explanation: 'test', forecastPeriod: 'Aug 2026', generatedAt: '', dataSufficiency: 'Sufficient' },
      { productId: 'p2', productName: 'P2', unit: 'PCS', forecastQty: 100, historicalPeriods: [], trend: 'stable' as const, confidence: 'high' as const, stockoutRisk: 20, explanation: 'test', forecastPeriod: 'Aug 2026', generatedAt: '', dataSufficiency: 'Sufficient' },
      { productId: 'p3', productName: 'P3', unit: 'PCS', forecastQty: 100, historicalPeriods: [], trend: 'stable' as const, confidence: 'high' as const, stockoutRisk: 90, explanation: 'test', forecastPeriod: 'Aug 2026', generatedAt: '', dataSufficiency: 'Sufficient' },
    ];
    const risks = getStockoutRisks(forecasts as any, 60);
    expect(risks).toHaveLength(2); // p1 (80) and p3 (90)
    expect(risks[0].stockoutRisk).toBeGreaterThanOrEqual(risks[1].stockoutRisk); // sorted descending
  });

  it('should return empty array when no products exceed threshold', () => {
    const forecasts = [{
      productId: 'p1', productName: 'P1', unit: 'PCS', forecastQty: 100,
      historicalPeriods: [], trend: 'stable' as const, confidence: 'high' as const,
      stockoutRisk: 10, explanation: 'ok', forecastPeriod: 'Aug 2026',
      generatedAt: '', dataSufficiency: 'Sufficient',
    }];
    const risks = getStockoutRisks(forecasts as any, 60);
    expect(risks).toHaveLength(0);
  });
});

describe('Demand Forecasting — Edge cases', () => {
  it('should handle negative stock values', () => {
    const input = makeInput({ currentStock: -10, monthlyHistory: buildHistory(6, 100, 'stable') });
    const result = forecastProductDemand(input);
    expect(Number.isFinite(result.stockoutRisk)).toBe(true);
  });

  it('should handle undefined current stock', () => {
    const input = makeInput({ currentStock: undefined });
    const result = forecastProductDemand(input);
    expect(result.stockoutRisk).toBe(0);
    expect(result.reorderRecommendation).toBeUndefined();
  });

  it('should handle undefined low stock threshold', () => {
    const input = makeInput({ lowStockThreshold: undefined, currentStock: 10, monthlyHistory: buildHistory(6, 200, 'stable') });
    const result = forecastProductDemand(input);
    expect(Number.isFinite(result.stockoutRisk)).toBe(true);
  });
});
