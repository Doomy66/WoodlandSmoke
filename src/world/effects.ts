import * as THREE from "three";
import { roughen } from "../core/shapes";
import type { Ground } from "./scatter";
import { bark, cloth, rockMaps } from "./textures";

function softDot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface ParticleSpec {
  max: number;
  color: THREE.ColorRepresentation;
  additive: boolean;
  life: [number, number];
  size: [number, number];
  alpha: number;
  rise: number;
  windFollow: number;
  spread: number;
}

/** A cloud of soft round particles in one draw call: smoke, sparks, flame. */
class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;

  constructor(private readonly spec: ParticleSpec, texture: THREE.Texture) {
    const n = spec.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: texture },
        uColor: { value: new THREE.Color(spec.color) },
        uScale: { value: 400 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      fog: true,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(uColor, t.a * vAlpha);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  setScale(viewportHeight: number, fov: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.spec.max;
    const s = this.spec.spread;
    this.pos[i * 3] = x + (Math.random() - 0.5) * s;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * s;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.3;
    this.vel[i * 3 + 1] = this.spec.rise * (0.7 + Math.random() * 0.6);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    this.age[i] = 0;
    const [l0, l1] = this.spec.life;
    this.life[i] = l0 + Math.random() * (l1 - l0);
  }

  update(dt: number, wind: { x: number; z: number }): void {
    const [s0, s1] = this.spec.size;
    const f = this.spec.windFollow;
    for (let i = 0; i < this.spec.max; i++) {
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      if (t >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      // Smoke rises straight at first, then the breeze takes it.
      const lean = Math.min(1, t * 3) * f;
      this.vel[i * 3]! += (wind.x * lean - this.vel[i * 3]!) * dt * 0.8;
      this.vel[i * 3 + 2]! += (wind.z * lean - this.vel[i * 3 + 2]!) * dt * 0.8;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.size[i] = s0 + (s1 - s0) * Math.sqrt(t);
      this.alpha[i] = this.spec.alpha * Math.min(1, t * 8) * (1 - t);
    }
    const geo = this.points.geometry;
    geo.getAttribute("position").needsUpdate = true;
    geo.getAttribute("aSize").needsUpdate = true;
    geo.getAttribute("aAlpha").needsUpdate = true;
  }
}

/**
 * The camp: a ring of stones, a fire, and the column of woodsmoke that gives
 * the wood its name. The smoke leans with the wind, so it is a wind gauge you
 * can see from anywhere nearby.
 */
export class Campfire {
  readonly group = new THREE.Group();
  private readonly smoke: Particles;
  private readonly flame: Particles;
  private readonly light: THREE.PointLight;
  private smokeTimer = 0;
  private flameTimer = 0;
  private time = 0;
  private readonly origin: THREE.Vector3;

  constructor(x: number, z: number, ground: Ground, texture: THREE.Texture) {
    const y = ground.heightAt(x, z);
    this.origin = new THREE.Vector3(x, y, z);
    this.group.position.copy(this.origin);

    const rock = rockMaps();
    const stone = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, color: 0x8a8478, roughness: 0.9 });
    const stoneGeo = roughen(new THREE.IcosahedronGeometry(0.2, 2), 0.05, 6, 3).scale(1, 0.7, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(stoneGeo, stone);
      m.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
      m.rotation.set(a, a * 2, 0);
      m.castShadow = true;
      this.group.add(m);
    }
    const barkMaps = bark("oak");
    const wood = new THREE.MeshStandardMaterial({ map: barkMaps.map, normalMap: barkMaps.normalMap, color: 0x8a7a6a, roughness: 0.95 });
    const logGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(logGeo, wood);
      m.position.y = 0.25;
      m.rotation.set(0.9, (i / 4) * Math.PI * 2, 0, "YXZ");
      this.group.add(m);
    }
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0x7a2208, emissiveIntensity: 0.8, roughness: 1 }));
    embers.rotation.x = -Math.PI / 2;
    embers.position.y = 0.03;
    this.group.add(embers);

    // A lean-to shelter beside the fire.
    const canvas = new THREE.MeshStandardMaterial({ color: 0x4f4a3a, map: cloth("wool"), side: THREE.DoubleSide, roughness: 1 });
    const tarp = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), canvas);
    tarp.position.set(-2.8, 0.85, -1.2);
    tarp.rotation.set(-0.95, 0.5, 0, "YXZ");
    tarp.castShadow = true;
    this.group.add(tarp);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 5), wood);
    pole.position.set(-2.3, 0.95, -0.5);
    this.group.add(pole);
    const pole2 = pole.clone();
    pole2.position.set(-3.6, 0.95, 0.3);
    this.group.add(pole2);

    this.light = new THREE.PointLight(0xff8a3a, 6, 14, 1.6);
    this.light.position.set(0, 0.7, 0);
    this.group.add(this.light);

    this.smoke = new Particles(
      { max: 140, color: 0x8b8a86, additive: false, life: [8, 12], size: [0.6, 5], alpha: 0.32, rise: 1.3, windFollow: 0.85, spread: 0.4 },
      texture,
    );
    this.flame = new Particles(
      { max: 60, color: 0xff9a40, additive: true, life: [0.35, 0.7], size: [0.5, 0.15], alpha: 0.9, rise: 1.4, windFollow: 0.1, spread: 0.35 },
      texture,
    );
    this.group.add(this.smoke.points, this.flame.points);
    // Particles are placed in world space.
    this.smoke.points.position.copy(this.origin).negate();
    this.flame.points.position.copy(this.origin).negate();
  }

  setScale(viewportHeight: number, fov: number): void {
    this.smoke.setScale(viewportHeight, fov);
    this.flame.setScale(viewportHeight, fov);
  }

  update(dt: number, wind: { x: number; z: number }): void {
    this.time += dt;
    this.smokeTimer -= dt;
    while (this.smokeTimer <= 0) {
      this.smokeTimer += 0.09;
      this.smoke.emit(this.origin.x, this.origin.y + 0.6, this.origin.z);
    }
    this.flameTimer -= dt;
    while (this.flameTimer <= 0) {
      this.flameTimer += 0.025;
      this.flame.emit(this.origin.x, this.origin.y + 0.15, this.origin.z);
    }
    this.smoke.update(dt, wind);
    this.flame.update(dt, wind);
    this.light.intensity = 5 + Math.sin(this.time * 13) * 0.8 + Math.sin(this.time * 31) * 0.5;
  }
}

/** Pollen and dust drifting through the air around the camera, carried by the wind. */
export class Motes {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly count = 500;
  private readonly box = 36;

  constructor(texture: THREE.Texture) {
    this.pos = new Float32Array(this.count * 3);
    for (let i = 0; i < this.pos.length; i++) this.pos[i] = (Math.random() - 0.5) * this.box;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: texture, color: 0xfff2cc, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  update(dt: number, wind: { x: number; z: number }, centre: THREE.Vector3, time: number): void {
    const b = this.box, h = b / 2;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k]! += (wind.x * 0.6 + Math.sin(time * 0.7 + i) * 0.15) * dt;
      this.pos[k + 1]! += Math.sin(time * 0.5 + i * 1.3) * 0.08 * dt;
      this.pos[k + 2]! += (wind.z * 0.6 + Math.cos(time * 0.6 + i) * 0.15) * dt;
      // Wrap around the camera so there are always motes to see.
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? centre.x : a === 1 ? centre.y : centre.z;
        let v = this.pos[k + a]!;
        while (v < c - h) v += b;
        while (v > c + h) v -= b;
        this.pos[k + a] = v;
      }
    }
    this.points.geometry.getAttribute("position").needsUpdate = true;
  }
}

/** Blood on the ground behind a wounded animal: the trail to follow. */
export class BloodTrail {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly max = 500;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const geo = new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a0a08, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  drop(x: number, y: number, z: number): void {
    const s = 0.05 + Math.random() * 0.1;
    this.q.setFromAxisAngle(this.up, Math.random() * Math.PI);
    this.m.compose(new THREE.Vector3(x, y + 0.03, z), this.q, new THREE.Vector3(s, 1, s * (0.6 + Math.random() * 0.8)));
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? this.max : this.next);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { softDot };
