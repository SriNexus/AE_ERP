import { describe, expect, it } from 'vitest';
import { calculateGstBreakdown, GstCalculationError, getFiscalYearLabel, normalizeGstin, resolvePartyState, getStateCodeFromGstin } from '../gstCalculation';

describe('gstCalculation', () => {
  it('normalizes GSTIN values', () => {
    expect(normalizeGstin(' 27abcde1234f1z5 ')).toBe('27ABCDE1234F1Z5');
    expect(getStateCodeFromGstin('27ABCDE1234F1Z5')).toBe('27');
  });

  it('derives state from GSTIN when present', () => {
    const resolved = resolvePartyState({ gstin: '27ABCDE1234F1Z5' });
    expect(resolved.stateCode).toBe('27');
    expect(resolved.stateName).toBe('Maharashtra');
    expect(resolved.source).toBe('gstin');
  });

  it('calculates same-state CGST + SGST totals', () => {
    const result = calculateGstBreakdown(
      [
        { product: 'Module', qty: 2, price: 100, tax: 18, hsn: '8501' },
        { product: 'Frame', qty: 1, price: 50, tax: 12, hsn: '7610' },
      ],
      { gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' },
      { gstin: '27PQRSX1234A1Z2', state: 'Maharashtra' }
    );

    expect(result.sameState).toBe(true);
    expect(result.placeOfSupply).toBe('Maharashtra');
    expect(result.subtotal).toBe(250);
    expect(result.totalTax).toBe(42);
    expect(result.cgst).toBe(21);
    expect(result.sgst).toBe(21);
    expect(result.igst).toBe(0);
    expect(result.grandTotal).toBe(292);
    expect(result.lines[0]).toMatchObject({ cgst: 18, sgst: 18, igst: 0, totalTax: 36 });
  });

  it('calculates inter-state IGST totals', () => {
    const result = calculateGstBreakdown(
      [
        { product: 'Module', qty: 2, price: 100, tax: 18, hsn: '8501' },
        { product: 'Frame', qty: 1, price: 50, tax: 12, hsn: '7610' },
      ],
      { gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' },
      { gstin: '07PQRSX1234A1Z2', state: 'Delhi' }
    );

    expect(result.sameState).toBe(false);
    expect(result.placeOfSupply).toBe('Delhi');
    expect(result.subtotal).toBe(250);
    expect(result.totalTax).toBe(42);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.igst).toBe(42);
    expect(result.grandTotal).toBe(292);
    expect(result.lines[0]).toMatchObject({ cgst: 0, sgst: 0, igst: 36, totalTax: 36 });
  });

  it('falls back to state names when GSTIN is missing', () => {
    const result = calculateGstBreakdown(
      [{ product: 'Service', qty: 1, price: 1000, tax: 18 }],
      { state: 'Maharashtra' },
      { state: 'Maharashtra' }
    );

    expect(result.sameState).toBe(true);
    expect(result.cgst).toBe(90);
    expect(result.sgst).toBe(90);
  });

  it('falls back to the documented fallback state (with a warning) when GST data cannot resolve a state', () => {
    // resolvePartyState deliberately warns instead of crashing for legacy/
    // demo companies without resolvable GST data — re-pinned to the current
    // documented contract (DEMO_FALLBACK_STATE = Uttar Pradesh), never
    // fabricated data.
    const result = calculateGstBreakdown(
      [{ product: 'Service', qty: 1, price: 1000, tax: 18 }],
      { gstin: 'INVALID' },
      { state: '' }
    );
    expect(result.company.stateName).toBe('Uttar Pradesh');
    expect(result.customer.stateName).toBe('Uttar Pradesh');
    expect(result.placeOfSupply).toBe('Uttar Pradesh');
    expect(result.sameState).toBe(true);
    expect(result.totalTax).toBe(180);
  });

  it('still throws GstCalculationError for genuinely invalid line input', () => {
    expect(() => calculateGstBreakdown(
      [{ product: 'Service', qty: -1, price: 1000, tax: 18 }],
      { state: 'Maharashtra' },
      { state: 'Maharashtra' }
    )).toThrow(GstCalculationError);
  });

  it('keeps fiscal year labels aligned with GST numbering', () => {
    expect(getFiscalYearLabel(new Date('2026-04-01'), '04-01')).toBe('26-27');
    expect(getFiscalYearLabel(new Date('2026-03-31'), '04-01')).toBe('25-26');
  });
});
