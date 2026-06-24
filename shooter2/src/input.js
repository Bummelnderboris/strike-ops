// Pointer-lock mouse-look + keyboard, with remappable bindings and persisted
// settings (sensitivity, FOV, invert-Y, volumes, quality).
import { clamp } from './util.js';

const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'KeyC',
  leanLeft: 'KeyQ',
  leanRight: 'KeyE',
  reload: 'KeyR',
  grenade: 'KeyG',
  interact: 'KeyF',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  weapon4: 'Digit4',
  weapon5: 'Digit5',
  pause: 'Escape',
  scoreboard: 'Tab',
  mute: 'KeyM',
};

const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  fov: 80,
  invertY: false,
  masterVol: 0.8,
  sfxVol: 0.9,
  musicVol: 0.45,
  quality: 'high',
  bobAmount: 1.0,
  showDamageNumbers: true,
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.buttons = { left: false, right: false };
    this.locked = false;
    this.wheel = 0;
    this.pressed = new Set();   // edge-triggered this frame
    this.released = new Set();
    this.mousePressed = { left: false, right: false };
    this.enabled = true;

    this.bindings = this._load('bp_bindings', DEFAULT_BINDINGS);
    this.settings = this._load('bp_settings', DEFAULT_SETTINGS);

    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keyUp(e);
    this._onMouseDown = (e) => this._mouseDown(e);
    this._onMouseUp = (e) => this._mouseUp(e);
    this._onMouseMove = (e) => this._mouseMove(e);
    this._onWheel = (e) => this._onWheelEvt(e);
    this._onLockChange = () => this._lockChange();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  _load(key, def) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...def, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...def };
  }
  saveBindings() { try { localStorage.setItem('bp_bindings', JSON.stringify(this.bindings)); } catch (e) {} }
  saveSettings() { try { localStorage.setItem('bp_settings', JSON.stringify(this.settings)); } catch (e) {} }
  resetBindings() { this.bindings = { ...DEFAULT_BINDINGS }; this.saveBindings(); }

  requestLock() { this.canvas.requestPointerLock?.(); }
  exitLock() { document.exitPointerLock?.(); }

  _lockChange() { this.locked = document.pointerLockElement === this.canvas; }

  _keyDown(e) {
    if (e.code === 'Tab') e.preventDefault();
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  }
  _keyUp(e) { this.keys.delete(e.code); this.released.add(e.code); }
  _mouseDown(e) {
    if (e.button === 0) { this.buttons.left = true; this.mousePressed.left = true; }
    if (e.button === 2) { this.buttons.right = true; this.mousePressed.right = true; }
  }
  _mouseUp(e) {
    if (e.button === 0) this.buttons.left = false;
    if (e.button === 2) this.buttons.right = false;
  }
  _mouseMove(e) {
    if (!this.locked || !this.enabled) return;
    this.mouse.dx += e.movementX || 0;
    this.mouse.dy += e.movementY || 0;
  }
  _onWheelEvt(e) { this.wheel += Math.sign(e.deltaY); }

  // Edge helpers (consume per frame).
  action(name) { return this.keys.has(this.bindings[name]); }
  actionPressed(name) { return this.pressed.has(this.bindings[name]); }

  // Call at end of each frame.
  endFrame() {
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.pressed.clear(); this.released.clear();
    this.mousePressed.left = false; this.mousePressed.right = false;
    this.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

export { DEFAULT_BINDINGS };
