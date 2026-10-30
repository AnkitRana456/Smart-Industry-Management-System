import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDaysToKey, dayKey, weekdayOfKey, zonedMidnight } from '../../utils/time.js';

export const PRESETS = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_7_DAYS', 'LAST_30_DAYS'];
const MAX_SPAN_DAYS = 92;
const DEFAULT_PRESET = 'LAST_7_DAYS';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const timeRangeSchema = z.union([
  z.object({ preset: z.enum(PRESETS) }),
  // Whole factory days, inclusive of both ends. The easiest form for a date picker.
  z.object({ startDate: dateKey, endDate: dateKey }),
  z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), timezone: z.string().max(60).optional() }),
]);

const label = {
  TODAY: 'today', YESTERDAY: 'yesterday', THIS_WEEK: 'this week (Monday to now)', LAST_WEEK: 'last week (Monday to Sunday)',
  THIS_MONTH: 'this month', LAST_MONTH: 'last month', LAST_7_DAYS: 'the last 7 days', LAST_30_DAYS: 'the last 30 days',
};

const endOfDayBefore = (key, tz) => new Date(zonedMidnight(key, tz).getTime() - 1);

/**
 * Presets are resolved in the factory timezone. Weeks run Monday to Sunday.
 * Full past periods end at the last millisecond; running periods end at `now`.
 */
export function resolveRange(input, now = new Date()) {
  const tz = env.timezone;
  const today = dayKey(now, tz);
  const usedDefault = !input;

  if (input && 'startDate' in input) {
    const { startDate, endDate } = input;
    if (Number.isNaN(Date.parse(`${startDate}T00:00:00Z`)) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) throw ApiError.badRequest('Those are not valid dates.');
    if (endDate < startDate) throw ApiError.badRequest('The end date must not be before the start date.');
    if (startDate > today) throw ApiError.badRequest('The start date cannot be in the future.');
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_SPAN_DAYS) throw ApiError.badRequest(`Date ranges can span at most ${MAX_SPAN_DAYS} days.`);
    const start = zonedMidnight(startDate, tz);
    const end = new Date(Math.min(endOfDayBefore(addDaysToKey(endDate, 1), tz).getTime(), now.getTime()));
    return { start, end, timezone: tz, label: startDate === endDate ? startDate : `${startDate} to ${endDate}`, usedDefault: false };
  }

  if (input && !('preset' in input)) {
    if (input.timezone && input.timezone !== tz) {
      throw ApiError.badRequest(`Only the factory timezone (${tz}) is supported for date ranges.`);
    }
    const start = new Date(input.start);
    const end = new Date(Math.min(new Date(input.end).getTime(), now.getTime()));
    if (!(start < end)) throw ApiError.badRequest('The start of the range must be before its end (and not in the future).');
    if ((end - start) / 86_400_000 > MAX_SPAN_DAYS) throw ApiError.badRequest(`Date ranges can span at most ${MAX_SPAN_DAYS} days.`);
    return { start, end, timezone: tz, label: 'the requested range', usedDefault: false };
  }

  const preset = input?.preset ?? DEFAULT_PRESET;
  const mondayOffset = (weekdayOfKey(today) + 6) % 7;
  const thisMonday = addDaysToKey(today, -mondayOffset);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthStart = `${addDaysToKey(monthStart, -1).slice(0, 7)}-01`;

  const mid = (k) => zonedMidnight(k, tz);
  const ranges = {
    TODAY: [mid(today), now],
    YESTERDAY: [mid(addDaysToKey(today, -1)), endOfDayBefore(today, tz)],
    THIS_WEEK: [mid(thisMonday), now],
    LAST_WEEK: [mid(addDaysToKey(thisMonday, -7)), endOfDayBefore(thisMonday, tz)],
    THIS_MONTH: [mid(monthStart), now],
    LAST_MONTH: [mid(lastMonthStart), endOfDayBefore(monthStart, tz)],
    LAST_7_DAYS: [mid(addDaysToKey(today, -6)), now],
    LAST_30_DAYS: [mid(addDaysToKey(today, -29)), now],
  };
  const [start, end] = ranges[preset];
  return { start, end, timezone: tz, label: label[preset], preset, usedDefault };
}

/** Shape the analytics services expect: whole factory days covering [start, end]. */
export function toAnalyticsRange({ start, end }) {
  const keys = [];
  const last = dayKey(end);
  for (let k = dayKey(start); k <= last; k = addDaysToKey(k, 1)) keys.push(k);
  return { start, end, days: keys.length, keys };
}
