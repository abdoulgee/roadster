import { Game } from './game';
import { initAnalytics } from './analytics';
import { initPwa } from './pwa';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loader = document.getElementById('loading')!;

// Service worker, home-screen invitation and anonymous usage stats; all fire-and-forget.
initPwa();
initAnalytics();

// The loading screen covers only the time the game needs to get ready, then gets out of the way.
async function boot() {
  // One paint so the loading screen shows while the world is built.
  await new Promise((r) => requestAnimationFrame(r));
  const game = new Game(canvas);
  await game.prepare();
  game.run();
  loader.remove();
}

void boot();
