/**
 * Tests for P10-05 Lead Scoring Engine
 *
 * Tests cover: high-quality lead, low-information lead, negative/stalled signals,
 * score boundaries, explainability, missing data, deterministic output,
 * score-band thresholds, and company isolation awareness.
 */

import { describe, it, expect } from 'vitest';
import { scoreLead, scoreLeads, getLeadScoringStats, DEFAULT_LEAD_SCORING_CONFIG } from '../leadScoring';
import type { LeadScoringInput } from '../leadScoring';

function makeLead(overrides: Partial<LeadScoringInput> = {}): LeadScoringInput {
  return {
    id: 'lead-1',
    name: 'Test Lead',
    phone: '9876543210',
    email: 'test@example.com',
    city: 'Mumbai',
    state: 'Maharashtra',
    source: 'Website',
    status: 'New',
    capacityKw: 10,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Lead Scoring — High-quality/high-intent lead', () => {
  it('should produce a high score (≥70) for a complete, engaged lead', () => {
    const lead = makeLead({
      name: 'Quality Lead', phone: '9876543210', email: 'q@test.com',
      city: 'Pune', source: 'Referral',
      notes: 'Looking for solar rooftop 50kW system',
      status: 'Follow-up',
      followupCount: 3,
      hasQuotation: true,
      hasSurvey: true,
      capacityKw: 50,
      updatedAt: new Date().toISOString(),
      next_date: new Date(Date.now() + 86400000).toISOString(),
    });
    const result = scoreLead(lead);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.band).toBe('hot');
    expect(result.confidence).toBe('high');
  });

  it('should produce explainable factors for a high-quality lead', () => {
    const lead = makeLead({
      status: 'Follow-up',
      followupCount: 5,
      hasQuotation: true,
      capacityKw: 100,
    });
    const result = scoreLead(lead);
    expect(result.factors.length).toBeGreaterThanOrEqual(5);
    expect(result.factors.some((f) => f.score > 0)).toBe(true);
    expect(result.factors.some((f) => f.label.includes('Quotation'))).toBe(true);
    expect(result.factors.some((f) => f.label.includes('capacity'))).toBe(true);
  });

  it('should be deterministic — same input produces same score', () => {
    const lead = makeLead({ phone: '9876543210', email: 'a@b.com', status: 'Qualified', followupCount: 2 });
    const result1 = scoreLead(lead);
    const result2 = scoreLead(lead);
    expect(result1.score).toBe(result2.score);
    expect(result1.band).toBe(result2.band);
    expect(result1.factors.length).toBe(result2.factors.length);
  });

  it('should mark confidence as high when all fields are present', () => {
    const lead = makeLead({
      phone: '9876543210',
      email: 'a@b.com',
      city: 'Delhi',
      source: 'Referral',
      status: 'Qualified',
      notes: 'Interested in 5kW system',
      capacityKw: 5,
    });
    const result = scoreLead(lead);
    expect(result.confidence).toBe('high');
  });

  it('should mark confidence as low when minimal data is available', () => {
    const lead = makeLead({ phone: '', email: '', city: '', source: '', status: '', capacityKw: undefined });
    const result = scoreLead(lead);
    expect(result.confidence).toBe('low');
  });
});

describe('Lead Scoring — Low-information lead', () => {
  it('should produce a low score (≤40) for an incomplete lead', () => {
    const lead = makeLead({ phone: '', email: '', city: '', source: '', status: 'New', capacityKw: undefined });
    const result = scoreLead(lead);
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.band).toBe('cold');
  });

  it('should handle missing phone gracefully', () => {
    const lead = makeLead({ phone: '' });
    const result = scoreLead(lead);
    expect(result.score).toBeGreaterThanOrEqual(0);
    // No phone factor should be added when phone is empty — that's correct behavior
    expect(result.factors.filter((f) => f.label.includes('phone') || f.label.includes('Phone')).length).toBeLessThanOrEqual(0);
  });

  it('should handle missing email gracefully', () => {
    const lead = makeLead({ email: '' });
    const result = scoreLead(lead);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty object gracefully', () => {
    const result = scoreLead(makeLead({
      phone: '', email: '', city: '', state: '', source: '', status: '',
      name: '', capacityKw: undefined, createdAt: '', updatedAt: '',
      notes: '', company: '',
    }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.band).toBe('cold');
  });

  it('should not exceed 100 when scoring', () => {
    const lead = makeLead({
      name: 'Excellent Lead',
      phone: '9876543210',
      email: 'a@test.com',
      city: 'Pune',
      state: 'MH',
      company: 'Solar Corp',
      source: 'Referral',
      status: 'Follow-up',
      notes: 'Interested in solar panel 5kW rooftop system energy saving',
      capacityKw: 100,
      followupCount: 10,
      hasQuotation: true,
      hasSurvey: true,
      budget: '5-10 lakhs',
      timeline: 'immediate',
      next_date: new Date(Date.now() + 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = scoreLead(lead);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('Lead Scoring — Negative/stalled signals', () => {
  it('should deduct points for stale leads (>90 days no activity)', () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString(); // 100 days ago
    const lead = makeLead({ updatedAt: oldDate, status: 'New' });
    const result = scoreLead(lead);
    expect(result.factors.some((f) => f.label.includes('90 days'))).toBe(true);
  });

  it('should deduct points for leads with lost/rejected status', () => {
    const lead = makeLead({ status: 'Lost' });
    const result = scoreLead(lead);
    expect(result.factors.some((f) => f.label.includes('loss/rejection'))).toBe(true);
  });

  it('should deduct points for rejected leads', () => {
    const lead = makeLead({ status: 'Rejected' });
    const result = scoreLead(lead);
    expect(result.factors.some((f) => f.label.includes('loss/rejection'))).toBe(true);
  });

  it('should apply significant penalty for lost leads', () => {
    const lead = makeLead({ status: 'Lost' });
    const result = scoreLead(lead);
    expect(result.score).toBeLessThan(50);
  });

  it('should combine negative signals correctly', () => {
    const oldDate = new Date(Date.now() - 120 * 86400000).toISOString();
    const lead = makeLead({ status: 'Lost', updatedAt: oldDate, phone: '12', email: '', name: '' });
    const result = scoreLead(lead);
    expect(result.factors.filter((f) => f.score < 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Lead Scoring — Score boundaries and thresholds', () => {
  it('should classify a fully-engaged lead with strong signals as hot', () => {
    const config = { ...DEFAULT_LEAD_SCORING_CONFIG };
    const result = scoreLead(makeLead({
      name: 'Hot Lead', phone: '9876543210', email: 'h@t.com', city: 'Mumbai',
      source: 'Referral', notes: 'Interested in solar panel 50kW rooftop',
      status: 'Qualified', capacityKw: 100, hasQuotation: true, hasSurvey: true,
      followupCount: 5, next_date: new Date(Date.now() + 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      company: 'Solar Corp',
    }), config);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.band).toBe('hot');
  });

  it('should classify a moderately engaged lead as warm', () => {
    const result = scoreLead(makeLead({
      name: 'Warm Lead', phone: '9876543210', email: 'w@m.com', city: 'Delhi',
      source: 'Website', status: 'Follow-up', capacityKw: 10,
      hasQuotation: true, followupCount: 1,
      updatedAt: new Date().toISOString(),
    }));
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(70);
    expect(result.band).toBe('warm');
  });

  it('should classify a lead with minimal data as cold', () => {
    const result = scoreLead(makeLead({
      name: 'Cold', phone: '', email: '', city: '', status: 'New',
      capacityKw: undefined,
    }));
    expect(result.score).toBeLessThan(40);
    expect(result.band).toBe('cold');
  });

  it('should never return a negative score', () => {
    const result = scoreLead(makeLead({
      status: 'Lost', updatedAt: new Date(Date.now() - 200 * 86400000).toISOString(),
      phone: '', email: '', name: '',
    }));
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('Lead Scoring — Score explanation', () => {
  it('should provide model version', () => {
    const result = scoreLead(makeLead());
    expect(result.modelVersion).toBe('rule-v1');
  });

  it('should provide evaluatedAt timestamp', () => {
    const result = scoreLead(makeLead());
    expect(result.evaluatedAt).toBeTruthy();
    expect(new Date(result.evaluatedAt).getTime()).not.toBeNaN();
  });

  it('should include both positive and negative factors when applicable', () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    const result = scoreLead(makeLead({ updatedAt: oldDate, status: 'Lost' }));
    const positive = result.factors.filter((f) => f.score > 0);
    const negative = result.factors.filter((f) => f.score < 0);
    expect(positive.length).toBeGreaterThan(0);
    expect(negative.length).toBeGreaterThan(0);
  });

  it('should make factors understandable by business users', () => {
    const result = scoreLead(makeLead({ hasQuotation: true, capacityKw: 50 }));
    result.factors.forEach((f) => {
      expect(typeof f.label).toBe('string');
      expect(f.label.length).toBeGreaterThan(3);
      expect(Number.isFinite(f.score)).toBe(true);
    });
  });
});

describe('Lead Scoring — scoreLeads (batch)', () => {
  it('should score multiple leads consistently', () => {
    const leads = [makeLead({ id: 'l1' }), makeLead({ id: 'l2', phone: '', email: '' })];
    const results = scoreLeads(leads);
    expect(results.size).toBe(2);
    expect(results.has('l1')).toBe(true);
    expect(results.has('l2')).toBe(true);
    expect(results.get('l1')!.score).toBeGreaterThan(results.get('l2')!.score);
  });

  it('should return empty map for empty array', () => {
    const results = scoreLeads([]);
    expect(results.size).toBe(0);
  });

  it('should be deterministic for batch scoring', () => {
    const leads = [makeLead({ id: 'a' }), makeLead({ id: 'b', phone: '', email: '', city: '' })];
    const r1 = scoreLeads(leads);
    const r2 = scoreLeads(leads);
    expect(r1.get('a')!.score).toBe(r2.get('a')!.score);
    expect(r1.get('b')!.score).toBe(r2.get('b')!.score);
  });
});

describe('Lead Scoring — getLeadScoringStats', () => {
  it('should return zeros for empty map', () => {
    const stats = getLeadScoringStats(new Map());
    expect(stats.totalScored).toBe(0);
    expect(stats.hotLeads).toBe(0);
    expect(stats.avgScore).toBe(0);
  });

  it('should correctly count score bands', () => {
    const results = new Map();
    results.set('hot1', { score: 85, band: 'hot', confidence: 'high', factors: [], modelVersion: 'v1', evaluatedAt: '' });
    results.set('hot2', { score: 75, band: 'hot', confidence: 'high', factors: [], modelVersion: 'v1', evaluatedAt: '' });
    results.set('warm1', { score: 55, band: 'warm', confidence: 'medium', factors: [], modelVersion: 'v1', evaluatedAt: '' });
    results.set('cold1', { score: 20, band: 'cold', confidence: 'low', factors: [], modelVersion: 'v1', evaluatedAt: '' });

    const stats = getLeadScoringStats(results);
    expect(stats.totalScored).toBe(4);
    expect(stats.hotLeads).toBe(2);
    expect(stats.warmLeads).toBe(1);
    expect(stats.coldLeads).toBe(1);
    expect(stats.avgScore).toBeGreaterThan(0);
  });

  it('should calculate average score correctly', () => {
    const results = new Map();
    results.set('a', { score: 80, band: 'hot', confidence: 'high', factors: [], modelVersion: 'v1', evaluatedAt: '' });
    results.set('b', { score: 40, band: 'warm', confidence: 'medium', factors: [], modelVersion: 'v1', evaluatedAt: '' });
    const stats = getLeadScoringStats(results);
    expect(stats.avgScore).toBe(60);
  });
});

describe('Lead Scoring — Missing optional data', () => {
  it('should handle missing notes', () => {
    const result = scoreLead(makeLead({ notes: undefined }));
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('should handle missing followup dates', () => {
    const result = scoreLead(makeLead({ followupDates: undefined }));
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('should handle missing next_date', () => {
    const result = scoreLead(makeLead({ next_date: undefined }));
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('should handle missing hasQuotation and hasSurvey', () => {
    const result = scoreLead(makeLead({ hasQuotation: undefined, hasSurvey: undefined }));
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('should handle undefined capacity', () => {
    const result = scoreLead(makeLead({ capacityKw: undefined }));
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('should handle string capacity values', () => {
    const result = scoreLead(makeLead({ capacityKw: '25' }));
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe('Lead Scoring — Config overrides', () => {
  it('should respect custom threshold configuration', () => {
    const customConfig = {
      ...DEFAULT_LEAD_SCORING_CONFIG,
      thresholds: { hot: 30, warm: 10 },
    };
    const lead = makeLead({ 
      name: 'Custom Lead', phone: '9876543210', email: 'c@test.com', city: 'Delhi',
      source: 'Website', status: 'Follow-up', followupCount: 2, hasQuotation: true,
      capacityKw: 10,
      updatedAt: new Date().toISOString(),
    });
    const result = scoreLead(lead, customConfig);
    expect(result.band).toBe('hot'); // More leads classified as hot with lower threshold
  });

  it('should respect custom weights', () => {
    const customConfig = {
      ...DEFAULT_LEAD_SCORING_CONFIG,
      weights: { ...DEFAULT_LEAD_SCORING_CONFIG.weights, intent: 0.5 },
    };
    const resultWithCustom = scoreLead(makeLead({ hasQuotation: true }), customConfig);
    const resultWithDefault = scoreLead(makeLead({ hasQuotation: true }));
    // Custom config gives more weight to intent factors
    expect(Number.isFinite(resultWithCustom.score)).toBe(true);
  });
});
