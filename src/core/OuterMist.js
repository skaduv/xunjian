/**
 * 外域云雾统一遮蔽（与 HardwarePlinth 外围地形的 outerMist 同一距离曲线）
 *
 * 原问题：外围地形在 dOut≈170m 起逐步溶入云雾色，但树木/车辆只吃标准线性 Fog（near≥920m），
 * 于是在白色云雾里浮出一颗颗灰色"幽灵树"。这里把同一条雾化曲线注入到这些材质的片元末端。
 */

const MIST_CHUNK = /* glsl */ `
#ifdef USE_FOG
  {
    vec2 omQ = max( vec2( 0.0 ), abs( vOuterMistWorld.xz ) - vec2( 217.0, 158.0 ) );
    float omDOut = length( omQ ) - 26.0;
    float omMist = smoothstep( 150.0, 380.0, omDOut );
    omMist = max( omMist, smoothstep( 460.0, 620.0, omDOut ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( omMist, 0.0, 1.0 ) );
  }
#endif
`;

function patchMaterial(mat) {
  if (!mat || mat.userData.__outerMist) return;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return;
  mat.userData.__outerMist = true;

  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);

  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') prevCompile(shader, renderer);
    if (shader.vertexShader.includes('vOuterMistWorld')) return;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOuterMistWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 omW = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            omW = instanceMatrix * omW;
          #endif
          vOuterMistWorld = ( modelMatrix * omW ).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOuterMistWorld;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${MIST_CHUNK}`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|outer-mist-v1`;
  mat.needsUpdate = true;
}

export function applyOuterMist(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(patchMaterial);
  });
}
