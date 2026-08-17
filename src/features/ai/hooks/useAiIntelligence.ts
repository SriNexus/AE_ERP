/**
 * P10-05 — AI Intelligence: React Query Hooks
 *
 * BETA — Rule-based/statistical intelligence, not ML.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { isOwnerEmail } from '../../../lib/ownerAccess';
import { scoreLead, scoreLeads, getLeadScoringStats } from '../../../lib/leadScoring';
import { forecastProductDemand, getStockoutRisks } from '../../../lib/demandForecasting';
import {
  detectProjectAnomalies,
  detectAllAnomalies,
  buildAnomalyBenchmarks,
  summarizeAnomalies,
} from '../../../lib/anomalyDetection';
import { safeNumber } from '../../../lib/analyticsCore';
import { notifyRoleUsers, resolveNotificationCompanyId } from '../../../lib/notifications';
import { NotificationType } from '../../../types';
import type {
  LeadScoreResult,
  DemandForecast,
  AnomalyResult,
  AnomalyDetectionSummary,
  AiIntelligenceSummary,
} from '../types';
import type { LeadScoringInput } from '../../../lib/leadScoring';
import type { ProductDemandInput } from '../../../lib/demandForecasting';
import type { ProjectAnomalyInput, AnomalyBenchmarkData } from '../../../lib/anomalyDetection';

// ══════════════════════════════════════════════════════════
//  LEAD SCORING HOOKS
// ══════════════════════════════════════════════════════════

/**
 * Score all leads for the active company.
 * BETA — Rule-based scoring.
 */
export function useLeadScores() {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: leads, isLoading } = useQuery({
    queryKey: [...(keys.leadsRoot || ['leads']), 'ai-lead-scores'],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!leads) return { scores: new Map(), isLoading, stats: { totalScored: 0, hotLeads: 0, warmLeads: 0, coldLeads: 0, avgScore: 0 } };

    const companyLeads = leads.filter((l: any) => !l.isDeleted);
    const input = companyLeads.map(toLeadScoringInput);
    const scores = scoreLeads(input);
    const stats = getLeadScoringStats(scores);

    // Send notifications for newly scored hot leads (to Admin/Director roles)
    const companyId = resolveNotificationCompanyId(activeCompanyId);
    if (companyId && stats.hotLeads > 0) {
      // Track notified hot leads per session to avoid re-sending
      const hotLeadIds = Array.from(scores.entries())
        .filter(([id, result]) => result.band === 'hot' && !_notifiedHotLeads.has(id))
        .map(([id]) => id);
      if (hotLeadIds.length > 0) {
        hotLeadIds.forEach((id) => _notifiedHotLeads.add(id));
        void notifyRoleUsers(
          ['Admin', 'Director'],
          NotificationType.LEAD_UPDATED,
          '🔥 Hot leads detected',
          `${hotLeadIds.length} lead(s) scored 70+ (hot). ${companyLeads.find((l: any) => l.id === hotLeadIds[0])?.name ? `Top: ${companyLeads.find((l: any) => l.id === hotLeadIds[0])?.name}` : ''}`,
          'lead',
          hotLeadIds[0],
          companyId,
        );
      }
    }

    return { scores, isLoading, stats };
  }, [leads, isLoading, activeCompanyId]);
}

/**
 * Score a single lead by ID.
 */
export function useLeadScore(leadId: string) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: leads } = useQuery({
    queryKey: ['leads', activeCompanyId, 'ai-single-score', leadId],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
    enabled: !!leadId,
  });

  return useMemo(() => {
    if (!leads) return null;
    const lead = leads.find((l: any) => l.id === leadId && !l.isDeleted);
    if (!lead) return null;
    return scoreLead(toLeadScoringInput(lead));
  }, [leads, leadId]);
}

function toLeadScoringInput(lead: any): LeadScoringInput {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    state: lead.state,
    company: lead.company,
    source: lead.source,
    status: lead.status,
    notes: lead.notes,
    capacityKw: lead.capacityKw || lead.expectedCapacityKw || lead.capacity,
    assignedToId: lead.assignedToId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    next_date: lead.next_date,
    followupCount: lead.followupCount || 0,
    hasQuotation: !!(lead.hasQuotation || lead.quotationCreated || lead.linkedQuotationId),
    hasSurvey: !!(lead.hasSurvey || lead.surveyRequested),
  };
}

// ══════════════════════════════════════════════════════════
//  DEMAND FORECASTING HOOKS
// ══════════════════════════════════════════════════════════

/**
 * Forecast demand for all products.
 * BETA — Statistical estimate.
 */
export function useDemandForecasts() {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['products', activeCompanyId, 'ai-forecast'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  const { data: stock } = useQuery({
    queryKey: ['stock', activeCompanyId, 'ai-forecast'],
    queryFn: () => getAll<any>(COLLECTIONS.STOCK),
    staleTime: 60_000,
  });

  const { data: dispatchItems } = useQuery({
    queryKey: ['dispatch', activeCompanyId, 'ai-forecast'],
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH),
    staleTime: 120_000,
  });

  return useMemo(() => {
    if (!products) return { forecasts: [], stockoutRisks: [], isLoading: true };

    const forecasts: DemandForecast[] = products
      .filter((p: any) => !p.isDeleted)
      .map((p: any) => {
        const currentStock = stock?.find(
          (s: any) => s.productId === p.id && s.companyId === activeCompanyId,
        );

        // Build monthly dispatch history
        const monthlyData = buildMonthlyDispatchHistory(p.id, dispatchItems || []);
        const input: ProductDemandInput = {
          productId: p.id,
          productName: p.name || p.id,
          unit: p.unit || 'PCS',
          monthlyHistory: monthlyData,
          currentStock: safeNumber(currentStock?.availableQty ?? currentStock?.available),
          lowStockThreshold: safeNumber(p.lowStockThreshold),
        };

        return forecastProductDemand(input);
      });

    const stockoutRisks = getStockoutRisks(forecasts);

    return { forecasts, stockoutRisks, isLoading: productsLoading };
  }, [products, stock, dispatchItems, activeCompanyId, productsLoading]);
}

function buildMonthlyDispatchHistory(
  productId: string,
  dispatchItems: any[],
): Array<{ period: string; qty: number }> {
  const monthly = new Map<string, number>();

  dispatchItems.forEach((d: any) => {
    if (d.isDeleted) return;
    const items = d.items || [];
    items.forEach((item: any) => {
      if (item.productId !== productId) return;
      const date = d.date || d.createdAt || d.dispatchedAt;
      if (!date) return;
      const period = date.slice(0, 7); // "YYYY-MM"
      const qty = safeNumber(item.qty ?? item.verifiedQty ?? item.dispatchedQty);
      monthly.set(period, (monthly.get(period) || 0) + qty);
    });
  });

  return Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, qty]) => ({ period, qty }));
}

// ══════════════════════════════════════════════════════════
//  ANOMALY DETECTION HOOKS
// ══════════════════════════════════════════════════════════

/**
 * Detect anomalies across all projects.
 * BETA — Heuristic detection.
 */
export function useProjectAnomalies() {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);

  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: projects, isLoading } = useQuery({
    enabled: !!activeCompanyId && isAuthorized,
    queryKey: ['projects', activeCompanyId, 'ai-anomalies'],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (!projects) return { anomalies: [], summary: null as AnomalyDetectionSummary | null, isLoading: true };

    const companyProjects = projects.filter((p: any) => p.companyId === activeCompanyId && !p.isDeleted);
    const input: ProjectAnomalyInput[] = companyProjects.map(toAnomalyInput);
    const benchmarks = buildAnomalyBenchmarks(input);
    const anomalies = detectAllAnomalies(input, benchmarks);
    const summary = summarizeAnomalies(anomalies);

    // Send notifications for newly detected critical anomalies (to Admin/Director roles)
    const companyId = resolveNotificationCompanyId(activeCompanyId);
    if (companyId) {
      anomalies.forEach((a) => {
        if (a.severity === 'critical' && !_notifiedAnomalies.has(a.id)) {
          _notifiedAnomalies.add(a.id);
          void notifyRoleUsers(
            ['Admin', 'Director'],
            NotificationType.ESCALATION_CRITICAL,
            '🚨 Critical project anomaly detected',
            `${a.explanation} Recommended: ${a.recommendedAction}`,
            'project',
            a.projectId,
            companyId,
          );
        }
      });
    }

    return { anomalies, summary, isLoading };
  }, [projects, activeCompanyId, isLoading]);
}

function toAnomalyInput(project: any): ProjectAnomalyInput {
  return {
    id: project.id,
    projectId: project.projectId || project.id,
    projectName: project.projectId || project.id,
    currentStage: project.currentStage || 'New',
    stageHistory: (project.stageHistory || []).map((h: any) => ({
      stage: h.stage,
      changedAt: h.changedAt,
      changedBy: h.changedBy,
      note: h.note,
    })),
    createdAt: project.createdAt || '',
    isDeleted: project.isDeleted,
    assignedSurveyor: project.assignedSurveyor,
    assignedInstaller: project.assignedInstaller,
    salesOwner: project.salesOwner,
  };
}

// Track already-notified anomalies and hot leads to avoid re-sending
const _notifiedAnomalies = new Set<string>();
const _notifiedHotLeads = new Set<string>();

// ══════════════════════════════════════════════════════════
//  AI INTELLIGENCE SUMMARY HOOK
// ══════════════════════════════════════════════════════════

/**
 * Combined AI intelligence summary for the dashboard.
 */
export function useAiIntelligenceSummary(): {
  summary: AiIntelligenceSummary | null;
  isLoading: boolean;
} {
  const { scores, isLoading: scoresLoading } = useLeadScores();
  const { forecasts, isLoading: forecastsLoading } = useDemandForecasts();
  const { summary: anomalySummary, isLoading: anomalyLoading } = useProjectAnomalies();

  return useMemo(() => {
    if (scoresLoading || forecastsLoading || anomalyLoading || !anomalySummary) {
      return { summary: null, isLoading: true };
    }

    const stats = getLeadScoringStats(scores);

    return {
      summary: {
        leadScoring: {
          totalScored: stats.totalScored,
          hotLeads: stats.hotLeads,
          warmLeads: stats.warmLeads,
          coldLeads: stats.coldLeads,
          avgScore: stats.avgScore,
          evaluatedAt: new Date().toISOString(),
        },
        demandAlerts: getStockoutRisks(forecasts).slice(0, 10).map((f) => ({
          productId: f.productId,
          productName: f.productName,
          stockoutRisk: f.stockoutRisk,
          recommendation: f.reorderRecommendation?.reason || f.explanation,
        })),
        anomalies: anomalySummary,
        generatedAt: new Date().toISOString(),
        betaNotice: 'BETA — Rule-based/statistical intelligence. Not ML.',
      },
      isLoading: false,
    };
  }, [scores, forecasts, anomalySummary, scoresLoading, forecastsLoading, anomalyLoading]);
}
