import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 保留索引缓冲（Indexed Buffer）的静态几何自动合批器
 * - 彻底摒弃 toNonIndexed()（避免顶点暴涨 3 倍并保护 GPU Post-Transform Vertex Cache）
 * - 为非索引几何体补充顺序索引，统一以 Indexed Buffer 合并，同时显存与顶点着色开销减半以上
 */
export function batchStaticMeshes(rootGroup) {
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();

  const buckets = new Map();
  const toRemove = [];

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.userData?.noMerge) return;
    if (Array.isArray(obj.material) || !obj.geometry) return;
    let p = obj.parent;
    while (p && p !== rootGroup) {
      if (p.userData?.noMerge) return;
      p = p.parent;
    }

    const hasUv = Boolean(obj.geometry.attributes.uv);
    const hasColor = Boolean(obj.geometry.attributes.color);
    const key = `${obj.material.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}|${hasUv ? 1 : 0}|${hasColor ? 1 : 0}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        material: obj.material,
        castShadow: obj.castShadow,
        receiveShadow: obj.receiveShadow,
        meshes: [],
      });
    }
    buckets.get(key).meshes.push(obj);
  });

  const relMat = new THREE.Matrix4();
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;

    const prepared = [];
    for (const m of bucket.meshes) {
      const g = m.geometry.clone();
      for (const attrName of Object.keys(g.attributes)) {
        if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv' && attrName !== 'color') {
          g.deleteAttribute(attrName);
        }
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      // 若本身无索引则生成紧凑索引，确保全部以 Indexed 方式合批，不把原本有索引的几何打散膨胀 3 倍
      if (!g.index) {
        const count = g.attributes.position.count;
        const idxArr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) idxArr[i] = i;
        g.setIndex(new THREE.BufferAttribute(idxArr, 1));
      }
      relMat.multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      prepared.push(g);
    }

    if (prepared.length < 2) continue;
    const merged = mergeGeometries(prepared, false);
    prepared.forEach((g) => g.dispose());
    if (!merged) continue;

    const mergedMesh = new THREE.Mesh(merged, bucket.material);
    mergedMesh.name = `Batched_${bucket.material.name || bucket.material.uuid.slice(0, 6)}`;
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    rootGroup.add(mergedMesh);

    for (const m of bucket.meshes) {
      toRemove.push(m);
    }
  }

  for (const m of toRemove) {
    m.parent?.remove(m);
    m.geometry?.dispose();
  }
}
