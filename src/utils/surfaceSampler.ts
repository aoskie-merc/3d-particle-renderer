import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Triangle,
  Vector3,
} from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

import type { TDistributionMethod } from '../types';

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
