/**
 * BulkImportBanksDialog — CSV import for Bank Master.
 *
 * Allows administrators to bulk-create banks from a CSV file with:
 *   - Template download
 *   - File upload (drag-drop or click)
 *   - Validation (required fields, duplicates)
 *   - Invalid row report
 *   - Import summary (success/failure counts)
 *   - Progress indicator during import
 *   - Duplicate detection (by bankCode)
 *   - Skip invalid rows without aborting
 */

import React, { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, FileText, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { genId, createDocWithId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import toast from 'react-hot-toast';
import { cn } from '../../../utils/cn';

interface ImportRow {
  rowNumber: number;
  bankCode: string;
  bankName: string;
  displayName: string;
  status: string;
  bankType: string;
  priority: number;
  errors: string[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

interface BulkImportBanksDialogProps {
  open: boolean;
  onClose: () => void;
}

// ── CSV Template generator ─────────────────────────────────
const CSV_TEMPLATE = 'Bank Code,Bank Name,Display Name,Status,Bank Type,Priority\nSBI001,State Bank of India,SBI,Active,Public,1\nHDFC001,HDFC Bank,HDFC,Active,Private,2\nICICI001,ICICI Bank,ICICI,Active,Private,3';

export function BulkImportBanksDialog({ open, onClose }: BulkImportBanksDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'complete'>('upload');

  const importMutation = useMutation({
    mutationFn: async (validRows: ImportRow[]) => {
      const now = new Date().toISOString();
      let imported = 0;
      const errors: string[] = [];

      for (const row of validRows) {
        try {
          const id = genId.generic('BNK');
          await createDocWithId(COLLECTIONS.BANKS, id, {
            bankCode: row.bankCode,
            bankName: row.bankName,
            displayName: row.displayName || '',
            status: row.status === 'Active' ? 'Active' : 'Inactive',
            bankType: row.bankType || '',
            priority: row.priority || 0,
            id,
            companyId: activeCompanyId,
            createdBy: user?.id || 'system',
            createdAt: now,
            updatedBy: user?.id || 'system',
            updatedAt: now,
            isDeleted: false,
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row ${row.rowNumber} (${row.bankCode}): ${e.message}`);
        }
      }

      return { imported, skipped: validRows.length - imported, total: validRows.length, errors };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['banks'] });
      setImportResult({ imported: result.imported, skipped: result.skipped, total: result.total });
      setStep('complete');
      if (result.imported > 0) toast.success(`Imported ${result.imported} banks`);
      if (result.errors.length > 0) toast.error(`${result.errors.length} row(s) failed`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function parseCSV(text: string): ImportRow[] {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return [];

    // Skip header row
    const dataLines = lines.slice(1);
    const parsed: ImportRow[] = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < dataLines.length; i++) {
      const values = parseCSVLine(dataLines[i]);
      const rowNumber = i + 2; // 1-indexed, skip header
      const errors: string[] = [];

      const bankCode = (values[0] || '').trim();
      const bankName = (values[1] || '').trim();
      const displayName = (values[2] || '').trim();
      const status = (values[3] || 'Active').trim();
      const bankType = (values[4] || '').trim();
      const priority = parseInt(values[5] || '0', 10) || 0;

      if (!bankCode) errors.push('Bank Code is required');
      if (!bankName) errors.push('Bank Name is required');
      if (seenCodes.has(bankCode)) errors.push(`Duplicate bank code: ${bankCode}`);
      if (status && !['Active', 'Inactive'].includes(status)) errors.push(`Invalid status: ${status}`);

      if (bankCode) seenCodes.add(bankCode);

      parsed.push({
        rowNumber,
        bankCode,
        bankName,
        displayName,
        status,
        bankType,
        priority,
        errors,
      });
    }

    return parsed;
  }

  // Simple CSV line parser (handles quoted values)
  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
      setStep('preview');
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      toast.error('Only CSV files are supported');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
      setStep('preview');
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  function handleConfirmImport() {
    const valid = rows.filter(r => r.errors.length === 0);
    importMutation.mutate(valid);
  }

  function downloadTemplate() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'bank-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function reset() {
    setRows([]);
    setStep('upload');
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-overlay)] backdrop-blur-sm animate-fadeIn">
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col"
        style={{ borderRadius: 'var(--theme-radius)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Import Banks from CSV</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Bulk-create banks with validation</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && (
            <div className="space-y-5">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="relative flex flex-col items-center justify-center gap-3 py-12 px-6 border-2 border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg-sunken)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 transition-all duration-200 cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div className="p-3 rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary)] group-hover:scale-105 transition-transform">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[var(--color-text)]">Drop a CSV file here, or click to browse</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">CSV file with headers: Bank Code, Bank Name, Display Name, Status, Bank Type, Priority</p>
                </div>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV template
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{rows.length} rows found</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {rows.filter(r => r.errors.length === 0).length} valid, {rows.filter(r => r.errors.length > 0).length} with errors
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline transition-colors"
                >
                  Choose different file
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto border border-[var(--color-border)] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--color-bg-sunken)] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Code</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rowNumber} className={cn(
                        'border-t border-[var(--color-border-subtle)]',
                        row.errors.length > 0 ? 'bg-[var(--color-danger-light)]/30' : 'hover:bg-[var(--color-surface-hover)]'
                      )}>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-[var(--color-text)]">{row.bankCode}</td>
                        <td className="px-3 py-2 text-[var(--color-text)]">{row.bankName}</td>
                        <td className="px-3 py-2">
                          {row.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-[var(--color-success-text)]"><CheckCircle className="h-3 w-3" />Valid</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[var(--color-danger-text)]"><XCircle className="h-3 w-3" />Invalid</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-danger-text)] max-w-[200px] truncate" title={row.errors.join('; ')}>
                          {row.errors.length > 0 ? row.errors[0] : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.filter(r => r.errors.length > 0).length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--color-warning-light)] border border-[var(--color-warning)]/30">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[var(--color-warning-text)]">Rows with errors will be skipped</p>
                    <p className="text-[10px] text-[var(--color-warning-text)]/80 mt-0.5">Only {rows.filter(r => r.errors.length === 0).length} of {rows.length} rows can be imported.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'complete' && importResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                {importResult.imported > 0 ? (
                  <div className="text-center">
                    <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-[var(--color-success-light)] flex items-center justify-center">
                      <CheckCircle className="h-6 w-6 text-[var(--color-success)]" />
                    </div>
                    <p className="text-lg font-bold text-[var(--color-text)]">Import Complete</p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      Successfully imported {importResult.imported} of {importResult.total} banks
                    </p>
                    {importResult.skipped > 0 && (
                      <p className="text-xs text-[var(--color-warning-text)] mt-1">
                        {importResult.skipped} row(s) skipped due to errors
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-[var(--color-danger-light)] flex items-center justify-center">
                      <XCircle className="h-6 w-6 text-[var(--color-danger)]" />
                    </div>
                    <p className="text-lg font-bold text-[var(--color-text)]">Import Failed</p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">No banks could be imported. Check your CSV file.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] shrink-0">
          {step === 'upload' && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Cancel
            </button>
          )}
          {step === 'preview' && (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importMutation.isPending || rows.filter(r => r.errors.length === 0).length === 0}
                className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity inline-flex items-center gap-2"
              >
                {importMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</>
                ) : (
                  <>Import {rows.filter(r => r.errors.length === 0).length} Banks</>
                )}
              </button>
            </>
          )}
          {step === 'complete' && (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                Import Another File
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default BulkImportBanksDialog;
