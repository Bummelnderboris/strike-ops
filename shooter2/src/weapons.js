// Weapon definitions, firing, recoil patterns, reload, ADS, viewmodels, and the
// grenade projectile. Hit resolution is delegated to a `combat` interface
// provided by the game (so weapons stay decoupled from enemy internals).
import * as THREE from 'three';
import { clamp, lerp, damp, rand, makeRNG, deg } from './util.js';
import { audio } from './audio.js';

// ---- Weapon catalogue. Stats are tuned for arcade-military feel. ----
export const WEAPONS = {
  rifle: {
    name: 'VK-7 RIFLE', short: 'RIFLE', slot: 1, auto: true,
    damage: 24, headMult: 2.1, rpm: 620, mag: 30, reserve: 150, reloadTime: 2.1,
    spread: 0.012, adsSpread: 0.003, moveSpreadMul: 2.4, range: 200, falloff: [40, 110],
    recoil: { pitch: 0.012, yaw: 0.006, kick: 0.9, recover: 9 }, pattern: 'rising',
    adsFov: 58, zoom: 1.0, pellets: 1, switchTime: 0.5,
    sound: { body: 150, crackHz: 1900, dur: 0.18, level: 0.85, q: 0.8 },
    color: 0x2c2f33, tracerColor: 0xfff0a0,
  },
  smg: {
    name: 'WR-9 SMG', short: 'SMG', slot: 2, auto: true,
    damage: 17, headMult: 1.8, rpm: 900, mag: 36, reserve: 200, reloadTime: 1.8,
    spread: 0.02, adsSpread: 0.008, moveSpreadMul: 1.8, range: 120, falloff: [22, 60],
    recoil: { pitch: 0.009, yaw: 0.009, kick: 0.6, recover: 11 }, pattern: 'random',
    adsFov: 64, zoom: 1.0, pellets: 1, switchTime: 0.4,
    sound: { body: 130, crackHz: 1600, dur: 0.12, level: 0.7, q: 0.7 },
    color: 0x35383d, tracerColor: 0xffe080,
  },
  shotgun: {
    name: 'M3 BREACHER', short: 'SHOTGUN', slot: 3, auto: false,
    damage: 13, headMult: 1.5, rpm: 95, mag: 7, reserve: 56, reloadTime: 0.55, shellReload: true,
    spread: 0.075, adsSpread: 0.05, moveSpreadMul: 1.3, range: 45, falloff: [8, 26],
    recoil: { pitch: 0.04, yaw: 0.01, kick: 2.4, recover: 7 }, pattern: 'random',
    adsFov: 70, zoom: 1.0, pellets: 9, switchTime: 0.55,
    sound: { body: 90, crackHz: 1100, dur: 0.28, level: 1.0, q: 0.6 },
    color: 0x3a2f28, tracerColor: 0xffd070,
  },
  sniper: {
    name: 'LR-50 MARKSMAN', short: 'SNIPER', slot: 4, auto: false,
    damage: 95, headMult: 2.6, rpm: 50, mag: 5, reserve: 30, reloadTime: 2.6,
    spread: 0.03, adsSpread: 0.0006, moveSpreadMul: 3.5, range: 300, falloff: [120, 260],
    recoil: { pitch: 0.06, yaw: 0.01, kick: 3.2, recover: 6 }, pattern: 'rising',
    adsFov: 26, zoom: 2.4, pellets: 1, switchTime: 0.7, scoped: true,
    sound: { body: 70, crackHz: 2300, dur: 0.34, level: 1.0, q: 0.9 },
    color: 0x23262b, tracerColor: 0xa0e0ff,
  },
  pistol: {
    name: 'P-11 SIDEARM', short: 'PISTOL', slot: 5, auto: false,
    damage: 28, headMult: 2.0, rpm: 320, mag: 12, reserve: 96, reloadTime: 1.4,
    spread: 0.016, adsSpread: 0.005, moveSpreadMul: 1.6, range: 90, falloff: [18, 50],
    recoil: { pitch: 0.02, yaw: 0.008, kick: 1.1, recover: 12 }, pattern: 'random',
    adsFov: 66, zoom: 1.0, pellets: 1, switchTime: 0.3,
    sound: { body: 120, crackHz: 1700, dur: 0.14, level: 0.7, q: 0.8 },
    color: 0x2a2d31, tracerColor: 0xffe0a0,
  },
};

export const GRENADE = {
  name: 'FRAG', fuse: 1.5, radius: 7, damage: 130, throwForce: 16, count: 3,
};

class Viewmodel {
  constructor(weaponKey, def) {
    this.key = weaponKey;
    this.def = def;
    this.group = new THREE.Group();
    this._build();
    this.muzzle = new THREE.Object3D();
    this._muzzlePos.add(this.muzzle);
  }

  _mat(color, metal = 0.6, rough = 0.5, emissive = 0) {
    return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive });
  }

  _part(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  _build() {
    const def = this.def;
    const body = this._mat(def.color, 0.6, 0.45);
    const dark = this._mat(0x16181b, 0.5, 0.6);
    const accent = this._mat(0x44494f, 0.8, 0.35);
    this._muzzlePos = new THREE.Object3D();
    this.group.add(this._muzzlePos);

    // Built from primitives; each weapon gets a distinct silhouette.
    if (this.key === 'rifle') {
      this._part(0.07, 0.07, 0.7, 0, 0, -0.35, body);          // receiver
      this._part(0.05, 0.05, 0.5, 0, 0.01, -0.75, dark);        // barrel
      this._part(0.06, 0.14, 0.12, 0, -0.12, -0.1, dark);       // grip
      this._part(0.06, 0.16, 0.08, 0, -0.16, -0.32, accent);    // mag
      this._part(0.06, 0.05, 0.18, 0, 0.06, -0.2, dark);        // optic rail
      this._muzzlePos.position.set(0, 0.01, -1.0);
    } else if (this.key === 'smg') {
      this._part(0.07, 0.08, 0.45, 0, 0, -0.25, body);
      this._part(0.045, 0.045, 0.32, 0, 0.01, -0.5, dark);
      this._part(0.06, 0.13, 0.1, 0, -0.11, -0.05, dark);
      this._part(0.05, 0.2, 0.06, 0, -0.18, -0.18, accent);
      this._muzzlePos.position.set(0, 0.01, -0.66);
    } else if (this.key === 'shotgun') {
      this._part(0.08, 0.09, 0.6, 0, 0, -0.32, body);
      this._part(0.06, 0.06, 0.55, 0, -0.02, -0.6, dark);       // pump tube
      this._part(0.07, 0.07, 0.16, 0, -0.04, -0.5, accent);     // pump
      this._part(0.07, 0.13, 0.1, 0, -0.1, -0.05, dark);
      this._muzzlePos.position.set(0, 0, -0.92);
    } else if (this.key === 'sniper') {
      this._part(0.07, 0.08, 0.85, 0, 0, -0.45, body);
      this._part(0.05, 0.05, 0.7, 0, 0.01, -0.95, dark);
      this._part(0.05, 0.05, 0.28, 0, 0.1, -0.35, dark);        // scope body
      this._part(0.09, 0.09, 0.06, 0, 0.1, -0.22, accent);      // scope lens
      this._part(0.07, 0.14, 0.12, 0, -0.12, -0.08, dark);
      this._part(0.06, 0.16, 0.08, 0, -0.16, -0.3, accent);
      this._muzzlePos.position.set(0, 0.01, -1.3);
    } else if (this.key === 'pistol') {
      this._part(0.06, 0.09, 0.32, 0, 0, -0.16, body);
      this._part(0.04, 0.04, 0.14, 0, 0.02, -0.32, dark);
      this._part(0.055, 0.16, 0.09, 0, -0.13, -0.02, dark);
      this._muzzlePos.position.set(0, 0.02, -0.4);
    }
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }
}

export class WeaponSystem {
  constructor(engine, player, effects, combat) {
    this.engine = engine;
    this.player = player;
    this.effects = effects;
    this.combat = combat;       // { resolveHit(origin,dir,range,falloff,damage,headMult), explode(pos,r,dmg), onShotFired }
    this.rng = makeRNG(12345);

    this.viewRoot = new THREE.Group();
    engine.viewCamera.add(this.viewRoot);
    engine.viewScene.add(engine.viewCamera);

    this.viewmodels = {};
    for (const key of Object.keys(WEAPONS)) {
      const vm = new Viewmodel(key, WEAPONS[key]);
      vm.group.visible = false;
      this.viewRoot.add(vm.group);
      this.viewmodels[key] = vm;
    }

    // Owned weapons + ammo state
    this.owned = ['rifle', 'pistol'];
    this.ammo = {};
    for (const key of Object.keys(WEAPONS)) {
      this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
    this.grenades = GRENADE.count;

    this.current = 'rifle';
    this.fireTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.shellsToLoad = 0;
    this.switching = 0;          // time remaining in switch
    this.pendingWeapon = null;
    this.ads = 0;                // 0..1
    this.adsTarget = 0;
    this.spreadHeat = 0;         // grows with sustained fire
    this.recoilStep = 0;
    this.viewmodelPos = new THREE.Vector3();
    this.viewmodelRot = new THREE.Vector3();
    this.swayVel = new THREE.Vector2();
    this.projectiles = [];

    this._equip(this.current, true);
  }

  get def() { return WEAPONS[this.current]; }
  get state() { return this.ammo[this.current]; }

  giveWeapon(key) {
    if (!this.owned.includes(key)) {
      this.owned.push(key);
      this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
  }
  refillReserve(key, amount) {
    const a = this.ammo[key];
    if (a) a.reserve = Math.min(WEAPONS[key].reserve, a.reserve + amount);
  }
  addGrenades(n) { this.grenades = Math.min(9, this.grenades + n); }

  resetForRun() {
    this.owned = ['rifle', 'pistol'];
    for (const key of Object.keys(WEAPONS)) {
      this.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    }
    this.grenades = GRENADE.count;
    this.reloading = false; this.switching = 0; this.ads = 0; this.adsTarget = 0;
    this._equip('rifle', true);
    for (const p of this.projectiles) this.effects.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }

  _equip(key, instant = false) {
    for (const k of Object.keys(this.viewmodels)) this.viewmodels[k].group.visible = (k === key);
    this.current = key;
    this.reloading = false;
    this.shellsToLoad = 0;
    this.recoilStep = 0;
    this.spreadHeat = 0;
    if (instant) this.switching = 0;
  }

  switchTo(key) {
    if (key === this.current || !this.owned.includes(key)) return;
    if (this.switching > 0) return;
    this.pendingWeapon = key;
    this.switching = this.def.switchTime;
    audio.reloadClick(0.8);
  }

  cycle(dir) {
    const idx = this.owned.indexOf(this.current);
    let n = (idx + dir + this.owned.length) % this.owned.length;
    this.switchTo(this.owned[n]);
  }

  startReload() {
    const a = this.state, def = this.def;
    if (this.reloading || a.mag >= def.mag || a.reserve <= 0) return;
    this.reloading = true;
    if (def.shellReload) {
      this.shellsToLoad = Math.min(def.mag - a.mag, a.reserve);
      this.reloadTimer = def.reloadTime;
      audio.reloadClick(0.7);
    } else {
      this.reloadTimer = def.reloadTime;
      audio.reloadClick(0.9);
      setTimeout(() => audio.reloadClick(1.1), def.reloadTime * 500);
    }
  }

  _finishReload() {
    const a = this.state, def = this.def;
    const need = def.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
    this.reloading = false;
  }

  canFire() {
    return !this.reloading && this.switching <= 0 && this.fireTimer <= 0 &&
           this.state.mag > 0 && !this.player.dead && !this.player.sprinting;
  }

  tryFire(held) {
    const def = this.def;
    if (this.player.sprinting) return;
    if (this.reloading || this.switching > 0) return;
    if (!def.auto && held !== 'pressed') return;
    if (this.fireTimer > 0) return;
    if (this.state.mag <= 0) {
      if (held === 'pressed') { audio.click(); this.startReload(); }
      return;
    }
    this._fire();
  }

  _fire() {
    const def = this.def;
    const a = this.state;
    a.mag--;
    this.fireTimer = 60 / def.rpm;

    // Muzzle world position.
    const cam = this.engine.camera;
    const origin = this.player.eyePos.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

    // Spread: base + movement + heat, reduced by ADS.
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 1.5;
    let spread = lerp(def.spread, def.adsSpread, this.ads);
    if (moving && !this.player.onGround) spread *= def.moveSpreadMul * 1.3;
    else if (moving) spread *= lerp(def.moveSpreadMul, 1.2, this.ads);
    if (!this.player.onGround) spread *= 1.4;
    spread *= (1 + this.spreadHeat * 0.5);
    this.spreadHeat = clamp(this.spreadHeat + 0.12, 0, 2.2);

    const pellets = def.pellets;
    for (let i = 0; i < pellets; i++) {
      const dir = forward.clone();
      const sx = (this.rng() * 2 - 1) * spread;
      const sy = (this.rng() * 2 - 1) * spread;
      // build a small offset basis
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      dir.addScaledVector(right, sx).addScaledVector(up, sy).normalize();

      const hit = this.combat.resolveHit(origin, dir, def.range, def.falloff, def.damage, def.headMult, def.tracerColor);
      const end = hit ? hit.point : origin.clone().addScaledVector(dir, def.range);
      // Tracer from muzzle-ish position.
      const muzzleStart = origin.clone().addScaledVector(forward, 0.6).addScaledVector(right, 0.15).add(new THREE.Vector3(0, -0.12, 0));
      if (i === 0 || pellets <= 3 || this.rng() > 0.5) this.effects.tracer(muzzleStart, end, def.tracerColor);
    }

    // Recoil pattern.
    this._applyRecoil();

    // Muzzle flash light at the gun.
    const flashPos = origin.clone().addScaledVector(forward, 0.7);
    this.effects.muzzleFlashLight(flashPos, 0xffcc66, 5, 0.05);

    // Sound + viewmodel kick + shake + shell eject.
    audio.gunshot(def.sound);
    audio.shell();
    this._kick = Math.min(1.2, (this._kick || 0) + def.recoil.kick * 0.5);
    this.player.shake(clamp(def.recoil.kick * 0.05, 0.03, 0.25), 0.12);
    this._muzzleFlashT = 0.04;
    this.combat.onShotFired?.(origin, forward, def);

    if (a.mag === 0) this.startReload();
  }

  _applyRecoil() {
    const r = this.def.recoil;
    const adsMul = lerp(1, 0.55, this.ads);
    let pitch = r.pitch, yaw = (this.rng() * 2 - 1) * r.yaw;
    if (this.def.pattern === 'rising') {
      // first shots climb, then drift
      const s = Math.min(this.recoilStep, 12);
      pitch = r.pitch * (1 + s * 0.06);
      yaw = (Math.sin(s * 1.3) * 0.5 + (this.rng() * 2 - 1) * 0.5) * r.yaw;
    }
    this.recoilStep++;
    this.player.addRecoil(pitch * adsMul, yaw * adsMul);
  }

  throwGrenade() {
    if (this.grenades <= 0 || this.player.dead) return;
    this.grenades--;
    const cam = this.engine.camera;
    const origin = this.player.eyePos.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const geo = new THREE.SphereGeometry(0.13, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, metalness: 0.3, roughness: 0.7, emissive: 0x331100, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(origin).addScaledVector(forward, 0.5);
    this.effects.scene.add(mesh);
    const vel = forward.clone().multiplyScalar(GRENADE.throwForce).add(new THREE.Vector3(0, 2.5, 0));
    this.projectiles.push({ mesh, vel, fuse: GRENADE.fuse, bounced: 0 });
    audio.reloadClick(0.6);
  }

  _updateProjectiles(dt) {
    const colliders = this.combat.colliders;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      p.vel.y -= 18 * dt;
      const next = p.mesh.position.clone().addScaledVector(p.vel, dt);
      // Floor bounce
      if (next.y < 0.13) { next.y = 0.13; p.vel.y = -p.vel.y * 0.45; p.vel.x *= 0.7; p.vel.z *= 0.7; p.bounced++; }
      // Simple collider bounce (AABB) — push back and reflect dominant axis.
      for (const c of colliders) {
        if (next.x > c.min.x - 0.13 && next.x < c.max.x + 0.13 &&
            next.y > c.min.y - 0.13 && next.y < c.max.y + 0.13 &&
            next.z > c.min.z - 0.13 && next.z < c.max.z + 0.13) {
          // reflect along the axis of least penetration
          const px = Math.min(next.x - (c.min.x - 0.13), (c.max.x + 0.13) - next.x);
          const pz = Math.min(next.z - (c.min.z - 0.13), (c.max.z + 0.13) - next.z);
          if (px < pz) { p.vel.x = -p.vel.x * 0.5; next.x = p.mesh.position.x; }
          else { p.vel.z = -p.vel.z * 0.5; next.z = p.mesh.position.z; }
          p.vel.multiplyScalar(0.8);
          break;
        }
      }
      p.mesh.position.copy(next);
      // blink faster near detonation
      p.mesh.material.emissiveIntensity = 0.2 + Math.abs(Math.sin(p.fuse * 20)) * (p.fuse < 0.6 ? 1.5 : 0.4);
      if (p.fuse <= 0) {
        this.effects.scene.remove(p.mesh);
        this.effects.explosion(p.mesh.position.clone());
        audio.explosion();
        this.player.shake(0.6, 0.4);
        this.combat.explode(p.mesh.position.clone(), GRENADE.radius, GRENADE.damage);
        this.projectiles.splice(i, 1);
      }
    }
  }

  update(dt, input, paused) {
    this.fireTimer -= dt;
    this.spreadHeat = damp(this.spreadHeat, 0, 6, dt);
    if (this.fireTimer < -1) this.recoilStep = damp(this.recoilStep, 0, 8, dt);

    // Switching
    if (this.switching > 0) {
      this.switching -= dt;
      if (this.switching <= 0 && this.pendingWeapon) {
        this._equip(this.pendingWeapon);
        this.pendingWeapon = null;
        this.switching = this.def.switchTime * 0.5; // raise time
        audio.reloadClick(1.0);
      }
    }

    // Reload
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.def.shellReload) {
        if (this.reloadTimer <= 0 && this.shellsToLoad > 0) {
          this.state.mag++; this.state.reserve--; this.shellsToLoad--;
          audio.reloadClick(1.1);
          this.reloadTimer = this.def.reloadTime;
          if (this.shellsToLoad <= 0 || this.state.reserve <= 0) this.reloading = false;
        }
      } else if (this.reloadTimer <= 0) {
        this._finishReload();
      }
    }

    // ADS target (not while sprinting / switching / reload pump for shotgun ok)
    this.adsTarget = (input.buttons.right && !this.player.sprinting && this.switching <= 0) ? 1 : 0;
    this.ads = damp(this.ads, this.adsTarget, 16, dt);
    this.player.adsBlend = this.ads;

    // Fire input
    if (!paused) {
      if (input.buttons.left) this.tryFire(input.mousePressed.left ? 'pressed' : 'held');
      if (input.actionPressed('reload')) this.startReload();
      if (input.actionPressed('grenade')) this.throwGrenade();
      // weapon hotkeys
      for (const key of this.owned) {
        const def = WEAPONS[key];
        if (input.actionPressed('weapon' + def.slot)) this.switchTo(key);
      }
      if (input.wheel !== 0) this.cycle(input.wheel > 0 ? 1 : -1);
    }

    this._updateProjectiles(dt);
    this._updateViewmodel(dt, input);
    this._updateFov(dt);
  }

  _updateFov(dt) {
    const baseFov = this.player._displayFov ?? this.engine.baseFov;
    const adsFov = this.def.adsFov;
    const fov = lerp(baseFov, adsFov, this.ads);
    this.engine.camera.fov = damp(this.engine.camera.fov, fov, 18, dt);
    this.engine.camera.updateProjectionMatrix();
    // Hide viewmodel heavily when scoped sniper is aimed.
    if (this.def.scoped) this.viewRoot.visible = this.ads < 0.6;
    else this.viewRoot.visible = true;
  }

  _updateViewmodel(dt, input) {
    const vm = this.viewmodels[this.current];
    if (!vm) return;

    // Sway from look input.
    const swayX = clamp(-input.mouse.dx * 0.0006, -0.04, 0.04);
    const swayY = clamp(-input.mouse.dy * 0.0006, -0.04, 0.04);
    this.swayVel.x = damp(this.swayVel.x, swayX, 8, dt);
    this.swayVel.y = damp(this.swayVel.y, swayY, 8, dt);

    // Base hip position vs ADS centered position.
    const hip = new THREE.Vector3(0.18, -0.18, -0.42);
    const adsPos = this.def.scoped ? new THREE.Vector3(0, -0.06, -0.2) : new THREE.Vector3(0, -0.105, -0.28);
    const target = hip.clone().lerp(adsPos, this.ads);

    // Movement bob on viewmodel.
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    const bobScale = clamp(speed / 8, 0, 1) * (1 - this.ads * 0.7);
    target.x += Math.cos(this.player.bob) * 0.012 * bobScale + this.swayVel.x;
    target.y += Math.abs(Math.sin(this.player.bob)) * 0.012 * bobScale + this.swayVel.y;

    // Sprint pose: tuck the gun down/right.
    if (this.player.sprinting) {
      target.x += 0.1; target.y -= 0.08; target.z += 0.05;
    }

    // Recoil kick on viewmodel (z punch + pitch).
    this._kick = damp(this._kick || 0, 0, 12, dt);
    target.z += this._kick * 0.06;

    // Reload dip.
    if (this.reloading && !this.def.shellReload) {
      const t = 1 - clamp(this.reloadTimer / this.def.reloadTime, 0, 1);
      const dip = Math.sin(t * Math.PI);
      target.y -= dip * 0.12;
      vm.group.rotation.x = dip * 0.5;
    } else if (this.reloading && this.def.shellReload) {
      target.y -= 0.04;
      vm.group.rotation.x = damp(vm.group.rotation.x, 0.15, 10, dt);
    } else {
      vm.group.rotation.x = damp(vm.group.rotation.x, 0, 12, dt);
    }

    // Switch lower animation.
    if (this.switching > 0) {
      const lower = Math.sin(clamp(this.switching / Math.max(0.001, this.def.switchTime), 0, 1) * Math.PI) ;
      target.y -= lower * 0.25;
    }

    this.viewmodelPos.lerp(target, clamp(dt * 16, 0, 1));
    vm.group.position.copy(this.viewmodelPos);

    // Recoil rotational punch.
    vm.group.rotation.x += this._kick * 0.12;
    vm.group.rotation.z = -this.swayVel.x * 2 + (this.player.lean * 0.05);
  }
}
