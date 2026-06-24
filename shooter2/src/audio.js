// Fully procedural audio: all gunshots, impacts, UI and music are synthesized
// at runtime with the WebAudio API. No audio files, no copyrighted samples.
import { clamp, rand } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = false;
    this.masterVol = 0.8;
    this.sfxVol = 0.9;
    this.musicVol = 0.45;
    this.noiseBuf = null;
    this._musicTimer = 0;
    this._musicOn = false;
    this._step = 0;
  }

  // Must be called from a user gesture (browser autoplay policy).
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVol;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol;
    this.musicGain.connect(this.master);

    // Pre-bake a noise buffer used by many effects.
    const len = this.ctx.sampleRate * 1.0;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  setMute(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.masterVol;
  }
  setMaster(v) { this.masterVol = v; if (this.master && !this.muted) this.master.gain.value = v; }
  setSfx(v) { this.sfxVol = v; if (this.sfxGain) this.sfxGain.gain.value = v; }
  setMusic(v) { this.musicVol = v; if (this.musicGain) this.musicGain.gain.value = v; }

  _noise(dur, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(dest);
    src.start();
    src.stop(this.t + dur);
    return src;
  }

  _env(gain, peak, attack, decay, dest, t = this.t) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    gain.connect(dest);
  }

  // ---- Weapon report. Layered: body thump (sine) + crack (noise+bandpass). ----
  gunshot(profile = {}) {
    if (!this.ctx) return;
    const t = this.t;
    const dest = this.sfxGain;
    const {
      body = 140, crackHz = 1800, dur = 0.22, level = 0.9, q = 0.8, sub = true,
    } = profile;

    // Low body
    if (sub) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(body * 1.6, t);
      osc.frequency.exponentialRampToValueAtTime(body * 0.5, t + dur * 0.7);
      this._env(g, level * 0.9, 0.002, dur, dest, t);
      osc.connect(g);
      osc.start(t); osc.stop(t + dur + 0.05);
    }
    // Crack (filtered noise burst)
    const g2 = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(crackHz, t);
    bp.frequency.exponentialRampToValueAtTime(crackHz * 0.4, t + dur * 0.5);
    bp.Q.value = q;
    this._env(g2, level, 0.001, dur * 0.6, dest, t);
    bp.connect(g2);
    this._noise(dur * 0.7, bp);
    // High snap
    const g3 = this.ctx.createGain();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    this._env(g3, level * 0.5, 0.0005, 0.05, dest, t);
    hp.connect(g3);
    this._noise(0.06, hp);
  }

  // Distant enemy fire — duller, with a touch of slap-back.
  enemyShot() {
    this.gunshot({ body: 110, crackHz: 1200, dur: 0.16, level: 0.32, q: 0.7 });
  }

  click() {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const o = this.ctx.createOscillator();
    o.type = 'square'; o.frequency.value = 900;
    this._env(g, 0.15, 0.001, 0.03, this.sfxGain, t);
    o.connect(g); o.start(t); o.stop(t + 0.05);
  }

  reloadClick(pitch = 1) {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200 * pitch; bp.Q.value = 3;
    this._env(g, 0.3, 0.001, 0.06, this.sfxGain, t);
    bp.connect(g); this._noise(0.07, bp);
  }

  shell() {
    if (!this.ctx) return;
    const t = this.t + rand(0.0, 0.02);
    const g = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200 + rand(-400, 400); bp.Q.value = 4;
    this._env(g, 0.12, 0.001, 0.08, this.sfxGain, t);
    bp.connect(g); this._noise(0.09, bp);
  }

  hitmarker(head = false) {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(head ? 1700 : 1100, t);
    if (head) o.frequency.exponentialRampToValueAtTime(2400, t + 0.04);
    this._env(g, 0.22, 0.001, head ? 0.09 : 0.05, this.sfxGain, t);
    o.connect(g); o.start(t); o.stop(t + 0.12);
  }

  impact(material = 'concrete') {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = material === 'metal' ? 'bandpass' : 'lowpass';
    bp.frequency.value = material === 'metal' ? 2600 : 900;
    bp.Q.value = material === 'metal' ? 6 : 1;
    this._env(g, material === 'metal' ? 0.18 : 0.14, 0.001, 0.07, this.sfxGain, t);
    bp.connect(g); this._noise(0.08, bp);
    if (material === 'metal') {
      const o = this.ctx.createOscillator(); const g2 = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 1800 + rand(-200, 400);
      this._env(g2, 0.08, 0.001, 0.12, this.sfxGain, t);
      o.connect(g2); o.start(t); o.stop(t + 0.16);
    }
  }

  explosion() {
    if (!this.ctx) return;
    const t = this.t, dest = this.sfxGain;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    this._env(g, 1.0, 0.003, 0.7, dest, t);
    o.connect(g); o.start(t); o.stop(t + 0.8);
    const g2 = this.ctx.createGain(); const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    this._env(g2, 0.9, 0.002, 0.6, dest, t);
    lp.connect(g2); this._noise(0.7, lp);
  }

  footstep() {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500 + rand(-80, 120);
    this._env(g, 0.06, 0.002, 0.06, this.sfxGain, t);
    lp.connect(g); this._noise(0.07, lp);
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.18);
    this._env(g, 0.25, 0.002, 0.2, this.sfxGain, t);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }

  alarm() {
    if (!this.ctx) return;
    const t = this.t, g = this.ctx.createGain();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(660, t);
    o.frequency.linearRampToValueAtTime(440, t + 0.3);
    o.frequency.linearRampToValueAtTime(660, t + 0.6);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 2;
    this._env(g, 0.18, 0.05, 0.55, this.sfxGain, t);
    o.connect(bp); bp.connect(g); o.start(t); o.stop(t + 0.65);
  }

  waveStinger(up = true) {
    if (!this.ctx) return;
    const t = this.t; const notes = up ? [220, 277, 330, 440] : [440, 330, 220];
    notes.forEach((f, i) => {
      const tt = t + i * 0.09;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.2, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.25);
      o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
      o.start(tt); o.stop(tt + 0.3);
    });
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.t;
    [880, 1320].forEach((f, i) => {
      const tt = t + i * 0.06;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      this._env(g, 0.16, 0.002, 0.12, this.sfxGain, tt);
      o.connect(g); o.start(tt); o.stop(tt + 0.16);
    });
  }

  // ---- Ambient + adaptive music bed (looping arpeggio + drone). ----
  startMusic(intensity = 0) {
    if (!this.ctx || this._musicOn) return;
    this._musicOn = true;
    this._musicIntensity = intensity;
    this._scheduleMusic();
    // Low drone
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    g.gain.value = 0.06;
    o.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start();
    this._drone = { o, g };
  }

  setIntensity(v) { this._musicIntensity = clamp(v, 0, 1); }

  _scheduleMusic() {
    if (!this._musicOn) return;
    const seq = [0, 3, 7, 10, 12, 10, 7, 3];
    const root = 110;
    const stepDur = 0.26;
    const i = this._step % seq.length;
    const semi = seq[i];
    const f = root * Math.pow(2, semi / 12);
    const t = this.t;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 600 + (this._musicIntensity || 0) * 2600;
    const amp = 0.05 + (this._musicIntensity || 0) * 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + stepDur * 0.9);
    o.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + stepDur);
    // percussive tick on downbeats when intense
    if (this._musicIntensity > 0.35 && i % 2 === 0) {
      const gn = this.ctx.createGain(); const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 5000;
      this._env(gn, 0.05 * this._musicIntensity, 0.001, 0.04, this.musicGain, t);
      hp.connect(gn); this._noise(0.05, hp);
    }
    this._step++;
    this._musicTimeout = setTimeout(() => this._scheduleMusic(), stepDur * 1000);
  }

  stopMusic() {
    this._musicOn = false;
    clearTimeout(this._musicTimeout);
    if (this._drone) { try { this._drone.o.stop(); } catch (e) {} this._drone = null; }
  }
}

export const audio = new AudioEngine();
