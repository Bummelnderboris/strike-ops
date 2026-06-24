// The level: an industrial compound built from primitive geometry. Provides
// static collision boxes (AABBs), nav/cover/spawn points, lighting and atmosphere.
import * as THREE from 'three';
import { rand, randInt } from './util.js';

// Procedural noise-ish texture for surfaces (canvas based, no external files).
function makeNoiseTexture(base = '#3a3f47', spec = 0.12, size = 256, lines = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * spec; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = Math.random() * 0.18;
    g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  if (lines) {
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let i = 0; i <= size; i += size / 4) {
      g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];      // THREE.Box3[] static collision
    this.navPoints = [];      // {x,z} walkable waypoints for AI
    this.coverPoints = [];    // {pos:Vector3, normal:Vector3} cover spots
    this.spawnPoints = [];    // enemy spawn {x,z}
    this.objectivePoints = []; // capture zones for Operation mode
    this.lights = [];
    this.alarmLights = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bounds = new THREE.Box3(
      new THREE.Vector3(-60, -1, -60),
      new THREE.Vector3(60, 30, 60)
    );
    this._buildMaterials();
    this._buildSky();
    this._buildLighting();
    this._buildLevel();
  }

  _buildMaterials() {
    const floorTex = makeNoiseTexture('#23262c', 0.14, 256, true);
    floorTex.repeat.set(40, 40);
    this.mat = {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.05, color: 0x444c5a }),
      wall: new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#41464e', 0.1), roughness: 0.85, metalness: 0.1, color: 0x4a4f57 }),
      metal: new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#5a5f66', 0.08), roughness: 0.5, metalness: 0.7, color: 0x6a7078 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.6 }),
      crate: new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#6b5733', 0.12), roughness: 0.8, metalness: 0.1, color: 0x7a6238 }),
      crateMil: new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#3c4a37', 0.1), roughness: 0.8, color: 0x46553f }),
      barrel: new THREE.MeshStandardMaterial({ color: 0xb33b2b, roughness: 0.55, metalness: 0.35 }),
      barrelBlue: new THREE.MeshStandardMaterial({ color: 0x2b6bb3, roughness: 0.55, metalness: 0.35 }),
      concrete: new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#3a3e44', 0.12), roughness: 0.95, color: 0x42464c }),
      glassEmis: new THREE.MeshStandardMaterial({ color: 0x0a0d12, emissive: 0x123040, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.2 }),
      pipe: new THREE.MeshStandardMaterial({ color: 0x555b62, roughness: 0.4, metalness: 0.8 }),
      sign: new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0xff3322, emissiveIntensity: 1.6 }),
      signCyan: new THREE.MeshStandardMaterial({ color: 0x081014, emissive: 0x33d6ff, emissiveIntensity: 1.4 }),
      grate: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.6, metalness: 0.6 }),
    };
  }

  _buildSky() {
    // Gradient sky dome via shader-free vertex colors on a big sphere.
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const top = new THREE.Color(0x0a1420), bot = new THREE.Color(0x1c2230), horizon = new THREE.Color(0x39414f);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 400;
      const t = Math.max(0, y);
      const c = new THREE.Color().copy(bot).lerp(horizon, 1 - Math.abs(y)).lerp(top, Math.max(0, y));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.scene.add(new THREE.Mesh(geo, mat));

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 1200; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.05, 1), rand(-1, 1)).normalize().multiplyScalar(380);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb3c8, size: 1.1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    this.scene.add(stars);

    // Fog for depth/atmosphere
    this.scene.fog = new THREE.FogExp2(0x121826, 0.0085);
  }

  _buildLighting() {
    const hemi = new THREE.HemisphereLight(0x8aa2bd, 0x222833, 1.6);
    this.scene.add(hemi);
    // Soft ambient so deep shadows still read on a night map.
    this.scene.add(new THREE.AmbientLight(0x4a5a70, 0.6));

    // Moonlight key (directional, shadow-casting).
    const moon = new THREE.DirectionalLight(0xb8d2ee, 1.8);
    moon.position.set(40, 60, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const d = 70;
    moon.shadow.camera.left = -d; moon.shadow.camera.right = d;
    moon.shadow.camera.top = d; moon.shadow.camera.bottom = -d;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 180;
    moon.shadow.bias = -0.0008;
    this.scene.add(moon);
    this.moon = moon;
  }

  _addCollider(mesh) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    this.colliders.push(box);
    return box;
  }

  _box(w, h, d, x, y, z, mat, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.ry) m.rotation.y = opts.ry;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    this.group.add(m);
    if (opts.collide !== false) this._addCollider(m);
    return m;
  }

  _lamp(x, z, color = 0xffd9a0, intensity = 3.2, height = 7) {
    // Pole
    this._box(0.18, height, 0.18, x, height / 2, z, this.mat.pipe, { cast: false });
    this._box(0.8, 0.12, 0.4, x, height, z + 0.2, this.mat.darkMetal, { cast: false, collide: false });
    const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: color, emissiveIntensity: 2 }));
    lampMesh.position.set(x, height - 0.05, z + 0.35);
    this.group.add(lampMesh);
    const light = new THREE.PointLight(color, intensity, 30, 1.7);
    light.position.set(x, height - 0.3, z + 0.35);
    this.scene.add(light);
    this.lights.push(light);
  }

  _alarmLight(x, y, z) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 1 }));
    m.position.set(x, y, z);
    this.group.add(m);
    const l = new THREE.PointLight(0xff1100, 0.0, 16, 2);
    l.position.set(x, y, z);
    this.scene.add(l);
    this.alarmLights.push({ light: l, mesh: m, phase: rand(0, 6.28) });
  }

  _crate(x, z, size = 1.4, military = false) {
    const m = this._box(size, size, size, x, size / 2, z, military ? this.mat.crateMil : this.mat.crate, { ry: rand(-0.2, 0.2) });
    this.coverPoints.push({ pos: new THREE.Vector3(x, 0, z), size });
    return m;
  }

  _barrel(x, z, blue = false) {
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14);
    const m = new THREE.Mesh(geo, blue ? this.mat.barrelBlue : this.mat.barrel);
    m.position.set(x, 0.55, z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    const box = new THREE.Box3().setFromObject(m);
    this.colliders.push(box);
    this.coverPoints.push({ pos: new THREE.Vector3(x, 0, z), size: 0.9 });
    // explosive flag for red barrels
    return { mesh: m, explosive: !blue, x, z };
  }

  _container(x, z, ry, color) {
    const w = 6, h = 2.6, d = 2.5;
    const mat = new THREE.MeshStandardMaterial({ map: makeNoiseTexture('#2c3a4a', 0.1), color, roughness: 0.7, metalness: 0.3 });
    const m = this._box(w, h, d, x, h / 2, z, mat, { ry });
    // ridges
    this.coverPoints.push({ pos: new THREE.Vector3(x, 0, z), size: 3 });
    return m;
  }

  _buildLevel() {
    const M = this.mat;
    // ---- Ground ----
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), M.floor);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // ---- Perimeter wall ----
    const PW = 50, WH = 6;
    this._box(PW * 2, WH, 1, 0, WH / 2, -PW, M.wall);
    this._box(PW * 2, WH, 1, 0, WH / 2, PW, M.wall);
    this._box(1, WH, PW * 2, -PW, WH / 2, 0, M.wall);
    this._box(1, WH, PW * 2, PW, WH / 2, 0, M.wall);
    // corner towers
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this._box(3, 9, 3, sx * (PW - 1.5), 4.5, sz * (PW - 1.5), M.concrete);
    }

    // ---- Central warehouse (big shed with interior) ----
    const wx = -14, wz = -10, ww = 24, wd = 20, wh = 8;
    // walls with a doorway gap on +z and +x
    this._box(ww, wh, 0.6, wx, wh / 2, wz - wd / 2, M.wall); // back
    // front wall split for entrance
    this._box(8, wh, 0.6, wx - 8, wh / 2, wz + wd / 2, M.wall);
    this._box(8, wh, 0.6, wx + 8, wh / 2, wz + wd / 2, M.wall);
    this._box(0.6, wh, wd, wx - ww / 2, wh / 2, wz, M.wall); // left
    // right wall split for side entrance
    this._box(0.6, wh, 6, wx + ww / 2, wh / 2, wz - 7, M.wall);
    this._box(0.6, wh, 6, wx + ww / 2, wh / 2, wz + 7, M.wall);
    // roof
    this._box(ww + 1, 0.5, wd + 1, wx, wh, wz, M.metal, { cast: true });
    // interior pillars
    for (const px of [-6, 6]) for (const pz of [-5, 5]) {
      this._box(0.7, wh, 0.7, wx + px, wh / 2, wz + pz, M.concrete);
    }
    // warehouse shelving / cover inside
    this._crate(wx - 7, wz - 6, 1.6, true);
    this._crate(wx - 7, wz - 4.4, 1.6, true);
    this._crate(wx + 7, wz + 5, 1.6, true);
    this._crate(wx + 4, wz - 6, 1.4, true);
    this._crate(wx, wz, 1.8, true);
    this._crate(wx + 1.6, wz, 1.4, true);

    // ---- Elevated catwalk / gantry along the east side ----
    const gw = 3, gh = 3.2, gz0 = -16, gz1 = 16;
    const gantryX = 16;
    const catwalk = this._box(gw, 0.3, gz1 - gz0, gantryX, gh, (gz0 + gz1) / 2, M.grate, { receive: true });
    // railings (non-colliding visual)
    for (const off of [-gw / 2, gw / 2]) {
      const rail = this._box(0.08, 1, gz1 - gz0, gantryX + off, gh + 0.6, (gz0 + gz1) / 2, M.pipe, { collide: false, cast: false });
    }
    // support posts
    for (let z = gz0; z <= gz1; z += 4) this._box(0.3, gh, 0.3, gantryX, gh / 2, z, M.pipe, { collide: false });
    // ramp up to catwalk
    const ramp = this._box(3, 0.3, 6, gantryX - 3, gh - 1.2, gz1 - 3, M.grate, { collide: true });
    ramp.rotation.x = -0.32; ramp.updateMatrixWorld(true);
    // stairs collider approximated by a slope box already added
    this.navPoints.push({ x: gantryX, z: 0, y: gh }, { x: gantryX, z: -10, y: gh }, { x: gantryX, z: 10, y: gh });

    // ---- Server room (glowing) on the west ----
    const sx = -34, sz = 12, sw = 12, sd = 12, sh = 5;
    this._box(sw, sh, 0.4, sx, sh / 2, sz - sd / 2, M.concrete);
    this._box(0.4, sh, sd, sx - sw / 2, sh / 2, sz, M.concrete);
    this._box(0.4, sh, sd, sx + sw / 2, sh / 2, sz, M.concrete);
    this._box(sw, sh, 0.4, sx - 3, sh / 2, sz + sd / 2, M.concrete); // partial front
    this._box(sw + 0.5, 0.4, sd + 0.5, sx, sh, sz, M.metal);
    // server racks (emissive)
    for (let i = 0; i < 4; i++) {
      const rk = this._box(1, 3.2, 2, sx - 4 + i * 2.4, 1.6, sz - 3, M.glassEmis);
      const rl = new THREE.PointLight(0x33d6ff, 0.5, 6, 2);
      rl.position.set(sx - 4 + i * 2.4, 2, sz - 1.5);
      this.scene.add(rl); this.lights.push(rl);
    }
    this.objectivePoints.push({ pos: new THREE.Vector3(sx, 0, sz), radius: 5, name: 'SERVER VAULT' });

    // ---- Shipping containers cluster (cover maze) ----
    this._container(20, 18, 0.2, 0x9c4a3a);
    this._container(26, 16, -0.4, 0x3a6a9c);
    this._container(24, 24, 1.2, 0x6a8c4a);
    this._container(-30, -18, 0.1, 0x9c8a3a);
    this._container(-24, -22, 0.9, 0x4a4a5c);
    this.objectivePoints.push({ pos: new THREE.Vector3(24, 0, 20), radius: 5, name: 'CARGO YARD' });

    // ---- Scattered cover: crates & barrels around courtyard ----
    const coverSpots = [
      [4, 6], [8, 10], [-4, 14], [12, -6], [-10, 18], [18, -14], [-18, 6],
      [2, -16], [-6, -8], [10, 20], [-16, -6], [30, -4], [-30, 20], [6, -22],
    ];
    for (const [x, z] of coverSpots) this._crate(x, z, rand(1.2, 1.7), Math.random() > 0.5);
    const barrelSpots = [[5, 7], [9, 9], [-5, 13], [13, -5], [-11, 17], [3, -15], [-7, -7], [31, -3]];
    this.barrels = [];
    for (const [x, z] of barrelSpots) this.barrels.push(this._barrel(x + rand(-0.5, 0.5), z + rand(-0.5, 0.5), Math.random() > 0.7));

    // ---- Pipes overhead for visual richness ----
    for (let i = 0; i < 6; i++) {
      const px = rand(-40, 40);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, rand(8, 20), 8), M.pipe);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(px, rand(7, 9), rand(-40, 40));
      pipe.castShadow = true;
      this.group.add(pipe);
    }

    // ---- Lamps ----
    this._lamp(-8, 8); this._lamp(14, -8); this._lamp(-20, -14, 0xfff0d0);
    this._lamp(22, 22, 0xffd9a0); this._lamp(-34, 24, 0x33d6ff, 1.8, 6);
    this._lamp(0, 30); this._lamp(34, 0);

    // ---- Alarm lights on walls ----
    this._alarmLight(-14, 7.5, 0); this._alarmLight(16, 4, -16); this._alarmLight(16, 4, 16);
    this._alarmLight(-34, 4.5, 6); this._alarmLight(0, 5, -49);

    // ---- Signage ----
    const sign1 = this._box(4, 1.2, 0.2, -14, 8.5, 0.2, M.sign, { collide: false, cast: false });
    const sign2 = this._box(3, 0.9, 0.2, -34, 5.2, 6, M.signCyan, { collide: false, cast: false });

    // ---- Nav grid + spawn points ----
    for (let x = -42; x <= 42; x += 7) {
      for (let z = -42; z <= 42; z += 7) {
        if (this._pointBlocked(x, z, 0.8)) continue;
        this.navPoints.push({ x, z, y: 0 });
      }
    }
    // Spawn points along the perimeter, in cover-ish zones.
    const spawns = [
      [-44, -44], [44, -44], [-44, 44], [44, 44], [0, -46], [0, 46], [-46, 0], [46, 0],
      [-40, 30], [40, -30], [30, 40], [-30, -40], [44, 12], [-44, -12], [12, 44], [-12, -44],
    ];
    for (const [x, z] of spawns) {
      if (!this._pointBlocked(x, z, 1)) this.spawnPoints.push({ x, z });
    }
    this.objectivePoints.push({ pos: new THREE.Vector3(0, 0, 0), radius: 6, name: 'CENTRAL YARD' });
  }

  _pointBlocked(x, z, r = 0.5) {
    for (const c of this.colliders) {
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z && c.min.y < 2.5) return true;
    }
    return false;
  }

  // Player spawn — a safe-ish point in the courtyard.
  get playerSpawn() { return new THREE.Vector3(0, 1.7, 22); }

  update(dt, alarmActive) {
    // Pulse alarm lights when active.
    for (const a of this.alarmLights) {
      if (alarmActive) {
        a.phase += dt * 6;
        const v = (Math.sin(a.phase) * 0.5 + 0.5);
        a.light.intensity = v * 3.0;
        a.mesh.material.emissiveIntensity = 0.3 + v * 2;
      } else {
        a.light.intensity *= (1 - dt * 4);
        a.mesh.material.emissiveIntensity = 0.4;
      }
    }
  }
}
