import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Triangle,
  Vector3,
} from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

import type { TDistributionMethod, TSurfaceDepthBias } from '../types';

/** Shared cap between sampling, GPU instancing, and sidebar controls. */
export const PARTICLE_CAPACITY = 65_536;

export interface ISurfaceSamples {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _n = new Vector3();
const _tri = new Triangle();
const _pos = new Vector3();
const _norm = new Vector3();

/** Center geometry around origin using its bounding box. */
export function centerBufferGeometry(geometry: BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    return;
  }
  const center = box.getCenter(new Vector3()).negate();
  geometry.translate(center.x, center.y, center.z);
}

/** Sample oriented points on triangle mesh surface. */
export function sampleMeshSurface(
  geometry: BufferGeometry,
  count: number,
  distribution: TDistributionMethod,
): ISurfaceSamples {
  const capped = Math.max(1, Math.min(count, PARTICLE_CAPACITY));
  const geo = geometry.clone();
  geo.computeVertexNormals();

  const positions = new Float32Array(capped * 3);
  const normals = new Float32Array(capped * 3);

  if (distribution === 'areaWeighted') {
    const mesh = new Mesh(geo);
    const sampler = new MeshSurfaceSampler(mesh).build();

    for (let i = 0; i < capped; i += 1) {
      sampler.sample(_pos, _norm);
      const o = i * 3;
      positions[o] = _pos.x;
      positions[o + 1] = _pos.y;
      positions[o + 2] = _pos.z;
      normals[o] = _norm.x;
      normals[o + 1] = _norm.y;
      normals[o + 2] = _norm.z;
    }

    mesh.geometry.dispose();
    return { positions, normals };
  }

  const triGeo =
    geo.index !== null ? (() => {
      const next = geo.toNonIndexed();
      geo.dispose();
      return next;
    })() : geo;
  triGeo.computeVertexNormals();

  const posAttr = triGeo.getAttribute('position');

  let norAttr = triGeo.getAttribute('normal');
  if (!norAttr) {
    triGeo.computeVertexNormals();
    norAttr = triGeo.getAttribute('normal');
    if (!(norAttr instanceof Float32BufferAttribute)) {
      triGeo.dispose();
      throw new Error('Failed to compute vertex normals.');
    }
  }

  const triVerts = posAttr.count;
  if (triVerts === 0 || triVerts % 3 !== 0) {
    triGeo.dispose();
    throw new Error('Geometry has no triangular faces.');
  }

  const norArray = norAttr.array as Float32Array;
  const triCount = triVerts / 3;

  for (let i = 0; i < capped; i += 1) {
    const index = Math.floor(Math.random() * triCount);

    _tri.a.fromBufferAttribute(posAttr, index * 3);
    _tri.b.fromBufferAttribute(posAttr, index * 3 + 1);
    _tri.c.fromBufferAttribute(posAttr, index * 3 + 2);

    const r1 = Math.random();
    const r2 = Math.random();
    const sr = Math.sqrt(r1);
    const u = 1 - sr;
    const v = sr * (1 - r2);
    const w = sr * r2;

    _vA.copy(_tri.a).multiplyScalar(u);
    _vB.copy(_tri.b).multiplyScalar(v);
    _vC.copy(_tri.c).multiplyScalar(w);
    _pos.copy(_vA).add(_vB).add(_vC);

    _vA.copy(_tri.a);
    _vB.copy(_tri.b);
    _vC.copy(_tri.c);

    Triangle.getNormal(_vA, _vB, _vC, _n);

    const oFlat = index * 9;
    const nx =
      norArray[oFlat + 0] * u +
      norArray[oFlat + 3] * v +
      norArray[oFlat + 6] * w;
    const ny =
      norArray[oFlat + 1] * u +
      norArray[oFlat + 4] * v +
      norArray[oFlat + 7] * w;
    const nz =
      norArray[oFlat + 2] * u +
      norArray[oFlat + 5] * v +
      norArray[oFlat + 8] * w;

    _norm.set(nx, ny, nz);
    const lenSq = _norm.lengthSq();
    if (lenSq > 1e-10) {
      _norm.multiplyScalar(1 / Math.sqrt(lenSq));
    } else {
      _norm.copy(_n).normalize();
    }

    const o = i * 3;
    positions[o] = _pos.x;
    positions[o + 1] = _pos.y;
    positions[o + 2] = _pos.z;
    normals[o] = _norm.x;
    normals[o + 1] = _norm.y;
    normals[o + 2] = _norm.z;
  }

  triGeo.dispose();

  return { positions, normals };
}

/** Default sampling-friendly box mesh. */
export function createDefaultBoxGeometry(size = 1.25): BufferGeometry {
  const g = new BoxGeometry(size, size, size, 3, 3, 3);
  centerBufferGeometry(g);
  return g;
}

/**
 * Samples the mesh surface with per-face weighting based on a surface depth bias.
 *
 * - `uniform` – falls back to area-weighted sampling (same as the default MeshSurfaceSampler)
 * - `crease`  – biases toward faces whose normals diverge most from the mesh's average normal,
 *               approximating silhouette edges and high-curvature crease regions
 * - `shadow`  – biases toward back-facing surfaces (faces whose normal points away from the
 *               upward direction (0,1,0)), simulating a top-down light shadow
 */
export function sampleMeshSurfaceBiased(
  geometry: BufferGeometry,
  count: number,
  bias: TSurfaceDepthBias,
): ISurfaceSamples {
  const capped = Math.max(1, Math.min(count, PARTICLE_CAPACITY));

  if (bias === 'uniform') {
    return sampleMeshSurface(geometry, capped, 'areaWeighted');
  }

  const positions = new Float32Array(capped * 3);
  const normals = new Float32Array(capped * 3);

  const geo = geometry.clone();
  geo.computeVertexNormals();
  const triGeo = geo.index !== null ? geo.toNonIndexed() : geo;
  triGeo.computeVertexNormals();

  const posAttr = triGeo.getAttribute('position');
  const norAttr = triGeo.getAttribute('normal');
  const triCount = posAttr.count / 3;

  if (triCount === 0) {
    triGeo.dispose();
    return { positions, normals };
  }

  // Compute per-face area and face normal
  const faceAreas = new Float32Array(triCount);
  const faceNormals = new Float32Array(triCount * 3);

  for (let f = 0; f < triCount; f++) {
    const base = f * 3;
    _tri.a.fromBufferAttribute(posAttr, base);
    _tri.b.fromBufferAttribute(posAttr, base + 1);
    _tri.c.fromBufferAttribute(posAttr, base + 2);
    Triangle.getNormal(_tri.a, _tri.b, _tri.c, _n);
    faceNormals[f * 3] = _n.x;
    faceNormals[f * 3 + 1] = _n.y;
    faceNormals[f * 3 + 2] = _n.z;
    faceAreas[f] = _tri.getArea();
  }

  // Compute bias weights per face
  const weights = new Float32Array(triCount);

  if (bias === 'shadow') {
    // Back-facing to a top-down light: weight = area * max(0, -normalY)
    for (let f = 0; f < triCount; f++) {
      const shadowFactor = Math.max(0, -faceNormals[f * 3 + 1]);
      weights[f] = faceAreas[f] * (0.1 + shadowFactor * 3.0);
    }
  } else {
    // crease: weight by deviation from the area-weighted average normal
    // Faces whose normals point away from the average are near silhouettes/creases
    let avgNx = 0, avgNy = 0, avgNz = 0;
    for (let f = 0; f < triCount; f++) {
      avgNx += faceNormals[f * 3] * faceAreas[f];
      avgNy += faceNormals[f * 3 + 1] * faceAreas[f];
      avgNz += faceNormals[f * 3 + 2] * faceAreas[f];
    }
    const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz);
    if (avgLen > 1e-8) { avgNx /= avgLen; avgNy /= avgLen; avgNz /= avgLen; }

    for (let f = 0; f < triCount; f++) {
      const dot =
        faceNormals[f * 3] * avgNx +
        faceNormals[f * 3 + 1] * avgNy +
        faceNormals[f * 3 + 2] * avgNz;
      const creaseFactor = 1 - Math.abs(dot); // 0 = aligned with average, 1 = perpendicular
      weights[f] = faceAreas[f] * (0.1 + creaseFactor * 3.0);
    }
  }

  // Build CDF for weighted sampling
  let weightSum = 0;
  const cdf = new Float32Array(triCount + 1);
  cdf[0] = 0;
  for (let f = 0; f < triCount; f++) {
    weightSum += weights[f];
    cdf[f + 1] = weightSum;
  }

  const norArr = norAttr ? (norAttr.array as Float32Array) : null;

  for (let i = 0; i < capped; i++) {
    // Binary search the CDF to pick a face
    const r = Math.random() * weightSum;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid + 1] < r) lo = mid + 1;
      else hi = mid;
    }
    const f = lo;
    const base = f * 3;

    _tri.a.fromBufferAttribute(posAttr, base);
    _tri.b.fromBufferAttribute(posAttr, base + 1);
    _tri.c.fromBufferAttribute(posAttr, base + 2);

    // Random barycentric coordinates
    const r1 = Math.random();
    const r2 = Math.random();
    const sr = Math.sqrt(r1);
    const u = 1 - sr;
    const v = sr * (1 - r2);
    const w = sr * r2;

    const px = _tri.a.x * u + _tri.b.x * v + _tri.c.x * w;
    const py = _tri.a.y * u + _tri.b.y * v + _tri.c.y * w;
    const pz = _tri.a.z * u + _tri.b.z * v + _tri.c.z * w;

    // Interpolate vertex normals if available, else use face normal
    let nx: number, ny: number, nz: number;
    if (norArr) {
      const nb = f * 9;
      nx = norArr[nb] * u + norArr[nb + 3] * v + norArr[nb + 6] * w;
      ny = norArr[nb + 1] * u + norArr[nb + 4] * v + norArr[nb + 7] * w;
      nz = norArr[nb + 2] * u + norArr[nb + 5] * v + norArr[nb + 8] * w;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 1e-8) { nx /= nl; ny /= nl; nz /= nl; }
      else { nx = faceNormals[f * 3]; ny = faceNormals[f * 3 + 1]; nz = faceNormals[f * 3 + 2]; }
    } else {
      nx = faceNormals[f * 3];
      ny = faceNormals[f * 3 + 1];
      nz = faceNormals[f * 3 + 2];
    }

    const o = i * 3;
    positions[o] = px;     positions[o + 1] = py;     positions[o + 2] = pz;
    normals[o]   = nx;     normals[o + 1]   = ny;     normals[o + 2]   = nz;
  }

  triGeo.dispose();
  return { positions, normals };
}
