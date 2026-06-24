// Enemy AI: finite-state machines, three archetypes, navigation with obstacle
// avoidance, line-of-sight, cover seeking, flanking, suppression, and
// ragdoll-lite deaths. Also owns hit resolution (raycast vs hitboxes).
import * as THREE from 'three';
import { clamp, lerp, damp, rand, randInt, pick, deg, tmpV1 } from './util.js';
import { audio } from './audio.js';

const STATE = { IDLE: 0, PATROL: 1, ALERT: 2, COMBAT: 3, COVER: 4, FLANK: 5, DEAD: 6 };

export const ARCHETYPES = {
  rifleman: {
    name: 'RIFLEMAN', health: 100, speed: 3.2, color: 0x4a5a48, accent: 0x9aa84a,
    fireRate: 1.6, burst: 4, burstGap: 0.12, damage: 9, range: 60, accuracy: 0.85,
    coverBias: 0.55, scoreVal: 100, headHeight: 1.62,
  },
  rusher: {
    name: 'RUSHER', health: 70, speed: 5.6, color: 0x6a3a3a, accent: 0xd85a3a,
    fireRate: 0.8, burst: 6, burstGap: 0.07, damage: 7, range: 18, accuracy: 0.6,
    coverBias: 0.1, scoreVal: 120, headHeight: 1.55, melee: true,
  },
  heavy: {
    name: 'HEAVY', health: 320, speed: 2.0, color: 0x3a3a4a, accent: 0x5a6ad8,
    fireRate: 2.2, burst: 8, burstGap: 0.1, damage: 12, range: 45, accuracy: 0.78,
    coverBias: 0.3, scoreVal: 250, headHeight: 1.78, big: true,
  },
};

let _id = 0;

class Enemy {
  constructor(manager, type, pos) {
    this.mgr = manager;
    this.type = type;
    this.def = ARCHETYPES[type];
    this.id = _id++;
    this.pos = pos.clone();
    this.pos.y = 0;
    this.vel = new THREE.Vector3();
    this.yaw = rand(0, Math.PI * 2);
    this.health = this.def.health * manager.healthMul;
    this.maxHealth = this.health;
    this.state = STATE.PATROL;
    this.stateTime = 0;
    this.target = null;          // navigation target {x,z}
    this.fireTimer = rand(0.5, 1.5);
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.alertLevel = 0;         // 0..1 awareness of player
    this.lastSeenPos = null;
    this.coverPoint = null;
    this.reactionTimer = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = rand(0.5, 1.5);
    this.hitFlash = 0;
    this.dead = false;
    this.deathTime = 0;
    this.muzzleCooldown = 0;
    this._build();
  }

  _build() {
    const d = this.def;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.7, metalness: 0.2 });
    const accentMat = new THREE.MeshStandardMaterial({ color: d.accent, roughness: 0.6, metalness: 0.3, emissive: d.accent, emissiveIntensity: 0.15 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.5, metalness: 0.4 });
    const scale = d.big ? 1.25 : 1.0;

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.7 * scale, 0.3 * scale), bodyMat);
    torso.position.y = 1.1 * scale; torso.castShadow = true; g.add(torso);
    // Chest plate (accent)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42 * scale, 0.4 * scale, 0.06), accentMat);
    plate.position.set(0, 1.18 * scale, 0.16 * scale); g.add(plate);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18 * scale, 12, 10), headMat);
    head.position.y = d.headHeight * scale; head.castShadow = true; g.add(head);
    // Visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22 * scale, 0.07, 0.04), new THREE.MeshStandardMaterial({ color: 0x081014, emissive: d.accent, emissiveIntensity: 1.2 }));
    visor.position.set(0, d.headHeight * scale, 0.16 * scale); g.add(visor);
    // Legs
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42 * scale, 0.75 * scale, 0.28 * scale), bodyMat);
    legs.position.y = 0.42 * scale; legs.castShadow = true; g.add(legs);
    // Arms
    const armGeo = new THREE.BoxGeometry(0.13 * scale, 0.6 * scale, 0.13 * scale);
    const lArm = new THREE.Mesh(armGeo, bodyMat); lArm.position.set(-0.34 * scale, 1.1 * scale, 0.1); g.add(lArm);
    const rArm = new THREE.Mesh(armGeo, bodyMat); rArm.position.set(0.34 * scale, 1.1 * scale, 0.1); g.add(rArm);
    this.rArm = rArm; this.lArm = lArm; this.legsMesh = legs; this.torsoMesh = torso;
    // Gun
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x16181b, metalness: 0.6, roughness: 0.4 }));
    gun.position.set(0.34 * scale, 1.1 * scale, 0.35); g.add(gun);
    this.gunMesh = gun;
    // Muzzle marker
    this.muzzlePos = new THREE.Vector3();

    g.position.copy(this.pos);
    this.group = g;
    this.scaleF = scale;

    // Hitboxes for raycast (head + body). Slightly larger than visuals for fairness.
    this.headHit = new THREE.Mesh(new THREE.SphereGeometry(0.24 * scale, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.headHit.position.y = d.headHeight * scale;
    this.headHit.userData = { enemy: this, zone: 'head' };
    g.add(this.headHit);
    this.bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 1.0 * scale, 0.45 * scale), new THREE.MeshBasicMaterial({ visible: false }));
    this.bodyHit.position.y = 0.95 * scale;
    this.bodyHit.userData = { enemy: this, zone: 'body' };
    g.add(this.bodyHit);

    this.mgr.scene.add(g);
    this.mgr.hitboxes.push(this.headHit, this.bodyHit);

    // Health bar billboard
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.08), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false }));
    const barFg = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.05), new THREE.MeshBasicMaterial({ color: 0xff4b3e, depthTest: false }));
    barFg.position.z = 0.001;
    const barGroup = new THREE.Group();
    barGroup.add(barBg); barGroup.add(barFg);
    barGroup.position.y = (d.headHeight + 0.35) * scale;
    barGroup.visible = false;
    barGroup.renderOrder = 999;
    g.add(barGroup);
    this.bar = barGroup; this.barFg = barFg;
  }

  get eyePos() { return new THREE.Vector3(this.pos.x, this.def.headHeight * this.scaleF, this.pos.z); }

  damage(amount, zone, fromDir) {
    if (this.dead) return 0;
    const dealt = amount;
    this.health -= amount;
    this._lastWasHead = zone === 'head';
    this.hitFlash = 1;
    this.alertLevel = 1;
    this.lastSeenPos = this.mgr.player.eyePos.clone();
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) this._enterCombat();
    if (this.health <= 0) { this._die(fromDir); return dealt; }
    // flinch
    if (Math.random() < 0.3) this.reactionTimer = Math.max(this.reactionTimer, 0.15);
    return dealt;
  }

  _die(fromDir) {
    this.dead = true;
    this.state = STATE.DEAD;
    this.deathTime = 0;
    this.bar.visible = false;
    // ragdoll-lite: tip over in hit direction with spin
    this.ragVel = (fromDir ? fromDir.clone() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))).setY(0).normalize();
    this.ragSpin = rand(-4, 4);
    this.fallAngle = 0;
    // remove hitboxes from raycast pool
    this.mgr._removeHitboxes(this);
    this.mgr.onKill(this);
    audio.hurt();
  }

  _enterCombat() {
    this.state = STATE.COMBAT;
    this.stateTime = 0;
    this.reactionTimer = this.mgr.reactionTime * rand(0.7, 1.3);
  }

  _hasLOS(toPos) {
    return !this.mgr.segmentBlocked(this.eyePos, toPos);
  }

  _findCover() {
    const player = this.mgr.player.eyePos;
    let best = null, bestScore = -Infinity;
    for (const cp of this.mgr.world.coverPoints) {
      const d = cp.pos.distanceTo(this.pos);
      if (d > 28) continue;
      // a position behind the cover relative to the player
      const away = new THREE.Vector3().subVectors(cp.pos, player).setY(0).normalize();
      const spot = cp.pos.clone().addScaledVector(away, cp.size * 0.6 + 0.5);
      spot.y = 0;
      // score: close to us, provides LOS block from player
      const blockTest = this.mgr.segmentBlocked(new THREE.Vector3(spot.x, 1.2, spot.z), player);
      let score = -d * 0.4 + (blockTest ? 30 : -5) - this.pos.distanceTo(spot) * 0.3;
      if (score > bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }

  update(dt, player) {
    if (this.dead) { this._updateDeath(dt); return; }
    this.stateTime += dt;
    this.hitFlash = damp(this.hitFlash, 0, 8, dt);
    this.muzzleCooldown -= dt;
    if (this.reactionTimer > 0) this.reactionTimer -= dt;

    const toPlayer = new THREE.Vector3().subVectors(player.eyePos, this.eyePos);
    const distToPlayer = toPlayer.length();
    const playerVisible = !player.dead && distToPlayer < 75 && this._canSeePlayer(player, toPlayer, distToPlayer);

    if (playerVisible) {
      this.alertLevel = Math.min(1, this.alertLevel + dt * 3);
      this.lastSeenPos = player.eyePos.clone();
    } else {
      this.alertLevel = Math.max(0, this.alertLevel - dt * 0.25);
    }

    // ---- FSM ----
    switch (this.state) {
      case STATE.IDLE:
      case STATE.PATROL: this._statePatrol(dt, playerVisible); break;
      case STATE.ALERT: this._stateAlert(dt, playerVisible); break;
      case STATE.COMBAT: this._stateCombat(dt, player, playerVisible, distToPlayer); break;
      case STATE.COVER: this._stateCover(dt, player, playerVisible, distToPlayer); break;
      case STATE.FLANK: this._stateFlank(dt, player, playerVisible, distToPlayer); break;
    }

    this._integrate(dt);
    this._animate(dt);
  }

  _canSeePlayer(player, toPlayer, dist) {
    if (dist > 75) return false;
    // FOV check unless already alerted
    if (this.alertLevel < 0.5) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const dir = toPlayer.clone().setY(0).normalize();
      if (fwd.dot(dir) < 0.2) return false; // ~150° cone
    }
    return this._hasLOS(player.eyePos);
  }

  _statePatrol(dt, playerVisible) {
    if (playerVisible && this.alertLevel > 0.4) {
      // brief alert before engaging
      this.state = STATE.ALERT; this.stateTime = 0; this.reactionTimer = this.mgr.reactionTime;
      this.mgr.alertNearby(this.pos, 18);
      return;
    }
    if (!this.target || this.pos.distanceTo(new THREE.Vector3(this.target.x, 0, this.target.z)) < 1.5) {
      this.target = this.mgr.randomNavNear(this.pos, 18);
    }
    this._moveToward(this.target, this.def.speed * 0.5, dt);
  }

  _stateAlert(dt, playerVisible) {
    // turn toward last seen, wait reaction, then commit to combat
    if (this.lastSeenPos) this._faceTo(this.lastSeenPos, dt, 6);
    if (this.reactionTimer <= 0) this._enterCombat();
    if (!playerVisible && this.stateTime > 2.5) { this.state = STATE.PATROL; this.alertLevel = 0.3; }
  }

  _stateCombat(dt, player, playerVisible, dist) {
    const def = this.def;
    if (this.lastSeenPos) this._faceTo(player.eyePos, dt, 8);

    // decide whether to seek cover
    if (!playerVisible) {
      // pursue last known position
      if (this.lastSeenPos) {
        this._moveToward({ x: this.lastSeenPos.x, z: this.lastSeenPos.z }, def.speed, dt);
        if (this.pos.distanceTo(this.lastSeenPos) < 2 && this.stateTime > 1) {
          this.state = STATE.PATROL; this.alertLevel = 0.4;
        }
      }
      return;
    }

    // Rushers close distance aggressively; others manage range & cover.
    if (this.type === 'rusher') {
      if (dist > 2.2) this._moveToward({ x: player.pos.x, z: player.pos.z }, def.speed, dt);
      else this._meleeOrShoot(dt, player, dist);
      this._shoot(dt, player, dist);
      return;
    }

    // Strafe while engaging.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = rand(0.8, 1.8); }

    // Maintain preferred range.
    const preferred = clamp(def.range * 0.55, 8, 40);
    const move = new THREE.Vector3();
    const toPlayer = new THREE.Vector3().subVectors(player.pos, this.pos).setY(0);
    const fwd = toPlayer.clone().normalize();
    const rightV = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (dist > preferred + 4) move.add(fwd);
    else if (dist < preferred - 4) move.addScaledVector(fwd, -1);
    move.addScaledVector(rightV, this.strafeDir * 0.8);
    this._steer(move, def.speed * 0.85, dt);

    // Consider cover when health low or under pressure.
    if (Math.random() < def.coverBias * dt * 0.8 && (this.health < this.maxHealth * 0.6 || this.stateTime > 3)) {
      const cover = this._findCover();
      if (cover) { this.coverPoint = cover; this.state = STATE.COVER; this.stateTime = 0; }
    }
    // Heavy/rifleman occasionally flank.
    if (this.type !== 'heavy' && Math.random() < 0.15 * dt && this.stateTime > 4) {
      this.state = STATE.FLANK; this.stateTime = 0;
      this.flankTarget = this._flankPoint(player);
    }

    this._shoot(dt, player, dist);
  }

  _stateCover(dt, player, playerVisible, dist) {
    const cp = this.coverPoint;
    if (!cp) { this.state = STATE.COMBAT; return; }
    const atCover = this.pos.distanceTo(cp) < 1.4;
    if (!atCover) {
      this._moveToward({ x: cp.x, z: cp.z }, this.def.speed, dt);
    } else {
      // peek and fire if we can see player; else regroup
      this._faceTo(player.eyePos, dt, 8);
      if (playerVisible) this._shoot(dt, player, dist);
      // pop out of cover after a while or when healed-ish
      if (this.stateTime > rand(2.5, 4.5)) { this.state = STATE.COMBAT; this.stateTime = 0; }
    }
  }

  _stateFlank(dt, player, playerVisible, dist) {
    if (!this.flankTarget || this.pos.distanceTo(new THREE.Vector3(this.flankTarget.x, 0, this.flankTarget.z)) < 2 || this.stateTime > 5) {
      this.state = STATE.COMBAT; this.stateTime = 0; return;
    }
    this._moveToward(this.flankTarget, this.def.speed, dt);
    if (playerVisible && this.stateTime > 1) this._shoot(dt, player, dist);
  }

  _flankPoint(player) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const toMe = new THREE.Vector3().subVectors(this.pos, player.pos).setY(0).normalize();
    const perp = new THREE.Vector3(-toMe.z, 0, toMe.x).multiplyScalar(side * 12);
    const p = player.pos.clone().add(toMe.multiplyScalar(10)).add(perp);
    return { x: clamp(p.x, -46, 46), z: clamp(p.z, -46, 46) };
  }

  _meleeOrShoot(dt, player, dist) {
    if (dist < 2.4 && this.muzzleCooldown <= 0) {
      player.damage(this.def.damage * 1.8, this.pos.clone());
      this.muzzleCooldown = 0.9;
      this.player_meleeFlash = 0.15;
    }
  }

  _shoot(dt, player, dist) {
    const def = this.def;
    if (this.reactionTimer > 0) return;
    if (dist > def.range * 1.2) return;
    if (this.mgr.segmentBlocked(this.eyePos, player.eyePos)) return;

    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._fireBullet(player, dist);
        this.burstLeft--;
        this.burstTimer = def.burstGap;
      }
      return;
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.burstLeft = def.burst;
      this.burstTimer = 0;
      this.fireTimer = def.fireRate / this.mgr.fireRateMul * rand(0.8, 1.2);
    }
  }

  _fireBullet(player, dist) {
    const def = this.def;
    // accuracy degrades with distance and player movement; improves with difficulty.
    const baseAcc = def.accuracy * this.mgr.accuracyMul;
    const movePenalty = Math.hypot(player.vel.x, player.vel.z) > 4 ? 0.18 : 0;
    const hitChance = clamp(baseAcc - dist / (def.range * 2.5) - movePenalty, 0.05, 0.95);
    this.muzzleCooldown = 0.05;
    audio.enemyShot();
    // tracer + muzzle flash
    const muzzle = this.eyePos.clone();
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    muzzle.addScaledVector(fwd, 0.5);
    const aim = player.eyePos.clone();
    if (Math.random() > hitChance) {
      // miss: scatter the tracer
      aim.add(new THREE.Vector3(rand(-2, 2), rand(-1, 2), rand(-2, 2)));
      this.mgr.effects.tracer(muzzle, aim, 0xff6644, 0.05);
    } else {
      this.mgr.effects.tracer(muzzle, aim, 0xff6644, 0.05);
      player.damage(def.damage * rand(0.85, 1.15), this.pos.clone());
    }
    this.mgr.effects.muzzleFlashLight(muzzle, 0xff8844, 2.5, 0.04);
    this.muzzleFlashT = 0.05;
  }

  // ---- Movement helpers ----
  _moveToward(target, speed, dt) {
    const dir = new THREE.Vector3(target.x - this.pos.x, 0, target.z - this.pos.z);
    if (dir.lengthSq() < 0.0001) return;
    this._steer(dir, speed, dt);
    this._faceMovement(dt);
  }

  _steer(dir, speed, dt) {
    dir = dir.clone().setY(0);
    if (dir.lengthSq() > 0) dir.normalize();
    // obstacle avoidance: repulsion from nearby colliders & enemies
    const avoid = this.mgr.avoidance(this);
    dir.add(avoid);
    if (dir.lengthSq() > 0) dir.normalize();
    const desired = dir.multiplyScalar(speed);
    this.vel.x = damp(this.vel.x, desired.x, 10, dt);
    this.vel.z = damp(this.vel.z, desired.z, 10, dt);
  }

  _faceMovement(dt) {
    if (Math.hypot(this.vel.x, this.vel.z) > 0.3) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = this._lerpAngle(this.yaw, targetYaw, dt * 8);
    }
  }
  _faceTo(pos, dt, rate = 6) {
    const targetYaw = Math.atan2(pos.x - this.pos.x, pos.z - this.pos.z);
    this.yaw = this._lerpAngle(this.yaw, targetYaw, dt * rate);
  }
  _lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * clamp(t, 0, 1);
  }

  _integrate(dt) {
    // X then Z with collider sliding.
    const r = 0.35 * this.scaleF;
    this.pos.x += this.vel.x * dt;
    for (const c of this.mgr.world.colliders) {
      if (c.min.y > 1.5) continue;
      if (this.pos.x + r > c.min.x && this.pos.x - r < c.max.x && this.pos.z + r > c.min.z && this.pos.z - r < c.max.z) {
        if (this.vel.x > 0) this.pos.x = c.min.x - r; else if (this.vel.x < 0) this.pos.x = c.max.x + r;
        this.vel.x = 0;
      }
    }
    this.pos.z += this.vel.z * dt;
    for (const c of this.mgr.world.colliders) {
      if (c.min.y > 1.5) continue;
      if (this.pos.x + r > c.min.x && this.pos.x - r < c.max.x && this.pos.z + r > c.min.z && this.pos.z - r < c.max.z) {
        if (this.vel.z > 0) this.pos.z = c.min.z - r; else if (this.vel.z < 0) this.pos.z = c.max.z + r;
        this.vel.z = 0;
      }
    }
    this.pos.x = clamp(this.pos.x, -47, 47);
    this.pos.z = clamp(this.pos.z, -47, 47);
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  _animate(dt) {
    // Leg/arm walk bob.
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this._walkPhase = (this._walkPhase || 0) + dt * speed * 2.2;
    const swing = Math.sin(this._walkPhase) * clamp(speed / 4, 0, 1) * 0.5;
    if (this.legsMesh) this.legsMesh.rotation.x = swing * 0.3;
    if (this.lArm) this.lArm.rotation.x = swing;
    if (this.rArm) this.rArm.rotation.x = -swing * 0.3;

    // Hit flash tint.
    const tint = this.hitFlash;
    const emis = tint * 0.8;
    this.torsoMesh.material.emissive?.setRGB(emis, 0, 0);
    this.legsMesh.material.emissive?.setRGB(emis, 0, 0);

    // Health bar.
    if (this.health < this.maxHealth && !this.dead) {
      this.bar.visible = true;
      this.barFg.scale.x = clamp(this.health / this.maxHealth, 0, 1);
      this.barFg.position.x = -(1 - this.barFg.scale.x) * 0.34;
      this.bar.quaternion.copy(this.mgr.camera.quaternion);
    }
  }

  _updateDeath(dt) {
    this.deathTime += dt;
    // Topple over and sink, then fade and remove.
    if (this.fallAngle < Math.PI / 2) {
      this.fallAngle = Math.min(Math.PI / 2, this.fallAngle + dt * 4);
      this.group.rotation.x = -this.fallAngle * Math.sign(this.ragVel.z || 1) * 0;
      // tip in ragdoll direction
      const axis = new THREE.Vector3(this.ragVel.z, 0, -this.ragVel.x);
      this.group.setRotationFromAxisAngle(axis, this.fallAngle);
      this.group.rotation.y = this.yaw;
    }
    // slide a touch
    this.group.position.x += this.ragVel.x * dt * 1.2 * Math.max(0, 1 - this.deathTime);
    this.group.position.z += this.ragVel.z * dt * 1.2 * Math.max(0, 1 - this.deathTime);
    if (this.deathTime > 4) {
      const t = clamp((this.deathTime - 4) / 1.5, 0, 1);
      this.group.position.y = -t * 1.5;
      this.group.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 1 - t; } });
      if (t >= 1) this._remove = true;
    }
  }

  dispose() {
    this.mgr.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose?.(); if (o.material.map) o.material.map.dispose?.(); o.material.dispose?.(); }
    });
  }
}

export class EnemyManager {
  constructor(scene, world, player, effects, camera) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.camera = camera;
    this.enemies = [];
    this.hitboxes = [];
    this.raycaster = new THREE.Raycaster();
    this.onKillCb = null;

    // Difficulty knobs (scaled externally per wave).
    this.healthMul = 1;
    this.accuracyMul = 1;
    this.fireRateMul = 1;
    this.reactionTime = 0.45;
  }

  setDifficulty({ healthMul, accuracyMul, fireRateMul, reactionTime }) {
    this.healthMul = healthMul; this.accuracyMul = accuracyMul;
    this.fireRateMul = fireRateMul; this.reactionTime = reactionTime;
  }

  spawn(type, pos) {
    const e = new Enemy(this, type, pos);
    this.enemies.push(e);
    return e;
  }

  get alive() { return this.enemies.filter((e) => !e.dead).length; }

  onKill(enemy) { this.onKillCb?.(enemy); }

  _removeHitboxes(enemy) {
    this.hitboxes = this.hitboxes.filter((h) => h.userData.enemy !== enemy);
  }

  alertNearby(pos, radius) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.pos.distanceTo(pos) < radius && (e.state === STATE.IDLE || e.state === STATE.PATROL)) {
        e.alertLevel = Math.max(e.alertLevel, 0.6);
        e.lastSeenPos = this.player.eyePos.clone();
        e.state = STATE.ALERT; e.stateTime = 0; e.reactionTimer = this.reactionTime * rand(1, 2);
      }
    }
  }

  alertAll() {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.alertLevel = 1; e.lastSeenPos = this.player.eyePos.clone();
      if (e.state === STATE.IDLE || e.state === STATE.PATROL) { e.state = STATE.COMBAT; e.reactionTimer = this.reactionTime; }
    }
  }

  randomNavNear(pos, radius) {
    const candidates = this.world.navPoints.filter((p) => {
      const dx = p.x - pos.x, dz = p.z - pos.z;
      return dx * dx + dz * dz < radius * radius && (p.y || 0) < 1;
    });
    if (candidates.length) return pick(candidates);
    return { x: clamp(pos.x + rand(-10, 10), -45, 45), z: clamp(pos.z + rand(-10, 10), -45, 45) };
  }

  // Segment vs static AABB (returns true if blocked). Used for LOS + cover.
  segmentBlocked(a, b) {
    const dir = tmpV1.subVectors(b, a);
    const len = dir.length();
    if (len < 0.001) return false;
    dir.multiplyScalar(1 / len);
    for (const c of this.world.colliders) {
      if (c.max.y < 0.3) continue;             // ignore floor-thin colliders
      if (this._rayBox(a, dir, c, len)) return true;
    }
    return false;
  }

  _rayBox(o, d, box, maxT) {
    let tmin = 0, tmax = maxT;
    for (const ax of ['x', 'y', 'z']) {
      const inv = 1 / (d[ax] || 1e-9);
      let t1 = (box.min[ax] - o[ax]) * inv;
      let t2 = (box.max[ax] - o[ax]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    return tmin >= 0 && tmin <= maxT;
  }

  // Repulsion vector to avoid colliders & other enemies (local steering).
  avoidance(self) {
    const v = new THREE.Vector3();
    // separation from other enemies
    for (const e of this.enemies) {
      if (e === self || e.dead) continue;
      const dx = self.pos.x - e.pos.x, dz = self.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.2 && d2 > 0.001) {
        const d = Math.sqrt(d2);
        v.x += (dx / d) * (2.2 - d) * 0.6;
        v.z += (dz / d) * (2.2 - d) * 0.6;
      }
    }
    // obstacle whisker: look ahead, if blocked, push perpendicular
    const fwd = new THREE.Vector3(this.vel ? 0 : 0); // placeholder
    const speed = Math.hypot(self.vel.x, self.vel.z);
    if (speed > 0.2) {
      const ahead = new THREE.Vector3(self.vel.x, 0, self.vel.z).normalize();
      const probe = new THREE.Vector3(self.pos.x + ahead.x * 1.4, 0.8, self.pos.z + ahead.z * 1.4);
      for (const c of this.world.colliders) {
        if (c.min.y > 1.5) continue;
        if (probe.x > c.min.x - 0.4 && probe.x < c.max.x + 0.4 && probe.z > c.min.z - 0.4 && probe.z < c.max.z + 0.4) {
          // push perpendicular to ahead
          v.x += -ahead.z * 1.2; v.z += ahead.x * 1.2;
          break;
        }
      }
    }
    return v;
  }

  // ---- Hit resolution called by weapons. Returns {point, normal, ...} or null. ----
  resolveHit(origin, dir, range, falloff, damage, headMult, tracerColor) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    // Check enemies first.
    const enemyHits = this.raycaster.intersectObjects(this.hitboxes, false);
    // Check world.
    const worldHit = this._raycastWorld(origin, dir, range);

    let enemyHit = enemyHits.length ? enemyHits[0] : null;
    if (enemyHit && worldHit && worldHit.distance < enemyHit.distance) enemyHit = null;

    if (enemyHit) {
      const ud = enemyHit.object.userData;
      const enemy = ud.enemy;
      const dist = enemyHit.distance;
      let dmg = damage;
      // falloff
      if (falloff) {
        if (dist > falloff[1]) dmg *= 0.4;
        else if (dist > falloff[0]) dmg *= lerp(1, 0.4, (dist - falloff[0]) / (falloff[1] - falloff[0]));
      }
      const head = ud.zone === 'head';
      if (head) dmg *= headMult;
      const fromDir = dir.clone();
      enemy.damage(dmg, ud.zone, fromDir);
      this.effects.blood(enemyHit.point.clone(), dir.clone(), head ? 20 : 12);
      return { point: enemyHit.point, normal: enemyHit.face?.normal || dir.clone().negate(), enemy, zone: ud.zone, damage: dmg, headshot: head, killed: enemy.dead, distance: dist };
    }

    if (worldHit) {
      const material = worldHit.material;
      this.effects.sparks(worldHit.point.clone(), worldHit.normal.clone(), 8, material === 'metal' ? 0xfff0c0 : 0xffcc66);
      this.effects.decal(worldHit.point.clone(), worldHit.normal.clone());
      audio.impact(material);
      // explosive barrel?
      if (worldHit.barrel && worldHit.barrel.explosive) this._explodeBarrel(worldHit.barrel);
      return { point: worldHit.point, normal: worldHit.normal, world: true, distance: worldHit.distance };
    }
    return null;
  }

  // Raycast against static AABB colliders + barrels. Returns nearest hit.
  _raycastWorld(origin, dir, range) {
    let best = null;
    for (const c of this.world.colliders) {
      const t = this._rayBoxT(origin, dir, c, range);
      if (t !== null && (!best || t < best.distance)) {
        const point = origin.clone().addScaledVector(dir, t);
        const normal = this._boxNormal(c, point);
        const material = c.max.y - c.min.y > 4 ? 'concrete' : (Math.abs(c.max.x - c.min.x) > 3 ? 'metal' : 'concrete');
        best = { distance: t, point, normal, material };
      }
    }
    // barrels (cylinders approximated as AABB already in colliders? they are) -- check world.barrels meshes
    for (const b of (this.world.barrels || [])) {
      if (!b.mesh.parent) continue;
      const box = new THREE.Box3().setFromObject(b.mesh);
      const t = this._rayBoxT(origin, dir, box, range);
      if (t !== null && (!best || t < best.distance)) {
        const point = origin.clone().addScaledVector(dir, t);
        best = { distance: t, point, normal: this._boxNormal(box, point), material: 'metal', barrel: b };
      }
    }
    return best;
  }

  _rayBoxT(o, d, box, maxT) {
    let tmin = -Infinity, tmax = Infinity;
    for (const ax of ['x', 'y', 'z']) {
      const inv = 1 / (d[ax] || 1e-9);
      let t1 = (box.min[ax] - o[ax]) * inv;
      let t2 = (box.max[ax] - o[ax]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (tmin < 0) tmin = tmax;
    if (tmin < 0 || tmin > maxT) return null;
    return tmin;
  }

  _boxNormal(box, p) {
    const c = new THREE.Vector3(); box.getCenter(c);
    const d = new THREE.Vector3().subVectors(p, c);
    const size = new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(0.5);
    const nx = d.x / (size.x || 1), ny = d.y / (size.y || 1), nz = d.z / (size.z || 1);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(nx), 0, 0);
    if (ay >= az) return new THREE.Vector3(0, Math.sign(ny), 0);
    return new THREE.Vector3(0, 0, Math.sign(nz));
  }

  _explodeBarrel(barrel) {
    if (barrel._exploded) return;
    barrel._exploded = true;
    const pos = barrel.mesh.position.clone();
    this.effects.explosion(pos);
    audio.explosion();
    this.player.shake(0.5, 0.35);
    this.explode(pos, 6, 110);
    this.scene.remove(barrel.mesh);
  }

  // Radius damage (grenades, barrels). Damages enemies and player.
  explode(pos, radius, damage) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) {
        const falloff = 1 - d / radius;
        const dir = new THREE.Vector3().subVectors(e.pos, pos).setY(0).normalize();
        if (!this.segmentBlocked(pos, e.eyePos)) e.damage(damage * falloff, 'body', dir);
      }
    }
    // chain-explode nearby barrels
    for (const b of (this.world.barrels || [])) {
      if (b.explosive && !b._exploded && b.mesh.position.distanceTo(pos) < radius) {
        setTimeout(() => this._explodeBarrel(b), 80);
      }
    }
    // player splash
    const pd = this.player.eyePos.distanceTo(pos);
    if (pd < radius && !this.player.dead) {
      this.player.damage(damage * (1 - pd / radius) * 0.8, pos);
    }
  }

  onShotFired(origin, dir, def) {
    // gunfire draws nearby idle enemies' attention.
    this.alertNearby(this.player.pos, 30 * (def.sound.level || 0.7));
  }

  update(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this.player);
      if (e._remove) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.hitboxes.length = 0;
  }
}

export { STATE };
