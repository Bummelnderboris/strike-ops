// Bootstrap: create the engine, input and game, then run a fixed-timestep
// simulation loop decoupled from rendering for stable, frame-rate-independent feel.
import { Engine } from './engine.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { audio } from './audio.js';

const container = document.getElementById('app');
const engine = new Engine(container);
const input = new Input(engine.renderer.domElement);
const game = new Game(engine, input);

// Prevent context menu on right-click (used for ADS).
window.addEventListener('contextmenu', (e) => e.preventDefault());

// First interaction unlocks audio (browser autoplay policy).
const unlock = () => { audio.init(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);

// Boot into main menu.
game.menus.showMain();

// Clicking the canvas while playing re-locks the pointer.
engine.renderer.domElement.addEventListener('click', () => {
  if (game.state === 'playing' && !input.locked) input.requestLock();
});

// ---- Fixed-timestep loop ----
const FIXED = 1 / 120;          // simulation step (s)
const MAX_FRAME = 0.25;         // clamp huge tab-out gaps
let last = performance.now() / 1000;
let acc = 0;
let fps = 60, fpsT = 0, fpsCount = 0;

function frame(nowMs) {
  const now = nowMs / 1000;
  let delta = now - last;
  last = now;
  if (delta > MAX_FRAME) delta = MAX_FRAME;
  acc += delta;

  let steps = 0;
  while (acc >= FIXED && steps < 8) {
    game.update(FIXED);
    acc -= FIXED;
    steps++;
  }
  // If we fell badly behind, drop the remainder to avoid spiral-of-death.
  if (acc > FIXED * 8) acc = 0;

  engine.render();
  input.endFrame();

  // lightweight fps sampling (used by adaptive quality if needed)
  fpsT += delta; fpsCount++;
  if (fpsT >= 1) { fps = fpsCount / fpsT; fpsT = 0; fpsCount = 0; game._fps = fps; }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose for debugging in the console.
window.__bp = { engine, input, game };
