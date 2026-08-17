/**
 * aiRecommendations.ts — AI Recommendations Engine (Phase 9D)
 *
 * Provides contextual recommendations for each Solar EPC domain.
 * All results are advisory — AI never writes to Firestore.
 *
 * Architecture:
 *   - Each domain gets a dedicated recommendation function
 *   - Results are based on statistical analysis of loaded data
 *   - For LLM-powered insights, delegates to aiService.ts
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { safeNumber } from '../../../lib/analyticsCore';
import { askAi } from '../../../services/aiService';
import { isOfficialDemoCompany } from '../../../config/demo';
import { isOwnerEmail } from '../../../lib/ownerAccess';

// ── Types ─────────────────────────────────────────────────

export interface AiRecommendation {
  id: string;
  domain: 'sales' | 'procurement' | 'projects' | 'finance' | 'partners' | 'monitoring';
  type: 'insight' | 'alert' | 'prediction' | 'recommendation';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  actionLabel?: string;
  actionLink?: string;
  source: 'statistical' | 'llm';
  generatedAt: string;
}

export interface SalesRecommendations {
  leadScoring: {
    hotLeads: number;
    warmLeads: number;
    coldLeads: number;
    avgScore: number;
    topLeadName?: string;
    topLeadScore?: number;
  };
  followUpDue: string[];
  winProbability: number;
  recommendations: AiRecommendation[];
}

export interface ProcurementRecommendations {
  stockoutRisks: Array<{
    productName: string;
    currentStock: number;
    risk: number;
    recommendation: string;
  }>;
  recommendations: AiRecommendation[];
}

export interface ProjectRecommendations {
  delayed: Array<{
    projectId: string;
    stage: string;
    delayDays: number;
    reason: string;
  }>;
  bottlenecks: string[];
  qcRisks: Array<{
    projectId: string;
    risk: string;
  }>;
  recommendations: AiRecommendation[];
}

export interface FinanceRecommendations {
  overdueCount: number;
  overdueAmount: number;
  cashflowTrend: string;
  recommendations: AiRecommendation[];
}

export interface PartnerRecommendations {
  tierUpgrades: Array<{
    partnerName: string;
    currentTier: string;
    targetTier: string;
    progress: number;
  }>;
  recommendations: AiRecommendation[];
}

export interface MonitoringRecommendations {
  offlineCount: number;
  lowGeneration: Array<{
    projectId: string;
    actual: number;
    expected: number;
  }>;
  recommendations: AiRecommendation[];
}

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Sales Recommendations ─────────────────────────────────

export function useSalesRecommendations(): {
  data: SalesRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: [...(keys.leadsRoot || ['leads']), 'ai-rec-sales'],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!leads) return { data: null, isLoading: true };

    const activeLeads = leads.filter((l: any) => !l.isDeleted);
    const now = Date.now();
    const dayMs = 86400000;

    // Score leads based on simple heuristics
    const scoredLeads = activeLeads.map((l: any) => {
      let score = 50;
      if (l.status === 'hot' || l.status === 'qualified') score += 25;
      if (l.status === 'warm' || l.status === 'contacted') score += 10;
      if (l.capacityKw && Number(l.capacityKw) > 5) score += 10;
      if (l.source === 'reference') score += 10;
      if (l.followupCount && l.followupCount > 2) score += 5;
      if (l.hasQuotation) score += 10;
      if (l.next_date) {
        const nextDate = new Date(l.next_date).getTime();
        if (nextDate < now + dayMs) score += 10; // Due today/tomorrow
      }
      return { ...l, aiScore: Math.min(score, 100) };
    }).sort((a: any, b: any) => b.aiScore - a.aiScore);

    const hotLeads = scoredLeads.filter((l: any) => l.aiScore >= 70);
    const warmLeads = scoredLeads.filter((l: any) => l.aiScore >= 40 && l.aiScore < 70);
    const coldLeads = scoredLeads.filter((l: any) => l.aiScore < 40);
    const avgScore = scoredLeads.length > 0
      ? Math.round(scoredLeads.reduce((s: number, l: any) => s + l.aiScore, 0) / scoredLeads.length)
      : 0;

    // Follow-ups due
    const followUpDue = scoredLeads
      .filter((l: any) => {
        if (!l.next_date) return false;
        return new Date(l.next_date).getTime() < now + dayMs;
      })
      .slice(0, 5)
      .map((l: any) => l.name || l.id);

    const recommendations: AiRecommendation[] = [];

    if (hotLeads.length >= 3) {
      recommendations.push({
        id: generateId(),
        domain: 'sales',
        type: 'insight',
        title: `${hotLeads.length} hot leads ready for conversion`,
        description: `High-priority leads with scores 70+. Prioritize follow-up calls today.`,
        severity: 'critical',
        actionLabel: 'View Hot Leads',
        actionLink: '/leads',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    if (followUpDue.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'sales',
        type: 'recommendation',
        title: `${followUpDue.length} follow-ups due today`,
        description: `Including: ${followUpDue.slice(0, 3).join(', ')}`,
        severity: 'warning',
        actionLabel: 'View Leads',
        actionLink: '/leads',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    // Win probability (simple heuristic based on pipeline health)
    const winProbability = scoredLeads.length > 0
      ? Math.round((hotLeads.length / scoredLeads.length) * 100)
      : 0;

    return {
      data: {
        leadScoring: {
          hotLeads: hotLeads.length,
          warmLeads: warmLeads.length,
          coldLeads: coldLeads.length,
          avgScore,
          topLeadName: scoredLeads[0]?.name,
          topLeadScore: scoredLeads[0]?.aiScore,
        },
        followUpDue,
        winProbability,
        recommendations,
      },
      isLoading: leadsLoading,
    };
  }, [leads, leadsLoading]);
}

// ── Procurement Recommendations ──────────────────────────

export function useProcurementRecommendations(): {
  data: ProcurementRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: products } = useQuery({
    queryKey: ['products', activeCompanyId, 'ai-rec-proc'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ['stock', activeCompanyId, 'ai-rec-stock'],
    queryFn: () => getAll<any>(COLLECTIONS.STOCK),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!stock || !products) return { data: null, isLoading: true };

    const stockoutRisks = products
      .filter((p: any) => !p.isDeleted)
      .map((p: any) => {
        const stockRecord = stock.find(
          (s: any) => s.productId === p.id && s.companyId === activeCompanyId,
        );
        const currentStock = safeNumber(stockRecord?.availableQty ?? stockRecord?.available ?? 0);
        const threshold = safeNumber(p.lowStockThreshold ?? p.minStock ?? 10);
        const risk = currentStock === 0 ? 100 : Math.min(100, Math.round((threshold / Math.max(currentStock, 1)) * 100));

        let recommendation = '';
        if (risk >= 80) recommendation = `Urgent: Order ${Math.ceil(threshold * 1.5)} units of ${p.name || p.id}`;
        else if (risk >= 50) recommendation = `Plan reorder for ${p.name || p.id} — stock at ${currentStock} units`;
        else recommendation = `Stock level OK for ${p.name || p.id} (${currentStock} units)`;

        return { productName: p.name || p.id, currentStock, risk, recommendation };
      })
      .filter((r) => r.risk >= 50)
      .sort((a, b) => b.risk - a.risk);

    const recommendations: AiRecommendation[] = [];

    const criticalRisks = stockoutRisks.filter((r) => r.risk >= 80);
    if (criticalRisks.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'procurement',
        type: 'alert',
        title: `${criticalRisks.length} products at critical stock level`,
        description: criticalRisks.map((r) => r.productName).join(', '),
        severity: 'critical',
        actionLabel: 'View Stock',
        actionLink: '/stock',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      data: {
        stockoutRisks: stockoutRisks.slice(0, 10),
        recommendations,
      },
      isLoading: stockLoading,
    };
  }, [products, stock, activeCompanyId, stockLoading]);
}

// ── Project Recommendations ──────────────────────────────

export function useProjectRecommendations(): {
  data: ProjectRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', activeCompanyId, 'ai-rec-projects'],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!projects) return { data: null, isLoading: true };

    const active = projects.filter((p: any) => p.companyId === activeCompanyId && !p.isDeleted);
    const now = Date.now();
    const dayMs = 86400000;

    // Stage duration benchmarks (days)
    const stageBenchmarks: Record<string, number> = {
      Survey: 3, Engineering: 5, Quotation: 3, Order: 2,
      Procurement: 7, Dispatch: 2, Installation: 5, QC: 3,
      Commissioning: 2, NetMetering: 15, Subsidy: 20,
      Handover: 2, AMC: 1,
    };

    const delayed = active
      .map((p: any) => {
        const stage = p.currentStage || 'New';
        const benchmark = stageBenchmarks[stage] || 5;
        const stageHistory = p.stageHistory || [];
        const stageEntry = [...stageHistory].reverse().find((h: any) => h.stage === stage);
        const stageStart = stageEntry?.changedAt || p.createdAt || now;
        const daysInStage = Math.round((now - new Date(stageStart).getTime()) / dayMs);
        const delayDays = Math.max(0, daysInStage - benchmark);
        return { projectId: p.projectId || p.id, stage, delayDays, reason: `In ${stage} for ${daysInStage} days (benchmark: ${benchmark} days)` };
      })
      .filter((p) => p.delayDays > 2)
      .sort((a, b) => b.delayDays - a.delayDays);

    // QC risks
    const qcRisks = active
      .filter((p: any) => p.currentStage === 'QC')
      .filter((p: any) => {
        const rechecks = (p.qcHistory || []).filter((h: any) => h.status === 'failed').length;
        return rechecks > 0;
      })
      .map((p: any) => ({
        projectId: p.projectId || p.id,
        risk: `QC failed ${(p.qcHistory || []).filter((h: any) => h.status === 'failed').length} time(s)`,
      }));

    // Bottlenecks
    const stageCounts: Record<string, number> = {};
    active.forEach((p: any) => {
      const stage = p.currentStage || 'New';
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    });
    const bottlenecks = Object.entries(stageCounts)
      .filter(([, count]) => count > 5)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([stage]) => `${stage} (${stageCounts[stage]} projects)`);

    const recommendations: AiRecommendation[] = [];

    if (delayed.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'projects',
        type: 'alert',
        title: `${delayed.length} projects are delayed`,
        description: delayed.slice(0, 3).map((p) => `${p.projectId} — ${p.reason}`).join('\n'),
        severity: delayed.some((p) => p.delayDays > 10) ? 'critical' : 'warning',
        actionLabel: 'View Projects',
        actionLink: '/projects',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    if (qcRisks.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'projects',
        type: 'prediction',
        title: `${qcRisks.length} project(s) at QC risk`,
        description: `${qcRisks[0].projectId} — ${qcRisks[0].risk}`,
        severity: 'warning',
        actionLabel: 'View QC',
        actionLink: '/qc',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      data: { delayed: delayed.slice(0, 10), bottlenecks, qcRisks, recommendations },
      isLoading,
    };
  }, [projects, activeCompanyId, isLoading]);
}

// ── Finance Recommendations ──────────────────────────────

export function useFinanceRecommendations(): {
  data: FinanceRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices', activeCompanyId, 'ai-rec-finance'],
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!invoices) return { data: null, isLoading: true };

    const now = Date.now();
    const overdue = invoices.filter((inv: any) => {
      if (inv.isDeleted) return false;
      if (inv.paymentStatus === 'paid' || inv.paymentStatus === 'completed') return false;
      if (!inv.dueDate) return false;
      return new Date(inv.dueDate).getTime() < now;
    });

    const overdueAmount = overdue.reduce((sum: number, inv: any) => {
      return sum + safeNumber(inv.amount ?? inv.total ?? inv.grandTotal);
    }, 0);

    const recommendations: AiRecommendation[] = [];

    if (overdue.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'finance',
        type: 'alert',
        title: `${overdue.length} overdue invoices totaling ₹${overdueAmount.toLocaleString()}`,
        description: `Earliest overdue: ${overdue[0]?.invoiceNumber || overdue[0]?.id}`,
        severity: overdue.length > 5 ? 'critical' : 'warning',
        actionLabel: 'View Invoices',
        actionLink: '/invoices',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      data: {
        overdueCount: overdue.length,
        overdueAmount,
        cashflowTrend: overdue.length > 5 ? 'Needs attention' : 'Healthy',
        recommendations,
      },
      isLoading,
    };
  }, [invoices, isLoading]);
}

// ── Partner Recommendations ──────────────────────────────

export function usePartnerRecommendations(): {
  data: PartnerRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: partners, isLoading } = useQuery({
    queryKey: ['partners', activeCompanyId, 'ai-rec-partners'],
    queryFn: () => getAll<any>(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!partners) return { data: null, isLoading: true };

    const active = partners.filter((p: any) => !p.isDeleted);

    const tierOrder: Record<string, number> = {
      'Platinum': 4, 'Gold': 3, 'Silver': 2, 'Bronze': 1, 'Trial': 0,
    };
    const tierRevenueReq: Record<string, number> = {
      'Gold': 9200000, 'Silver': 5500000, 'Bronze': 2500000,
    };

    const tierUpgrades = active
      .filter((p: any) => {
        const currentTier = p.tier || p.status || 'Bronze';
        const currentLevel = tierOrder[currentTier] || 1;
        const nextTier = Object.entries(tierOrder).find(([, level]) => level === currentLevel + 1)?.[0];
        if (!nextTier) return false;
        const revenue = safeNumber(p.totalRevenue ?? p.revenue ?? p.totalSales ?? 0);
        const req = tierRevenueReq[nextTier] || 0;
        return req > 0 && revenue / req >= 0.7;
      })
      .map((p: any) => {
        const currentTier = p.tier || p.status || 'Bronze';
        const currentLevel = tierOrder[currentTier] || 1;
        const nextTier = Object.entries(tierOrder).find(([, level]) => level === currentLevel + 1)?.[0] || 'Gold';
        const revenue = safeNumber(p.totalRevenue ?? p.revenue ?? p.totalSales ?? 0);
        const req = tierRevenueReq[nextTier] || 9200000;
        return {
          partnerName: p.name || p.firmName || p.id,
          currentTier,
          targetTier: nextTier,
          progress: Math.round((revenue / req) * 100),
        };
      })
      .sort((a, b) => b.progress - a.progress);

    const recommendations: AiRecommendation[] = [];

    if (tierUpgrades.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'partners',
        type: 'prediction',
        title: `${tierUpgrades.length} partner(s) approaching tier upgrade`,
        description: `${tierUpgrades[0].partnerName} is at ${tierUpgrades[0].progress}% towards ${tierUpgrades[0].targetTier}`,
        severity: 'info',
        actionLabel: 'View Partners',
        actionLink: '/partners',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      data: { tierUpgrades, recommendations },
      isLoading,
    };
  }, [partners, isLoading]);
}

// ── Monitoring Recommendations ───────────────────────────

export function useMonitoringRecommendations(): {
  data: MonitoringRecommendations | null;
  isLoading: boolean;
} {
  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: readings, isLoading } = useQuery({
    queryKey: ['monitoring', activeCompanyId, 'ai-rec-monitoring'],
    queryFn: () => getAll<any>(COLLECTIONS.GENERATION_READINGS),
    staleTime: 120_000,
    enabled: isAuthorized,
  });

  return useMemo(() => {
    if (!readings) return { data: null, isLoading: true };

    const active = readings.filter((r: any) => r.companyId === activeCompanyId && !r.isDeleted);
    const offline = active.filter((r: any) => r.status === 'offline' || r.status === 'inactive');
    const lowGen = active
      .filter((r: any) => {
        const gen = safeNumber(r.generation ?? r.dailyGeneration ?? r.currentGeneration ?? 0);
        const expected = safeNumber(r.expectedGeneration ?? r.expectedDaily ?? r.capacityKw ?? r.capacity);
        return expected > 0 && gen / expected < 0.5;
      })
      .map((r: any) => {
        const gen = safeNumber(r.generation ?? r.dailyGeneration ?? 0);
        const expected = safeNumber(r.expectedGeneration ?? r.expectedDaily ?? r.capacityKw ?? 1);
        return { projectId: r.projectId || r.id, actual: gen, expected };
      })
      .slice(0, 5);

    const recommendations: AiRecommendation[] = [];

    if (offline.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'monitoring',
        type: 'alert',
        title: `${offline.length} plant(s) offline`,
        description: `Immediate attention required for offline monitoring units.`,
        severity: 'critical',
        actionLabel: 'View Monitoring',
        actionLink: '/monitoring',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    if (lowGen.length > 0) {
      recommendations.push({
        id: generateId(),
        domain: 'monitoring',
        type: 'insight',
        title: `${lowGen.length} plant(s) generating below 50% capacity`,
        description: `${lowGen[0].projectId} generating ${lowGen[0].actual}/${lowGen[0].expected} kWh`,
        severity: 'warning',
        actionLabel: 'View Monitoring',
        actionLink: '/monitoring',
        source: 'statistical',
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      data: { offlineCount: offline.length, lowGeneration: lowGen, recommendations },
      isLoading,
    };
  }, [readings, isLoading]);
}
