import type { IBoidParticle } from "./boids3d";
import { stepBoids } from "./boids3d";
import type { IBoidParams } from "./boidParams";
import { BOID_DEFAULTS } from "./boidParams";

export interface IParticleV2 extends IBoidParticle {
  /** Current lerp target position. */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Spawn ring position — used to compute Beat 1 halfway targets. */
  initialX: number;
  initialY: number;
  initialZ: number;
}

export type TBeat = 0 | 1 | 2 | 3 | 4 | 5;

export interface ISimConfigV2 {
  /** 0 = pure boid, 1 = pure lerp toward targetPos */
  lerpWeight: number;
  /** Per-second exponential lerp rate (e.g. 2.0 → ~86% of the way in 1 s) */
  lerpSpeed: number;
  boidParams: IBoidParams;
}

// ── Boid presets ──────────────────────────────────────────────────────────────

/** Beat 0/1 – swirl murmuration: particles orbit the camera periphery in a flat ring, no centripetal collapse. */
export const SWIRL_BOID_PARAMS: IBoidParams = {
  ...BOID_DEFAULTS,
  visualRange: 0.12,
  separationDist: 0.025,
  separationFactor: 0.0005,
  alignmentFactor: 0.001,
  cohesionFactor: 0.0003,
  attractorFactor: 0,
  attractorBoost: 1,
  homeSpringFactor: 0,
  maxHomeDistance: 0.4,
  speedLimit: 0.004,
  minSpeed: 0.001,
  noiseMagnitude: 0.00015,
  swirlStrength: 0.001,
  splitIntensity: 0.05,
  splitSpeed: 2.5,
  splitDecay: 3.0,
  steeringInertia: 0.92,
  velocityStretchFactor: 0.01,
  shellAttractorRadius: 0,
  attractorOverride: null,
};

/**
 * Beat 0 "Initial" — particles stay on the peripheral ring with no inward drift.
 * Both cohesion and alignment zeroed so the flock can't pull itself inward.
 * Speed is 30% lower than Beat 1 (speedLimit/minSpeed × 0.7).
 */
export const INITIAL_BOID_PARAMS: IBoidParams = {
  ...SWIRL_BOID_PARAMS,
  cohesionFactor: 0,
  alignmentFactor: 0,
  separationFactor: 0.0002,
  speedLimit: 0.0028, // 0.004 × 0.7 — 30% slower than Beat 1
  minSpeed: 0.0007, // 0.001 × 0.7 — 30% slower than Beat 1
};

/** Orbit / atmosphere particles – gentle cohesion, very low speed, used during beats 2/3/4/5. */
export const ORBIT_BOID_PARAMS: IBoidParams = {
  ...BOID_DEFAULTS,
  visualRange: 0.15,
  separationDist: 0.03,
  separationFactor: 0.001,
  alignmentFactor: 0.002,
  cohesionFactor: 0.0002,
  attractorFactor: 0.0002,
  attractorBoost: 1,
  homeSpringFactor: 0.00005,
  maxHomeDistance: 1.5,
  speedLimit: 0.0015, // reduced from 0.003 — slower orbital motion at beats 4/5
  minSpeed: 0.0004, // halved accordingly
  noiseMagnitude: 0.0001,
  swirlStrength: 0.0002, // reduced from 0.0005 — less angular velocity around the figure
  splitIntensity: 0.0,
  splitSpeed: 1.0,
  splitDecay: 2.0,
  steeringInertia: 0.9,
  velocityStretchFactor: 0.01,
  shellAttractorRadius: 0,
  attractorOverride: null,
};

// ── Target generators ─────────────────────────────────────────────────────────

/** Distributes N points across 6 faces of a cube with organic jitter for a crystalline look. */
export function generateCubeTargets(count: number, side = 1.2): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const face = Math.floor(Math.random() * 6);
    // Vary radius slightly so the cube "breathes" rather than being a perfect shell
    const radiusScale = 1 + (Math.random() * 0.12 - 0.06);
    const half = (side / 2) * radiusScale;
    const u = (Math.random() - 0.5) * side * radiusScale;
    const v = (Math.random() - 0.5) * side * radiusScale;
    const o = i * 3;
    let px: number, py: number, pz: number;
    switch (face) {
      case 0:
        px = u;
        py = half;
        pz = v;
        break;
      case 1:
        px = u;
        py = -half;
        pz = v;
        break;
      case 2:
        px = half;
        py = u;
        pz = v;
        break;
      case 3:
        px = -half;
        py = u;
        pz = v;
        break;
      case 4:
        px = u;
        py = v;
        pz = half;
        break;
      default:
        px = u;
        py = v;
        pz = -half;
        break;
    }
    // Surface jitter: small displacement in all axes breaks flat-face regularity
    positions[o] = px + (Math.random() * 0.08 - 0.04);
    positions[o + 1] = py + (Math.random() * 0.08 - 0.04);
    positions[o + 2] = pz + (Math.random() * 0.08 - 0.04);
  }
  return positions;
}

// ── Particle creation ─────────────────────────────────────────────────────────

/** Creates IParticleV2 from model surface home positions.
 *  Particles spawn in a flat ring around the camera periphery (XY plane, r≈2.5–3.7)
 *  with tangential velocity so they orbit rather than collapse inward. */
export function createParticlesV2(
  homePositions: Float32Array,
  count: number,
): IParticleV2[] {
  const particles: IParticleV2[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const hx = homePositions[o];
    const hy = homePositions[o + 1];
    const hz = homePositions[o + 2];

    // Spawn on a wide flat ring in the XY plane — matches the large Beat 0 ring radius
    const angle = Math.random() * Math.PI * 2;
    const ringRadius = 3.2 + Math.random() * 0.8; // r = 3.2–4.0, matches ringTarget/ringMin
    const zSpread = (Math.random() - 0.5) * 2.0; // wider Z spread (±1.0) for visible torus depth
    const px = Math.cos(angle) * ringRadius;
    const py = Math.sin(angle) * ringRadius;
    const pz = zSpread;

    // Tangential velocity — particles orbit the center, not fall into it
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);
    const speed = 0.004 + Math.random() * 0.003;
    const ivx = tangentX * speed + (Math.random() - 0.5) * 0.002;
    const ivy = tangentY * speed + (Math.random() - 0.5) * 0.002;
    const ivz = (Math.random() - 0.5) * 0.001;

    particles[i] = {
      x: px,
      y: py,
      z: pz,
      vx: ivx,
      vy: ivy,
      vz: ivz,
      homeX: hx,
      homeY: hy,
      homeZ: hz,
      targetX: hx,
      targetY: hy,
      targetZ: hz,
      initialX: px,
      initialY: py,
      initialZ: pz,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      size: 1,
      opacity: 1,
      noiseAngle: Math.random() * Math.PI * 2,
      noiseSpeed: 0.008 + Math.random() * 0.02,
      prevVX: ivx,
      prevVY: ivy,
      prevVZ: ivz,
      queuedTurnX: 0,
      queuedTurnY: 0,
      queuedTurnZ: 0,
    };
  }
  return particles;
}

/** Kickstarts particle velocities if they've been damped to near-zero (lerp → boid transition). */
export function kickstartVelocities(
  particles: IParticleV2[],
  minSpeed = 0.002,
): void {
  for (const p of particles) {
    const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    if (spd < minSpeed * 0.5) {
      p.vx = (Math.random() - 0.5) * minSpeed;
      p.vy = (Math.random() - 0.5) * minSpeed;
      p.vz = (Math.random() - 0.5) * minSpeed;
    }
  }
}

// ── Main simulation step ───────────────────────────────────────────────────────

/**
 * Advances the simulation one frame.
 *
 * Core principle: at any moment only ONE force system primarily drives motion.
 * - `lerpWeight = 1`: pure lerp toward targetPos (no boid forces).
 * - `lerpWeight = 0`: pure boid murmuration.
 * - In between: boid step runs, then lerp correction is blended in.
 */
export function stepParticlesV2(
  particles: IParticleV2[],
  config: ISimConfigV2,
  elapsed: number,
  dt: number,
): void {
  const { boidParams, lerpWeight, lerpSpeed } = config;
  const n = particles.length;
  if (n === 0) return;

  if (lerpWeight < 0.99) {
    // Run boid simulation — updates velocities and positions
    stepBoids(particles as unknown as IBoidParticle[], boidParams, elapsed);
  }

  if (lerpWeight > 0.01) {
    // Frame-rate-independent exponential lerp toward targetPos
    const alpha = (1 - Math.exp(-lerpSpeed * dt)) * lerpWeight;
    const dampFactor = 1 - lerpWeight * 0.55;
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      p.x += (p.targetX - p.x) * alpha;
      p.y += (p.targetY - p.y) * alpha;
      p.z += (p.targetZ - p.z) * alpha;
      // Suppress boid velocity during lerp so forces don't fight
      p.vx *= dampFactor;
      p.vy *= dampFactor;
      p.vz *= dampFactor;
    }
  }
}

/** Sets target positions on all particles for the given beat. */
export function setTargetsForBeat(
  particles: IParticleV2[],
  beat: TBeat,
  cubeTargets: Float32Array,
): void {
  const n = particles.length;
  const shapeTargets = cubeTargets;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const o = i * 3;

    switch (beat) {
      case 0:
        // Initial: targets are irrelevant (pure boid), set to current position to avoid jumps
        p.targetX = p.x;
        p.targetY = p.y;
        p.targetZ = p.z;
        break;

      case 1:
        // Swirl in: halfway between initial ring position and final shape position
        p.targetX = p.initialX * 0.5 + shapeTargets[o] * 0.5;
        p.targetY = p.initialY * 0.5 + shapeTargets[o + 1] * 0.5;
        p.targetZ = p.initialZ * 0.5 + shapeTargets[o + 2] * 0.5;
        break;

      case 2:
        // Form: target = cube surface
        p.targetX = shapeTargets[o];
        p.targetY = shapeTargets[o + 1];
        p.targetZ = shapeTargets[o + 2];
        break;

      case 3:
        // Hint: 75% shape + 25% home — creates a "bulging toward figure" effect
        p.targetX = shapeTargets[o] * 0.75 + p.homeX * 0.25;
        p.targetY = shapeTargets[o + 1] * 0.75 + p.homeY * 0.25;
        p.targetZ = shapeTargets[o + 2] * 0.75 + p.homeZ * 0.25;
        break;

      case 4:
      case 5:
        // Reveal / Approved: target = model surface home
        p.targetX = p.homeX;
        p.targetY = p.homeY;
        p.targetZ = p.homeZ;
        break;
    }
  }
}

/** Returns the lerp weight (0–1) for a given beat. */
export function getLerpWeightForBeat(beat: TBeat): number {
  switch (beat) {
    case 0:
      return 0; // pure boid (initial swirl ring)
    case 1:
      return 1; // pure lerp toward halfway point (swirl in)
    case 2:
      return 1; // pure lerp (form)
    case 3:
      return 1; // pure lerp (hint)
    case 4:
      return 1; // lerp-dominant (reveal — multi-wave handled in SceneV2)
    case 5:
      return 1; // pure lerp (approved)
  }
}

/** Returns the lerp speed (per-second rate) for a given beat. */
export function getLerpSpeedForBeat(beat: TBeat): number {
  switch (beat) {
    case 0:
      return 1.0; // initial: frozen (not used)
    case 1:
      return 0.8; // swirl in: gentle inward drift toward halfway
    case 2:
      return 1.5; // form: ~90% there in 1.5 s
    case 3:
      return 0.8; // hint: gentle drift
    case 4:
      return 2.0; // reveal: decisive
    case 5:
      return 1.2; // approved: settle
    default:
      return 1.0;
  }
}

/**
 * Re-assigns cube target positions so that each particle's cube position is
 * spatially close to its figure-home position. This prevents particles from
 * needing to cross the scene during cube↔figure transitions, making Hint and
 * Reveal feel like one continuous shape deforming rather than two particle
 * systems swapping places.
 *
 * Uses an O(n log n) spatial sort: particles and cube targets are both sorted
 * by Y→X→Z, then paired index-by-index. This ensures the most visually
 * important axis (vertical Y) is locally matched. A particle near the top of
 * the figure will receive a cube target near the top of the cube.
 *
 * Must be called AFTER homeX/Y/Z are set on all particles (i.e., after
 * applyRotationToHomes runs) and after cubeTargets are generated.
 *
 * @returns A new Float32Array where result[i*3 … i*3+2] is the spatially
 *   matched cube surface point for particles[i].
 */
export function reassignCubeTargetsByProximity(
  particles: IParticleV2[],
  cubeTargets: Float32Array,
): Float32Array {
  const n = particles.length;

  // Sort particle indices by homeY (primary), homeX (secondary), homeZ (tertiary)
  const particleOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const dy = particles[a].homeY - particles[b].homeY;
    if (dy !== 0) return dy;
    const dx = particles[a].homeX - particles[b].homeX;
    if (dx !== 0) return dx;
    return particles[a].homeZ - particles[b].homeZ;
  });

  // Sort cube target indices by Y (primary), X (secondary), Z (tertiary)
  const cubeOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const dy = cubeTargets[a * 3 + 1] - cubeTargets[b * 3 + 1];
    if (dy !== 0) return dy;
    const dx = cubeTargets[a * 3] - cubeTargets[b * 3];
    if (dx !== 0) return dx;
    return cubeTargets[a * 3 + 2] - cubeTargets[b * 3 + 2];
  });

  // Pair sorted particle i with sorted cube target i — ensures Y-local matching
  const sorted = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const pi = particleOrder[i];
    const ci = cubeOrder[i];
    sorted[pi * 3] = cubeTargets[ci * 3];
    sorted[pi * 3 + 1] = cubeTargets[ci * 3 + 1];
    sorted[pi * 3 + 2] = cubeTargets[ci * 3 + 2];
  }

  return sorted;
}

/** Returns the boid params for a given beat (only relevant for boid beats). */
export function getBoidParamsForBeat(
  beat: TBeat,
  swirlStrength = BOID_DEFAULTS.swirlStrength,
): IBoidParams {
  switch (beat) {
    case 0:
      // Initial state: no cohesion — particles hold the peripheral ring.
      // swirlStrength scaled to 0.7× so Beat 0 orbits ~30% slower than Beat 1.
      return { ...INITIAL_BOID_PARAMS, swirlStrength: swirlStrength * 0.7 };
    case 1:
      return { ...SWIRL_BOID_PARAMS, swirlStrength };
    default:
      return SWIRL_BOID_PARAMS;
  }
}
