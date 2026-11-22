interface WindowStats {
  visitors: number;
  sessions: number;
  newVisitors: number;
  over2m: number;
  over3m: number;
  totalSeconds: number;
  avgSeconds: number;
}

interface SessionRow {
  callsign: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  activeSeconds: number;
  lastSeen: string;
  startedAt: string;
  lastPath?: string | null;
}

interface ActiveBlock {
  users: number;
  sessions: number;
  list: SessionRow[];
}

interface LocationRow {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  visitors: number;
  sessions: number;
}

interface DeviceRow {
  device: string | null;
  visitors: number;
}

interface DailyRow {
  date: string;
  visitors: number;
  sessions: number;
  seconds: number;
}

interface Stats {
  generatedAt: string;
  timezone: string;
  today: WindowStats;
  yesterday: WindowStats;
  week: WindowStats;
  active: ActiveBlock;
  recent: SessionRow[];
  locations: LocationRow[];
  devices: DeviceRow[];
  daily: DailyRow[];
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const setupEl = byId<HTMLElement>('setup');
const gateEl = byId<HTMLElement>('gate');
const dashboardEl = byId<HTMLElement>('dashboard');
const topActions = byId<HTMLElement>('top-actions');
const loginForm = byId<HTMLFormElement>('login-form');
const passwordInput = byId<HTMLInputElement>('admin-password');
const loginBtn = byId<HTMLButtonElement>('btn-login');
const gateError = byId<HTMLElement>('gate-error');
const refreshBtn = byId<HTMLButtonElement>('btn-refresh');
const signoutBtn = byId<HTMLButtonElement>('btn-signout');
const updatedEl = byId<HTMLElement>('updated');
const refreshError = byId<HTMLElement>('refresh-error');
const dashTime = byId<HTMLElement>('dash-time');
const windowsBody = byId<HTMLElement>('windows-body');
const chartSub = byId<HTMLElement>('chart-sub');
const chartBars = byId<HTMLElement>('chart-bars');
const chartEmpty = byId<HTMLElement>('chart-empty');
const dailyBody = byId<HTMLElement>('daily-body');
const liveSub = byId<HTMLElement>('live-sub');
const liveList = byId<HTMLElement>('live-list');
const locationsList = byId<HTMLElement>('locations-list');
const devicesList = byId<HTMLElement>('devices-list');
const recentBody = byId<HTMLElement>('recent-body');
const tzLabel = byId<HTMLElement>('tz-label');
const setupRetry = byId<HTMLButtonElement>('btn-setup-retry');
const passwordWarning = byId<HTMLElement>('password-warning');
const configWarning = byId<HTMLElement>('config-warning');

const kpiActive = { value: byId<HTMLElement>('kpi-active'), sub: byId<HTMLElement>('kpi-active-sub') };
const kpiVisitors = { value: byId<HTMLElement>('kpi-visitors'), sub: byId<HTMLElement>('kpi-visitors-sub') };
const kpiSessions = { value: byId<HTMLElement>('kpi-sessions'), sub: byId<HTMLElement>('kpi-sessions-sub') };
const kpiAvg = { value: byId<HTMLElement>('kpi-avg'), sub: byId<HTMLElement>('kpi-avg-sub') };
const kpiOver2 = { value: byId<HTMLElement>('kpi-over2'), sub: byId<HTMLElement>('kpi-over2-sub') };
const kpiOver3 = { value: byId<HTMLElement>('kpi-over3'), sub: byId<HTMLElement>('kpi-over3-sub') };

const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const plainFmt = new Intl.NumberFormat();

let password = '';
let current: Stats | null = null;
let loading = false;
let timer = 0;
let defaultPasswordInUse = false;

class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError('network');
  }
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `http_${response.status}`);
  return data as T;
}

function loginError(error: unknown) {
  const code = error instanceof ApiError ? error.code : 'network';
  if (code === 'unauthorized') return 'That password does not open the pit wall.';
  if (code === 'setup') return 'Analytics is not configured. Connect a Vercel Blob store to the project, then try again.';
  return 'The stats API is not reachable. Use `vercel dev` locally, or deploy to Vercel.';
}

function timezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface PeriodRange {
  start: string;
  end: string;
}

interface DayRange extends PeriodRange {
  date: string;
}

interface Ranges {
  timezone: string;
  today: PeriodRange;
  yesterday: PeriodRange;
  week: PeriodRange;
  days: DayRange[];
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The browser owns the calendar boundaries so the dashboard follows its timezone. */
function buildRanges(): Ranges {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days: DayRange[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(today.getDate() - i);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    days.push({ date: localDateKey(start), start: start.toISOString(), end: end.toISOString() });
  }
  return {
    timezone: timezone(),
    today: { start: today.toISOString(), end: now.toISOString() },
    yesterday: { start: yesterday.toISOString(), end: today.toISOString() },
    week: { start: week.toISOString(), end: now.toISOString() },
    days,
  };
}

function formatCount(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value >= 10_000 ? compactFmt.format(value) : plainFmt.format(value);
}

function plural(value: number, word: string) {
  return `${formatCount(value)} ${word}${value === 1 ? '' : 's'}`;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function relative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Math.max(0, Date.now() - date.getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function dayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date(value) : date;
}

function weekdayShort(value: string) {
  return dayDate(value).toLocaleDateString([], { weekday: 'short' });
}

function dayNumber(value: string) {
  return dayDate(value).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function fullDate(value: string) {
  return dayDate(value).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function locationLabel(loc: { city: string | null; region: string | null; country: string | null }) {
  const parts: string[] = [];
  for (const part of [loc.city, loc.region, loc.country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.length ? parts.join(', ') : 'Location unknown';
}

function countryChip(loc: { countryCode: string | null }) {
  if (!loc.countryCode || !/^[A-Z]{2}$/.test(loc.countryCode)) return null;
  return el('span', 'cc', loc.countryCode);
}

function sessionDevice(row: SessionRow) {
  const parts = [row.device, row.os, row.browser].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}

function numCell(text: string) {
  return el('td', 'num', text);
}

function labeledCell(label: string, text: string) {
  const cell = el('td', 'num', text);
  cell.dataset.label = label;
  return cell;
}

function setKpi(target: { value: HTMLElement; sub: HTMLElement }, value: string, sub: string) {
  target.value.textContent = value;
  target.sub.textContent = sub;
}

function render(data: Stats) {
  updatedEl.textContent = `Updated ${formatTime(data.generatedAt)}`;
  dashTime.textContent = `${data.timezone} · refresh every 30s`;
  tzLabel.textContent = data.timezone;

  setKpi(kpiActive, formatCount(data.active.users), `${plural(data.active.sessions, 'session')} live`);
  setKpi(kpiVisitors, formatCount(data.today.visitors), `${formatCount(data.today.newVisitors)} new today`);
  setKpi(kpiSessions, formatCount(data.today.sessions), `${plural(data.today.visitors, 'visitor')} today`);
  setKpi(kpiAvg, formatDuration(data.today.avgSeconds), `across ${plural(data.today.sessions, 'session')}`);
  setKpi(kpiOver2, formatCount(data.today.over2m), `of ${plural(data.today.visitors, 'visitor')}`);
  setKpi(kpiOver3, formatCount(data.today.over3m), `of ${plural(data.today.visitors, 'visitor')}`);

  renderWindows(data);
  renderChart(data.daily);
  renderLive(data.active);
  renderLocations(data.locations);
  renderDevices(data.devices);
  renderRecent(data.recent);
}

function renderWindows(data: Stats) {
  const windows: [string, WindowStats][] = [
    ['Today', data.today],
    ['Yesterday', data.yesterday],
    ['This week', data.week],
  ];
  windowsBody.replaceChildren(
    ...windows.map(([label, window]) => {
      const row = el('tr');
      row.append(
        el('td', 'period-label', label),
        labeledCell('Visitors', formatCount(window.visitors)),
        labeledCell('Sessions', formatCount(window.sessions)),
        labeledCell('New', formatCount(window.newVisitors)),
        labeledCell('Avg session', formatDuration(window.avgSeconds)),
        labeledCell('2m+', formatCount(window.over2m)),
        labeledCell('3m+', formatCount(window.over3m)),
        labeledCell('Time played', formatDuration(window.totalSeconds)),
      );
      return row;
    }),
  );
}

function renderChart(daily: DailyRow[]) {
  const max = daily.reduce((value, day) => Math.max(value, day.visitors), 0);
  const peak = daily.reduce<DailyRow | null>(
    (best, day) => (!best || day.visitors > best.visitors ? day : best),
    null,
  );
  chartSub.textContent =
    max > 0 && peak
      ? `Last 7 days · peak ${plural(peak.visitors, 'visitor')} on ${fullDate(peak.date)}`
      : 'Last 7 days';

  chartBars.replaceChildren();
  dailyBody.replaceChildren();
  chartBars.classList.toggle('hidden', max === 0);
  chartEmpty.classList.toggle('hidden', max !== 0);

  for (const day of daily) {
    const column = el('div', 'bar-col');
    const track = el('div', 'bar-track');
    const bar = el('button', 'bar');
    bar.type = 'button';
    if (day.visitors === 0) bar.classList.add('zero');
    bar.style.height = `${max > 0 ? Math.max(2, (day.visitors / max) * 100) : 2}%`;
    bar.setAttribute(
      'aria-label',
      `${fullDate(day.date)}: ${plural(day.visitors, 'visitor')}, ${plural(day.sessions, 'session')}, ${formatDuration(day.seconds)} played`,
    );

    const tip = el('span', 'bar-tip');
    tip.append(
      el('b', undefined, plural(day.visitors, 'visitor')),
      el('span', undefined, `${plural(day.sessions, 'session')} · ${formatDuration(day.seconds)} played`),
    );
    bar.append(tip);
    track.append(bar);

    const label = el('div', 'bar-label');
    label.append(el('span', undefined, weekdayShort(day.date)), el('small', undefined, dayNumber(day.date)));
    column.append(track, label);
    chartBars.append(column);

    const row = el('tr');
    row.append(
      el('td', undefined, fullDate(day.date)),
      numCell(formatCount(day.visitors)),
      numCell(formatCount(day.sessions)),
      numCell(formatDuration(day.seconds)),
    );
    dailyBody.append(row);
  }
}

function renderLive(active: ActiveBlock) {
  liveSub.textContent = `${plural(active.users, 'user')} · ${plural(active.sessions, 'session')} in the last 5 minutes`;
  liveList.replaceChildren();
  if (!active.list.length) {
    liveList.append(el('p', 'empty', 'Nobody is driving right now.'));
    return;
  }
  for (const session of active.list.slice(0, 40)) {
    const row = el('div', 'live-row');
    const name = el('div', 'live-name', session.callsign ?? 'Guest');
    const chip = countryChip(session);
    if (chip) name.append(chip);
    const meta = el('div', 'live-meta', `${locationLabel(session)} · ${sessionDevice(session)}`);
    const side = el('div', 'live-side');
    side.append(
      el('div', 'live-time', formatDuration(session.activeSeconds)),
      el('div', 'live-seen', relative(session.lastSeen)),
    );
    row.append(name, meta, side);
    liveList.append(row);
  }
}

function renderLocations(locations: LocationRow[]) {
  locationsList.replaceChildren();
  if (!locations.length) {
    locationsList.append(el('p', 'empty', 'No located visits yet.'));
    return;
  }
  const max = Math.max(1, ...locations.map((row) => row.visitors));
  for (const location of locations) {
    const row = el('div', 'rank-row');
    const name = el('div', 'rank-name', locationLabel(location));
    const chip = countryChip(location);
    if (chip) name.append(chip);
    const meter = el('div', 'rank-meter');
    const fill = el('i');
    fill.style.width = `${Math.max(2, (location.visitors / max) * 100)}%`;
    meter.append(fill);
    row.append(name, el('div', 'rank-count', plural(location.visitors, 'visitor')), meter);
    locationsList.append(row);
  }
}

function renderDevices(devices: DeviceRow[]) {
  devicesList.replaceChildren();
  if (!devices.length) {
    devicesList.append(el('p', 'empty', 'No device data yet.'));
    return;
  }
  const max = Math.max(1, ...devices.map((row) => row.visitors));
  for (const device of devices) {
    const row = el('div', 'rank-row');
    const meter = el('div', 'rank-meter');
    const fill = el('i');
    fill.style.width = `${Math.max(2, (device.visitors / max) * 100)}%`;
    meter.append(fill);
    row.append(
      el('div', 'rank-name', device.device ?? 'Unknown device'),
      el('div', 'rank-count', plural(device.visitors, 'visitor')),
      meter,
    );
    devicesList.append(row);
  }
}

function renderRecent(recent: SessionRow[]) {
  recentBody.replaceChildren();
  if (!recent.length) {
    const row = el('tr');
    const cell = el('td', 'muted', 'No sessions yet.');
    cell.colSpan = 6;
    row.append(cell);
    recentBody.append(row);
    return;
  }
  for (const session of recent) {
    const row = el('tr');
    const pilot = el('td', 'strong', session.callsign ?? 'Guest');
    const location = el('td');
    location.append(document.createTextNode(locationLabel(session)));
    const chip = countryChip(session);
    if (chip) location.append(chip);
    row.append(
      pilot,
      location,
      el('td', 'muted opt', sessionDevice(session)),
      el('td', 'muted opt', formatWhen(session.startedAt)),
      el('td', 'muted', relative(session.lastSeen)),
      numCell(formatDuration(session.activeSeconds)),
    );
    recentBody.append(row);
  }
}

function setBusy(busy: boolean) {
  loading = busy;
  loginBtn.disabled = busy;
  loginBtn.textContent = busy ? 'Checking…' : 'Open the pit wall';
}

async function login() {
  if (loading) return;
  const candidate = passwordInput.value;
  if (!candidate) {
    gateError.textContent = 'Enter the admin password.';
    passwordInput.focus();
    return;
  }
  setBusy(true);
  gateError.textContent = '';
  try {
    const data = await post<Stats>('/api/admin', {
      password: candidate,
      timezone: timezone(),
      ranges: buildRanges(),
    });
    password = candidate;
    passwordInput.value = '';
    current = data;
    gateEl.classList.add('hidden');
    setupEl.classList.add('hidden');
    dashboardEl.classList.remove('hidden');
    topActions.classList.remove('hidden');
    configWarning.classList.toggle('hidden', !defaultPasswordInUse);
    refreshError.classList.add('hidden');
    passwordWarning.classList.add('hidden');
    render(data);
    startAutoRefresh();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'setup') {
      showSetup();
      return;
    }
    gateError.textContent = loginError(error);
    passwordInput.focus();
    passwordInput.select();
  } finally {
    setBusy(false);
  }
}

async function refresh(manual: boolean) {
  if (!password || loading) return;
  if (!manual && document.hidden) return;
  loading = true;
  refreshBtn.disabled = true;
  try {
    const data = await post<Stats>('/api/admin', {
      password,
      timezone: timezone(),
      ranges: buildRanges(),
    });
    current = data;
    render(data);
    refreshError.classList.add('hidden');
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'network';
    if (code === 'unauthorized') {
      showGate();
      gateError.textContent = 'Your admin session ended. Enter the password again.';
      passwordInput.focus();
      return;
    }
    if (code === 'setup') {
      showSetup();
      return;
    }
    if (!current) {
      showGate();
      gateError.textContent = loginError(error);
    } else {
      refreshError.textContent = 'Could not refresh just now. Showing the last successful update.';
      refreshError.classList.remove('hidden');
    }
  } finally {
    loading = false;
    refreshBtn.disabled = false;
  }
}

function startAutoRefresh() {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (password) void refresh(false);
  }, 30_000);
}

function signOut() {
  password = '';
  current = null;
  window.clearInterval(timer);
  window.location.reload();
}

function showSetup() {
  window.clearInterval(timer);
  password = '';
  current = null;
  setupEl.classList.remove('hidden');
  gateEl.classList.add('hidden');
  dashboardEl.classList.add('hidden');
  topActions.classList.add('hidden');
}

function showGate() {
  window.clearInterval(timer);
  gateEl.classList.remove('hidden');
  setupEl.classList.add('hidden');
  dashboardEl.classList.add('hidden');
  topActions.classList.add('hidden');
}

async function boot() {
  gateError.textContent = '';
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('health');
    const health = (await response.json()) as {
      ok?: boolean;
      configured?: boolean;
      passwordConfigured?: boolean;
    };
    if (!health.ok || !health.configured) {
      showSetup();
      return;
    }
    defaultPasswordInUse = !health.passwordConfigured;
    passwordWarning.textContent = defaultPasswordInUse
      ? 'ADMIN_PASSWORD is not set in Vercel; the API is using the default password. Set it before sharing this site.'
      : '';
    passwordWarning.classList.toggle('hidden', !defaultPasswordInUse);
    configWarning.textContent = defaultPasswordInUse
      ? 'ADMIN_PASSWORD is not set in Vercel. The pit wall is using the default password — set it before sharing this site.'
      : '';
    showGate();
    passwordInput.focus();
  } catch {
    showSetup();
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void login();
});
refreshBtn.addEventListener('click', () => void refresh(true));
signoutBtn.addEventListener('click', signOut);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && password) void refresh(false);
});
setupRetry.addEventListener('click', () => void boot());

void boot();
