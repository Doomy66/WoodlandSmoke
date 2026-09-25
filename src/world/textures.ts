import * as THREE from "three";
import { makeRng, type Rng } from "../core/rng";
import { makeNoise2, type Noise2 } from "../core/simplex";
import { photoPair } from "./photo";

/**
 * Every texture in the game, painted in code when the wood is grown: bark,
 * leaf litter, grass, leaves, fern fronds, fur and cloth. Each is made once
 * and shared.
 */

const cache = new Map<string, THREE.Texture>();

function once(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function colourTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Fractal noise that tiles seamlessly over a w×h image, by blending four offset samples. */
function tiled(noise: Noise2, x: number, y: number, w: number, h: number, scale: number, octaves: number, stretchY = 1): number {
  const sample = (px: number, py: number) => {
    let s = 0, amp = 1, f = scale, norm = 0;
    for (let o = 0; o < octaves; o++) {
      s += amp * noise(px * f, py * f * stretchY);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / norm;
  };
  const u = x / w, v = y / h;
  return (
    sample(x, y) * (1 - u) * (1 - v) +
    sample(x - w, y) * u * (1 - v) +
    sample(x, y - h) * (1 - u) * v +
    sample(x - w, y - h) * u * v
  ) * 1.6;
}

/** A normal map from a height field, for surfaces with relief: bark, rock. */
function normalFromHeight(height: Float32Array, w: number, h: number, strength: number): THREE.Texture {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)]!, r = height[y * w + ((x + 1) % w)]!;
      const u = height[((y - 1 + h) % h) * w + x]!, d = height[((y + 1) % h) * w + x]!;
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

type Rgb = [number, number, number];

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Paint a height/colour field into a tiling colour texture and matching normal map. */
function field(
  key: string, w: number, h: number, strength: number,
  fn: (x: number, y: number) => { h: number; c: Rgb },
): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = cache.get(`${key}:map`);
  const nm = cache.get(`${key}:nrm`);
  if (map && nm) return { map, normalMap: nm };
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = fn(x, y);
      height[y * w + x] = s.h;
      const i = (y * w + x) * 4;
      img.data[i] = s.c[0]; img.data[i + 1] = s.c[1]; img.data[i + 2] = s.c[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const out = { map: colourTexture(c), normalMap: normalFromHeight(height, w, h, strength) };
  cache.set(`${key}:map`, out.map);
  cache.set(`${key}:nrm`, out.normalMap);
  return out;
}

export type BarkKind = "oak" | "pine" | "birch";

export function bark(kind: BarkKind): { map: THREE.Texture; normalMap: THREE.Texture } {
  // Oak and spruce are photographed bark; there is no birch in the library, so birch is painted.
  if (kind === "oak") return photoPair("jolcham_oak_bark_01", 2, 0.5);
  if (kind === "pine") return photoPair("pine_bark", 2, 1);
  const maps = barkField(kind);
  // Three times round a trunk keeps the bark from looking stretched.
  maps.map.repeat.set(3, 1);
  maps.normalMap.repeat.set(3, 1);
  return maps;
}

function barkField(kind: BarkKind): { map: THREE.Texture; normalMap: THREE.Texture } {
  const n = makeNoise2(kind === "oak" ? 31 : kind === "pine" ? 32 : 33);
  const m = makeNoise2(40);
  const w = 128, h = 256;
  if (kind === "birch") {
    return field("bark-birch", w, h, 2, (x, y) => {
      const base = tiled(n, x, y, w, h, 0.02, 3);
      // Dark horizontal lenticels and patches of rough black bark.
      const band = tiled(m, x, y, w, h, 0.012, 3, 9);
      const dark = Math.max(0, band - 0.35) * 3;
      const patch = Math.max(0, tiled(n, x + 50, y, w, h, 0.03, 3) - 0.45) * 3;
      const t = Math.min(1, dark + patch);
      const c = mixRgb([222, 218, 206], [38, 34, 30], t);
      const shade = 1 + base * 0.08;
      return { h: -t + base * 0.1, c: [c[0] * shade, c[1] * shade, c[2] * shade] };
    });
  }
  const light: Rgb = kind === "oak" ? [104, 90, 76] : [128, 88, 62];
  const deep: Rgb = kind === "oak" ? [38, 32, 27] : [50, 34, 26];
  return field(`bark-${kind}`, w, h, kind === "oak" ? 5 : 4, (x, y) => {
    // Long vertical ridges, broken up by cross-cracks.
    const ridge = 1 - Math.abs(tiled(n, x, y, w, h, kind === "oak" ? 0.05 : 0.035, 4, 0.18));
    const plates = kind === "pine" ? 1 - Math.abs(tiled(m, x, y, w, h, 0.04, 3, 0.6)) : 1;
    const hgt = Math.pow(ridge, 3) * plates;
    const grain = tiled(m, x, y, w, h, 0.2, 2) * 0.1;
    const c = mixRgb(deep, light, Math.min(1, hgt * 1.1 + grain));
    return { h: hgt + grain * 0.3, c };
  });
}

export type LeafKind = "oak" | "birch" | "pine" | "bush";

/**
 * A spray of leaves on a transparent card. Trees are built from a few hundred
 * of these, which is how games have drawn foliage for twenty years.
 */
export function leaves(kind: LeafKind): THREE.Texture {
  return once(`leaves-${kind}`, () => {
    const size = 256;
    const rng = makeRng(kind.length * 13 + 7);
    const { c, g } = canvas(size, size);
    if (kind === "pine") {
      drawNeedles(g, rng, size);
    } else {
      drawLeafSpray(g, rng, size, kind);
    }
    const t = colourTexture(c, false);
    t.premultiplyAlpha = false;
    return t;
  });
}

function drawLeafSpray(g: CanvasRenderingContext2D, rng: Rng, size: number, kind: LeafKind): void {
  const count = kind === "birch" ? 190 : kind === "bush" ? 200 : 150;
  const leafLen = kind === "birch" ? 17 : kind === "bush" ? 19 : 26;
  const hueBase = kind === "birch" ? 78 : kind === "bush" ? 92 : 86;
  // Twigs from the base of the card.
  g.strokeStyle = "rgb(70,55,40)";
  g.lineCap = "round";
  const tips: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (rng() - 0.5) * 1.6;
    const len = size * (0.3 + rng() * 0.25);
    const x1 = size / 2 + Math.cos(ang) * len, y1 = size * 0.92 + Math.sin(ang) * len;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(size / 2, size * 0.95);
    g.quadraticCurveTo(size / 2 + (rng() - 0.5) * 30, size * 0.7, x1, y1);
    g.stroke();
    tips.push([x1, y1]);
  }
  for (let i = 0; i < count; i++) {
    const [tx, ty] = tips[i % tips.length]!;
    const r = Math.sqrt(rng()) * size * 0.34;
    const a = rng() * Math.PI * 2;
    const x = Math.min(size - 14, Math.max(14, tx + Math.cos(a) * r));
    const y = Math.min(size - 14, Math.max(14, ty + Math.sin(a) * r * 0.8));
    const ang = a + (rng() - 0.5) * 0.8;
    const len = leafLen * (0.7 + rng() * 0.5);
    const lig = 15 + rng() * 18;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = `hsl(${hueBase + 8 + (rng() - 0.5) * 22},${38 + rng() * 20}%,${lig}%)`;
    g.beginPath();
    if (kind === "oak") {
      // Lobed edge.
      g.moveTo(0, 0);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const wv = Math.sin(t * Math.PI) * len * 0.32 * (1 + 0.25 * Math.sin(t * Math.PI * 7));
        g.lineTo(t * len, -wv);
      }
      for (let k = 8; k >= 0; k--) {
        const t = k / 8;
        const wv = Math.sin(t * Math.PI) * len * 0.32 * (1 + 0.25 * Math.sin(t * Math.PI * 7 + 1));
        g.lineTo(t * len, wv);
      }
    } else {
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
      g.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
    }
    g.fill();
    // Midrib, a lighter line.
    g.strokeStyle = `hsla(${hueBase},40%,${lig + 18}%,0.6)`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
    g.restore();
  }
}

function drawNeedles(g: CanvasRenderingContext2D, rng: Rng, size: number): void {
  // A flat spray of spruce: a main twig, side shoots, dense short needles.
  const shoot = (x0: number, y0: number, ang: number, len: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    g.strokeStyle = "rgb(80,60,40)";
    g.lineWidth = depth === 0 ? 2.5 : 1.4;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    const steps = Math.floor(len / 1.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const nl = (13 - depth * 3) * (1 - t * 0.45);
      for (const side of [-1, 1]) {
        const na = ang + side * (0.9 + rng() * 0.4);
        const lig = 16 + rng() * 16;
        g.strokeStyle = `hsl(${120 + rng() * 25},${35 + rng() * 20}%,${lig}%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        g.stroke();
      }
    }
    if (depth < 1) {
      for (let i = 1; i < 9; i++) {
        const t = i / 9;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) shoot(px, py, ang + side * (0.75 + rng() * 0.3), len * 0.5 * (1 - t * 0.55), depth + 1);
      }
    }
  };
  g.lineCap = "round";
  shoot(size * 0.08, size * 0.5, 0, size * 0.86, 0);
}

/** Grass blades on a transparent card, rooted along the bottom edge. */
export function grassCard(): THREE.Texture {
  return once("grass-card", () => {
    const w = 256, h = 128;
    const rng = makeRng(5);
    const { c, g } = canvas(w, h);
    g.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = 10 + rng() * (w - 20);
      const height = h * (0.45 + rng() * 0.53);
      const lean = (rng() - 0.5) * 60;
      const hue = 70 + rng() * 25, sat = 35 + rng() * 25;
      const grad = g.createLinearGradient(0, h, 0, h - height);
      grad.addColorStop(0, `hsl(${hue},${sat}%,14%)`);
      grad.addColorStop(0.5, `hsl(${hue},${sat}%,${28 + rng() * 10}%)`);
      grad.addColorStop(1, `hsl(${hue - 15 * rng()},${sat - 10}%,${46 + rng() * 14}%)`);
      g.strokeStyle = grad;
      const base = 3 + rng() * 2.5;
      // A tapering blade drawn as a few strokes of decreasing width.
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4;
        g.lineWidth = base * (1 - t0 * 0.85);
        g.beginPath();
        g.moveTo(x + lean * t0 * t0, h - height * t0);
        g.lineTo(x + lean * t1 * t1, h - height * t1);
        g.stroke();
      }
    }
    return colourTexture(c, false);
  });
}

/** One fern frond: a curving stem with paired leaflets shrinking toward the tip. */
export function fernCard(): THREE.Texture {
  return once("fern-card", () => {
    const w = 128, h = 256;
    const rng = makeRng(8);
    const { c, g } = canvas(w, h);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push([w / 2 + Math.sin(t * 2.2) * 10, h - 6 - t * (h - 16)]);
    }
    g.strokeStyle = "rgb(70,80,30)";
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    for (let i = 3; i < 30; i++) {
      const [x, y] = pts[i]!;
      const t = i / 30;
      const len = (w * 0.42) * Math.sin(Math.min(1, t * 1.3) * Math.PI) * (1 - t * 0.3);
      for (const side of [-1, 1]) {
        g.fillStyle = `hsl(${88 + rng() * 14},${45 + rng() * 15}%,${22 + rng() * 12}%)`;
        g.save();
        g.translate(x, y);
        // Mirror for the left side, then sweep each leaflet slightly toward the tip.
        g.scale(side, 1);
        g.rotate(-(0.55 - t * 0.35));
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(len * 0.5, -5, len, -2);
        g.quadraticCurveTo(len * 0.5, 4, 0, 3);
        g.fill();
        g.restore();
      }
    }
    return colourTexture(c, false);
  });
}

/** Short fur, streaked along the body, to multiply over an animal's own colours. */
export function fur(): THREE.Texture {
  return once("fur", () => {
    const size = 128;
    const n = makeNoise2(61);
    const { c, g } = canvas(size, size);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = tiled(n, x, y, size, size, 0.25, 3, 0.15) * 0.5 + 0.5;
        const l = 180 + v * 75;
        const i = (y * size + x) * 4;
        img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return colourTexture(c);
  });
}

/** Woven wool and leather grain, to multiply over clothing colours. */
export function cloth(kind: "wool" | "leather"): THREE.Texture {
  return once(`cloth-${kind}`, () => {
    const size = 128;
    const n = makeNoise2(kind === "wool" ? 71 : 72);
    const { c, g } = canvas(size, size);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v: number;
        if (kind === "wool") {
          const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
          v = 0.8 + weave * 0.08 + tiled(n, x, y, size, size, 0.08, 3) * 0.1;
        } else {
          v = 0.82 + tiled(n, x, y, size, size, 0.12, 4) * 0.16;
        }
        const l = Math.min(255, v * 255);
        const i = (y * size + x) * 4;
        img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return colourTexture(c);
  });
}

export function rockMaps(): { map: THREE.Texture; normalMap: THREE.Texture } {
  return photoPair("mossy_rock", 2, 1);
}
