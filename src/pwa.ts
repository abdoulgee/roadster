/**
 * PWA plumbing: the service worker (offline app shell) and the install invitation.
 *
 * Browsers only show their own install prompt after an engagement signal, and many never show it
 * at all. Instead we catch `beforeinstallprompt`, keep it, and offer our own card on the menu.
 * iOS has no such event, so it gets the Share → Add to Home Screen steps instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const SHOWN_KEY = 'roadster.install.shown';
const DISMISSED_KEY = 'roadster.install.dismissed';
const INSTALLED_KEY = 'roadster.installed';

const DEFAULT_TITLE = 'Take the highway with you';
const DEFAULT_TEXT =
  'Add Drive Roadster to your home screen for full-screen runs and one-tap access. It still opens when the signal drops.';
const MANUAL_TITLE = 'Put Roadster on your home screen';
const IOS_TEXT =
  'A home-screen app gets the full screen and opens without a signal. Your browser keeps it two taps away.';
const ANDROID_TEXT =
  'A home-screen app gets the full screen and opens without a signal. Your browser can add it in a few taps.';

type Mode = 'native' | 'ios' | 'manual';

/** Dialogs that, while open, mean the menu isn't the screen in front of the player. */
const OTHER_DIALOGS = ['callsign', 'howto', 'pause', 'over', 'photo'];

let toastTimer = 0;

export function initPwa() {
  registerWorker();
  new InstallInvitation();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    // The dev worker deliberately caches nothing; Vite's module graph breaks under a cache.
    const url = import.meta.env.DEV ? '/sw.js?dev=1' : '/sw.js';
    void navigator.serviceWorker.register(url, { scope: '/' }).catch(() => {
      /* Plain HTTP (or a browser without PWA support): the game still runs, just without offline. */
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
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
    /* Private windows can refuse storage; the invitation simply won't remember. */
  }
}

function isStandalone() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  // iPadOS reports a Mac user agent but still has a touch screen.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function toast(text: string, ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

class InstallInvitation {
  private readonly el = document.getElementById('install');
  private readonly installBtn = document.getElementById('btn-install') as HTMLButtonElement | null;
  private readonly laterBtn = document.getElementById('btn-install-later') as HTMLButtonElement | null;
  private readonly title = document.getElementById('install-title');
  private readonly text = document.getElementById('install-text');
  private readonly stepsIos = document.getElementById('install-steps');
  private readonly stepsAndroid = document.getElementById('install-steps-android');
  private readonly note = document.getElementById('install-note');

  private deferred: BeforeInstallPromptEvent | null = null;
  private visible = false;
  private started = false;
  private timer = 0;
  private readySince = 0;
  private mode: Mode = 'native';
  private readonly waitingSince = Date.now();
  private readonly ios = isIos();
  private readonly android = isAndroid();

  constructor() {
    if (
      !this.el ||
      !this.installBtn ||
      !this.laterBtn ||
      !this.title ||
      !this.text ||
      !this.stepsIos ||
      !this.stepsAndroid ||
      !this.note
    )
      return;

    this.installBtn.addEventListener('click', () => void this.install());
    this.laterBtn.addEventListener('click', () => this.dismiss());
    document.getElementById('btn-install-close')?.addEventListener('click', () => this.dismiss());
    // A tap on the dimmed backdrop closes it like the close button.
    this.el.addEventListener('click', (event) => {
      if (event.target === this.el) this.dismiss();
    });
    document.addEventListener('keydown', this.onKey);

    window.addEventListener('beforeinstallprompt', this.onBeforeInstall);
    window.addEventListener('appinstalled', this.onInstalled);

    if (isStandalone()) {
      write(localStorage, INSTALLED_KEY, '1');
      return;
    }
    if (read(localStorage, INSTALLED_KEY) || read(sessionStorage, SHOWN_KEY) || read(sessionStorage, DISMISSED_KEY)) return;

    this.started = true;
    this.watchScreens();
    this.schedule(2200);
  }

  /** The browser says the app is installable. Keep the event; it is the only way to open the native dialog. */
  private onBeforeInstall = (event: Event) => {
    event.preventDefault();
    this.deferred = event as BeforeInstallPromptEvent;
    if (this.visible) {
      // The card may already be showing browser-menu steps; upgrade it to the native button.
      if (!this.ios && this.mode !== 'native') this.setMode('native');
      return;
    }
    if (this.started) {
      this.schedule(400);
      return;
    }
    // The invitation may have stopped waiting for this event earlier; it can start again now.
    if (this.blocked() || read(sessionStorage, SHOWN_KEY)) return;
    this.started = true;
    this.schedule(400);
  };

  private onInstalled = () => {
    write(localStorage, INSTALLED_KEY, '1');
    this.deferred = null;
    this.started = false;
    this.hide(false);
    toast('Roadster installed. It is waiting on your home screen.');
  };

  private onKey = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      // Keep the game from reading the same key after the card has hidden itself.
      event.stopPropagation();
      this.dismiss();
    }
  };

  private schedule(ms: number) {
    if (!this.started) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.check, ms);
  }

  /** Already installed, or declined for this tab. */
  private blocked() {
    return isStandalone() || !!read(localStorage, INSTALLED_KEY) || !!read(sessionStorage, DISMISSED_KEY);
  }

  private check = () => {
    this.timer = 0;
    if (!this.started || this.visible) return;
    if (this.blocked()) {
      this.started = false;
      return;
    }
    if (!this.menuReady()) {
      this.readySince = 0;
      this.schedule(1200);
      return;
    }
    if (!this.readySince) this.readySince = Date.now();

    // iOS has no install event, so it always gets the share-sheet steps.
    if (this.ios) {
      if (Date.now() - this.readySince < 800) {
        this.schedule(400);
        return;
      }
      this.show();
      return;
    }

    if (this.deferred) {
      this.show();
      return;
    }

    // Android can add a home-screen shortcut through the browser menu even when no PWA prompt is
    // offered (plain HTTP, in-app browsers, older WebViews). Give the real event a moment first.
    if (this.android) {
      if (Date.now() - this.readySince < 5000) {
        this.schedule(1000);
        return;
      }
      this.show();
      return;
    }

    // Desktop: without the event there is no native dialog to open. Wait a while for browsers
    // that hold it back, then stop polling; onBeforeInstall can start the invitation again.
    if (Date.now() - this.waitingSince > 120_000) {
      this.started = false;
      return;
    }
    this.schedule(1200);
  };

  private menuReady() {
    if (document.getElementById('loading')) return false;
    const menu = document.getElementById('menu');
    if (!menu || menu.classList.contains('hidden')) return false;
    for (const id of OTHER_DIALOGS) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return false;
    }
    return true;
  }

  private watchScreens() {
    const observer = new MutationObserver(() => {
      if (this.visible && !this.menuReady()) this.hide(true);
      else if (this.started && !this.visible) this.schedule(700);
    });
    for (const id of ['menu', ...OTHER_DIALOGS]) {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  }

  private show() {
    if (!this.el || this.visible) return;
    this.visible = true;
    write(sessionStorage, SHOWN_KEY, '1');
    window.clearTimeout(this.timer);

    this.setMode(this.ios ? 'ios' : this.deferred ? 'native' : 'manual');
    if (!window.isSecureContext) {
      this.note!.textContent =
        'This page is on HTTP, so it cannot install as a full offline app. The browser can still add a shortcut; open the HTTPS address for the complete app.';
      this.note!.classList.remove('hidden');
    }

    this.el.classList.remove('hidden');
    requestAnimationFrame(() => (this.mode === 'native' ? this.installBtn : this.laterBtn)?.focus());
  }

  /** Native install button, iOS share-sheet steps, or Android browser-menu steps. */
  private setMode(mode: Mode) {
    this.mode = mode;
    const native = mode === 'native';
    this.el!.classList.toggle('instructions', !native);
    this.stepsIos!.classList.toggle('hidden', mode !== 'ios');
    this.stepsAndroid!.classList.toggle('hidden', mode !== 'manual');
    this.installBtn!.classList.toggle('hidden', !native);
    this.laterBtn!.classList.toggle('primary', !native);
    this.laterBtn!.textContent = native ? 'Not now' : 'Got it';
    this.title!.textContent = native ? DEFAULT_TITLE : MANUAL_TITLE;
    this.text!.textContent = mode === 'ios' ? IOS_TEXT : mode === 'manual' ? ANDROID_TEXT : DEFAULT_TEXT;
  }

  private async install() {
    const event = this.deferred;
    if (!event) {
      this.dismiss();
      return;
    }
    this.installBtn!.disabled = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      this.deferred = null;
      if (choice.outcome === 'accepted') {
        write(localStorage, INSTALLED_KEY, '1');
        this.started = false;
        this.hide(false);
        toast('Roadster installed. Look for it on your home screen.');
      } else {
        this.dismiss();
      }
    } catch {
      this.dismiss();
    } finally {
      this.installBtn!.disabled = false;
    }
  }

  /** "Not now": don't ask again in this tab; a new visit gets a fresh invitation. */
  private dismiss() {
    write(sessionStorage, DISMISSED_KEY, '1');
    this.started = false;
    this.hide(false);
  }

  /** @param reschedule keep the invitation for when the menu is front and centre again. */
  private hide(reschedule: boolean) {
    if (!this.visible || !this.el) return;
    this.visible = false;
    this.el.classList.add('hidden');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (reschedule) this.schedule(800);
  }
}
