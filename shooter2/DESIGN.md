# BREACHPOINT — Game Design Document

> An original, browser-based 3D first-person military shooter built with Three.js.
> No copyrighted names, characters, audio, or assets. Everything here is original,
> procedurally generated, or built from primitive geometry and the WebAudio API.

---

## 1. Title & Identity

**BREACHPOINT**

A lone operator from a deniable counter-terror unit ("GHOST DIVISION") is dropped
into a compromised industrial compound at zero hour. The relief team is gone. The
extraction window is closing. Hold the line, clear the sectors, survive the assault.

- **Tagline:** *Hold the line. Clear the sectors. There is no backup.*
- **Tone:** Tense, grounded near-future military. Concrete, steel, sodium lamps,
  fog, red alarm lighting. Gritty but readable.
- **Core fantasy:** Be a hyper-competent operator — precise gunplay, fluid movement,
  reading a firefight and winning it.

## 2. Target Feel

The single most important pillar is **gunplay feel ("game feel / juice")**:

- Movement is fast and tight — acceleration-based, momentum on slides, snappy crouch.
- Weapons have weight: ADS that tightens spread, per-weapon recoil patterns,
  chunky muzzle flashes, shell ejection, screen shake, audible reload stages.
- Hits are *loud and visible*: hitmarkers, headshot pings, blood puffs, impact
  decals, directional damage indicators, kill confirms.
- The world reacts: dynamic muzzle lights, sparks, alarm strobes, tracer rounds.

If it doesn't feel good to fire the rifle while strafing, nothing else matters.

## 3. Feature List

### Movement
- Walk / sprint / crouch / crouch-slide / jump / lean (Q/E) / mantle-free design
- Acceleration + friction model, air control, slide with momentum decay
- Head-bob, view-tilt on strafe, landing impact, breathing sway

### Gunplay
- 6 weapons: Assault Rifle, SMG, Shotgun, Sniper, Pistol, Frag Grenade
- Per-weapon: damage, fire rate, mag size, reserve ammo, recoil pattern, spread,
  ADS zoom, reload time, distinct procedural sound
- Hitscan with falloff + pellet spread (shotgun) + projectile (grenade)
- Headshot / limb damage multipliers, penetration-free simple model
- Recoil as a deterministic-with-jitter pattern that recovers over time
- Reserve/mag ammo management, auto-reload on empty, weapon switch with timing

### Enemies & AI
- Finite-state AI: IDLE → PATROL → ALERT → COMBAT → SEEK-COVER → FLANK → DEAD
- Line-of-sight + hearing, suppression, strafing, cover usage, flanking
- 3 enemy archetypes: Rifleman, Rusher (fast, shotgun), Heavy (tanky, slow)
- Difficulty scales by wave (health, accuracy, count, aggression)
- Ragdoll-lite death (tumble + fade), hit reactions, blood

### Modes & Progression
- **SURVIVAL** — endless escalating waves, score, combo multiplier, between-wave
  buy/upgrade phase. Primary mode, fully playable start-to-finish (to death).
- **OPERATION** — objective mode: reach & hold capture points across the level,
  finite enemy budget, win condition = all objectives secured.
- XP + level, score multipliers, per-run weapon unlock pickups, armor pickups.

### Level & World
- One handcrafted compound: courtyard, warehouse, gantry/catwalks, server room,
  perimeter wall, containers — designed for sightlines, cover, flanking lanes.
- Procedural skybox gradient + stars, volumetric-ish fog, dynamic alarm lighting,
  sodium lamps, emissive signage, crates/barrels/props.

### UI / UX
- Animated main menu, mode select, settings (sensitivity, FOV, volume, quality,
  invert-Y, control hints), pause menu, HUD (health, armor, ammo, weapon,
  minimap/compass, objective, wave, score, combo), damage vignette, hitmarkers,
  kill feed, results/game-over screen with stats, accessibility toggles.

### Audio (all procedural via WebAudio)
- Per-weapon gunshots, reload clicks, shell drops, enemy fire, hit/headshot pings,
  footsteps, alarm klaxon, ambient hum, UI clicks, wave-start stinger, music bed.

## 4. Technical Architecture

**Stack:** Three.js (rendering) + Vite (bundler/dev server) + WebAudio (sound).
Pure ESM, no framework. Runs in any modern browser with `npm install && npm run dev`.

**Why a custom kinematic controller instead of Rapier/Cannon:**
A full rigid-body physics engine is overkill and actively *worse* for crisp FPS
feel — penetration solvers and substep jitter fight against deterministic,
responsive movement. We implement a swept-AABB kinematic controller against a
static set of collision boxes. This gives frame-perfect, tunable movement with
zero physics-engine weight, smaller bundle, and no async WASM init. Projectiles
and hit detection use Three.js raycasting. This is the right tradeoff for an
arcade-military shooter and is documented as a deliberate choice.

**Modules (`src/`):**
- `main.js` — bootstrap, renderer, game-state machine, fixed-step update loop
- `engine.js` — renderer/scene/camera setup, post fx, resize, render stats
- `input.js` — pointer lock, keyboard/mouse, remappable bindings, settings
- `player.js` — character controller, camera rig, head-bob, stamina, health/armor
- `weapons.js` — weapon defs, firing, recoil, reload, viewmodel, projectiles
- `enemies.js` — AI state machines, spawning, navigation, archetypes
- `world.js` — level geometry, collision boxes, lights, props, skybox, nav points
- `effects.js` — particles, tracers, muzzle flash, decals, screen shake, ragdoll
- `audio.js` — procedural synth sound bank + music + mixer
- `hud.js` / `ui.js` — DOM HUD + menus + settings + results
- `game.js` — mode logic (survival waves, operation objectives), scoring, director
- `util.js` — math, RNG, pools, easing

**Performance:** object pooling for bullets/particles/decals, capped lights,
instanced/merged static geometry where possible, shadow map only on key lights,
frustum culling, fixed-timestep simulation decoupled from render.

## 5. Milestone Roadmap

- **M0 Plan** — this document, scaffolding. ✅
- **M1 Core loop** — controller, look, one rifle, shooting, dummy enemy. Tight feel.
- **M2 Combat depth** — all weapons, damage zones, ammo, health regen, hit feedback.
- **M3 AI** — full enemy FSM, archetypes, cover/flank, spawning, scaling.
- **M4 Modes** — Survival waves + Operation objectives, scoring/XP, win/lose.
- **M5 World** — full level art pass, lighting, skybox, props, atmosphere.
- **M6 Juice** — particles, decals, shake, ragdoll, full audio, complete UI.
- **M7 QA** — perf, stability, edge cases, self-playtest, bug fixing.
- **M8 Ship** — build, README, report.

## 6. Definition of "Done"

- Launches with `npm install && npm run dev` — no console errors.
- Controls feel tight; gunplay is satisfying (ADS, recoil, feedback all present).
- Enemies are challenging and behave believably (detect, shoot, take cover, flank).
- At least one mode (Survival) is fully playable start-to-finish (to game over)
  with a results screen; Operation provides a second win-condition mode.
- Visuals and audio are cohesive and polished; the level looks striking.
- A new player can read the HUD, learn the controls, and have fun in under a minute.
- Stable frame rate on a typical laptop; handles death/restart/mode-switch cleanly.

## 7. Controls (default)

- **WASD** move · **Shift** sprint · **Ctrl/C** crouch (slide while sprinting)
- **Space** jump · **Q/E** lean · **Mouse** look · **LMB** fire · **RMB** ADS
- **R** reload · **1–4 / wheel** switch weapon · **G** grenade · **F** interact/buy
- **Esc** pause · **Tab** scoreboard/stats · **M** toggle mute
