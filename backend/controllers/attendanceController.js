const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Attendance } = require('../models/System');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, ATTENDANCE_STATUS } = require('../config/constants');

const STATUS_SET = new Set(ATTENDANCE_STATUS);
const DEFAULT_PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 1000;
const STANDARD_DAY_MINUTES = 8 * 60;

const toDateOnly = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const timeToMinutes = (value) => {
  if (!value || typeof value !== 'string') return null;
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const formatMinutes = (minutes) => {
  if (minutes === null || minutes === undefined) return '';
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const normalizeSearch = (value) => (value || '').trim().toLowerCase();

const buildBranchFilter = (req) => {
  if (req.query.branch) return req.query.branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    // For Branch Manager and Staff, use only their first assigned branch
    if (req.user.role === ROLES.BRANCH_MANAGER || req.user.role === ROLES.STAFF) {
      return { $in: [req.user.branches[0]] };
    }
    // For other non-super-admin roles, use all their assigned branches
    return { $in: req.user.branches };
  }
  return undefined;
};

const buildDateFilter = (query) => {
  if (query.date) {
    const date = toDateOnly(query.date);
    if (!date) return null;
    const nextDay = new Date(date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return { $gte: date, $lt: nextDay };
  }

  if (query.from || query.to) {
    const filter = {};
    if (query.from) {
      const from = toDateOnly(query.from);
      if (!from) return null;
      filter.$gte = from;
    }
    if (query.to) {
      const to = toDateOnly(query.to);
      if (!to) return null;
      to.setUTCHours(23, 59, 59, 999);
      filter.$lte = to;
    }
    return filter;
  }

  return null;
};

const buildBaseFilter = (req) => {
  const filter = {};
  const branchFilter = buildBranchFilter(req);
  if (branchFilter) filter.branch = branchFilter;

  const dateFilter = buildDateFilter(req.query);
  if (dateFilter) filter.date = dateFilter;

  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.employees) {
    const employeeIds = String(req.query.employees)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (employeeIds.length) filter.employee = { $in: employeeIds };
  }

  return filter;
};

const calculateWorkingMinutes = (checkIn, checkOut) => {
  const inMinutes = timeToMinutes(checkIn);
  const outMinutes = timeToMinutes(checkOut);
  if (inMinutes === null || outMinutes === null) return null;
  let diff = outMinutes - inMinutes;
  if (diff < 0) diff += 24 * 60;
  return diff;
};

const buildAttendancePayload = (reqBody, reqUser) => {
  const payload = {
    status: reqBody.status,
    checkIn: reqBody.checkIn || undefined,
    checkOut: reqBody.checkOut || undefined,
    workingHours: reqBody.workingHours !== undefined && reqBody.workingHours !== null && reqBody.workingHours !== ''
      ? Number(reqBody.workingHours)
      : undefined,
    overtimeHours: reqBody.overtimeHours !== undefined && reqBody.overtimeHours !== null && reqBody.overtimeHours !== ''
      ? Number(reqBody.overtimeHours)
      : undefined,
    lateMinutes: reqBody.lateMinutes !== undefined && reqBody.lateMinutes !== null && reqBody.lateMinutes !== ''
      ? Number(reqBody.lateMinutes)
      : 0,
    earlyExitMinutes: reqBody.earlyExitMinutes !== undefined && reqBody.earlyExitMinutes !== null && reqBody.earlyExitMinutes !== ''
      ? Number(reqBody.earlyExitMinutes)
      : 0,
    notes: reqBody.notes?.trim() || undefined,
    shift: reqBody.shift || 'full_day',
    markedBy: reqBody.markedBy || reqUser._id,
    markedAt: new Date(),
  };

  if (payload.workingHours === undefined && payload.checkIn && payload.checkOut) {
    payload.workingHours = calculateWorkingMinutes(payload.checkIn, payload.checkOut) ?? undefined;
  }

  if (payload.overtimeHours === undefined && typeof payload.workingHours === 'number') {
    payload.overtimeHours = Math.max(0, payload.workingHours - STANDARD_DAY_MINUTES);
  }

  return payload;
};

const populateAttendance = (query) =>
  query
    .populate('employee', 'name role email phone branches')
    .populate('branch', 'name code')
    .populate('markedBy', 'name role');

const getFilteredRecords = async (req, { exportMode = false } = {}) => {
  const filter = buildBaseFilter(req);
  const query = Attendance.find(filter).sort({ date: -1, createdAt: -1 });
  if (exportMode) query.limit(EXPORT_PAGE_SIZE);
  const records = await populateAttendance(query);

  const search = normalizeSearch(req.query.search);
  const role = req.query.role;
  const status = req.query.status;

  return records.filter((record) => {
    if (status && record.status !== status) return false;
    if (role && record.employee?.role !== role) return false;
    if (search) {
      const haystack = [
        record.employee?.name,
        record.employee?.email,
        record.employee?.phone,
        record.branch?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
};

const ensureKnownStatus = (status) => {
  if (!status || !STATUS_SET.has(status)) {
    throw new AppError('Invalid attendance status.', 400);
  }
};

const buildStats = (records) => {
  const summary = {
    totalStaff: records.length,
    present: 0,
    absent: 0,
    halfDay: 0,
    leave: 0,
    weeklyOff: 0,
    holiday: 0,
    totalWorkingMinutes: 0,
    overtimeMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
  };

  for (const record of records) {
    if (record.status === 'present') summary.present += 1;
    if (record.status === 'absent') summary.absent += 1;
    if (record.status === 'half_day') summary.halfDay += 1;
    if (record.status === 'leave') summary.leave += 1;
    if (record.status === 'weekly_off') summary.weeklyOff += 1;
    if (record.status === 'holiday') summary.holiday += 1;
    summary.totalWorkingMinutes += record.workingHours || 0;
    summary.overtimeMinutes += record.overtimeHours || 0;
    summary.lateMinutes += record.lateMinutes || 0;
    summary.earlyExitMinutes += record.earlyExitMinutes || 0;
  }

  return summary;
};

const getRecordRows = (records) =>
  records.map((record) => ({
    employee: record.employee?.name || 'Unknown',
    role: record.employee?.role || '',
    branch: record.branch?.name || '',
    date: record.date,
    status: record.status,
    checkIn: record.checkIn || '',
    checkOut: record.checkOut || '',
    workingHours: formatMinutes(record.workingHours),
    overtimeHours: formatMinutes(record.overtimeHours),
    lateMinutes: record.lateMinutes || 0,
    earlyExitMinutes: record.earlyExitMinutes || 0,
    notes: record.notes || '',
    markedBy: record.markedBy?.name || '',
    markedAt: record.markedAt || record.updatedAt || record.createdAt,
  }));

const getExcelBuffer = async (records, title) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The Golden Frame';
  const sheet = workbook.addWorksheet(title);

  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Employee', key: 'employee', width: 24 },
    { header: 'Role', key: 'role', width: 16 },
    { header: 'Branch', key: 'branch', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Check In', key: 'checkIn', width: 12 },
    { header: 'Check Out', key: 'checkOut', width: 12 },
    { header: 'Working Hours', key: 'workingHours', width: 14 },
    { header: 'Overtime Hours', key: 'overtimeHours', width: 14 },
    { header: 'Late Minutes', key: 'lateMinutes', width: 12 },
    { header: 'Early Exit Minutes', key: 'earlyExitMinutes', width: 16 },
    { header: 'Notes', key: 'notes', width: 28 },
    { header: 'Marked By', key: 'markedBy', width: 18 },
    { header: 'Marked At', key: 'markedAt', width: 20 },
  ];

  records.forEach((record) => {
    sheet.addRow({
      ...record,
      date: record.date ? new Date(record.date).toLocaleDateString('en-IN') : '',
      markedAt: record.markedAt ? new Date(record.markedAt).toLocaleString('en-IN') : '',
      status: record.status.replace('_', ' '),
    });
  });

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  return workbook.xlsx.writeBuffer();
};

const sendPdf = (res, title, records) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).font('Helvetica-Bold').text('The Golden Frame Attendance Report');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').text(title);
  doc.moveDown(0.6);

  const headers = ['Date', 'Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Notes'];
  const widths = [60, 120, 60, 50, 50, 50, 150];
  let y = doc.y;

  doc.font('Helvetica-Bold').fontSize(8);
  headers.forEach((header, index) => {
    doc.text(header, 40 + widths.slice(0, index).reduce((sum, w) => sum + w, 0), y, {
      width: widths[index],
      continued: false,
    });
  });

  y += 14;
  doc.moveTo(40, y - 2).lineTo(555, y - 2).strokeColor('#CBD5E1').stroke();

  doc.font('Helvetica').fontSize(8);
  records.forEach((record) => {
    if (y > 740) {
      doc.addPage();
      y = 40;
    }

    const cells = [
      record.date ? new Date(record.date).toLocaleDateString('en-IN') : '',
      record.employee?.name || '',
      record.status.replace('_', ' '),
      record.checkIn || '',
      record.checkOut || '',
      formatMinutes(record.workingHours),
      record.notes || '',
    ];

    cells.forEach((cell, index) => {
      doc.text(cell, 40 + widths.slice(0, index).reduce((sum, w) => sum + w, 0), y, {
        width: widths[index],
        ellipsis: true,
      });
    });
    y += 18;
  });

  doc.end();
};

exports.getAttendance = asyncHandler(async (req, res) => {
  const filter = buildBaseFilter(req);
  const records = await populateAttendance(Attendance.find(filter).sort({ date: -1, createdAt: -1 }));

  const search = normalizeSearch(req.query.search);
  const role = req.query.role;
  const status = req.query.status;

  const filtered = records.filter((record) => {
    if (status && record.status !== status) return false;
    if (role && record.employee?.role !== role) return false;
    if (search) {
      const haystack = [
        record.employee?.name,
        record.employee?.email,
        record.employee?.phone,
        record.branch?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  res.status(200).json({
    success: true,
    results: paginated.length,
    total,
    page,
    pages,
    data: {
      records: paginated,
      stats: buildStats(filtered),
    },
  });
});

exports.getAttendanceHistory = asyncHandler(async (req, res, next) => {
  const { employeeId } = req.params;
  if (!employeeId) return next(new AppError('Employee is required.', 400));

  const since = req.query.from ? toDateOnly(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const until = req.query.to ? toDateOnly(req.query.to) : new Date();
  if (!since || !until) return next(new AppError('Invalid date range.', 400));
  until.setUTCHours(23, 59, 59, 999);

  const filter = {
    employee: employeeId,
    date: { $gte: since, $lte: until },
  };
  const branchFilter = buildBranchFilter(req);
  if (branchFilter) filter.branch = branchFilter;

  const records = await populateAttendance(
    Attendance.find(filter).sort({ date: -1, createdAt: -1 })
  );

  const stats = {
    totalDays: records.length,
    present: 0,
    absent: 0,
    leave: 0,
    halfDay: 0,
    weeklyOff: 0,
    holiday: 0,
    lateArrivals: 0,
    overtimeMinutes: 0,
    workingMinutes: 0,
  };

  for (const record of records) {
    if (record.status === 'present') stats.present += 1;
    if (record.status === 'absent') stats.absent += 1;
    if (record.status === 'leave') stats.leave += 1;
    if (record.status === 'half_day') stats.halfDay += 1;
    if (record.status === 'weekly_off') stats.weeklyOff += 1;
    if (record.status === 'holiday') stats.holiday += 1;
    if ((record.lateMinutes || 0) > 0) stats.lateArrivals += 1;
    stats.overtimeMinutes += record.overtimeHours || 0;
    stats.workingMinutes += record.workingHours || 0;
  }

  res.status(200).json({
    success: true,
    data: {
      employee: records[0]?.employee || null,
      records,
      stats: {
        ...stats,
        monthlyAttendancePercentage: stats.totalDays
          ? Math.round(((stats.present + stats.halfDay * 0.5) / stats.totalDays) * 100)
          : 0,
      },
    },
  });
});

exports.markAttendance = asyncHandler(async (req, res, next) => {
  const { employee, branch, date, status } = req.body;
  console.log('📝 Mark attendance request:', { employee, branch, date, status });
  console.log('👤 User:', req.user._id, req.user.role);
  console.log('🏢 User branches:', req.user.branches);
  
  if (!employee || !date) return next(new AppError('Employee and date are required.', 400));
  ensureKnownStatus(status);

  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    const userBranch = req.user.branches[0];
    console.log('🔍 User branch type:', typeof userBranch);
    console.log('🔍 User branch value:', JSON.stringify(userBranch));
    finalBranch = typeof userBranch === 'string' ? userBranch : (userBranch._id ? userBranch._id.toString() : userBranch.toString());
    console.log('✅ Final branch:', finalBranch);
  }

  if (!finalBranch) return next(new AppError('Branch is required.', 400));

  const normalizedDate = toDateOnly(date);
  console.log('📅 Normalized date:', normalizedDate);
  if (!normalizedDate) return next(new AppError('Invalid date.', 400));

  const payload = buildAttendancePayload(req.body, req.user);
  console.log('📦 Payload:', payload);
  
  console.log('🔍 Finding/updating attendance record...');
  const record = await Attendance.findOneAndUpdate(
    { employee, date: normalizedDate },
    {
      $set: {
        status: payload.status,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        workingHours: payload.workingHours,
        overtimeHours: payload.overtimeHours,
        lateMinutes: payload.lateMinutes,
        earlyExitMinutes: payload.earlyExitMinutes,
        notes: payload.notes,
        shift: payload.shift,
        markedBy: payload.markedBy,
        markedAt: payload.markedAt,
      },
      $setOnInsert: {
        employee,
        branch: finalBranch,
        date: normalizedDate,
      },
    },
    { upsert: true, new: true, runValidators: true }
  ).populate('employee', 'name role email phone branches').populate('branch', 'name code').populate('markedBy', 'name role');
  
  console.log('✅ Attendance record saved:', record._id);
  res.status(200).json({ success: true, data: { record } });
});

exports.bulkMarkAttendance = asyncHandler(async (req, res, next) => {
  const { employeeIds, branch, date, status, records = [] } = req.body;
  const normalizedDate = toDateOnly(date);
  if (!Array.isArray(employeeIds) || !employeeIds.length) return next(new AppError('Select at least one employee.', 400));
  if (!normalizedDate) return next(new AppError('Date is required.', 400));
  ensureKnownStatus(status);

  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    const userBranch = req.user.branches[0];
    finalBranch = typeof userBranch === 'string' ? userBranch : (userBranch._id ? userBranch._id.toString() : userBranch.toString());
  }

  if (!finalBranch) return next(new AppError('Branch is required.', 400));

  const ids = employeeIds.filter(Boolean);
  const byEmployee = new Map((records || []).map((item) => [item.employee, item]));
  const operations = ids.map((employeeId) => {
    const entry = byEmployee.get(employeeId) || {};
    const payload = buildAttendancePayload({ ...entry, status }, req.user);
    return {
      updateOne: {
        filter: { employee: employeeId, date: normalizedDate },
        update: {
          $set: {
            status: payload.status,
            checkIn: payload.checkIn,
            checkOut: payload.checkOut,
            workingHours: payload.workingHours,
            overtimeHours: payload.overtimeHours,
            lateMinutes: payload.lateMinutes,
            earlyExitMinutes: payload.earlyExitMinutes,
            notes: payload.notes,
            shift: payload.shift,
            markedBy: payload.markedBy,
            markedAt: payload.markedAt,
          },
          $setOnInsert: {
            employee: employeeId,
            branch: finalBranch,
            date: normalizedDate,
          },
        },
        upsert: true,
      },
    };
  });

  await Attendance.bulkWrite(operations, { ordered: false });
  const updated = await populateAttendance(
    Attendance.find({ employee: { $in: ids }, date: normalizedDate }).sort({ date: -1, createdAt: -1 })
  );

  res.status(200).json({ success: true, data: { records: updated } });
});

exports.updateAttendance = asyncHandler(async (req, res, next) => {
  if (req.body.status) ensureKnownStatus(req.body.status);
  const payload = buildAttendancePayload(req.body, req.user);
  const record = await Attendance.findByIdAndUpdate(
    req.params.id,
    {
      ...req.body,
      ...payload,
      markedAt: new Date(),
    },
    { new: true, runValidators: true }
  ).populate('employee', 'name role email phone branches').populate('branch', 'name code').populate('markedBy', 'name role');

  if (!record) return next(new AppError('Record not found.', 404));
  res.status(200).json({ success: true, data: { record } });
});

exports.exportAttendanceExcel = asyncHandler(async (req, res) => {
  const records = await getFilteredRecords(req, { exportMode: true });
  const buffer = await getExcelBuffer(getRecordRows(records), 'Attendance');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="thegoldenframe-attendance.xlsx"',
  });
  res.send(buffer);
});

exports.exportAttendancePDF = asyncHandler(async (req, res) => {
  const records = await getFilteredRecords(req, { exportMode: true });
  sendPdf(res, 'Attendance Export', records);
});
