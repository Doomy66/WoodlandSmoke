import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Fold the meshes under each joint into one mesh per material. A deer built
 * from forty shapes becomes a dozen draw calls, one or two per moving part,
 * and still bends at every joint. Meshes marked `userData.keep` are left
 * alone, for parts that move on their own.
 */
export function mergeStatic(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.children.length > 1) groups.push(o); });
  for (const g of groups) {
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of g.children) {
      if (!(c instanceof THREE.Mesh) || c.children.length > 0 || c.userData.keep || Array.isArray(c.material)) continue;
      const list = byMaterial.get(c.material as THREE.Material) ?? [];
      list.push(c);
      byMaterial.set(c.material as THREE.Material, list);
    }
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const geo = m.geometry.clone().applyMatrix4(m.matrix);
        return geo.index ? geo.toNonIndexed() : geo;
      });
      // Only attributes every part has can be merged.
      const shared = Object.keys(geos[0]!.attributes).filter((name) => geos.every((geo) => geo.getAttribute(name)));
      for (const geo of geos) for (const name of Object.keys(geo.attributes)) if (!shared.includes(name)) geo.deleteAttribute(name);
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      for (const m of meshes) g.remove(m);
      g.add(mesh);
    }
  }
}
