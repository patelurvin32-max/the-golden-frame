import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '@/services';
import {
  Button, Card, Input, Select, Modal,
  Table2, TableHeader, TableRow, TableHead, TableBody, TableCell
} from '@/components/ui';
import { format } from 'date-fns';
import { ArrowDownIcon, ArrowUpIcon, Edit2Icon, InfoIcon, RepeatIcon } from 'lucide-react';
import type { InventoryItem } from '@/types';

interface InventoryLedgerModalProps {
  item: InventoryItem;
  onClose: () => void;
}

export default function InventoryLedgerModal({ item, onClose }: InventoryLedgerModalProps) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [type, setType] = useState('');

  const params: Record<string, any> = {
    page,
    limit: pageSize,
    ...(fromDate && { fromDate }),
    ...(toDate && { toDate }),
    ...(type && { type }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-history', item._id, params],
    queryFn: () => inventoryService.getHistory(item._id, params).then((res) => res.data.data),
  });

  const transactions = data?.transactions || [];
  const summary = data?.summary || { openingStock: 0, closingStock: 0, totalIn: 0, totalOut: 0, totalAdjustments: 0 };
  const pagination = data?.pagination || { page: 1, limit: 10, total: 0, pages: 1 };

  const getTypeIcon = (txnType: string) => {
    switch (txnType) {
      case 'stock_in':
      case 'restock':
      case 'refund':
        return <ArrowDownIcon className="w-4 h-4 text-emerald-500" />;
      case 'stock_out':
      case 'sale':
        return <ArrowUpIcon className="w-4 h-4 text-rose-500" />;
      case 'transfer':
        return <RepeatIcon className="w-4 h-4 text-blue-500" />;
      case 'adjustment':
        return <Edit2Icon className="w-4 h-4 text-amber-500" />;
      default:
        return <InfoIcon className="w-4 h-4 text-slate-500" />;
    }
  };

  const getTypeText = (txnType: string) => {
    const labels: Record<string, string> = {
      stock_in: 'Stock In',
      restock: 'Restock',
      refund: 'Refund',
      stock_out: 'Stock Out',
      sale: 'Sale',
      transfer: 'Transfer',
      adjustment: 'Adjustment',
    };
    return labels[txnType] || txnType;
  };

  const getQuantityDisplay = (txn: any) => {
    const diff = txn.newStock - txn.previousStock;
    if (diff > 0) return <span className="text-emerald-500 font-medium">+{diff}</span>;
    if (diff < 0) return <span className="text-rose-500 font-medium">{diff}</span>;
    return <span className="text-slate-500 font-medium">{diff}</span>;
  };

  return (
    <Modal open={true} onClose={onClose} title={`Stock Ledger - ${item.name}`} size="xl">
      <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3 bg-slate-900/50 border-slate-800">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Opening</p>
            <p className="text-2xl font-bold mt-1 text-slate-200">{summary.openingStock}</p>
          </Card>
          <Card className="p-3 bg-slate-900/50 border-emerald-900/30">
            <p className="text-xs text-emerald-500/80 uppercase tracking-wider font-semibold">In (+)</p>
            <p className="text-2xl font-bold mt-1 text-emerald-500">{summary.totalIn}</p>
          </Card>
          <Card className="p-3 bg-slate-900/50 border-rose-900/30">
            <p className="text-xs text-rose-500/80 uppercase tracking-wider font-semibold">Out (-)</p>
            <p className="text-2xl font-bold mt-1 text-rose-500">{summary.totalOut}</p>
          </Card>
          <Card className="p-3 bg-slate-900/50 border-amber-900/30">
            <p className="text-xs text-amber-500/80 uppercase tracking-wider font-semibold">Adj (±)</p>
            <p className="text-2xl font-bold mt-1 text-amber-500">{summary.totalAdjustments > 0 ? '+' : ''}{summary.totalAdjustments}</p>
          </Card>
          <Card className="p-3 bg-slate-800/80 border-slate-700 shadow-inner">
            <p className="text-xs text-slate-300 uppercase tracking-wider font-semibold">Closing</p>
            <p className="text-2xl font-bold mt-1 text-white">{summary.closingStock}</p>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5 flex-1 min-w-[130px]">
            <label className="text-xs font-medium text-muted-foreground">From Date</label>
            <Input type="date" value={fromDate} onChange={(e: any) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[130px]">
            <label className="text-xs font-medium text-muted-foreground">To Date</label>
            <Input type="date" value={toDate} onChange={(e: any) => setToDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[150px]">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onChange={(e: any) => setType(e.target.value)}>
              <option value="">All Types</option>
              <option value="stock_in">Stock In</option>
              <option value="stock_out">Stock Out</option>
              <option value="sale">Sale</option>
              <option value="restock">Restock</option>
              <option value="adjustment">Adjustment</option>
            </Select>
          </div>
          <Button variant="outline" onClick={() => { setFromDate(''); setToDate(''); setType(''); setPage(1); }}>
            Reset
          </Button>
        </div>

        {/* Table */}
        <Card className="overflow-hidden border-border/50">
          <div className="overflow-x-auto">
            <Table2>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-slate-900/30">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">New Stock</TableHead>
                  <TableHead>Cost/Unit</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>User / Ref</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading history...</TableCell></TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No stock history found.</TableCell></TableRow>
                ) : (
                  transactions.map((txn: any) => (
                    <TableRow key={txn._id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium">{format(new Date(txn.createdAt), 'dd MMM yyyy')}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(txn.createdAt), 'hh:mm a')}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(txn.type)}
                          <span className="capitalize">{getTypeText(txn.type)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">{txn.previousStock}</TableCell>
                      <TableCell className="text-right">{getQuantityDisplay(txn)}</TableCell>
                      <TableCell className="text-right font-bold text-slate-200">{txn.newStock}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(txn.type === 'restock' || txn.type === 'stock_in') && txn.cost ? `₹${txn.cost}` : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(txn.type === 'restock' || txn.type === 'stock_in') && txn.supplier ? txn.supplier : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{txn.createdBy?.name || 'System'}</div>
                        {txn.order && <div className="text-xs text-muted-foreground">Order: {String(txn.order).slice(-6)}</div>}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground" title={txn.notes}>
                        {txn.notes || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table2>
          </div>
          
          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border/50 bg-slate-900/20">
              <div className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, pagination.total)} of {pagination.total} entries
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <div className="flex items-center px-3 text-sm font-medium">{page} / {pagination.pages}</div>
                <Button size="sm" variant="outline" disabled={page === pagination.pages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Modal>
  );
}
