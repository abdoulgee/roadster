import { CALLSIGN_RE } from './callsign';

export interface Challenge {
  name: string;
  score: number;
  distance: number;
}

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (code: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function challengeURL(c: Challenge) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('c', toBase64Url(JSON.stringify({ n: c.name, s: Math.floor(c.score), d: Math.floor(c.distance) })));
  return url.toString();
}

/** The challenge in this page's `?c=` link, if it is well-formed. */
export function readChallenge(): Challenge | null {
  const code = new URLSearchParams(location.search).get('c');
  if (!code) return null;
  try {
    const { n, s, d } = JSON.parse(fromBase64Url(code));
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9;
    if (typeof n !== 'string' || !CALLSIGN_RE.test(n) || !ok(s) || !ok(d)) return null;
    return { name: n, score: Math.floor(s), distance: Math.floor(d) };
  } catch {
    return null;
  }
}

/** Opens the system share sheet where available, otherwise copies the link. */
export async function shareRun(c: Challenge): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const url = challengeURL(c);
  const text = `${c.name} scored ${c.distance.toLocaleString()} m (${c.score.toLocaleString()} pts) in Drive Roadster. Catch me if you can! 🏁`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Drive Roadster', text, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
