/**
 * Payments Page — thin wrapper
 * Logic: features/sales/hooks/useSales.ts
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { fmtCurrency, fmtDate } from '../lib/firestore';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '../config/company';
import { Button, IconButton } from '../components/ui/Button';
import { Card, PageHeader } from '../components/ui/Card';
import { statusBadge } from '../components/ui/Badge';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Input, Select, Textarea, FormRow, SearchInput } from '../components/ui/Input';
import { FilterBar, KpiTile } from '../components/ui/FilterBar';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import { ActionMenu, EmptyState, PermissionGate } from '../components/shared';
import { Plus, Download, Trash2, Eye, CreditCard, RefreshCw } from 'lucide-react';
import { useCustomers } from '../features/customers/hooks/useCustomers';
import {
  usePayments, useSavePayment, useDeletePayment, exportPaymentsCSV,
  PAYMENT_FORM_DEFAULT, type PaymentForm, useOrders, useRefundPayment,
} from '../features/sales/hooks/useSales';
import toast from 'react-hot-toast';
import { canDo } from '../lib/permissions';

const PER_PAGE = 15;

export default function Payments() {
  const { company } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [modeF,  setModeF]  = useState(() => searchParams.get('mode') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [page,   setPage]   = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState<PaymentForm>({...PAYMENT_FORM_DEFAULT});
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId,    setDelId]    = useState<string|null>(null);
  const [refundId, setRefundId] = useState<string|null>(null);
  const { data: payments=[], isLoading, refetch } = usePayments();
  const { data: orders=[]    } = useOrders();
  const { data: customers=[] } = useCustomers();
  const saveMut   = useSavePayment((payment)=>{setShowForm(false);setForm({...PAYMENT_FORM_DEFAULT}); if (payment?.id) openPaymentDetails(payment, true);});
  const deleteMut = useDeletePayment();
  const refundMut = useRefundPayment();

  useEffect(() => {
    const invoice = (location.state as any)?.prefillInvoice;
    const order = (location.state as any)?.prefillOrder;
    const customer = (location.state as any)?.prefillCustomer;
    if (!invoice && !order && !customer) return;
    setForm({
      ...PAYMENT_FORM_DEFAULT,
      customer: invoice?.customer || order?.customer || customer?.name || customer?.company || '',
      customerId: invoice?.customerId || order?.customerId || customer?.id || '',
      orderId: invoice?.orderId || invoice?.sourceOrderId || order?.id || '',
      amount: String(invoice?.balanceAmount || invoice?.total || order?.balanceAmount || ''),
      date: new Date().toISOString().split('T')[0],
    });
    setShowForm(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  function handleSubmit(e:React.FormEvent){
    e.preventDefault();
    if (saveMut.isPending) return;
    if(!form.customer||!form.amount)return toast.error('Customer & amount required');
    saveMut.mutate(form);
  }

  function syncQueueParams(nextState: { q?: string; mode?: string; status?: string; page?: number }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const mode = nextState.mode ?? modeF;
    const status = nextState.status ?? statusF;
    const nextPage = nextState.page ?? page;

    if (q) next.set('q', q); else next.delete('q');
    if (mode) next.set('mode', mode); else next.delete('mode');
    if (status) next.set('status', status); else next.delete('status');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (openParam) next.set('open', openParam);

    setSearchParams(next, { replace: true });
  }

  function openPaymentDetails(payment: any, replace = false) {
    setViewItem(payment);
    if (!payment?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', payment.id);
    if (search) next.set('q', search); else next.delete('q');
    if (modeF) next.set('mode', modeF); else next.delete('mode');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    setSearchParams(next, { replace });
  }

  function openPaymentForm(prefill: Partial<PaymentForm> = {}) {
    setForm({
      ...PAYMENT_FORM_DEFAULT,
      date: new Date().toISOString().split('T')[0],
      ...prefill,
    });
    setShowForm(true);
  }

  function closePaymentForm() {
    setShowForm(false);
    setForm({ ...PAYMENT_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
  }

  const filtered = useMemo(()=>(payments as any[]).filter((p:any)=>{
    const q=search.toLowerCase();
    return(!q||[p.id,p.customer,p.customerId,p.invoiceId,p.orderId,p.reference,p.mode,p.status].some((v:any)=>String(v||'').toLowerCase().includes(q)))
      &&(!modeF||p.mode===modeF)
      &&(!statusF||p.status===statusF);
  }),[payments,search,modeF,statusF]);
  const paginated = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);
  function closePaymentDetails() {
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }
  useEffect(() => {
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (payments as any[]).find((payment: any) => payment.id === openId);
    if (!target) return;
    setViewItem(target);
    const filteredIndex = filtered.findIndex((payment: any) => payment.id === openId);
    if (filteredIndex >= 0) setPage(Math.max(1, Math.ceil((filteredIndex + 1) / PER_PAGE)));
    window.setTimeout(() => document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }), 0);
  }, [filtered, isLoading, openParam, payments]);
  const stats = {
    total:(payments as any[]).reduce((s:number,p:any)=>s+(Number(p.amount)||0),0),
    count:(payments as any[]).length,
    upi:(payments as any[]).filter((p:any)=>p.mode==='UPI').reduce((s:number,p:any)=>s+(Number(p.amount)||0),0),
    cash:(payments as any[]).filter((p:any)=>p.mode==='Cash').reduce((s:number,p:any)=>s+(Number(p.amount)||0),0),
  };
  function canRefundPayment(payment: any) {
    return canDo('edit', 'payments')
      && Number(payment?.amount) > 0
      && String(payment?.status || '').toLowerCase() !== 'refunded'
      && !payment?.refundOfPaymentId;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" subtitle="Home / Accounts / Payments" icon={<CreditCard className="h-5 w-5"/>}
        actions={<>
          <IconButton icon={<RefreshCw className="h-4 w-4"/>} title="Refresh" onClick={()=>refetch()} variant="outline"/>
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5"/>} onClick={()=>exportPaymentsCSV(filtered)}>Export</Button>
          <PermissionGate module="payments" action="create">
            <Button size="sm" data-tour="payments-create" icon={<Plus className="h-4 w-4"/>} onClick={()=>openPaymentForm()}>Record Payment</Button>
          </PermissionGate>
        </>}
      />
      <div className="kpi-grid-4">
        <KpiTile label="TOTAL COLLECTED" value={fmtCurrency(stats.total,company.currencySymbol)} color="border-l-emerald-500"/>
        <KpiTile label="TRANSACTIONS"    value={stats.count}                                      color="border-l-gray-400"/>
        <KpiTile label="UPI"             value={fmtCurrency(stats.upi,company.currencySymbol)}    color="border-l-purple-500"/>
        <KpiTile label="CASH"            value={fmtCurrency(stats.cash,company.currencySymbol)}   color="border-l-amber-500"/>
      </div>
      <Card>
        <div className="px-4 py-3 flex flex-wrap gap-3 items-center border-b border-[var(--color-border-subtle)]">
          <SearchInput data-tour="payments-search" value={search} onChange={v=>{setSearch(v);setPage(1);syncQueueParams({q:v,page:1});}} placeholder="Search customer, order, reference..." className="flex-1 min-w-48"/>
          <select value={modeF} onChange={e=>{setModeF(e.target.value);setPage(1);syncQueueParams({mode:e.target.value,page:1});}} className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-surface)] text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
            <option value="">All Modes</option>{PAYMENT_MODES.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
          <select value={statusF} onChange={e=>{setStatusF(e.target.value);setPage(1);syncQueueParams({status:e.target.value,page:1});}} className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-surface)] text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
            <option value="">All Statuses</option>{PAYMENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-muted ml-auto">{filtered.length} payments</span>
        </div>
        

        <div className={""} data-tour="payments-table">
        <Table>
          <Thead><Th>PAY ID</Th><Th>DATE</Th><Th>CUSTOMER</Th><Th>ORDER</Th><Th>AMOUNT</Th><Th>MODE</Th><Th>STATUS</Th><Th>REFERENCE</Th><Th>ACTIONS</Th></Thead>
          <Tbody>
            {isLoading?<SkeletonRows cols={9}/>
              :paginated.length===0?<EmptyState variant="table" colSpan={9} title="No payments recorded" description="Record a payment to see it here" />
              :paginated.map((p:any)=>(
              <Tr key={p.id} data-record-id={p.id}>
                <Td className="font-mono text-xs text-[var(--color-primary-text)] font-semibold">{p.id}</Td>
                <Td className="text-xs text-muted dark:text-muted">{fmtDate(p.date||p.createdAt)}</Td>
                <Td className="text-xs font-medium">{p.customer||'—'}</Td>
                <Td className="font-mono text-xs text-muted dark:text-muted">{p.orderId||'—'}</Td>
                <Td className="font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(p.amount,company.currencySymbol)}</Td>
                <Td className="text-xs">{p.mode||'—'}</Td>
                <Td>{statusBadge(p.status||'Paid')}</Td>
                <Td className="font-mono text-xs text-muted">{p.reference||'—'}</Td>
                <Td><ActionMenu actions={[
                  { label: 'View',   icon: <Eye className="h-4 w-4"/>,   onClick: () => openPaymentDetails(p) },
                  ...(canRefundPayment(p) ? [{ label: 'Refund', icon: <RefreshCw className="h-4 w-4"/>, onClick: () => setRefundId(p.id) }] : []),
                  { label: 'Delete', icon: <Trash2 className="h-4 w-4"/>, onClick: () => setDelId(p.id), danger: true },
                ]} /></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        </div>
        <div data-tour="payments-pagination">
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={(nextPage)=>{setPage(nextPage);syncQueueParams({page:nextPage});}}/>
        </div>
      </Card>

      <Modal open={showForm} onClose={closePaymentForm} title="Record Payment" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          
          <Select label="Customer" required value={form.customerId} onChange={e=>{const c=(customers as any[]).find((x:any)=>x.id===e.target.value);setForm({...form,customerId:e.target.value,customer:c?.name||''});}} options={[{label:'Select Customer',value:''},...(customers as any[]).map((c:any)=>({label:c.name,value:c.id}))]}/>
          <Select label="Link to Order" value={form.orderId} onChange={e=>setForm({...form,orderId:e.target.value})} options={[{label:'No order linked',value:''},...(orders as any[]).map((o:any)=>({label:`${o.id} — ${o.customer}`,value:o.id}))]}/>
          <FormRow>
            <Input label="Amount (₹)" type="number" min="0" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/>
            <Input label="Date" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
          </FormRow>
          <FormRow>
            <Select label="Payment Mode" value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})} options={PAYMENT_MODES.map(m=>({label:m,value:m}))}/>
            <Select label="Status" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} options={PAYMENT_STATUSES.map(s=>({label:s,value:s}))}/>
          </FormRow>
          <Input label="Reference / UTR / Cheque No." value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})} placeholder="Transaction reference"/>
          <Textarea label="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows={2}/>
          <div className={"flex justify-end gap-2"}><Button variant="outline" type="button" onClick={closePaymentForm}>Cancel</Button><Button type="submit" loading={saveMut.isPending}>Record Payment</Button></div>
          
        </form>
      </Modal>

      <Modal open={!!viewItem} onClose={closePaymentDetails} title="Payment Details" size="sm">
        {viewItem&&(
          <>
          
          <div className={"space-y-3 text-sm"}>
            <div className="text-center py-3"><p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(viewItem.amount,company.currencySymbol)}</p><p className="text-muted text-xs mt-1">{viewItem.mode} · {fmtDate(viewItem.date||viewItem.createdAt)}</p></div>
            <div className="grid grid-cols-2 gap-3">{[['Customer',viewItem.customer],['Order',viewItem.orderId],['Reference',viewItem.reference],['Status',viewItem.status],['Notes',viewItem.notes]].map(([k,v])=>v?<div key={k}><p className="text-xs text-[var(--color-text-muted)] uppercase font-semibold">{k}</p><p className="text-[var(--color-text)] mt-0.5">{v}</p></div>:null)}</div>
            {canRefundPayment(viewItem) && (
              <div className="border-t border-[var(--color-border-subtle)] pt-3">
                <Button className="w-full justify-start" variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRefundId(viewItem.id)} loading={refundMut.isPending}>
                  Refund Payment
                </Button>
              </div>
            )}
          </div>
          </>
        )}
      </Modal>
      <ConfirmDialog
        open={!!delId}
        onClose={()=>setDelId(null)}
        onConfirm={()=>delId&&deleteMut.mutate(delId, {
          onSuccess: () => {
            if (viewItem?.id === delId) closePaymentDetails();
            setDelId(null);
          },
        })}
        loading={deleteMut.isPending}
        title="Delete Payment"
        message="Delete this payment record?"
      />
      <ConfirmDialog
        open={!!refundId}
        onClose={()=>setRefundId(null)}
        onConfirm={()=>refundId&&refundMut.mutate(
          { paymentId: refundId, reason: 'Refunded from Payments page' },
          {
            onSuccess: () => {
              if (viewItem?.id === refundId) closePaymentDetails();
              setRefundId(null);
            },
          }
        )}
        loading={refundMut.isPending}
        title="Refund Payment"
        message="Refund this payment? A negative reversal entry will be created and linked order/invoice balances will be reconciled."
      />
    </div>
  );
}
