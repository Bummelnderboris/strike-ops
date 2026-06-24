// Renderer, scene, camera and the fixed-timestep loop scaffolding.
import * as THREE from 'three';

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
  }

  setQuality(q) {
    this.quality = q;
    if (q === 'low') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      this.renderer.shadowMap.enabled = false;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
    }
    this.renderer.shadowMap.needsUpdate = true;
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
  }

  render() {
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    // Overlay weapon viewmodel on a fresh depth buffer.
    r.autoClear = false;
    r.clearDepth();
    r.render(this.viewScene, this.viewCamera);
    r.autoClear = true;
  }
}
