import * as THREE from "three";
import { Sky as SkyDome } from "three/examples/jsm/objects/Sky.js";

/** Mid-morning: a low sun in the south-east, soft haze through the trees. */
const HAZE = new THREE.Color(0xa9b4b0);
const SUN_ELEVATION = 24;
const SUN_AZIMUTH = 140;

export class Sky {
  readonly sun: THREE.DirectionalLight;
  private readonly target = new THREE.Object3D();
  private readonly dome: SkyDome;
  private readonly sunDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    // Azimuth from north, clockwise: north is -Z, east is +X.
    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));

    this.dome = new SkyDome();
    this.dome.scale.setScalar(200);
    this.dome.frustumCulled = false;
    const u = this.dome.material.uniforms;
    u.turbidity!.value = 7;
    u.rayleigh!.value = 1.4;
    u.mieCoefficient!.value = 0.006;
    u.mieDirectionalG!.value = 0.86;
    u.cloudCoverage!.value = 0.38;
    u.cloudDensity!.value = 0.45;
    u.cloudSpeed!.value = 0.00004;
    u.sunPosition!.value.copy(this.sunDir);
    this.dome.onBeforeRender = (_r, _s, camera) => this.dome.position.copy(camera.position);
    scene.add(this.dome);

    // The sky lights the wood too: a blurred copy of it becomes the ambient light.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envDome = new SkyDome();
    envDome.scale.setScalar(100);
    for (const [k, v] of Object.entries(u)) envDome.material.uniforms[k]!.value = v.value;
    envDome.material.uniforms.showSunDisc!.value = 0;
    envScene.add(envDome);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.42;
    pmrem.dispose();

    scene.background = HAZE.clone();
    scene.fog = new THREE.FogExp2(HAZE.getHex(), 0.0105);

    scene.add(new THREE.HemisphereLight(0xc8d6e0, 0x3a3626, 0.3));

    this.sun = new THREE.DirectionalLight(0xffdcb0, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70;
    s.near = 1; s.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;
    this.sun.target = this.target;
    scene.add(this.sun, this.target);
  }

  update(time: number): void {
    this.dome.material.uniforms.time!.value = time;
  }

  /** Keep the shadowed patch of wood centred on the hunter. Snapped to texels so shadows do not shimmer. */
  follow(p: THREE.Vector3): void {
    const texel = 140 / 2048;
    const x = Math.round(p.x / texel) * texel;
    const z = Math.round(p.z / texel) * texel;
    this.target.position.set(x, p.y, z);
    this.sun.position.set(x + this.sunDir.x * 160, p.y + this.sunDir.y * 160, z + this.sunDir.z * 160);
  }
}
