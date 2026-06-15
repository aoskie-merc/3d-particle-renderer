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
  swarmSwirlStrength: number;
  swarmSplitIntensity: number;
  swarmSplitSpeed: number;
  /** External pulse timestamp — triggers an extra split burst (e.g. verification check complete) */
  pulseTimestamp?: number;
  /** When set, overrides the Lissajous attractor with a fixed position (used by sweep triggers). */
  attractorOverride?: { x: number; y: number; z: number } | null;
  /** Multiplier for attractorFactor when attractorOverride is active. Defaults to 6. */
  attractorBoost?: number;
  /** When set, overrides homeSpringFactor (used to snap particles to surface after enter). */
  homeSpringOverride?: number;
  /** When timestamp changes, teleport all boids to the given position with random scatter. */
  teleportSignal?: {
    x: number;
    y: number;
    z: number;
    timestamp: number;
    scatterX?: number;
    scatterY?: number;
    nearFraction?: number;
    nearZMin?: number;
    nearZMax?: number;
    farZMin?: number;
    farZMax?: number;
  } | null;
  /** When value changes, zero all boid velocities (used after enter animation ends). */
  resetVelocitiesSignal?: number;
  /** Called each frame with the averaged centroid position of all boids. */
  onCentroidUpdate?: (pos: { x: number; y: number; z: number }) => void;
  /** Multiplier applied to the boid speed limit (e.g. 0.5 for half-speed). Defaults to 1. */
  speedMultiplier?: number;
  /** Multiplier applied to boidNoise (e.g. 0.35 to reduce jitter in initial state). Defaults to 1. */
  noiseMultiplier?: number;
  /** When set, overrides steeringInertia in the non-animating state (e.g. 0.92 for initial to reduce micro-oscillations). */
  steeringInertiaOverride?: number;
  /** When set, overrides swarmSwirlStrength (e.g. 0.04 for strong orbital motion in orb enter). */
  swirlStrengthOverride?: number;
  /** When > 0, uses a shell attractor pulling particles to this radius from attractorOverride center. */
  shellAttractorRadius?: number;
  /** When set, overrides cohesionFactor (e.g. 0 to disable cohesion during orb enter so it doesn't fight the shell attractor). */
  cohesionOverride?: number;
  /** When set, overrides separationFactor (e.g. 0 to disable separation during orb enter). */
  separationOverride?: number;
  /** When set, overrides alignmentFactor (e.g. 0 to disable alignment during orb enter). */
  alignmentOverride?: number;
  /** Multiplier applied to the final rendered opacity (e.g. 0.5 to dim in formed state). Defaults to 1. */
  opacityMultiplier?: number;
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
    swarmSwirlStrength,
    swarmSplitIntensity,
    swarmSplitSpeed,
  } = props;

  const {
    attractorOverride = null,
    attractorBoost = 6,
    homeSpringOverride,
    pulseTimestamp = 0,
    teleportSignal = null,
    resetVelocitiesSignal,
    onCentroidUpdate,
    speedMultiplier = 1,
    noiseMultiplier,
    steeringInertiaOverride,
    swirlStrengthOverride,
    shellAttractorRadius,
    cohesionOverride,
    separationOverride,
    alignmentOverride,
    opacityMultiplier = 1,
  } = props;

  const meshRef = useRef<InstancedMesh>(null);
  const boidsRef = useRef<IBoidParticle[]>([]);
  const sizeRef = useRef(particleSize);
  sizeRef.current = particleSize;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const opacityMultiplierRef = useRef(opacityMultiplier);
  opacityMultiplierRef.current = opacityMultiplier;

  const shellElapsedRef = useRef(0);
  const prevShellRadiusRef = useRef(0);

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
    const {
      x,
      y,
      z,
      scatterX,
      scatterY,
      nearFraction,
      nearZMin,
      nearZMax,
      farZMin,
      farZMax,
    } = teleportSignal;

    const swirlSpeed = 0.008;
    const boids = boidsRef.current;
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      if (
        nearFraction !== undefined &&
        farZMin !== undefined &&
        farZMax !== undefined &&
        nearZMin !== undefined &&
        nearZMax !== undefined
      ) {
        const sX = scatterX ?? 0.7;
        const sY = scatterY ?? 0.7;
        const isNear = Math.random() < nearFraction;
        const zRange = isNear
          ? nearZMin + Math.random() * (nearZMax - nearZMin)
          : farZMin + Math.random() * (farZMax - farZMin);
        b.x = x + (Math.random() - 0.5) * sX;
        b.y = y + (Math.random() - 0.5) * sY - Math.random() * sY;
        b.z = zRange;
      } else {
        const scatter = 0.7;
        b.x = x + (Math.random() - 0.5) * scatter;
        b.y = y + (Math.random() - 0.5) * scatter;
        b.z = z + (Math.random() - 0.5) * scatter;
      }
      b.vx = (Math.random() - 0.5) * swirlSpeed;
      b.vy = (Math.random() - 0.5) * swirlSpeed;
      b.vz = (Math.random() - 0.5) * swirlSpeed;
    }
  }, [teleportSignal]);

  const lastResetSignalRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      resetVelocitiesSignal === undefined ||
      resetVelocitiesSignal === lastResetSignalRef.current
    )
      return;
    lastResetSignalRef.current = resetVelocitiesSignal;
    const boids = boidsRef.current;
    for (let i = 0; i < boids.length; i++) {
      boids[i].vx = 0;
      boids[i].vy = 0;
      boids[i].vz = 0;
    }
  }, [resetVelocitiesSignal]);

  const boidParamsRef = useRef<IBoidParams>({ ...BOID_DEFAULTS });

  useEffect(() => {
    const isAnimating =
      (attractorOverride && attractorBoost > 6) ||
      (homeSpringOverride !== undefined && homeSpringOverride > 0.005);
    boidParamsRef.current = {
      visualRange: boidVisualRange,
      separationDist: boidVisualRange * 0.21,
      separationFactor:
        separationOverride !== undefined
          ? separationOverride
          : isAnimating
            ? boidSeparation * 0.1
            : boidSeparation,
      alignmentFactor:
        alignmentOverride !== undefined
          ? alignmentOverride
          : isAnimating
            ? boidAlignment * 0.15
            : boidAlignment,
      cohesionFactor:
        cohesionOverride !== undefined
          ? cohesionOverride
          : isAnimating
            ? boidCohesion * 0.1
            : boidCohesion,
      attractorFactor: attractorOverride
        ? BOID_DEFAULTS.attractorFactor * attractorBoost
        : BOID_DEFAULTS.attractorFactor,
      homeSpringFactor:
        homeSpringOverride !== undefined
          ? homeSpringOverride
          : attractorOverride
            ? boidHomeSpring * 0.05
            : boidHomeSpring,
      maxHomeDistance: BOID_DEFAULTS.maxHomeDistance,
      speedLimit: isAnimating
        ? boidSpeedLimit *
          (speedMultiplier ?? 1) *
          Math.max(
            attractorBoost ?? 6,
            homeSpringOverride !== undefined ? homeSpringOverride * 600 : 1,
          )
        : boidSpeedLimit * (speedMultiplier ?? 1),
      minSpeed: boidSpeedLimit * 0.32,
      noiseMagnitude: isAnimating ? 0 : boidNoise * (noiseMultiplier ?? 1),
      orbitSpeed: swarmOrbitSpeed,
      orbitRadius: swarmOrbitRadius,
      splitIntensity: isAnimating ? 0 : swarmSplitIntensity,
      splitSpeed: swarmSplitSpeed,
      splitDecay: BOID_DEFAULTS.splitDecay,
      steeringInertia: isAnimating
        ? 0.3
        : (steeringInertiaOverride ?? BOID_DEFAULTS.steeringInertia),
      swirlStrength: isAnimating
        ? 0
        : (swirlStrengthOverride ?? swarmSwirlStrength),
      velocityStretchFactor: isAnimating
        ? 0
        : BOID_DEFAULTS.velocityStretchFactor,
      attractorOverride,
      shellAttractorRadius: shellAttractorRadius ?? 0,
    };
  }, [
    attractorBoost,
    attractorOverride,
    alignmentOverride,
    cohesionOverride,
    separationOverride,
    shellAttractorRadius,
    boidAlignment,
    boidCohesion,
    boidHomeSpring,
    boidNoise,
    boidSeparation,
    boidSpeedLimit,
    boidVisualRange,
    homeSpringOverride,
    noiseMultiplier,
    speedMultiplier,
    steeringInertiaOverride,
    swirlStrengthOverride,
    swarmOrbitSpeed,
    swarmOrbitRadius,
    swarmSwirlStrength,
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
    material.depthWrite = false;
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
    const s = particleSize;

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

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const boids = boidsRef.current;

    if (!mesh || count <= 0 || boids.length === 0) {
      return;
    }

    // Track time since the shell attractor was last activated so the tumbling
    // axis uses a local clock instead of the ever-growing global elapsed time.
    const currentShellRadius = shellAttractorRadius ?? 0;
    if (currentShellRadius > 0) {
      if (prevShellRadiusRef.current === 0) {
        shellElapsedRef.current = 0;
      }
      shellElapsedRef.current += delta;
    }
    prevShellRadiusRef.current = currentShellRadius;

    boidParamsRef.current.shellElapsed = shellElapsedRef.current;

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
    const s = sizeRef.current;

    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let i = 0; i < count; i += 1) {
      const b = boids[i];
      const off = i * 16;
      arr[off] = s;
      arr[off + 5] = s;
      arr[off + 10] = s;
      arr[off + 12] = b.x;
      arr[off + 13] = b.y;
      arr[off + 14] = b.z;
      cx += b.x;
      cy += b.y;
      cz += b.z;
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Apply opacity multiplier per-frame so it stays reactive without
    // adding to the useEffect dep array (avoids hook array-size violations).
    const effectiveOpacity = opacityRef.current * opacityMultiplierRef.current;
    if (material.opacity !== effectiveOpacity) {
      material.opacity = effectiveOpacity;
      material.transparent =
        effectiveOpacity < 1 || material.blending !== NormalBlending;
      material.needsUpdate = true;
    }

    if (onCentroidUpdate && count > 0) {
      onCentroidUpdate({ x: cx / count, y: cy / count, z: cz / count });
    }
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
