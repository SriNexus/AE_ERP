import React, { lazy, Suspense } from 'react';
import { cn } from '../../utils/cn';

const UniversalNotesTab = lazy(() => import('./UniversalTabs/UniversalNotesTab'));
const UniversalActivityTab = lazy(() => import('./UniversalTabs/UniversalActivityTab'));
const UniversalDocumentsTab = lazy(() => import('./UniversalTabs/UniversalDocumentsTab'));
const UniversalHistoryTab = lazy(() => import('./UniversalTabs/UniversalHistoryTab'));
const UniversalPermissionsTab = lazy(() => import('./UniversalTabs/UniversalPermissionsTab'));
const UniversalTasksTab = lazy(() => import('./UniversalTabs/UniversalTasksTab'));
const UniversalLinkedRecordsTab = lazy(() => import('./UniversalTabs/UniversalLinkedRecordsTab'));
const UniversalDisposableTab = lazy(() => import('./UniversalTabs/UniversalDisposableTab'));

export type UniversalTabId = 'overview' | 'notes' | 'activity' | 'documents' | 'history' | 'communication' | 'tasks' | 'attachments' | 'linked_records' | 'permissions' | 'disposable';
export type ModuleTabId = 'followups' | 'items-tab' | 'orders-tab' | 'invoices-tab' | 'line-items' | 'payments-tab' | 'allocations-tab' | 'inventory-reservation' | 'milestones' | 'revisions' | 'approvals' | 'tax-details' | 'ledger' | 'payment-allocation' | 'receipts' | 'tracking' | 'vehicle-details' | 'delivery-proof' | 'checklists' | 'partner-commissions' | 'timeline' | 'inventory-tab' | 'pricing-tab' | 'media-tab' | 'products-tab' | 'purchase_orders' | 'goods_receipts' | 'inventory_impact' | 'material-allocation' | 'loading-details' | 'execution-tab' | 'team-tab' | 'financials-tab' | 'dispatch-tab' | 'installation-tab' | 'qc-tab' | 'commissioning-tab' | 'net-metering-tab' | 'subsidy-tab' | 'handover-tab' | 'amc-tab' | 'monitoring-tab';
export type TabId = UniversalTabId | ModuleTabId;
export interface TabDefinition { id: TabId; label: string; always?: boolean; }
export interface WorkspaceTabsProps { tabs: TabDefinition[]; activeTab: TabId; onTabChange: (tabId: TabId) => void; tabProps: Record<string, unknown>; overview?: React.ReactNode; moduleTabContent?: Partial<Record<TabId, React.ReactNode>>; className?: string; }
function Loading() { return <div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>; }
function props(input?: Record<string, unknown>) { return { entityId: input?.entityId as string || '', entityType: input?.entityType as string || '', companyId: input?.companyId as string || '', caseId: input?.caseId as string | undefined, permissions: input?.permissions as any, record: input?.record as Record<string, unknown> || {} }; }
// Exported (Left Panel/Tabs/Documents/Footer UI standardization mission) so
// Customer Workspace can lift its tab bar to workspace-level (outside the
// Center Panel) while reusing this exact same content dispatch — every
// other WorkspaceTabs caller is unaffected, this is purely additive.
export function content(id: TabId, overview: React.ReactNode | undefined, input: Record<string, unknown>, module?: Partial<Record<TabId, React.ReactNode>>): React.ReactNode { if (module && id in module) return module[id]; const p=props(input); switch(id) { case 'overview': return overview; case 'tasks': return <UniversalTasksTab {...p}/>; case 'notes': return <UniversalNotesTab {...p}/>; case 'activity': return <UniversalActivityTab {...p}/>; case 'documents': return <UniversalDocumentsTab {...p}/>; case 'history': return <UniversalHistoryTab {...p}/>; case 'linked_records': return <UniversalLinkedRecordsTab {...p}/>; case 'permissions': return <UniversalPermissionsTab {...p}/>; case 'disposable': return <UniversalDisposableTab {...p}/>; default: return null; } }
export function WorkspaceTabs({ tabs, activeTab, onTabChange, tabProps, overview, moduleTabContent, className }: WorkspaceTabsProps) { return <div className={cn('flex min-h-0 flex-1 flex-col', className)}><div className="flex gap-0.5 overflow-x-auto border-b border-[var(--color-border-subtle)] px-6" role="tablist">{tabs.map(tab => <button key={tab.id} role="tab" aria-selected={activeTab===tab.id} type="button" onClick={()=>onTabChange(tab.id)} className={cn('relative whitespace-nowrap px-4 py-3 text-sm font-medium',activeTab===tab.id?'text-[var(--color-primary)]':'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]')}>{tab.label}{activeTab===tab.id&&<span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--color-primary)]"/>}</button>)}</div><div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel"><Suspense fallback={<Loading/>}>{content(activeTab,overview,tabProps,moduleTabContent)}</Suspense></div></div>; }
export default WorkspaceTabs;