# BREACHPOINT

> An original, browser-based 3D first-person military shooter — built from scratch
> with **Three.js**. No engine, no copyrighted assets: every model is primitive
> geometry, every sound is synthesized live with the WebAudio API, every texture is
> generated procedurally on a canvas.

*GHOST DIVISION · ZERO HOUR — Hold the line. Clear the sectors. There is no backup.*

---

## Quick start

```bash
npm install
npm run dev
```

Then open the URL Vite prints (defaults to <http://localhost:5173>). Click a mode,
then **click the screen to lock the mouse** and play.

Production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the built game on :4173
```

Requires a modern desktop browser with WebGL2 (Chrome, Edge, Firefox, Safari).

---

## How to play

You are a lone operator dropped into a compromised industrial compound. Hostiles
will **detect you, take cover, flank, and suppress** — keep moving, use cover, and
aim for the head.

### Modes
- **SURVIVAL** — Endless escalating waves. Earn credits per kill, then spend them in
  the **Armory** between waves on new weapons, armor, ammo, grenades and permanent
  run upgrades (max health, regen, mobility). How long can you hold?
- **OPERATION** — Three marked sectors. Stand in a sector with no live hostiles
  inside to capture it. Secure all three to win, against continuous reinforcements.

### Controls (rebindable in Settings)

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Sprint | `Shift` |
| Crouch / Slide | `C` (slide while sprinting) |
| Jump | `Space` |
| Lean left / right | `Q` / `E` |
| Look | Mouse |
| Fire | Left mouse |
| Aim down sights (ADS) | Right mouse |
| Reload | `R` |
| Grenade | `G` |
| Switch weapon | `1`–`5` or mouse wheel |
| Interact / advance | `F` |
| Pause | `Esc` |
| Mute | `M` |

### Weapons
- **VK-7 Rifle** — versatile full-auto, rising recoil. *(starting weapon)*
- **P-11 Sidearm** — fast, accurate pistol. *(starting weapon)*
- **WR-9 SMG** — very high rate of fire, close-quarters shredder.
- **M3 Breacher** — pump shotgun, 9-pellet spread, devastating up close.
- **LR-50 Marksman** — bolt sniper, scoped, one-shot headshots.
- **Frag Grenade** — `G` to cook and throw; bounces, explodes, chains barrels.

Tip: controlled **bursts while ADS** beat spraying — the rifle climbs and your
spread grows the longer you hold the trigger. Headshots deal 2–2.6× damage. Red
barrels explode. Sliding into a corner with the shotgun is very effective.

---

## What makes it feel good ("juice")

- Acceleration-based movement with sprint, crouch-slide, lean, air control,
  head-bob, view-tilt, landing dip and breathing sway.
- Per-weapon recoil patterns, ADS that tightens spread + zooms FOV, dynamic
  crosshair bloom, weapon sway and reload/switch animations.
- Muzzle flashes with dynamic lights, tracer rounds, shell ejection, sparks,
  blood, bullet-hole decals, screen shake, hitmarkers (with headshot ping),
  floating damage numbers, kill feed and directional damage indicators.
- Synthesized, layered gunfire (body + crack + snap), reload clicks, explosions,
  an alarm klaxon and an adaptive music bed that intensifies with the action.
- Believable AI: line-of-sight + hearing, patrol → alert → combat → seek-cover →
  flank, strafing, suppression and ragdoll-lite deaths. Three archetypes
  (Rifleman, Rusher, Heavy) and difficulty that scales every wave.
- A handcrafted night compound: warehouse, elevated catwalks, a glowing server
  vault, shipping-container maze, cover crates, explosive barrels, sodium lamps,
  alarm strobes, fog, stars and a gradient sky.

---

## Project structure

```
index.html          Entry shell + base styling
src/
  main.js           Bootstrap + fixed-timestep loop
  engine.js         Renderer, scene/camera, viewmodel overlay pass, quality
  input.js          Pointer-lock look, keyboard, rebinding, persisted settings
  player.js         Kinematic FPS controller (collide-and-slide), camera feel
  weapons.js        Weapon defs, firing, recoil, reload, ADS, viewmodels, grenades
  enemies.js        AI FSM, archetypes, navigation, LOS, hit resolution, ragdolls
  world.js          Level geometry, colliders, lighting, props, skybox, nav data
  effects.js        Pooled particles, tracers, decals, muzzle flashes, explosions
  audio.js          Fully procedural WebAudio sound bank + adaptive music
  hud.js            HUD: vitals, ammo, minimap, compass, objectives, feedback
  menus.js          Main / settings / pause / results / armory screens
  game.js           Orchestrator: modes, director, scoring, XP, shop, pickups
  util.js           Math, RNG, easing, pools
```

See **[DESIGN.md](./DESIGN.md)** for the full design document and the rationale
behind technical choices (notably the custom kinematic controller over a physics
engine for crisper FPS feel).

---

## Testing

A headless smoke test (`smoketest.mjs`) drives the built game in real Chrome via
`puppeteer-core`, boots a mode, simulates combat and asserts there are no console
errors and that the core loop (spawn → engage → kill → score) works.

```bash
npm run preview &        # serve the build
node smoketest.mjs       # exits non-zero on any console/runtime error
```

---

## Known limitations & future ideas

- AI navigation is local steering + a coarse waypoint grid (no full pathfinding),
  so enemies occasionally take loose routes around large obstacles.
- Single level; future work: more maps, a destructible-cover pass, and verticality
  the AI can use (currently AI stays at ground level; the player can use catwalks).
- No networked multiplayer; a natural extension given the deterministic core.
- Ideas: weapon attachments/loadout editor, killstreak rewards, boss enemies, a
  scripted campaign mission, controller support, and a photo-mode.

All assets are original / procedurally generated. No copyrighted names, characters,
logos or audio are used anywhere in this project.
