import * as THREE from "three";
import { fbm, makeNoise2 } from "../core/simplex";
import { clamp } from "../core/math";
import { photo } from "./photo";

/** The wood is a square this many metres on a side, centred on the origin. */
export const WORLD_SIZE = 600;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Where the hunt is allowed to go; beyond this the hills rise too steep to climb. */
export const PLAY_HALF = 255;
/** Ponds fill the hollows below this height. */
export const WATER_LEVEL = -6.5;

const CELL = 2;
const SEGMENTS = WORLD_SIZE / CELL;

/**
 * The ground: a height grid that is both the rendered mesh and the thing
 * everyone walks on. Sampling matches the mesh's own triangles exactly, so
 * feet sit on the surface rather than hovering over it or sinking in.
 */
export class Terrain {
  readonly heights: Float32Array;
  readonly mesh: THREE.Mesh;
  private readonly litter: (x: number, z: number) => number;
  private readonly canopy: (x: number, z: number) => number;

  constructor(seed: number) {
    const hills = makeNoise2(seed);
    const detail = makeNoise2(seed + 1);
    const floor = makeNoise2(seed + 2);
    this.litter = (x, z) => fbm(floor, x / 30, z / 30, 3);
    this.canopy = canopyDensity(seed);

    const n = SEGMENTS + 1;
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -WORLD_HALF + ix * CELL;
        const z = -WORLD_HALF + iz * CELL;
        this.heights[iz * n + ix] = shapeHeight(x, z, hills, detail);
      }
    }
    this.mesh = this.buildMesh();
  }

  /** Ground height at any point, off the same triangles the mesh draws. */
  heightAt(x: number, z: number): number {
    const n = SEGMENTS + 1;
    const gx = clamp((x + WORLD_HALF) / CELL, 0, SEGMENTS - 1e-6);
    const gz = clamp((z + WORLD_HALF) / CELL, 0, SEGMENTS - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const v = gz - iz;
    const h = this.heights;
    const a = h[iz * n + ix]!;
    const b = h[(iz + 1) * n + ix]!;
    const c = h[(iz + 1) * n + ix + 1]!;
    const d = h[iz * n + ix + 1]!;
    if (u + v <= 1) return a + (d - a) * u + (b - a) * v;
    return c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  /** Steepness at a point: 0 flat, 1 at 45°. */
  slopeAt(x: number, z: number): number {
    const e = 1;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  isWater(x: number, z: number, margin = 0): boolean {
    return this.heightAt(x, z) < WATER_LEVEL + margin;
  }

  private buildMesh(): THREE.Mesh {
    const n = SEGMENTS + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const splat = new Float32Array(n * n * 4);

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = -WORLD_HALF + ix * CELL;
        const z = -WORLD_HALF + iz * CELL;
        const y = this.heights[i]!;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Leaf litter under the canopy, grass in the open, earth on slopes, rock on crags.
        const shade = clamp(0.45 + this.canopy(x, z) * 1.6 + this.litter(x, z) * 0.6, 0, 1);
        const slope = this.slopeAt(x, z);
        const rock = clamp((slope - 0.75) * 2.5, 0, 1);
        const wet = clamp((WATER_LEVEL + 1.4 - y) / 1.4, 0, 1);
        const dirt = Math.max(clamp((slope - 0.35) * 2.5, 0, 1) * (1 - rock), wet);
        const rest = 1 - rock - dirt * (1 - rock);
        splat[i * 4] = rest * (1 - shade);
        splat[i * 4 + 1] = rest * shade;
        splat[i * 4 + 2] = dirt * (1 - rock);
        splat[i * 4 + 3] = rock;

        // Darker where the ground is wet, and a little grain so it never looks painted.
        const grain = 0.9 + 0.2 * (((ix * 73856093) ^ (iz * 19349663)) & 255) / 255;
        const damp = 1 - wet * 0.45;
        colors[i * 3] = grain * damp;
        colors[i * 3 + 1] = grain * damp;
        colors[i * 3 + 2] = grain * damp;
      }
    }

    const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
    let k = 0;
    for (let iz = 0; iz < SEGMENTS; iz++) {
      for (let ix = 0; ix < SEGMENTS; ix++) {
        const a = iz * n + ix;
        const b = (iz + 1) * n + ix;
        const cc = (iz + 1) * n + ix + 1;
        const d = iz * n + ix + 1;
        indices[k++] = a; indices[k++] = b; indices[k++] = d;
        indices[k++] = b; indices[k++] = cc; indices[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("splat", new THREE.BufferAttribute(splat, 4));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, groundMaterial());
    mesh.receiveShadow = true;
    mesh.name = "terrain";
    return mesh;
  }
}

/**
 * Four ground textures blended by per-vertex weights, each sampled at two
 * scales and mixed so the repeat never shows.
 */
function groundMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // Loaded here, on first draw, so the terrain can be built without a browser (in tests).
    const tex = {
      tGrass: photo("leafy_grass", "diff"), tLitter: photo("forest_leaves_04", "diff"),
      tDirt: photo("forest_ground_04", "diff"), tRock: photo("mossy_rock", "diff"),
      nGrass: photo("leafy_grass", "nor_gl"), nLitter: photo("forest_leaves_04", "nor_gl"),
      nDirt: photo("forest_ground_04", "nor_gl"), nRock: photo("mossy_rock", "nor_gl"),
    };
    for (const [k, t] of Object.entries(tex)) shader.uniforms[k] = { value: t };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vGround;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vSplat = splat;
vGround = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D tGrass;
uniform sampler2D tLitter;
uniform sampler2D tDirt;
uniform sampler2D tRock;
uniform sampler2D nGrass;
uniform sampler2D nLitter;
uniform sampler2D nDirt;
uniform sampler2D nRock;
varying vec4 vSplat;
varying vec3 vGround;
vec3 twoScale(sampler2D t, vec2 p) { return mix(texture2D(t, p * 0.4).rgb, texture2D(t, p * 0.083 + 0.37).rgb, 0.35); }
vec3 nrm(sampler2D t, vec2 p) { return texture2D(t, p * 0.4).xyz * 2.0 - 1.0; }`,
      )
      .replace(
        "#include <map_fragment>",
        `{
          vec2 p = vGround.xz;
          vec4 w = vSplat / max(dot(vSplat, vec4(1.0)), 0.001);
          vec3 g = twoScale(tGrass, p) * w.x + twoScale(tLitter, p) * w.y + twoScale(tDirt, p) * w.z + twoScale(tRock, p * 0.6) * w.w;
          diffuseColor.rgb *= g;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Ground UVs run along world X and Z, so the tangent frame is world X and Z too.
          vec2 p = vGround.xz;
          vec4 w = vSplat / max(dot(vSplat, vec4(1.0)), 0.001);
          vec3 n = nrm(nGrass, p) * w.x + nrm(nLitter, p) * w.y + nrm(nDirt, p) * w.z + nrm(nRock, p * 0.6) * w.w;
          n.xy *= 1.2;
          vec3 T = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          T = normalize(T - normal * dot(normal, T));
          vec3 B = cross(T, normal);
          normal = normalize(T * n.x + B * n.y + normal * n.z);
        }`,
      );
  };
  return mat;
}

/** How thick the canopy is at a point: negative in clearings, positive in thickets. Shared with the scatter. */
export function canopyDensity(seed: number): (x: number, z: number) => number {
  const density = makeNoise2(seed + 10);
  return (x, z) => fbm(density, x / 90, z / 90, 3);
}

/** Rolling woodland hills, a few hollows for ponds, and steep ground around the edge. */
export function shapeHeight(x: number, z: number, hills: (x: number, y: number) => number, detail: (x: number, y: number) => number): number {
  const raw = (px: number, pz: number) => 13 * fbm(hills, px / 200, pz / 200, 4) + 2.5 * fbm(detail, px / 45, pz / 45, 3);
  let h = raw(x, z);
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rise = clamp((edge - PLAY_HALF + 25) / 60, 0, 1);
  h += rise * rise * 38;
  // The camp sits on a level clearing that eases back into the hills.
  const camp = Math.max(raw(0, 0), WATER_LEVEL + 3);
  const t = clamp((34 - Math.hypot(x, z)) / 22, 0, 1);
  const level = t * t * (3 - 2 * t);
  return h + (camp - h) * level;
}

export function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f3230,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.86,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = "water";
  return mesh;
}
