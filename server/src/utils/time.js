import { env } from '../config/env.js';

/** Calendar date (YYYY-MM-DD) in the factory timezone. */
export function dayKey(date = new Date(), tz = env.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Minutes since local midnight in the factory timezone. */
export function minutesOfDay(date = new Date(), tz = env.timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

/** Start of the factory-local day containing `date`. */
export function startOfDay(date = new Date(), tz = env.timezone) {
  const ms = date.getTime() - minutesOfDay(date, tz) * 60_000;
  return new Date(ms - (ms % 60_000));
}

/** Factory-local day keys from oldest to newest, covering the last `days` days including today. */
export function lastDayKeys(days, end = new Date(), tz = env.timezone) {
  return Array.from({ length: days }, (_, i) => dayKey(new Date(end.getTime() - (days - 1 - i) * 86_400_000), tz));
}

/** Offset of `tz` from UTC at `date`, in ms (positive east of UTC). */
export function tzOffsetMs(date, tz = env.timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const v = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant of local midnight for a YYYY-MM-DD key in `tz`. */
export function zonedMidnight(key, tz = env.timezone) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

export function addDaysToKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for a YYYY-MM-DD key. */
export const weekdayOfKey = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();

export const hhmmToMinutes = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
