/**
 * Pure analytics maths. Keeping this free of Blob/HTTP code makes it testable in plain Node
 * (`npm run test:api`). Session records are JSON blobs; timestamps are ISO strings.
 */

const ACTIVE_WINDOW = 5 * 60_000;

function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function iso(time) {
  return new Date(time).toISOString();
}

function text(value, max = 120) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const visitorId = typeof raw.visitorId === 'string' ? raw.visitorId : null;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : null;
  const startedAt = toMs(raw.startedAt);
  const lastSeen = toMs(raw.lastSeen);
  const activeSeconds = Number(raw.activeSeconds);
  if (!visitorId || !sessionId || !Number.isFinite(startedAt) || !Number.isFinite(lastSeen)) return null;
  if (!Number.isFinite(activeSeconds)) return null;
  const firstSeenRaw = toMs(raw.firstSeen);
  return {
    visitorId,
    sessionId,
    firstSeen: Number.isFinite(firstSeenRaw) ? firstSeenRaw : startedAt,
    startedAt,
    lastSeen,
    activeSeconds: Math.max(0, Math.min(86_400, activeSeconds)),
    callsign: text(raw.callsign, 12),
    country: text(raw.country, 80),
    countryCode: text(raw.countryCode, 2),
    region: text(raw.region, 80),
    city: text(raw.city, 80),
    device: text(raw.device, 20),
    os: text(raw.os, 24),
    browser: text(raw.browser, 24),
    path: text(raw.path, 120),
  };
}

/**
 * Merge a heartbeat into an existing session record. activeSeconds is cumulative per tab; the
 * server keeps the larger value and caps it at the real elapsed time since the session started.
 */
export function mergeSession(existing, incoming, now) {
  const previousStarted = existing ? toMs(existing.startedAt) : NaN;
  const startedAt = Number.isFinite(previousStarted) ? previousStarted : incoming.startedAt;
  const previousFirst = existing ? toMs(existing.firstSeen) : NaN;
  const firstSeen = Number.isFinite(previousFirst)
    ? Math.min(previousFirst, incoming.firstSeen)
    : incoming.firstSeen;
  const previousActive = existing ? Math.max(0, Number(existing.activeSeconds) || 0) : 0;
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const active = Math.min(Math.max(incoming.activeSeconds, previousActive), elapsed + 30);
  const pick = (key) => incoming[key] ?? existing?.[key] ?? null;

  return {
    visitorId: existing?.visitorId ?? incoming.visitorId,
    sessionId: existing?.sessionId ?? incoming.sessionId,
    firstSeen: iso(firstSeen),
    startedAt: iso(startedAt),
    lastSeen: iso(now),
    activeSeconds: Math.floor(Math.max(0, active)),
    callsign: pick('callsign'),
    country: pick('country'),
    countryCode: pick('countryCode'),
    region: pick('region'),
    city: pick('city'),
    device: pick('device'),
    os: pick('os'),
    browser: pick('browser'),
    path: pick('path'),
    userAgent: pick('userAgent'),
  };
}

function windowStats(sessions, start, end) {
  const visitors = new Map();
  let totalSeconds = 0;
  let sessionCount = 0;

  for (const session of sessions) {
    if (session.lastSeen < start || session.startedAt >= end) continue;
    sessionCount++;
    const visitor = visitors.get(session.visitorId) ?? { seconds: 0, firstSeen: session.firstSeen };
    visitor.seconds = Math.max(visitor.seconds, session.activeSeconds);
    visitor.firstSeen = Math.min(visitor.firstSeen, session.firstSeen);
    visitors.set(session.visitorId, visitor);

    const overlap = Math.max(
      0,
      Math.min(session.lastSeen, end) - Math.max(session.startedAt, start),
    ) / 1000;
    totalSeconds += Math.min(session.activeSeconds, overlap);
  }

  let over2m = 0;
  let over3m = 0;
  let newVisitors = 0;
  for (const visitor of visitors.values()) {
    if (visitor.seconds >= 120) over2m++;
    if (visitor.seconds >= 180) over3m++;
    if (visitor.firstSeen >= start && visitor.firstSeen < end) newVisitors++;
  }

  return {
    visitors: visitors.size,
    sessions: sessionCount,
    newVisitors,
    over2m,
    over3m,
    totalSeconds: Math.round(totalSeconds),
    avgSeconds: visitors.size ? Math.round(totalSeconds / visitors.size) : 0,
  };
}

function row(session) {
  return {
    callsign: session.callsign,
    country: session.country,
    countryCode: session.countryCode,
    region: session.region,
    city: session.city,
    device: session.device,
    os: session.os,
    browser: session.browser,
    activeSeconds: session.activeSeconds,
    lastSeen: iso(session.lastSeen),
    startedAt: iso(session.startedAt),
    lastPath: session.path,
  };
}

function groupLocations(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = JSON.stringify([session.country, session.countryCode, session.region, session.city]);
    let group = groups.get(key);
    if (!group) {
      group = {
        country: session.country,
        countryCode: session.countryCode,
        region: session.region,
        city: session.city,
        visitors: new Set(),
        sessions: 0,
      };
      groups.set(key, group);
    }
    group.visitors.add(session.visitorId);
    group.sessions++;
  }
  return [...groups.values()]
    .map((group) => ({
      country: group.country,
      countryCode: group.countryCode,
      region: group.region,
      city: group.city,
      visitors: group.visitors.size,
      sessions: group.sessions,
    }))
    .sort(
      (a, b) =>
        b.visitors - a.visitors ||
        b.sessions - a.sessions ||
        (a.city ?? '').localeCompare(b.city ?? ''),
    )
    .slice(0, 12);
}

function groupDevices(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = session.device ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { device: session.device, visitors: new Set() };
      groups.set(key, group);
    }
    group.visitors.add(session.visitorId);
  }
  return [...groups.values()]
    .map((group) => ({ device: group.device, visitors: group.visitors.size }))
    .sort((a, b) => b.visitors - a.visitors);
}

/**
 * Build the pit-wall payload from the session records, using the periods the browser sent.
 */
export function buildStats(rawSessions, ranges, now = Date.now()) {
  const bySession = new Map();
  for (const raw of rawSessions) {
    const session = normalize(raw);
    if (!session) continue;
    const previous = bySession.get(session.sessionId);
    if (!previous || previous.lastSeen < session.lastSeen) bySession.set(session.sessionId, session);
  }
  const sessions = [...bySession.values()];

  const sevenStart = ranges.days[0].start;
  const sevenEnd = now;
  const sevenDays = sessions.filter((s) => s.lastSeen >= sevenStart && s.startedAt < sevenEnd);
  const activeAll = sessions.filter((s) => s.lastSeen >= now - ACTIVE_WINDOW);
  const activeUsers = new Set(activeAll.map((s) => s.visitorId)).size;

  return {
    generatedAt: iso(now),
    timezone: ranges.timezone,
    today: windowStats(sessions, ranges.today.start, ranges.today.end),
    yesterday: windowStats(sessions, ranges.yesterday.start, ranges.yesterday.end),
    week: windowStats(sessions, ranges.week.start, ranges.week.end),
    active: {
      users: activeUsers,
      sessions: activeAll.length,
      list: activeAll
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 100)
        .map(row),
    },
    recent: sevenDays
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 50)
      .map(row),
    locations: groupLocations(sevenDays),
    devices: groupDevices(sevenDays),
    daily: ranges.days.map((day) => {
      const stats = windowStats(sessions, day.start, day.end);
      return {
        date: day.date,
        visitors: stats.visitors,
        sessions: stats.sessions,
        seconds: stats.totalSeconds,
      };
    }),
  };
}
