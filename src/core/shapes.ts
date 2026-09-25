import * as THREE from "three";

/**
 * A tube that follows a curve and tapers along it: trunks, branches, antlers,
 * a deer's neck, the limbs of a bow. `radius` gives the radius at each point
 * along the curve (t from 0 to 1). UVs wrap once around and run along the
 * length in metres times `vScale`, so a bark texture keeps its proportions
 * however long the branch is.
 */
export function limb(
  curve: THREE.Curve<THREE.Vector3>,
  radius: (t: number) => number,
  radial = 8,
  segments = 12,
  vScale = 1,
  capEnd = false,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const length = curve.getLength();
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = radius(t);
    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nrm.push(n.x, n.y, n.z);
      uv.push(j / radial, t * length * vScale);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = (i + 1) * row + j, c = (i + 1) * row + j + 1, d = i * row + j + 1;
      idx.push(a, d, b, b, d, c);
    }
  }
  if (capEnd) {
    // A rounded-off end: a single point just past the last ring.
    curve.getPointAt(1, p);
    const T = frames.tangents[segments]!;
    const tip = pos.length / 3;
    const r = radius(1);
    pos.push(p.x + T.x * r, p.y + T.y * r, p.z + T.z * r);
    nrm.push(T.x, T.y, T.z);
    uv.push(0.5, length * vScale);
    const last = segments * row;
    for (let j = 0; j < radial; j++) idx.push(last + j, last + j + 1, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A smooth curve through points. */
export function path(points: [number, number, number][]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
}

/** A straight or gently bent limb between two points, for arms and legs. */
export function segment(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, radial = 10): THREE.BufferGeometry {
  const curve = new THREE.LineCurve3(from, to);
  return limb(curve, (t) => r0 + (r1 - r0) * t, radial, 4, 1, false);
}

/**
 * Round-ended shape along Y, profile given as [y, radius] pairs from bottom
 * to top: torsos, heads, bellies. The first and last radius should be near
 * zero to close the ends.
 */
export function lathe(profile: [number, number][], segments = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segments);
}

/**
 * Nudge every vertex outward by smooth noise, so rocks and bodies are not
 * perfectly round. Vertices at the same place move together.
 */
export function roughen(geo: THREE.BufferGeometry, amount: number, freq: number, seed: number): THREE.BufferGeometry {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = smooth3(v.x * freq + seed, v.y * freq - seed, v.z * freq + seed * 0.5);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Cheap smooth 3D value noise, -1..1. */
export function smooth3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Colour every vertex by a function of its position: bellies, rump patches, moss on top of rocks. */
export function paint(geo: THREE.BufferGeometry, colour: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colour(p.getX(i), p.getY(i), p.getZ(i), c);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}
