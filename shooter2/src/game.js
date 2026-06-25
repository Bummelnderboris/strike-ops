// Game orchestrator: owns all systems, the state machine, both game modes
// (Survival waves & Operation objectives), scoring/XP/credits/shop, the combat
// interface that wires weapons to enemies, and per-frame update routing.
import * as THREE from 'three';
import { clamp, lerp, damp, rand, randInt } from './util.js';
import { audio } from './audio.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { EnemyManager, ARCHETYPES } from './enemies.js';
import { WeaponSystem, WEAPONS } from './weapons.js';
import { HUD } from './hud.js';
import { Menus } from './menus.js';

const GS = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', BUY: 'buy', RESULTS: 'results' };

export class Game {
  constructor(engine, input) {
    this.engine = engine;
    this.input = input;
    this.scene = engine.scene;
    this.state = GS.MENU;
    this.mode = null;
    this.uiRoot = document.getElementById('ui-root');

    // World + systems
    this.world = new World(this.scene);
    this.effects = new Effects(this.scene);
    this.player = new Player(engine, input, this.world);
    this.enemies = new EnemyManager(this.scene, this.world, this.player, this.effects, engine.camera);

    // Combat interface bridging weapons -> enemies + scoring/feedback.
    this._pendingPelletHit = 0;
    const combat = {
      colliders: this.world.colliders,
      resolveHit: (origin, dir, range, falloff, damage, headMult, tracerColor) => {
        const r = this.enemies.resolveHit(origin, dir, range, falloff, damage, headMult, tracerColor);
        if (r && r.enemy) {
          this._pendingPelletHit++;
          if (r.headshot) this.stats.headshots++;
          this.hud.hitmark(r.headshot, r.killed);
          this.hud.damageNumber(r.damage, r.headshot);
          audio.hitmarker(r.headshot);
        }
        return r;
      },
      explode: (pos, radius, dmg) => this.enemies.explode(pos, radius, dmg),
      onShotFired: (origin, fwd, def) => {
        this.stats.shots++;
        if (this._pendingPelletHit > 0) this.stats.hits++;
        this._pendingPelletHit = 0;
        this.enemies.onShotFired(origin, fwd, def);
      },
    };
    this.weapons = new WeaponSystem(engine, this.player, this.effects, combat);
    this.enemies.onKillCb = (e) => this._onKill(e);

    this.hud = new HUD(this.uiRoot, this);
    this.menus = new Menus(this.uiRoot, this);

    this._resetRunState();
    this.applySettings();
  }

  _resetRunState() {
    this.score = 0;
    this.credits = 0;
    this.xp = 0;
    this.level = 1;
    this.wave = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.bestCombo = 1;
    this.runTime = 0;
    this.alarmActive = false;
    this.stats = { score: 0, kills: 0, headshots: 0, shots: 0, hits: 0, time: 0, wave: 0, bestCombo: 1, level: 1 };
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._waveActive = false;
    this._betweenWaves = false;
    this.objectives = [];
    this.boss = null;
    this.upgrades = { health: 0, regen: 0, speed: 0, ammo: 0 };
    this._clearPickups();
  }

  get modeName() { return this.mode === 'survival' ? 'SURVIVAL' : 'OPERATION'; }

  applySettings() {
    const st = this.input.settings;
    audio.setMaster(st.masterVol); audio.setSfx(st.sfxVol); audio.setMusic(st.musicVol);
    this.engine.setFov(st.fov);
    this.engine.setQuality(st.quality);
  }

  // ---------------- State transitions ----------------
  startMode(mode) {
    audio.init();
    this.mode = mode;
    this._resetRunState();
    this.player.reset();
    this.weapons.resetForRun();
    this.enemies.clear();
    this.effects.clearTransient();
    // upgrade-driven player tuning
    this._applyUpgrades();

    this.state = GS.PLAYING;
    this._wasLocked = false;
    this._lockGrace = 0.5;      // ignore unlock-pause right after (re)entering play
    this.menus.clear();
    this.hud.show();
    audio.startMusic(0.2);

    if (mode === 'survival') this._startSurvival();
    else this._startOperation();

    this._requestLock();
  }

  _requestLock() {
    // Pointer lock must be requested during the user gesture (the menu/button
    // click), so call it directly. A canvas click handler re-locks as fallback.
    this.input.requestLock();
  }

  pause() {
    if (this.state !== GS.PLAYING) return;
    this.state = GS.PAUSED;
    this.input.exitLock();
    this.menus.showPause();
    audio.setIntensity(0.05);
  }
  resume() {
    this.state = GS.PLAYING;
    this._wasLocked = false;
    this._lockGrace = 0.5;
    this.menus.clear();
    this._requestLock();
  }
  restart() {
    this.menus.clear();
    this.startMode(this.mode);
  }
  quitToMenu() {
    this.state = GS.MENU;
    this.input.exitLock();
    this.enemies.clear();
    this.effects.clearTransient();
    this.hud.hide();
    audio.stopMusic();
    this.menus.showMain();
  }

  _gameOver(victory) {
    if (this.state === GS.RESULTS) return;
    this.state = GS.RESULTS;
    this.input.exitLock();
    this.stats.score = this.score;
    this.stats.time = this.runTime;
    this.stats.wave = this.wave;
    this.stats.bestCombo = this.bestCombo;
    this.stats.level = this.level;
    audio.stopMusic();
    audio.waveStinger(victory);
    setTimeout(() => this.menus.showResults(this.stats, victory), victory ? 800 : 1400);
  }

  // ---------------- SURVIVAL MODE ----------------
  _startSurvival() {
    this.wave = 0;
    this.hud.banner_('SURVIVAL', 'HOLD THE LINE', 2.2);
    this._nextWave();
  }

  _nextWave() {
    this.wave++;
    this.stats.wave = this.wave;
    this._betweenWaves = false;
    this._waveActive = true;
    this.alarmActive = true;

    // Difficulty scaling.
    const w = this.wave;
    this.enemies.setDifficulty({
      healthMul: 1 + w * 0.12,
      accuracyMul: clamp(0.7 + w * 0.04, 0.7, 1.25),
      fireRateMul: clamp(1 + w * 0.05, 1, 2),
      reactionTime: clamp(0.6 - w * 0.03, 0.18, 0.6),
    });
    audio.setIntensity(clamp(0.25 + w * 0.06, 0, 1));

    // Compose the wave roster.
    const isBossWave = w % 5 === 0;
    const count = Math.min(6 + Math.floor(w * 1.8), 26);
    const roster = [];
    for (let i = 0; i < count; i++) {
      let type = 'rifleman';
      const roll = Math.random();
      if (w >= 3 && roll < 0.25 + w * 0.01) type = 'rusher';
      if (w >= 4 && roll > 0.85) type = 'heavy';
      if (w >= 5 && roll > 0.78 && roll < 0.86) type = 'sniper';
      if (w >= 8 && roll > 0.7) type = Math.random() > 0.5 ? 'heavy' : 'rusher';
      roster.push(type);
    }
    // Boss every 5th wave: a TITAN leads the assault.
    this.boss = null;
    if (isBossWave) roster.unshift('titan');
    // Spawn pacing: trickle them in so it never dumps all at once.
    this._spawnQueue = roster;
    this._spawnTimer = 1.0;
    this._maxConcurrent = Math.min(6 + Math.floor(w * 0.8), 16);

    audio.waveStinger(true);
    audio.alarm();
    this.hud.banner_(`WAVE ${this.wave}`, `${count} HOSTILES INBOUND`, 2);
  }

  _updateSurvival(dt) {
    // Trickle spawns.
    if (this._spawnQueue.length > 0) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0 && this.enemies.alive < this._maxConcurrent) {
        const type = this._spawnQueue.shift();
        this._spawnEnemy(type);
        this._spawnTimer = rand(0.4, 1.1);
      }
    }
    // Wave clear?
    if (this._waveActive && this._spawnQueue.length === 0 && this.enemies.alive === 0) {
      this._waveActive = false;
      this.alarmActive = false;
      this._endWaveToShop();
    }
  }

  _endWaveToShop() {
    // Wave-clear bonus.
    const bonus = 250 + this.wave * 100;
    this.credits += bonus;
    this.score += bonus;
    this.hud.banner_('WAVE CLEAR', `+${bonus} CR BONUS`, 1.8);
    audio.waveStinger(true);
    this.state = GS.BUY;
    this.input.exitLock();
    audio.setIntensity(0.05);
    setTimeout(() => {
      if (this.state === GS.BUY) this.menus.showBuy(() => this._closeShop());
    }, 900);
  }

  _closeShop() {
    this.menus.clear();
    this.state = GS.PLAYING;
    this._wasLocked = false;
    this._lockGrace = 0.5;
    this._requestLock();
    this._nextWave();
  }

  // ---------------- OPERATION MODE ----------------
  _startOperation() {
    this.wave = 1;
    this.enemies.setDifficulty({ healthMul: 1.1, accuracyMul: 0.9, fireRateMul: 1.1, reactionTime: 0.4 });
    audio.setIntensity(0.4);
    // Choose 3 capture sectors.
    const pts = this.world.objectivePoints.slice();
    this.objectives = [];
    const chosen = [];
    for (let i = 0; i < 3 && pts.length; i++) {
      const idx = randInt(0, pts.length - 1);
      chosen.push(pts.splice(idx, 1)[0]);
    }
    for (const p of chosen) {
      this.objectives.push({ pos: p.pos.clone(), radius: p.radius, name: p.name, progress: 0, captured: false });
    }
    this.alarmActive = true;
    this.hud.banner_('OPERATION', 'SECURE ALL SECTORS', 2.4);
    // initial garrison + steady reinforcement
    this._opReinforceTimer = 2;
    for (let i = 0; i < 8; i++) this._spawnEnemy(i % 4 === 0 ? 'heavy' : (i % 3 === 0 ? 'rusher' : 'rifleman'));
  }

  _updateOperation(dt) {
    // Reinforcements while objectives remain.
    const remaining = this.objectives.filter((o) => !o.captured).length;
    if (remaining > 0) {
      this._opReinforceTimer -= dt;
      if (this._opReinforceTimer <= 0 && this.enemies.alive < 14) {
        const type = Math.random() < 0.2 ? 'heavy' : (Math.random() < 0.4 ? 'rusher' : 'rifleman');
        this._spawnEnemy(type);
        this._opReinforceTimer = rand(2.5, 4.5);
      }
    }

    // Capture logic: stand in a sector with no live enemies inside to fill it.
    const p = this.player.pos;
    let active = null;
    for (const o of this.objectives) {
      if (o.captured) continue;
      const d = Math.hypot(p.x - o.pos.x, p.z - o.pos.z);
      const inside = d < o.radius;
      const contested = this.enemies.enemies.some((e) => !e.dead && Math.hypot(e.pos.x - o.pos.x, e.pos.z - o.pos.z) < o.radius);
      if (inside && !contested) {
        o.progress = clamp(o.progress + dt / 6, 0, 1);
        active = o;
        if (o.progress >= 1 && !o.captured) {
          o.captured = true;
          const bonus = 1000;
          this.score += bonus; this.credits += 500;
          audio.pickup();
          this.hud.banner_('SECTOR SECURED', o.name, 1.8);
          this.hud.flashScreen(0.3);
        }
      } else if (inside && contested) {
        active = o;
      } else {
        o.progress = clamp(o.progress - dt / 12, 0, 1);
      }
    }
    this._activeObjective = active;

    // Win condition.
    if (this.objectives.every((o) => o.captured)) {
      this.alarmActive = false;
      this._gameOver(true);
    }
  }

  _spawnEnemy(type) {
    const spawns = this.world.spawnPoints;
    if (!spawns.length) return;
    // Prefer spawns away from the player, with a line that's not on screen.
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      const sp = spawns[randInt(0, spawns.length - 1)];
      const d = Math.hypot(sp.x - this.player.pos.x, sp.z - this.player.pos.z);
      const score = d + rand(0, 8);
      if (score > bestScore && d > 16) { bestScore = score; best = sp; }
    }
    best = best || spawns[randInt(0, spawns.length - 1)];
    const e = this.enemies.spawn(type, new THREE.Vector3(best.x, 0, best.z));
    if (type === 'titan') { this.boss = e; this.hud.banner_('⚠ TITAN INBOUND', 'ELITE TARGET', 2.2); audio.alarm(); }
    return e;
  }

  // ---------------- Scoring / progression ----------------
  _spawnPickup(pos) {
    // Weighted drop table — health is rarer than ammo.
    const roll = Math.random();
    let type;
    if (roll < 0.5) type = 'ammo';
    else if (roll < 0.78) type = 'armor';
    else type = 'health';
    const colors = { ammo: 0xffcf4b, armor: 0x4bd2ff, health: 0x6cf06c };
    const geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const mat = new THREE.MeshStandardMaterial({ color: colors[type], emissive: colors[type], emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, 0.6, pos.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const light = new THREE.PointLight(colors[type], 0.6, 4, 2);
    light.position.copy(mesh.position);
    this.scene.add(light);
    this.pickups.push({ mesh, light, type, bob: Math.random() * 6.28, life: 22 });
  }

  _updatePickups(dt) {
    if (!this.pickups) return;
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      pk.bob += dt * 2;
      pk.mesh.position.y = 0.55 + Math.sin(pk.bob) * 0.12;
      pk.mesh.rotation.y += dt * 2;
      pk.light.position.y = pk.mesh.position.y;
      const d = Math.hypot(p.pos.x - pk.mesh.position.x, p.pos.z - pk.mesh.position.z);
      const expiring = pk.life < 4;
      if (expiring) pk.mesh.visible = Math.floor(pk.life * 6) % 2 === 0;
      if (d < 1.4 && !p.dead) {
        let took = true;
        if (pk.type === 'ammo') { for (const k of Object.keys(WEAPONS)) this.weapons.refillReserve(k, Math.round(WEAPONS[k].reserve * 0.3)); this.hud.banner_('AMMO', '', 0.8); }
        else if (pk.type === 'armor') { if (p.armor >= p.maxArmor) took = false; else p.addArmor(40); }
        else if (pk.type === 'health') { if (p.health >= p.maxHealth) took = false; else p.heal(40); }
        if (took) { audio.pickup(); this._removePickup(i); continue; }
      }
      if (pk.life <= 0) this._removePickup(i);
    }
  }

  _removePickup(i) {
    const pk = this.pickups[i];
    this.scene.remove(pk.mesh); this.scene.remove(pk.light);
    pk.mesh.geometry.dispose(); pk.mesh.material.dispose();
    this.pickups.splice(i, 1);
  }

  _clearPickups() {
    if (this.pickups) for (let i = this.pickups.length - 1; i >= 0; i--) this._removePickup(i);
    this.pickups = [];
  }

  _onKill(enemy) {
    const base = enemy.def.scoreVal;
    // chance to drop a pickup (heavies always drop something useful)
    if (Math.random() < (enemy.type === 'heavy' ? 1 : 0.28)) this._spawnPickup(enemy.pos);
    const pts = Math.round(base * this.combo);
    this.score += pts;
    this.credits += Math.round(base * 0.6);
    this.stats.kills++;
    this.xp += base;
    // combo
    this.combo = clamp(this.combo + 1, 1, 12);
    this.comboTimer = 4;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    // level up
    const need = this.level * 1000;
    if (this.xp >= need) { this.xp -= need; this.level++; this.hud.banner_('RANK UP', `LEVEL ${this.level}`, 1.4); audio.waveStinger(true); }
    // kill feed
    this.hud.killFeed(enemy.def.name, enemy._lastWasHead);
  }

  // ---------------- Shop ----------------
  getShopItems() {
    const w = this.weapons;
    const items = [];
    const weaponShop = [
      { id: 'smg', name: WEAPONS.smg.name, cost: 1200, desc: 'High RPM · close range' },
      { id: 'shotgun', name: WEAPONS.shotgun.name, cost: 1500, desc: 'Devastating up close' },
      { id: 'sniper', name: WEAPONS.sniper.name, cost: 2200, desc: 'One-shot headshots' },
    ];
    for (const ws of weaponShop) items.push({ ...ws, owned: w.owned.includes(ws.id) });
    items.push({ id: 'ammo', name: 'AMMO RESUPPLY', cost: 400, desc: 'Refill all reserves', owned: false });
    items.push({ id: 'armor', name: 'ARMOR PLATES', cost: 600, desc: 'Restore 100 armor', owned: this.player.armor >= 90 });
    items.push({ id: 'grenades', name: 'FRAG ×3', cost: 500, desc: 'Restock grenades', owned: this.weapons.grenades >= 6 });
    items.push({ id: 'up_health', name: `MAX HEALTH +25 (Lv${this.upgrades.health + 1})`, cost: 800 + this.upgrades.health * 400, desc: 'Permanent this run', owned: this.upgrades.health >= 4 });
    items.push({ id: 'up_regen', name: `FAST REGEN (Lv${this.upgrades.regen + 1})`, cost: 700 + this.upgrades.regen * 350, desc: 'Heal sooner & faster', owned: this.upgrades.regen >= 3 });
    items.push({ id: 'up_speed', name: `MOBILITY (Lv${this.upgrades.speed + 1})`, cost: 700 + this.upgrades.speed * 350, desc: 'Move & sprint faster', owned: this.upgrades.speed >= 3 });
    return items;
  }

  buy(id) {
    const items = this.getShopItems();
    const it = items.find((i) => i.id === id);
    if (!it || it.owned || this.credits < it.cost) return false;
    this.credits -= it.cost;
    if (['smg', 'shotgun', 'sniper'].includes(id)) { this.weapons.giveWeapon(id); }
    else if (id === 'ammo') { for (const k of Object.keys(WEAPONS)) this.weapons.refillReserve(k, WEAPONS[k].reserve); }
    else if (id === 'armor') this.player.addArmor(100);
    else if (id === 'grenades') this.weapons.addGrenades(3);
    else if (id === 'up_health') { this.upgrades.health++; this._applyUpgrades(); this.player.health = this.player.maxHealth; }
    else if (id === 'up_regen') { this.upgrades.regen++; this._applyUpgrades(); }
    else if (id === 'up_speed') { this.upgrades.speed++; this._applyUpgrades(); }
    return true;
  }

  _applyUpgrades() {
    this.player.maxHealth = 100 + this.upgrades.health * 25;
    this.player.regenDelay = 4.5 - this.upgrades.regen * 1.0;
    this.player.regenRate = 22 + this.upgrades.regen * 14;
    this.player.speedMul = 1 + this.upgrades.speed * 0.08;
  }

  // ---------------- Per-frame update ----------------
  update(dt) {
    // Always update visual fx so the world feels alive in menus too.
    this.world.update(dt, this.alarmActive && this.state === GS.PLAYING);

    if (this.state === GS.PLAYING) {
      this.runTime += dt;
      this.player.update(dt, false);

      // Health regen.
      const p = this.player;
      if (!p.dead && p.time - p.lastDamageTime > p.regenDelay && p.health < p.maxHealth) {
        p.heal(p.regenRate * dt);
      }
      // combo decay
      if (this.combo > 1) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 1; }

      this.weapons.update(dt, this.input, false);
      this.enemies.update(dt);
      this.effects.update(dt);
      this._updatePickups(dt);

      if (this.mode === 'survival') this._updateSurvival(dt);
      else this._updateOperation(dt);

      // death
      if (p.dead && this.state === GS.PLAYING) {
        audio.setIntensity(0);
        this._gameOver(false);
      }

      // Pause input. The unlock-triggered pause is gated by a short grace period
      // so it can't fire spuriously while pointer lock is still being acquired.
      if (this._lockGrace > 0) this._lockGrace -= dt;
      const unlockedMidPlay = !this.input.locked && this._wasLocked && this._lockGrace <= 0;
      if (this.input.actionPressed('pause') || unlockedMidPlay) {
        this.pause();
      }
      this._wasLocked = this.input.locked;

      // mute toggle
      if (this.input.actionPressed('mute')) { audio.setMute(!audio.muted); }

      this._updateHUD(dt);
      // vignette from recent damage
      const sinceHit = p.time - p.lastDamageTime;
      this.hud.setVignette(clamp((1 - sinceHit) * 0.5, 0, 0.5) * (p.dead ? 1.6 : 1));
    } else {
      // keep effects ticking subtly
      this.effects.update(dt);
      if (this.state === GS.PAUSED || this.state === GS.BUY) {
        // allow resume via Esc/return handled by menu buttons; Esc resumes pause
        if (this.state === GS.PAUSED && this.input.actionPressed('pause')) this.resume();
      }
    }
  }

  _updateHUD(dt) {
    const p = this.player, w = this.weapons;
    const def = w.def, st = w.state;
    let waveText = '';
    let objective = '', objectiveProg = '';
    let objMarker = [];
    if (this.mode === 'survival') {
      waveText = `WAVE <b>${this.wave}</b> · ${this.enemies.alive} LEFT`;
      objective = this._waveActive ? `Eliminate all hostiles` : 'Prepare for next wave';
      objectiveProg = `Score multiplier ×${this.combo}`;
    } else {
      const capped = this.objectives.filter((o) => o.captured).length;
      waveText = `OPERATION · ${capped}/${this.objectives.length} SECTORS`;
      const act = this._activeObjective;
      objective = act ? `Secure: ${act.name}` : 'Move to a marked sector';
      if (act) objectiveProg = `Capture ${Math.round(act.progress * 100)}%`;
      objMarker = this.objectives.filter((o) => !o.captured).map((o) => ({ pos: o.pos, r: o.radius, color: o === this._activeObjective ? '#6cf06c' : '#4bd2ff' }));
    }

    // crosshair spread estimate
    const moving = Math.hypot(p.vel.x, p.vel.z) > 1.5;
    let spread = lerp(def.spread, def.adsSpread, w.ads);
    if (moving) spread *= 1.8;
    spread *= (1 + w.spreadHeat * 0.5);

    this.hud.update(dt, {
      health: p.health, maxHealth: p.maxHealth, armor: p.armor, maxArmor: p.maxArmor, stamina: p.stamina,
      mag: st.mag, reserve: st.reserve, weaponName: def.name, grenades: w.grenades,
      score: this.score, waveText, combo: this.combo,
      objective, objectiveProg, objMarker,
      crosshairSpread: spread, scoped: def.scoped, ads: w.ads,
      boss: this.boss ? { alive: !this.boss.dead, hp: this.boss.health, maxHp: this.boss.maxHealth, name: this.boss.def.name } : null,
      yaw: p.yaw, px: p.pos.x, pz: p.pos.z,
      colliders: this.world.colliders,
      enemies: this.enemies.enemies.filter((e) => !e.dead).map((e) => ({ x: e.pos.x, z: e.pos.z, alert: e.alertLevel > 0.5 })),
    });
  }
}
