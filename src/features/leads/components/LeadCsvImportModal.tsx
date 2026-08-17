/**
 * LeadCsvImportModal — CSV upload, preview, and import result summary.
 * Phase P2: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: indigo upload icon, emerald/amber/red result count pigments.
 */

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal }  from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { parseCSV as parseLeadsCSV } from '../utils/leadsCsv';

interface ImportResult {
  imported:   number;
  duplicates: number;
  invalid:    number;
}

interface LeadCsvImportModalProps {
  open:          boolean;
  onClose:       () => void;
  onImport:      (rows: any[]) => void;
  importing:     boolean;
  importResult:  ImportResult | null;
  onResultClose: () => void;
}

export function LeadCsvImportModal({
  open, onClose, onImport, importing, importResult, onResultClose,
}: LeadCsvImportModalProps) {
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setCsvPreview([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvPreview(parseLeadsCSV(ev.target?.result as string).slice(0, 5));
    };
    reader.readAsText(file);
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload CSV" size="lg">
      <div className="space-y-4">
        {!importResult ? (
          <>
            {/*
             * Drop zone: bg-sunken creates visual depth below modal surface,
             * signalling an interactive target area. Dashed border uses border token.
             */}
            <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-8 text-center bg-[var(--color-bg-sunken)]">
              <input type="file" accept=".csv" ref={fileInputRef} onChange={handleCsvFile} className="hidden" id="csv-upload" />
              <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-1">
                {/* VALID: indigo-500 is primary brand pigment for the upload CTA icon */}
                <UploadCloud className="h-10 w-10 text-indigo-500 mb-1" />
                <span className="font-semibold text-[var(--color-text-secondary)]">Click to select CSV file</span>
                <span className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Required columns: name, phone — Optional: email, city, state, source, status, assignedto, notes
                </span>
              </label>
            </div>

            {csvPreview.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2">Preview (First 5 rows)</p>
                <div className="overflow-x-auto rounded border border-[var(--color-border)] text-xs">
                  <table className="min-w-full divide-y divide-[var(--color-border-subtle)]">
                    <thead className="bg-[var(--color-bg-sunken)]">
                      <tr>
                        {Object.keys(csvPreview[0]).slice(0, 6).map(k => (
                          <th key={k} className="px-2 py-1.5 text-left text-[var(--color-text-muted)]">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {csvPreview.map((r, i) => (
                        <tr key={i}>
                          {Object.values(r).slice(0, 6).map((v: any, j) => (
                            <td key={j} className="px-2 py-1.5 text-[var(--color-text-secondary)]">{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setCsvPreview([]); onClose(); }}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!fileInputRef.current?.files?.[0]) return toast.error('Select file first');
                  const reader = new FileReader();
                  reader.onload = (e) => onImport(parseLeadsCSV(e.target?.result as string));
                  reader.readAsText(fileInputRef.current.files[0]);
                }}
                loading={importing}
                disabled={csvPreview.length === 0}
              >Import Data</Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="bg-[var(--color-bg-sunken)] px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <p className="font-semibold text-[var(--color-text-secondary)] text-sm">Import Summary</p>
              </div>
              <div className="divide-y divide-[var(--color-border-subtle)]">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-[var(--color-text-secondary)]">Imported</span>
                  {/* VALID: emerald is fixed success status pigment */}
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">{importResult.imported}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-[var(--color-text-secondary)]">Duplicates Skipped</span>
                  {/* VALID: amber is fixed warning status pigment */}
                  <span className="font-bold text-amber-600 dark:text-amber-400 text-lg">{importResult.duplicates}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-[var(--color-text-secondary)]">Invalid Rows</span>
                  {/* VALID: red is fixed danger status pigment */}
                  <span className="font-bold text-red-600 dark:text-red-400 text-lg">{importResult.invalid}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={onResultClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
