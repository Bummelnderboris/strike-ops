# STRIKE OPS — 2-Player Local Deathmatch

A lightweight, Call-of-Duty-style top-down shooter for **two players on one keyboard**.
Zero dependencies, no build step.

## Play

Open `index.html` in any modern browser (double-click it, or run a local server):

```bash
# either just open the file:
open index.html
# or serve it:
python3 -m http.server 8000   # then visit http://localhost:8000
```

Pick a kill target, hit **START MATCH**.

## Controls

| Action | Player 1 | Player 2 |
|--------|----------|----------|
| Move   | `W A S D` | Arrow keys |
| Shoot  | `Space`  | `.` (period) |
| Reload | `R`      | `,` (comma) |
| Dash   | `Left Shift` | `/` (slash) |
| Pause  | `P` (either) | |

Players aim in the direction they're moving (twin-stick feel on one keyboard).

## Features

- **Cover-based arena** — central bunker, pillars, side walls, and crates to fight around.
- **4 weapons** — Pistol (default), SMG, Shotgun, Rifle, each with its own damage, fire rate, magazine, reload time, spread and knockback.
- **Pickups** — weapon crates (random SMG/Shotgun/Rifle) and med-kits, which respawn on a timer.
- **Combat systems** — reloading (with ring indicator + auto-reload on empty), dash with cooldown, knockback, recoil, spawn protection, respawns at the spawn farthest from enemies.
- **Juice** — muzzle flashes, blood/spark/debris particles, screen shake, synthesized sound effects (WebAudio, no asset files), floating "ELIMINATED" / pickup text.
- **Match flow** — live scoreboard, configurable kills-to-win, win screen with K/D stats, rematch.

## Files

- `index.html` — page, menu, and win overlays
- `style.css` — UI styling
- `game.js` — the whole engine (input, physics, weapons, rendering, audio, match loop)

## Tech notes

- Fixed-timestep simulation (120 Hz) with an accumulator, decoupled from render — consistent feel regardless of frame rate.
- Circle-vs-rect collision resolution for players/walls; sub-stepped bullets to prevent tunneling through thin cover.
