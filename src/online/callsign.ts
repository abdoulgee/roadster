// Client-side mirror of the server's callsign rules, so most mistakes are caught before a request.

export const CALLSIGN_RE = /^[A-Za-z0-9_.-]{2,12}$/;

const BANNED = ['admin', 'moderator', 'fuck', 'shit', 'nigg', 'fag', 'cunt', 'rape', 'nazi'];

export type CallsignProblem = 'length' | 'chars' | 'bad';

export function callsignProblem(name: string): CallsignProblem | null {
  if (name.length < 2 || name.length > 12) return 'length';
  if (!CALLSIGN_RE.test(name)) return 'chars';
  const lower = name.toLowerCase();
  if (BANNED.some((w) => lower.includes(w))) return 'bad';
  return null;
}

const FIRST = ['Turbo', 'Nitro', 'Neon', 'Rapid', 'Sonic', 'Hyper', 'Solar', 'Lunar', 'Rogue', 'Swift', 'Astro', 'Pixel'];
const SECOND = ['Fox', 'Comet', 'Viper', 'Racer', 'Pilot', 'Rocket', 'Hawk', 'Bolt', 'Drift', 'Jet', 'Lynx', 'Orbit'];

export function randomCallsign() {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  let name = '';
  do name = pick(FIRST) + pick(SECOND);
  while (name.length > 10);
  return name + String(Math.floor(Math.random() * 100)).padStart(2, '0');
}

/** Two-letter region from the browser's language tags (e.g. en-NG → NG); null if none has one. */
export function detectRegion(): string | null {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const region = tag.split('-').slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
    if (region) return region.toUpperCase();
  }
  return null;
}
