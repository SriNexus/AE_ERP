/**
 * DispatchRequestModal — extracted from Dispatch.tsx
 *
 * Controlled form: form/setForm/items/setItems owned by parent.
 * loadOrderForDispatch stays in parent — onOrderSelect callback.
 * createReq.mutate stays in parent — onSubmit callback.
 *
 * Inline item qty changes use React functional updater via setItems prop.
 */
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { Input, Select, Textarea, FormSection, FormRow } from '../../../components/ui/Input';

interface DispatchRequestModalProps {
  open:          boolean;
  onClose:       () => void;
  form:          any;
  setForm:       (f: any) => void;
  items:         any[];
  setItems:      (updater: (prev: any[]) => any[]) => void;
  orders:        any[];
  warehouses:    any[];
  onOrderSelect: (orderId: string) => void;
  onSubmit:      () => void;
  submitting:    boolean;
  projects?:     any[];
}

export function DispatchRequestModal({
  open, onClose, form, setForm, items, setItems,
  orders, warehouses, onOrderSelect, onSubmit, submitting,
  projects = [],
}: DispatchRequestModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Request Dispatch" size="xl">
      <form onSubmit={e => { e.preventDefault(); onSubmit(); }} className="space-y-5">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          Select an order with pending quantities. A request will be sent to the warehouse team for execution.
        </div>

        <FormSection title="Source Details">
          <FormRow>
            <Select
              label="Select Order"
              required
              value={form.orderId}
              onChange={e => onOrderSelect(e.target.value)}
              options={[{ label: '--', value: '' }, ...orders.filter((o: any) => o.status !== 'Dispatched').map((o: any) => ({ label: `${o.id} - ${o.customer}`, value: o.id }))]}
            />
            <Select
              label="From Warehouse"
              required
              value={form.warehouseId}
              onChange={e => {
                const w = warehouses.find((x: any) => x.id === e.target.value) as any;
                setForm({ ...form, warehouseId: e.target.value, warehouse: w?.name || '' });
              }}
              options={[{ label: '--', value: '' }, ...warehouses.map((w: any) => ({ label: w.name, value: w.id }))]}
            />
          </FormRow>
          {projects.length > 0 && (
            <Select
              label="Link to Project"
              value={form.projectId || ''}
              onChange={e => {
                const p = projects.find((x: any) => x.id === e.target.value) as any;
                setForm({ ...form, projectId: e.target.value, projectName: p?.projectId || p?.name || '' });
              }}
              options={[{ label: 'Not linked to project', value: '' }, ...projects.map((p: any) => ({ label: `${p.projectId || p.id} - ${p.customerName || p.customer || ''}`, value: p.id }))]}
            />
          )}
        </FormSection>

        {items.length > 0 && (
          <FormSection title="Items to Dispatch (Partial allowed)">
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-xs">Product</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-xs">Pending</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-xs w-32">Req Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">{it.product} <span className="text-xs text-gray-400 block">Tracking: {it.trackingType}</span></td>
                      <td className="px-3 py-2 font-mono text-gray-500">{it.maxQty} {it.unit}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" max={it.maxQty} required
                          value={it.requestedQty}
                          onChange={e => {
                            const val = Math.min(it.maxQty, Math.max(0, Number(e.target.value)));
                            setItems(p => p.map((x, i) => i === idx ? { ...x, requestedQty: val } : x));
                          }}
                          className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        <FormSection title="Vehicle & Transport">
          <FormRow>
            <Input label="Vehicle No"    value={form.vehicleNo}    onChange={e => setForm({ ...form, vehicleNo: e.target.value })} />
            <Input label="Driver Name"   value={form.driverName}   onChange={e => setForm({ ...form, driverName: e.target.value })} />
          </FormRow>
          <FormRow>
            <Input label="Driver Phone"  value={form.driverPhone}  onChange={e => setForm({ ...form, driverPhone: e.target.value })} />
            <Input label="LR Number"     value={form.lrNumber}     onChange={e => setForm({ ...form, lrNumber: e.target.value })} />
          </FormRow>
        </FormSection>

        <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting} disabled={items.length === 0}>Submit Request</Button>
        </div>
      </form>
    </Modal>
  );
}
