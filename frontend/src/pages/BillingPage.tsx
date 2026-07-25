import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { billingService } from '@/services';
import { useAppStore } from '@/store';
import type { Bill } from '@/types';
import {
  Button, Card, Badge, PageHeader, Input, Label, Select,
  Skeleton, EmptyState, Table2, TableHeader, TableBody, TableRow,
  TableHead, TableCell, useToast
} from '@/components/ui';
import { formatCurrency, formatDateTime, downloadBlob, cn } from '@/utils';

// ── Main Billing Page ─────────────────────────────────────────────────────────
export default function BillingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();

  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');

  const params: Record<string, string> = {};
  if (selectedBranch) params.branch = selectedBranch;
  if (statusFilter !== 'all') params.status = statusFilter;
  if (search) params.search = search;
  params.page = String(page);
  params.limit = String(rowsPerPage);

  const { data, isLoading } = useQuery({
    queryKey: ['bills', selectedBranch, statusFilter, page, rowsPerPage, search],
    queryFn: () => billingService.getAll(params).then((r) => r.data),
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    staleTime: 0,
    gcTime: 0,
  });

  const bills: Bill[] = (data as any)?.data?.bills || [];
  const total: number = (data as any)?.total || 0;
  const totalPages: number = (data as any)?.totalPages || 1;
  const hasNextPage: boolean = (data as any)?.hasNextPage || false;
  const hasPreviousPage: boolean = (data as any)?.hasPreviousPage || false;

  const payStatusColor: Record<string, string> = {
    paid: 'success',
    unpaid: 'danger',
    partial: 'warning',
  };

  const handleDownloadPDF = async (bill: Bill) => {
    try {
      const res = await billingService.downloadPDF(bill._id);
      downloadBlob(res.data as Blob, `${bill.invoiceNumber}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Billing"
      />

      {/* Search and Page Length */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by invoice # or customer name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
          <Select
            value={String(rowsPerPage)}
            onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
            className="w-20"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'paid', 'unpaid', 'partial'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
              statusFilter === s
                ? 'gradient-brand text-white border-transparent'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {/* Bills table */}
      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : bills.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No bills found"
            description="Stop a table session to generate a bill"
          />
        ) : (
          <Table2>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill._id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {bill.invoiceNumber}
                  </TableCell>
                  <TableCell>
                    {bill.customer?.name || (bill.session as any)?.customerName || (
                      <span className="text-muted-foreground italic">
                        Walk-in
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(bill.createdAt)}
                  </TableCell>
                  <TableCell className="font-bold text-emerald-400">
                    {formatCurrency(bill.total)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={payStatusColor[bill.paymentStatus] as any}
                      className="capitalize"
                    >
                      {bill.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadPDF(bill)}
                      >
                        Invoice
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          // TODO: Implement edit functionality
                          toast.info('Edit functionality to be implemented');
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table2>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, total)} of {total} records
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={!hasPreviousPage} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
