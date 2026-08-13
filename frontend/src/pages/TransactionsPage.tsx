import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { transactionService, branchService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import {
  Button, Card, CardContent, Input, Label, Select,
  PageHeader, Skeleton, EmptyState, Table2, TableHeader, TableBody,
  TableRow, TableHead, TableCell, Badge, Modal
} from '@/components/ui';
import { formatCurrency, formatDate, cn } from '@/utils';
import { RefreshCw, Search, Calendar, DollarSign, ArrowRightLeft, User, CreditCard } from 'lucide-react';

export default function TransactionsPage() {
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  
  // Tab State: 'all' (Global History), 'timeline' (Customer Financial Timeline)
  const [activeTab, setActiveTab] = useState<'all' | 'timeline'>('all');

  // Tab 1: Global List States
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [selectedTxn, setSelectedTxn] = useState<any>(null);
  const [detailsModal, setDetailsModal] = useState(false);

  // Tab 2: Customer Timeline States
  const [timelineSearch, setTimelineSearch] = useState('');
  const [searchTrigger, setSearchTrigger] = useState('');
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineLimit, setTimelineLimit] = useState(10);

  const userBranchId = user?.role === 'super_admin' ? undefined : (typeof user?.branches?.[0] === 'string' ? user.branches[0] : user?.branches?.[0]?._id);
  const effectiveBranch = user?.role === 'super_admin' ? selectedBranch : userBranchId;
  const isSuperAdmin = user?.role === 'super_admin';

  // Fetch branches
  const { data: branchData } = useQuery({ 
    queryKey: ['branches'], 
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches) 
  });

  // Query Tab 1: Global transactions
  const params: Record<string, string> = {
    page: String(page),
    limit: String(limit),
  };
  if (effectiveBranch) params.branch = effectiveBranch;
  if (search) params.search = search;
  if (date) params.date = date;
  if (paymentType) params.paymentType = paymentType;
  if (paymentMethod) params.paymentMethod = paymentMethod;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', effectiveBranch, search, date, paymentType, paymentMethod, status, page, limit],
    queryFn: () => transactionService.getAll(params).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'all',
  });

  const transactions = data?.transactions || [];
  const pagination = data?.pagination || { total: 0, page: 1, limit: 10, pages: 1 };
  const total = pagination.total;
  const pages = pagination.pages;

  // Query Tab 2: Customer Timeline
  const timelineParams: Record<string, string> = {
    page: String(timelinePage),
    limit: String(timelineLimit),
  };
  if (effectiveBranch) timelineParams.branch = effectiveBranch;

  const { data: timelineData, isLoading: isLoadingTimeline, isFetching: isFetchingTimeline } = useQuery({
    queryKey: ['customerTimeline', searchTrigger, effectiveBranch, timelinePage, timelineLimit],
    queryFn: () => searchTrigger ? transactionService.getCustomerTimeline(searchTrigger, timelineParams).then(r => r.data.data) : null,
    enabled: activeTab === 'timeline' && !!searchTrigger,
  });

  const handleSearchTimeline = (e: React.FormEvent) => {
    e.preventDefault();
    if (timelineSearch.trim()) {
      setTimelinePage(1);
      setSearchTrigger(timelineSearch.trim());
    }
  };

  const handleViewDetails = (txn: any) => {
    setSelectedTxn(txn);
    setDetailsModal(true);
  };

  const handleResetFilters = () => {
    setSearch('');
    setDate('');
    setPaymentType('');
    setPaymentMethod('');
    setStatus('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Transaction History" 
      />

      {/* Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          className={cn(
            "px-4 py-2 text-sm font-semibold border-b-2 transition-all",
            activeTab === 'all' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab('all')}
        >
          All Transactions
        </button>
        <button
          className={cn(
            "px-4 py-2 text-sm font-semibold border-b-2 transition-all",
            activeTab === 'timeline' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab('timeline')}
        >
          Customer Financial Timeline
        </button>
      </div>

      {activeTab === 'all' ? (
        <>
          {/* Filters Card */}
          <Card className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <div className="space-y-1">
                <Label>Search Customer/TXN</Label>
                <Input
                  placeholder="ID, Name, Phone..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </div>

              <div className="space-y-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => { setDate(e.target.value); setPage(1); }}
                />
              </div>

              <div className="space-y-1">
                <Label>Type</Label>
                <Select
                  value={paymentType}
                  onChange={(e) => { setPaymentType(e.target.value); setPage(1); }}
                >
                  <option value="">All Types</option>
                  <option value="Extra">Extra</option>
                  <option value="Old Payment">Old Payment</option>
                  <option value="Session Bill">Session Bill</option>
                  <option value="Wallet Topup">Wallet Topup</option>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onChange={(e) => { setPaymentMethod(e.target.value); setPage(1); }}
                >
                  <option value="">All Methods</option>
                  <option value="cash">Cash</option>
                  <option value="upi">Online (UPI)</option>
                  <option value="wallet">Wallet</option>
                  <option value="mixed">Mixed</option>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                >
                  <option value="">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </Select>
              </div>

              <div>
                <Button variant="outline" className="w-full" onClick={handleResetFilters}>
                  Reset Filters
                </Button>
              </div>
            </div>
          </Card>

          {/* Transactions Table */}
          <Card>
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : transactions.length === 0 ? (
              <EmptyState 
                icon="💸" 
                title="No transactions found" 
                description="Try adjusting your filters or search query" 
              />
            ) : (
              <>
                <Table2>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date & Time</TableHead>
                      {isSuperAdmin && <TableHead>Branch</TableHead>}
                      <TableHead>Type</TableHead>
                      <TableHead>Original Amount</TableHead>
                      <TableHead>Deducted</TableHead>
                      <TableHead>Wallet Added</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((txn: any) => (
                      <TableRow key={txn._id}>
                        <TableCell className="font-mono text-xs">{txn.transactionId}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">{txn.customerName}</p>
                            <p className="text-xs text-muted-foreground">{txn.customerPhone}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="text-sm">{txn.transactionDate}</p>
                            <p className="text-xs text-muted-foreground">{txn.transactionTime}</p>
                          </div>
                        </TableCell>
                        {isSuperAdmin && <TableCell className="text-sm">{txn.branch?.name || '—'}</TableCell>}
                        <TableCell>
                          <Badge variant={txn.paymentType === 'Extra' ? 'warning' : txn.paymentType === 'Old Payment' ? 'success' : 'outline'}>
                            {txn.paymentType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-semibold">{formatCurrency(txn.originalAmount)}</TableCell>
                        <TableCell className="text-sm text-red-400 font-medium">
                          {txn.amountDeducted > 0 ? `-${formatCurrency(txn.amountDeducted)}` : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-emerald-400 font-medium">
                          {txn.amountAddedToWallet > 0 ? `+${formatCurrency(txn.amountAddedToWallet)}` : '—'}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{txn.paymentMethod || '—'}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => handleViewDetails(txn)}>
                            View details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table2>

                {/* Pagination */}
                <div className="flex items-center justify-between p-4 border-t border-border flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} transactions
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Show</span>
                      <Select
                        value={String(limit)}
                        onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                        className="w-20 h-8 text-xs py-0"
                      >
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                      </Select>
                      <span className="text-sm text-muted-foreground">per page</span>
                    </div>
                  </div>
                  {pages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
                      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </>
      ) : (
        /* Tab 2: Customer Timeline View */
        <div className="space-y-6">
          {/* Search Card */}
          <Card className="p-4">
            <form onSubmit={handleSearchTimeline} className="flex gap-3 items-end max-w-xl">
              <div className="space-y-1.5 flex-1">
                <Label>Search Customer</Label>
                <Input
                  placeholder="Enter Mobile Number or Customer ID (e.g. TGF00001)..."
                  value={timelineSearch}
                  onChange={(e) => setTimelineSearch(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={isFetchingTimeline}>
                {isFetchingTimeline ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Search
              </Button>
            </form>
          </Card>

          {isLoadingTimeline ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : timelineData?.customer ? (
            <div className="space-y-6">
              {/* Customer Information Card */}
              <Card className="p-4 bg-muted/20 border border-border">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground block">Customer ID</span>
                    <span className="font-semibold text-foreground">{timelineData.customer.customerId}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Customer Name</span>
                    <span className="font-semibold text-foreground">{timelineData.customer.name}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Mobile Number</span>
                    <span className="font-semibold text-foreground">{timelineData.customer.phone}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Branch</span>
                    <span className="font-semibold text-foreground">{timelineData.customer.branch || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Wallet Balance</span>
                    <span className="font-bold text-emerald-400">{formatCurrency(timelineData.customer.walletBalance)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Outstanding / Pending Payment</span>
                    <span className="font-bold text-rose-400">{formatCurrency(timelineData.customer.outstandingBalance)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs text-muted-foreground block">Email & Address</span>
                    <span className="text-sm text-foreground">
                      {timelineData.customer.email || 'No email'} | {timelineData.customer.address || 'No address'}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Complete Financial Timeline Table */}
              <Card>
                <div className="p-4 border-b border-border flex justify-between items-center bg-muted/10">
                  <h3 className="font-semibold text-foreground">Complete Chronological Timeline</h3>
                  <Badge variant="outline">Oldest to Newest</Badge>
                </div>
                {timelineData.timeline.length === 0 ? (
                  <EmptyState 
                    icon="📋" 
                    title="No financial timeline records" 
                    description="This customer does not have any pending payments, wallet credits, or receipts."
                  />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table2>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date & Time</TableHead>
                          <TableHead>Transaction</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Payment Method</TableHead>
                          <TableHead>Pending / Wallet Balances</TableHead>
                          <TableHead className="max-w-xs">Details / Notes</TableHead>
                          <TableHead>Staff</TableHead>
                          <TableHead>Transaction ID / Ref</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {timelineData.timeline.map((h: any, idx: number) => {
                          const isWallet = h.transaction.includes('Wallet');
                          
                          return (
                            <TableRow key={h.id || idx} className="hover:bg-muted/10">
                              <TableCell className="whitespace-nowrap text-xs">
                                {h.dateTime}
                              </TableCell>
                              <TableCell>
                                <Badge variant={
                                  h.transaction === 'Pending Created' ? 'outline' :
                                  h.transaction === 'Amount Deducted' ? 'warning' :
                                  h.transaction === 'Payment Received' ? 'success' :
                                  h.transaction === 'Wallet Credit' ? 'success' :
                                  h.transaction === 'Wallet Debit' ? 'danger' :
                                  h.transaction === 'Old Payment' ? 'success' :
                                  h.transaction === 'Extra Transaction' ? 'warning' : 'outline'
                                } className="text-xs px-2 py-0.5">
                                  {h.transaction}
                                </Badge>
                              </TableCell>
                              <TableCell className={cn(
                                "text-right font-medium text-xs",
                                h.transaction === 'Amount Deducted' || h.transaction === 'Wallet Debit' ? "text-red-400" :
                                h.transaction === 'Payment Received' || h.transaction === 'Wallet Credit' || h.transaction === 'Old Payment' ? "text-emerald-400" : ""
                              )}>
                                {h.transaction === 'Amount Deducted' || h.transaction === 'Wallet Debit' ? '-' : ''}
                                {formatCurrency(h.amount ?? 0)}
                              </TableCell>
                              <TableCell className="capitalize text-xs">
                                {h.paymentMethod}
                              </TableCell>
                              <TableCell className="text-xs">
                                {isWallet ? (
                                  <span className="text-emerald-400 font-semibold">
                                    Wallet: {formatCurrency(h.newWalletBalance ?? 0)} 
                                    <span className="text-xs text-muted-foreground font-normal ml-1">
                                      (Prev: {formatCurrency(h.prevWalletBalance ?? 0)})
                                    </span>
                                  </span>
                                ) : h.transaction === 'Extra Transaction' ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span className="text-amber-500 font-semibold">
                                    Pending: {formatCurrency(h.remainingPending ?? 0)}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs max-w-xs truncate" title={h.description}>
                                <div className="space-y-0.5">
                                  <span className="text-foreground/90">{h.description}</span>
                                  {h.allocationDetailsUnavailable && (
                                    <span className="text-[10px] text-amber-500 block">⚠️ Historical Data / Allocation Details Unavailable</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {h.createdBy || '—'}
                              </TableCell>
                              <TableCell className="font-mono text-[10px]">
                                {h.transactionId || '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table2>
                  </div>

                  {/* Timeline Pagination Controls */}
                  <div className="flex items-center justify-between p-4 border-t border-border flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">
                        Showing {(timelinePage - 1) * timelineLimit + 1}–{Math.min(timelinePage * timelineLimit, timelineData.pagination?.total || 0)} of {timelineData.pagination?.total || 0} records
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Show</span>
                        <Select
                          value={String(timelineLimit)}
                          onChange={(e) => { setTimelineLimit(Number(e.target.value)); setTimelinePage(1); }}
                          className="w-20 h-8 text-xs py-0"
                        >
                          <option value="10">10</option>
                          <option value="25">25</option>
                          <option value="50">50</option>
                        </Select>
                        <span className="text-sm text-muted-foreground">per page</span>
                      </div>
                    </div>
                    {timelineData.pagination?.pages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          disabled={timelinePage <= 1} 
                          onClick={() => setTimelinePage((p) => p - 1)}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {timelinePage} of {timelineData.pagination?.pages}
                        </span>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          disabled={timelinePage >= timelineData.pagination?.pages} 
                          onClick={() => setTimelinePage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>
            </div>
          ) : searchTrigger ? (
            <EmptyState 
              icon="🔍" 
              title="Customer not found" 
              description={`We couldn't find a customer with Mobile Number or Customer ID "${searchTrigger}" in your assigned branch.`}
            />
          ) : (
            <Card className="p-12 text-center border border-dashed border-border flex flex-col items-center">
              <User className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <h3 className="font-medium text-foreground">Look up customer timeline</h3>
            </Card>
          )}
        </div>
      )}

      {/* Global List View Details Modal */}
      <Modal
        open={detailsModal}
        onClose={() => { setDetailsModal(false); setSelectedTxn(null); }}
        title="Transaction Details"
        size="lg"
      >
        {selectedTxn && (
          <div className="space-y-4">
            {selectedTxn.allocationDetailsUnavailable && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-500 text-xs font-semibold flex items-center gap-2">
                ⚠️ Historical Data / Allocation Details Unavailable for this record.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Transaction Info</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Transaction ID</span>
                    <span className="font-mono">{selectedTxn.transactionId}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Date & Time</span>
                    <span>{selectedTxn.transactionDate} {selectedTxn.transactionTime}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Transaction Type</span>
                    <Badge variant="outline">{selectedTxn.paymentType}</Badge>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Processed By</span>
                    <span>{selectedTxn.createdBy?.name || 'System / Staff'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Customer Info</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Customer Name</span>
                    <span>{selectedTxn.customerName}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Mobile Number</span>
                    <span>{selectedTxn.customerPhone}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Customer ID</span>
                    <span>{selectedTxn.customerId}</span>
                  </div>
                  {isSuperAdmin && (
                    <div>
                      <span className="text-xs text-muted-foreground block">Branch</span>
                      <span>{selectedTxn.branch?.name || '—'}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="col-span-2 space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Financial Breakdown</h3>
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Original Amount</span>
                    <span className="font-bold text-base">{formatCurrency(selectedTxn.originalAmount)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Deducted from Pending</span>
                    <span className="font-semibold text-red-400">{formatCurrency(selectedTxn.amountDeducted)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Remaining Pending</span>
                    <span className="font-semibold">{formatCurrency(selectedTxn.remainingAmount)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Added to Wallet</span>
                    <span className="font-semibold text-emerald-400">{formatCurrency(selectedTxn.amountAddedToWallet)}</span>
                  </div>
                </div>
              </div>

              {!selectedTxn.allocationDetailsUnavailable && (
                <div className="col-span-2 space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                  <h3 className="text-sm font-semibold text-foreground">Allocation References</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block">Pending Payment Order ID(s)</span>
                      <span className="font-mono text-xs">{selectedTxn.pendingPaymentOrderIds?.join(', ') || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Wallet Reference</span>
                      <span className="font-mono text-xs">{selectedTxn.walletIdRef || '—'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => { setDetailsModal(false); setSelectedTxn(null); }}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
