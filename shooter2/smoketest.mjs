// Headless smoke test: loads the built game in real Chrome (WebGL via SwiftShader),
// boots a mode, simulates input, and reports any console errors / page errors.
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL || 'http://localhost:4173/';

const errors = [];
const logs = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

page.on('console', (msg) => {
  const t = msg.type();
  logs.push(`[${t}] ${msg.text()}`);
  if (t === 'error') errors.push(msg.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + r.failure()?.errorText));

console.log('Loading', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

// Inspect game state via the exposed debug handle.
const boot = await page.evaluate(() => {
  const g = window.__bp?.game;
  return {
    hasGame: !!g, state: g?.state,
    colliders: g?.world?.colliders?.length,
    spawns: g?.world?.spawnPoints?.length,
    nav: g?.world?.navPoints?.length,
    weapons: Object.keys(g?.weapons?.viewmodels || {}).length,
  };
});
console.log('Boot:', JSON.stringify(boot));

// Start survival via the API (mimics a user gesture path), then simulate play.
await page.evaluate(() => { window.__bp.game.startMode('survival'); });
await new Promise((r) => setTimeout(r, 400));

// Deterministically step the simulation (independent of headless render fps):
// aim at the nearest enemy, fire, occasionally reload/grenade/switch/move.
const sim = await page.evaluate(async () => {
  const { input, game } = window.__bp;
  input.locked = true;
  const dt = 1 / 60;
  let everEnemies = 0, kills0 = 0;

  let burst = 0;
  for (let i = 0; i < 1600; i++) {
    // The real loop renders every frame (which refreshes world matrices); here
    // we step faster than render, so refresh matrices for accurate raycasts.
    game.scene.updateMatrixWorld(true);
    // Keep the bot alive so the test deterministically measures whether sustained
    // aimed fire produces kills (it should), independent of spawn-RNG lethality.
    game.player.health = game.player.maxHealth;
    game.player.dead = false;
    game.player.lastDamageTime = game.player.time;
    const alive = game.enemies.enemies.filter((e) => !e.dead);
    everEnemies = Math.max(everEnemies, game.enemies.enemies.length);
    // Skilled bot: ADS, aim at body w/ recoil compensation, tap-fire, strafe.
    input.keys.delete('KeyA'); input.keys.delete('KeyD');
    if (alive.length) {
      alive.sort((a, b) => a.pos.distanceToSquared(game.player.pos) - b.pos.distanceToSquared(game.player.pos));
      const e = alive[0];
      const dx = e.pos.x - game.player.pos.x;
      const dz = e.pos.z - game.player.pos.z;
      const eyeY = game.player.pos.y + game.player.height - 0.12;
      const dy = (0.95 * e.scaleF) - eyeY;            // aim center-mass
      const horiz = Math.hypot(dx, dz);
      game.player.yaw = Math.atan2(-dx, -dz);
      // compensate for accumulated recoil climb so bursts stay on target
      game.player.pitch = Math.atan2(dy, horiz) - game.player.recoilOffset.x;
      input.buttons.right = true;                      // ADS for accuracy
      // tap-fire: ~3 round bursts with a recovery gap
      burst = (burst + 1) % 9;
      const firing = burst < 3;
      input.buttons.left = firing;
      input.mousePressed.left = (burst === 0);
      // strafe to dodge
      input.keys.add(i % 80 < 40 ? 'KeyA' : 'KeyD');
    } else {
      input.buttons.left = false; input.buttons.right = false;
    }
    if (i % 160 === 90) { input.keys.add('KeyR'); input.pressed.add('KeyR'); }
    if (i % 240 === 120) { input.keys.add('KeyG'); input.pressed.add('KeyG'); }
    game.update(dt);
    input.endFrame();
  }
  input.buttons.left = false;
  return {
    state: game.state,
    health: Math.round(game.player.health),
    score: game.score,
    everEnemies,
    aliveEnemies: game.enemies.alive,
    kills: game.stats.kills,
    headshots: game.stats.headshots,
    shots: game.stats.shots,
    hits: game.stats.hits,
    accuracy: game.stats.shots ? Math.round(100 * game.stats.hits / game.stats.shots) : 0,
    ammoMag: game.weapons.state.mag,
    wave: game.wave,
    credits: game.credits,
  };
});
console.log('Sim result:', JSON.stringify(sim, null, 2));
if (sim.everEnemies === 0) errors.push('ASSERT: no enemies ever spawned');
if (sim.kills === 0) errors.push('ASSERT: zero kills after sustained combat');

await page.screenshot({ path: 'smoke-shot.png' });
console.log('Screenshot saved: smoke-shot.png');

await browser.close();

console.log('\n=== CONSOLE ERRORS:', errors.length, '===');
for (const e of errors.slice(0, 40)) console.log('  -', e);

if (errors.length) { console.log('\nSMOKE TEST FAILED'); process.exit(1); }
console.log('\nSMOKE TEST PASSED');
