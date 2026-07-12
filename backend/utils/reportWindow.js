const DEFAULT_TIME_ZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
const REPORT_CUTOFF_HOUR = 5;

const pad = (value) => String(value).padStart(2, '0');

const getTimeZoneParts = (date, timeZone = DEFAULT_TIME_ZONE) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const getTimeZoneOffsetMinutes = (date, timeZone = DEFAULT_TIME_ZONE) => {
  const parts = getTimeZoneParts(date, timeZone);
  const utcEquivalent = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (utcEquivalent - date.getTime()) / 60000;
};

const zonedLocalToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = DEFAULT_TIME_ZONE) => {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
};

const addDays = (year, month, day, days) => {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
};

const formatDateLabel = ({ year, month, day }, timeZone = DEFAULT_TIME_ZONE) => {
  const date = zonedLocalToUtc({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const formatTimeLabel = (date, timeZone = DEFAULT_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);

const getDailyBusinessWindow = (date = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const localParts = getTimeZoneParts(date, timeZone);
  const reportDate = { year: localParts.year, month: localParts.month, day: localParts.day };
  const previousDate = addDays(reportDate.year, reportDate.month, reportDate.day, -1);

  const windowStart = zonedLocalToUtc({
    year: previousDate.year,
    month: previousDate.month,
    day: previousDate.day,
    hour: REPORT_CUTOFF_HOUR,
    minute: 0,
    second: 0,
  }, timeZone);

  const windowEnd = zonedLocalToUtc({
    year: reportDate.year,
    month: reportDate.month,
    day: reportDate.day,
    hour: REPORT_CUTOFF_HOUR,
    minute: 0,
    second: 0,
  }, timeZone);

  return {
    reportDate,
    reportDateKey: `${reportDate.year}-${pad(reportDate.month)}-${pad(reportDate.day)}`,
    reportDateLabel: formatDateLabel(reportDate, timeZone),
    generationTimeLabel: formatTimeLabel(date, timeZone),
    windowStart,
    windowEnd,
    timeZone,
  };
};

module.exports = {
  DEFAULT_TIME_ZONE,
  REPORT_CUTOFF_HOUR,
  getTimeZoneParts,
  getTimeZoneOffsetMinutes,
  zonedLocalToUtc,
  getDailyBusinessWindow,
  formatDateLabel,
  formatTimeLabel,
};
