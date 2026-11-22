import { createHash, timingSafeEqual } from 'node:crypto';
import { json, readBody } from './_lib/http.js';
import { dateKey, validRange } from './_lib/validate.js';
import { listSessions, SetupError } from './_lib/store.js';
import { buildStats } from './_lib/stats.js';

export const config = { maxDuration: 30 };

const DAY = 86_400_000;

function passwordMatches(input, expected) {
  const given = createHash('sha256').update(String(input ?? '')).digest();
  const wanted = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(given, wanted);
}

/** Password-protected dashboard data. All aggregation happens here, never in the browser. */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const input = readBody(req);
  if (!input || typeof input !== 'object') return json(res, 400, { error: 'bad_request' });

  const expected = process.env.ADMIN_PASSWORD || 'qwertyuiop';
  if (!passwordMatches(input.password, expected)) {
    // A small cost on failures; the default password is easy to guess, so change it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return json(res, 401, { error: 'unauthorized' });
  }

  const now = Date.now();
  const body = input.ranges;
  const today = validRange(body?.today, now);
  const yesterday = validRange(body?.yesterday, now);
  const week = validRange(body?.week, now);
  const rawDays = Array.isArray(body?.days) ? body.days : null;

  if (!today || !yesterday || !week || !rawDays || rawDays.length !== 7) {
    return json(res, 400, { error: 'bad_request' });
  }

  const days = [];
  for (const raw of rawDays) {
    const range = validRange(raw, now);
    const date = dateKey(raw?.date);
    if (!range || !date) return json(res, 400, { error: 'bad_request' });
    days.push({ date, ...range });
  }
  for (let i = 1; i < days.length; i++) {
    if (days[i].start < days[i - 1].start) return json(res, 400, { error: 'bad_request' });
  }

  const earliest = Math.min(today.start, yesterday.start, week.start, days[0].start);
  const latest = Math.max(today.end, yesterday.end, week.end, days[6].end);
  if (latest - earliest > 15 * DAY) return json(res, 400, { error: 'bad_request' });

  const timezone =
    typeof input.timezone === 'string' && input.timezone.trim()
      ? input.timezone.trim().slice(0, 64)
      : 'UTC';

  try {
    const sessions = await listSessions(earliest, now);
    return json(
      res,
      200,
      buildStats(sessions, { timezone, today, yesterday, week, days }, now),
    );
  } catch (error) {
    if (error instanceof SetupError) return json(res, 503, { error: 'setup' });
    return json(res, 500, { error: 'server' });
  }
}
