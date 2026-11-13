const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const toDateString = (date) => date.toISOString().slice(0, 10);
const addCalendarDays = (dateString, days) => {
  const date = parseDate(dateString);
  if (!date) throw new Error('A valid calendar date is required.');
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
};

const isSchoolDay = (dateString, events = []) => {
  const date = parseDate(dateString);
  if (!date) return false;
  const activeEvents = events.filter((event) => event.start_date <= dateString && event.end_date >= dateString);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (activeEvents.some((event) => event.event_type === 'school_day')) return true;
  return !activeEvents.some((event) => event.event_type === 'holiday' || event.event_type === 'vacation');
};

const listSchoolDays = (startDate, count, events = []) => {
  const first = parseDate(startDate);
  if (!first || !Number.isInteger(count) || count < 0) throw new Error('Invalid feeding coverage date or day count.');
  if (count === 0) return [];
  const days = [];
  let date = startDate;
  for (let attempts = 0; days.length < count && attempts < 3660; attempts += 1) {
    if (isSchoolDay(date, events)) days.push(date);
    date = addCalendarDays(date, 1);
  }
  if (days.length !== count) throw new Error('Could not find enough school feeding days in the school calendar.');
  return days;
};

const getCoverageStartDate = (paymentDate, previousCoverageEnd) => {
  if (!parseDate(paymentDate)) throw new Error('A valid payment date is required.');
  if (previousCoverageEnd && !parseDate(previousCoverageEnd)) throw new Error('A valid previous coverage end date is required.');
  return previousCoverageEnd && previousCoverageEnd >= paymentDate
    ? addCalendarDays(previousCoverageEnd, 1)
    : paymentDate;
};

const moneyToCents = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round((numeric + Number.EPSILON) * 100);
};

const calculateCoverage = ({ amountReceived, dailyRate, existingCredit = 0 }) => {
  const paymentCents = moneyToCents(amountReceived);
  const rateCents = moneyToCents(dailyRate);
  const creditCents = moneyToCents(existingCredit);
  if (paymentCents === null || paymentCents <= 0 || rateCents === null || rateCents <= 0 || creditCents === null) {
    throw new Error('Payment, daily rate, and credit must be valid positive amounts.');
  }
  const totalCents = paymentCents + creditCents;
  const daysCovered = Math.floor(totalCents / rateCents);
  const creditRemainingCents = totalCents - daysCovered * rateCents;
  return {
    amountReceivedCents: paymentCents,
    creditAppliedCents: creditCents,
    daysCovered,
    creditAddedCents: creditRemainingCents,
  };
};

module.exports = {
  addCalendarDays,
  calculateCoverage,
  getCoverageStartDate,
  isSchoolDay,
  listSchoolDays,
  moneyToCents,
  parseDate,
};
