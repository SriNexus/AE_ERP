import { useMemo, useState } from 'react';
import { UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { COLLECTIONS } from '../../lib/firebase';
import { batchCreate, genId, resolveWriteCompanyId } from '../../lib/firestore';
import { createProjectionWithUserId } from '../../lib/entityProjection';
import { getNextAssignee } from '../../lib/roundRobin';
import { resolveOrCreateMasterUser } from '../../lib/userIdentity';
import { createCustomerProjection } from '../../features/customers/hooks/useCustomers';
import { useAppStore } from '../../store/useAppStore';

type ImportCollection = 'leads' | 'customers' | 'products';

type Props = {
  collection: ImportCollection;
  onClose: () => void;
  onSuccess: () => void;
};

type CsvRow = Record<string, string>;
type RowError = { row: number; message: string };

const CONFIG = {
  leads: {
    firestoreCollection: COLLECTIONS.LEADS,
    expected: ['name', 'phone', 'email', 'city', 'state', 'source', 'status', 'assignedToId', 'assignedToName', 'notes'],
    required: ['name', 'phone'],
  },
  customers: {
    firestoreCollection: COLLECTIONS.CUSTOMERS,
    expected: ['name', 'phone', 'email', 'company', 'city', 'state', 'gst', 'type', 'notes'],
    required: ['name', 'phone'],
  },
  products: {
    firestoreCollection: COLLECTIONS.PRODUCTS,
    expected: ['name', 'category', 'sku', 'price', 'tax', 'unit', 'description', 'specs'],
    required: ['name', 'category', 'price'],
  },
} as const;

function parseCSV(input: string): CsvRow[] {
  const rows: string[][] = [];
  let quoted = false;
  for (let row = 0, col = 0, i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    rows[row] = rows[row] || [];
    rows[row][col] = rows[row][col] || '';
    if (char === '"' && quoted && next === '"') {
      rows[row][col] += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      col += 1;
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row += 1;
      col = 0;
      continue;
    }
    rows[row][col] += char;
  }

  const headers = (rows[0] || []).map((header) => header.trim());
  return rows.slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => headers.reduce<CsvRow>((acc, header, index) => {
      acc[header] = row[index]?.trim() || '';
      return acc;
    }, {}));
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function autoMap(headers: string[], expected: readonly string[]) {
  return expected.reduce<Record<string, string>>((acc, field) => {
    const match = headers.find((header) => normalizeHeader(header) === normalizeHeader(field));
    acc[field] = match || '';
    return acc;
  }, {});
}

function compact(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== ''));
}

export function CSVImportModal({ collection, onClose, onSuccess }: Props) {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const user = useAppStore((state) => state.user);
  const config = CONFIG[collection];
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<RowError[]>([]);
  const [validRows, setValidRows] = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);

  const companyId = activeCompanyId && activeCompanyId !== 'all'
    ? activeCompanyId
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    : resolveWriteCompanyId();

  const mappedRows = useMemo(() => rows.map((row) => (
    config.expected.reduce<Record<string, string>>((acc, field) => {
      const source = mapping[field];
      acc[field] = source ? row[source] || '' : '';
      return acc;
    }, {})
  )), [config.expected, mapping, rows]);

  function handleFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(String(reader.result || ''));
      if (!parsed.length) {
        toast.error('No CSV rows found');
        return;
      }
      const detectedHeaders = Object.keys(parsed[0]);
      setRows(parsed);
      setHeaders(detectedHeaders);
      setMapping(autoMap(detectedHeaders, config.expected));
      setStep(1);
    };
    reader.readAsText(file);
  }

  function validateRows() {
    const rowErrors: RowError[] = [];
    const valid = mappedRows.filter((row, index) => {
      const missing = config.required.filter((field) => !row[field]?.trim());
      if (missing.length) {
        rowErrors.push({ row: index + 2, message: `Missing ${missing.join(', ')}` });
        return false;
      }
      return true;
    });
    setErrors(rowErrors);
    setValidRows(valid);
    setStep(2);
  }

  async function confirmImport() {
    if (!validRows.length) {
      toast.error('No valid rows to import');
      return;
    }

    setSaving(true);
    try {
      if (collection === 'leads') {
        for (const row of validRows) {
          const assignee = row.assignedToId
            ? { userId: row.assignedToId, name: row.assignedToName || row.assignedToId }
            : await getNextAssignee(companyId);
          await resolveOrCreateMasterUser(row.phone, companyId, {
            name: row.name,
            email: row.email,
            linkedModules: ['leads'],
            createdBy: user?.id || 'system',
          });
          await createProjectionWithUserId(COLLECTIONS.LEADS, genId.lead(), compact({
            ...row,
            source: row.source || 'CSV Import',
            status: row.status || 'New',
            assignedToId: assignee.userId,
            assignedToName: assignee.name,
            companyId,
            createdBy: user?.id || 'system',
          }));
        }
      } else if (collection === 'customers') {
        for (const row of validRows) {
          await createCustomerProjection(genId.customer(), compact({
            ...row,
            type: row.type || 'B2B',
            companyId,
            createdBy: user?.id || 'system',
          }));
        }
      } else {
        await batchCreate(COLLECTIONS.PRODUCTS, validRows.map((row) => compact({
          ...row,
          id: genId.generic('PRD'),
          price: Number(row.price) || 0,
          tax: Number(row.tax) || 0,
          unit: row.unit || 'PCS',
          specs: row.specs ? (() => { try { return JSON.parse(row.specs); } catch { return {}; } })() : {},
          photos: [],
          status: 'Active',
          lowStockThreshold: 5,
          companyId,
          createdBy: user?.id || 'system',
          isDeleted: false,
        })));
      }
      toast.success(`${validRows.length} ${collection} imported`);
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'CSV import failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">CSV Import</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{collection}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-3 gap-2 text-xs">
            {['Upload & map', 'Validate', 'Confirm'].map((label, index) => (
              <div key={label} className={`rounded border px-3 py-2 ${step === index + 1 ? 'border-[var(--color-primary)] bg-[var(--color-bg-sunken)] text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
                {index + 1}. {label}
              </div>
            ))}
          </div>

          <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-6 text-center">
            <input id="shared-csv-upload" type="file" accept=".csv" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
            <label htmlFor="shared-csv-upload" className="inline-flex cursor-pointer flex-col items-center gap-2 text-[var(--color-text)]">
              <UploadCloud className="h-8 w-8 text-[var(--color-primary)]" />
              <span className="text-sm font-semibold">Upload CSV</span>
              <span className="text-xs text-[var(--color-text-muted)]">Expected: {config.expected.join(', ')}</span>
            </label>
          </div>

          {headers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Column mapping</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {config.expected.map((field) => (
                  <label key={field} className="text-xs font-medium text-[var(--color-text-muted)]">
                    {field}
                    <select
                      value={mapping[field] || ''}
                      onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                      className="mt-1 h-9 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step >= 2 && (
            <div className="rounded-lg border border-[var(--color-border)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <span className="text-sm font-semibold text-[var(--color-text)]">Validation</span>
                <span className="text-xs text-[var(--color-text-muted)]">{validRows.length} valid, {errors.length} errors</span>
              </div>
              <div className="max-h-44 overflow-y-auto p-4">
                {errors.length ? errors.map((error) => (
                  <div key={`${error.row}-${error.message}`} className="flex items-center gap-2 py-1 text-xs text-[var(--color-danger)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Row {error.row}: {error.message}
                  </div>
                )) : (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
                    <CheckCircle2 className="h-4 w-4" />
                    All mapped rows are valid.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
          {step === 1 && <Button onClick={validateRows} disabled={!rows.length}>Validate rows</Button>}
          {step >= 2 && <Button onClick={confirmImport} loading={saving} disabled={!validRows.length}>Import {validRows.length}</Button>}
        </div>
      </div>
    </div>
  );
}
