import { BufferGeometry, Mesh } from 'three';
import type { Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import { normalizeBoundingRadius } from './geometryNormalize';
import { centerBufferGeometry } from './surfaceSampler';

export function mergeObjGroup(group: Group): BufferGeometry {
  group.updateWorldMatrix(true, false);
  const pieces: BufferGeometry[] = [];

  group.traverse((child) => {
    if (child instanceof Mesh) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      pieces.push(geo);
    }
  });

  const merged = mergeGeometries(pieces);

  for (const geo of pieces) {
    geo.dispose();
  }

  if (!merged) {
    throw new Error('OBJ file contains no mesh geometry.');
  }

  merged.computeVertexNormals();
  return merged;
}

/**
 * Parses STL/OBJ bytes and returns centered mesh geometry suitable for sampling.
 */
export async function ingestMeshFile(file: File): Promise<BufferGeometry> {
  const lower = file.name.toLowerCase();

  let geom: BufferGeometry;

  if (lower.endsWith('.stl')) {
    const buf = await file.arrayBuffer();
    geom = new STLLoader().parse(buf);
    geom.computeBoundingBox();
  } else if (lower.endsWith('.obj')) {
    const text = await file.text();
    const group = new OBJLoader().parse(text) as Group;
    geom = mergeObjGroup(group);
  } else {
    throw new Error('Please use a .stl or .obj file.');
  }

  centerBufferGeometry(geom);
  normalizeBoundingRadius(geom);
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Fetches a static STL from a public URL and returns centered geometry.
 */
export async function loadStaticModel(url: string): Promise<BufferGeometry> {
  const response = await fetch(url);
  const buf = await response.arrayBuffer();
  const geom = new STLLoader().parse(buf);
  geom.computeBoundingBox();
  centerBufferGeometry(geom);
  normalizeBoundingRadius(geom);
  geom.computeBoundingSphere();
  return geom;
}
