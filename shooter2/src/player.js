// First-person kinematic character controller. Custom collide-and-slide against
// static AABBs for crisp, tunable movement (see DESIGN.md for the rationale).
import * as THREE from 'three';
import { clamp, lerp, damp, deg, TAU } from './util.js';
import { audio } from './audio.js';

const STAND_H = 1.8;
const CROUCH_H = 1.1;
const EYE_OFFSET = 0.12;      // eye below top of capsule
const RADIUS = 0.36;

export class Player {
  constructor(engine, input, world) {
    this.engine = engine;
    this.input = input;
    this.world = world;
    this.camera = engine.camera;

    this.pos = world.playerSpawn.clone();   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;       // facing -z initially (into the level)
    this.pitch = 0;
    this.height = STAND_H;
    this.targetHeight = STAND_H;
    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.sliding = false;
    this.slideTime = 0;
    this.lean = 0;            // -1..1
    this.targetLean = 0;

    // Camera feel state
    this.bob = 0;
    this.bobAmount = 0;
    this.viewTilt = 0;
    this.recoilKick = new THREE.Vector2();   // applied by weapons (pitch, yaw)
    this.recoilOffset = new THREE.Vector2();
    this.landDip = 0;
    this.breath = 0;
    this.adsBlend = 0;        // 0..1 from weapon system
    this.shakeT = 0;
    this.shakeMag = 0;

    // Vitals
    this.maxHealth = 100;
    this.health = 100;
    this.maxArmor = 100;
    this.armor = 0;
    this.regenDelay = 4.5;
    this.regenRate = 22;      // hp/s
    this.lastDamageTime = -99;
    this.dead = false;
    this.maxStamina = 100;
    this.stamina = 100;

    this.lastStepDist = 0;
    this.time = 0;
    this.damageDir = null;    // direction of last hit for indicator
    this.damageDirTime = 0;
  }

  reset() {
    this.pos.copy(this.world.playerSpawn);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.armor = 0;
    this.dead = false;
    this.stamina = this.maxStamina;
    this.yaw = Math.PI; this.pitch = 0;
    this.height = STAND_H; this.targetHeight = STAND_H;
    this.crouching = false; this.sliding = false;
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height - EYE_OFFSET, this.pos.z);
  }

  addRecoil(pitch, yaw) {
    this.recoilKick.x += pitch;
    this.recoilKick.y += yaw;
  }

  shake(mag, dur = 0.3) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  damage(amount, fromPos) {
    if (this.dead) return;
    this.lastDamageTime = this.time;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.6);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    audio.hurt();
    this.shake(clamp(amount / 30, 0.1, 0.5), 0.25);
    if (fromPos) {
      const dir = new THREE.Vector3().subVectors(fromPos, this.eyePos);
      this.damageDir = Math.atan2(dir.x, dir.z);
      this.damageDirTime = this.time;
    }
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  heal(a) { this.health = clamp(this.health + a, 0, this.maxHealth); }
  addArmor(a) { this.armor = clamp(this.armor + a, 0, this.maxArmor); }

  _look(dt) {
    const s = this.input.settings.sensitivity * 0.0022;
    const inv = this.input.settings.invertY ? -1 : 1;
    this.yaw -= this.input.mouse.dx * s;
    this.pitch -= this.input.mouse.dy * s * inv;
    this.pitch = clamp(this.pitch, -deg(89), deg(89));
  }

  _wishDir() {
    const f = (this.input.action('forward') ? 1 : 0) - (this.input.action('back') ? 1 : 0);
    const r = (this.input.action('right') ? 1 : 0) - (this.input.action('left') ? 1 : 0);
    const dir = new THREE.Vector3();
    if (f || r) {
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      // forward is -z in yaw frame
      dir.x = -sinY * f + cosY * r;
      dir.z = -cosY * f - sinY * r;
      dir.normalize();
    }
    return dir;
  }

  update(dt, paused) {
    this.time += dt;
    if (this.dead) { this._updateCamera(dt); return; }
    if (!paused) this._look(dt);

    const wish = this._wishDir();
    const moving = wish.lengthSq() > 0.01;

    // ---- State: crouch / sprint / slide ----
    const wantCrouch = this.input.action('crouch');
    const wantSprint = this.input.action('sprint') && this.input.action('forward') && this.stamina > 5 && !this.crouching;

    // Slide: initiate when sprinting + crouch pressed while grounded & moving fast.
    if (this.input.actionPressed('crouch') && this.sprinting && this.onGround && this.vel.length() > 4 && !this.sliding) {
      this.sliding = true;
      this.slideTime = 0.55;
      // give a forward burst
      const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
      if (horiz.length() < 7) horiz.setLength(7);
      this.vel.x = horiz.x * 1.25; this.vel.z = horiz.z * 1.25;
      audio.footstep();
    }
    if (this.sliding) {
      this.slideTime -= dt;
      if (this.slideTime <= 0 || !this.onGround) this.sliding = false;
    }

    this.crouching = (wantCrouch || this.sliding) && this.onGround;
    this.sprinting = wantSprint && !this.sliding;
    this.targetHeight = this.crouching ? CROUCH_H : STAND_H;
    // Don't stand up into a ceiling.
    if (this.targetHeight > this.height && this._ceilingBlocked()) this.targetHeight = this.height;
    this.height = damp(this.height, this.targetHeight, 14, dt);

    // ---- Stamina ----
    if (this.sprinting && moving) this.stamina = clamp(this.stamina - 18 * dt, 0, this.maxStamina);
    else this.stamina = clamp(this.stamina + 12 * dt, 0, this.maxStamina);

    // ---- Speeds ----
    let target = 5.4;
    if (this.crouching) target = 2.6;
    if (this.sprinting) target = 8.4;
    if (this.adsBlend > 0.5 && !this.sprinting) target *= 0.7;
    const accel = this.onGround ? (this.sliding ? 2 : 52) : 9;
    const friction = this.onGround ? (this.sliding ? 2.2 : 11) : 0.2;

    // ---- Horizontal velocity integration ----
    const horiz = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (moving && !this.sliding) {
      const desired = wish.clone().multiplyScalar(target);
      horiz.x = damp(horiz.x, desired.x, accel * 0.12, dt);
      horiz.z = damp(horiz.z, desired.z, accel * 0.12, dt);
    } else {
      // friction
      const sp = horiz.length();
      if (sp > 0) {
        const drop = sp * friction * dt;
        const ns = Math.max(0, sp - drop);
        horiz.multiplyScalar(sp > 0 ? ns / sp : 0);
      }
    }
    this.vel.x = horiz.x; this.vel.z = horiz.z;

    // ---- Jump / gravity ----
    if (this.input.actionPressed('jump') && this.onGround && !this.sliding) {
      this.vel.y = 6.4;
      this.onGround = false;
    }
    this.vel.y -= 22 * dt;
    this.vel.y = Math.max(this.vel.y, -40);

    // ---- Lean ----
    let lean = 0;
    if (this.input.action('leanLeft')) lean += 1;
    if (this.input.action('leanRight')) lean -= 1;
    if (this.sprinting) lean = 0;
    this.targetLean = lean;
    this.lean = damp(this.lean, this.targetLean, 12, dt);

    // ---- Move & collide ----
    this._moveCollide(dt);

    // ---- Footstep audio + bob ----
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed > 1.2) {
      this.bob += dt * speed * (this.sprinting ? 1.5 : 1.1);
      const stepInterval = this.sprinting ? 2.0 : 2.6;
      if (this.bob - this.lastStepDist > stepInterval) {
        this.lastStepDist = this.bob;
        if (!this.sliding) audio.footstep();
      }
    }
    this.bobAmount = damp(this.bobAmount, clamp(speed / 8, 0, 1) * (this.crouching ? 0.5 : 1), 8, dt);

    this._updateCamera(dt);
  }

  _ceilingBlocked() {
    const headY = this.pos.y + STAND_H;
    for (const c of this.world.colliders) {
      if (this.pos.x + RADIUS > c.min.x && this.pos.x - RADIUS < c.max.x &&
          this.pos.z + RADIUS > c.min.z && this.pos.z - RADIUS < c.max.z) {
        if (c.min.y < headY + 0.1 && c.min.y > this.pos.y + CROUCH_H) return true;
      }
    }
    return false;
  }

  // Axis-separated collide-and-slide + vertical resolution with step-up support.
  _moveCollide(dt) {
    const r = RADIUS;
    const top = () => this.pos.y + this.height;

    // Horizontal X
    this.pos.x += this.vel.x * dt;
    for (const c of this.world.colliders) {
      if (!this._overlapXZ(c, r)) continue;
      if (!this._overlapY(c)) continue;
      // resolve along X
      if (this.vel.x > 0) this.pos.x = c.min.x - r;
      else if (this.vel.x < 0) this.pos.x = c.max.x + r;
      this.vel.x = 0;
    }
    // Horizontal Z
    this.pos.z += this.vel.z * dt;
    for (const c of this.world.colliders) {
      if (!this._overlapXZ(c, r)) continue;
      if (!this._overlapY(c)) continue;
      if (this.vel.z > 0) this.pos.z = c.min.z - r;
      else if (this.vel.z < 0) this.pos.z = c.max.z + r;
      this.vel.z = 0;
    }

    // Vertical
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;

    let groundY = 0;     // world ground plane
    let landed = this.pos.y <= groundY;
    // Find highest surface under the player's column we can rest on.
    for (const c of this.world.colliders) {
      if (!this._overlapXZ(c, r)) continue;
      const ctop = c.max.y, cbot = c.min.y;
      // Landing on top of a box.
      if (prevY >= ctop - 0.05 && this.pos.y <= ctop && this.vel.y <= 0) {
        if (ctop > groundY) groundY = ctop;
        landed = true;
      }
      // Hitting head on underside.
      if (this.vel.y > 0 && prevY + this.height <= cbot + 0.02 && this.pos.y + this.height >= cbot) {
        this.pos.y = cbot - this.height;
        this.vel.y = -1;
      }
    }

    if (this.pos.y <= groundY && this.vel.y <= 0) {
      // Landing impact
      if (!this.onGround && this.vel.y < -7) {
        this.landDip = clamp(-this.vel.y / 40, 0, 0.35);
        this.shake(clamp(-this.vel.y / 60, 0, 0.3), 0.18);
        audio.footstep();
      }
      this.pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.vel.y < 0 && landed) {
      this.pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Keep inside arena bounds.
    const B = 48.2;
    this.pos.x = clamp(this.pos.x, -B, B);
    this.pos.z = clamp(this.pos.z, -B, B);
  }

  _overlapXZ(c, r) {
    return this.pos.x + r > c.min.x && this.pos.x - r < c.max.x &&
           this.pos.z + r > c.min.z && this.pos.z - r < c.max.z;
  }
  _overlapY(c) {
    const feet = this.pos.y + 0.15;       // ignore tiny steps
    const head = this.pos.y + this.height;
    return head > c.min.y && feet < c.max.y;
  }

  _updateCamera(dt) {
    const cam = this.camera;
    const eye = this.eyePos;

    // Recoil recovery (spring back toward zero).
    this.recoilOffset.x = damp(this.recoilOffset.x, 0, 9, dt);
    this.recoilOffset.y = damp(this.recoilOffset.y, 0, 9, dt);
    // Integrate fresh kick into offset, then drain kick.
    this.recoilOffset.x += this.recoilKick.x;
    this.recoilOffset.y += this.recoilKick.y;
    this.recoilKick.set(0, 0);

    // Bob & sway
    const bobAmt = this.bobAmount * (this.input.settings.bobAmount ?? 1) * (this.adsBlend > 0.5 ? 0.3 : 1);
    const bobX = Math.cos(this.bob) * 0.035 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.05 * bobAmt;
    this.breath += dt;
    const breathY = Math.sin(this.breath * 1.4) * 0.006;

    // Landing dip recovery
    this.landDip = damp(this.landDip, 0, 8, dt);

    // Screen shake
    let shakeX = 0, shakeY = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * (this.shakeT > 0 ? 1 : 0);
      shakeX = (Math.random() * 2 - 1) * m * 0.06;
      shakeY = (Math.random() * 2 - 1) * m * 0.06;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }

    // Lean offset (translate + roll)
    const leanOffset = this.lean * 0.55;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const rightX = cosY, rightZ = -sinY;

    cam.position.set(
      eye.x + rightX * leanOffset + bobX * rightX + shakeX,
      eye.y + bobY + breathY - this.landDip + shakeY,
      eye.z + rightZ * leanOffset + bobX * rightZ
    );

    // Orientation: yaw, pitch (+ recoil), roll (lean + strafe tilt)
    const strafeTilt = -this.vel.x * Math.cos(this.yaw) * 0.0 ; // handled via lean mostly
    const totalPitch = this.pitch + this.recoilOffset.x;
    const totalYaw = this.yaw + this.recoilOffset.y;
    const roll = -this.lean * 0.12 + (this.sliding ? 0.06 : 0);

    const euler = new THREE.Euler(totalPitch, totalYaw, roll, 'YXZ');
    cam.quaternion.setFromEuler(euler);

    // FOV: sprint widen + ads handled by weapons.
    const sprintFov = this.sprinting ? 6 : 0;
    const baseFov = this.input.settings.fov;
    this._displayFov = baseFov + sprintFov;
  }
}
