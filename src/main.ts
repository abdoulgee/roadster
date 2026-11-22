import { Game } from './game';
import { initPwa } from './pwa';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loader = document.getElementById('loading')!;

// Service worker and the home-screen invitation; listeners go up before the world is built.
initPwa();

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
