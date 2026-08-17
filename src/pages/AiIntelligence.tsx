/**
 * P10-05 — AI Intelligence Dashboard
 *
 * BETA — Rule-based/statistical intelligence, not ML.
 * Displays: lead scoring, demand forecasting, project anomaly detection.
 */

import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Brain, Target, TrendingUp, AlertTriangle, BarChart3, Package,
  CheckCircle, Users, Zap, Bot, Sparkles, MessageSquare,
} from 'lucide-react';
import { useLeadScores, useDemandForecasts, useProjectAnomalies, useAiIntelligenceSummary } from '../features/ai/hooks/useAiIntelligence';
import { Card, CardHeader, CardTitle, CardBody, PageHeader, StatCard } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { AiAssistantChat } from '../features/ai/components/AiAssistantChat';
import { isAiMockMode } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';
import { isOwnerEmail } from '../lib/ownerAccess';

const TABS = ['Overview', 'Lead Scoring', 'Demand Forecast', 'Anomaly Detection', 'AI Command Center'] as const;
type Tab = typeof TABS[number];

function BetaBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
      <Zap className="h-3 w-3" /> BETA
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    low: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    insufficient_data: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[confidence] || colors.low}`}>
      {confidence === 'insufficient_data' ? 'Insufficient Data' : confidence.charAt(0).toUpperCase() + confidence.slice(1)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    info: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[severity] || colors.info}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function ScoreBandBadge({ band }: { band: string }) {
  const colors: Record<string, string> = {
    hot: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    warm: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    cold: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors[band] || colors.cold}`}>
      {band.charAt(0).toUpperCase() + band.slice(1)}
    </span>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'increasing') return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (trend === 'decreasing') return <TrendingUp className="h-4 w-4 text-red-500 rotate-180" />;
  if (trend === 'stable') return <CheckCircle className="h-4 w-4 text-blue-500" />;
  return <span className="text-xs text-[var(--color-text-muted)]">—</span>;
}

export default function AiIntelligence() {
  const currentUser = useAppStore((s) => s.user);
  // Phase 9D-A: Hard runtime guard — only Super Admin can access
  if (!isOwnerEmail(currentUser?.email)) {
    return <Navigate to="/" replace />;
  }

  const [tab, setTab] = useState<Tab>('Overview');
  const { scores, stats, isLoading: scoresLoading } = useLeadScores();
  const { forecasts, stockoutRisks, isLoading: forecastsLoading } = useDemandForecasts();
  const { anomalies, summary: anomalySummary, isLoading: anomalyLoading } = useProjectAnomalies();
  const { summary, isLoading: summaryLoading } = useAiIntelligenceSummary();

  const isLoading = scoresLoading || forecastsLoading || anomalyLoading || summaryLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Intelligence"
        subtitle="Rule-based intelligence — BETA"
        icon={<Brain className="h-5 w-5" />}
        breadcrumbs={['Home', 'AI Intelligence']}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </>}
      />

      {/* Tab strip */}
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[var(--color-bg-sunken)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === t
                ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ────────────────────────────────────── */}
      {tab === 'Overview' && (
        <div className="space-y-5 animate-fadeIn">
          <div className="bg-[var(--color-warning-light)] border border-[var(--color-warning)] rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-[var(--color-warning-text)] flex items-center gap-2">
              <Zap className="h-4 w-4" /> <BetaBadge /> — This dashboard displays rule-based and statistical intelligence only.
              Results will improve as more historical data accumulates.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link to="/ai-intelligence?tab=Lead+Scoring" onClick={() => setTab('Lead Scoring')}>
              <Card className="cursor-pointer hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-indigo-500" /> Lead Scoring <BetaBadge />
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {stats.totalScored === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">No leads to score</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-2xl font-bold">{stats.avgScore}<span className="text-sm font-normal text-[var(--color-text-muted)]"> avg score</span></p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{stats.hotLeads} Hot</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{stats.warmLeads} Warm</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{stats.coldLeads} Cold</span>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">{stats.totalScored} leads scored</p>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Link>

            <Link to="/ai-intelligence?tab=Demand+Forecast" onClick={() => setTab('Demand Forecast')}>
              <Card className="cursor-pointer hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-500" /> Demand Forecast <BetaBadge />
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {forecasts.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">No products to forecast</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-2xl font-bold">{forecasts.length}<span className="text-sm font-normal text-[var(--color-text-muted)]"> products forecasted</span></p>
                      <p className="text-sm">
                        <span className="text-red-600 font-semibold">{stockoutRisks.length}</span> product(s) at stockout risk
                      </p>
                      {stockoutRisks.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {stockoutRisks.slice(0, 5).map(f => (
                            <span key={f.productId} className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full">
                              {f.productName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            </Link>

            <Link to="/ai-intelligence?tab=Anomaly+Detection" onClick={() => setTab('Anomaly Detection')}>
              <Card className="cursor-pointer hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" /> Anomaly Detection <BetaBadge />
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {anomalies.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">No anomalies detected</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-2xl font-bold">{anomalies.length}<span className="text-sm font-normal text-[var(--color-text-muted)]"> anomaly(ies)</span></p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          {anomalySummary?.bySeverity.critical || 0} Critical
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          {anomalySummary?.bySeverity.high || 0} High
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {anomalySummary?.bySeverity.medium || 0} Medium
                        </span>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Link>
          </div>
        </div>
      )}

      {/* ── LEAD SCORING TAB ────────────────────────────────── */}
      {tab === 'Lead Scoring' && (
        <div className="space-y-5 animate-fadeIn">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-500" /> Lead Scoring Overview <BetaBadge />
              </CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <StatCard label="Total Leads" value={stats.totalScored} icon={<Target className="h-5 w-5" />} color="indigo" />
                <StatCard label="Hot Leads" value={stats.hotLeads} icon={<TrendingUp className="h-5 w-5" />} color="red" />
                <StatCard label="Warm Leads" value={stats.warmLeads} icon={<Zap className="h-5 w-5" />} color="amber" />
                <StatCard label="Cold Leads" value={stats.coldLeads} icon={<Users className="h-5 w-5" />} color="blue" />
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Average lead score: <strong>{stats.avgScore}</strong> / 100 &middot;
                Last evaluated: <strong>{new Date().toLocaleString()}</strong> &middot;
                Model: <strong>rule-v1</strong> (rule-based)
              </p>
            </CardBody>
          </Card>

          {/* Lead Score Results Table */}
          <Card>
            <CardHeader>
              <CardTitle>Scored Leads</CardTitle>
            </CardHeader>
            <CardBody>
              {scores.size === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No leads available for scoring</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                        <th className="pb-2 font-semibold">Score</th>
                        <th className="pb-2 font-semibold">Band</th>
                        <th className="pb-2 font-semibold">Confidence</th>
                        <th className="pb-2 font-semibold">Key Factors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(scores.entries()).sort(([, a], [, b]) => b.score - a.score).slice(0, 50).map(([id, result]) => (
                        <tr key={id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-16 rounded-full ${
                                result.score >= 70 ? 'bg-red-500' : result.score >= 40 ? 'bg-amber-500' : 'bg-blue-500'
                              }`} style={{ opacity: 0.3 }} />
                              <span className="font-bold tabular-nums">{result.score}</span>
                            </div>
                          </td>
                          <td className="py-2"><ScoreBandBadge band={result.band} /></td>
                          <td className="py-2"><ConfidenceBadge confidence={result.confidence} /></td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              {result.factors.slice(0, 3).map((f: any, i: number) => (
                                <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${
                                  f.score > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                                }`}>
                                  {f.score > 0 ? '+' : ''}{f.score} {f.label}
                                </span>
                              ))}
                              {result.factors.length > 3 && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  +{result.factors.length - 3} more
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── DEMAND FORECAST TAB ─────────────────────────────── */}
      {tab === 'Demand Forecast' && (
        <div className="space-y-5 animate-fadeIn">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4 text-amber-500" /> Demand Forecast <BetaBadge />
              </CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Statistical forecasts using weighted moving averages based on historical dispatch data.
                Not ML predictions. Forecasts improve with more historical data.
              </p>
            </CardBody>
          </Card>

          {stockoutRisks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-4 w-4" /> Stockout Risk Alerts
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="space-y-3">
                  {stockoutRisks.slice(0, 10).map(f => (
                    <div key={f.productId} className="border border-[var(--color-border-subtle)] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <Link to={`/products?open=${encodeURIComponent(f.productId)}`} className="font-semibold hover:text-indigo-600">
                            {f.productName}
                          </Link>
                          <p className="text-xs text-[var(--color-text-muted)]">{f.forecastPeriod}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-red-600 tabular-nums">{f.stockoutRisk}<span className="text-xs font-normal">/100</span></p>
                          <p className="text-xs text-[var(--color-text-muted)]">stockout risk</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                        <span>Forecast: <strong>{f.forecastQty}</strong> {f.unit}</span>
                        <span>Trend: <TrendIcon trend={f.trend} /></span>
                        <ConfidenceBadge confidence={f.confidence} />
                      </div>
                      {f.reorderRecommendation && (
                        <div className="mt-2 text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded">
                          <p className="font-semibold text-red-700 dark:text-red-400">Reorder Recommendation</p>
                          <p className="text-red-600 dark:text-red-400">Order {f.reorderRecommendation.recommendedQty} {f.unit}</p>
                          <p className="text-[var(--color-text-muted)]">{f.reorderRecommendation.reason}</p>
                        </div>
                      )}
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">{f.explanation}</p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>All Product Forecasts</CardTitle>
            </CardHeader>
            <CardBody>
              {forecasts.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No products available for forecasting</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                        <th className="pb-2 font-semibold">Product</th>
                        <th className="pb-2 font-semibold">Forecast</th>
                        <th className="pb-2 font-semibold">Trend</th>
                        <th className="pb-2 font-semibold">Confidence</th>
                        <th className="pb-2 font-semibold">Stockout Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecasts.slice(0, 30).map(f => (
                        <tr key={f.productId} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                          <td className="py-2">
                            <Link to={`/products?open=${encodeURIComponent(f.productId)}`} className="font-semibold hover:text-indigo-600">
                              {f.productName}
                            </Link>
                            <p className="text-xs text-[var(--color-text-muted)]">{f.unit}</p>
                          </td>
                          <td className="py-2">
                            <span className="font-bold tabular-nums">{f.forecastQty}</span>
                            <span className="text-xs text-[var(--color-text-muted)]"> {f.unit}</span>
                            <p className="text-xs text-[var(--color-text-muted)]">{f.forecastPeriod}</p>
                          </td>
                          <td className="py-2"><TrendIcon trend={f.trend} /></td>
                          <td className="py-2"><ConfidenceBadge confidence={f.confidence} /></td>
                          <td className="py-2">
                            {f.confidence === 'insufficient_data' ? (
                              <span className="text-xs text-[var(--color-text-muted)]">—</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-12 rounded-full ${
                                  f.stockoutRisk >= 70 ? 'bg-red-500' : f.stockoutRisk >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`} style={{ opacity: 0.3 }} />
                                <span className={`text-xs font-bold tabular-nums ${
                                  f.stockoutRisk >= 70 ? 'text-red-600' : f.stockoutRisk >= 40 ? 'text-amber-600' : 'text-emerald-600'
                                }`}>{f.stockoutRisk}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── ANOMALY DETECTION TAB ──────────────────────────── */}
      {tab === 'Anomaly Detection' && (
        <div className="space-y-5 animate-fadeIn">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" /> Project Anomaly Detection <BetaBadge />
              </CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Heuristic anomaly detection comparing project behavior against historical norms.
                Complements P10-03 Auto-Reminders (threshold-based). Not ML.
              </p>
              {anomalySummary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <StatCard label="Total Anomalies" value={anomalySummary.totalAnomalies} icon={<AlertTriangle className="h-5 w-5" />} color="orange" />
                  <StatCard label="Critical" value={anomalySummary.bySeverity.critical} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
                  <StatCard label="High" value={anomalySummary.bySeverity.high} icon={<AlertTriangle className="h-5 w-5" />} color="orange" />
                  <StatCard label="Medium" value={anomalySummary.bySeverity.medium} icon={<AlertTriangle className="h-5 w-5" />} color="amber" />
                  <StatCard label="Low" value={anomalySummary.bySeverity.low} icon={<AlertTriangle className="h-5 w-5" />} color="blue" />
                </div>
              )}
            </CardBody>
          </Card>

          {/* Anomaly Details */}
          <div className="space-y-3">
            {anomalies.length === 0 ? (
              <Card>
                <CardBody>
                  <div className="text-center py-8">
                    <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold">No Anomalies Detected</p>
                    <p className="text-xs text-[var(--color-text-muted)]">All projects are within expected behavior patterns.</p>
                  </div>
                </CardBody>
              </Card>
            ) : (
              anomalies.slice(0, 30).map(a => (
                <Card key={a.id}>
                  <CardBody>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Link to={`/projects/${encodeURIComponent(a.projectId)}`} className="font-semibold hover:text-indigo-600">
                            {a.projectName}
                          </Link>
                          <SeverityBadge severity={a.severity} />
                          <ConfidenceBadge confidence={a.confidence} />
                        </div>
                        <p className="text-sm text-[var(--color-text)]">{a.explanation}</p>
                        <div className="mt-2 space-y-1">
                          {a.evidence.map((e, i) => (
                            <p key={i} className="text-xs text-[var(--color-text-muted)]">
                              <strong>{e.metric}:</strong> Expected: {e.expected} &middot; Observed: {e.observed}
                            </p>
                          ))}
                        </div>
                        <div className="mt-2">
                          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Recommended action:</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{a.recommendedAction}</p>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── AI COMMAND CENTER TAB ──────────────────────────── */}
      {tab === 'AI Command Center' && (
        <div className="animate-fadeIn">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-indigo-500" /> AI Command Center
                {isAiMockMode() && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ml-2">
                    Demo Mode
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Ask natural language questions about your ERP data. The AI analyzes sales, projects, finance, procurement, partners, and monitoring data.
                {isAiMockMode() ? ' Currently in Demo Mode with pre-built responses. Configure VITE_OPENAI_API_KEY or VITE_GEMINI_API_KEY for real AI.' : ''}
              </p>
              <div className="border border-[var(--color-border)] rounded-xl overflow-hidden" style={{ minHeight: '400px' }}>
                <AiAssistantChat />
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
