/* ============================================================================
   STRIKE OPS — lightweight 2-player local deathmatch (sophisticated edition)
   Top-down tactical shooter. 2 players on one keyboard, or vs CPU. No deps.
   Systems: weapons, grenades, destructible cover, explosive barrels,
            power-ups, armor, killstreaks + announcer, kill feed, AI bot,
            Deathmatch + Gun Game modes.
   ========================================================================== */

(() => {
"use strict";

/* ----------------------------------------------------------------------------
   Canvas / helpers
---------------------------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const TAU = Math.PI * 2;
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const rand = (a,b) => a + Math.random()*(b-a);
const dist2 = (ax,ay,bx,by) => { const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };
const dist = (ax,ay,bx,by) => Math.hypot(ax-bx, ay-by);
const angDiff = (a,b) => { let d=(a-b)%TAU; if(d>Math.PI)d-=TAU; if(d<-Math.PI)d+=TAU; return d; };
const getCss = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ----------------------------------------------------------------------------
   Audio — WebAudio synth (no asset files)
---------------------------------------------------------------------------- */
const Sound = (() => {
  let ac = null;
  const ensure = () => { if(!ac) ac = new (window.AudioContext||window.webkitAudioContext)(); return ac; };
  function tone(type,freq,dur,gain,slideTo){
    const a=ensure(), t=a.currentTime;
    const o=a.createOscillator(), g=a.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1,slideTo),t+dur);
    g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t+dur);
  }
  function noise(dur,gain,lp){
    const a=ensure(), t=a.currentTime, n=Math.floor(a.sampleRate*dur);
    const buf=a.createBuffer(1,n,a.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const src=a.createBufferSource(); src.buffer=buf;
    const g=a.createGain(); g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    const f=a.createBiquadFilter(); f.type="lowpass"; f.frequency.value=lp||3000;
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  }
  return {
    resume(){ try{ ensure(); if(ac.state==="suspended") ac.resume(); }catch(e){} },
    shoot(k){
      if(k==="shotgun") noise(0.18,0.35,1600);
      else if(k==="rifle"){ tone("square",320,0.07,0.22,120); noise(0.07,0.2,4000); }
      else if(k==="smg"){ tone("square",480,0.04,0.16,220); noise(0.04,0.12,5000); }
      else if(k==="sniper"){ tone("square",180,0.18,0.3,60); noise(0.12,0.25,2200); }
      else if(k==="minigun"){ tone("square",600,0.03,0.10,300); noise(0.03,0.08,6000); }
      else { tone("square",260,0.08,0.2,90); noise(0.06,0.15,3000); }
    },
    hit(){ noise(0.06,0.25,2500); tone("triangle",180,0.05,0.12,80); },
    reload(){ tone("sine",140,0.05,0.15,220); setTimeout(()=>tone("sine",220,0.05,0.15,140),90); },
    pickup(){ tone("sine",520,0.08,0.2,880); setTimeout(()=>tone("sine",880,0.1,0.18,1200),70); },
    death(){ tone("sawtooth",200,0.5,0.3,40); noise(0.4,0.25,1200); },
    dash(){ noise(0.12,0.18,1800); },
    nade(){ tone("sine",300,0.12,0.18,500); },
    explode(){ noise(0.5,0.5,900); tone("sawtooth",90,0.5,0.35,30); },
    announce(){ tone("sawtooth",330,0.12,0.2,440); setTimeout(()=>tone("sawtooth",440,0.16,0.2,660),110); setTimeout(()=>tone("sawtooth",550,0.2,0.18,880),230); },
  };
})();

/* ----------------------------------------------------------------------------
   Weapons
---------------------------------------------------------------------------- */
const WEAPONS = {
  pistol:  { name:"PISTOL",  dmg:18, rate:0.28, mag:12, reload:1.1, speed:780, spread:0.03, pellets:1, life:1.0, knock:90,  col:"#ffd479" },
  smg:     { name:"SMG",     dmg:11, rate:0.07, mag:30, reload:1.4, speed:880, spread:0.10, pellets:1, life:0.8, knock:50,  col:"#9fffb0" },
  shotgun: { name:"SHOTGUN", dmg:9,  rate:0.75, mag:6,  reload:1.8, speed:760, spread:0.26, pellets:8, life:0.45,knock:170, col:"#ff9d5c" },
  rifle:   { name:"RIFLE",   dmg:34, rate:0.5,  mag:8,  reload:1.6, speed:1300,spread:0.012,pellets:1, life:1.4, knock:120, col:"#7fd0ff" },
  sniper:  { name:"SNIPER",  dmg:82, rate:1.2,  mag:5,  reload:2.0, speed:1900,spread:0.004,pellets:1, life:1.8, knock:170, col:"#bfefff", tracer:true },
  minigun: { name:"MINIGUN", dmg:7,  rate:0.05, mag:90, reload:3.0, speed:950, spread:0.12, pellets:1, life:0.7, knock:28,  col:"#c89bff", spinup:true },
};
const WEAPON_CYCLE = ["smg","shotgun","rifle","sniper","minigun"]; // crate drops
const GG_TIERS     = ["pistol","smg","shotgun","rifle","sniper","minigun"]; // gun-game ladder

/* ----------------------------------------------------------------------------
   Map
---------------------------------------------------------------------------- */
const WALL_T = 22;
const walls = [
  {x:0,y:0,w:W,h:WALL_T}, {x:0,y:H-WALL_T,w:W,h:WALL_T},
  {x:0,y:0,w:WALL_T,h:H}, {x:W-WALL_T,y:0,w:WALL_T,h:H},
  {x:560,y:300,w:160,h:120},                 // central bunker
  {x:340,y:170,w:90,h:40}, {x:850,y:170,w:90,h:40},
  {x:340,y:510,w:90,h:40}, {x:850,y:510,w:90,h:40},
  {x:170,y:300,w:40,h:120}, {x:1070,y:300,w:40,h:120},
  {x:560,y:90,w:160,h:40},  {x:560,y:590,w:160,h:40},
];

// destructible crates (cover that breaks)
const CRATE_DEFS = [
  {x:470,y:240,w:46,h:46}, {x:764,y:240,w:46,h:46},
  {x:470,y:434,w:46,h:46}, {x:764,y:434,w:46,h:46},
];
// explosive barrels (chain-reacting hazards)
const BARREL_DEFS = [ {x:300,y:360}, {x:980,y:360}, {x:640,y:250}, {x:640,y:470} ];

const SPAWNS = [
  {x:90,y:90},{x:90,y:H-90},{x:W-90,y:90},{x:W-90,y:H-90},{x:W/2,y:90},{x:W/2,y:H-90},
];
const PICKUP_PADS = [
  {x:W/2,y:H/2-150,type:"weapon"}, {x:W/2,y:H/2+150,type:"weapon"},
  {x:250,y:H/2,type:"med"},        {x:W-250,y:H/2,type:"med"},
  {x:W/2-360,y:120,type:"power"},  {x:W/2+360,y:H-120,type:"power"},
];
const POWER_CYCLE = ["armor","damage","speed"];

/* circle vs rect push-out */
function resolveCircleRect(cx,cy,r,rect){
  const nx=clamp(cx,rect.x,rect.x+rect.w), ny=clamp(cy,rect.y,rect.y+rect.h);
  const dx=cx-nx, dy=cy-ny, d2=dx*dx+dy*dy;
  if(d2>r*r) return null;
  if(d2===0){
    const left=cx-rect.x,right=rect.x+rect.w-cx,top=cy-rect.y,bottom=rect.y+rect.h-cy;
    const m=Math.min(left,right,top,bottom);
    if(m===left) return {x:-(r+left),y:0};
    if(m===right) return {x:(r+right),y:0};
    if(m===top) return {x:0,y:-(r+top)};
    return {x:0,y:(r+bottom)};
  }
  const d=Math.sqrt(d2), overlap=r-d;
  return {x:(dx/d)*overlap, y:(dy/d)*overlap};
}
function pointInRect(x,y,r){ return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h; }
function pointInAnyWall(x,y){ for(const w of walls) if(pointInRect(x,y,w)) return true; return false; }
function pointBlocked(x,y){
  if(pointInAnyWall(x,y)) return true;
  for(const c of Game.crates) if(c.alive && pointInRect(x,y,c)) return true;
  for(const b of Game.barrels) if(b.alive && dist2(x,y,b.x,b.y) < b.r*b.r) return true;
  return false;
}
function losClear(x1,y1,x2,y2){
  const d=dist(x1,y1,x2,y2), steps=Math.max(2,Math.ceil(d/18));
  for(let i=1;i<steps;i++){
    const t=i/steps;
    if(pointBlocked(x1+(x2-x1)*t, y1+(y2-y1)*t)) return false;
  }
  return true;
}

/* ----------------------------------------------------------------------------
   Entities
---------------------------------------------------------------------------- */
class Player {
  constructor(id,color,controls,spawn,facing,bot){
    this.id=id; this.color=color; this.controls=controls; this.r=16;
    this.maxHp=100; this.kills=0; this.deaths=0; this.tier=0;
    this.faceDefault=facing; this.bot=!!bot;
    // AI persistent state
    this.aimErr=0; this.botStrafe=1; this.botStrafeT=0; this.botDashCd=0;
    this.botNadeCd=0; this.stuckT=0; this.prevx=0; this.prevy=0;
    this.respawn(spawn,true);
  }
  respawn(spawn,instant){
    this.x=spawn.x; this.y=spawn.y; this.vx=0; this.vy=0;
    this.hp=this.maxHp; this.armor=0;
    this.face=this.faceDefault;
    this.weapon = Game.mode==="gg" ? GG_TIERS[this.tier] : "pistol";
    this.ammo=WEAPONS[this.weapon].mag;
    this.reloading=0; this.cooldown=0;
    this.dashCd=0; this.dashTime=0;
    this.spawnGuard=instant?2.5:2.0;
    this.dead=false; this.deadTimer=0; this.muzzle=0;
    this.nades=2; this.nadeRegen=0; this.nadeHeld=false;
    this.spin=0;
    this.dmgBoost=0; this.speedBoost=0;
    this.streak=0; this.multi=0; this.lastKill=-99;
    this.hurtFlash=0;
  }
  get spec(){ return WEAPONS[this.weapon]; }
}

class Bullet {
  constructor(x,y,vx,vy,owner,dmg,life,knock,col,tracer){
    this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.owner=owner;
    this.dmg=dmg;this.life=life;this.knock=knock;this.col=col;
    this.tracer=!!tracer;this.dead=false;this.r=3;
    this.px=x;this.py=y;
  }
}
class Particle {
  constructor(x,y,vx,vy,life,col,size){ this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.life=life;this.max=life;this.col=col;this.size=size; }
}
class Grenade {
  constructor(x,y,vx,vy,owner){ this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.owner=owner;this.fuse=1.35;this.r=7;this.dead=false; }
}
class Pickup {
  constructor(pad){
    this.pad=pad; this.type=pad.type; this.x=pad.x; this.y=pad.y; this.r=18;
    this.active=true; this.timer=0; this.bob=Math.random()*TAU; this.roll();
  }
  roll(){
    if(this.type==="weapon") this.item=WEAPON_CYCLE[Math.floor(Math.random()*WEAPON_CYCLE.length)];
    else if(this.type==="power") this.item=POWER_CYCLE[Math.floor(Math.random()*POWER_CYCLE.length)];
    else this.item="med";
  }
  take(){ this.active=false; this.timer = this.type==="med"?9:8; }
  tick(dt){
    this.bob+=dt*3;
    if(!this.active){ this.timer-=dt; if(this.timer<=0){ this.active=true; this.roll(); } }
  }
}

/* ----------------------------------------------------------------------------
   Game state
---------------------------------------------------------------------------- */
const Game = {
  state:"menu", mode:"dm", vsCpu:false,
  players:[], bullets:[], particles:[], pickups:[], grenades:[],
  crates:[], barrels:[],
  shake:0, killTarget:15, winner:null,
  hitMarks:[], killFeed:[], announce:null, firstBlood:false,
  time:0, flash:0,
};

const keys = Object.create(null);
const CONTROLS = {
  p1:{ up:"KeyW",down:"KeyS",left:"KeyA",right:"KeyD",shoot:"Space",reload:"KeyR",dash:"ShiftLeft",nade:"KeyQ" },
  p2:{ up:"ArrowUp",down:"ArrowDown",left:"ArrowLeft",right:"ArrowRight",shoot:"Period",reload:"Comma",dash:"Slash",nade:"ShiftRight" },
};

function newMatch(){
  Game.players=[
    new Player(1, getCss("--d1")||"#4ea8ff", CONTROLS.p1, SPAWNS[0], 0, false),
    new Player(2, getCss("--d2")||"#ff5d5d", CONTROLS.p2, SPAWNS[3], Math.PI, Game.vsCpu),
  ];
  Game.bullets=[]; Game.particles=[]; Game.grenades=[];
  Game.pickups=PICKUP_PADS.map(p=>new Pickup(p));
  Game.crates=CRATE_DEFS.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,hp:70,alive:true}));
  Game.barrels=BARREL_DEFS.map(b=>({x:b.x,y:b.y,r:16,hp:30,alive:true}));
  Game.shake=0; Game.winner=null; Game.hitMarks=[]; Game.killFeed=[];
  Game.announce=null; Game.firstBlood=false; Game.time=0; Game.flash=0;
}
function farthestSpawn(){
  let best=SPAWNS[0], bestScore=-1;
  for(const s of SPAWNS){
    let score=Infinity;
    for(const p of Game.players){ if(p.dead) continue; score=Math.min(score,dist2(s.x,s.y,p.x,p.y)); }
    if(score===Infinity) score=0;
    if(score>bestScore){ bestScore=score; best=s; }
  }
  return best;
}

/* ----------------------------------------------------------------------------
   Update
---------------------------------------------------------------------------- */
function update(dt){
  Game.time += dt;
  for(const p of Game.players) updatePlayer(p,dt);
  updateBullets(dt);
  updateGrenades(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateFloaters(dt);
  for(const b of Game.barrels){ if(!b.alive && b.respawn!==undefined){ b.respawn-=dt; } }
  Game.shake=Math.max(0,Game.shake-dt*60);
  Game.flash=Math.max(0,Game.flash-dt*3);
  if(Game.announce){ Game.announce.life-=dt; if(Game.announce.life<=0) Game.announce=null; }

  // win check
  if(Game.mode==="dm"){
    for(const p of Game.players) if(p.kills>=Game.killTarget){ endMatch(p); break; }
  } else {
    for(const p of Game.players) if(p.tier>=GG_TIERS.length){ endMatch(p); break; }
  }
}

function updatePlayer(p,dt){
  if(p.dead){
    p.deadTimer-=dt;
    if(p.deadTimer<=0) p.respawn(farthestSpawn(),false);
    return;
  }

  // ---- gather intent ----
  let mx=0,my=0,wantShoot=false,wantReload=false,wantDash=false,wantNade=false;
  if(p.bot){
    const it=aiThink(p,dt);
    mx=it.mx; my=it.my; wantShoot=it.shoot; wantReload=it.reload; wantDash=it.dash; wantNade=it.nade;
  } else {
    const c=p.controls;
    mx=(keys[c.right]?1:0)-(keys[c.left]?1:0);
    my=(keys[c.down]?1:0)-(keys[c.up]?1:0);
    wantShoot=!!keys[c.shoot]; wantReload=!!keys[c.reload]; wantDash=!!keys[c.dash]; wantNade=!!keys[c.nade];
    if(mx||my){ const l=Math.hypot(mx,my); p.face=Math.atan2(my/l,mx/l); }
  }
  let nx=mx,ny=my; const moving=!!(nx||ny);
  if(moving){ const l=Math.hypot(nx,ny)||1; nx/=l; ny/=l; }

  // ---- boosts / timers ----
  p.spawnGuard=Math.max(0,p.spawnGuard-dt);
  p.cooldown=Math.max(0,p.cooldown-dt);
  p.muzzle=Math.max(0,p.muzzle-dt);
  p.dashCd=Math.max(0,p.dashCd-dt);
  p.dashTime=Math.max(0,p.dashTime-dt);
  p.dmgBoost=Math.max(0,p.dmgBoost-dt);
  p.speedBoost=Math.max(0,p.speedBoost-dt);
  p.hurtFlash=Math.max(0,p.hurtFlash-dt);
  p.nadeRegen+=dt;
  if(p.nadeRegen>=11 && p.nades<3){ p.nades++; p.nadeRegen=0; }

  // ---- dash ----
  if(wantDash && p.dashCd<=0 && moving){
    p.dashTime=0.16; p.dashCd=1.4; Sound.dash();
    for(let i=0;i<8;i++) Game.particles.push(new Particle(p.x,p.y,rand(-40,40),rand(-40,40),rand(0.2,0.4),"#cfe6ff",rand(2,4)));
  }
  let speed=250*(p.speedBoost>0?1.5:1)*(p.dashTime>0?3.0:1);

  // ---- move + collide ----
  p.prevx=p.x; p.prevy=p.y;
  if(moving){ p.x+=nx*speed*dt; p.y+=ny*speed*dt; }
  for(const w of walls){ const push=resolveCircleRect(p.x,p.y,p.r,w); if(push){ p.x+=push.x; p.y+=push.y; } }
  for(const c of Game.crates){ if(!c.alive) continue; const push=resolveCircleRect(p.x,p.y,p.r,c); if(push){ p.x+=push.x; p.y+=push.y; } }
  for(const b of Game.barrels){ if(!b.alive) continue; const d=dist(p.x,p.y,b.x,b.y),min=p.r+b.r; if(d<min&&d>0){ p.x+=(p.x-b.x)/d*(min-d); p.y+=(p.y-b.y)/d*(min-d); } }
  for(const o of Game.players){ if(o===p||o.dead) continue; const d=dist(p.x,p.y,o.x,o.y),min=p.r+o.r; if(d<min&&d>0){ const push=(min-d)/2,ux=(p.x-o.x)/d,uy=(p.y-o.y)/d; p.x+=ux*push; p.y+=uy*push; o.x-=ux*push; o.y-=uy*push; } }
  p.x=clamp(p.x,p.r,W-p.r); p.y=clamp(p.y,p.r,H-p.r);
  p.vx=(p.x-p.prevx)/dt; p.vy=(p.y-p.prevy)/dt;

  // bot stuck detection
  if(p.bot){
    if(moving && dist(p.x,p.y,p.prevx,p.prevy) < speed*dt*0.3) p.stuckT+=dt; else p.stuckT=Math.max(0,p.stuckT-dt*2);
  }

  // ---- minigun spin ----
  if(p.weapon==="minigun"){ p.spin = wantShoot ? Math.min(1,p.spin+dt*2.2) : Math.max(0,p.spin-dt*1.8); }
  else p.spin=0;

  // ---- reload ----
  if(p.reloading>0){ p.reloading-=dt; if(p.reloading<=0) p.ammo=p.spec.mag; }
  if(wantReload && p.reloading<=0 && p.ammo<p.spec.mag){ p.reloading=p.spec.reload; Sound.reload(); }

  // ---- grenade (edge-triggered) ----
  if(wantNade && !p.nadeHeld && p.nades>0 && p.reloading<=0){
    p.nades--; Sound.nade();
    const sp=520;
    Game.grenades.push(new Grenade(p.x+Math.cos(p.face)*(p.r+6), p.y+Math.sin(p.face)*(p.r+6),
      Math.cos(p.face)*sp, Math.sin(p.face)*sp, p));
  }
  p.nadeHeld=wantNade;

  // ---- shoot ----
  const canSpin = p.weapon!=="minigun" || p.spin>=0.6;
  if(wantShoot && p.cooldown<=0 && p.reloading<=0 && canSpin){
    if(p.ammo>0) fire(p);
    else { p.reloading=p.spec.reload; Sound.reload(); }
  }
}

function fire(p){
  const s=p.spec;
  p.cooldown=s.rate; p.ammo--; p.muzzle=0.05; p.spawnGuard=0;
  Sound.shoot(p.weapon);
  const dmgMult = p.dmgBoost>0 ? 1.6 : 1;
  const mx=p.x+Math.cos(p.face)*(p.r+8), my=p.y+Math.sin(p.face)*(p.r+8);
  for(let i=0;i<s.pellets;i++){
    const a=p.face+rand(-s.spread,s.spread);
    Game.bullets.push(new Bullet(mx,my,Math.cos(a)*s.speed,Math.sin(a)*s.speed,p,s.dmg*dmgMult,s.life,s.knock,s.col,s.tracer));
  }
  p.x-=Math.cos(p.face)*3; p.y-=Math.sin(p.face)*3; // recoil
  for(let i=0;i<4;i++) Game.particles.push(new Particle(mx,my,Math.cos(p.face)*rand(60,180)+rand(-40,40),Math.sin(p.face)*rand(60,180)+rand(-40,40),rand(0.06,0.16),s.col,rand(2,4)));
  Game.shake=Math.min(12,Game.shake+(p.weapon==="shotgun"?6:p.weapon==="sniper"?7:p.weapon==="rifle"?5:2));
}

function updateBullets(dt){
  for(const b of Game.bullets){
    b.life-=dt; if(b.life<=0){ b.dead=true; continue; }
    const steps=3, sdt=dt/steps;
    b.px=b.x; b.py=b.y;
    for(let s=0;s<steps&&!b.dead;s++){
      b.x+=b.vx*sdt; b.y+=b.vy*sdt;
      if(pointInAnyWall(b.x,b.y)){ b.dead=true; sparks(b.x,b.y,"#b9c4d4"); break; }
      let hitCrate=false;
      for(const c of Game.crates){ if(c.alive && pointInRect(b.x,b.y,c)){ damageCrate(c,b.dmg); b.dead=true; sparks(b.x,b.y,"#caa56a"); hitCrate=true; break; } }
      if(hitCrate) break;
      let hitBarrel=false;
      for(const bar of Game.barrels){ if(bar.alive && dist2(b.x,b.y,bar.x,bar.y)<=(bar.r+b.r)*(bar.r+b.r)){ damageBarrel(bar,b.dmg,b.owner); b.dead=true; hitBarrel=true; break; } }
      if(hitBarrel) break;
      for(const p of Game.players){
        if(p===b.owner||p.dead||p.spawnGuard>0) continue;
        if(dist2(b.x,b.y,p.x,p.y)<=(p.r+b.r)*(p.r+b.r)){
          const d=Math.hypot(b.vx,b.vy)||1;
          damagePlayer(p,b.dmg,b.owner,b.vx/d,b.vy/d,b.knock);
          b.dead=true; break;
        }
      }
    }
  }
  Game.bullets=Game.bullets.filter(b=>!b.dead&&b.x>0&&b.x<W&&b.y>0&&b.y<H);
}

function sparks(x,y,col){ for(let i=0;i<6;i++) Game.particles.push(new Particle(x,y,rand(-90,90),rand(-90,90),rand(0.1,0.3),col,rand(1.5,3))); }

function damageCrate(c,dmg){
  c.hp-=dmg;
  for(let i=0;i<4;i++) Game.particles.push(new Particle(c.x+c.w/2,c.y+c.h/2,rand(-80,80),rand(-80,80),rand(0.2,0.4),"#caa56a",rand(2,4)));
  if(c.hp<=0){ c.alive=false; for(let i=0;i<16;i++) Game.particles.push(new Particle(c.x+c.w/2,c.y+c.h/2,rand(-160,160),rand(-160,160),rand(0.3,0.6),"#caa56a",rand(2,5))); }
}
function damageBarrel(bar,dmg,owner){ bar.hp-=dmg; if(bar.hp<=0) explodeBarrel(bar,owner); }
function explodeBarrel(bar,owner){
  if(!bar.alive) return;
  bar.alive=false;
  explode(bar.x,bar.y,120,75,owner,200);
}

function damagePlayer(p,dmg,attacker,dirx,diry,knock){
  let rem=dmg;
  if(p.armor>0){ const a=Math.min(p.armor,rem); p.armor-=a; rem-=a; }
  p.hp-=rem;
  p.hurtFlash=0.25;
  Sound.hit();
  Game.shake=Math.min(12,Game.shake+3);
  Game.flash=Math.max(Game.flash,0.35);
  p.x+=dirx*(knock*0.05); p.y+=diry*(knock*0.05);
  for(let i=0;i<9;i++) Game.particles.push(new Particle(p.x,p.y,dirx*rand(40,160)+rand(-50,50),diry*rand(40,160)+rand(-50,50),rand(0.2,0.5),"#ff4040",rand(2,4)));
  Game.hitMarks.push({x:p.x,y:p.y-8,txt:Math.round(dmg),life:0.7,col:"#ffe08a",small:true});
  if(p.hp<=0) killPlayer(p,attacker);
}

function explode(x,y,radius,maxDmg,attacker,knock){
  Sound.explode();
  Game.shake=Math.max(Game.shake,16);
  Game.flash=Math.max(Game.flash,0.6);
  // visuals
  for(let i=0;i<40;i++){ const a=rand(0,TAU),sp=rand(40,radius*3.2); Game.particles.push(new Particle(x,y,Math.cos(a)*sp,Math.sin(a)*sp,rand(0.25,0.6),i%3?"#ff8a2a":"#ffd45a",rand(2,6))); }
  for(let i=0;i<12;i++) Game.particles.push(new Particle(x,y,rand(-60,60),rand(-60,60),rand(0.4,0.8),"#555",rand(4,9)));
  // players
  for(const p of Game.players){
    if(p.dead||p.spawnGuard>0) continue;
    const d=dist(x,y,p.x,p.y);
    if(d<radius+p.r){
      const fall=1-clamp(d/(radius+p.r),0,1);
      const dmg=maxDmg*fall;
      const dx=(p.x-x)/(d||1), dy=(p.y-y)/(d||1);
      damagePlayer(p,dmg,attacker,dx,dy,knock);
    }
  }
  // crates
  for(const c of Game.crates){ if(c.alive && dist(x,y,c.x+c.w/2,c.y+c.h/2)<radius+30) damageCrate(c,maxDmg); }
  // chain barrels
  for(const bar of Game.barrels){ if(bar.alive && dist(x,y,bar.x,bar.y)<radius+bar.r) explodeBarrel(bar,attacker); }
}

function killPlayer(p,attacker){
  p.dead=true; p.deadTimer=1.6; p.deaths++; p.streak=0; p.multi=0;
  Sound.death(); Game.shake=14;
  for(let i=0;i<26;i++) Game.particles.push(new Particle(p.x,p.y,rand(-220,220),rand(-220,220),rand(0.3,0.8),Math.random()<0.6?"#ff3030":p.color,rand(2,5)));

  if(attacker && attacker!==p){
    if(Game.mode==="dm") attacker.kills++;
    // gun-game advance
    if(Game.mode==="gg"){
      attacker.kills++;
      attacker.tier++;
      if(attacker.tier<GG_TIERS.length){ attacker.weapon=GG_TIERS[attacker.tier]; attacker.ammo=WEAPONS[attacker.weapon].mag; attacker.reloading=0; attacker.hp=Math.min(attacker.maxHp,attacker.hp+25); }
    }
    // streak / multikill
    attacker.streak++;
    if(Game.time-attacker.lastKill<=3.5) attacker.multi++; else attacker.multi=1;
    attacker.lastKill=Game.time;
    if(attacker.streak%3===0) attacker.armor=Math.min(100,attacker.armor+30); // streak reward
    announceKill(attacker);
    Game.killFeed.unshift({a:attacker.id,ac:attacker.color,v:p.id,vc:p.color,life:5});
    if(Game.killFeed.length>5) Game.killFeed.pop();
  }
  Game.hitMarks.push({x:p.x,y:p.y-30,txt:"ELIMINATED",life:1.3,col:attacker?attacker.color:"#fff"});
}

const MULTI_TXT={2:"DOUBLE KILL",3:"TRIPLE KILL",4:"MULTI KILL",5:"MEGA KILL",6:"MONSTER KILL"};
const STREAK_TXT={3:"KILLING SPREE",5:"RAMPAGE",7:"DOMINATING",10:"UNSTOPPABLE",15:"GODLIKE"};
function announceKill(p){
  let txt=null;
  if(!Game.firstBlood){ Game.firstBlood=true; txt="FIRST BLOOD"; }
  else if(p.multi>=2) txt=MULTI_TXT[Math.min(6,p.multi)];
  else if(STREAK_TXT[p.streak]) txt=STREAK_TXT[p.streak];
  if(txt){ Game.announce={txt,col:p.color,life:1.8,t:0}; Sound.announce(); }
}

function updateGrenades(dt){
  for(const g of Game.grenades){
    g.fuse-=dt;
    g.vx*=0.985; g.vy*=0.985;
    const nx=g.x+g.vx*dt, ny=g.y+g.vy*dt;
    if(pointBlocked(nx,g.y)){ g.vx*=-0.5; } else g.x=nx;
    if(pointBlocked(g.x,ny)){ g.vy*=-0.5; } else g.y=ny;
    g.x=clamp(g.x,8,W-8); g.y=clamp(g.y,8,H-8);
    if(g.fuse<=0){ g.dead=true; explode(g.x,g.y,95,60,g.owner,150); }
  }
  Game.grenades=Game.grenades.filter(g=>!g.dead);
}

function updatePickups(dt){
  for(const k of Game.pickups){
    k.tick(dt);
    if(!k.active) continue;
    for(const p of Game.players){
      if(p.dead) continue;
      if(dist2(k.x,k.y,p.x,p.y)<=(k.r+p.r)*(k.r+p.r)){
        applyPickup(k,p);
      }
    }
  }
}
function applyPickup(k,p){
  if(k.type==="med"){
    if(p.hp<p.maxHp){ p.hp=Math.min(p.maxHp,p.hp+45); k.take(); Sound.pickup(); float(p,"+45 HP","#7dff9b"); }
  } else if(k.type==="power"){
    if(k.item==="armor"){ p.armor=Math.min(100,p.armor+50); k.take(); Sound.pickup(); float(p,"+ARMOR","#8ab4ff"); }
    else if(k.item==="damage"){ p.dmgBoost=8; k.take(); Sound.pickup(); float(p,"DAMAGE x1.6","#ff8a5c"); }
    else if(k.item==="speed"){ p.speedBoost=8; k.take(); Sound.pickup(); float(p,"SPEED+","#9fffd0"); }
  } else { // weapon
    if(Game.mode==="gg"){ // refill station in gun game
      if(p.ammo<p.spec.mag){ p.ammo=p.spec.mag; p.reloading=0; k.take(); Sound.pickup(); float(p,"AMMO","#ffd479"); }
    } else {
      p.weapon=k.item; p.ammo=WEAPONS[k.item].mag; p.reloading=0; p.spin=0;
      k.take(); Sound.pickup(); float(p,WEAPONS[k.item].name,WEAPONS[k.item].col);
    }
  }
}
function float(p,txt,col){ Game.hitMarks.push({x:p.x,y:p.y-30,txt,life:0.9,col}); }

function updateParticles(dt){
  for(const pt of Game.particles){ pt.life-=dt; pt.x+=pt.vx*dt; pt.y+=pt.vy*dt; pt.vx*=0.92; pt.vy*=0.92; }
  Game.particles=Game.particles.filter(p=>p.life>0);
}
function updateFloaters(dt){
  for(const h of Game.hitMarks){ h.life-=dt; h.y-=24*dt; }
  Game.hitMarks=Game.hitMarks.filter(h=>h.life>0);
  for(const f of Game.killFeed) f.life-=dt;
  Game.killFeed=Game.killFeed.filter(f=>f.life>0);
}

/* ----------------------------------------------------------------------------
   AI bot
---------------------------------------------------------------------------- */
function aiThink(p,dt){
  const out={mx:0,my:0,shoot:false,reload:false,dash:false,nade:false};
  const t=Game.players.find(o=>o!==p);
  // slow aim error random-walk → beatable
  p.aimErr=clamp(p.aimErr+rand(-0.04,0.04),-0.16,0.16);
  p.botDashCd=Math.max(0,p.botDashCd-dt);
  p.botNadeCd=Math.max(0,p.botNadeCd-dt);
  p.botStrafeT-=dt; if(p.botStrafeT<=0){ p.botStrafe=Math.random()<0.5?-1:1; p.botStrafeT=rand(0.8,1.8); }

  if(!t || t.dead){
    // wander toward center
    out.mx=(W/2-p.x); out.my=(H/2-p.y);
    p.face=Math.atan2(out.my,out.mx);
    return out;
  }

  const d=dist(p.x,p.y,t.x,t.y);
  const los=losClear(p.x,p.y,t.x,t.y);
  const spec=p.spec;
  const range = p.weapon==="shotgun"?150 : p.weapon==="sniper"?430 : p.weapon==="minigun"?300 : 290;
  const eff = spec.speed*spec.life*0.9; // effective bullet reach

  // aim with target velocity lead
  const lead = clamp(d/spec.speed,0,0.5);
  const ax=t.x+t.vx*lead, ay=t.y+t.vy*lead;
  const aimAng=Math.atan2(ay-p.y,ax-p.x)+p.aimErr;
  p.face=aimAng;

  // ---- movement goal ----
  let gx=0,gy=0;
  const toT_x=(t.x-p.x)/(d||1), toT_y=(t.y-p.y)/(d||1);

  // grab a useful pickup if close & beneficial
  let target=null,bestD=170;
  for(const k of Game.pickups){
    if(!k.active) continue;
    const want = (k.type==="med"&&p.hp<70) || (k.type==="power") || (Game.mode==="dm"&&k.type==="weapon"&&p.weapon==="pistol");
    if(!want) continue;
    const dk=dist(p.x,p.y,k.x,k.y);
    if(dk<bestD){ bestD=dk; target=k; }
  }
  if(target){ gx=(target.x-p.x); gy=(target.y-p.y); }
  else if(p.hp<35 && !los){ gx=-toT_x; gy=-toT_y; } // flee when hurt & exposed
  else if(!los){ gx=toT_x; gy=toT_y; }              // close in to get a shot
  else {
    // maintain range + strafe
    if(d>range+50){ gx=toT_x; gy=toT_y; }
    else if(d<range-50){ gx=-toT_x; gy=-toT_y; }
    const px=-toT_y*p.botStrafe, py=toT_x*p.botStrafe;
    gx+=px*1.1; gy+=py*1.1;
  }
  // unstick
  if(p.stuckT>0.5){ gx+= -toT_y*p.botStrafe*2 + rand(-0.5,0.5); gy+= toT_x*p.botStrafe*2 + rand(-0.5,0.5); if(p.stuckT>1.2){ p.botStrafe*=-1; p.stuckT=0; } }
  out.mx=gx; out.my=gy;

  // ---- combat decisions ----
  const aligned=Math.abs(angDiff(p.face,Math.atan2(t.y-p.y,t.x-p.x)))<0.22;
  if(p.weapon==="minigun" && los && d<range) out.shoot=true; // pre-spin
  if(los && d<eff && aligned && p.ammo>0) out.shoot=true;
  if(p.ammo<=0) out.reload=true;

  // dodge: dash if an enemy bullet is bearing down
  if(p.botDashCd<=0){
    for(const b of Game.bullets){
      if(b.owner===p) continue;
      if(dist(b.x,b.y,p.x,p.y)<140){
        const bang=Math.atan2(p.y-b.y,p.x-b.x), bvel=Math.atan2(b.vy,b.vx);
        if(Math.abs(angDiff(bang,bvel))<0.4){ out.dash=true; out.mx=-toT_y*p.botStrafe; out.my=toT_x*p.botStrafe; p.botDashCd=1.6; break; }
      }
    }
  }
  // grenade flush
  if(p.botNadeCd<=0 && p.nades>0 && los && d>130 && d<330){ out.nade=true; p.botNadeCd=rand(4,7); }
  return out;
}

/* ----------------------------------------------------------------------------
   Render
---------------------------------------------------------------------------- */
function render(){
  ctx.save();
  if(Game.shake>0) ctx.translate(rand(-Game.shake,Game.shake)*0.5, rand(-Game.shake,Game.shake)*0.5);
  drawFloor();
  drawPickups();
  drawWalls();
  drawCrates();
  drawBarrels();
  drawGrenades();
  drawParticles();
  drawBullets();
  for(const p of Game.players) drawPlayer(p);
  drawFloaters();
  ctx.restore();
  drawVignette();
  if(Game.flash>0){ ctx.fillStyle="rgba(255,40,40,"+(Game.flash*0.18)+")"; ctx.fillRect(0,0,W,H); }
  drawHUD();
}

function drawFloor(){
  ctx.fillStyle="#10151d"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="rgba(255,255,255,0.025)"; ctx.lineWidth=1; ctx.beginPath();
  for(let x=0;x<=W;x+=40){ ctx.moveTo(x,0); ctx.lineTo(x,H); }
  for(let y=0;y<=H;y+=40){ ctx.moveTo(0,y); ctx.lineTo(W,y); }
  ctx.stroke();
  ctx.strokeStyle="rgba(120,160,210,0.10)"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(W/2,H/2,90,0,TAU); ctx.stroke();
}
function drawWalls(){
  for(const w of walls){
    const g=ctx.createLinearGradient(w.x,w.y,w.x,w.y+w.h);
    g.addColorStop(0,"#2c3a52"); g.addColorStop(1,"#1d2738");
    ctx.fillStyle=g; roundRect(w.x,w.y,w.w,w.h,4); ctx.fill();
    ctx.strokeStyle="rgba(120,160,210,0.25)"; ctx.lineWidth=1.5; roundRect(w.x+0.5,w.y+0.5,w.w-1,w.h-1,4); ctx.stroke();
  }
}
function drawCrates(){
  for(const c of Game.crates){
    if(!c.alive) continue;
    const frac=clamp(c.hp/70,0,1);
    ctx.fillStyle="#6b4f2e"; roundRect(c.x,c.y,c.w,c.h,4); ctx.fill();
    ctx.fillStyle="#8a6a3f"; roundRect(c.x+4,c.y+4,c.w-8,c.h-8,3); ctx.fill();
    ctx.strokeStyle="rgba(0,0,0,0.4)"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(c.x+c.w,c.y+c.h); ctx.moveTo(c.x+c.w,c.y); ctx.lineTo(c.x,c.y+c.h); ctx.stroke();
    if(frac<1){ ctx.fillStyle="rgba(0,0,0,"+((1-frac)*0.5)+")"; roundRect(c.x,c.y,c.w,c.h,4); ctx.fill(); }
  }
}
function drawBarrels(){
  for(const b of Game.barrels){
    if(!b.alive) continue;
    ctx.save(); ctx.translate(b.x,b.y);
    ctx.shadowColor="#ff5a2a"; ctx.shadowBlur=10;
    ctx.fillStyle="#c0392b"; ctx.beginPath(); ctx.arc(0,0,b.r,0,TAU); ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle="#ffcf3a"; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,b.r-4,0,TAU); ctx.stroke();
    ctx.fillStyle="#ffcf3a"; ctx.font="bold 14px Segoe UI"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("!",0,0);
    ctx.restore();
  }
}
function drawGrenades(){
  for(const g of Game.grenades){
    const blink = g.fuse<0.6 ? (Math.sin(g.fuse*40)>0) : false;
    ctx.fillStyle = blink ? "#ffffff" : "#3a4a3a";
    ctx.beginPath(); ctx.arc(g.x,g.y,g.r,0,TAU); ctx.fill();
    ctx.strokeStyle="#9fffb0"; ctx.lineWidth=1.5; ctx.stroke();
    // fuse radius hint
    ctx.globalAlpha=0.10; ctx.fillStyle="#ff7a2a"; ctx.beginPath(); ctx.arc(g.x,g.y,95*(1-g.fuse/1.35),0,TAU); ctx.fill(); ctx.globalAlpha=1;
  }
}
function drawPickups(){
  for(const k of Game.pickups){
    if(!k.active){
      ctx.globalAlpha=0.22; ctx.strokeStyle=padCol(k); ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(k.x,k.y,k.r,0,TAU); ctx.stroke(); ctx.globalAlpha=1; continue;
    }
    const bob=Math.sin(k.bob)*3, col=padCol(k);
    ctx.save(); ctx.translate(k.x,k.y+bob);
    ctx.shadowColor=col; ctx.shadowBlur=18;
    ctx.fillStyle="#0c121a"; roundRect(-k.r,-k.r,k.r*2,k.r*2,6); ctx.fill();
    ctx.shadowBlur=0; ctx.strokeStyle=col; ctx.lineWidth=2; roundRect(-k.r,-k.r,k.r*2,k.r*2,6); ctx.stroke();
    ctx.fillStyle=col; ctx.textAlign="center"; ctx.textBaseline="middle";
    if(k.type==="med"){ ctx.fillRect(-3,-9,6,18); ctx.fillRect(-9,-3,18,6); }
    else { ctx.font="bold 10px Segoe UI"; ctx.fillText(padLabel(k),0,0); }
    ctx.restore();
  }
}
function padCol(k){
  if(k.type==="med") return "#7dff9b";
  if(k.type==="power") return k.item==="armor"?"#8ab4ff":k.item==="damage"?"#ff8a5c":"#9fffd0";
  return WEAPONS[k.item]?.col||"#ffd479";
}
function padLabel(k){
  if(k.type==="power") return k.item==="armor"?"ARM":k.item==="damage"?"DMG":"SPD";
  return (WEAPONS[k.item]?.name||"").slice(0,3);
}
function drawBullets(){
  for(const b of Game.bullets){
    ctx.strokeStyle=b.col; ctx.shadowColor=b.col; ctx.shadowBlur=8;
    ctx.lineWidth=b.tracer?2:3;
    ctx.beginPath();
    if(b.tracer){ ctx.moveTo(b.px,b.py); ctx.lineTo(b.x,b.y); }
    else { ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-b.vx*0.012,b.y-b.vy*0.012); }
    ctx.stroke(); ctx.shadowBlur=0;
  }
}
function drawParticles(){
  for(const p of Game.particles){ ctx.globalAlpha=clamp(p.life/p.max,0,1); ctx.fillStyle=p.col; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,TAU); ctx.fill(); }
  ctx.globalAlpha=1;
}
function drawPlayer(p){
  if(p.dead){
    ctx.globalAlpha=clamp(p.deadTimer/1.6,0,1)*0.6; ctx.strokeStyle=p.color; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(p.x-10,p.y-10); ctx.lineTo(p.x+10,p.y+10); ctx.moveTo(p.x+10,p.y-10); ctx.lineTo(p.x-10,p.y+10); ctx.stroke();
    ctx.globalAlpha=1; return;
  }
  ctx.save(); ctx.translate(p.x,p.y);
  // boosts aura
  if(p.dmgBoost>0){ ctx.globalAlpha=0.4; ctx.strokeStyle="#ff8a5c"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,p.r+9,0,TAU); ctx.stroke(); ctx.globalAlpha=1; }
  if(p.speedBoost>0){ ctx.globalAlpha=0.35; ctx.strokeStyle="#9fffd0"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,p.r+5,0,TAU); ctx.stroke(); ctx.globalAlpha=1; }
  if(p.spawnGuard>0){ ctx.globalAlpha=0.4+Math.sin(performance.now()/100)*0.2; ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,p.r+6,0,TAU); ctx.stroke(); ctx.globalAlpha=1; }

  ctx.rotate(p.face);
  if(p.muzzle>0){ ctx.fillStyle="#fff3b0"; ctx.beginPath(); ctx.arc(p.r+12,0,7,0,TAU); ctx.fill(); }
  // barrel (minigun spins -> thicker)
  ctx.fillStyle="#11161e"; ctx.fillRect(p.r-2,-3, p.weapon==="minigun"?22:p.weapon==="sniper"?24:18, p.weapon==="minigun"?7:6);
  ctx.shadowColor=p.color; ctx.shadowBlur=12; ctx.fillStyle = p.hurtFlash>0?"#ffffff":p.color; ctx.beginPath(); ctx.arc(0,0,p.r,0,TAU); ctx.fill(); ctx.shadowBlur=0;
  ctx.fillStyle="rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(0,0,p.r*0.55,0,TAU); ctx.fill();
  ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(p.r*0.5,0,3,0,TAU); ctx.fill();
  ctx.restore();

  // armor + health bars
  const bw=40, bh=5, hx=p.x-bw/2, hy=p.y-p.r-16;
  ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(hx-1,hy-1,bw+2,bh+2);
  ctx.fillStyle = p.hp/p.maxHp>0.5?"#5cd66f":p.hp/p.maxHp>0.25?"#ffd34d":"#ff5050";
  ctx.fillRect(hx,hy,bw*clamp(p.hp/p.maxHp,0,1),bh);
  if(p.armor>0){ ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(hx-1,hy-8,bw+2,4); ctx.fillStyle="#8ab4ff"; ctx.fillRect(hx,hy-7,bw*clamp(p.armor/100,0,1),3); }

  if(p.reloading>0){ const rf=1-p.reloading/p.spec.reload; ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,p.r+10,-Math.PI/2,-Math.PI/2+rf*TAU); ctx.stroke(); }

  ctx.fillStyle="#fff"; ctx.font="bold 11px Segoe UI"; ctx.textAlign="center"; ctx.textBaseline="bottom";
  ctx.fillText("P"+p.id+(p.bot?" CPU":""), p.x, hy-9);
}
function drawFloaters(){
  ctx.textAlign="center"; ctx.textBaseline="middle";
  for(const h of Game.hitMarks){
    ctx.globalAlpha=clamp(h.life,0,1); ctx.fillStyle=h.col;
    ctx.font = h.small?"bold 12px Segoe UI":"bold 16px Segoe UI";
    ctx.fillText(h.txt,h.x,h.y);
  }
  ctx.globalAlpha=1;
}
function drawVignette(){
  const g=ctx.createRadialGradient(W/2,H/2,H*0.45,W/2,H/2,H*0.85);
  g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,0.45)");
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}

/* HUD */
function drawHUD(){
  const p1=Game.players[0], p2=Game.players[1];
  ctx.textBaseline="top";
  if(Game.mode==="dm"){
    ctx.font="bold 30px Segoe UI"; ctx.fillStyle=p1.color; ctx.textAlign="right"; ctx.fillText(p1.kills,W/2-40,14);
    ctx.fillStyle="#5b6c83"; ctx.textAlign="center"; ctx.font="bold 16px Segoe UI"; ctx.fillText("/ "+Game.killTarget+" /",W/2,22);
    ctx.font="bold 30px Segoe UI"; ctx.fillStyle=p2.color; ctx.textAlign="left"; ctx.fillText(p2.kills,W/2+40,14);
  } else {
    ctx.font="bold 26px Segoe UI"; ctx.fillStyle=p1.color; ctx.textAlign="right"; ctx.fillText("Lv "+(p1.tier+1)+"/"+GG_TIERS.length,W/2-30,16);
    ctx.fillStyle="#5b6c83"; ctx.textAlign="center"; ctx.font="bold 14px Segoe UI"; ctx.fillText("GUN GAME",W/2,22);
    ctx.font="bold 26px Segoe UI"; ctx.fillStyle=p2.color; ctx.textAlign="left"; ctx.fillText("Lv "+(p2.tier+1)+"/"+GG_TIERS.length,W/2+30,16);
  }

  // kill feed (top-left)
  ctx.textAlign="left"; ctx.textBaseline="top"; ctx.font="bold 13px Segoe UI";
  let fy=14;
  for(const f of Game.killFeed){
    ctx.globalAlpha=clamp(f.life,0,1);
    ctx.fillStyle=f.ac; ctx.fillText("P"+f.a,14,fy);
    ctx.fillStyle="#7e8da3"; ctx.fillText("  ▸  ",14+24,fy);
    ctx.fillStyle=f.vc; ctx.fillText("P"+f.v,14+58,fy);
    fy+=20;
  }
  ctx.globalAlpha=1;

  drawPlayerHUD(p1,18,H-66,"left");
  drawPlayerHUD(p2,W-18,H-66,"right");

  // announcer
  if(Game.announce){
    const a=Game.announce, k=clamp(a.life/1.8,0,1);
    ctx.globalAlpha=clamp(a.life*1.5,0,1);
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.font="bold "+(34+(1-k)*10)+"px Segoe UI";
    ctx.fillStyle=a.col; ctx.fillText(a.txt,W/2,120);
    ctx.globalAlpha=1;
  }

  if(Game.state==="paused"){
    ctx.fillStyle="rgba(6,9,14,0.6)"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#fff"; ctx.font="bold 48px Segoe UI"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("PAUSED",W/2,H/2);
    ctx.font="16px Segoe UI"; ctx.fillStyle="#9fb0c6"; ctx.fillText("press P to resume",W/2,H/2+40);
  }
}
function drawPlayerHUD(p,x,y,align){
  const spec=p.spec;
  ctx.textAlign=align; ctx.textBaseline="top";
  ctx.fillStyle=p.color; ctx.font="bold 16px Segoe UI";
  ctx.fillText("P"+p.id+(p.bot?" (CPU)":"")+"  "+spec.name,x,y);
  ctx.font="bold 22px Segoe UI"; ctx.fillStyle=p.reloading>0?"#ffd34d":"#e8edf4";
  ctx.fillText(p.reloading>0?"RELOADING…":(p.ammo+" / "+spec.mag),x,y+20);
  // nades + dash row
  ctx.font="12px Segoe UI";
  const nadeTxt="🛢 "+p.nades+"   "+(p.dashCd<=0?"DASH":"dash "+p.dashCd.toFixed(1)+"s");
  ctx.fillStyle=p.dashCd<=0?"#7dff9b":"#5b6c83"; ctx.fillText(nadeTxt,x,y+46);
}

function roundRect(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

/* ----------------------------------------------------------------------------
   Loop
---------------------------------------------------------------------------- */
let last=performance.now(), acc=0; const STEP=1/120;
function loop(now){
  let frame=(now-last)/1000; last=now; if(frame>0.1) frame=0.1;
  if(Game.state==="playing"){ acc+=frame; while(acc>=STEP){ update(STEP); acc-=STEP; } render(); }
  else if(Game.state==="paused"||Game.state==="over") render();
  requestAnimationFrame(loop);
}

/* ----------------------------------------------------------------------------
   Flow / UI
---------------------------------------------------------------------------- */
const menuEl=document.getElementById("menu"), winEl=document.getElementById("win");
function startMatch(){
  Game.mode=document.getElementById("mode").value;
  Game.vsCpu=document.getElementById("opponent").value==="cpu";
  Game.killTarget=parseInt(document.getElementById("killTarget").value,10)||15;
  newMatch();
  Game.state="playing"; menuEl.classList.add("hidden"); winEl.classList.add("hidden");
  Sound.resume(); last=performance.now(); acc=0;
}
function endMatch(winner){
  Game.state="over"; Game.winner=winner;
  const wt=document.getElementById("winTitle");
  wt.textContent=(winner.bot?"CPU":"PLAYER "+winner.id)+" WINS"; wt.style.color=winner.color;
  document.getElementById("winStats").textContent=
    `P1 — ${Game.players[0].kills} kills / ${Game.players[0].deaths} deaths    ·    `+
    `${Game.players[1].bot?"CPU":"P2"} — ${Game.players[1].kills} kills / ${Game.players[1].deaths} deaths`;
  winEl.classList.remove("hidden");
}
document.getElementById("startBtn").addEventListener("click",startMatch);
document.getElementById("rematchBtn").addEventListener("click",startMatch);
document.getElementById("menuBtn").addEventListener("click",()=>{ Game.state="menu"; winEl.classList.add("hidden"); menuEl.classList.remove("hidden"); });

/* Input */
const PREVENT=new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Slash","Period","Comma"]);
window.addEventListener("keydown",(e)=>{
  if(PREVENT.has(e.code)) e.preventDefault();
  keys[e.code]=true;
  if(e.code==="KeyP" && (Game.state==="playing"||Game.state==="paused")){
    Game.state=Game.state==="playing"?"paused":"playing";
    if(Game.state==="playing"){ last=performance.now(); acc=0; }
  }
  if(e.code==="Enter" && Game.state==="menu") startMatch();
},{passive:false});
window.addEventListener("keyup",(e)=>{ keys[e.code]=false; });
window.addEventListener("blur",()=>{ for(const k in keys) keys[k]=false; });

requestAnimationFrame(loop);
})();
