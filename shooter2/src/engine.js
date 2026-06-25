// Renderer, scene, camera, post-processing (bloom) and the render scaffolding.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e14);

    // Main first-person camera.
    this.camera = new THREE.PerspectiveCamera(
      80, window.innerWidth / window.innerHeight, 0.05, 600
    );
    this.camera.position.set(0, 1.7, 0);

    // Separate camera + scene overlay for the viewmodel so weapons never clip
    // into walls — rendered on top with a cleared depth buffer.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.01, 10
    );
    this.viewLight = new THREE.HemisphereLight(0xcfe0f0, 0x303038, 1.5);
    this.viewScene.add(this.viewLight);
    const vKey = new THREE.DirectionalLight(0xffffff, 2.2);
    vKey.position.set(0.5, 1.2, 1);
    this.viewScene.add(vKey);
    const vFill = new THREE.DirectionalLight(0x8fb0d8, 0.8);
    vFill.position.set(-0.8, 0.2, 0.6);
    this.viewScene.add(vFill);

    this.baseFov = 80;
    window.addEventListener('resize', () => this.onResize());

    this.quality = 'high';
    this._setupComposer();
  }

  _setupComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Selective-ish glow: high threshold so only lamps, emissives, muzzle
    // flashes and tracers bloom — not the whole (dark) scene.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.72);
    this.composer.addPass(this.bloomPass);
    // OutputPass performs tone mapping + sRGB so colors match the direct
    // viewmodel render that follows.
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = true;
  }

  setQuality(q) {
    this.quality = q;
    if (q === 'low') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      this.renderer.shadowMap.enabled = false;
      this.bloomEnabled = false;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      this.renderer.shadowMap.enabled = true;
      this.bloomEnabled = true;
      this.bloomPass.strength = 0.5;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.bloomEnabled = true;
      this.bloomPass.strength = 0.7;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.composer?.setPixelRatio?.(this.renderer.getPixelRatio());
  }

  setFov(fov) {
    this.baseFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloomPass?.resolution?.set(w, h);
  }

  render() {
    const r = this.renderer;
    if (this.bloomEnabled) {
      // Main scene through the bloom composer (writes tone-mapped sRGB to canvas).
      this.composer.render();
    } else {
      r.autoClear = true;
      r.render(this.scene, this.camera);
    }
    // Overlay weapon viewmodel on a fresh depth buffer, on top of the result.
    r.autoClear = false;
    r.clearDepth();
    r.render(this.viewScene, this.viewCamera);
    r.autoClear = true;
  }
}
