import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attendanceService } from '@/services';
import { useAuthStore } from '@/store';
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
  PageHeader,
  Skeleton,
  Table2,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@/components/ui';
import { formatDate, formatDuration } from '@/utils';
import type { AttendanceRecord, AttendanceStatus, MyAttendanceResponse } from '@/types';

const STATUS_VARIANTS: Record<AttendanceStatus, 'success' | 'danger' | 'warning' | 'info' | 'outline'> = {
  present: 'success',
  absent: 'danger',
  half_day: 'warning',
  leave: 'info',
  weekly_off: 'outline',
  holiday: 'outline',
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  leave: 'Leave',
  weekly_off: 'Weekly Off',
  holiday: 'Holiday',
};

const RANGE_LABELS: Record<'today' | 'week' | 'month' | 'custom', string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  custom: 'Custom Date Range',
};

const PAGE_SIZE = 10;

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);

const parseMinutes = (value?: string) => {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const diffMinutes = (start?: string, end?: string) => {
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  let diff = endMinutes - startMinutes;
  if (diff < 0) diff += 24 * 60;
  return diff;
};

const formatTimeValue = (value?: string) => value || '—';

const startOfWeek = (date: Date) => {
  const result = new Date(date);
  const dayIndex = result.getDay();
  const offset = dayIndex === 0 ? 6 : dayIndex - 1;
  result.setDate(result.getDate() - offset);
  return result;
};

const resolveStatus = (record?: AttendanceRecord | null) => {
  if (!record) return 'absent' as const;
  if (record.status === 'half_day' || record.status === 'leave' || record.status === 'weekly_off' || record.status === 'holiday') {
    return record.status;
  }
  if (record.checkOut) {
    const totalMinutes = record.workingHours ?? diffMinutes(record.checkIn, record.checkOut);
    if (totalMinutes !== null && totalMinutes < 4 * 60) return 'half_day';
  }
  return 'present';
};

const resolveWorkingMinutes = (record?: AttendanceRecord | null) => {
  if (!record) return null;
  if (record.workingHours !== undefined && record.workingHours !== null) return record.workingHours;
  if (record.checkIn && record.checkOut) {
    return diffMinutes(record.checkIn, record.checkOut);
  }
  return null;
};

export default function MyAttendancePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuthStore();
  const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [fromDate, setFromDate] = useState(() => toDateInput(new Date()));
  const [toDate, setToDate] = useState(() => toDateInput(new Date()));
  const [page, setPage] = useState(1);

  useEffect(() => {
    const today = toDateInput(new Date());
    if (rangePreset === 'today') {
      setFromDate(today);
      setToDate(today);
      return;
    }
    if (rangePreset === 'week') {
      setFromDate(toDateInput(startOfWeek(new Date())));
      setToDate(today);
      return;
    }
    if (rangePreset === 'month') {
      const firstDay = new Date();
      firstDay.setDate(1);
      setFromDate(toDateInput(firstDay));
      setToDate(today);
    }
  }, [rangePreset]);

  const normalizedRange = useMemo(() => {
    const [start, end] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
    if (rangePreset === 'today') return { range: 'today', from: fromDate, to: toDate };
    if (rangePreset === 'week') return { range: 'week', from: start, to: end };
    if (rangePreset === 'month') return { range: 'month', from: start, to: end };
    return { range: 'custom', from: start, to: end };
  }, [rangePreset, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [normalizedRange.range, normalizedRange.from, normalizedRange.to]);

  const { data, isLoading } = useQuery<MyAttendanceResponse>({
    queryKey: ['my-attendance', user?._id, normalizedRange.range, normalizedRange.from, normalizedRange.to, page, PAGE_SIZE],
    queryFn: () =>
      attendanceService
        .getMyAttendance({
          range: normalizedRange.range,
          from: normalizedRange.from,
          to: normalizedRange.to,
          page: String(page),
          limit: String(PAGE_SIZE),
        })
        .then((res) => res.data.data),
    enabled: Boolean(user?._id),
    placeholderData: keepPreviousData,
  });

  const getCurrentPosition = (): Promise<{ latitude: number; longitude: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error('Location permission denied. Please allow location access to mark attendance.'));
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            reject(new Error('Unable to determine your location. Please try again.'));
          } else {
            reject(new Error('Location request timed out. Please try again.'));
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const location = await getCurrentPosition();
      const res = await attendanceService.checkInMyAttendance(location);
      if (res.data && !res.data.success) {
        throw new Error((res.data as any).message || 'Check-in failed');
      }
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-attendance'] });
      toast.success('Check-in saved');
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Check-in failed'),
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const location = await getCurrentPosition();
      const res = await attendanceService.checkOutMyAttendance(location);
      if (res.data && !res.data.success) {
        throw new Error((res.data as any).message || 'Check-out failed');
      }
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-attendance'] });
      toast.success('Check-out saved');
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Check-out failed'),
  });

  const todayAttendance = data?.todayAttendance || null;
  const history = data?.records || [];
  const currentPage = data?.currentPage || 1;
  const totalPages = data?.totalPages || 1;
  const totalRecords = data?.totalRecords || 0;
  const pageSize = data?.pageSize || PAGE_SIZE;
  const canCheckIn = !todayAttendance?.checkIn;
  const canCheckOut = Boolean(todayAttendance?.checkIn && !todayAttendance?.checkOut);
  const isBusy = checkInMutation.isPending || checkOutMutation.isPending;
  const showingStart = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const showingEnd = totalRecords === 0 ? 0 : Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="My Attendance"
        subtitle={user ? `Logged in as ${user.name}` : undefined}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => checkInMutation.mutate()}
              disabled={!canCheckIn || isBusy}
              loading={checkInMutation.isPending}
            >
              Check In
            </Button>
            <Button
              variant="outline"
              onClick={() => checkOutMutation.mutate()}
              disabled={!canCheckOut || isBusy}
              loading={checkOutMutation.isPending}
            >
              Check Out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Attendance History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <Label>Filter</Label>
              <div className="flex flex-wrap gap-2">
                {(['today', 'week', 'month', 'custom'] as const).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={rangePreset === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setRangePreset(preset)}
                  >
                    {RANGE_LABELS[preset]}
                  </Button>
                ))}
              </div>
            </div>

            {rangePreset === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      setRangePreset('custom');
                      setFromDate(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => {
                      setRangePreset('custom');
                      setToDate(e.target.value);
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No attendance history"
              description="No records were found for the selected date range."
            />
          ) : (
            <>
              <div className="overflow-x-auto border border-border rounded-2xl">
                <Table2 className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Check-In</TableHead>
                      <TableHead>Check-Out</TableHead>
                      <TableHead>Working Hours</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((record) => {
                      const status = resolveStatus(record);
                      const minutes = resolveWorkingMinutes(record);
                      return (
                        <TableRow key={record._id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(record.date)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatTimeValue(record.checkIn)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatTimeValue(record.checkOut)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{minutes !== null ? formatDuration(minutes) : '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Badge variant={STATUS_VARIANTS[status]} className="capitalize">
                              {STATUS_LABELS[status]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table2>
              </div>

              <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="text-foreground">{showingStart}</span> to <span className="text-foreground">{showingEnd}</span> of <span className="text-foreground">{totalRecords}</span> records
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1 || isLoading}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages || isLoading}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
