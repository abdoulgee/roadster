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
  private readonly steps = document.getElementById('install-steps');

  private deferred: BeforeInstallPromptEvent | null = null;
  private visible = false;
  private started = false;
  private timer = 0;
  private readonly waitingSince = Date.now();
  private readonly ios = isIos();

  constructor() {
    if (!this.el || !this.installBtn || !this.laterBtn || !this.title || !this.text || !this.steps) return;

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
    if (this.visible) return;
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
    // Without a prompt event there is nothing to install from here (iOS gets instructions instead).
    if (!this.deferred && !this.ios) {
      // Chrome may hold the event back for a while; stop polling after two minutes. If it does
      // arrive later, onBeforeInstall starts the invitation again.
      if (Date.now() - this.waitingSince > 120_000) {
        this.started = false;
        return;
      }
      this.schedule(1200);
      return;
    }
    if (!this.menuReady()) {
      this.schedule(1200);
      return;
    }
    this.show();
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

    if (this.ios) {
      // Safari has no beforeinstallprompt; walk the player through the share sheet.
      this.el.classList.add('instructions');
      this.installBtn?.classList.add('hidden');
      this.laterBtn?.classList.add('primary');
      this.laterBtn!.textContent = 'Got it';
      this.steps?.classList.remove('hidden');
      this.title!.textContent = 'Put Roadster on your home screen';
      this.text!.textContent = 'A home-screen app gets the full screen and opens without a signal. Your browser keeps it two taps away.';
    }

    this.el.classList.remove('hidden');
    requestAnimationFrame(() => (this.ios ? this.laterBtn : this.installBtn)?.focus());
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
