/**
 * Utility functions for calculating Business Day (5:00 AM reset).
 *
 * Rules:
 * - A business day starts at 05:00:00.000 AM on calendar day D.
 * - A business day ends at 04:59:59.999 AM on calendar day D+1.
 * - Any timestamp between 00:00:00 AM and 04:59:59 AM belongs to the previous business day (day D-1).
 * - At 05:00:00 AM, the business date rolls over to day D.
 */

const getBusinessDayDate = (date = new Date()) => {
  const d = new Date(date);
  if (d.getHours() < 5) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
};

const getBusinessDayDateString = (date = new Date()) => {
  const d = getBusinessDayDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const getBusinessDayCompactString = (date = new Date()) => {
  const d = getBusinessDayDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const getBusinessDayStart = (date = new Date()) => {
  const businessDate = getBusinessDayDate(date);
  businessDate.setHours(5, 0, 0, 0);
  return businessDate;
};

const getBusinessDayNextStart = (date = new Date()) => {
  const start = getBusinessDayStart(date);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next;
};

const getBusinessDayRange = (date = new Date()) => {
  const start = getBusinessDayStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { start, end };
};

module.exports = {
  getBusinessDayDate,
  getBusinessDayDateString,
  getBusinessDayCompactString,
  getBusinessDayStart,
  getBusinessDayNextStart,
  getBusinessDayRange,
};
