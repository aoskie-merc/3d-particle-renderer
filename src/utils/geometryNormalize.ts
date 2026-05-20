import { BufferGeometry } from 'three';


export const CANONICAL_MESH_RADIUS = 0.9;

/**
 * STL/OBJ files often arrive in wildly different scene units (mm vs metres).
 * Normalising the bounding‑sphere radius keeps the orbit camera/particle sizing stable.
 */
export function normalizeBoundingRadius(geom: BufferGeometry): void {
  geom.computeBoundingSphere();

  const sphere = geom.boundingSphere;
  const radius =
    sphere && Number.isFinite(sphere.radius)
      ? Math.max(Number(sphere.radius), Number.EPSILON)
      : 0;

  if (!radius || !Number.isFinite(radius)) {
    throw new Error('Geometry lacks a usable bounding sphere for normalization.');
  }

  const uniform = CANONICAL_MESH_RADIUS / radius;

  if (uniform !== 1 && Number.isFinite(uniform)) {
    geom.scale(uniform, uniform, uniform);
  }

  geom.computeBoundingSphere();

  /* Guard against collapsing geometry — STLs with bogus vertices. */
  if (!geom.boundingSphere?.radius || geom.boundingSphere.radius < CANONICAL_MESH_RADIUS / 2048) {
    throw new Error('Geometry collapses after normalization — check STL/OBJ triangles.');
  }
}
