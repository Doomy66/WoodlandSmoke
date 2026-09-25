import * as THREE from "three";

/**
 * Photographed textures from Poly Haven (polyhaven.com, CC0), served from
 * public/textures. Each set is a colour map and an OpenGL-style normal map.
 */
export type PhotoSet =
  | "leafy_grass"
  | "forest_leaves_04"
  | "forest_ground_04"
  | "mossy_rock"
  | "jolcham_oak_bark_01"
  | "pine_bark";

const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const cache = new Map<string, THREE.Texture>();
let pending = 0;
let settle: (() => void) | null = null;

/** Resolves once every photo asked for so far has arrived (or failed). */
export const photosReady = new Promise<void>((resolve) => { settle = resolve; });
manager.onLoad = () => { if (pending > 0) settle?.(); };
manager.onError = (url) => console.warn(`texture failed to load: ${url}`);

export function photo(set: PhotoSet, map: "diff" | "nor_gl"): THREE.Texture {
  const key = `${set}_${map}`;
  let t = cache.get(key);
  if (!t) {
    pending++;
    t = loader.load(`${import.meta.env.BASE_URL}textures/${set}_${map}_1k.jpg`);
    t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    cache.set(key, t);
  }
  return t;
}

/** Colour and normal map together, sharing one repeat. */
export function photoPair(set: PhotoSet, repeatX = 1, repeatY = 1): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = photo(set, "diff");
  const normalMap = photo(set, "nor_gl");
  map.repeat.set(repeatX, repeatY);
  normalMap.repeat.set(repeatX, repeatY);
  return { map, normalMap };
}

const ALL: PhotoSet[] = ["leafy_grass", "forest_leaves_04", "forest_ground_04", "mossy_rock", "jolcham_oak_bark_01", "pine_bark"];

/** Ask for every photo up front, so the hunt starts with the wood fully dressed. */
export function preloadPhotos(): void {
  for (const set of ALL) {
    photo(set, "diff");
    photo(set, "nor_gl");
  }
}
