import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStats, mergeSession } from './stats.js';

const now = Date.parse('2026-11-22T15:00:00Z');
const today = Date.parse('2026-11-22T00:00:00Z');
const yesterday = Date.parse('2026-11-21T00:00:00Z');
const week = Date.parse('2026-11-16T00:00:00Z');
const day = (start) => ({ date: new Date(start).toISOString().slice(0, 10), start, end: start + 86_400_000 });

const ranges = {
  timezone: 'UTC',
  today: { start: today, end: now },
  yesterday: { start: yesterday, end: today },
  week: { start: week, end: now },
  days: Array.from({ length: 7 }, (_, i) => day(today - (6 - i) * 86_400_000)),
};

const iso = (time) => new Date(time).toISOString();

function session(overrides) {
  return {
    visitorId: 'v1',
    sessionId: 's1',
    firstSeen: iso(now - 2 * 86_400_000),
    startedAt: iso(now - 5 * 60_000),
    lastSeen: iso(now - 60_000),
    activeSeconds: 240,
    callsign: 'NeonFox',
    country: 'Nigeria',
    countryCode: 'NG',
    region: 'Lagos',
    city: 'Lagos',
    device: 'Mobile',
    os: 'Android',
    browser: 'Chrome',
    path: '/',
    ...overrides,
  };
}

const sessions = [
  session({}),
  session({
    visitorId: 'v2',
    sessionId: 's2',
    firstSeen: iso(today + 3_600_000),
    startedAt: iso(now - 4 * 60_000),
    lastSeen: iso(now - 2 * 60_000),
    activeSeconds: 130,
    callsign: 'TurboJet',
    country: 'Ghana',
    countryCode: 'GH',
    region: 'Greater Accra',
    city: 'Accra',
    device: 'Desktop',
    os: 'Windows',
    browser: 'Chrome',
  }),
  session({
    visitorId: 'v3',
    sessionId: 's3',
    firstSeen: iso(today + 7_200_000),
    startedAt: iso(now - 60_000),
    lastSeen: iso(now - 30_000),
    activeSeconds: 30,
    callsign: 'LunarBolt',
    country: 'United Kingdom',
    countryCode: 'GB',
    region: 'England',
    city: 'London',
    device: 'Tablet',
    os: 'iOS',
    browser: 'Safari',
  }),
  session({
    visitorId: 'v4',
    sessionId: 's4',
    firstSeen: iso(yesterday + 11 * 3_600_000),
    startedAt: iso(yesterday + 11 * 3_600_000 + 55 * 60_000),
    lastSeen: iso(yesterday + 12 * 3_600_000),
    activeSeconds: 200,
    callsign: 'RapidLynx',
  }),
];

test('buildStats aggregates the browser periods', () => {
  const stats = buildStats(sessions, ranges, now);

  assert.equal(stats.timezone, 'UTC');
  assert.deepEqual(stats.today, {
    visitors: 3,
    sessions: 3,
    newVisitors: 2,
    over2m: 2,
    over3m: 1,
    totalSeconds: 390,
    avgSeconds: 130,
  });
  assert.equal(stats.yesterday.visitors, 1);
  assert.equal(stats.yesterday.sessions, 1);
  assert.equal(stats.yesterday.newVisitors, 1);
  assert.equal(stats.yesterday.over2m, 1);
  assert.equal(stats.week.visitors, 4);
  assert.equal(stats.week.sessions, 4);
  assert.equal(stats.active.users, 3);
  assert.equal(stats.active.sessions, 3);
  assert.equal(stats.active.list[0].callsign, 'LunarBolt');
  assert.equal(stats.recent.length, 4);
  assert.equal(stats.locations[0].city, 'Lagos');
  assert.equal(stats.locations[0].visitors, 2);
  assert.equal(stats.devices[0].device, 'Mobile');
  assert.equal(stats.devices[0].visitors, 2);
  assert.equal(stats.daily.length, 7);
  assert.equal(stats.daily[6].visitors, 3);
  assert.equal(stats.daily[5].visitors, 1);
});

test('buildStats drops duplicate or malformed sessions', () => {
  const duplicate = session({ sessionId: 's1', lastSeen: iso(now - 10_000), activeSeconds: 260 });
  const stats = buildStats([...sessions, duplicate, { nope: true }], ranges, now);
  assert.equal(stats.week.sessions, 4);
  assert.equal(stats.active.list.find((row) => row.callsign === 'NeonFox').activeSeconds, 260);
});

test('mergeSession clamps active time and keeps prior fields', () => {
  const existing = session({ activeSeconds: 100 });
  const incoming = session({
    startedAt: now - 10 * 60_000,
    firstSeen: now - 3 * 86_400_000,
    activeSeconds: 120,
    callsign: null,
    city: 'Abuja',
  });

  const merged = mergeSession(existing, incoming, now);
  assert.equal(merged.startedAt, existing.startedAt);
  assert.equal(merged.firstSeen, iso(incoming.firstSeen));
  assert.equal(merged.activeSeconds, 120);
  assert.equal(merged.callsign, 'NeonFox');
  assert.equal(merged.city, 'Abuja');
  assert.equal(merged.lastSeen, iso(now));

  const lower = mergeSession(existing, { ...incoming, activeSeconds: 50 }, now);
  assert.equal(lower.activeSeconds, 100);
});

test('mergeSession caps a first heartbeat at 30 seconds of play', () => {
  const incoming = session({ activeSeconds: 9999, startedAt: now });
  const merged = mergeSession(null, incoming, now);
  assert.equal(merged.activeSeconds, 30);
});
