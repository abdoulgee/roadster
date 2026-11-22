/** Validation and sanitising for the analytics API. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function clean(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return text || null;
}

export function callsign(value) {
  const text = clean(value, 12);
  return text && /^[A-Za-z0-9_.-]{2,12}$/.test(text) ? text : null;
}

export function countryCode(value) {
  const text = clean(value, 2);
  return text && /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
}

export function toMs(value) {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

export function dateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * A dashboard period. Daily rows may end at midnight in the future; the aggregate periods end at
 * "now". The whole range must be recent and short, which also bounds how many month folders we
 * have to list in Blob.
 */
export function validRange(value, now) {
  if (!value || typeof value !== 'object') return null;
  const start = toMs(value.start);
  const end = toMs(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  if (start < now - 14 * DAY) return null;
  if (end > now + 2 * DAY) return null;
  if (end - start > 8 * DAY) return null;
  return { start, end };
}
