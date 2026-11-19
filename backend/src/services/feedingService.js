const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'termly']);
const PAYMENT_METHODS = new Set(['cash', 'mobile_money', 'bank_transfer', 'other']);

const moneyToCents = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};

const amountFromCents = (cents) => (cents / 100).toFixed(2);

const parseDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const addDays = (date, amount) => {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
};

const periodRange = (frequency, date, term) => {
  if (!FREQUENCIES.has(frequency) || !parseDate(date)) return null;
  if (frequency === 'daily') return { startDate: date, endDate: date };
  if (frequency === 'weekly') {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return {
      startDate: addDays(date, mondayOffset),
      endDate: addDays(date, mondayOffset + 6),
    };
  }
  if (frequency === 'monthly') {
    const [year, month] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  if (!term || !parseDate(term.start_date) || !parseDate(term.end_date)
      || term.start_date > term.end_date || date < term.start_date || date > term.end_date) {
    return null;
  }
  return { startDate: term.start_date, endDate: term.end_date };
};

const dateInRange = (date, start, end) => date >= start && date <= end;

const listFeedingDays = (term, exceptions = [], classId = null, startDate = term.start_date, endDate = term.end_date) => {
  const start = startDate > term.start_date ? startDate : term.start_date;
  const end = endDate < term.end_date ? endDate : term.end_date;
  if (!parseDate(start) || !parseDate(end) || start > end) return [];
  const weekdays = new Set(term.scheduled_weekdays.map(Number));
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
    if (weekday === 6 || weekday === 7) continue;
    const applicable = exceptions.filter((event) => (
      dateInRange(date, event.start_date, event.end_date)
      && (event.class_id == null || String(event.class_id) === String(classId))
    ));
    if (applicable.some((event) => event.event_type === 'school_day')) {
      dates.push(date);
      continue;
    }
    if (applicable.some((event) => event.event_type === 'holiday' || event.event_type === 'vacation')) continue;
    if (weekdays.has(weekday)) dates.push(date);
  }
  return dates;
};

const rateForDate = (rates, date) => rates.reduce((applicable, rate) => (
  rate.effective_date <= date
    && (!applicable || rate.effective_date > applicable.effective_date)
    ? rate
    : applicable
), null);

const allocateCents = (amountCents, obligations) => {
  let remaining = amountCents;
  const allocations = [];
  for (const obligation of obligations) {
    if (remaining <= 0) break;
    const due = Number(obligation.amount_due_cents);
    const paid = Number(obligation.amount_paid_cents);
    const outstanding = Math.max(0, due - paid);
    if (!outstanding) continue;
    const amount = Math.min(remaining, outstanding);
    allocations.push({ obligation_id: obligation.id, amount_cents: amount });
    remaining -= amount;
  }
  return { allocations, advance_cents: remaining };
};

const allocateRefundCents = (amountCents, allocations) => {
  let remaining = amountCents;
  const refundAllocations = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const refundable = Math.max(
      0,
      Number(allocation.amount_cents) - Number(allocation.refunded_cents || 0)
    );
    const amount = Math.min(remaining, refundable);
    if (!amount) continue;
    refundAllocations.push({ ...allocation, amount_cents: amount });
    remaining -= amount;
  }
  return { allocations: refundAllocations, unallocated_cents: remaining };
};

const paymentStatus = (amountDueCents, amountPaidCents) => {
  if (amountPaidCents >= amountDueCents) return 'paid';
  return amountPaidCents > 0 ? 'partial' : 'unpaid';
};

module.exports = {
  FREQUENCIES,
  PAYMENT_METHODS,
  addDays,
  allocateCents,
  allocateRefundCents,
  amountFromCents,
  listFeedingDays,
  moneyToCents,
  parseDate,
  paymentStatus,
  periodRange,
  rateForDate,
};
