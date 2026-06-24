/* ============================================================================
   STRIKE OPS — lightweight 2-player local deathmatch
   Top-down tactical shooter. Two players, one keyboard. No dependencies.
   ========================================================================== */

(() => {
"use strict";

/* ----------------------------------------------------------------------------
   Canvas / constants
---------------------------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 1280
const H = canvas.height;  // 720

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; };

/* ----------------------------------------------------------------------------
   Audio — tiny WebAudio synth (no asset files)
---------------------------------------------------------------------------- */
const Sound = (() => {
  let ac = null;
  const ensure = () => { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); return ac; };
  function tone(type, freq, dur, gain, slideTo) {
    const a = ensure();
    const t = a.currentTime;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t); osc.stop(t + dur);
  }
  function noise(dur, gain, lp) {
    const a = ensure();
    const t = a.currentTime;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const filter = a.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = lp || 3000;
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  }
  return {
    resume(){ try { ensure(); if (ac.state === "suspended") ac.resume(); } catch(e){} },
    shoot(kind){
      if (kind === "shotgun") noise(0.18, 0.35, 1600);
      else if (kind === "rifle"){ tone("square", 320, 0.07, 0.22, 120); noise(0.07, 0.2, 4000); }
      else if (kind === "smg"){ tone("square", 480, 0.04, 0.16, 220); noise(0.04, 0.12, 5000); }
      else { tone("square", 260, 0.08, 0.2, 90); noise(0.06, 0.15, 3000); }
    },
    hit(){ noise(0.06, 0.25, 2500); tone("triangle", 180, 0.05, 0.12, 80); },
    reload(){ tone("sine", 140, 0.05, 0.15, 220); setTimeout(()=>tone("sine", 220, 0.05, 0.15, 140), 90); },
    pickup(){ tone("sine", 520, 0.08, 0.2, 880); setTimeout(()=>tone("sine", 880, 0.1, 0.18, 1200), 70); },
    death(){ tone("sawtooth", 200, 0.5, 0.3, 40); noise(0.4, 0.25, 1200); },
    dash(){ noise(0.12, 0.18, 1800); }
  };
})();

/* ----------------------------------------------------------------------------
   Weapons
---------------------------------------------------------------------------- */
const WEAPONS = {
  pistol:  { name:"PISTOL",  dmg:18, rate:0.28, mag:12, reload:1.1, speed:780, spread:0.03, pellets:1, life:1.0, knock:90,  col:"#ffd479" },
  smg:     { name:"SMG",     dmg:11, rate:0.07, mag:30, reload:1.4, speed:880, spread:0.10, pellets:1, life:0.8, knock:50,  col:"#9fffb0" },
  shotgun: { name:"SHOTGUN", dmg:9,  rate:0.75, mag:6,  reload:1.8, speed:760, spread:0.26, pellets:8, life:0.45,knock:160, col:"#ff9d5c" },
  rifle:   { name:"RIFLE",   dmg:34, rate:0.5,  mag:8,  reload:1.6, speed:1300,spread:0.012,pellets:1, life:1.4, knock:120, col:"#7fd0ff" },
};
const WEAPON_CYCLE = ["smg","shotgun","rifle"]; // crates hand out these; pistol is the default fallback

/* ----------------------------------------------------------------------------
   Map — static arena with cover. (x,y,w,h) rectangles.
---------------------------------------------------------------------------- */
const WALL_T = 22; // outer wall thickness
const walls = [
  // border
  {x:0, y:0, w:W, h:WALL_T},
  {x:0, y:H-WALL_T, w:W, h:WALL_T},
  {x:0, y:0, w:WALL_T, h:H},
  {x:W-WALL_T, y:0, w:WALL_T, h:H},

  // central bunker (hollow-ish cross of cover)
  {x:560, y:300, w:160, h:120},

  // four inner pillars
  {x:340, y:170, w:90, h:40},
  {x:850, y:170, w:90, h:40},
  {x:340, y:510, w:90, h:40},
  {x:850, y:510, w:90, h:40},

  // side cover walls
  {x:170, y:300, w:40, h:120},
  {x:1070, y:300, w:40, h:120},
  {x:560, y:90, w:160, h:40},
  {x:560, y:590, w:160, h:40},

  // diagonal-ish staggered crates
  {x:470, y:240, w:46, h:46},
  {x:764, y:240, w:46, h:46},
  {x:470, y:434, w:46, h:46},
  {x:764, y:434, w:46, h:46},
];

const SPAWNS = [
  {x:90,  y:90},  {x:90,  y:H-90},
  {x:W-90,y:90},  {x:W-90,y:H-90},
  {x:W/2, y:90},  {x:W/2, y:H-90},
];

// Pickup pads: weapon crates + med kits at fixed positions
const PICKUP_PADS = [
  {x:W/2, y:H/2-150, type:"weapon"},
  {x:W/2, y:H/2+150, type:"weapon"},
  {x:250, y:H/2,     type:"med"},
  {x:W-250, y:H/2,   type:"med"},
  {x:W/2-360, y:120, type:"weapon"},
  {x:W/2+360, y:H-120, type:"weapon"},
];

/* circle (cx,cy,r) vs rect collision → returns push-out vector or null */
function resolveCircleRect(cx, cy, r, rect){
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx*dx + dy*dy;
  if (d2 > r*r) return null;
  const d = Math.sqrt(d2) || 0.0001;
  if (d2 === 0) {
    // center inside rect — push out along smallest axis
    const left = cx - rect.x, right = rect.x + rect.w - cx;
    const top = cy - rect.y, bottom = rect.y + rect.h - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left)   return {x:-(r+left),   y:0};
    if (m === right)  return {x: (r+right),  y:0};
    if (m === top)    return {x:0, y:-(r+top)};
    return {x:0, y:(r+bottom)};
  }
  const overlap = r - d;
  return {x: (dx/d)*overlap, y: (dy/d)*overlap};
}

/* segment vs rect — for bullet hits against walls */
function pointInAnyWall(x, y){
  for (const w of walls) if (x>=w.x && x<=w.x+w.w && y>=w.y && y<=w.y+w.h) return true;
  return false;
}

/* ----------------------------------------------------------------------------
   Entities
---------------------------------------------------------------------------- */
class Player {
  constructor(id, color, controls, spawn, facing){
    this.id = id;
    this.color = color;
    this.controls = controls;
    this.r = 16;
    this.maxHp = 100;
    this.kills = 0;
    this.deaths = 0;
    this.faceDefault = facing;
    this.respawn(spawn, true);
  }
  respawn(spawn, instant){
    this.x = spawn.x; this.y = spawn.y;
    this.vx = 0; this.vy = 0;
    this.hp = this.maxHp;
    this.face = this.faceDefault;
    this.weapon = "pistol";
    this.ammo = WEAPONS.pistol.mag;
    this.reloading = 0;
    this.cooldown = 0;
    this.dashCd = 0;
    this.dashTime = 0;
    this.spawnGuard = instant ? 2.5 : 2.2;
    this.dead = false;
    this.deadTimer = 0;
    this.muzzle = 0;
  }
  get spec(){ return WEAPONS[this.weapon]; }
}

class Bullet {
  constructor(x, y, vx, vy, owner, dmg, life, knock, col){
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.owner=owner; this.dmg=dmg; this.life=life; this.knock=knock; this.col=col;
    this.dead=false; this.r=3;
  }
}

class Particle {
  constructor(x,y,vx,vy,life,col,size,fade){
    this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.life=life;this.max=life;
    this.col=col;this.size=size;this.fade=fade!==false;
  }
}

class Pickup {
  constructor(pad){
    this.pad = pad;
    this.type = pad.type;   // "weapon" | "med"
    this.x = pad.x; this.y = pad.y;
    this.r = 18;
    this.active = true;
    this.timer = 0;          // respawn countdown when inactive
    this.bob = Math.random()*TAU;
    this.weapon = pad.type === "weapon" ? WEAPON_CYCLE[Math.floor(Math.random()*WEAPON_CYCLE.length)] : null;
  }
  take(){
    this.active = false;
    this.timer = this.type === "med" ? 9 : 7;
  }
  tick(dt){
    this.bob += dt*3;
    if (!this.active){
      this.timer -= dt;
      if (this.timer <= 0){
        this.active = true;
        if (this.type === "weapon")
          this.weapon = WEAPON_CYCLE[Math.floor(Math.random()*WEAPON_CYCLE.length)];
      }
    }
  }
}

/* ----------------------------------------------------------------------------
   Game state
---------------------------------------------------------------------------- */
const Game = {
  state: "menu",        // menu | playing | paused | over
  players: [],
  bullets: [],
  particles: [],
  pickups: [],
  shake: 0,
  killTarget: 15,
  winner: null,
  hitMarks: [],         // floating "+/-" text feedback
};

const keys = Object.create(null);

const CONTROLS = {
  p1: { up:"KeyW", down:"KeyS", left:"KeyA", right:"KeyD", shoot:"Space", reload:"KeyR", dash:"ShiftLeft" },
  p2: { up:"ArrowUp", down:"ArrowDown", left:"ArrowLeft", right:"ArrowRight", shoot:"Period", reload:"Comma", dash:"Slash" },
};

function newMatch(){
  Game.players = [
    new Player(1, getCss("--d1") || "#4ea8ff", CONTROLS.p1, SPAWNS[0], 0),
    new Player(2, getCss("--d2") || "#ff5d5d", CONTROLS.p2, SPAWNS[3], Math.PI),
  ];
  Game.bullets = [];
  Game.particles = [];
  Game.pickups = PICKUP_PADS.map(p => new Pickup(p));
  Game.shake = 0;
  Game.winner = null;
  Game.hitMarks = [];
}

function getCss(varName){
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function farthestSpawn(){
  // pick spawn farthest from both living players
  let best = SPAWNS[0], bestScore = -1;
  for (const s of SPAWNS){
    let score = Infinity;
    for (const p of Game.players){
      if (p.dead) continue;
      score = Math.min(score, dist2(s.x, s.y, p.x, p.y));
    }
    if (score === Infinity) score = 0;
    if (score > bestScore){ bestScore = score; best = s; }
  }
  return best;
}

/* ----------------------------------------------------------------------------
   Update
---------------------------------------------------------------------------- */
function update(dt){
  for (const p of Game.players) updatePlayer(p, dt);
  updateBullets(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateHitMarks(dt);
  Game.shake = Math.max(0, Game.shake - dt * 60);

  // win check
  for (const p of Game.players){
    if (p.kills >= Game.killTarget){ endMatch(p); break; }
  }
}

function updatePlayer(p, dt){
  if (p.dead){
    p.deadTimer -= dt;
    if (p.deadTimer <= 0) p.respawn(farthestSpawn(), false);
    return;
  }

  const c = p.controls;
  let ix = (keys[c.right]?1:0) - (keys[c.left]?1:0);
  let iy = (keys[c.down]?1:0) - (keys[c.up]?1:0);
  const moving = ix || iy;

  if (moving){
    const len = Math.hypot(ix, iy) || 1;
    ix/=len; iy/=len;
    p.face = Math.atan2(iy, ix);
  }

  const baseSpeed = 250;
  // dash
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);
  if (keys[c.dash] && p.dashCd <= 0 && moving){
    p.dashTime = 0.16;
    p.dashCd = 1.4;
    Sound.dash();
    for (let i=0;i<8;i++)
      Game.particles.push(new Particle(p.x, p.y, rand(-40,40), rand(-40,40), rand(0.2,0.4), "#cfe6ff", rand(2,4)));
  }
  const speed = baseSpeed * (p.dashTime>0 ? 3.0 : 1);

  const nx = p.x + (moving ? ix*speed*dt : 0);
  const ny = p.y + (moving ? iy*speed*dt : 0);
  p.x = nx; p.y = ny;

  // wall collisions
  for (const w of walls){
    const push = resolveCircleRect(p.x, p.y, p.r, w);
    if (push){ p.x += push.x; p.y += push.y; }
  }
  // player-vs-player soft collision
  for (const o of Game.players){
    if (o === p || o.dead) continue;
    const d = Math.hypot(p.x-o.x, p.y-o.y);
    const min = p.r + o.r;
    if (d < min && d > 0){
      const push = (min - d)/2;
      const ux = (p.x-o.x)/d, uy=(p.y-o.y)/d;
      p.x += ux*push; p.y += uy*push;
      o.x -= ux*push; o.y -= uy*push;
    }
  }
  p.x = clamp(p.x, p.r, W-p.r);
  p.y = clamp(p.y, p.r, H-p.r);

  // timers
  p.spawnGuard = Math.max(0, p.spawnGuard - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.muzzle = Math.max(0, p.muzzle - dt);

  // reloading
  if (p.reloading > 0){
    p.reloading -= dt;
    if (p.reloading <= 0){ p.ammo = p.spec.mag; }
  }
  if (keys[c.reload] && p.reloading <= 0 && p.ammo < p.spec.mag){
    p.reloading = p.spec.reload;
    Sound.reload();
  }

  // shooting
  if (keys[c.shoot] && p.cooldown <= 0 && p.reloading <= 0){
    if (p.ammo > 0) fire(p);
    else { p.reloading = p.spec.reload; Sound.reload(); } // auto-reload on empty
  }
}

function fire(p){
  const s = p.spec;
  p.cooldown = s.rate;
  p.ammo--;
  p.muzzle = 0.05;
  p.spawnGuard = 0; // firing drops your spawn protection
  Sound.shoot(p.weapon);

  const mx = p.x + Math.cos(p.face)*(p.r+8);
  const my = p.y + Math.sin(p.face)*(p.r+8);
  for (let i=0;i<s.pellets;i++){
    const a = p.face + rand(-s.spread, s.spread);
    const vx = Math.cos(a)*s.speed, vy = Math.sin(a)*s.speed;
    Game.bullets.push(new Bullet(mx, my, vx, vy, p, s.dmg, s.life, s.knock, s.col));
  }
  // recoil kick
  p.x -= Math.cos(p.face)*3;
  p.y -= Math.sin(p.face)*3;

  // muzzle flash particles
  for (let i=0;i<4;i++)
    Game.particles.push(new Particle(mx, my, Math.cos(p.face)*rand(60,180)+rand(-40,40), Math.sin(p.face)*rand(60,180)+rand(-40,40), rand(0.06,0.16), s.col, rand(2,4)));
  Game.shake = Math.min(10, Game.shake + (p.weapon==="shotgun"?6:p.weapon==="rifle"?5:2));
}

function updateBullets(dt){
  for (const b of Game.bullets){
    b.life -= dt;
    if (b.life <= 0){ b.dead = true; continue; }
    const steps = 3; // sub-step for fast bullets to avoid tunneling
    const sdt = dt/steps;
    for (let s=0;s<steps && !b.dead;s++){
      b.x += b.vx*sdt; b.y += b.vy*sdt;
      // wall hit
      if (pointInAnyWall(b.x, b.y)){
        b.dead = true;
        for (let i=0;i<6;i++)
          Game.particles.push(new Particle(b.x, b.y, rand(-90,90), rand(-90,90), rand(0.1,0.3), "#b9c4d4", rand(1.5,3)));
        break;
      }
      // player hit
      for (const p of Game.players){
        if (p === b.owner || p.dead || p.spawnGuard>0) continue;
        if (dist2(b.x,b.y,p.x,p.y) <= (p.r+b.r)*(p.r+b.r)){
          damagePlayer(p, b.dmg, b.owner, b);
          b.dead = true;
          break;
        }
      }
    }
  }
  Game.bullets = Game.bullets.filter(b => !b.dead && b.x>0 && b.x<W && b.y>0 && b.y<H);
}

function damagePlayer(p, dmg, attacker, b){
  p.hp -= dmg;
  Sound.hit();
  Game.shake = Math.min(12, Game.shake + 3);
  // knockback
  const d = Math.hypot(b.vx, b.vy) || 1;
  p.x += (b.vx/d) * (b.knock*0.05);
  p.y += (b.vy/d) * (b.knock*0.05);
  // blood
  for (let i=0;i<10;i++)
    Game.particles.push(new Particle(p.x, p.y, b.vx/d*rand(40,160)+rand(-50,50), b.vy/d*rand(40,160)+rand(-50,50), rand(0.2,0.5), "#ff4040", rand(2,4)));
  if (p.hp <= 0) killPlayer(p, attacker);
}

function killPlayer(p, attacker){
  p.dead = true;
  p.deadTimer = 1.6;
  p.deaths++;
  if (attacker && attacker !== p) attacker.kills++;
  Sound.death();
  Game.shake = 14;
  for (let i=0;i<26;i++)
    Game.particles.push(new Particle(p.x, p.y, rand(-220,220), rand(-220,220), rand(0.3,0.8), Math.random()<0.6?"#ff3030":p.color, rand(2,5)));
  Game.hitMarks.push({x:p.x, y:p.y-30, txt:"ELIMINATED", life:1.4, col:attacker?attacker.color:"#fff"});
}

function updatePickups(dt){
  for (const k of Game.pickups){
    k.tick(dt);
    if (!k.active) continue;
    for (const p of Game.players){
      if (p.dead) continue;
      if (dist2(k.x,k.y,p.x,p.y) <= (k.r+p.r)*(k.r+p.r)){
        if (k.type === "med"){
          if (p.hp < p.maxHp){
            p.hp = Math.min(p.maxHp, p.hp + 45);
            k.take(); Sound.pickup();
            Game.hitMarks.push({x:p.x, y:p.y-30, txt:"+45 HP", life:0.9, col:"#7dff9b"});
          }
        } else {
          p.weapon = k.weapon;
          p.ammo = WEAPONS[k.weapon].mag;
          p.reloading = 0;
          k.take(); Sound.pickup();
          Game.hitMarks.push({x:p.x, y:p.y-30, txt:WEAPONS[k.weapon].name, life:0.9, col:WEAPONS[k.weapon].col});
        }
      }
    }
  }
}

function updateParticles(dt){
  for (const pt of Game.particles){
    pt.life -= dt;
    pt.x += pt.vx*dt; pt.y += pt.vy*dt;
    pt.vx *= 0.92; pt.vy *= 0.92;
  }
  Game.particles = Game.particles.filter(p => p.life > 0);
}

function updateHitMarks(dt){
  for (const h of Game.hitMarks){ h.life -= dt; h.y -= 24*dt; }
  Game.hitMarks = Game.hitMarks.filter(h => h.life > 0);
}

/* ----------------------------------------------------------------------------
   Render
---------------------------------------------------------------------------- */
function render(){
  ctx.save();
  // screen shake
  if (Game.shake > 0)
    ctx.translate(rand(-Game.shake,Game.shake)*0.5, rand(-Game.shake,Game.shake)*0.5);

  drawFloor();
  drawPickups();
  drawWalls();
  drawParticles();
  drawBullets();
  for (const p of Game.players) drawPlayer(p);
  drawHitMarks();
  ctx.restore();

  drawHUD();
}

function drawFloor(){
  ctx.fillStyle = "#10151d";
  ctx.fillRect(0,0,W,H);
  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x=0;x<=W;x+=40){ ctx.moveTo(x,0); ctx.lineTo(x,H); }
  for (let y=0;y<=H;y+=40){ ctx.moveTo(0,y); ctx.lineTo(W,y); }
  ctx.stroke();
  // center marking
  ctx.strokeStyle = "rgba(120,160,210,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W/2,H/2,90,0,TAU); ctx.stroke();
}

function drawWalls(){
  for (const w of walls){
    const grd = ctx.createLinearGradient(w.x, w.y, w.x, w.y+w.h);
    grd.addColorStop(0, "#2c3a52");
    grd.addColorStop(1, "#1d2738");
    ctx.fillStyle = grd;
    roundRect(w.x, w.y, w.w, w.h, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,160,210,0.25)";
    ctx.lineWidth = 1.5;
    roundRect(w.x+0.5, w.y+0.5, w.w-1, w.h-1, 4);
    ctx.stroke();
  }
}

function drawPickups(){
  for (const k of Game.pickups){
    if (!k.active) {
      // pad outline only
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = k.type==="med" ? "#7dff9b" : "#ffd479";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    const bob = Math.sin(k.bob)*3;
    ctx.save();
    ctx.translate(k.x, k.y+bob);
    // glow
    const col = k.type==="med" ? "#7dff9b" : (WEAPONS[k.weapon]?.col || "#ffd479");
    ctx.shadowColor = col; ctx.shadowBlur = 18;
    ctx.fillStyle = "#0c121a";
    roundRect(-k.r, -k.r, k.r*2, k.r*2, 6); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    roundRect(-k.r, -k.r, k.r*2, k.r*2, 6); ctx.stroke();
    // icon
    ctx.fillStyle = col;
    if (k.type === "med"){
      ctx.fillRect(-3,-9,6,18); ctx.fillRect(-9,-3,18,6);
    } else {
      ctx.font = "bold 11px Segoe UI";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(WEAPONS[k.weapon].name.slice(0,3), 0, 0);
    }
    ctx.restore();
  }
}

function drawBullets(){
  for (const b of Game.bullets){
    ctx.strokeStyle = b.col;
    ctx.lineWidth = 3;
    ctx.shadowColor = b.col; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx*0.012, b.y - b.vy*0.012);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawParticles(){
  for (const p of Game.particles){
    ctx.globalAlpha = clamp(p.life/p.max, 0, 1);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(p){
  if (p.dead){
    // death marker
    ctx.globalAlpha = clamp(p.deadTimer/1.6, 0, 1)*0.6;
    ctx.strokeStyle = p.color; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x-10,p.y-10); ctx.lineTo(p.x+10,p.y+10);
    ctx.moveTo(p.x+10,p.y-10); ctx.lineTo(p.x-10,p.y+10);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  ctx.save();
  ctx.translate(p.x, p.y);

  // spawn protection ring
  if (p.spawnGuard > 0){
    ctx.globalAlpha = 0.4 + Math.sin(performance.now()/100)*0.2;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0,0,p.r+6,0,TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.rotate(p.face);

  // muzzle flash
  if (p.muzzle > 0){
    ctx.fillStyle = "#fff3b0";
    ctx.beginPath();
    ctx.arc(p.r+12, 0, 7, 0, TAU); ctx.fill();
  }

  // gun barrel
  ctx.fillStyle = "#11161e";
  ctx.fillRect(p.r-2, -3, 18, 6);

  // body
  ctx.shadowColor = p.color; ctx.shadowBlur = 12;
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(0,0,p.r,0,TAU); ctx.fill();
  ctx.shadowBlur = 0;
  // inner
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.arc(0,0,p.r*0.55,0,TAU); ctx.fill();
  // facing notch
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(p.r*0.5, 0, 3, 0, TAU); ctx.fill();

  ctx.restore();

  // health bar above head
  const bw = 38, bh = 5;
  const hx = p.x - bw/2, hy = p.y - p.r - 14;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(hx-1, hy-1, bw+2, bh+2);
  const frac = clamp(p.hp/p.maxHp, 0, 1);
  ctx.fillStyle = frac>0.5 ? "#5cd66f" : frac>0.25 ? "#ffd34d" : "#ff5050";
  ctx.fillRect(hx, hy, bw*frac, bh);

  // reload indicator
  if (p.reloading > 0){
    const rf = 1 - p.reloading/p.spec.reload;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r+10, -Math.PI/2, -Math.PI/2 + rf*TAU); ctx.stroke();
  }

  // P-label
  ctx.fillStyle = "#fff"; ctx.font = "bold 11px Segoe UI";
  ctx.textAlign="center"; ctx.textBaseline="bottom";
  ctx.fillText("P"+p.id, p.x, hy-3);
}

function drawHitMarks(){
  ctx.textAlign="center"; ctx.textBaseline="middle";
  for (const h of Game.hitMarks){
    ctx.globalAlpha = clamp(h.life, 0, 1);
    ctx.fillStyle = h.col;
    ctx.font = "bold 16px Segoe UI";
    ctx.fillText(h.txt, h.x, h.y);
  }
  ctx.globalAlpha = 1;
}

/* HUD: scoreboard top-center, per-player ammo bottom corners */
function drawHUD(){
  const p1 = Game.players[0], p2 = Game.players[1];

  // top center score
  ctx.textAlign="center"; ctx.textBaseline="top";
  ctx.font = "bold 30px Segoe UI";
  ctx.fillStyle = p1.color; ctx.textAlign="right";
  ctx.fillText(p1.kills, W/2-40, 14);
  ctx.fillStyle = "#5b6c83"; ctx.textAlign="center";
  ctx.font = "bold 18px Segoe UI";
  ctx.fillText("/ "+Game.killTarget+" /", W/2, 22);
  ctx.fillStyle = p2.color; ctx.textAlign="left";
  ctx.font = "bold 30px Segoe UI";
  ctx.fillText(p2.kills, W/2+40, 14);

  drawPlayerHUD(p1, 18, H-58, "left");
  drawPlayerHUD(p2, W-18, H-58, "right");

  if (Game.state === "paused"){
    ctx.fillStyle = "rgba(6,9,14,0.6)"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#fff"; ctx.font="bold 48px Segoe UI"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("PAUSED", W/2, H/2);
    ctx.font="16px Segoe UI"; ctx.fillStyle="#9fb0c6";
    ctx.fillText("press P to resume", W/2, H/2+40);
  }
}

function drawPlayerHUD(p, x, y, align){
  const spec = p.spec;
  ctx.textAlign = align; ctx.textBaseline = "top";
  ctx.fillStyle = p.color;
  ctx.font = "bold 16px Segoe UI";
  ctx.fillText("P"+p.id+"  "+spec.name, x, y);

  // ammo
  ctx.font = "bold 22px Segoe UI";
  ctx.fillStyle = p.reloading>0 ? "#ffd34d" : "#e8edf4";
  const ammoTxt = p.reloading>0 ? "RELOADING…" : (p.ammo + " / " + spec.mag);
  ctx.fillText(ammoTxt, x, y+20);

  // dash cooldown pip
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = p.dashCd<=0 ? "#7dff9b" : "#5b6c83";
  ctx.fillText(p.dashCd<=0 ? "DASH READY" : "dash "+p.dashCd.toFixed(1)+"s", x, y+46);
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

/* ----------------------------------------------------------------------------
   Main loop (fixed timestep)
---------------------------------------------------------------------------- */
let last = performance.now();
let acc = 0;
const STEP = 1/120;

function loop(now){
  let frame = (now - last) / 1000;
  last = now;
  if (frame > 0.1) frame = 0.1; // avoid spiral after tab switch

  if (Game.state === "playing"){
    acc += frame;
    while (acc >= STEP){ update(STEP); acc -= STEP; }
    render();
  } else if (Game.state === "paused" || Game.state === "over"){
    render();
  }
  requestAnimationFrame(loop);
}

/* ----------------------------------------------------------------------------
   Match flow / UI
---------------------------------------------------------------------------- */
const menuEl = document.getElementById("menu");
const winEl  = document.getElementById("win");

function startMatch(){
  Game.killTarget = parseInt(document.getElementById("killTarget").value, 10) || 15;
  newMatch();
  Game.state = "playing";
  menuEl.classList.add("hidden");
  winEl.classList.add("hidden");
  Sound.resume();
  last = performance.now(); acc = 0;
}

function endMatch(winner){
  Game.state = "over";
  Game.winner = winner;
  const wt = document.getElementById("winTitle");
  wt.textContent = "PLAYER "+winner.id+" WINS";
  wt.style.color = winner.color;
  const o = Game.players.find(p=>p!==winner);
  document.getElementById("winStats").textContent =
    `P1 — ${Game.players[0].kills} kills / ${Game.players[0].deaths} deaths    ·    P2 — ${Game.players[1].kills} kills / ${Game.players[1].deaths} deaths`;
  winEl.classList.remove("hidden");
}

document.getElementById("startBtn").addEventListener("click", startMatch);
document.getElementById("rematchBtn").addEventListener("click", startMatch);
document.getElementById("menuBtn").addEventListener("click", () => {
  Game.state = "menu";
  winEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
});

/* ----------------------------------------------------------------------------
   Input
---------------------------------------------------------------------------- */
const PREVENT = new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Slash","Period","Comma"]);
window.addEventListener("keydown", (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === "KeyP" && (Game.state === "playing" || Game.state === "paused")){
    Game.state = Game.state === "playing" ? "paused" : "playing";
    if (Game.state === "playing"){ last = performance.now(); acc = 0; }
  }
  if (e.code === "Enter" && Game.state === "menu") startMatch();
}, {passive:false});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

requestAnimationFrame(loop);
})();
