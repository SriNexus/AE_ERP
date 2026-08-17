/**
 * useAiAssistant.ts — AI Assistant Hook (Phase 9D)
 *
 * Provides a unified hook for querying AI across all Solar EPC domains.
 * Supports natural language queries like:
 *   - "Show overdue invoices"
 *   - "Which projects are delayed?"
 *   - "Which leads need follow-up?"
 *   - "Predict low stock"
 *
 * Architecture:
 *   - Uses aiService.ts for provider-agnostic AI queries
 *   - Combines loaded Firestore data as context with LLM queries
 *   - Fall back to mock responses in demo mode
 *   - No Firestore writes ever
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { queryAi, isAiMockMode, isAiAvailable } from '../../../services/aiService';
import { isOfficialDemoCompany } from '../../../config/demo';
import { isOwnerEmail } from '../../../lib/ownerAccess';

// ── Types ─────────────────────────────────────────────────

export type AssistantDomain =
  | 'sales'
  | 'procurement'
  | 'projects'
  | 'finance'
  | 'partners'
  | 'monitoring'
  | 'audit'
  | 'loan_applications'
  | 'universal';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  domain?: AssistantDomain;
}

export interface AiAssistantState {
  messages: ChatMessage[];
  isProcessing: boolean;
  error: string | null;
  domain: AssistantDomain;
}

// ── System Prompts ────────────────────────────────────────

const SYSTEM_PROMPTS: Record<AssistantDomain, string> = {
  sales: `You are a Sales AI Assistant for a solar EPC company. Analyze lead data, provide lead scoring insights, 
identify follow-up priorities, suggest next actions for hot leads, and predict win probability. 
Focus on: lead quality, conversion likelihood, follow-up recommendations, and pipeline health.
Keep responses concise and actionable. Use bullet points where helpful.`,

  procurement: `You are a Procurement AI Assistant for a solar EPC company. Analyze inventory data, 
predict stock shortages, recommend reorder quantities, identify supply chain delays, 
and suggest vendor prioritization. Focus on: stockout risks, reorder recommendations, 
and material availability. Keep responses concise and actionable.`,

  projects: `You are a Project AI Assistant for a solar EPC company. Analyze project data, 
detect delays, predict bottlenecks, identify QC risks, recommend resource reallocation, 
and track installation progress. Focus on: stage duration anomalies, delay patterns, 
and risk mitigation. Keep responses concise and actionable.`,

  finance: `You are a Finance AI Assistant for a solar EPC company. Analyze invoice data, 
track overdue payments, provide cashflow insights, detect payment patterns, 
and suggest collection priorities. Focus on: overdue invoices, cashflow health, 
and payment trends. Keep responses concise and actionable.`,

  partners: `You are a Partner AI Assistant for a solar EPC company. Analyze partner performance data, 
predict tier upgrades, detect unusual patterns, recommend partner engagement strategies, 
and identify top performers. Focus on: tier progression, performance metrics, 
and partner growth opportunities. Keep responses concise and actionable.`,

  monitoring: `You are a Monitoring AI Assistant for a solar EPC company. Analyze plant generation data, 
detect offline plants, identify low generation alerts, predict maintenance needs, 
and recommend technician dispatch. Focus on: plant health, generation anomalies, 
and proactive maintenance. Keep responses concise and actionable.`,

  audit: `You are an Audit AI Assistant for Neozy ERP. Analyze audit logs and security logs to identify
patterns, anomalies, and risks. Provide insights on: most active users, top modified modules, 
suspicious activity, failed actions, daily activity trends, security anomalies, 
unauthorized access attempts, and permission/role changes. 
Focus on: security posture, compliance, and operational transparency.
Keep responses concise and structured. Use bullet points for findings.
Highlight anything unusual or potentially malicious.`,

  loan_applications: `You are a Loan Applications AI Assistant for a solar EPC company's loan/banking module. 
Analyze loan application data to answer questions about: fastest bank approval times, delayed loan applications, 
approval rates by bank, top-performing employees for loan applications, pending payment cases, 
and bank performance metrics. Focus on: bank approval patterns, loan application bottlenecks, 
payment readiness, and employee performance. Keep responses concise and actionable.`,

  universal: `You are the Universal AI Assistant for Neozy ERP — a solar EPC business operating system.
You have access to data across all domains: sales, procurement, projects, finance, partners, monitoring, 
and loan applications. Provide comprehensive insights, identify cross-domain patterns, and recommend data-driven actions.
Never write to databases. Only analyze and recommend.
Keep responses concise, structured, and actionable.`,
};

// ── Context Builders ──────────────────────────────────────

function buildContextSummary(
  domain: AssistantDomain,
  data: Record<string, any[]>,
): string {
  const parts: string[] = [];

  if (domain === 'sales' || domain === 'universal') {
    const leads = data.leads || [];
    parts.push(`Leads: ${leads.filter((l: any) => !l.isDeleted).length} active`);
  }
  if (domain === 'procurement' || domain === 'universal') {
    const stock = data.stock || [];
    const products = data.products || [];
    parts.push(`Stock: ${stock.length} records · Products: ${products.filter((p: any) => !p.isDeleted).length}`);
  }
  if (domain === 'projects' || domain === 'universal') {
    const projects = data.projects || [];
    parts.push(`Projects: ${projects.filter((p: any) => !p.isDeleted).length} active`);
  }
  if (domain === 'finance' || domain === 'universal') {
    const invoices = data.invoices || [];
    const overdue = invoices.filter((i: any) => i.paymentStatus !== 'paid' && i.paymentStatus !== 'completed');
    parts.push(`Invoices: ${invoices.length} total · ${overdue.length} unpaid`);
  }
  if (domain === 'partners' || domain === 'universal') {
    const partners = data.partners || [];
    parts.push(`Partners: ${partners.filter((p: any) => !p.isDeleted).length} active`);
  }
  if (domain === 'monitoring' || domain === 'universal') {
    const readings = data.readings || [];
    const offline = readings.filter((r: any) => r.status === 'offline').length;
    parts.push(`Monitoring: ${readings.length} plants · ${offline} offline`);
  }
  if (domain === 'audit' || domain === 'universal') {
    const auditLogs = data.auditLogs || [];
    const today = new Date().toDateString();
    const todayLogs = auditLogs.filter((l: any) => l.timestamp && new Date(l.timestamp).toDateString() === today);
    const securityEvents = auditLogs.filter((l: any) => l.severity === 'critical' || l.action === 'security_event' || l.action === 'unauthorized_access');
    const failures = auditLogs.filter((l: any) => l.status === 'failure' || l.severity === 'danger');
    const actions = auditLogs.reduce((acc: Record<string, number>, l: any) => { acc[l.action] = (acc[l.action] || 0) + 1; return acc; }, {});
    const topAction = Object.entries(actions).sort(([, a], [, b]) => b - a)[0];
    parts.push(`Audit: ${auditLogs.length} total logs · ${todayLogs.length} today · ${securityEvents.length} security events · ${failures.length} failures`);
    if (topAction) parts.push(`Most common action: ${topAction[0]} (${topAction[1]} times)`);
  }
  if (domain === 'loan_applications' || domain === 'universal') {
    const registrations = data.registrations || [];
    const pending = registrations.filter((r: any) => ['Under Review', 'Bank Submission Pending', 'Submitted To Bank'].includes(r.status)).length;
    const approved = registrations.filter((r: any) => ['Approved', 'Payment Received', 'Closed'].includes(r.status)).length;
    const rejected = registrations.filter((r: any) => r.status === 'Rejected').length;
    const paymentPending = registrations.filter((r: any) => r.status === 'Approved').length;
    const banks = new Set(registrations.map((r: any) => r.bankName).filter(Boolean));
    parts.push(`Loan Applications: ${registrations.length} total · ${pending} pending · ${approved} approved · ${rejected} rejected · ${paymentPending} payment pending`);
    if (banks.size > 0) parts.push(`Banks: ${[...banks].join(', ')}`);
  }

  return parts.join(' | ');
}

// ── Hook ──────────────────────────────────────────────────

export function useAiAssistant(initialDomain: AssistantDomain = 'universal') {
  const [state, setState] = useState<AiAssistantState>({
    messages: [],
    isProcessing: false,
    error: null,
    domain: initialDomain,
  });

  const currentUser = useAppStore((s) => s.user);
  const isAuthorized = isOwnerEmail(currentUser?.email);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const isDemo = isOfficialDemoCompany(useAppStore((s) => s.user?.companyId));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Phase 9E: Load audit logs for the audit domain
  const { data: auditLogs } = useQuery({
    queryKey: ['audit-logs', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.AUDIT_LOGS).catch(() => []),
    staleTime: 120_000,
    enabled: isAuthorized && (state.domain === 'audit' || state.domain === 'universal'),
  });

  // Load all relevant data for context — only if authorized
  const { data: leads } = useQuery({
    queryKey: [...(keys.leadsRoot || ['leads']), 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'sales' || state.domain === 'universal'),
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.PRODUCTS).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'procurement' || state.domain === 'universal'),
  });

  const { data: stock } = useQuery({
    queryKey: ['stock', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.STOCK).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'procurement' || state.domain === 'universal'),
  });

  const { data: projects } = useQuery({
    queryKey: [...(keys.projectsRoot || ['projects']), 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'projects' || state.domain === 'universal'),
  });

  const { data: invoices } = useQuery({
    queryKey: ['invoices', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'finance' || state.domain === 'universal'),
  });

  const { data: partners } = useQuery({
    queryKey: ['partners', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.CHANNEL_PARTNERS).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'partners' || state.domain === 'universal'),
  });

  const { data: readings } = useQuery({
    queryKey: ['monitoring', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.GENERATION_READINGS).catch(() => []),
    staleTime: 120_000,
    enabled: isAuthorized && (state.domain === 'monitoring' || state.domain === 'universal'),
  });

  const { data: registrations } = useQuery({
    queryKey: ['registrations', activeCompanyId, 'ai-chat'],
    queryFn: () => getAll<any>(COLLECTIONS.LOAN_APPLICATIONS).catch(() => []),
    staleTime: 60_000,
    enabled: isAuthorized && (state.domain === 'loan_applications' || state.domain === 'universal'),
  });

  const setDomain = useCallback((domain: AssistantDomain) => {
    setState((prev) => ({ ...prev, domain, messages: [], error: null }));
  }, []);

  // Phase 9D-A: Guard against unauthorized AI API calls
  const isAuthorizedRef = useRef(isAuthorized);
  isAuthorizedRef.current = isAuthorized;

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Phase 9D-A: Only Super Admin can query AI — prevent any API call
    if (!isAuthorizedRef.current) {
      setState((prev) => ({ ...prev, error: 'Unauthorized access', isProcessing: false }));
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      domain: state.domain,
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isProcessing: true,
      error: null,
    }));

    // Build context from loaded data
    const contextData: Record<string, any[]> = {
      auditLogs: auditLogs || [],
      leads: leads || [],
      products: products || [],
      stock: stock || [],
      projects: projects || [],
      invoices: invoices || [],
      partners: partners || [],
      readings: readings || [],
      registrations: registrations || [],
    };

    const contextSummary = buildContextSummary(state.domain, contextData);

    try {
      const systemPrompt = `${SYSTEM_PROMPTS[state.domain]}\n\nCurrent data context:\n${contextSummary}\n\nRemember: You are analyzing real ERP data. Be specific. Never write to databases.`;
      const response = await queryAi({ prompt: content, systemPrompt });

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        domain: state.domain,
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
        isProcessing: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : 'Failed to get AI response',
      }));
    }
  }, [state.domain, leads, products, stock, projects, invoices, partners, readings, auditLogs, registrations]);

  const clearMessages = useCallback(() => {
    setState((prev) => ({ ...prev, messages: [], error: null }));
  }, []);

  return {
    ...state,
    setDomain,
    sendMessage,
    clearMessages,
    messagesEndRef,
    isAvailable: isAiAvailable(),
    isMockMode: isAiMockMode() || isDemo,
  };
}

export default useAiAssistant;
