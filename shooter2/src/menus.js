// All full-screen menus: main, mode-select, settings (incl. control remapping),
// pause, results/game-over, and the between-wave buy/upgrade screen.
import { audio } from './audio.js';
import { WEAPONS } from './weapons.js';
import { DEFAULT_BINDINGS } from './input.js';

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.input = game.input;
    this.current = null;
    this.remapping = null;
    window.addEventListener('keydown', (e) => this._captureRemap(e), true);
  }

  _screen(scan = true) {
    const s = document.createElement('div');
    s.className = 'screen' + (scan ? ' scan' : '');
    this.root.appendChild(s);
    return s;
  }
  clear() {
    if (this.current) { this.current.remove(); this.current = null; }
  }

  _btn(parent, label, sub, cb, cls = '') {
    const b = document.createElement('div');
    b.className = 'btn ' + cls;
    b.innerHTML = `<span>${label}</span>${sub ? `<small>${sub}</small>` : ''}`;
    b.onclick = () => { audio.click(); cb(); };
    b.onmouseenter = () => audio.click();
    parent.appendChild(b);
    return b;
  }

  // ---------- MAIN MENU ----------
  showMain() {
    this.clear();
    const s = this._screen();
    s.innerHTML = `
      <div style="text-align:center">
        <div class="brand fadein">BREACH<b>POINT</b></div>
        <div class="sub fadein">GHOST DIVISION · ZERO HOUR</div>
        <div class="menu-card fadein" style="margin-top:40px; text-align:left"></div>
        <div class="hint fadein">An original browser FPS · Three.js · Click a mode, then click to lock the mouse</div>
      </div>`;
    const card = s.querySelector('.menu-card');
    this._btn(card, 'SURVIVAL', 'Endless escalating waves', () => this.game.startMode('survival'), 'primary');
    this._btn(card, 'OPERATION', 'Secure & hold all sectors', () => this.game.startMode('operation'));
    this._btn(card, 'SETTINGS', 'Sensitivity · audio · graphics · controls', () => this.showSettings('main'));
    this._btn(card, 'HOW TO PLAY', 'Controls & briefing', () => this.showHelp());
    this.current = s;
  }

  showHelp() {
    this.clear();
    const s = this._screen();
    s.innerHTML = `
      <div class="menu-card fadein" style="max-width:680px">
        <div class="menu-title">FIELD MANUAL</div>
        <div class="menu-desc">You are a lone operator. Hostiles will detect, flank, and take cover — keep moving, use cover, aim for the head.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;font-size:13px;color:#bccad6;line-height:2">
          <div><span class="kbd">W A S D</span> Move</div>
          <div><span class="kbd">Shift</span> Sprint</div>
          <div><span class="kbd">C</span> Crouch / Slide</div>
          <div><span class="kbd">Space</span> Jump</div>
          <div><span class="kbd">Q</span> / <span class="kbd">E</span> Lean</div>
          <div><span class="kbd">Mouse</span> Look</div>
          <div><span class="kbd">LMB</span> Fire</div>
          <div><span class="kbd">RMB</span> Aim (ADS)</div>
          <div><span class="kbd">R</span> Reload</div>
          <div><span class="kbd">G</span> Grenade</div>
          <div><span class="kbd">1-5</span> / Wheel Switch weapon</div>
          <div><span class="kbd">F</span> Interact / Buy</div>
          <div><span class="kbd">Esc</span> Pause</div>
          <div><span class="kbd">M</span> Mute</div>
        </div>
        <div class="menu-desc" style="margin-top:18px">SURVIVAL: survive waves, earn credits on kills, spend them between waves on weapons, armor, ammo and upgrades.
        OPERATION: capture and hold every sector marked on your map to win.</div>
      </div>`;
    const back = document.createElement('div'); back.style.textAlign = 'center'; s.appendChild(back);
    this._btn(s.querySelector('.menu-card'), '◂ BACK', '', () => this.showMain(), 'ghost');
    this.current = s;
  }

  // ---------- SETTINGS ----------
  showSettings(returnTo = 'main') {
    this.clear();
    const st = this.input.settings;
    const s = this._screen();
    const card = document.createElement('div');
    card.className = 'menu-card fadein';
    card.style.maxWidth = '680px';
    card.innerHTML = `<div class="menu-title">SETTINGS</div>`;
    s.appendChild(card);

    const slider = (label, key, min, max, step, fmt) => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<label>${label}</label>`;
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = st[key];
      const val = document.createElement('span'); val.className = 'val'; val.textContent = fmt(st[key]);
      input.oninput = () => { st[key] = parseFloat(input.value); val.textContent = fmt(st[key]); this.game.applySettings(); this.input.saveSettings(); };
      row.appendChild(input); row.appendChild(val); card.appendChild(row);
    };
    slider('Mouse Sensitivity', 'sensitivity', 0.1, 3, 0.05, (v) => v.toFixed(2));
    slider('Field of View', 'fov', 60, 110, 1, (v) => v + '°');
    slider('Master Volume', 'masterVol', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('SFX Volume', 'sfxVol', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('Music Volume', 'musicVol', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('View Bob', 'bobAmount', 0, 1.5, 0.05, (v) => Math.round(v * 100) + '%');

    const toggleRow = (label, key) => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<label>${label}</label>`;
      const tg = document.createElement('div'); tg.className = 'toggle' + (st[key] ? ' on' : '');
      tg.onclick = () => { st[key] = !st[key]; tg.classList.toggle('on', st[key]); this.game.applySettings(); this.input.saveSettings(); audio.click(); };
      row.appendChild(tg); card.appendChild(row);
    };
    toggleRow('Invert Look Y', 'invertY');
    toggleRow('Damage Numbers', 'showDamageNumbers');

    // Quality segmented
    const qrow = document.createElement('div'); qrow.className = 'row';
    qrow.innerHTML = `<label>Graphics Quality</label>`;
    const seg = document.createElement('div'); seg.className = 'seg';
    ['low', 'medium', 'high'].forEach((q) => {
      const opt = document.createElement('div'); opt.className = 'opt' + (st.quality === q ? ' on' : '');
      opt.textContent = q.toUpperCase();
      opt.onclick = () => { st.quality = q; seg.querySelectorAll('.opt').forEach((o) => o.classList.remove('on')); opt.classList.add('on'); this.game.applySettings(); this.input.saveSettings(); audio.click(); };
      seg.appendChild(opt);
    });
    qrow.appendChild(seg); card.appendChild(qrow);

    // Controls remap
    const ctrlTitle = document.createElement('div');
    ctrlTitle.style.cssText = 'margin:22px 0 10px;color:#8fa3b3;letter-spacing:0.2em;font-size:12px';
    ctrlTitle.textContent = 'CONTROLS — click a key to rebind';
    card.appendChild(ctrlTitle);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px 20px';
    const labels = {
      forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump',
      sprint: 'Sprint', crouch: 'Crouch', leanLeft: 'Lean L', leanRight: 'Lean R',
      reload: 'Reload', grenade: 'Grenade', interact: 'Interact',
    };
    this.remapBtns = {};
    for (const key of Object.keys(labels)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#aebdc9';
      const kb = document.createElement('span');
      kb.className = 'kbd'; kb.style.cursor = 'pointer'; kb.style.minWidth = '60px'; kb.style.textAlign = 'center';
      kb.textContent = this._keyName(this.input.bindings[key]);
      kb.onclick = () => this._beginRemap(key, kb);
      this.remapBtns[key] = kb;
      row.innerHTML = `<span>${labels[key]}</span>`;
      row.appendChild(kb); grid.appendChild(row);
    }
    card.appendChild(grid);

    const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px';
    const back = document.createElement('div'); back.className = 'btn ghost'; back.style.flex = '1';
    back.innerHTML = '<span>◂ BACK</span>';
    back.onclick = () => { audio.click(); returnTo === 'pause' ? this.showPause() : this.showMain(); };
    const reset = document.createElement('div'); reset.className = 'btn ghost'; reset.style.flex = '1';
    reset.innerHTML = '<span>RESET CONTROLS</span>';
    reset.onclick = () => { audio.click(); this.input.resetBindings(); for (const k of Object.keys(this.remapBtns)) this.remapBtns[k].textContent = this._keyName(this.input.bindings[k]); };
    btnRow.appendChild(back); btnRow.appendChild(reset); card.appendChild(btnRow);

    this.current = s;
  }

  _keyName(code) {
    return code.replace('Key', '').replace('Digit', '').replace('Left', ' L').replace('Right', ' R')
      .replace('Arrow', '').replace('Space', 'SPACE').replace('Control', 'CTRL').replace('Shift', 'SHIFT');
  }
  _beginRemap(action, el) {
    this.remapping = { action, el };
    el.textContent = '...'; el.classList.add('blink');
  }
  _captureRemap(e) {
    if (!this.remapping) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code !== 'Escape') {
      this.input.bindings[this.remapping.action] = e.code;
      this.input.saveBindings();
    }
    this.remapping.el.classList.remove('blink');
    this.remapping.el.textContent = this._keyName(this.input.bindings[this.remapping.action]);
    this.remapping = null;
  }

  // ---------- PAUSE ----------
  showPause() {
    this.clear();
    const s = this._screen();
    const card = document.createElement('div'); card.className = 'menu-card fadein';
    card.innerHTML = `<div class="menu-title">PAUSED</div><div class="menu-desc">${this.game.modeName} · Wave ${this.game.wave}</div>`;
    s.appendChild(card);
    this._btn(card, 'RESUME', 'Back to the fight', () => this.game.resume(), 'primary');
    this._btn(card, 'SETTINGS', '', () => this.showSettings('pause'));
    this._btn(card, 'RESTART', 'Restart this mode', () => this.game.restart());
    this._btn(card, 'ABANDON', 'Return to main menu', () => this.game.quitToMenu(), 'ghost');
    this.current = s;
  }

  // ---------- RESULTS / GAME OVER ----------
  showResults(stats, victory) {
    this.clear();
    const s = this._screen();
    const card = document.createElement('div'); card.className = 'menu-card fadein'; card.style.maxWidth = '620px';
    const acc = stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0;
    card.innerHTML = `
      <div class="menu-title" style="color:${victory ? 'var(--good)' : 'var(--accent)'}">${victory ? 'SECTOR SECURED' : 'OPERATOR DOWN'}</div>
      <div class="menu-desc">${victory ? 'All objectives neutralized. Outstanding work.' : 'You held the line as long as you could.'}</div>
      <div class="stat-grid">
        <div class="stat"><div class="k">SCORE</div><div class="v">${stats.score.toLocaleString()}</div></div>
        <div class="stat"><div class="k">WAVE REACHED</div><div class="v">${stats.wave}</div></div>
        <div class="stat"><div class="k">KILLS</div><div class="v">${stats.kills}</div></div>
        <div class="stat"><div class="k">HEADSHOTS</div><div class="v">${stats.headshots}</div></div>
        <div class="stat"><div class="k">ACCURACY</div><div class="v">${acc}%</div></div>
        <div class="stat"><div class="k">TIME SURVIVED</div><div class="v">${formatTimeLocal(stats.time)}</div></div>
        <div class="stat"><div class="k">BEST COMBO</div><div class="v">×${stats.bestCombo}</div></div>
        <div class="stat"><div class="k">LEVEL</div><div class="v">${stats.level}</div></div>
      </div>`;
    s.appendChild(card);
    this._btn(card, 'REDEPLOY', 'Run it back', () => this.game.restart(), 'primary');
    this._btn(card, 'MAIN MENU', '', () => this.game.quitToMenu(), 'ghost');
    this.current = s;
  }

  // ---------- BUY / UPGRADE (between waves, survival) ----------
  showBuy(onClose) {
    this.clear();
    const s = this._screen();
    const g = this.game;
    const card = document.createElement('div'); card.className = 'menu-card fadein'; card.style.maxWidth = '720px';
    card.innerHTML = `<div class="menu-title">ARMORY</div>
      <div class="menu-desc">Wave ${g.wave} cleared. Spend credits, then redeploy. <span id="credits">⛁ ${g.credits} CR</span></div>`;
    s.appendChild(card);

    const grid = document.createElement('div'); grid.className = 'buy-grid'; card.appendChild(grid);
    const credEl = () => card.querySelector('#credits');

    const items = g.getShopItems();
    const render = () => {
      grid.innerHTML = '';
      credEl().textContent = `⛁ ${g.credits} CR`;
      for (const it of g.getShopItems()) {
        const can = g.credits >= it.cost && !it.owned;
        const b = document.createElement('div');
        b.className = 'buy' + (can ? '' : ' cant');
        b.innerHTML = `<div class="bn">${it.name}</div><div class="bc">${it.owned ? 'OWNED' : '⛁ ' + it.cost + ' CR'}</div><div class="bd">${it.desc}</div>`;
        if (can) b.onclick = () => { if (g.buy(it.id)) { audio.pickup(); render(); } else audio.click(); };
        grid.appendChild(b);
      }
    };
    render();

    const deploy = document.createElement('div'); deploy.className = 'btn primary'; deploy.style.marginTop = '14px';
    deploy.innerHTML = '<span>REDEPLOY ▸</span><small>Start next wave</small>';
    deploy.onclick = () => { audio.click(); onClose(); };
    card.appendChild(deploy);
    this.current = s;
  }
}

function formatTimeLocal(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
