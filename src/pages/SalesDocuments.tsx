/**
 * SalesDocuments — Sales Document Center
 *
 * Unified document discovery for the entire Sales workflow:
 *   Leads → Customers → Quotations → Orders → Invoices
 *
 * Aggregates document references from all modules and presents
 * them in a single searchable, filterable, sortable list.
 *
 * Routes: /sales-documents
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Image,
  Paperclip,
  RefreshCw,
  SortAsc,
} from 'lucide-react';
import { getAll, fmtDate } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { Card, PageHeader } from '../components/ui/Card';
import { Button, IconButton } from '../components/ui/Button';
import { DocumentViewer, useDocumentViewer, formatFileSize } from '../components/shared';
import type { DocumentViewerFile } from '../components/shared';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';

const PER_PAGE = 20;

const DOCUMENT_MODULES = [
  { label: 'All Modules', value: '' },
  { label: 'Leads', value: 'leads' },
  { label: 'Customers', value: 'customers' },
  { label: 'Quotations', value: 'quotations' },
  { label: 'Orders', value: 'orders' },
  { label: 'Invoices', value: 'invoices' },
] as const;

const FILE_TYPE_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Image', value: 'image' },
  { label: 'Other', value: 'other' },
] as const;

const SORT_OPTIONS = [
  { label: 'Latest First', value: 'latest' },
  { label: 'Oldest First', value: 'oldest' },
  { label: 'Largest', value: 'largest' },
  { label: 'Smallest', value: 'smallest' },
] as const;

const DATE_RANGE_OPTIONS = [
  { label: 'All Time', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Year', value: 'year' },
] as const;

interface SalesDocument {
  id: string;
  module: string;
  moduleLabel: string;
  recordId: string;
  recordName: string;
  documentLabel: string;
  file: DocumentViewerFile;
  fileType: string;
  uploadedAt?: string;
  uploadedBy?: string;
}

function extractDocuments(
  records: any[],
  module: string,
  moduleLabel: string,
  fieldMap: { label: string; nameField: string; urlField?: string; mimeField?: string; sizeField?: string }[],
  nameAccessor?: (r: any) => string,
): SalesDocument[] {
  const docs: SalesDocument[] = [];
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
        id: `${module}-${record.id}-${fm.label.replace(/\s+/g, '-').toLowerCase()}`,
        module,
        moduleLabel,
        recordId: record.id,
        recordName: getName(record),
        documentLabel: fm.label,
        file: {
          name: fileName,
          url,
          mimeType: fm.mimeField ? record[fm.mimeField] : undefined,
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

export default function SalesDocuments() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [moduleFilter, setModuleFilter] = useState(searchParams.get('module') || '');
  const [fileTypeFilter, setFileTypeFilter] = useState(searchParams.get('type') || '');
  const [dateRange, setDateRange] = useState(searchParams.get('date') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'latest');
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));

  const { doc: viewerDoc, open: viewerOpen, viewDocument, closeViewer } = useDocumentViewer();

  // Fetch records from all modules
  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: qkeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 60000,
  });
  const { data: customers = [], isLoading: custLoading } = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60000,
  });
  const { data: quotations = [], isLoading: quotLoading } = useQuery({
    queryKey: qkeys.quotationsAll,
    queryFn: () => getAll(COLLECTIONS.QUOTATIONS),
    staleTime: 60000,
  });
  const { data: orders = [], isLoading: ordLoading } = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60000,
  });
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 60000,
  });

  const isLoading = leadsLoading || custLoading || quotLoading || ordLoading || invLoading;

  // Extract documents from all module records
  const allDocuments = useMemo(() => {
    const docs: SalesDocument[] = [
      ...extractDocuments(leads as any[], 'leads', 'Lead', [
        { label: 'Electricity Bill', nameField: 'electricityBillFileName', urlField: 'electricityBillUrl', sizeField: 'electricityBillSize' },
        { label: 'Aadhaar Card', nameField: 'aadhaarFileName', urlField: 'aadhaarUrl', sizeField: 'aadhaarSize' },
        { label: 'PAN Card', nameField: 'panFileName', urlField: 'panUrl', sizeField: 'panSize' },
        { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
      ], (r) => r.name || r.fullName || r.id),

      ...extractDocuments(customers as any[], 'customers', 'Customer', [
        { label: 'Bill Upload', nameField: 'billUploadName', urlField: 'billUploadUrl', sizeField: 'billUploadSize' },
        { label: 'Electricity Bill', nameField: 'electricityBillFileName', urlField: 'electricityBillUrl', sizeField: 'electricityBillSize' },
        { label: 'Aadhaar Card', nameField: 'aadhaarFileName', urlField: 'aadhaarUrl', sizeField: 'aadhaarSize' },
        { label: 'PAN Card', nameField: 'panFileName', urlField: 'panUrl', sizeField: 'panSize' },
        { label: 'Agreement', nameField: 'agreementFileName', urlField: 'agreementUrl', sizeField: 'agreementSize' },
        { label: 'GST Certificate', nameField: 'gstFileName', urlField: 'gstUrl', sizeField: 'gstSize' },
        { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
      ], (r) => r.name || r.fullName || r.customer || r.id),

      ...extractDocuments(quotations as any[], 'quotations', 'Quotation', [
        { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
        { label: 'Quotation File', nameField: 'fileName', urlField: 'fileUrl', sizeField: 'fileSize' },
      ], (r) => r.quotationNumber || r.quoteNumber || r.customer || r.id),

      ...extractDocuments(orders as any[], 'orders', 'Order', [
        { label: 'Attachment', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
        { label: 'Delivery Challan', nameField: 'deliveryChallanName', urlField: 'deliveryChallanUrl', sizeField: 'deliveryChallanSize' },
        { label: 'Payment Receipt', nameField: 'receiptName', urlField: 'receiptUrl', sizeField: 'receiptSize' },
      ], (r) => r.orderNumber || r.orderNo || r.customer || r.id),

      ...extractDocuments(invoices as any[], 'invoices', 'Invoice', [
        { label: 'Invoice File', nameField: 'attachmentName', urlField: 'attachmentUrl', sizeField: 'attachmentSize' },
        { label: 'Invoice PDF', nameField: 'fileName', urlField: 'fileUrl', sizeField: 'fileSize' },
      ], (r) => r.invoiceNumber || r.piNumber || r.customer || r.id),
    ];

    return docs;
  }, [leads, customers, quotations, orders, invoices]);

  // Compute stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = allDocuments.filter((d) => {
      if (!d.uploadedAt) return false;
      const date = new Date(d.uploadedAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const moduleCounts: Record<string, number> = {};
    let totalSize = 0;
    for (const doc of allDocuments) {
      moduleCounts[doc.moduleLabel] = (moduleCounts[doc.moduleLabel] || 0) + 1;
      if (doc.file.size) totalSize += doc.file.size;
    }
    const mostActive = Object.entries(moduleCounts).sort(([, a], [, b]) => b - a)[0];
    return {
      total: allDocuments.length,
      thisMonth,
      mostActiveModule: mostActive ? mostActive[0] : '—',
      totalSize,
    };
  }, [allDocuments]);

  // Apply date range filter
  function isInDateRange(dateStr: string | undefined, range: string): boolean {
    if (!range || !dateStr) return true;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return true;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    switch (range) {
      case 'today': return date >= startOfDay;
      case 'week': return date >= startOfWeek;
      case 'month': return date >= startOfMonth;
      case 'year': return date >= startOfYear;
      default: return true;
    }
  }

  // Apply search, filters, and sorting
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = allDocuments.filter((doc) => {
      if (moduleFilter && doc.module !== moduleFilter) return false;
      if (fileTypeFilter && doc.fileType !== fileTypeFilter) return false;
      if (!isInDateRange(doc.uploadedAt, dateRange)) return false;
      if (!q) return true;
      return (
        doc.file.name.toLowerCase().includes(q) ||
        doc.recordName.toLowerCase().includes(q) ||
        doc.documentLabel.toLowerCase().includes(q) ||
        doc.moduleLabel.toLowerCase().includes(q)
      );
    });

    // Sort
    result.sort((a, b) => {
      const aTime = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const bTime = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      const aSize = a.file.size || 0;
      const bSize = b.file.size || 0;
      switch (sortBy) {
        case 'oldest': return aTime - bTime;
        case 'largest': return bSize - aSize;
        case 'smallest': return aSize - bSize;
        case 'latest':
        default: return bTime - aTime;
      }
    });

    return result;
  }, [allDocuments, search, moduleFilter, fileTypeFilter, dateRange, sortBy]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleView = useCallback((doc: SalesDocument) => {
    if (doc.file.url) {
      viewDocument(doc.file);
    } else {
      toast('This document reference has no file URL attached yet.', { icon: 'ℹ️' });
    }
  }, [viewDocument]);

  const handleDownload = useCallback((doc: SalesDocument) => {
    if (!doc.file.url) return;
    const a = document.createElement('a');
    a.href = doc.file.url;
    a.download = doc.file.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Documents"
        subtitle="Home / Sales / Documents"
        icon={<FileText className="h-5 w-5" />}
        actions={
          <IconButton icon={<RefreshCw className="h-4 w-4" />} title="Refresh" variant="outline" />
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Total Documents</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{stats.total.toLocaleString()}</p>
            </div>
          </div>
        </Card>
        <Card className="rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">This Month</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{stats.thisMonth}</p>
            </div>
          </div>
        </Card>
        <Card className="rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Total Size</p>
              <p className="text-xl font-bold text-[var(--color-text)]">
                {stats.totalSize > 0 ? formatFileSize(stats.totalSize) : '—'}
              </p>
            </div>
          </div>
        </Card>
        <Card className="rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              <SortAsc className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Most Active</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{stats.mostActiveModule}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <FilterBar
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search file name, customer, lead…"
          filters={[
            {
              label: 'Module',
              value: moduleFilter,
              onChange: (v) => { setModuleFilter(v); setPage(1); },
              options: DOCUMENT_MODULES.map((m) => ({ label: m.label, value: m.value })),
            },
            {
              label: 'File Type',
              value: fileTypeFilter,
              onChange: (v) => { setFileTypeFilter(v); setPage(1); },
              options: FILE_TYPE_OPTIONS.map((t) => ({ label: t.label, value: t.value })),
            },
            {
              label: 'Date',
              value: dateRange,
              onChange: (v) => { setDateRange(v); setPage(1); },
              options: DATE_RANGE_OPTIONS.map((d) => ({ label: d.label, value: d.value })),
            },
            {
              label: 'Sort',
              value: sortBy,
              onChange: (v) => { setSortBy(v); setPage(1); },
              options: SORT_OPTIONS.map((s) => ({ label: s.label, value: s.value })),
            },
          ]}
          count={filtered.length}
          total={allDocuments.length}
          label="documents"
          onClearAll={() => {
            setSearch('');
            setModuleFilter('');
            setFileTypeFilter('');
            setDateRange('');
            setSortBy('latest');
            setPage(1);
          }}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <Thead>
              <Th>FILE NAME</Th>
              <Th>MODULE</Th>
              <Th>RECORD</Th>
              <Th>TYPE</Th>
              <Th>SIZE</Th>
              <Th>UPLOADED</Th>
              <Th>ACTIONS</Th>
            </Thead>
            <Tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--color-text-muted)]">Loading documents...</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center">
                  <FileText className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
                  <p className="mt-3 text-sm font-semibold text-[var(--color-text-muted)]">No documents found</p>
                  <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
                    {search || moduleFilter || fileTypeFilter || dateRange
                      ? 'Try adjusting your search or filters'
                      : 'Upload documents in any Sales module to see them here.'}
                  </p>
                </td></tr>
              ) : (
                paginated.map((doc) => (
                  <Tr key={doc.id} className="group cursor-pointer hover:bg-[var(--color-surface-hover)]">
                    <Td className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
                          {doc.fileType === 'image' ? (
                            <Image className="h-4 w-4" />
                          ) : doc.fileType === 'pdf' ? (
                            <FileText className="h-4 w-4" />
                          ) : (
                            <Paperclip className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{doc.documentLabel}</p>
                          <p className="truncate text-xs text-[var(--color-text-muted)]">{doc.file.name}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><span className="inline-flex rounded-full bg-[var(--color-primary-light)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary-text)]">{doc.moduleLabel}</span></Td>
                    <Td className="text-xs font-medium text-[var(--color-text)]">{doc.recordName}</Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">{doc.fileType.toUpperCase()}</Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">{doc.file.size ? formatFileSize(doc.file.size) : '—'}</Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">
                      {doc.uploadedAt ? fmtDate(doc.uploadedAt) : '—'}
                      {doc.uploadedBy ? <span className="block text-[10px]">by {doc.uploadedBy}</span> : null}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5 opacity-90 transition-opacity group-hover:opacity-100" data-action>
                        <Button
                          size="xs"
                          variant="outline"
                          icon={<FileText className="h-3 w-3" />}
                          onClick={() => handleView(doc)}
                          disabled={!doc.file.url}
                        >
                          View
                        </Button>
                        {doc.file.url && (
                          <button
                            type="button"
                            onClick={() => handleDownload(doc)}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                            title="Download"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={setPage}
          />
        )}
      </Card>

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
