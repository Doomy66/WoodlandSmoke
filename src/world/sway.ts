import * as THREE from "three";

/** Shared by every swaying material, updated once a frame. */
export const swayUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) },
};

/**
 * Make a material bend with the wind. The bend grows with height above the
 * mesh's own base, so trunks stand still while leaves and grass tips move.
 * It is applied after instancing, in world space, so every instance leans
 * the same way whatever its own rotation.
 *
 * `foliage` also stops the back of a leaf card being lit as if it faced away
 * from the sun: a canopy should glow through, not go black.
 */
export function addSway(material: THREE.Material, stiffness: number, heightScale: number, foliage = false): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swayUniforms.uTime;
    shader.uniforms.uWind = swayUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec2 uWind;")
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  {
    float h = max(transformed.y, 0.0) / ${heightScale.toFixed(3)};
    float phase = mvPosition.x * 0.13 + mvPosition.z * 0.11;
    float gust = 0.6 + 0.4 * sin(uTime * 0.7 + phase * 0.3);
    float flutter = sin(uTime * 2.3 + phase + transformed.x * 2.0) * 0.35 + sin(uTime * 4.1 + phase * 1.7 + transformed.z * 3.0) * 0.15;
    vec2 bend = uWind * (${stiffness.toFixed(4)}) * h * h * (gust + flutter);
    mvPosition.xz += bend;
    mvPosition.y -= dot(bend, bend) * 0.15;
  }
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
    if (foliage) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;", "float faceDirection = 1.0;"),
      );
    }
  };
  material.customProgramCacheKey = () => `sway-${stiffness}-${heightScale}-${foliage}`;
  return material;
}

/** Foliage shadows follow the leaf shapes, not the cards they are painted on. */
export function leafDepth(map: THREE.Texture, alphaTest: number): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
}
