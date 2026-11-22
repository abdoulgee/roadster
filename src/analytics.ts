/**
 * Anonymous usage analytics for the pit wall.
 *
 * The game records a visit and then a heartbeat every 30 seconds through /api/track, which writes
 * one JSON session blob in Vercel Blob: an anonymous browser id, a per-tab session id, active
 * (visible) seconds, the pilot's callsign, parsed device/browser, and coarse city/country from the
 * visitor's IP. No GPS is requested and no coordinates are stored. Set VITE_ANALYTICS_OFF=1 to
 * disable it. Requests are fire-and-forget and must never affect the game.
 */

const VISITOR_KEY = 'drive-roadster:visitor:v1';
const FIRST_KEY = 'drive-roadster:first-seen:v1';
const SESSION_KEY = 'drive-roadster:session:v1';
const STARTED_KEY = 'drive-roadster:session-started:v1';
const ACTIVE_KEY = 'drive-roadster:active-seconds:v1';
const GEO_KEY = 'drive-roadster:geo:v1';
const HEARTBEAT_MS = 30_000;
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SECONDS = 86_400;

interface Geo {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  at: number;
}

function read(store: Storage, key: string) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(store: Storage, key: string, value: string) {
  try {
    store.setItem(key, value);
  } catch {
    /* Analytics is optional; blocked storage simply makes this tab ephemeral. */
  }
}

function uuid() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

/** The pilot name the game saved locally, if one has been chosen yet. */
function callsign() {
  for (const key of ['drive-roadster:online-pilot:v1', 'drive-roadster:pilot:v1']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const name = (JSON.parse(raw) as { callsign?: unknown }).callsign;
      if (typeof name === 'string' && /^[A-Za-z0-9_.-]{2,12}$/.test(name)) return name;
    } catch {
      /* try the next key */
    }
  }
  return null;
}

function describe() {
  const ua = navigator.userAgent;
  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile = /Mobi|Android|iPhone|iPod/i.test(ua);
  const device = tablet ? 'Tablet' : mobile ? 'Mobile' : 'Desktop';
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /CrOS/i.test(ua)
        ? 'ChromeOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Mac OS X/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Other';
  const browser = /EdgA?\//i.test(ua)
    ? 'Edge'
    : /SamsungBrowser/i.test(ua)
      ? 'Samsung Internet'
      : /OPR\//i.test(ua)
        ? 'Opera'
        : /CriOS/i.test(ua)
          ? 'Chrome iOS'
          : /FxiOS/i.test(ua)
            ? 'Firefox iOS'
            : /Chrome\//i.test(ua)
              ? 'Chrome'
              : /Firefox\//i.test(ua)
                ? 'Firefox'
                : /Safari\//i.test(ua)
                  ? 'Safari'
                  : 'Other';
  return { device, os, browser };
}

function readGeo(): Geo | null {
  try {
    const raw = read(localStorage, GEO_KEY);
    if (!raw) return null;
    const geo = JSON.parse(raw) as Partial<Geo>;
    if (typeof geo.at !== 'number' || Date.now() - geo.at > GEO_TTL_MS) return null;
    const code = typeof geo.countryCode === 'string' && /^[A-Za-z]{2}$/.test(geo.countryCode) ? geo.countryCode.toUpperCase() : null;
    return {
      country: clean(geo.country, 80),
      countryCode: code,
      region: clean(geo.region, 80),
      city: clean(geo.city, 80),
      at: geo.at,
    };
  } catch {
    return null;
  }
}

/** Coarse location from the public IP. Cached for a week; failure leaves the visit unlocated. */
async function lookupGeo(): Promise<Geo | null> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch('https://ipwho.is/', {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    window.clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      success?: boolean;
      country?: string;
      country_code?: string;
      region?: string;
      city?: string;
    };
    if (data.success === false) return null;
    const geo: Geo = {
      country: clean(data.country, 80),
      countryCode:
        typeof data.country_code === 'string' && /^[A-Za-z]{2}$/.test(data.country_code)
          ? data.country_code.toUpperCase()
          : null,
      region: clean(data.region, 80),
      city: clean(data.city, 80),
      at: Date.now(),
    };
    write(localStorage, GEO_KEY, JSON.stringify(geo));
    return geo;
  } catch {
    return null;
  }
}

async function apiReady() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return false;
    const health = (await response.json()) as { ok?: boolean; configured?: boolean };
    return !!health?.ok && !!health.configured;
  } catch {
    return false;
  }
}

export function initAnalytics() {
  if (import.meta.env.VITE_ANALYTICS_OFF === '1') return;

  // Respect Do Not Track and Global Privacy Control before touching storage or the network.
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (navigator.doNotTrack === '1' || nav.globalPrivacyControl === true) return;

  void start();
}

async function start() {
  if (!(await apiReady())) return;

  const nowIso = new Date().toISOString();
  const visitorId = read(localStorage, VISITOR_KEY) ?? uuid();
  write(localStorage, VISITOR_KEY, visitorId);
  const firstSeen = read(localStorage, FIRST_KEY) ?? nowIso;
  write(localStorage, FIRST_KEY, firstSeen);
  const sessionId = read(sessionStorage, SESSION_KEY) ?? uuid();
  write(sessionStorage, SESSION_KEY, sessionId);
  const startedAt = read(sessionStorage, STARTED_KEY) ?? nowIso;
  write(sessionStorage, STARTED_KEY, startedAt);

  const who = describe();
  let geo = readGeo();
  const storedSeconds = Number(read(sessionStorage, ACTIVE_KEY)) || 0;
  let activeMs = Math.max(0, Math.min(MAX_ACTIVE_SECONDS, storedSeconds)) * 1000;
  let lastTick = performance.now();
  let lastBeat = 0;

  const tick = () => {
    const now = performance.now();
    if (document.visibilityState === 'visible') activeMs += now - lastTick;
    lastTick = now;
  };

  const beat = (keepalive = false, force = false) => {
    if (document.visibilityState !== 'visible' && !keepalive) return;
    tick();
    const now = performance.now();
    if (!keepalive && !force && now - lastBeat < 4000) return;
    lastBeat = now;

    const activeSeconds = Math.min(MAX_ACTIVE_SECONDS, Math.floor(activeMs / 1000));
    write(sessionStorage, ACTIVE_KEY, String(activeSeconds));

    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sessionId,
        firstSeen,
        startedAt,
        activeSeconds,
        callsign: callsign(),
        country: geo?.country ?? null,
        countryCode: geo?.countryCode ?? null,
        region: geo?.region ?? null,
        city: geo?.city ?? null,
        device: who.device,
        os: who.os,
        browser: who.browser,
        path: location.pathname.slice(0, 120),
        userAgent: navigator.userAgent.slice(0, 300),
      }),
      keepalive,
    }).catch(() => {
      /* stay silent; analytics must never interrupt the game */
    });
  };

  beat(false);
  if (!geo) {
    void lookupGeo().then((found) => {
      if (!found) return;
      geo = found;
      // Force this one: it usually lands inside the anti-spam window after the first beat.
      beat(false, true);
    });
  }

  window.setInterval(() => beat(false), HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastTick = performance.now();
      beat(false);
    } else {
      beat(true);
    }
  });
  window.addEventListener('pagehide', () => beat(true));
}
