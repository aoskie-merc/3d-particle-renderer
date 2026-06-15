import { useFrame } from "@react-three/fiber";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  DynamicDrawUsage,
  MeshBasicMaterial,
  NormalBlending,
  SphereGeometry,
} from "three";
import type { InstancedMesh } from "three";

import type { IParticleV2 } from "../sim/particleSimV2";

/** Max instance count — set once at InstancedMesh construction. */
export const PARTICLE_CAPACITY_V2 = 20_000;

export interface IParticleSystemV2Props {
  /** Particle array — identity is stable, contents mutated each frame by SceneV2. */
  particles: IParticleV2[];
  /** Actual number of particles to render (≤ PARTICLE_CAPACITY_V2). */
  count: number;
  particleSize: number;
  color: string;
  opacity: number;
  opacityMultiplier?: number;
}

export default function ParticleSystemV2(props: IParticleSystemV2Props) {
  const {
    particles,
    count,
    particleSize,
    color,
    opacity,
    opacityMultiplier = 1,
  } = props;

  const meshRef = useRef<InstancedMesh>(null);
  const sizeRef = useRef(particleSize);
  sizeRef.current = particleSize;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const opacityMultRef = useRef(opacityMultiplier);
  opacityMultRef.current = opacityMultiplier;

  const sphereGeo = useMemo(() => new SphereGeometry(0.625, 8, 8), []);

  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: NormalBlending,
        color,
        depthWrite: false,
        opacity,
        toneMapped: false,
        transparent: true,
      }),
    // Material is created once; color/opacity updates happen in effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.color.set(color);
    material.needsUpdate = true;
  }, [material, color]);

  useEffect(() => {
    material.opacity = opacity;
    material.needsUpdate = true;
  }, [material, opacity]);

  useEffect(() => {
    return () => {
      material.dispose();
      sphereGeo.dispose();
    };
  }, [material, sphereGeo]);

  // Initialise instanceMatrix layout when particle set changes.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count <= 0) return;

    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = count;

    const arr = mesh.instanceMatrix.array as Float32Array;
    const s = particleSize;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (!p) continue;
      const off = i * 16;
      arr[off] = s;   arr[off + 1] = 0; arr[off + 2] = 0;  arr[off + 3] = 0;
      arr[off + 4] = 0; arr[off + 5] = s; arr[off + 6] = 0;  arr[off + 7] = 0;
      arr[off + 8] = 0; arr[off + 9] = 0; arr[off + 10] = s; arr[off + 11] = 0;
      arr[off + 12] = p.x;
      arr[off + 13] = p.y;
      arr[off + 14] = p.z;
      arr[off + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, particleSize, particles]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || count <= 0 || particles.length === 0) return;

    const arr = mesh.instanceMatrix.array as Float32Array;
    const s = sizeRef.current;

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const off = i * 16;
      const ps = s * p.size;
      arr[off] = ps;
      arr[off + 5] = ps;
      arr[off + 10] = ps;
      arr[off + 12] = p.x;
      arr[off + 13] = p.y;
      arr[off + 14] = p.z;
    }
    mesh.instanceMatrix.needsUpdate = true;

    const effectiveOpacity = opacityRef.current * opacityMultRef.current;
    if (material.opacity !== effectiveOpacity) {
      material.opacity = effectiveOpacity;
      material.transparent = effectiveOpacity < 1;
      material.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[sphereGeo, material, PARTICLE_CAPACITY_V2]}
      frustumCulled={false}
      renderOrder={10}
    />
  );
}
