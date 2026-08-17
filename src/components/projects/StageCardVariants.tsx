import { Activity, CalendarCheck, ClipboardCheck, CreditCard, Handshake, HardHat, ShoppingCart, Truck, Wrench, Zap, Building2, CheckCircle2, Landmark, DollarSign, ReceiptText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmtCurrency, fmtDate } from '../../lib/firestore';
import { cn } from '../../utils/cn';
import type { PurchaseOrderRecord, GoodsReceiptRecord } from '../../features/procurement/types';
import type { QCRecord } from '../../lib/qcWorkflow';
import type { CommissioningRecord } from '../../lib/commissioningWorkflow';
import type { NetMeteringApplication } from '../../lib/netMeteringWorkflow';
import type { SubsidyApplication } from '../../lib/subsidyWorkflow';
import type { TaxInvoiceRecord } from '../../features/tax-invoices/types';
import type { PaymentRecord } from '../../features/payment/types';
import type { HandoverRecord } from '../../features/project-handover/types';
import type { AmcContractRecord } from '../../features/amc/types';
import type { ServiceTicketRecord } from '../../features/service-tickets/types';
import type { GenerationReadingRecord } from '../../features/monitoring/types';
import type { ProjectWorkspaceStage } from '../../hooks/useProjectStage';
import { Badge } from '../ui/Badge';
import { StageCard } from '../shared/StageCard';
import { CollapsibleSection } from './ProjectJourneyTimeline';

export function ProjectStageCards({ stages, showAmc = false, purchaseOrders = [], goodsReceipts = [], installations = [], qcChecks = [], commissioningRecords = [],  netMeteringApplications = [], subsidyApplications = [], taxInvoices = [], payments = [], handovers = [], amcContracts = [], serviceTickets = [], generationReadings = [], dispatches = [] }: {
  stages: ProjectWorkspaceStage[];
  showAmc?: boolean;
  purchaseOrders?: PurchaseOrderRecord[];
  goodsReceipts?: GoodsReceiptRecord[];
  installations?: Record<string, unknown>[];
  qcChecks?: QCRecord[];
  commissioningRecords?: CommissioningRecord[];
  netMeteringApplications?: NetMeteringApplication[];
  subsidyApplications?: SubsidyApplication[];
  taxInvoices?: TaxInvoiceRecord[];
  payments?: PaymentRecord[];
  handovers?: HandoverRecord[];
  amcContracts?: AmcContractRecord[];
  serviceTickets?: ServiceTicketRecord[];
  generationReadings?: GenerationReadingRecord[];
  dispatches?: Record<string, unknown>[];
}) {
  const filteredStages = stages.filter((stage) => stage.id !== 'amc' || showAmc);
  const activeIdx = (() => {
    const idx = filteredStages.findIndex((s) => s.status === 'current' || s.status === 'attention' || s.status === 'blocked');
    return idx >= 0 ? idx : filteredStages.length - 1;
  })();

  const rendered = filteredStages.map((stage, idx) => {
    const role: 'past' | 'previous' | 'current' | 'next' | 'future' =
      idx === activeIdx ? 'current' :
      idx === activeIdx - 1 ? 'previous' :
      idx === activeIdx + 1 ? 'next' :
      idx < activeIdx ? 'past' : 'future';

    return { role, node: (
        <div key={stage.id} id={stage.projectStage === 'Installation' ? 'project-schedule-stage' : undefined}>
        <StageCard
          title={stage.title}
          description={stage.description}
          status={stage.status}
          href={stage.href}
          meta={stage.href && stage.projectStage !== 'Procurement' ? 'Open the existing module in project context' : undefined}
        >
          {stage.projectStage === 'Procurement' && purchaseOrders.length > 0 && (
            <div className="mt-2 space-y-2">
              {purchaseOrders.slice(0, 5).map((po) => {
                const relatedReceipts = goodsReceipts.filter((gr) => gr.purchaseOrderId === po.id);
                return (
                  <Link
                    key={po.id}
                    to={`/purchase-orders`}
                    className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                  >
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{po.purchaseOrderId}</p>
                        <p className="text-[var(--color-text-muted)]">{po.vendorName} · Due {fmtDate(po.expectedDeliveryDate)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--color-text-secondary)]">{fmtCurrency(po.total)}</span>
                      <Badge variant={
                        po.status === 'Received' ? 'success' :
                        po.status === 'PartiallyReceived' ? 'warning' :
                        po.status === 'Sent' ? 'info' :
                        po.status === 'Cancelled' ? 'danger' : 'gray'
                      }>{po.status}</Badge>
                    </div>
                  </Link>
                );
              })}
              {purchaseOrders.length > 5 && (
                <Link to={`/purchase-orders`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{purchaseOrders.length - 5} more purchase orders
                </Link>
              )}
              {purchaseOrders.length > 0 && goodsReceipts.length > 0 && (
                <p className="pt-1 text-xs text-[var(--color-text-muted)]">
                  {goodsReceipts.length} goods receipt{goodsReceipts.length > 1 ? 's' : ''} recorded
                </p>
              )}
            </div>
          )}
          {stage.projectStage === 'Procurement' && purchaseOrders.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No purchase orders linked to this project yet.</p>
          )}

          {stage.projectStage === 'Installation' && installations.length > 0 && (
            <div className="mt-2 space-y-2">
              {installations.slice(0, 5).map((inst) => {
                const status = String(inst.installationStatus || '');
                const engineer = String(inst.assignedEngineerName || '');
                const scheduled = String(inst.scheduledDate || '');
                return (
                  <Link
                    key={String(inst.id)}
                    to={`/installations`}
                    className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                  >
                    <div className="flex items-center gap-2">
                      <HardHat className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{String(inst.name || inst.id || '')}</p>
                        <p className="text-[var(--color-text-muted)]">
                          {engineer ? `${engineer}` : ''}
                          {scheduled ? ` · ${fmtDate(scheduled)}` : ''}
                        </p>
                      </div>
                    </div>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      status === 'completed' || status === 'customer_handover'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    )}>
                      {status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                  </Link>
                );
              })}
              {installations.length > 5 && (
                <Link to={`/installations`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{installations.length - 5} more installations
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'Installation' && installations.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No installations linked to this project yet.</p>
          )}

          {stage.projectStage === 'QC' && qcChecks.length > 0 && (
            <div className="mt-2 space-y-2">
              {qcChecks.slice(0, 5).map((qc) => {
                const totalItems = qc.totalItems ?? (qc.checklistItems ?? []).length;
                const passRate = totalItems > 0 ? Math.round((qc.passedCount ?? 0) / totalItems * 100) : 0;
                return (
                  <Link
                    key={qc.id}
                    to={`/qc`}
                    className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{qc.id}</p>
                        <p className="text-[var(--color-text-muted)]">
                          {qc.inspectorName} · {qc.passedCount ?? 0}/{qc.totalItems ?? 0} passed
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Pass rate bar */}
                      <div className="h-1.5 w-12 rounded-full bg-[var(--color-bg-sunken)]">
                        <div
                          className={qc.status === 'passed'
                            ? 'h-full rounded-full bg-emerald-500'
                            : qc.status === 'failed'
                              ? 'h-full rounded-full bg-red-500'
                              : 'h-full rounded-full bg-amber-500'
                          }
                          style={{ width: `${passRate}%` }}
                        />
                      </div>
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                        qc.status === 'passed' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                        qc.status === 'failed' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                        qc.status === 'in_progress' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                        qc.status === 'pending' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                      )}>{qc.status}</span>
                    </div>
                  </Link>
                );
              })}
              {qcChecks.length > 5 && (
                <Link to={`/qc`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{qcChecks.length - 5} more quality checks
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'QC' && qcChecks.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No quality checks performed yet.</p>
          )}

          {stage.projectStage === 'Commissioning' && commissioningRecords.length > 0 && (
            <div className="mt-2 space-y-2">
              {commissioningRecords.slice(0, 5).map((cr) => (
                <Link
                  key={cr.id}
                  to={`/commissioning`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-emerald-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{cr.id}</p>
                      <p className="text-[var(--color-text-muted)]">
                        {cr.commissionedByName} · {cr.generationTestKwh} kWh
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                    cr.isCompleted
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  )}>
                    {cr.isCompleted ? 'Completed' : 'Pending'}
                  </span>
                </Link>
              ))}
              {commissioningRecords.length > 5 && (
                <Link to={`/commissioning`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{commissioningRecords.length - 5} more commissioning records
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'Commissioning' && commissioningRecords.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No commissioning records yet.</p>
          )}

          {stage.projectStage === 'NetMetering' && netMeteringApplications.length > 0 && (
            <div className="mt-2 space-y-2">
              {netMeteringApplications.slice(0, 5).map((nm) => (
                <Link
                  key={nm.id}
                  to={`/net-metering`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{nm.applicationNumber}</p>
                      <p className="text-[var(--color-text-muted)]">{nm.discomName}</p>
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                    nm.status === 'MeterInstalled' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                    nm.status === 'Approved' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                    nm.status === 'Rejected' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    (nm.status === 'Submitted' || nm.status === 'UnderReview') && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                  )}>
                    {nm.status === 'MeterInstalled' && <CheckCircle2 className="mr-1 h-2.5 w-2.5" />}
                    {nm.status === 'UnderReview' ? 'Under Review' : nm.status}
                  </span>
                </Link>
              ))}
              {netMeteringApplications.length > 5 && (
                <Link to={`/net-metering`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{netMeteringApplications.length - 5} more applications
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'NetMetering' && netMeteringApplications.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No net metering applications yet.</p>
          )}

          {stage.projectStage === 'Subsidy' && subsidyApplications.length > 0 && (
            <div className="mt-2 space-y-2">
              {subsidyApplications.slice(0, 5).map((sub) => (
                <Link
                  key={sub.id}
                  to={`/subsidy`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Landmark className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{sub.schemeName}</p>
                      <p className="text-[var(--color-text-muted)]">{sub.applicationNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {sub.totalSanctionedAmount !== undefined && sub.totalSanctionedAmount > 0 && (
                      <span className="text-[10px] font-medium text-emerald-600">
                        <DollarSign className="inline h-2.5 w-2.5" />
                        {sub.totalSanctionedAmount}
                      </span>
                    )}
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      sub.status === 'Disbursed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                      sub.status === 'Approved' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                      sub.status === 'Rejected' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                      sub.status === 'Draft' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                      (sub.status === 'Submitted' || sub.status === 'UnderReview') && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                    )}>
                      {sub.status === 'UnderReview' ? 'Under Review' : sub.status}
                    </span>
                  </div>
                </Link>
              ))}
              {subsidyApplications.length > 5 && (
                <Link to={`/subsidy`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{subsidyApplications.length - 5} more applications
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'Subsidy' && subsidyApplications.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No subsidy applications yet.</p>
          )}

          {stage.projectStage === 'Handover' && taxInvoices.length > 0 && (
            <div className="mt-2 space-y-2">
              {taxInvoices.slice(0, 5).map((inv) => (
                <Link
                  key={inv.id}
                  to={`/tax-invoices`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <ReceiptText className="h-3.5 w-3.5 text-indigo-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{inv.invoiceNumber || inv.id}</p>
                      <p className="text-[var(--color-text-muted)]">{inv.customerName} · {inv.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium">{fmtCurrency(inv.total)}</span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      inv.status === 'Issued' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                      inv.status === 'Draft' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                      inv.status === 'Cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    )}>
                      {inv.status}
                    </span>
                  </div>
                </Link>
              ))}
              {taxInvoices.length > 5 && (
                <Link to={`/tax-invoices`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{taxInvoices.length - 5} more invoices
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'Handover' && taxInvoices.length === 0 && payments.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No tax invoices yet.</p>
          )}

          {stage.projectStage === 'Handover' && payments.length > 0 && (
            <div className="mt-2 space-y-2">
              {payments.slice(0, 5).map((payment) => (
                <Link
                  key={payment.id}
                  to={`/payments`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{payment.id}</p>
                      <p className="text-[var(--color-text-muted)]">{payment.customerName} · {payment.mode}{payment.date ? ` · ${fmtDate(payment.date)}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-emerald-600">{fmtCurrency(payment.amount)}</span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      payment.status === 'Verified' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                      payment.status === 'Received' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                      payment.status === 'Pending' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                      payment.status === 'Cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    )}>
                      {payment.status}
                    </span>
                  </div>
                </Link>
              ))}
              {payments.length > 5 && (
                <Link to={`/payments`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{payments.length - 5} more payments
                </Link>
              )}
            </div>
          )}

          {stage.projectStage === 'Handover' && handovers.length > 0 && (
            <div className="mt-2 space-y-2">
              {handovers.slice(0, 5).map((h) => (
                <Link
                  key={h.id}
                  to={`/handovers`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Handshake className="h-3.5 w-3.5 text-indigo-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{h.handoverNumber}</p>
                      <p className="text-[var(--color-text-muted)]">{h.customerName} · {h.handoverDate ? fmtDate(h.handoverDate) : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {h.assignedEngineerName && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">{h.assignedEngineerName}</span>
                    )}
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      h.status === 'Completed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                      h.status === 'Scheduled' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                      h.status === 'Draft' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                      h.status === 'Cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    )}>
                      {h.status}
                    </span>
                  </div>
                </Link>
              ))}
              {handovers.length > 5 && (
                <Link to={`/handovers`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{handovers.length - 5} more handovers
                </Link>
              )}
            </div>
          )}

          {stage.projectStage === 'AMC' && amcContracts.length > 0 && (
            <div className="mt-2 space-y-2">
              {amcContracts.slice(0, 5).map((c) => (
                <Link
                  key={c.id}
                  to={`/amc-contracts`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{c.contractNumber}</p>
                      <p className="text-[var(--color-text-muted)]">{c.customerName} · {fmtDate(c.startDate)} – {fmtDate(c.endDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-emerald-600">{fmtCurrency(c.contractValue)}</span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      c.status === 'Active' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                      c.status === 'Expired' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                      c.status === 'Draft' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                      c.status === 'Cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    )}>
                      {c.status}
                    </span>
                  </div>
                </Link>
              ))}
              {amcContracts.length > 5 && (
                <Link to={`/amc-contracts`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{amcContracts.length - 5} more contracts
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'AMC' && amcContracts.length === 0 && serviceTickets.length === 0 && generationReadings.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No AMC contracts yet.</p>
          )}

          {stage.projectStage === 'AMC' && generationReadings.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Generation Readings</p>
              {generationReadings.slice(0, 5).map((r) => (
                <Link
                  key={r.id}
                  to={`/monitoring`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5 text-emerald-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{fmtDate(r.readingDate)}</p>
                      <p className="text-[var(--color-text-muted)]">{r.projectName || (r.projectId ?? '').slice(0, 8)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      <Zap className="mr-0.5 h-2.5 w-2.5" />
                      {r.readingKwh} kWh
                    </span>
                  </div>
                </Link>
              ))}
              {generationReadings.length > 5 && (
                <Link to={`/monitoring`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{generationReadings.length - 5} more readings
                </Link>
              )}
            </div>
          )}

          {stage.projectStage === 'AMC' && serviceTickets.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Service Tickets</p>
              {serviceTickets.slice(0, 5).map((t) => (
                <Link
                  key={t.id}
                  to={`/service-tickets`}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 text-purple-500" />
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{t.ticketNumber}</p>
                      <p className="text-[var(--color-text-muted)]">{t.issueType} · {t.customerName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      t.priority === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                      t.priority === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                      t.priority === 'Medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}>{t.priority}</span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                      t.status === 'Closed' || t.status === 'Resolved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      t.status === 'Cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                      t.status === 'InProgress' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    )}>
                      {t.status === 'InProgress' ? 'In Progress' : t.status}
                    </span>
                  </div>
                </Link>
              ))}
              {serviceTickets.length > 5 && (
                <Link to={`/service-tickets`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{serviceTickets.length - 5} more tickets
                </Link>
              )}
            </div>
          )}

          {stage.projectStage === 'Dispatch' && dispatches.length > 0 && (
            <div className="mt-2 space-y-2">
              {dispatches.slice(0, 5).map((d) => {
                const status = String(d.status || '');
                const approval = String(d.approvalStatus || '');
                return (
                  <Link
                    key={String(d.id)}
                    to={`/dispatch`}
                    className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2.5 text-xs transition-colors hover:border-[var(--color-primary)]"
                  >
                    <div className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{String(d.dispatchNumber || d.id || '')}</p>
                        <p className="text-[var(--color-text-muted)]">
                          {d.vehicleNo ? `${d.vehicleNo}` : ''}
                          {d.driverName ? ` · ${d.driverName}` : ''}
                          {d.customer ? ` · ${d.customer}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold',
                        status === 'Delivered' || status === 'Closed'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : status === 'Dispatched'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      )}>
                        {status || 'Pending'}
                      </span>
                      {approval === 'Approved' && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {approval}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
              {dispatches.length > 5 && (
                <Link to={`/dispatch`} className="block text-center text-xs font-medium text-[var(--color-primary)] hover:underline">
                  +{dispatches.length - 5} more dispatches
                </Link>
              )}
            </div>
          )}
          {stage.projectStage === 'Dispatch' && dispatches.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No dispatches linked to this project yet.</p>
          )}
        </StageCard>
        </div>
    ) };
  });

  const previous = rendered.find((r) => r.role === 'previous');
  const current = rendered.find((r) => r.role === 'current');
  const next = rendered.find((r) => r.role === 'next');
  const past = rendered.filter((r) => r.role === 'past');
  const future = rendered.filter((r) => r.role === 'future');

  return (
    <div className="space-y-5">
      {/* Earlier stages — same full detail as any stage, just collapsed by default so it doesn't compete with what's active now */}
      {past.length > 0 && (
        <CollapsibleSection title="Earlier stages" count={past.length} defaultOpen={false}>
          <div className="space-y-4">
            {past.map((r, i) => <div key={i}>{r.node}</div>)}
          </div>
        </CollapsibleSection>
      )}

      {/* The heart of the journey: what just finished, what's happening now, what's next */}
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.3fr_0.85fr] lg:items-start">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Previous stage</p>
          {previous ? previous.node : <p className="text-xs text-[var(--color-text-muted)]">This is the first stage.</p>}
        </div>
        <div className="rounded-2xl bg-[var(--color-primary)]/[0.04] p-3 ring-1 ring-[var(--color-primary)]/20">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-primary)]">Current stage</p>
          {current ? current.node : <p className="text-xs text-[var(--color-text-muted)]">No active stage right now.</p>}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Next stage</p>
          {next ? next.node : <p className="text-xs text-[var(--color-text-muted)]">This is the last stage.</p>}
        </div>
      </div>

      {/* Coming up — same full detail once each stage is reached; collapsed for now since there's nothing actionable yet */}
      {future.length > 0 && (
        <CollapsibleSection title="Coming up" count={future.length} defaultOpen={false}>
          <div className="space-y-4">
            {future.map((r, i) => <div key={i}>{r.node}</div>)}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
