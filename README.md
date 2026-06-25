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

| Action  | Player 1 | Player 2 | Gamepad |
|---------|----------|----------|---------|
| Move    | `W A S D` | Arrow keys | Left stick |
| Aim/Shoot | `Space` (aim = move dir) | `.` (period) | Right stick / `RT` |
| Reload  | `R`      | `,` (comma) | `X` |
| Dash    | `Left Shift` | `/` (slash) | `A` / `LT` |
| Grenade | `Q`      | `Right Shift` | `RB` |
| Pause   | `P` (either) | | |

On keyboard you aim in the direction you're moving. Plug in **gamepads** (auto-detected, one per player) for true twin-stick aiming.

## Features

- **3 maps** — Bunker, Crossfire, Quarters (or Random), each with its own cover, spawns and pickup layout.
- **Two game modes** — Deathmatch (first to the kill target) and Gun Game (every kill advances your weapon; clear all tiers to win).
- **6 weapons** — Pistol, SMG, Shotgun, Rifle, Sniper (laser tracer), Minigun (spin-up), each tuned for damage / fire rate / magazine / spread / knockback.
- **Grenades** — cooked fuse, bounce off walls, area damage + knockback; regenerate over time.
- **Destructible cover** — wooden crates break apart, and explosive barrels chain-react.
- **Power-ups** — armor/overshield, damage berserk (×1.6), speed boost; plus med-kits and weapon crates. All respawn on a timer.
- **Killstreaks** — announcer + kill feed ("First Blood", "Double Kill", "Rampage"…), with bonus armor every 3-kill streak.
- **CPU opponent** — set Player 2 to a bot (Easy / Normal / Insane) for solo play: it leads its aim, uses cover, dodges fire, and throws grenades.
- **Combat systems** — reloading (ring indicator + auto-reload on empty), dash with cooldown, knockback, recoil, spawn protection, farthest-spawn respawns.
- **Juice** — vignette lighting, damage flash, muzzle flashes, blood/spark/debris/smoke particles, screen shake, floating damage numbers, a 3·2·1 countdown, and a full WebAudio synth soundtrack (no asset files).
- **Match flow** — live scoreboard, configurable kills-to-win, win screen with K/D stats, rematch.

## Files

- `index.html` — page, menu, and win overlays
- `style.css` — UI styling
- `game.js` — the whole engine (input, physics, weapons, rendering, audio, match loop)

## Tech notes

- Fixed-timestep simulation (120 Hz) with an accumulator, decoupled from render — consistent feel regardless of frame rate.
- Circle-vs-rect collision resolution for players/walls; sub-stepped bullets to prevent tunneling through thin cover.
