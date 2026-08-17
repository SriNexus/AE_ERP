import { describe, it, expect } from 'vitest';
import {
  detectDuplicateLeads,
  detectSuspiciousCommissionGrowth,
  detectRepeatedWithdrawals,
  detectSettlementFailures,
  detectTierManipulation,
  detectActivityAnomalies,
  determineRiskLevel,
  calculateRiskScore,
  generateRecommendations,
  evaluatePartnerFraud,
} from '../fraudDetection';

// ── Fixtures ──────────────────────────────────────────────
const basePartner = { partnerId: 'p1' };

// ═══════════════════════════════════════════════════════════
//  detectDuplicateLeads
// ═══════════════════════════════════════════════════════════
describe('detectDuplicateLeads', () => {
  it('detects duplicate phone numbers', () => {
    const leads = [
      { partnerId: 'p1', phone: '9999999999', email: 'a@test.com', createdAt: new Date().toISOString() },
      { partnerId: 'p1', phone: '9999999999', email: 'b@test.com', createdAt: new Date().toISOString() },
    ];
    const result = detectDuplicateLeads(basePartner, leads);
    expect(result.triggered).toBe(true);
    expect(result.ruleType).toBe('duplicate_leads');
    expect(result.evidence.some((e) => e.includes('Same phone'))).toBe(true);
  });

  it('detects duplicate email addresses', () => {
    const leads = [
      { partnerId: 'p1', phone: '1111111111', email: 'dup@test.com', createdAt: new Date().toISOString() },
      { partnerId: 'p1', phone: '2222222222', email: 'dup@test.com', createdAt: new Date().toISOString() },
    ];
    const result = detectDuplicateLeads(basePartner, leads);
    expect(result.triggered).toBe(true);
  });

  it('triggers on high lead volume (over 15 in 90 days)', () => {
    const leads = Array.from({ length: 20 }, (_, i) => ({
      partnerId: 'p1',
      phone: `999999${String(i).padStart(4, '0')}`,
      email: `user${i}@test.com`,
      createdAt: new Date().toISOString(),
    }));
    const result = detectDuplicateLeads(basePartner, leads);
    expect(result.triggered).toBe(true);
  });

  it('returns not triggered for normal leads', () => {
    const leads = [
      { partnerId: 'p1', phone: '1111111111', email: 'a@test.com', createdAt: new Date().toISOString() },
      { partnerId: 'p1', phone: '2222222222', email: 'b@test.com', createdAt: new Date().toISOString() },
    ];
    const result = detectDuplicateLeads(basePartner, leads);
    expect(result.triggered).toBe(false);
    expect(result.riskPoints).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  detectSuspiciousCommissionGrowth
// ═══════════════════════════════════════════════════════════
describe('detectSuspiciousCommissionGrowth', () => {
  it('returns not triggered with insufficient history (< 3 records)', () => {
    const records = [
      { partnerId: 'p1', amount: 1000, generatedDate: new Date().toISOString() },
    ];
    const result = detectSuspiciousCommissionGrowth(basePartner, records);
    expect(result.triggered).toBe(false);
    expect(result.explanation).toContain('Insufficient');
  });

  it('detects sudden commission jump', () => {
    const records = [
      { partnerId: 'p1', amount: 1000, generatedDate: '2025-01-01' },
      { partnerId: 'p1', amount: 1200, generatedDate: '2025-02-01' },
      { partnerId: 'p1', amount: 5000, generatedDate: '2025-03-01' },
      { partnerId: 'p1', amount: 6000, generatedDate: '2025-04-01' },
    ];
    const result = detectSuspiciousCommissionGrowth(basePartner, records);
    expect(result.triggered).toBe(true);
    expect(result.evidence.some((e) => e.includes('jump'))).toBe(true);
  });

  it('returns not triggered for normal growth pattern', () => {
    const records = Array.from({ length: 6 }, (_, i) => ({
      partnerId: 'p1',
      amount: 1000 + i * 100,
      generatedDate: new Date(2025, i, 1).toISOString(),
    }));
    const result = detectSuspiciousCommissionGrowth(basePartner, records);
    expect(result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  detectRepeatedWithdrawals
// ═══════════════════════════════════════════════════════════
describe('detectRepeatedWithdrawals', () => {
  it('returns not triggered with insufficient history (< 2 withdrawals)', () => {
    const txns = [
      { partnerId: 'p1', type: 'withdrawal_request', amount: 1000, createdAt: new Date().toISOString() },
    ];
    const result = detectRepeatedWithdrawals(basePartner, txns);
    expect(result.triggered).toBe(false);
  });

  it('detects high withdrawal frequency (more than 4 in 30 days)', () => {
    const txns = Array.from({ length: 6 }, (_, i) => ({
      partnerId: 'p1',
      type: 'withdrawal_request',
      amount: 1000,
      createdAt: new Date().toISOString(),
    }));
    const result = detectRepeatedWithdrawals(basePartner, txns);
    expect(result.triggered).toBe(true);
    expect(result.evidence.some((e) => e.includes('withdrawals'))).toBe(true);
  });

  it('detects structuring (small withdrawals close together)', () => {
    const txns = Array.from({ length: 5 }, (_, i) => ({
      partnerId: 'p1',
      type: 'withdrawal_request',
      amount: 3000,
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    const result = detectRepeatedWithdrawals(basePartner, txns);
    expect(result.triggered).toBe(true);
    expect(result.evidence.some((e) => e.includes('structuring'))).toBe(true);
  });

  it('returns not triggered for normal withdrawal pattern', () => {
    const txns = [
      { partnerId: 'p1', type: 'withdrawal_request', amount: 10000, createdAt: new Date(Date.now() - 60 * 86400000).toISOString() },
      { partnerId: 'p1', type: 'withdrawal_request', amount: 15000, createdAt: new Date(Date.now() - 40 * 86400000).toISOString() },
    ];
    const result = detectRepeatedWithdrawals(basePartner, txns);
    expect(result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  detectSettlementFailures
// ═══════════════════════════════════════════════════════════
describe('detectSettlementFailures', () => {
  it('returns not triggered with insufficient history (< 2 settlements)', () => {
    const txns = [
      { partnerId: 'p1', commissionIds: ['c1'], status: 'completed' },
    ];
    const result = detectSettlementFailures(basePartner, txns);
    expect(result.triggered).toBe(false);
  });

  it('detects high failure rate (> 50%)', () => {
    const txns = [
      { partnerId: 'p1', commissionIds: ['c1'], status: 'failed', failureReason: 'bank_error' },
      { partnerId: 'p1', commissionIds: ['c2'], status: 'failed', failureReason: 'insufficient_balance' },
      { partnerId: 'p1', commissionIds: ['c3'], status: 'completed' },
    ];
    const result = detectSettlementFailures(basePartner, txns);
    expect(result.triggered).toBe(true);
    expect(result.evidence.some((e) => e.includes('failed'))).toBe(true);
  });

  it('returns not triggered for normal settlement pattern', () => {
    const txns = [
      { partnerId: 'p1', commissionIds: ['c1'], status: 'completed' },
      { partnerId: 'p1', commissionIds: ['c2'], status: 'completed' },
      { partnerId: 'p1', commissionIds: ['c3'], status: 'completed' },
    ];
    const result = detectSettlementFailures(basePartner, txns);
    expect(result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  detectTierManipulation
// ═══════════════════════════════════════════════════════════
describe('detectTierManipulation', () => {
  it('returns not triggered with insufficient history (< 2 changes)', () => {
    const history = [{ changeType: 'automatic', oldTier: 'bronze', newTier: 'silver', changedAt: new Date().toISOString() }];
    const result = detectTierManipulation(basePartner, history);
    expect(result.triggered).toBe(false);
  });

  it('detects frequent manual overrides', () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      changeType: 'manual',
      oldTier: 'bronze',
      newTier: i % 2 === 0 ? 'silver' : 'bronze',
      changedAt: new Date(Date.now() - i * 86400000 * 10).toISOString(),
    }));
    const result = detectTierManipulation(basePartner, history);
    expect(result.triggered).toBe(true);
  });

  it('returns not triggered for normal tier pattern', () => {
    const history = [
      { changeType: 'automatic', oldTier: 'bronze', newTier: 'silver', changedAt: new Date(Date.now() - 180 * 86400000).toISOString() },
      { changeType: 'automatic', oldTier: 'silver', newTier: 'gold', changedAt: new Date(Date.now() - 90 * 86400000).toISOString() },
    ];
    const result = detectTierManipulation(basePartner, history);
    expect(result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  detectActivityAnomalies
// ═══════════════════════════════════════════════════════════
describe('detectActivityAnomalies', () => {
  it('returns not triggered with insufficient history (< 10 logs)', () => {
    const logs = Array.from({ length: 5 }, (_, i) => ({
      entityId: 'p1',
      action: 'updated',
      timestamp: new Date().toISOString(),
      metadata: {},
    }));
    const result = detectActivityAnomalies(basePartner, logs);
    expect(result.triggered).toBe(false);
  });

  it('detects excessive activity in last 7 days', () => {
    const logs = Array.from({ length: 25 }, (_, i) => ({
      entityId: 'p1',
      action: 'updated',
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      metadata: {},
    }));
    const result = detectActivityAnomalies(basePartner, logs);
    expect(result.triggered).toBe(true);
  });

  it('returns not triggered for normal activity pattern', () => {
    const logs = Array.from({ length: 12 }, (_, i) => ({
      entityId: 'p1',
      action: i % 2 === 0 ? 'created' : 'viewed',
      timestamp: new Date(Date.now() - i * 86400000 * 2).toISOString(),
      metadata: {},
    }));
    const result = detectActivityAnomalies(basePartner, logs);
    expect(result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  determineRiskLevel
// ═══════════════════════════════════════════════════════════
describe('determineRiskLevel', () => {
  it('returns low for score < 20', () => {
    expect(determineRiskLevel(0)).toBe('low');
    expect(determineRiskLevel(10)).toBe('low');
    expect(determineRiskLevel(19)).toBe('low');
  });

  it('returns medium for score 20-44', () => {
    expect(determineRiskLevel(20)).toBe('medium');
    expect(determineRiskLevel(30)).toBe('medium');
    expect(determineRiskLevel(44)).toBe('medium');
  });

  it('returns high for score 45-69', () => {
    expect(determineRiskLevel(45)).toBe('high');
    expect(determineRiskLevel(60)).toBe('high');
    expect(determineRiskLevel(69)).toBe('high');
  });

  it('returns critical for score >= 70', () => {
    expect(determineRiskLevel(70)).toBe('critical');
    expect(determineRiskLevel(85)).toBe('critical');
    expect(determineRiskLevel(100)).toBe('critical');
  });
});

// ═══════════════════════════════════════════════════════════
//  calculateRiskScore
// ═══════════════════════════════════════════════════════════
describe('calculateRiskScore', () => {
  it('returns 0 score when no rules triggered', () => {
    const results = [
      { ruleType: 'duplicate_leads' as const, triggered: false, riskPoints: 0, severity: 'low' as const, explanation: '', evidence: [] },
      { ruleType: 'tier_manipulation' as const, triggered: false, riskPoints: 0, severity: 'low' as const, explanation: '', evidence: [] },
    ];
    const score = calculateRiskScore(results);
    expect(score.totalScore).toBe(0);
    expect(score.riskLevel).toBe('low');
  });

  it('calculates weighted score with triggered rules', () => {
    const results = [
      { ruleType: 'duplicate_leads' as const, triggered: true, riskPoints: 20, severity: 'high' as const, explanation: 'dup', evidence: ['dup'] },
      { ruleType: 'repeated_withdrawals' as const, triggered: true, riskPoints: 15, severity: 'medium' as const, explanation: 'with', evidence: ['wd'] },
    ];
    const score = calculateRiskScore(results);
    expect(score.totalScore).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(score.riskLevel);
    expect(Object.keys(score.contributions)).toContain('duplicate_leads');
  });

  it('applies escalation bonus for 3+ triggered rules', () => {
    const results: any[] = Array.from({ length: 4 }, (_, i) => ({
      ruleType: ['duplicate_leads', 'repeated_withdrawals', 'tier_manipulation', 'activity_anomaly'][i],
      triggered: true,
      riskPoints: 20,
      severity: 'medium' as const,
      explanation: 'test',
      evidence: ['test'],
    }));
    const score = calculateRiskScore(results);
    // With 4 triggered rules at medium severity, score should have escalation bonus
    expect(score.totalScore).toBeGreaterThan(60); // should have ~10 point escalation bonus
  });
});

// ═══════════════════════════════════════════════════════════
//  generateRecommendations
// ═══════════════════════════════════════════════════════════
describe('generateRecommendations', () => {
  it('returns no action message when no rules triggered', () => {
    const results = [
      { ruleType: 'duplicate_leads' as const, triggered: false, riskPoints: 0, severity: 'low' as const, explanation: '', evidence: [] },
    ];
    const recs = generateRecommendations(results);
    expect(recs[0]).toContain('No action required');
    expect(recs).toHaveLength(1);
  });

  it('generates specific recommendations per triggered rule type', () => {
    const results = [
      { ruleType: 'duplicate_leads' as const, triggered: true, riskPoints: 15, severity: 'medium' as const, explanation: 'Dup', evidence: ['dup'] },
      { ruleType: 'repeated_withdrawals' as const, triggered: true, riskPoints: 10, severity: 'medium' as const, explanation: 'With', evidence: ['wd'] },
    ];
    const recs = generateRecommendations(results);
    expect(recs.some((r) => r.includes('duplicate lead'))).toBe(true);
    expect(recs.some((r) => r.includes('cooldown'))).toBe(true);
  });

  it('includes high priority message for 3+ triggered rules', () => {
    const results = [
      { ruleType: 'duplicate_leads' as const, triggered: true, riskPoints: 10, severity: 'medium' as const, explanation: 'Dup', evidence: ['dup'] },
      { ruleType: 'repeated_withdrawals' as const, triggered: true, riskPoints: 10, severity: 'medium' as const, explanation: 'With', evidence: ['wd'] },
      { ruleType: 'tier_manipulation' as const, triggered: true, riskPoints: 10, severity: 'medium' as const, explanation: 'Tier', evidence: ['t'] },
    ];
    const recs = generateRecommendations(results);
    expect(recs.some((r) => r.includes('HIGH PRIORITY'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  evaluatePartnerFraud (integration)
// ═══════════════════════════════════════════════════════════
describe('evaluatePartnerFraud', () => {
  it('returns evaluation with score when partner has suspicious data', () => {
    const evaluation = evaluatePartnerFraud('p1', 'Test Partner', {
      leads: [
        { partnerId: 'p1', phone: '9999999999', email: 'a@test.com', createdAt: new Date().toISOString() },
        { partnerId: 'p1', phone: '9999999999', email: 'b@test.com', createdAt: new Date().toISOString() },
      ],
      commissionRecords: [
        { partnerId: 'p1', amount: 1000, generatedDate: '2025-01-01' },
        { partnerId: 'p1', amount: 1200, generatedDate: '2025-02-01' },
        { partnerId: 'p1', amount: 10000, generatedDate: '2025-03-01' },
        { partnerId: 'p1', amount: 12000, generatedDate: '2025-04-01' },
      ],
      walletTxns: [
        { partnerId: 'p1', type: 'withdrawal_request', amount: 3000, createdAt: new Date().toISOString() },
        { partnerId: 'p1', type: 'withdrawal_request', amount: 4000, createdAt: new Date().toISOString() },
      ],
      tierHistory: [
        { changeType: 'manual', oldTier: 'bronze', newTier: 'silver', changedAt: new Date().toISOString() },
      ],
      auditLogs: [],
    });
    expect(evaluation.partnerId).toBe('p1');
    expect(evaluation.partnerName).toBe('Test Partner');
    expect(evaluation.riskScore).toBeGreaterThanOrEqual(0);
    expect(evaluation.triggeredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(evaluation.recommendations)).toBe(true);
    expect(evaluation.evaluatedAt).toBeDefined();
  });

  it('returns low risk for clean partner data', () => {
    const evaluation = evaluatePartnerFraud('p2', 'Clean Partner', {
      leads: [
        { partnerId: 'p2', phone: '1111111111', email: 'a@test.com', createdAt: new Date().toISOString() },
        { partnerId: 'p2', phone: '2222222222', email: 'b@test.com', createdAt: new Date().toISOString() },
      ],
      commissionRecords: [
        { partnerId: 'p2', amount: 1000, generatedDate: '2025-01-01' },
        { partnerId: 'p2', amount: 1100, generatedDate: '2025-02-01' },
        { partnerId: 'p2', amount: 1200, generatedDate: '2025-03-01' },
      ],
      walletTxns: [],
      tierHistory: [],
      auditLogs: [],
    });
    expect(evaluation.riskScore).toBe(0);
    expect(evaluation.triggeredCount).toBe(0);
    expect(evaluation.riskLevel).toBe('low');
  });
});
