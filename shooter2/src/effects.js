// Visual juice: pooled particles (sparks, blood, smoke, debris), tracer rounds,
// bullet-hole decals, muzzle flashes and explosions. Heavily pooled for perf.
import * as THREE from 'three';
import { rand, randInt, Pool, clamp } from './util.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.particles = [];
    this.tracers = [];
    this.decals = [];
    this.flashes = [];
    this.maxDecals = 120;

    // Shared geometries/materials.
    this._sparkGeo = new THREE.SphereGeometry(0.05, 5, 4);
    this._decalGeo = new THREE.PlaneGeometry(0.28, 0.28);

    this._particlePool = new Pool(() => {
      const m = new THREE.Mesh(this._sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true }));
      m.visible = false; this.group.add(m); return m;
    });

    this._tracerPool = new Pool(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true }));
      line.visible = false; line.frustumCulled = false; this.group.add(line); return line;
    });

    this._decalMat = new THREE.MeshBasicMaterial({
      color: 0x080808, transparent: true, opacity: 0.9, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    });

    // Reusable muzzle light (only a couple active at once).
    this.muzzleLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffcc66, 0, 9, 2);
      l.visible = false; scene.add(l); this.muzzleLights.push({ light: l, t: 0 });
    }

    // Muzzle-flash meshes: a bright additive star + forward cone, picked up by
    // the bloom pass for a punchy glow. Pooled.
    this._flashGeoStar = new THREE.PlaneGeometry(0.14, 0.14);
    this._flashGeoCone = new THREE.ConeGeometry(0.045, 0.2, 7, 1, true);
    this._flashPool = new Pool(() => {
      const grp = new THREE.Group();
      const star = new THREE.Mesh(this._flashGeoStar, new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const cone = new THREE.Mesh(this._flashGeoCone, new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      cone.rotation.x = -Math.PI / 2; cone.position.z = -0.12;
      grp.add(star); grp.add(cone);
      grp.visible = false; this.group.add(grp);
      return grp;
    });
  }

  // Brief muzzle flash at the gun's muzzle, oriented down the shot direction.
  muzzleFlash(pos, dir, scale = 1) {
    const grp = this._flashPool.acquire();
    grp.visible = true;
    grp.position.copy(pos);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    grp.rotateZ(rand(0, Math.PI * 2));
    const s = scale * rand(0.85, 1.2);
    grp.scale.setScalar(s);
    grp.children[0].material.opacity = 1;
    grp.children[1].material.opacity = 0.9;
    this.flashes.push({ grp, life: 0.05, maxLife: 0.05 });
  }

  _spawnParticle(pos, vel, color, size, life, gravity = -9, fade = true, drag = 2) {
    const m = this._particlePool.acquire();
    m.visible = true;
    m.position.copy(pos);
    m.scale.setScalar(size / 0.05);
    m.material.color.setHex(color);
    m.material.opacity = 1;
    this.particles.push({ m, vel: vel.clone(), life, maxLife: life, gravity, fade, drag, size });
  }

  sparks(pos, normal, count = 10, color = 0xffcc55) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(
        normal.x + rand(-1, 1), normal.y + rand(-0.2, 1.2), normal.z + rand(-1, 1)
      ).normalize().multiplyScalar(rand(3, 9));
      this._spawnParticle(pos, v, color, rand(0.03, 0.07), rand(0.18, 0.4), -14, true, 3);
    }
    // a puff of smoke
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3(rand(-0.5, 0.5), rand(0.4, 1), rand(-0.5, 0.5));
      this._spawnParticle(pos, v, 0x55585c, rand(0.1, 0.2), rand(0.4, 0.8), 1.5, true, 1.5);
    }
  }

  blood(pos, dir, count = 14) {
    for (let i = 0; i < count; i++) {
      const v = dir.clone().multiplyScalar(rand(1, 4)).add(
        new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)));
      this._spawnParticle(pos, v, 0x9c1a14, rand(0.04, 0.09), rand(0.3, 0.6), -16, true, 2);
    }
    // mist
    for (let i = 0; i < 5; i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 2)).add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)));
      this._spawnParticle(pos, v, 0x6b0f0a, rand(0.06, 0.12), rand(0.2, 0.4), -3, true, 3);
    }
  }

  debris(pos, count = 8, color = 0x55585c) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(rand(-3, 3), rand(2, 7), rand(-3, 3));
      this._spawnParticle(pos, v, color, rand(0.05, 0.12), rand(0.5, 1.1), -16, true, 1);
    }
  }

  explosion(pos) {
    // Fireball
    for (let i = 0; i < 30; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14));
      const c = [0xffdd66, 0xff8833, 0xff5522][randInt(0, 2)];
      this._spawnParticle(pos, v, c, rand(0.15, 0.4), rand(0.3, 0.7), -2, true, 2.5);
    }
    // Smoke
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1)).multiplyScalar(rand(1, 4));
      this._spawnParticle(pos, v, 0x33353a, rand(0.3, 0.7), rand(0.8, 1.6), 1.2, true, 1.2);
    }
    // debris
    this.debris(pos, 16, 0x222);
    // flash light
    this.muzzleFlashLight(pos, 0xffaa44, 8, 0.3);
  }

  tracer(from, to, color = 0xfff0a0, life = 0.06) {
    const line = this._tracerPool.acquire();
    line.visible = true;
    const arr = line.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    line.geometry.attributes.position.needsUpdate = true;
    line.material.color.setHex(color);
    line.material.opacity = 0.9;
    this.tracers.push({ line, life, maxLife: life });
  }

  decal(pos, normal) {
    if (this.decals.length >= this.maxDecals) {
      const old = this.decals.shift();
      this.group.remove(old.mesh);
      old.mesh.geometry.dispose?.();
    }
    const mesh = new THREE.Mesh(this._decalGeo, this._decalMat.clone());
    mesh.position.copy(pos).addScaledVector(normal, 0.015);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.quaternion.copy(q);
    mesh.rotateZ(rand(0, Math.PI * 2));
    mesh.scale.setScalar(rand(0.7, 1.2));
    this.group.add(mesh);
    this.decals.push({ mesh, life: 16, maxLife: 16 });
  }

  muzzleFlashLight(pos, color = 0xffcc66, intensity = 4, life = 0.06) {
    for (const ml of this.muzzleLights) {
      if (!ml.light.visible) {
        ml.light.visible = true;
        ml.light.color.setHex(color);
        ml.light.intensity = intensity;
        ml.light.position.copy(pos);
        ml.t = life;
        ml.maxT = life;
        return;
      }
    }
  }

  update(dt) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.m.visible = false;
        this._particlePool.release(p.m);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.m.position.addScaledVector(p.vel, dt);
      if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.vel.y = 0; p.vel.multiplyScalar(0.6); }
      if (p.fade) {
        const t = p.life / p.maxLife;
        p.m.material.opacity = t;
        p.m.scale.setScalar((p.size / 0.05) * (0.5 + t * 0.5));
      }
    }
    // Tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.line.visible = false;
        this._tracerPool.release(t.line);
        this.tracers.splice(i, 1);
        continue;
      }
      t.line.material.opacity = (t.life / t.maxLife) * 0.9;
    }
    // Decals fade out near end of life
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        this.decals.splice(i, 1);
        continue;
      }
      if (d.life < 2) d.mesh.material.opacity = (d.life / 2) * 0.9;
    }
    // Muzzle lights
    for (const ml of this.muzzleLights) {
      if (ml.light.visible) {
        ml.t -= dt;
        ml.light.intensity = clamp((ml.t / ml.maxT), 0, 1) * ml.light.intensity;
        if (ml.t <= 0) { ml.light.visible = false; ml.light.intensity = 0; }
      }
    }
    // Muzzle flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.grp.visible = false;
        this._flashPool.release(f.grp);
        this.flashes.splice(i, 1);
        continue;
      }
      const t = f.life / f.maxLife;
      f.grp.children[0].material.opacity = t;
      f.grp.children[1].material.opacity = t * 0.9;
    }
  }

  clearTransient() {
    for (const p of this.particles) { p.m.visible = false; this._particlePool.release(p.m); }
    this.particles.length = 0;
    for (const t of this.tracers) { t.line.visible = false; this._tracerPool.release(t.line); }
    this.tracers.length = 0;
    for (const d of this.decals) this.group.remove(d.mesh);
    this.decals.length = 0;
    for (const f of this.flashes) { f.grp.visible = false; this._flashPool.release(f.grp); }
    this.flashes.length = 0;
  }
}
