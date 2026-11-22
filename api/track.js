import { json, readBody } from './_lib/http.js';
import { callsign, clean, countryCode, isUuid, toMs } from './_lib/validate.js';
import { mergeSession } from './_lib/stats.js';
import {
  isPrecondition,
  readSession,
  sessionPath,
  SetupError,
  writeSession,
} from './_lib/store.js';

export const config = { maxDuration: 10 };

const DAY = 86_400_000;

/** One heartbeat from the game. Public: it only writes this session's own blob. */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const input = readBody(req);
  if (!input || typeof input !== 'object') return json(res, 400, { error: 'bad_request' });
  if (!isUuid(input.visitorId) || !isUuid(input.sessionId)) {
    return json(res, 400, { error: 'bad_request' });
  }

  const now = Date.now();
  const startedAt = toMs(input.startedAt);
  if (!Number.isFinite(startedAt) || startedAt > now + 5 * 60_000 || startedAt < now - 31 * DAY) {
    return json(res, 400, { error: 'bad_request' });
  }

  let firstSeen = toMs(input.firstSeen);
  if (
    !Number.isFinite(firstSeen) ||
    firstSeen > startedAt + 5 * 60_000 ||
    firstSeen < now - 400 * DAY
  ) {
    firstSeen = startedAt;
  }

  const activeInput = Number(input.activeSeconds);
  const activeSeconds = Number.isFinite(activeInput)
    ? Math.max(0, Math.min(86_400, Math.floor(activeInput)))
    : 0;

  const incoming = {
    visitorId: input.visitorId,
    sessionId: input.sessionId,
    firstSeen,
    startedAt,
    activeSeconds,
    callsign: callsign(input.callsign),
    country: clean(input.country, 80),
    countryCode: countryCode(input.countryCode),
    region: clean(input.region, 80),
    city: clean(input.city, 80),
    device: clean(input.device, 20),
    os: clean(input.os, 24),
    browser: clean(input.browser, 24),
    path: clean(input.path, 120),
    userAgent: clean(input.userAgent, 300),
  };

  const path = sessionPath(startedAt, input.sessionId);

  try {
    // At most one retry: a concurrent heartbeat may have changed the blob's ETag.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await readSession(path);
      const previousSeen = existing ? Date.parse(existing.data.lastSeen) : NaN;
      if (
        existing &&
        Number.isFinite(previousSeen) &&
        now - previousSeen < 3000 &&
        activeSeconds <= Number(existing.data.activeSeconds ?? 0)
      ) {
        return json(res, 204);
      }

      const record = mergeSession(existing?.data, incoming, now);
      try {
        await writeSession(path, record, existing?.etag);
        return json(res, 204);
      } catch (error) {
        if (isPrecondition(error) && attempt === 0) continue;
        throw error;
      }
    }
    return json(res, 204);
  } catch (error) {
    if (error instanceof SetupError) return json(res, 503, { error: 'setup' });
    return json(res, 500, { error: 'server' });
  }
}
