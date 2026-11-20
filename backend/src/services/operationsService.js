const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_DAYS_PER_MONTH = 365.2425 / 12;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const toUtcDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const dateKey = (date) => date.toISOString().slice(0, 10);

const mondayOf = (date) => {
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
};

const frequencyDays = ({ purchasing_frequency: frequency, custom_interval_days: customDays }) => {
  if (frequency === 'daily') return 1;
  if (frequency === 'weekly') return 7;
  if (frequency === 'fortnightly') return 14;
  if (frequency === 'monthly') return AVERAGE_DAYS_PER_MONTH;
  if (frequency === 'custom') return Number(customDays);
  return null;
};

function estimateKitchenCosts(item, referenceDate = new Date()) {
  const quantity = Number(item.estimated_quantity || 0);
  const unitCost = Number(item.estimated_unit_cost || 0);
  const daysPerCycle = frequencyDays(item);
  const monthDays = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 0)).getUTCDate();
  const expectedMonthlyQuantity = item.expected_monthly_quantity === null
    || item.expected_monthly_quantity === undefined || item.expected_monthly_quantity === ''
    ? null
    : Number(item.expected_monthly_quantity);

  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitCost) || unitCost < 0
      || !Number.isFinite(daysPerCycle) || daysPerCycle <= 0) {
    return { estimated_weekly_cost: 0, estimated_monthly_cost: 0 };
  }

  const cycleCost = quantity * unitCost;
  const weeklyCost = cycleCost * 7 / daysPerCycle;
  const monthlyCost = expectedMonthlyQuantity !== null
    ? expectedMonthlyQuantity * unitCost
    : item.purchasing_frequency === 'monthly'
      ? cycleCost
      : cycleCost * monthDays / daysPerCycle;

  return {
    estimated_weekly_cost: Number(weeklyCost.toFixed(2)),
    estimated_monthly_cost: Number(monthlyCost.toFixed(2)),
  };
}

function estimateKitchenQuantityForRange(item, startDate, endDate) {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  const quantity = Number(item.estimated_quantity || 0);
  const daysPerCycle = frequencyDays(item);
  const expectedMonthlyQuantity = item.expected_monthly_quantity === null
    || item.expected_monthly_quantity === undefined || item.expected_monthly_quantity === ''
    ? null
    : Number(item.expected_monthly_quantity);
  if (!start || !end || start > end || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(daysPerCycle) || daysPerCycle <= 0
      || (expectedMonthlyQuantity !== null && (!Number.isFinite(expectedMonthlyQuantity) || expectedMonthlyQuantity <= 0))) return 0;

  let total = 0;
  for (let cursor = new Date(start); cursor <= end;) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    const segmentStart = cursor > monthStart ? cursor : monthStart;
    const segmentEnd = end < monthEnd ? end : monthEnd;
    const daysCovered = Math.floor((segmentEnd.getTime() - segmentStart.getTime()) / DAY_MS) + 1;
    const daysInMonth = monthEnd.getUTCDate();
    const monthlyQuantity = expectedMonthlyQuantity !== null
      ? expectedMonthlyQuantity
      : item.purchasing_frequency === 'monthly'
        ? quantity
        : quantity * daysInMonth / daysPerCycle;
    total += monthlyQuantity * daysCovered / daysInMonth;
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return Number(total.toFixed(2));
}

function estimateKitchenCostForRange(item, startDate, endDate) {
  const quantity = estimateKitchenQuantityForRange(item, startDate, endDate);
  const unitCost = Number(item.estimated_unit_cost || 0);
  return Number.isFinite(unitCost) && unitCost >= 0
    ? Number((quantity * unitCost).toFixed(2))
    : 0;
}

function summarizeFinancialEntries(entries, { startDate, endDate } = {}) {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  const weeks = new Map();
  const weekdayTotals = WEEKDAY_NAMES.map((day) => ({ day, revenue: 0, expenses: 0 }));
  let totalRevenue = 0;
  let totalExpenses = 0;

  if (start && end && start <= end) {
    for (let date = mondayOf(start); date <= end; date = new Date(date.getTime() + 7 * DAY_MS)) {
      const weekStart = dateKey(date);
      weeks.set(weekStart, {
        week_start: weekStart,
        week_end: dateKey(new Date(date.getTime() + 4 * DAY_MS)),
        weekdays: WEEKDAY_NAMES.map((day) => ({ day, revenue: 0, expenses: 0 })),
        other_days_revenue: 0,
        other_days_expenses: 0,
        revenue: 0,
        expenses: 0,
      });
    }
  }

  for (const entry of entries) {
    const date = toUtcDate(entry.transaction_date);
    const amount = Number(entry.amount);
    if (!date || !Number.isFinite(amount) || amount < 0) continue;

    const type = entry.transaction_type === 'revenue' ? 'revenue' : 'expenses';
    const key = dateKey(mondayOf(date));
    if (!weeks.has(key)) {
      const monday = mondayOf(date);
      weeks.set(key, {
        week_start: key,
        week_end: dateKey(new Date(monday.getTime() + 4 * DAY_MS)),
        weekdays: WEEKDAY_NAMES.map((day) => ({ day, revenue: 0, expenses: 0 })),
        other_days_revenue: 0,
        other_days_expenses: 0,
        revenue: 0,
        expenses: 0,
      });
    }

    const week = weeks.get(key);
    const weekday = (date.getUTCDay() + 6) % 7;
    if (weekday < 5) {
      week.weekdays[weekday][type] += amount;
      weekdayTotals[weekday][type] += amount;
    } else {
      week[`other_days_${type}`] += amount;
    }
    week[type] += amount;
    if (type === 'revenue') totalRevenue += amount;
    else totalExpenses += amount;
  }

  const weeklyRows = [...weeks.values()].sort((left, right) => left.week_start.localeCompare(right.week_start));
  let previousBalance = null;
  let previousRevenue = null;
  let previousExpenses = null;
  for (const week of weeklyRows) {
    week.net_balance = Number((week.revenue - week.expenses).toFixed(2));
    week.change_from_previous = previousBalance === null ? null : Number((week.net_balance - previousBalance).toFixed(2));
    week.revenue_change_from_previous = previousRevenue === null ? null : Number((week.revenue - previousRevenue).toFixed(2));
    week.expense_change_from_previous = previousExpenses === null ? null : Number((week.expenses - previousExpenses).toFixed(2));
    previousBalance = week.net_balance;
    previousRevenue = week.revenue;
    previousExpenses = week.expenses;
  }

  let operatingDays = 0;
  if (start && end && start <= end) {
    for (let date = new Date(start); date <= end; date = new Date(date.getTime() + DAY_MS)) {
      if (date.getUTCDay() > 0 && date.getUTCDay() < 6) operatingDays += 1;
    }
  }
  const weekdayTotal = (field) => Number(weekdayTotals.reduce((sum, day) => sum + day[field], 0).toFixed(2));
  return {
    weeks: weeklyRows,
    weekday_totals: weekdayTotals.map((day) => ({
      ...day,
      revenue: Number(day.revenue.toFixed(2)),
      expenses: Number(day.expenses.toFixed(2)),
    })),
    total_revenue: Number(totalRevenue.toFixed(2)),
    total_expenses: Number(totalExpenses.toFixed(2)),
    net_balance: Number((totalRevenue - totalExpenses).toFixed(2)),
    average_weekly_revenue: weeklyRows.length ? Number((totalRevenue / weeklyRows.length).toFixed(2)) : 0,
    average_weekly_expenses: weeklyRows.length ? Number((totalExpenses / weeklyRows.length).toFixed(2)) : 0,
    average_daily_revenue: operatingDays ? Number((totalRevenue / operatingDays).toFixed(2)) : 0,
    average_daily_expenses: operatingDays ? Number((totalExpenses / operatingDays).toFixed(2)) : 0,
    weekday_revenue_total: weekdayTotal('revenue'),
    weekday_expense_total: weekdayTotal('expenses'),
  };
}

module.exports = {
  estimateKitchenCosts,
  estimateKitchenCostForRange,
  estimateKitchenQuantityForRange,
  summarizeFinancialEntries,
  toUtcDate,
};