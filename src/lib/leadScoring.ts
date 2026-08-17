/**
 * P10-05 — Lead Scoring Engine
 *
 * Rule-based, deterministic, explainable lead scoring system.
 * Calculates a score 0–100 based on intent, completeness, engagement,
 * commercial potential, urgency, and negative signals.
 *
 * Pure functions — no Firestore, no React, no side effects.
 * Architecture: extensible so a real ML model can replace it later.
 *
 * BETA — marked as rule-based until sufficient production data exists
 * for proper model validation.
 */

import { safeNumber } from './analyticsCore';
import type { LeadScoreResult, LeadScoreFactor, ScoreBand, LeadScoringConfig } from '../features/ai/types';

// ══════════════════════════════════════════════════════════
//  DEFAULT CONFIG
// ══════════════════════════════════════════════════════════

export const DEFAULT_LEAD_SCORING_CONFIG: LeadScoringConfig = {
  weights: {
    intent: 0.25,
    completeness: 0.20,
    engagement: 0.20,
    commercialPotential: 0.20,
    urgency: 0.15,
  },
  thresholds: {
    hot: 70,
    warm: 40,
  },
  version: 'rule-v1',
};

// ══════════════════════════════════════════════════════════
//  LEAD INPUT TYPE (what the caller must provide)
// ══════════════════════════════════════════════════════════

export interface LeadScoringInput {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  company?: string;
  source?: string;
  status?: string;
  notes?: string;
  capacityKw?: number | string;
  assignedToId?: string;
  createdAt?: string;
  updatedAt?: string;
  next_date?: string;
  budget?: string;
  timeline?: string;
  /** Number of follow-ups recorded */
  followupCount?: number;
  /** Timestamps of follow-up activities */
  followupDates?: string[];
  /** Whether a quotation has been created for this lead */
  hasQuotation?: boolean;
  /** Whether a survey has been conducted */
  hasSurvey?: boolean;
}

// ══════════════════════════════════════════════════════════
//  SCORING DIMENSIONS
// ══════════════════════════════════════════════════════════

function scoreIntent(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let score = 0;

  // Explicit solar requirement in notes/name
  const solarKeywords = /solar|panel|inverter|rooftop|power|energy|electricity|bill|generation|kwh|roof/i;
  const hasExplicitNeed = solarKeywords.test(String(lead.notes || '')) || solarKeywords.test(String(lead.name || ''));
  if (hasExplicitNeed) {
    factors.push({ label: 'Explicit solar requirement indicated', score: 20, description: 'Lead mentions solar-specific keywords' });
    score += 20;
  }

  // Requested quotation
  if (lead.hasQuotation) {
    factors.push({ label: 'Quotation requested/generated', score: 15, description: 'Lead has an active quotation' });
    score += 15;
  }

  // Site survey conducted or requested
  if (lead.hasSurvey) {
    factors.push({ label: 'Site survey conducted or requested', score: 10, description: 'Lead has progressed to survey stage' });
    score += 10;
  }

  // Project capacity available
  const capacity = safeNumber(lead.capacityKw);
  if (capacity > 0) {
    factors.push({ label: `Project capacity specified: ${capacity} kW`, score: 10, description: 'Lead has specific capacity requirement' });
    score += 10;
  }

  // Budget information available
  if (lead.budget && lead.budget.trim()) {
    factors.push({ label: 'Budget information provided', score: 5, description: 'Lead has shared budget details' });
    score += 5;
  }

  return { score, factors };
}

function scoreCompleteness(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let score = 0;

  // Valid phone number
  const phone = String(lead.phone || '').replace(/\D/g, '');
  if (phone.length >= 10) {
    factors.push({ label: 'Valid phone number', score: 10, description: 'Contactable via phone' });
    score += 10;
  } else if (phone.length > 0) {
    factors.push({ label: 'Phone number provided', score: 5, description: 'Partial phone number' });
    score += 5;
  }

  // Email available
  if (lead.email && lead.email.includes('@')) {
    factors.push({ label: 'Email address available', score: 8, description: 'Contactable via email' });
    score += 8;
  }

  // Name available
  if (lead.name && lead.name.trim().length > 0) {
    factors.push({ label: 'Contact name available', score: 5, description: 'Named contact person' });
    score += 5;
  }

  // Company/organization name
  if (lead.company && lead.company.trim().length > 0) {
    factors.push({ label: 'Company/Organization name provided', score: 5, description: 'Business customer identified' });
    score += 5;
  }

  // Location/city available
  if (lead.city && lead.city.trim().length > 0) {
    factors.push({ label: 'City/location available', score: 5, description: 'Location known for site assessment' });
    score += 5;
  }

  // Source information
  if (lead.source && lead.source.trim().length > 0) {
    factors.push({ label: 'Lead source tracked', score: 2, description: 'Source attribution available' });
    score += 2;
  }

  return { score: Math.min(score, 35), factors };
}

function scoreEngagement(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let score = 0;
  const now = Date.now();

  // Follow-up count
  const fCount = safeNumber(lead.followupCount);
  if (fCount >= 3) {
    factors.push({ label: `Multiple follow-ups (${fCount})`, score: 10, description: 'Sales team actively engaged' });
    score += 10;
  } else if (fCount >= 1) {
    factors.push({ label: `Follow-up activity (${fCount})`, score: 5, description: 'Sales engagement recorded' });
    score += 5;
  }

  // Recent activity (within last 7 days)
  if (lead.updatedAt) {
    const updated = new Date(lead.updatedAt).getTime();
    const daysSinceUpdate = Math.max(0, Math.floor((now - updated) / 86400000));
    if (daysSinceUpdate <= 7) {
      factors.push({ label: 'Recent activity (within 7 days)', score: 10, description: 'Lead is active' });
      score += 10;
    } else if (daysSinceUpdate <= 30) {
      factors.push({ label: 'Activity within 30 days', score: 5, description: 'Lead is moderately recent' });
      score += 5;
    }
  }

  // Progressed from initial status
  if (lead.status && lead.status !== 'New' && lead.status !== 'new') {
    factors.push({ label: `Lead progressed to "${lead.status}"`, score: 8, description: 'Lead has moved beyond initial stage' });
    score += 8;
  }

  // Follow-up scheduled
  if (lead.next_date && lead.next_date.trim()) {
    factors.push({ label: 'Follow-up scheduled', score: 5, description: 'Future engagement planned' });
    score += 5;
  }

  return { score: Math.min(score, 33), factors };
}

function scoreCommercialPotential(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let score = 0;

  // Estimated capacity → proxy for project value
  const capacity = safeNumber(lead.capacityKw);
  if (capacity >= 50) {
    factors.push({ label: `Large project: ${capacity} kW capacity`, score: 20, description: 'High-value project scale' });
    score += 20;
  } else if (capacity >= 10) {
    factors.push({ label: `Medium project: ${capacity} kW capacity`, score: 12, description: 'Medium-value project' });
    score += 12;
  } else if (capacity > 0) {
    factors.push({ label: `Small project: ${capacity} kW capacity`, score: 5, description: 'Small residential project' });
    score += 5;
  }

  // Company/B2B indicator (higher potential)
  if (lead.company && lead.company.trim().length > 0 && (!lead.name || lead.company !== lead.name)) {
    factors.push({ label: 'Business/Commercial customer', score: 8, description: 'B2B customers tend to have higher order value' });
    score += 8;
  }

  return { score: Math.min(score, 28), factors };
}

function scoreUrgency(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let score = 0;
  const now = Date.now();

  // Follow-up due soon (within 3 days)
  if (lead.next_date && lead.next_date.trim()) {
    const nextDate = new Date(lead.next_date).getTime();
    const daysUntil = Math.max(0, Math.floor((nextDate - now) / 86400000));
    if (daysUntil <= 3) {
      factors.push({ label: 'Follow-up due within 3 days', score: 10, description: 'Urgent attention required' });
      score += 10;
    } else if (daysUntil <= 7) {
      factors.push({ label: 'Follow-up due within a week', score: 5, description: 'Approaching follow-up deadline' });
      score += 5;
    }
  }

  // Has quotation (buying process started)
  if (lead.hasQuotation) {
    factors.push({ label: 'Quotation in process', score: 8, description: 'Lead is actively evaluating' });
    score += 8;
  }

  // Timeline specified
  if (lead.timeline && lead.timeline.trim()) {
    const immediateKeywords = /immediate|urgent|asap|this month|next month|soon/i;
    if (immediateKeywords.test(lead.timeline)) {
      factors.push({ label: 'Immediate/near-term requirement indicated', score: 10, description: 'Lead has urgent buying timeline' });
      score += 10;
    } else {
      factors.push({ label: 'Purchase timeline specified', score: 5, description: 'Lead has a timeline' });
      score += 5;
    }
  }

  return { score, factors };
}

function scoreNegativeSignals(lead: LeadScoringInput): { score: number; factors: LeadScoreFactor[] } {
  const factors: LeadScoreFactor[] = [];
  let deduction = 0;
  const now = Date.now();

  // No activity for a long period
  if (lead.updatedAt) {
    const daysSinceUpdate = Math.max(0, Math.floor((now - new Date(lead.updatedAt).getTime()) / 86400000));
    if (daysSinceUpdate > 90) {
      factors.push({ label: 'No activity for over 90 days', score: -20, description: 'Lead may be stale' });
      deduction += 20;
    } else if (daysSinceUpdate > 30) {
      factors.push({ label: 'No activity for over 30 days', score: -10, description: 'Engagement may have cooled' });
      deduction += 10;
    }
  }

  // Incomplete contact information
  const phone = String(lead.phone || '').replace(/\D/g, '');
  if (!lead.name && !lead.email && phone.length < 10) {
    factors.push({ label: 'Incomplete contact information', score: -10, description: 'Cannot effectively follow up' });
    deduction += 10;
  }

  // Lead is in Lost/Rejected state
  if (lead.status && /lost|rejected|cancelled|dead/i.test(lead.status)) {
    factors.push({ label: 'Lead status indicates loss/rejection', score: -25, description: 'Lead has been lost or rejected' });
    deduction += 25;
  }

  return { score: Math.min(deduction, 35), factors };
}

// ══════════════════════════════════════════════════════════
//  MAIN SCORING FUNCTION
// ══════════════════════════════════════════════════════════

/**
 * Compute a deterministic lead score (0–100) based on available data.
 * Pure function — no side effects, no Firestore access.
 *
 * BETA — Rule-based scoring. Not ML.
 */
export function scoreLead(
  lead: LeadScoringInput,
  config: LeadScoringConfig = DEFAULT_LEAD_SCORING_CONFIG,
): LeadScoreResult {
  const w = config.weights;

  // Compute each dimension
  const intent = scoreIntent(lead);
  const completeness = scoreCompleteness(lead);
  const engagement = scoreEngagement(lead);
  const commercial = scoreCommercialPotential(lead);
  const urgency = scoreUrgency(lead);
  const negative = scoreNegativeSignals(lead);

  // Dimension max scores for normalization to 0-100 scale
  const maxRaw = { intent: 60, completeness: 35, engagement: 33, commercialPotential: 28, urgency: 28 };

  // Normalize each dimension to 0-100, apply weight, then sum
  const normalizedScore =
    (intent.score / maxRaw.intent) * 100 * w.intent +
    (completeness.score / maxRaw.completeness) * 100 * w.completeness +
    (engagement.score / maxRaw.engagement) * 100 * w.engagement +
    (commercial.score / maxRaw.commercialPotential) * 100 * w.commercialPotential +
    (urgency.score / maxRaw.urgency) * 100 * w.urgency;

  const total = Math.max(0, Math.min(100, Math.round(normalizedScore - negative.score)));

  // Determine band
  let band: ScoreBand;
  if (total >= config.thresholds.hot) band = 'hot';
  else if (total >= config.thresholds.warm) band = 'warm';
  else band = 'cold';

  // Confidence based on data availability
  const dataPoints = [
    lead.phone, lead.email, lead.name, lead.city,
    lead.capacityKw, lead.source, lead.status,
    lead.notes,
  ].filter(Boolean).length;
  const confidence = dataPoints >= 6 ? 'high' : dataPoints >= 3 ? 'medium' : 'low';

  // Combine all factors
  const allFactors = [
    ...intent.factors,
    ...completeness.factors,
    ...engagement.factors,
    ...commercial.factors,
    ...urgency.factors,
    ...negative.factors,
  ];

  return {
    score: Math.round(total),
    band,
    confidence,
    factors: allFactors,
    modelVersion: config.version,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Score multiple leads at once — deterministic, same as calling scoreLead per lead.
 */
export function scoreLeads(
  leads: LeadScoringInput[],
  config?: LeadScoringConfig,
): Map<string, LeadScoreResult> {
  const results = new Map<string, LeadScoreResult>();
  leads.forEach((lead) => {
    results.set(lead.id, scoreLead(lead, config));
  });
  return results;
}

/**
 * Get scoring statistics across a set of leads.
 */
export function getLeadScoringStats(results: Map<string, LeadScoreResult>) {
  const scores = Array.from(results.values());
  const total = scores.length;
  if (total === 0) {
    return { totalScored: 0, hotLeads: 0, warmLeads: 0, coldLeads: 0, avgScore: 0 };
  }

  const hotLeads = scores.filter((r) => r.band === 'hot').length;
  const warmLeads = scores.filter((r) => r.band === 'warm').length;
  const coldLeads = scores.filter((r) => r.band === 'cold').length;
  const avgScore = Math.round(scores.reduce((s, r) => s + r.score, 0) / total);

  return { totalScored: total, hotLeads, warmLeads, coldLeads, avgScore };
}
