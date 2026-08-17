/**
 * MobileSalesDocuments — Mobile Sales Document Center
 *
 * Mobile-friendly card-based document viewer for all Sales documents.
 *
 * Desktop: Users see the table-based SalesDocuments page.
 * Mobile:  Users see this card-based layout with search, filters, full-screen preview.
 *
 * Routes: /sales-documents (mobile)
 */

import { useState, useMemo, useCallback } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  Image,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import { getAll, fmtDate } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Pagination } from '../../ui/Pagination';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../../shared';
import type { DocumentViewerFile } from '../../shared';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import toast from 'react-hot-toast';

const PER_PAGE = 15;

interface SalesDoc {
  id: string;
  moduleLabel: string;
  recordName: string;
  documentLabel: string;
  file: DocumentViewerFile;
  fileType: string;
  uploadedAt?: string;
  uploadedBy?: string;
}

function extractDocs(
  records: any[],
  moduleLabel: string,
  fieldMap: { label: string; nameField: string; urlField?: string; sizeField?: string }[],
  nameAccessor?: (r: any) => string,
): SalesDoc[] {
  const docs: SalesDoc[] = [];
  const getName = nameAccessor || ((r: any) => r.name || r.customer || r.id || 'Record');
  for (const record of records) {
    for (const fm of fieldMap) {
      const fileName = record[fm.nameField];
      if (!fileName) continue;
      const url = fm.urlField ? record[fm.urlField] || '' : '';
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || fileName.split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext);
      const isPdf = ext === 'pdf';
      docs.push({
        id: `${moduleLabel}-${record.id}-${fm.label.replace(/\s+/g, '-').toLowerCase()}`,
        moduleLabel,
        recordName: getName(record),
        documentLabel: fm.label,
        file: {
          name: fileName,
          url,
          size: fm.sizeField ? record[fm.sizeField] : undefined,
        },
        fileType: isImage ? 'image' : isPdf ? 'pdf' : 'other',
        uploadedAt: record.updatedAt || record.createdAt,
        uploadedBy: record.updatedByName || record.createdByName || record.assignedToName,
      });
    }
  }
  return docs;
}

export function MobileSalesDocuments() {
  const [params, setParams] = useSearchParams();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  const [search, setSearch] = useState(params.get('q') || '');
  const [showSearch, setShowSearch] = useState(!!params.get('q'));
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [moduleFilter, setModuleFilter] = useState(params.get('module') || '');

  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  const { data: leads = [], isLoading: lL } = useQuery({
    queryKey: qkeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 60000,
  });
  const { data: customers = [], isLoading: cL } = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60000,
  });
  const { data: quotations = [], isLoading: qL } = useQuery({
    queryKey: qkeys.quotationsAll,
    queryFn: () => getAll(COLLECTIONS.QUOTATIONS),
    staleTime: 60000,
  });
  const { data: orders = [], isLoading: oL } = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60000,
  });
  const { data: invoices = [], isLoading: iL } = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60000,
  });

  const isLoading = lL || cL || qL || oL || iL;

  const allDocuments = useMemo(() => [
    ...extractDocs(leads as any[], 'Lead', [
      { label: 'Electricity Bill', nameField: 'electricityBillFileName', urlField: 'electricityBillUrl', sizeField: 'electricityBillSize' },
      { label: 'Aadhaar Card', nameField: 'aadhaarFileName', urlField: 'aadhaarUrl', sizeField: 'aadhaarSize' },
      { label: 'PAN Card', nameField: 'panFileName', urlField: 'panUrl', sizeField: 'panSize' },
      { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
    ], (r) => r.name || r.id),
    ...extractDocs(customers as any[], 'Customer', [
      { label: 'Bill Upload', nameField: 'billUploadName', urlField: 'billUploadUrl', sizeField: 'billUploadSize' },
      { label: 'Electricity Bill', nameField: 'electricityBillFileName', urlField: 'electricityBillUrl', sizeField: 'electricityBillSize' },
      { label: 'Aadhaar Card', nameField: 'aadhaarFileName', urlField: 'aadhaarUrl', sizeField: 'aadhaarSize' },
      { label: 'PAN Card', nameField: 'panFileName', urlField: 'panUrl', sizeField: 'panSize' },
      { label: 'Agreement', nameField: 'agreementFileName', urlField: 'agreementUrl', sizeField: 'agreementSize' },
      { label: 'GST Certificate', nameField: 'gstFileName', urlField: 'gstUrl', sizeField: 'gstSize' },
      { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
    ], (r) => r.name || r.fullName || r.id),
    ...extractDocs(quotations as any[], 'Quotation', [
      { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
      { label: 'Quotation File', nameField: 'fileName', urlField: 'fileUrl', sizeField: 'fileSize' },
    ], (r) => r.quotationNumber || r.id),
    ...extractDocs(orders as any[], 'Order', [
      { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
      { label: 'Delivery Challan', nameField: 'deliveryChallanName', urlField: 'deliveryChallanUrl', sizeField: 'deliveryChallanSize' },
      { label: 'Payment Receipt', nameField: 'receiptName', urlField: 'receiptUrl', sizeField: 'receiptSize' },
    ], (r) => r.orderNumber || r.id),
    ...extractDocs(invoices as any[], 'Invoice', [
      { label: 'Invoice File', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
      { label: 'Invoice PDF', nameField: 'fileName', urlField: 'fileUrl', sizeField: 'fileSize' },
    ], (r) => r.invoiceNumber || r.id),
  ], [leads, customers, quotations, orders, invoices]);

  // Compute stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = allDocuments.filter((d) => {
      if (!d.uploadedAt) return false;
      const date = new Date(d.uploadedAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const totalSize = allDocuments.reduce((sum, d) => sum + (d.file.size || 0), 0);
    return { total: allDocuments.length, thisMonth, totalSize };
  }, [allDocuments]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allDocuments.filter((doc) => {
      if (moduleFilter && doc.moduleLabel !== moduleFilter) return false;
      if (!q) return true;
      return (
        doc.file.name.toLowerCase().includes(q) ||
        doc.recordName.toLowerCase().includes(q) ||
        doc.documentLabel.toLowerCase().includes(q)
      );
    }).sort((a, b) => {
      const aTime = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const bTime = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [allDocuments, search, moduleFilter]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleView = useCallback((doc: SalesDoc) => {
    if (doc.file.url) {
      viewDocument(doc.file);
    } else {
      toast('Document URL not available', { icon: 'ℹ️' });
    }
  }, [viewDocument]);

  const handleDownload = useCallback((doc: SalesDoc) => {
    if (!doc.file.url) return;
    const a = document.createElement('a');
    a.href = doc.file.url;
    a.download = doc.file.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  const MODULE_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Leads', value: 'Lead' },
    { label: 'Customers', value: 'Customer' },
    { label: 'Quotations', value: 'Quotation' },
    { label: 'Orders', value: 'Order' },
    { label: 'Invoices', value: 'Invoice' },
  ];

  return (
    <div className="space-y-3 px-1 pb-2 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Sales Documents</h1>
        <button
          type="button"
          onClick={() => setShowSearch((s) => !s)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          aria-label="Toggle search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile Search */}
      {showSearch && (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search documents..."
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 pl-10 text-sm text-[var(--color-text)] placeholder-[var(--color-text-disabled)] focus:border-[var(--color-primary)] focus:outline-none"
            autoFocus
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Module Filter Pills */}
      <div className="flex flex-wrap gap-1.5 px-1">
        {MODULE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setModuleFilter(opt.value); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              moduleFilter === opt.value
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {filtered.length > 0 && (
          <span className="ml-auto self-center text-[10px] text-[var(--color-text-disabled)]">
            {filtered.length} doc{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-2 px-1">
        <div className="rounded-lg bg-[var(--color-bg-sunken)] p-2 text-center">
          <p className="text-lg font-bold text-[var(--color-text)]">{stats.total}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">Total</p>
        </div>
        <div className="rounded-lg bg-[var(--color-bg-sunken)] p-2 text-center">
          <p className="text-lg font-bold text-[var(--color-text)]">{stats.thisMonth}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">This Month</p>
        </div>
        <div className="rounded-lg bg-[var(--color-bg-sunken)] p-2 text-center">
          <p className="text-lg font-bold text-[var(--color-text)]">{stats.totalSize > 0 ? formatFileSize(stats.totalSize) : '—'}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">Size</p>
        </div>
      </div>

      {/* Document Cards */}
      <div className="space-y-2">
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="rounded-xl p-4">
            <div className="flex animate-pulse gap-3">
              <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
                <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
              </div>
            </div>
          </Card>
        ))}

        {!isLoading && paginated.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <FileText className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2 font-semibold text-[var(--color-text)]">No documents found</p>
            <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
              {search || moduleFilter ? 'Try adjusting your search or filters' : 'Upload documents in any Sales module.'}
            </p>
          </Card>
        )}

        {!isLoading && paginated.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            onView={() => handleView(doc)}
            onDownload={() => handleDownload(doc)}
          />
        ))}
      </div>

      {filtered.length > 0 && (
        <Pagination
          page={page}
          total={filtered.length}
          perPage={PER_PAGE}
          onChange={(p) => { setPage(p); }}
        />
      )}

      <DocumentViewer
        document={viewerDoc}
        open={viewerOpen}
        onClose={closeViewer}
        title={viewerDoc?.name}
        fullScreen
      />
    </div>
  );
}

function DocumentCard({ doc, onView, onDownload }: {
  doc: SalesDoc;
  onView: () => void;
  onDownload: () => void;
}) {
  return (
    <Card className="rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
          {doc.fileType === 'image' ? (
            <Image className="h-5 w-5" />
          ) : doc.fileType === 'pdf' ? (
            <FileText className="h-5 w-5" />
          ) : (
            <Paperclip className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[var(--color-text)]">{doc.documentLabel}</p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">{doc.file.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-text-disabled)]">
            <span className="inline-flex rounded bg-[var(--color-bg-sunken)] px-1.5 py-0.5 font-medium text-[var(--color-text-muted)]">
              {doc.moduleLabel}
            </span>
            <span>{doc.recordName}</span>
            {doc.file.size ? <span>{formatFileSize(doc.file.size)}</span> : null}
            {doc.uploadedAt ? <span>{fmtDate(doc.uploadedAt)}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {doc.file.url && (
            <>
              <button
                type="button"
                onClick={onView}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)]"
                aria-label="View document"
              >
                <FileText className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                aria-label="Download document"
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default MobileSalesDocuments;
