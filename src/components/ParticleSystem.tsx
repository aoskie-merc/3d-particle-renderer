import { useFrame } from "@react-three/fiber";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { BufferGeometry, InstancedMesh } from "three";
import {
  AdditiveBlending,
  DynamicDrawUsage,
  MeshBasicMaterial,
  MultiplyBlending,
  NormalBlending,
  SphereGeometry,
} from "three";

import type { TBlendModeKey, TDistributionMethod } from "../types";
import type { IBoidParams } from "../sim/boidParams";
import { BOID_DEFAULTS } from "../sim/boidParams";
import type { IBoidParticle } from "../sim/boids3d";
import { createBoidParticles, stepBoids } from "../sim/boids3d";
import { PARTICLE_CAPACITY, sampleMeshSurface } from "../utils/surfaceSampler";

export interface IParticleSystemProps {
  geometry: BufferGeometry;
  particleCount: number;
  distribution: TDistributionMethod;
  surfaceNormalOffset: number;
  particleSize: number;
  color: string;
  opacity: number;
  blendMode: TBlendModeKey;
  boidVisualRange: number;
  boidSeparation: number;
  boidAlignment: number;
  boidCohesion: number;
  boidHomeSpring: number;
  boidSpeedLimit: number;
  boidNoise: number;
  swarmOrbitSpeed: number;
  swarmOrbitRadius: number;
  swarmSplitIntensity: number;
  swarmSplitSpeed: number;
  /** External pulse timestamp — triggers an extra split burst (e.g. verification check complete) */
  pulseTimestamp?: number;
  /** When set, overrides the Lissajous attractor with a fixed position (used by sweep triggers). */
  attractorOverride?: { x: number; y: number; z: number } | null;
  /** Multiplier for attractorFactor when attractorOverride is active. Defaults to 6. */
  attractorBoost?: number;
  /** When timestamp changes, teleport all boids to the given position with random scatter. */
  teleportSignal?: {
    x: number;
    y: number;
    z: number;
    timestamp: number;
  } | null;
}

const blendingForMode = (mode: TBlendModeKey) => {
  switch (mode) {
    case "additive":
      return AdditiveBlending;
    case "multiply":
      return MultiplyBlending;
    case "normal":
    default:
      return NormalBlending;
  }
};

export default function ParticleSystem(props: IParticleSystemProps) {
  const {
    blendMode,
    boidAlignment,
    boidCohesion,
    boidHomeSpring,
    boidNoise,
    boidSeparation,
    boidSpeedLimit,
    boidVisualRange,
    color,
    distribution,
    geometry,
    opacity,
    particleCount,
    particleSize,
    surfaceNormalOffset,
    swarmOrbitSpeed,
    swarmOrbitRadius,
    swarmSplitIntensity,
    swarmSplitSpeed,
  } = props;

  const {
    attractorOverride = null,
    attractorBoost = 6,
    pulseTimestamp = 0,
    teleportSignal = null,
  } = props;

  const meshRef = useRef<InstancedMesh>(null);
  const boidsRef = useRef<IBoidParticle[]>([]);
  const sizeRef = useRef(particleSize);
  sizeRef.current = particleSize;

  const pulseIntensityRef = useRef(0);
  const lastPulseRef = useRef(0);
  if (pulseTimestamp !== lastPulseRef.current && pulseTimestamp > 0) {
    pulseIntensityRef.current = 1;
    lastPulseRef.current = pulseTimestamp;
  }

  const samples = useMemo(
    () => sampleMeshSurface(geometry, particleCount, distribution),
    [distribution, geometry, particleCount],
  );

  const count = samples.positions.length / 3;

  useEffect(() => {
    boidsRef.current = createBoidParticles(
      samples.positions,
      samples.normals,
      count,
      surfaceNormalOffset,
    );
  }, [samples, count, surfaceNormalOffset]);

  const lastTeleportRef = useRef(0);
  useEffect(() => {
    if (!teleportSignal || teleportSignal.timestamp === lastTeleportRef.current)
      return;
    lastTeleportRef.current = teleportSignal.timestamp;
    const boids = boidsRef.current;
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      const scatter = 1.5;
      b.x = teleportSignal.x + (Math.random() - 0.5) * scatter;
      b.y = teleportSignal.y + (Math.random() - 0.5) * scatter;
      b.z = teleportSignal.z + (Math.random() - 0.5) * scatter;
      const swirlSpeed = 0.008;
      b.vx = (Math.random() - 0.5) * swirlSpeed;
      b.vy = (Math.random() - 0.5) * swirlSpeed;
      b.vz = (Math.random() - 0.5) * swirlSpeed;
    }
  }, [teleportSignal]);

  const boidParamsRef = useRef<IBoidParams>({ ...BOID_DEFAULTS });

  useEffect(() => {
    boidParamsRef.current = {
      visualRange: boidVisualRange,
      separationDist: boidVisualRange * 0.21,
      separationFactor: boidSeparation,
      alignmentFactor: boidAlignment,
      cohesionFactor: boidCohesion,
      attractorFactor: attractorOverride
        ? BOID_DEFAULTS.attractorFactor * attractorBoost
        : BOID_DEFAULTS.attractorFactor,
      homeSpringFactor: attractorOverride ? 0 : boidHomeSpring,
      maxHomeDistance: BOID_DEFAULTS.maxHomeDistance,
      speedLimit: boidSpeedLimit,
      minSpeed: boidSpeedLimit * 0.32,
      noiseMagnitude: boidNoise,
      orbitSpeed: swarmOrbitSpeed,
      orbitRadius: swarmOrbitRadius,
      splitIntensity: swarmSplitIntensity,
      splitSpeed: swarmSplitSpeed,
      splitDecay: BOID_DEFAULTS.splitDecay,
      steeringInertia: BOID_DEFAULTS.steeringInertia,
      velocityStretchFactor: BOID_DEFAULTS.velocityStretchFactor,
      attractorOverride,
    };
  }, [
    attractorBoost,
    attractorOverride,
    boidAlignment,
    boidCohesion,
    boidHomeSpring,
    boidNoise,
    boidSeparation,
    boidSpeedLimit,
    boidVisualRange,
    swarmOrbitSpeed,
    swarmOrbitRadius,
    swarmSplitIntensity,
    swarmSplitSpeed,
  ]);

  const baseGeometry = useMemo(() => new SphereGeometry(1, 12, 12), []);

  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: NormalBlending,
        color,
        depthWrite: true,
        opacity: 1,
        toneMapped: false,
        transparent: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
    material.blending = blendingForMode(blendMode);
    material.depthWrite = blendMode === "normal" ? opacity >= 1 : false;
    material.transparent = opacity < 1 || blendMode !== "normal";
    material.needsUpdate = true;
  }, [material, blendMode, color, opacity]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;

    if (!mesh || count <= 0) {
      return;
    }

    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = count;

    const arr = mesh.instanceMatrix.array as Float32Array;
    const boids = boidsRef.current;
    const s = particleSize * 5.0;

    for (let i = 0; i < count; i += 1) {
      const b = boids[i];
      if (!b) continue;
      const off = i * 16;
      arr[off] = s;
      arr[off + 1] = 0;
      arr[off + 2] = 0;
      arr[off + 3] = 0;
      arr[off + 4] = 0;
      arr[off + 5] = s;
      arr[off + 6] = 0;
      arr[off + 7] = 0;
      arr[off + 8] = 0;
      arr[off + 9] = 0;
      arr[off + 10] = s;
      arr[off + 11] = 0;
      arr[off + 12] = b.x;
      arr[off + 13] = b.y;
      arr[off + 14] = b.z;
      arr[off + 15] = 1;
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [count, particleSize, samples]);

  useFrame((state) => {
    const mesh = meshRef.current;
    const boids = boidsRef.current;

    if (!mesh || count <= 0 || boids.length === 0) {
      return;
    }

    // Decay external pulse and temporarily boost split intensity
    const pulse = pulseIntensityRef.current;
    if (pulse > 0.01) {
      pulseIntensityRef.current *= 0.97;
      const params = boidParamsRef.current;
      const boosted = {
        ...params,
        splitIntensity: params.splitIntensity + pulse * 0.5,
      };
      stepBoids(boids, boosted, state.clock.elapsedTime);
    } else {
      stepBoids(boids, boidParamsRef.current, state.clock.elapsedTime);
    }

    const arr = mesh.instanceMatrix.array as Float32Array;
    const s = sizeRef.current * 5.0;

    for (let i = 0; i < count; i += 1) {
      const b = boids[i];
      const off = i * 16;
      arr[off] = s;
      arr[off + 5] = s;
      arr[off + 10] = s;
      arr[off + 12] = b.x;
      arr[off + 13] = b.y;
      arr[off + 14] = b.z;
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      args={[baseGeometry, material, PARTICLE_CAPACITY]}
      frustumCulled={false}
      ref={meshRef}
      renderOrder={10}
    />
  );
}
