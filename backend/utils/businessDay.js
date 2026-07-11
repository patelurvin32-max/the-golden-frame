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

module.exports = {
  getBusinessDayDate,
  getBusinessDayDateString,
  getBusinessDayCompactString,
  getBusinessDayStart,
};
