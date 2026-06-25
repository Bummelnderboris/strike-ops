// DOM-based UI: HUD (health/armor/ammo/minimap/compass/objectives/score),
// hitmarkers, kill feed, damage indicators, plus all menus (main, settings,
// pause, results, buy/upgrade). Canvas minimap. Original styling.
import { clamp, lerp, formatTime } from './util.js';
import { WEAPONS } from './weapons.js';

const CSS = `
#ui-root, #ui-root * { font-family: var(--mono); }
.center { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
.screen { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:radial-gradient(ellipse at center, rgba(8,12,18,0.82), rgba(3,5,8,0.97));
  pointer-events:auto; z-index:20; }
.screen.scan::after { content:''; position:absolute; inset:0; pointer-events:none;
  background:repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px); }
.brand { font-size:clamp(48px,10vw,120px); font-weight:700; letter-spacing:0.14em; line-height:0.9;
  color:#eef3f7; text-shadow:0 0 30px rgba(75,210,255,0.25); }
.brand b { color:var(--accent); }
.sub { color:#8fa3b3; letter-spacing:0.5em; font-size:13px; margin-top:14px; text-transform:uppercase; }
.menu-card { width:min(620px,92vw); padding:38px 42px; background:rgba(10,14,20,0.72);
  border:1px solid rgba(120,160,190,0.18); border-radius:4px;
  box-shadow:0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04); backdrop-filter:blur(6px); }
.menu-title { font-size:26px; letter-spacing:0.3em; color:#cfe0ec; margin-bottom:6px; text-transform:uppercase; }
.menu-desc { color:#7f93a3; font-size:13px; margin-bottom:24px; line-height:1.6; }
.btn { display:flex; align-items:center; justify-content:space-between; gap:14px;
  width:100%; padding:15px 20px; margin:9px 0; cursor:pointer; color:#dbe6ee;
  background:linear-gradient(90deg, rgba(40,54,68,0.5), rgba(24,32,42,0.3));
  border:1px solid rgba(120,160,190,0.18); border-left:3px solid var(--accent2);
  transition:all .14s ease; letter-spacing:0.08em; font-size:15px; text-align:left; }
.btn:hover { background:linear-gradient(90deg, rgba(75,210,255,0.18), rgba(40,54,68,0.4));
  border-left-color:var(--accent); transform:translateX(4px); }
.btn small { color:#7f93a3; font-size:11px; letter-spacing:0.05em; }
.btn.primary { border-left-color:var(--accent); background:linear-gradient(90deg, rgba(255,75,62,0.16), rgba(40,30,30,0.3)); }
.btn.ghost { border-left-color:rgba(120,160,190,0.3); }
.row { display:flex; gap:12px; align-items:center; justify-content:space-between; margin:14px 0; }
.row label { color:#aebdc9; font-size:13px; letter-spacing:0.06em; flex:1; }
.row .val { color:var(--accent2); font-size:13px; min-width:54px; text-align:right; }
input[type=range]{ -webkit-appearance:none; flex:2; height:4px; background:#2a3744; border-radius:2px; outline:none; }
input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
  background:var(--accent2); cursor:pointer; box-shadow:0 0 8px rgba(75,210,255,0.6); }
.toggle { width:46px; height:24px; border-radius:13px; background:#2a3744; position:relative; cursor:pointer; transition:.2s; flex:none; }
.toggle.on { background:var(--accent2); }
.toggle::after { content:''; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#dbe6ee; transition:.2s; }
.toggle.on::after { left:25px; }
.seg { display:flex; gap:6px; }
.seg .opt { padding:7px 14px; border:1px solid rgba(120,160,190,0.2); cursor:pointer; font-size:12px; color:#8fa3b3; letter-spacing:0.08em; }
.seg .opt.on { background:var(--accent2); color:#06202a; border-color:var(--accent2); }
.hint { color:#6f8393; font-size:12px; text-align:center; margin-top:18px; letter-spacing:0.08em; }
.kbd { display:inline-block; padding:1px 7px; border:1px solid rgba(150,170,190,0.4); border-radius:3px; margin:0 2px; color:#cfe0ec; font-size:11px; }

/* HUD */
#hud { position:absolute; inset:0; pointer-events:none; z-index:5; }
#crosshair { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
.ch-line { position:absolute; background:rgba(230,240,248,0.85); box-shadow:0 0 3px rgba(0,0,0,0.7); }
#hitmarker { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); opacity:0; }
.hm-line { position:absolute; width:11px; height:2px; background:#fff; box-shadow:0 0 4px #000; }
#vitals { position:absolute; left:34px; bottom:30px; width:280px; }
.vbar-wrap { margin-bottom:7px; }
.vbar-label { display:flex; justify-content:space-between; font-size:11px; color:#9fb1bf; letter-spacing:0.12em; margin-bottom:3px; }
.vbar { height:11px; background:rgba(10,16,22,0.7); border:1px solid rgba(120,160,190,0.25); position:relative; overflow:hidden; }
.vbar-fill { height:100%; width:100%; transition:width .12s linear; }
.vbar-fill.hp { background:linear-gradient(90deg,#ff4b3e,#ff8a3e); }
.vbar-fill.armor { background:linear-gradient(90deg,#4bd2ff,#4b8aff); }
.vbar-fill.stam { background:linear-gradient(90deg,#6cf06c,#bcf06c); height:4px; }
#ammo { position:absolute; right:38px; bottom:30px; text-align:right; }
#ammo .mag { font-size:54px; font-weight:700; color:#eef3f7; line-height:0.9; text-shadow:0 0 14px rgba(0,0,0,0.6); }
#ammo .mag .res { font-size:22px; color:#8fa3b3; font-weight:400; }
#ammo .wname { font-size:13px; color:var(--accent2); letter-spacing:0.22em; margin-top:6px; }
#ammo .nades { font-size:12px; color:#aebdc9; margin-top:4px; letter-spacing:0.1em; }
#ammo.empty .mag { color:var(--accent); }
#topbar { position:absolute; top:22px; left:50%; transform:translateX(-50%); text-align:center; }
#wave { font-size:13px; color:#9fb1bf; letter-spacing:0.3em; }
#wave b { color:var(--accent); }
#score { font-size:30px; color:#eef3f7; font-weight:700; letter-spacing:0.04em; }
#combo { font-size:14px; color:var(--warn); letter-spacing:0.1em; height:18px; transition:opacity .2s; }
#objective { position:absolute; top:22px; right:34px; text-align:right; max-width:320px; }
#objective .otitle { font-size:11px; color:#7f93a3; letter-spacing:0.2em; }
#objective .otext { font-size:15px; color:#cfe0ec; margin-top:4px; letter-spacing:0.04em; }
#objective .oprog { font-size:13px; color:var(--accent2); margin-top:3px; }
#minimap-wrap { position:absolute; top:20px; left:24px; }
#minimap { border:1px solid rgba(120,160,190,0.3); background:rgba(8,12,18,0.6); border-radius:3px; }
#compass { position:absolute; top:0; left:50%; transform:translateX(-50%); width:340px; height:26px; overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent); }
#compass-strip { position:absolute; top:4px; white-space:nowrap; font-size:12px; color:#aebdc9; letter-spacing:0.1em; }
#compass-strip .card { color:var(--accent2); font-weight:700; }
#killfeed { position:absolute; top:64px; right:34px; text-align:right; }
.kf { font-size:13px; color:#cfe0ec; margin:3px 0; opacity:1; transition:opacity .4s; letter-spacing:0.04em; }
.kf .x { color:var(--accent); margin:0 6px; }
.kf.head .x { color:var(--warn); }
#dmgnums { position:absolute; inset:0; overflow:hidden; }
.dnum { position:absolute; font-size:16px; font-weight:700; color:#ffe066; text-shadow:0 0 4px #000; transition:all .6s ease-out; }
.dnum.head { color:#ff5b4b; font-size:21px; }
#vignette { position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 200px rgba(150,0,0,0); transition:box-shadow .25s; }
#lowhp { position:absolute; inset:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse at center, transparent 40%, rgba(120,0,0,0.5) 100%); transition:opacity .3s; }
#dmgdir { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:260px; height:260px; }
.ddi { position:absolute; left:50%; top:50%; width:50px; height:50px; margin:-110px 0 0 -25px;
  transform-origin:25px 110px; opacity:0; transition:opacity .3s; }
.ddi svg { width:100%; height:100%; }
#flash { position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; transition:opacity .3s; }
#banner { position:absolute; left:50%; top:32%; transform:translate(-50%,-50%); text-align:center; opacity:0; transition:opacity .4s; }
#banner .bt { font-size:42px; font-weight:700; letter-spacing:0.16em; color:#eef3f7; text-shadow:0 0 24px rgba(255,75,62,0.4); }
#banner .bs { font-size:15px; color:var(--accent2); letter-spacing:0.3em; margin-top:8px; }
#hint { position:absolute; left:50%; bottom:120px; transform:translateX(-50%); text-align:center;
  color:#cfe0ec; font-size:14px; letter-spacing:0.08em; opacity:0; transition:opacity .2s; }
#hint .kbd { font-size:13px; }
#scoped { position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .12s; }
#bossbar { position:absolute; top:54px; left:50%; transform:translateX(-50%); width:min(520px,60vw); }
#bossbar .bosslabel { display:flex; justify-content:space-between; font-size:12px; letter-spacing:0.2em; color:var(--accent); margin-bottom:4px; }
#bossbar .bosstrack { height:9px; background:rgba(20,8,8,0.8); border:1px solid rgba(255,75,62,0.5); }
#bossbar .bossfill { height:100%; width:100%; background:linear-gradient(90deg,#ff7a1a,#ff2a1a); transition:width .15s; box-shadow:0 0 12px rgba(255,75,62,0.6); }
.stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 28px; margin:20px 0; }
.stat { border-left:2px solid var(--accent2); padding-left:12px; }
.stat .k { font-size:11px; color:#7f93a3; letter-spacing:0.16em; }
.stat .v { font-size:24px; color:#eef3f7; font-weight:700; }
.buy-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:16px 0; }
.buy { padding:14px; border:1px solid rgba(120,160,190,0.2); border-left:3px solid var(--good); cursor:pointer; transition:.14s; }
.buy:hover { background:rgba(108,240,108,0.1); transform:translateY(-2px); }
.buy.cant { opacity:0.4; border-left-color:#555; cursor:not-allowed; }
.buy .bn { font-size:14px; color:#dbe6ee; letter-spacing:0.06em; }
.buy .bc { font-size:13px; color:var(--good); margin-top:4px; }
.buy .bd { font-size:11px; color:#7f93a3; margin-top:3px; }
#credits { font-size:15px; color:var(--good); letter-spacing:0.1em; }
.fadein { animation:fadein .5s ease; }
@keyframes fadein { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
.blink { animation:blink 1s steps(2) infinite; }
@keyframes blink { 50%{opacity:0.3;} }
`;

export class HUD {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.minimapSize = 168;
    this._buildHUD();
    this.killfeedItems = [];
    this._comboHideT = 0;
    this._lastHp = 100;
  }

  _el(tag, cls, html, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || this.root).appendChild(e);
    return e;
  }

  _buildHUD() {
    const hud = this._el('div', '', '', this.root);
    hud.id = 'hud';
    hud.classList.add('hidden');
    this.hud = hud;

    // Crosshair
    const ch = this._el('div', '', '', hud); ch.id = 'crosshair';
    this.chLines = [];
    for (let i = 0; i < 4; i++) { const l = this._el('div', 'ch-line', '', ch); this.chLines.push(l); }
    this.chDot = this._el('div', 'ch-line', '', ch);
    this.chDot.style.width = '2px'; this.chDot.style.height = '2px';
    this.chDot.style.left = '-1px'; this.chDot.style.top = '-1px';

    // Hitmarker
    const hm = this._el('div', '', '', hud); hm.id = 'hitmarker'; this.hitmarker = hm;
    for (const [r] of [['45deg'], ['135deg'], ['225deg'], ['315deg']]) {
      const l = this._el('div', 'hm-line', '', hm);
      l.style.transform = `rotate(${r}) translate(8px,0)`;
    }

    // Vitals
    const v = this._el('div', '', '', hud); v.id = 'vitals';
    v.innerHTML = `
      <div class="vbar-wrap">
        <div class="vbar-label"><span>HEALTH</span><span id="hpval">100</span></div>
        <div class="vbar"><div class="vbar-fill hp" id="hpfill"></div></div>
      </div>
      <div class="vbar-wrap" id="armorwrap" style="display:none">
        <div class="vbar-label"><span>ARMOR</span><span id="armorval">0</span></div>
        <div class="vbar"><div class="vbar-fill armor" id="armorfill"></div></div>
      </div>
      <div class="vbar" style="height:4px;border:none;background:transparent;margin-top:2px">
        <div class="vbar-fill stam" id="stamfill"></div>
      </div>`;
    this.hpval = v.querySelector('#hpval');
    this.hpfill = v.querySelector('#hpfill');
    this.armorwrap = v.querySelector('#armorwrap');
    this.armorval = v.querySelector('#armorval');
    this.armorfill = v.querySelector('#armorfill');
    this.stamfill = v.querySelector('#stamfill');

    // Ammo
    const a = this._el('div', '', '', hud); a.id = 'ammo';
    a.innerHTML = `<div class="mag"><span id="magval">30</span><span class="res"> / <span id="resval">150</span></span></div>
      <div class="wname" id="wname">VK-7 RIFLE</div>
      <div class="nades" id="nades">⊕ FRAG ×3</div>`;
    this.ammoEl = a;
    this.magval = a.querySelector('#magval');
    this.resval = a.querySelector('#resval');
    this.wname = a.querySelector('#wname');
    this.nades = a.querySelector('#nades');

    // Topbar
    const t = this._el('div', '', '', hud); t.id = 'topbar';
    t.innerHTML = `<div id="wave"></div><div id="score">0</div><div id="combo"></div>`;
    this.waveEl = t.querySelector('#wave');
    this.scoreEl = t.querySelector('#score');
    this.comboEl = t.querySelector('#combo');

    // Objective
    const o = this._el('div', '', '', hud); o.id = 'objective';
    o.innerHTML = `<div class="otitle">OBJECTIVE</div><div class="otext" id="otext">—</div><div class="oprog" id="oprog"></div>`;
    this.otext = o.querySelector('#otext');
    this.oprog = o.querySelector('#oprog');

    // Minimap
    const mm = this._el('div', '', '', hud); mm.id = 'minimap-wrap';
    const canvas = document.createElement('canvas');
    canvas.id = 'minimap'; canvas.width = this.minimapSize; canvas.height = this.minimapSize;
    mm.appendChild(canvas);
    this.miniCanvas = canvas; this.miniCtx = canvas.getContext('2d');

    // Compass
    const comp = this._el('div', '', '', hud); comp.id = 'compass';
    this.compassStrip = this._el('div', '', '', comp); this.compassStrip.id = 'compass-strip';

    // Killfeed
    this.killfeed = this._el('div', '', '', hud); this.killfeed.id = 'killfeed';

    // Damage numbers
    this.dmgnums = this._el('div', '', '', hud); this.dmgnums.id = 'dmgnums';

    // Vignette + low hp + dmg dir + flash
    this.vignette = this._el('div', '', '', hud); this.vignette.id = 'vignette';
    this.lowhp = this._el('div', '', '', hud); this.lowhp.id = 'lowhp';
    this.dmgdir = this._el('div', '', '', hud); this.dmgdir.id = 'dmgdir';
    this.flash = this._el('div', '', '', hud); this.flash.id = 'flash';
    this.dirIndicators = [];

    // Scoped overlay
    this.scoped = this._el('div', '', '', hud); this.scoped.id = 'scoped';
    this.scoped.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs><mask id="sc"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="26" fill="black"/></mask></defs>
      <rect width="100" height="100" fill="#000" mask="url(#sc)"/>
      <circle cx="50" cy="50" r="26" fill="none" stroke="#000" stroke-width="1.2"/>
      <line x1="50" y1="24" x2="50" y2="76" stroke="#000" stroke-width="0.3"/>
      <line x1="24" y1="50" x2="76" y2="50" stroke="#000" stroke-width="0.3"/>
      <line x1="50" y1="40" x2="50" y2="60" stroke="#1a1a1a" stroke-width="0.5"/>
      <line x1="40" y1="50" x2="60" y2="50" stroke="#1a1a1a" stroke-width="0.5"/>
    </svg>`;

    // Boss bar
    const boss = this._el('div', '', '', hud); boss.id = 'bossbar'; boss.classList.add('hidden');
    boss.innerHTML = `<div class="bosslabel"><span id="bossname">TITAN</span><span id="bosshp">100%</span></div>
      <div class="bosstrack"><div class="bossfill" id="bossfill"></div></div>`;
    this.bossbar = boss;
    this.bossfill = boss.querySelector('#bossfill');
    this.bossname = boss.querySelector('#bossname');
    this.bosshp = boss.querySelector('#bosshp');

    // Banner + hint
    this.banner = this._el('div', '', '<div class="bt"></div><div class="bs"></div>', hud);
    this.banner.id = 'banner';
    this.hint = this._el('div', '', '', hud); this.hint.id = 'hint';
  }

  show() { this.hud.classList.remove('hidden'); }
  hide() { this.hud.classList.add('hidden'); }

  setCrosshair(spread, hidden) {
    const gap = clamp(4 + spread * 600, 4, 40);
    const len = 7, w = 2;
    this.chDot.style.display = hidden ? 'none' : 'block';
    const conf = [
      { x: 0, y: -gap - len, w, h: len },   // top
      { x: 0, y: gap, w, h: len },          // bottom
      { x: -gap - len, y: 0, w: len, h: w },// left
      { x: gap, y: 0, w: len, h: w },       // right
    ];
    this.chLines.forEach((l, i) => {
      const c = conf[i];
      l.style.display = hidden ? 'none' : 'block';
      l.style.width = c.w + 'px'; l.style.height = c.h + 'px';
      l.style.left = (c.x - c.w / 2) + 'px'; l.style.top = (c.y - c.h / 2) + 'px';
    });
  }

  hitmark(head, killed) {
    const hm = this.hitmarker;
    hm.style.transition = 'none';
    hm.style.opacity = '1';
    hm.querySelectorAll('.hm-line').forEach((l) => {
      l.style.background = killed ? '#ff4b3e' : (head ? '#ffcf4b' : '#fff');
    });
    void hm.offsetWidth;
    hm.style.transition = 'opacity .3s ease';
    hm.style.opacity = '0';
  }

  damageNumber(amount, head) {
    if (!this.game.input.settings.showDamageNumbers) return;
    const d = this._el('div', 'dnum' + (head ? ' head' : ''), Math.round(amount), this.dmgnums);
    const x = 50 + (Math.random() * 8 - 4), y = 44 + (Math.random() * 6 - 3);
    d.style.left = x + '%'; d.style.top = y + '%';
    requestAnimationFrame(() => {
      d.style.top = (y - 8) + '%'; d.style.opacity = '0';
    });
    setTimeout(() => d.remove(), 650);
  }

  killFeed(name, head) {
    const kf = this._el('div', 'kf' + (head ? ' head' : ''), `OPERATOR <span class="x">${head ? '◈' : '✕'}</span> ${name}`, this.killfeed);
    setTimeout(() => { kf.style.opacity = '0'; }, 2600);
    setTimeout(() => kf.remove(), 3100);
  }

  showDamageDir(angle) {
    const d = this._el('div', 'ddi', `<svg viewBox="0 0 50 50"><path d="M25 4 L36 22 L25 16 L14 22 Z" fill="#ff3b2e"/></svg>`, this.dmgdir);
    d.style.transform = `rotate(${angle}rad)`;
    requestAnimationFrame(() => d.style.opacity = '1');
    setTimeout(() => { d.style.opacity = '0'; }, 700);
    setTimeout(() => d.remove(), 1100);
  }

  banner_(title, sub, hold = 1.6) {
    this.banner.querySelector('.bt').textContent = title;
    this.banner.querySelector('.bs').textContent = sub || '';
    this.banner.style.opacity = '1';
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { this.banner.style.opacity = '0'; }, hold * 1000);
  }

  showHint(html) {
    if (html) { this.hint.innerHTML = html; this.hint.style.opacity = '1'; }
    else this.hint.style.opacity = '0';
  }

  flashScreen(amount = 0.6) {
    this.flash.style.transition = 'none'; this.flash.style.opacity = amount;
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity .4s'; this.flash.style.opacity = '0';
  }

  update(dt, data) {
    // Vitals
    const hpPct = clamp(data.health / data.maxHealth, 0, 1);
    this.hpfill.style.width = (hpPct * 100) + '%';
    this.hpval.textContent = Math.ceil(data.health);
    if (data.armor > 0) { this.armorwrap.style.display = 'block'; this.armorfill.style.width = clamp(data.armor / data.maxArmor, 0, 1) * 100 + '%'; this.armorval.textContent = Math.ceil(data.armor); }
    else this.armorwrap.style.display = 'none';
    this.stamfill.style.width = clamp(data.stamina / 100, 0, 1) * 100 + '%';
    this.lowhp.style.opacity = hpPct < 0.35 ? (0.35 - hpPct) / 0.35 : 0;

    // Ammo
    this.magval.textContent = data.mag;
    this.resval.textContent = data.reserve;
    this.wname.textContent = data.weaponName;
    this.nades.textContent = `⊕ FRAG ×${data.grenades}`;
    this.ammoEl.classList.toggle('empty', data.mag === 0);

    // Score / wave / combo
    this.scoreEl.textContent = data.score.toLocaleString();
    this.waveEl.innerHTML = data.waveText;
    if (data.combo > 1) {
      this.comboEl.style.opacity = '1';
      this.comboEl.textContent = `COMBO ×${data.combo}`;
    } else this.comboEl.style.opacity = '0';

    // Objective
    this.otext.textContent = data.objective || '—';
    this.oprog.textContent = data.objectiveProg || '';

    // Crosshair spread
    this.setCrosshair(data.crosshairSpread, data.scoped && data.ads > 0.6);
    this.scoped.style.opacity = (data.scoped && data.ads > 0.6) ? 1 : 0;

    // Boss bar
    if (data.boss && data.boss.alive) {
      this.bossbar.classList.remove('hidden');
      const pct = clamp(data.boss.hp / data.boss.maxHp, 0, 1);
      this.bossfill.style.width = (pct * 100) + '%';
      this.bossname.textContent = data.boss.name;
      this.bosshp.textContent = Math.ceil(pct * 100) + '%';
    } else {
      this.bossbar.classList.add('hidden');
    }

    // Compass
    this._updateCompass(data.yaw);
    // Minimap
    this._drawMinimap(data);
  }

  _updateCompass(yaw) {
    // yaw 0 => facing +z (south). Convert to heading degrees.
    let heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = ['N', '30', '60', 'E', '120', '150', 'S', '210', '240', 'W', '300', '330'];
    let html = '';
    const pxPerDeg = 340 / 120; // show ~120deg
    for (let d = -180; d <= 180; d += 30) {
      const deg = (heading + d + 360) % 360;
      const idx = Math.round(deg / 30) % 12;
      const label = dirs[idx];
      const isCard = ['N', 'E', 'S', 'W'].includes(label);
      html += `<span style="display:inline-block;width:${30 * pxPerDeg}px;text-align:center" class="${isCard ? 'card' : ''}">${isCard ? label : '·'}</span>`;
    }
    this.compassStrip.innerHTML = html;
    this.compassStrip.style.left = (170 - 340 / 2) + 'px';
  }

  _drawMinimap(data) {
    const ctx = this.miniCtx, S = this.minimapSize, half = S / 2;
    const range = 56; // world units shown radius
    const scale = half / range;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(half, half);
    // rotate so player faces up
    ctx.rotate(data.yaw);
    // colliders (static) as faint rects
    ctx.fillStyle = 'rgba(120,150,175,0.22)';
    for (const c of data.colliders) {
      if (c.max.y < 0.5) continue;
      const x = (c.min.x + c.max.x) / 2 - data.px;
      const z = (c.min.z + c.max.z) / 2 - data.pz;
      const w = (c.max.x - c.min.x) * scale;
      const h = (c.max.z - c.min.z) * scale;
      ctx.fillRect(x * scale - w / 2, z * scale - h / 2, w, h);
    }
    // objective markers
    if (data.objMarker) {
      for (const m of data.objMarker) {
        const x = (m.pos.x - data.px) * scale, z = (m.pos.z - data.pz) * scale;
        ctx.beginPath(); ctx.arc(x, z, m.r * scale, 0, Math.PI * 2);
        ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    // enemies
    for (const e of data.enemies) {
      const x = (e.x - data.px) * scale, z = (e.z - data.pz) * scale;
      if (x * x + z * z > half * half) continue;
      ctx.fillStyle = e.alert ? '#ff4b3e' : '#ff9b3e';
      ctx.beginPath(); ctx.arc(x, z, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // player arrow (always center, pointing up)
    ctx.fillStyle = '#4bd2ff';
    ctx.beginPath();
    ctx.moveTo(half, half - 6); ctx.lineTo(half - 4, half + 5); ctx.lineTo(half + 4, half + 5);
    ctx.closePath(); ctx.fill();
    // border ring
    ctx.strokeStyle = 'rgba(120,160,190,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(half, half, half - 1, 0, Math.PI * 2); ctx.stroke();
  }

  setVignette(amount) {
    this.vignette.style.boxShadow = `inset 0 0 200px rgba(150,0,0,${amount})`;
  }
}
