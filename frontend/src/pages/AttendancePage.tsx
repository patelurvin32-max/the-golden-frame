import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attendanceService, userService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Table2,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@/components/ui';
import { downloadBlob, formatDate, formatDuration } from '@/utils';
import type { AttendanceHistoryStats, AttendanceRecord, AttendanceStatus, User } from '@/types';

type AttendanceDraft = {
  checkIn?: string;
  checkOut?: string;
  notes?: string;
  status?: AttendanceStatus;
  workingHours?: number;
};

type SavedFlag = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'half_day', 'leave', 'weekly_off', 'holiday'];

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  leave: 'Leave',
  weekly_off: 'Weekly Off',
  holiday: 'Holiday',
};

const STATUS_BADGES: Record<AttendanceStatus, 'success' | 'danger' | 'warning' | 'info' | 'outline'> = {
  present: 'success',
  absent: 'danger',
  half_day: 'warning',
  leave: 'info',
  weekly_off: 'outline',
  holiday: 'outline',
};

const DEFAULT_PAGE_SIZE = 12;

const normalizeDateInput = (value: string) => value.slice(0, 10);
const toInputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatTimeValue = (value?: string) => value || '—';

const timeToMinutes = (value?: string) => {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const getWorkingMinutes = (record?: AttendanceRecord, draft?: AttendanceDraft) => {
  const checkIn = draft?.checkIn ?? record?.checkIn;
  const checkOut = draft?.checkOut ?? record?.checkOut;
  if (draft?.workingHours !== undefined) return draft.workingHours;
  if (record?.workingHours !== undefined) return record.workingHours;
  const inMinutes = timeToMinutes(checkIn);
  const outMinutes = timeToMinutes(checkOut);
  if (inMinutes === null || outMinutes === null) return null;
  let diff = outMinutes - inMinutes;
  if (diff < 0) diff += 24 * 60;
  return diff;
};

const resolveBranchId = (user: User) => {
  const branch = user.branches?.[0];
  return typeof branch === 'string' ? branch : branch?._id || '';
};

const attendanceFromRecords = (records: AttendanceRecord[]) => Object.fromEntries(records.map((record) => [record.employee._id, record]));

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function AttendanceHistoryModal({
  open,
  onClose,
  employee,
  history,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  employee: User | null;
  history?: { records: AttendanceRecord[]; stats: AttendanceHistoryStats };
  loading: boolean;
}) {
  const stats = history?.stats;

  return (
    <Modal open={open} onClose={onClose} title={employee ? `${employee.name} Attendance History` : 'Attendance History'} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Last 30 Days', value: stats?.totalDays ?? 0 },
            { label: 'Monthly %', value: stats ? `${stats.monthlyAttendancePercentage}%` : '0%' },
            { label: 'Present', value: stats?.present ?? 0 },
            { label: 'Absent', value: stats?.absent ?? 0 },
            { label: 'Leave', value: stats?.leave ?? 0 },
            { label: 'Half Day', value: stats?.halfDay ?? 0 },
            { label: 'Late Arrivals', value: stats?.lateArrivals ?? 0 },
            { label: 'Overtime', value: stats ? formatDuration(stats.overtimeMinutes || 0) : '0m' },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-lg font-semibold">{item.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last 30 Days Attendance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-12" />)}
              </div>
            ) : history?.records.length ? (
              <div className="overflow-x-auto border border-border rounded-xl">
                <Table2 className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap">Check In</TableHead>
                      <TableHead className="whitespace-nowrap">Check Out</TableHead>
                      <TableHead className="whitespace-nowrap">Working Hours</TableHead>
                      <TableHead className="whitespace-nowrap">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.records.map((record) => (
                      <TableRow key={record._id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(record.date)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant={STATUS_BADGES[record.status]} className="capitalize">
                            {STATUS_LABELS[record.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatTimeValue(record.checkIn)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatTimeValue(record.checkOut)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{record.workingHours ? formatDuration(record.workingHours) : '—'}</TableCell>
                        <TableCell className="max-w-[240px] min-w-0 truncate text-sm text-muted-foreground whitespace-nowrap">{record.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table2>
              </div>
            ) : (
              <EmptyState icon="📅" title="No history found" description="No attendance records are available for the selected range." />
            )}
          </CardContent>
        </Card>
      </div>
    </Modal>
  );
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch, setSelectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const saveTimers = useRef<Record<string, number | undefined>>({});
  const saveStateTimers = useRef<Record<string, number | undefined>>({});
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({});
  const [savingState, setSavingState] = useState<Record<string, SavedFlag>>({});
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);

  // Auto-set branch for Branch Manager based on their assigned branch
  useEffect(() => {
    if (user?.role === 'branch_manager' && user.branches?.[0] && !selectedBranch) {
      const branchId = typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id;
      setSelectedBranch(branchId);
    }
  }, [user, selectedBranch, setSelectedBranch]);

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getAll().then((r) => r.data.data.users),
  });

  const { data: attendanceResponse, isLoading: attendanceLoading } = useQuery({
    queryKey: ['attendance', selectedBranch, date],
    queryFn: () =>
      attendanceService
        .getAll({
          date,
          branch: selectedBranch || '',
          page: '1',
          limit: '1000',
        })
        .then((r) => r.data.data),
  });

  const historyQuery = useQuery({
    queryKey: ['attendance-history', historyEmployeeId, selectedBranch],
    queryFn: () =>
      attendanceService
        .history(historyEmployeeId as string, {
          branch: selectedBranch || '',
        })
        .then((r) => r.data.data),
    enabled: Boolean(historyEmployeeId),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => attendanceService.mark(payload),
    onSuccess: (_data, variables) => {
      const employeeId = String(variables?.employee || '');
      if (employeeId) {
        setSavingState((current) => ({ ...current, [employeeId]: 'saved' }));
        scheduleStatusReset(employeeId);
      }
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (error: any, payload: any) => {
      const employeeId = String(payload?.employee || '');
      setSavingState((current) => ({ ...current, [employeeId]: 'error' }));
      toast.error(error?.response?.data?.message || 'Failed to save attendance');
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => attendanceService.bulkMark(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Selected attendance updated');
      setSelectedIds([]);
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Bulk update failed'),
  });

  const exportMutation = useMutation({
    mutationFn: async ({ format, params }: { format: 'excel' | 'pdf'; params: Record<string, string> }) => {
      const res = format === 'excel' ? await attendanceService.exportExcel(params) : await attendanceService.exportPDF(params);
      return { format, blob: res.data as Blob };
    },
    onSuccess: ({ format, blob }, variables) => {
      const suffix = variables.params.employees ? 'selected' : variables.params.date || 'report';
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      downloadBlob(blob, `thegoldenframe-attendance-${suffix}.${ext}`);
      toast.success(`${format.toUpperCase()} exported`);
    },
    onError: () => toast.error('Export failed'),
  });

  const staff = useMemo(() => {
    return (staffData || []).filter((user) => user.role !== 'super_admin' && user.isActive);
  }, [staffData]);

  const attendanceMap = useMemo(() => {
    return attendanceFromRecords(attendanceResponse?.records || []);
  }, [attendanceResponse?.records]);

  const branchScopedStaff = useMemo(() => {
    return staff.filter((user) => {
      if (!selectedBranch) return true;
      return user.branches?.some((branch) => (typeof branch === 'string' ? branch : branch._id) === selectedBranch);
    });
  }, [staff, selectedBranch]);

  const filteredStaff = useMemo(() => {
    return branchScopedStaff.filter((user) => {
      const record = attendanceMap[user._id];
      if (roleFilter && user.role !== roleFilter) return false;
      if (statusFilter && record?.status !== statusFilter) return false;
      if (search) {
        const text = `${user.name} ${user.email} ${user.phone || ''}`.toLowerCase();
        if (!text.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [branchScopedStaff, attendanceMap, roleFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const visibleStaff = filteredStaff.slice((page - 1) * pageSize, page * pageSize);
  const allFilteredSelected = filteredStaff.length > 0 && selectedIds.length === filteredStaff.length;
  const allVisibleSelected = visibleStaff.length > 0 && visibleStaff.every((user) => selectedIds.includes(user._id));

  useEffect(() => {
    setPage(1);
  }, [date, search, roleFilter, statusFilter, selectedBranch]);

  useEffect(() => {
    setDrafts({});
    setSelectedIds([]);
    setSavingState({});
  }, [date, selectedBranch]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) => filteredStaff.some((user) => user._id === id));
      if (next.length === current.length && next.every((id, idx) => id === current[idx])) {
        return current;
      }
      return next;
    });
  }, [filteredStaff]);

  useEffect(() => {
    if (!attendanceResponse?.records?.length) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const record of attendanceResponse.records) {
        if (!next[record.employee._id]) {
          next[record.employee._id] = {
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            notes: record.notes,
            status: record.status,
            workingHours: record.workingHours,
          };
        }
      }
      return next;
    });
  }, [attendanceResponse?.records]);

  useEffect(() => () => {
    Object.values(saveTimers.current).forEach((timer) => timer && window.clearTimeout(timer));
    Object.values(saveStateTimers.current).forEach((timer) => timer && window.clearTimeout(timer));
  }, []);

  const scheduleStatusReset = (employeeId: string) => {
    if (saveStateTimers.current[employeeId]) window.clearTimeout(saveStateTimers.current[employeeId]);
    saveStateTimers.current[employeeId] = window.setTimeout(() => {
      setSavingState((current) => ({ ...current, [employeeId]: 'idle' }));
    }, 1200);
  };

  const saveRow = (user: User, patch: Partial<AttendanceDraft>) => {
    const branch = selectedBranch || resolveBranchId(user);
    if (!branch) {
      toast.error('Branch required');
      return;
    }

    setDrafts((current) => ({ ...current, [user._id]: { ...current[user._id], ...patch } }));
    const merged = { ...drafts[user._id], ...patch };
    const status = merged.status || attendanceMap[user._id]?.status || 'present';
    const payload = {
      employee: user._id,
      branch,
      date,
      status,
      checkIn: merged.checkIn || '',
      checkOut: merged.checkOut || '',
      notes: merged.notes || '',
      workingHours: getWorkingMinutes(attendanceMap[user._id], merged) ?? undefined,
    };

    setSavingState((state) => ({ ...state, [user._id]: 'saving' }));
    scheduleStatusReset(user._id);
    saveMutation.mutate(payload);
  };

  const updateDraft = (user: User, patch: Partial<AttendanceDraft>, commitImmediately = false) => {
    setDrafts((current) => ({
      ...current,
      [user._id]: { ...current[user._id], ...patch },
    }));

    if (commitImmediately) {
      saveRow(user, patch);
      return;
    }

    if (saveTimers.current[user._id]) window.clearTimeout(saveTimers.current[user._id]);
    saveTimers.current[user._id] = window.setTimeout(() => {
      saveRow(user, patch);
    }, 700);
  };

  const handleBulkStatus = (status: AttendanceStatus) => {
    if (!selectedIds.length) {
      toast.info('Select at least one employee first');
      return;
    }

    const payloadRecords = selectedIds.map((id) => {
      const record = attendanceMap[id];
      const draft = drafts[id];
      return {
        employee: id,
        checkIn: draft?.checkIn ?? record?.checkIn,
        checkOut: draft?.checkOut ?? record?.checkOut,
        notes: draft?.notes ?? record?.notes,
        workingHours: getWorkingMinutes(record, draft || {}) ?? undefined,
      };
    });

    const bulkBranch = selectedBranch || resolveBranchId(staff.find((user) => selectedIds.includes(user._id)) || staff[0]);
    if (!bulkBranch) {
      toast.error('Branch required');
      return;
    }

    bulkMutation.mutate({
      employeeIds: selectedIds,
      branch: bulkBranch,
      date,
      status,
      records: payloadRecords,
    });
  };

  const selectedBranchParams: Record<string, string> = {};
  if (selectedBranch) selectedBranchParams.branch = selectedBranch;

  const reportRange: Record<string, string> = {
    date,
    from: date,
    to: date,
    ...selectedBranchParams,
  };

  const handleQuickReport = (kind: 'daily' | 'weekly' | 'monthly' | 'employee') => {
    const [year, month, day] = date.split('-').map(Number);
    const today = new Date(year, month - 1, day);
    const params: Record<string, string> = { ...selectedBranchParams };
    if (kind === 'daily') {
      params.date = date;
      exportMutation.mutate({ format: 'excel', params });
      return;
    }
    if (kind === 'weekly') {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      params.from = toInputDate(from);
      params.to = date;
      exportMutation.mutate({ format: 'excel', params });
      return;
    }
    if (kind === 'monthly') {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      params.from = toInputDate(from);
      params.to = date;
      exportMutation.mutate({ format: 'excel', params });
      return;
    }
    if (kind === 'employee') {
      const employeeId = selectedIds[0];
      if (!employeeId) {
        toast.info('Select one employee for an employee report');
        return;
      }
      params.employees = employeeId;
      exportMutation.mutate({ format: 'excel', params });
    }
  };

  const handleExportSelected = (format: 'excel' | 'pdf') => {
    if (!selectedIds.length) {
      toast.info('Select at least one employee first');
      return;
    }
    exportMutation.mutate({
      format,
      params: {
        ...selectedBranchParams,
        date,
        employees: selectedIds.join(','),
      },
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(filteredStaff.map((user) => user._id));
  };

  const summary = {
    totalStaff: branchScopedStaff.length,
    present: 0,
    absent: 0,
    halfDay: 0,
  };

  for (const user of branchScopedStaff) {
    const status = attendanceMap[user._id]?.status;
    if (status === 'present') summary.present += 1;
    if (status === 'absent') summary.absent += 1;
    if (status === 'half_day') summary.halfDay += 1;
  }

  const attendanceHistoryEmployee = historyEmployeeId
    ? staff.find((user) => user._id === historyEmployeeId) || null
    : null;

  const isSaving = (employeeId: string) => savingState[employeeId] === 'saving';
  const isSaved = (employeeId: string) => savingState[employeeId] === 'saved';

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Attendance"
        actions={
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button size="sm" variant="outline" className="flex-1 min-w-[120px] sm:flex-none text-center justify-center" onClick={() => handleQuickReport('daily')}>Daily Report</Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[120px] sm:flex-none text-center justify-center" onClick={() => handleQuickReport('weekly')}>Weekly Report</Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[120px] sm:flex-none text-center justify-center" onClick={() => handleQuickReport('monthly')}>Monthly Report</Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[120px] sm:flex-none text-center justify-center" onClick={() => handleQuickReport('employee')}>Employee Report</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Staff" value={summary.totalStaff} />
        <SummaryCard label="Present" value={summary.present} />
        <SummaryCard label="Absent" value={summary.absent} />
        <SummaryCard label="Half Day" value={summary.halfDay} />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3 items-end">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label>Search Employee</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" className="w-full" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Role Filter</Label>
              <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-full">
                <option value="">All Roles</option>
                <option value="branch_manager">Branch Manager</option>
                <option value="staff">Staff</option>
                <option value="cashier">Cashier</option>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Status Filter</Label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full">
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label>Export Attendance</Label>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" variant="outline" onClick={() => exportMutation.mutate({ format: 'pdf', params: reportRange })}>Export PDF</Button>
                <Button size="sm" className="flex-1" variant="outline" onClick={() => exportMutation.mutate({ format: 'excel', params: reportRange })}>Export Excel</Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <Button size="sm" className="flex-1 sm:flex-none min-w-[130px]" variant="outline" onClick={() => toggleSelectAll(!allVisibleSelected)}>
                {allFilteredSelected ? 'Clear Select All' : 'Select All'}
              </Button>
              <Button size="sm" className="flex-1 sm:flex-none min-w-[130px]" variant="outline" onClick={() => handleBulkStatus('present')}>Mark Selected Present</Button>
              <Button size="sm" className="flex-1 sm:flex-none min-w-[130px]" variant="outline" onClick={() => handleBulkStatus('absent')}>Mark Selected Absent</Button>
              <Button size="sm" className="flex-1 sm:flex-none min-w-[130px]" variant="outline" onClick={() => handleBulkStatus('leave')}>Mark Selected Leave</Button>
              <Button size="sm" className="flex-1 sm:flex-none min-w-[130px]" variant="outline" onClick={() => handleExportSelected('excel')}>Export Selected</Button>
            </div>
            <p className="text-xs text-muted-foreground text-center sm:text-right flex-shrink-0">
              {selectedIds.length} selected
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {attendanceLoading || staffLoading ? (
            <div className="space-y-3 p-4">
              {[...Array(5)].map((_, index) => <Skeleton key={index} className="h-14" />)}
            </div>
          ) : filteredStaff.length === 0 ? (
            <EmptyState icon="👥" title="No staff members found" description="Try adjusting the date or filters." />
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table2 className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 z-20 bg-card w-10">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="rounded border-border"
                          aria-label="Select all employees"
                        />
                      </TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Employee</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Role</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Check In</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Check Out</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Working Hours</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Status</TableHead>
                      <TableHead className="sticky top-0 z-20 bg-card">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleStaff.map((user) => {
                      const record = attendanceMap[user._id];
                      const draft = drafts[user._id] || {};
                      const employeeStatus = (draft.status || record?.status || '') as AttendanceStatus | '';
                      const workingMinutes = getWorkingMinutes(record, draft);
                      return (
                        <TableRow key={user._id} className="hover:bg-accent/40">
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(user._id)}
                              onChange={(e) =>
                                setSelectedIds((current) =>
                                  e.target.checked ? [...current, user._id] : current.filter((id) => id !== user._id)
                                )
                              }
                              className="rounded border-border"
                              aria-label={`Select ${user.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="text-left font-semibold hover:text-primary transition-colors"
                              onClick={() => setHistoryEmployeeId(user._id)}
                            >
                              {user.name}
                            </button>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </TableCell>
                          <TableCell className="capitalize text-sm text-muted-foreground">{user.role.replace('_', ' ')}</TableCell>
                          <TableCell>
                            <Input
                              type="time"
                              value={draft.checkIn ?? record?.checkIn ?? ''}
                              onChange={(e) => updateDraft(user, { checkIn: e.target.value })}
                              className="w-24"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="time"
                              value={draft.checkOut ?? record?.checkOut ?? ''}
                              onChange={(e) => updateDraft(user, { checkOut: e.target.value })}
                              className="w-24"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {workingMinutes !== null ? formatDuration(workingMinutes) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Select
                                value={employeeStatus}
                                onChange={(e) => updateDraft(user, { status: e.target.value as AttendanceStatus }, true)}
                                className="w-full sm:w-[140px]"
                              >
                                <option value="">Select</option>
                                {STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                                ))}
                              </Select>
                              {employeeStatus ? (
                                <Badge variant={STATUS_BADGES[employeeStatus]} className="capitalize">
                                  {STATUS_LABELS[employeeStatus]}
                                </Badge>
                              ) : null}
                              {isSaving(user._id) && <span className="text-[11px] text-muted-foreground">Saving...</span>}
                              {isSaved(user._id) && <span className="text-[11px] text-emerald-400">Saved</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={draft.notes ?? record?.notes ?? ''}
                              onChange={(e) => updateDraft(user, { notes: e.target.value })}
                              placeholder="Notes"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table2>
              </div>

              <div className="space-y-3 p-4 md:hidden">
                {visibleStaff.map((user) => {
                  const record = attendanceMap[user._id];
                  const draft = drafts[user._id] || {};
                  const employeeStatus = (draft.status || record?.status || '') as AttendanceStatus | '';
                  const workingMinutes = getWorkingMinutes(record, draft);
                  return (
                    <Card key={user._id} className="overflow-hidden">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <button
                              type="button"
                              className="font-semibold text-left hover:text-primary transition-colors"
                              onClick={() => setHistoryEmployeeId(user._id)}
                            >
                              {user.name}
                            </button>
                            <p className="text-xs text-muted-foreground">{user.role.replace('_', ' ')}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(user._id)}
                            onChange={(e) =>
                              setSelectedIds((current) =>
                                e.target.checked ? [...current, user._id] : current.filter((id) => id !== user._id)
                              )
                            }
                            className="mt-1 rounded border-border"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Check In</Label>
                            <Input type="time" value={draft.checkIn ?? record?.checkIn ?? ''} onChange={(e) => updateDraft(user, { checkIn: e.target.value })} className="text-xs px-2" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Check Out</Label>
                            <Input type="time" value={draft.checkOut ?? record?.checkOut ?? ''} onChange={(e) => updateDraft(user, { checkOut: e.target.value })} className="text-xs px-2" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Working Hours</Label>
                            <Input value={workingMinutes !== null ? formatDuration(workingMinutes) : '—'} readOnly className="text-xs px-2 bg-muted/20" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Status</Label>
                            <Select value={employeeStatus} onChange={(e) => updateDraft(user, { status: e.target.value as AttendanceStatus }, true)} className="text-xs px-2">
                              <option value="">Select</option>
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                              ))}
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Notes</Label>
                          <Input value={draft.notes ?? record?.notes ?? ''} onChange={(e) => updateDraft(user, { notes: e.target.value })} placeholder="Notes" />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant={employeeStatus ? STATUS_BADGES[employeeStatus] : 'outline'} className="capitalize">
                            {employeeStatus ? STATUS_LABELS[employeeStatus] : 'Not marked'}
                          </Badge>
                          <div className="text-[11px] text-muted-foreground">
                            {isSaving(user._id) ? 'Saving...' : isSaved(user._id) ? 'Saved' : ''}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {filteredStaff.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredStaff.length)} of {filteredStaff.length}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AttendanceHistoryModal
        open={Boolean(historyEmployeeId)}
        onClose={() => setHistoryEmployeeId(null)}
        employee={attendanceHistoryEmployee}
        history={historyQuery.data}
        loading={historyQuery.isLoading}
      />
    </div>
  );
}
