import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";

import { useEffect, useMemo, useRef, useState } from "react";

import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { OrbitControls as ThreeOrbitControls } from "three-stdlib";

import type { IBoidParticle } from "../sim/boids3d";
import { stepBoids } from "../sim/boids3d";
import {
  ORBIT_BOID_PARAMS,
  SWIRL_BOID_PARAMS,
  type IParticleV2,
  type TBeat,
  createParticlesV2,
  generateCubeTargets,
  getBoidParamsForBeat,
  getLerpSpeedForBeat,
  getLerpWeightForBeat,
  kickstartVelocities,
  reassignCubeTargetsByProximity,
  setTargetsForBeat,
} from "../sim/particleSimV2";
import {
  PARTICLE_CAPACITY,
  sampleMeshSurface,
  sampleMeshSurfaceBiased,
} from "../utils/surfaceSampler";
import { loadStaticModel } from "../utils/meshIngest";
import type {
  TSurfaceDepthBias,
  TDepthSizing,
  TDepthOpacityMode,
  THintShape,
  THintStyle,
} from "../types";
import ParticleSystemV2 from "./ParticleSystemV2";
import SkinParticleSystem from "./SkinParticleSystem";

import type { BufferGeometry, Group } from "three";

// ── Transition constants ───────────────────────────────────────────────────────

const TRANSITION_DURATION = 0.5; // seconds

/** Auto-rotation speed for Beat 5 figure spin: one full revolution in ~17 seconds. */
const AUTO_ROT_SPEED = (2 * Math.PI) / 21.25;

// ── Camera targets per beat ────────────────────────────────────────────────────

export const CAMERA_POSITIONS: Record<TBeat, [number, number, number]> = {
  0: [0, 0, 6], // Beat 0: facing the XY ring, looking through the donut hole
  1: [-0.8, 0.4, 4.5], // Beat 1: pulled back to give particles room to swirl in
  2: [-1.4, 0.5, 3.5], // Beat 2: dramatic side angle, elevated — showcases 3D cube
  3: [-1.4, 0.5, 3.3], // Beat 3: same dramatic angle, slightly closer for hint
  4: [-1.2, 0.3, 3.2], // Beat 4: close, intimate reveal angle matching v1
  5: [-1.2, 0.3, 3.2], // Beat 5 (Approved): same as v1 framing
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed | 0;
  for (let i = result.length - 1; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223;
    const j = Math.abs(s) % (i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Assigns each particle a region index based on its Y position after rotation.
 * Region 0 = top (highest Y = most visually dramatic), region N-1 = bottom.
 * Used for Beat 3 breathing cycles and Beat 4 staged reveal.
 */
function computeRegionIndices(
  particles: IParticleV2[],
  regionIndex: Float32Array,
  numRegions: number,
): void {
  const n = particles.length;
  if (n === 0) return;
  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (particles[i].homeY < minY) minY = particles[i].homeY;
    if (particles[i].homeY > maxY) maxY = particles[i].homeY;
  }
  const range = maxY - minY + 0.001;
  for (let i = 0; i < n; i++) {
    const t = (particles[i].homeY - minY) / range;
    // t=1 (top) → region 0; t=0 (bottom) → region N-1
    regionIndex[i] = Math.min(Math.floor((1 - t) * numRegions), numRegions - 1);
  }
}

/**
 * Applies an outward velocity impulse to orbit/swarm particles near the
 * center of the given region, simulating marble-dust debris scatter.
 */
function applyDebrisScatter(
  particles: IParticleV2[],
  primaryCount: number,
  regionIndices: Float32Array,
  targetRegion: number,
  totalCount: number,
): void {
  let cx = 0,
    cy = 0,
    cz = 0,
    cnt = 0;
  for (let i = 0; i < primaryCount; i++) {
    if (i < regionIndices.length && regionIndices[i] === targetRegion) {
      cx += particles[i].homeX;
      cy += particles[i].homeY;
      cz += particles[i].homeZ;
      cnt++;
    }
  }
  if (cnt === 0) return;
  cx /= cnt;
  cy /= cnt;
  cz /= cnt;

  const scatterRadius = 0.8;
  const impulseMag = 0.015;
  for (let i = primaryCount; i < totalCount; i++) {
    const p = particles[i];
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < scatterRadius && dist > 0.001) {
      const factor = impulseMag / dist;
      p.vx += dx * factor;
      p.vy += dy * factor;
      p.vz += dz * factor;
    }
  }
}

function computeWave1Group(
  particles: IParticleV2[],
  revealMode: "anatomical" | "random",
  n: number,
  seed: number,
  wave1SetRef: React.MutableRefObject<Set<number>>,
): void {
  const orbitCount = Math.ceil(n * 0.06);
  const revealableIndices: number[] = [];
  for (let i = 0; i < n - orbitCount; i++) revealableIndices.push(i);
  const wave1Count = Math.floor(revealableIndices.length * 0.8);

  let wave1Indices: number[];
  if (revealMode === "anatomical") {
    // High Y = wings/shoulders/head → reveal first
    revealableIndices.sort((a, b) => particles[b].homeY - particles[a].homeY);
    wave1Indices = revealableIndices.slice(0, wave1Count);
  } else {
    const shuffled = seededShuffle(revealableIndices, seed);
    wave1Indices = shuffled.slice(0, wave1Count);
  }
  wave1SetRef.current = new Set(wave1Indices);
}

/** Scratch Vector3 reused every frame to avoid per-frame allocations. */
const _scratchCamDir = new Vector3();

// Beat 5 quaternion delta scratch objects — allocated once at module level to
// avoid per-frame GC pressure. The delta quaternion encodes the exact rotation
// that takes a point from the figure's base pose (homeX/Y/Z) to its current
// pose (base + approvedRotX/Y), matching the XYZ Euler order Three.js uses for
// figureGroupRef. This replaces the old manual cosZ/sinZ+cosX/sinX math which
// approximated rotation around world -Z and caused squishing under compound Euler angles.
// Applied as Q_delta * (homePos − posOffset) + posOffset so the rotation pivots
// around the figure centroid rather than the world origin (the origin-pivot bug
// was the remaining squish source for compound/tilt rotations).
const _beat5EulerBase = new Euler();
const _beat5EulerNew = new Euler();
const _beat5QuatBase = new Quaternion();
const _beat5QuatNew = new Quaternion();
const _beat5QuatDelta = new Quaternion();
const _beat5Vec = new Vector3();

/** Cubic ease-in-out (smootherstep). */
function cubicEase(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Returns a morphed particle target that smoothly oscillates between
 * cube ↔ sphere as morphPhase (cycles) advances.
 * morphPhase is driven by beat3Elapsed * breatheSpeed for a slow, dreamy effect.
 */
function morphCubeTarget(
  cubeX: number,
  cubeY: number,
  cubeZ: number,
  morphPhase: number,
): [number, number, number] {
  // Oscillate between cube and sphere using a cosine wave
  // morphPhase=0 → t=0 (pure cube), morphPhase=0.5 → t=1 (pure sphere)
  // Ensures no jolt when Beat 3 starts (morphPhase always resets to 0 = cube)
  const t = (1 - Math.cos(morphPhase * Math.PI * 2)) / 2; // 0→1→0→1...
  const smooth = smoothstep(smoothstep(t)); // double smoothstep for extra ease
  // Cap at 80% — never reach full sphere
  const cappedSmooth = smooth * 0.8;

  const r = Math.sqrt(cubeX * cubeX + cubeY * cubeY + cubeZ * cubeZ);
  const sphereScale = r > 0 ? 0.57 / r : 0;
  const sphereX = cubeX * sphereScale;
  const sphereY = cubeY * sphereScale;
  const sphereZ = cubeZ * sphereScale;

  return [
    lerp(cubeX, sphereX, cappedSmooth),
    lerp(cubeY, sphereY, cappedSmooth),
    lerp(cubeZ, sphereZ, cappedSmooth),
  ];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ITransitionState {
  active: boolean;
  fromLerpWeight: number;
  toLerpWeight: number;
  startTime: number;
  toBeat: TBeat;
}

interface IBreakawayState {
  active: boolean;
  timer: number;
  duration: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ISceneV2Props {
  beat: TBeat;
  particleCount: number;
  /** Particle count for the static surface skin layer (SkinParticleSystem). Defaults to PARTICLE_CAPACITY. */
  skinParticleCount?: number;
  particleSize: number;
  color: string;
  opacity: number;
  swirlStrength: number;
  revealMode?: "anatomical" | "random";
  /** Controls lerp speed when particles snap to the geometric shape in Beat 2. */
  formTransition?: "fast" | "drift" | "cascade";
  /** Controls lerp speed for Beat 3 (Hint). */
  hintSpeed?: "subtle" | "slow" | "medium";
  /** Controls timing of sub-phases in Beat 4 (Reveal). */
  revealPacing?: "dramatic" | "burst" | "current";
  /** Current beat's duration in seconds. Used to scale transition speeds. */
  beatDuration?: number;
  onBeatProgress?: (progress: number) => void;
  /** Registration callback: SceneV2 passes its scatter-reset function to the parent on mount. */
  onReset?: (resetFn: () => void) => void;
  /** Debug: when provided, overrides the beat-based camera position with these values. */
  debugCamera?: { x: number; y: number; z: number; lookAtY: number };
  /** Debug: when provided, sets the particle group's rotation each frame. */
  debugMeshRotation?: { x: number; y: number; z: number };
  /** Debug: uniform scale applied to the figure mesh group each frame. */
  figureScale?: number;
  /** When true (Beat 5), OrbitControls are enabled and camera lerp is paused. */
  orbitEnabled?: boolean;
  /** Controls how surface particles move during Beat 5 (Approved). */
  surfaceMotion?: "still" | "shimmer" | "breathe" | "flow";
  /** Controls which surface areas receive more particles during Beat 5. */
  surfaceDepthBias?: TSurfaceDepthBias;
  /** Controls how particle size varies based on surface orientation to camera during Beat 5. */
  depthSizing?: TDepthSizing;
  /** Controls depth/normal opacity variation on swarm particles (Off / Subtle / Strong). */
  depthOpacityMode?: TDepthOpacityMode;
  /** Uniform scale applied to the cube geometry in Beats 2/3 (default 2.5). */
  cubeScale?: number;
  /** Number of breathe-out-and-back cycles during Beat 3 Hint (1–4, default 2). */
  hintCycles?: number;
  /** Controls the wave shape of particle emergence within each Beat 3 hint cycle. */
  hintStyle?: THintStyle;
  /** Blob radius in world units for Beat 3 hint activation (0.2–1.0, default 0.4). */
  hintSpread?: number;
  /** Controls the spatial shape of the activation region in Beat 3 hint cycles. */
  hintShape?: THintShape;
  /** Number of sequential body regions that break free one-by-one in Beat 4 Reveal (1–6, default 4). */
  revealStages?: number;
  /** Speed at which the ripple wave front expands during Beats 3 & 4.
   *  Internally scaled by waveMaxDist × 0.15 per second, so 1.5 = comfortable default pace. */
  waveSpeed?: number;
  /** Seconds to blend into a new beat's dynamics (0 = instant, 1.8 = default gentle ramp). */
  transitionDuration?: number;
  /** Multiplier on how fast meltProgress advances during Beat 3 (0.2–3.0, default 1.0). */
  hintMeltSpeed?: number;
  /** World-space X offset applied to the figure centroid (default 0). */
  figurePosX?: number;
  /** World-space Y lift applied to the figure centroid (default 0.9). */
  figurePosY?: number;
  /** World-space Z offset applied to the figure centroid (default 0). */
  figurePosZ?: number;
  /** Multiplier applied to particleSize for swarm/orbit particles (ParticleSystemV2). Default 2.0. */
  swarmSizeMultiplier?: number;
  /** Which statue model to load. Default 'nike'. */
  statueModel?: "nike" | "mercury";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Applies a rotation+scale transform to all particles' homeX/Y/Z using the
 * provided raw (unrotated) mesh-space positions. Mirrors the transform that
 * figureGroupRef applies to SkinParticleSystem so swarm particle home targets
 * stay in sync with the visually-rotated figure mesh.
 *
 * After transforming, the centroid of all home positions is subtracted so the
 * figure is always centered at the world origin, then the caller-supplied
 * position offsets (yLift, posX, posZ) are added so the figure can be freely
 * repositioned in the viewport.
 *
 * Returns the centroid that was subtracted plus position offsets factored in
 * (in world space). The caller uses this to apply an equal-and-opposite
 * position offset to figureGroupRef so the SkinParticleSystem (which renders
 * the raw uncentered mesh positions) stays visually co-located with the
 * centroid-adjusted swarm particle cloud.
 */
function applyRotationToHomes(
  particles: IParticleV2[],
  rawPos: Float32Array,
  rotation: { x: number; y: number; z: number },
  scale: number,
  yLift: number,
  posX = 0,
  posZ = 0,
): { x: number; y: number; z: number } {
  const matrix = new Matrix4();
  matrix.makeRotationFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
  matrix.scale(new Vector3(scale, scale, scale));
  const v = new Vector3();
  // Count how many particles were actually written (may be capped by rawPos length)
  let written = 0;
  for (let i = 0; i < particles.length; i++) {
    const o = i * 3;
    if (o + 2 >= rawPos.length) break;
    v.set(rawPos[o], rawPos[o + 1], rawPos[o + 2]);
    v.applyMatrix4(matrix);
    particles[i].homeX = v.x;
    particles[i].homeY = v.y;
    particles[i].homeZ = v.z;
    written++;
  }

  // Center the figure: subtract the centroid of transformed home positions so
  // the figure center of mass sits at (0,0,0), matching the cube geometry used
  // in earlier beats. Without this, the particle swarm visibly shifts when
  // transitioning from cube targets to figure targets.
  if (written === 0) return { x: 0, y: 0, z: 0 };
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < written; i++) {
    cx += particles[i].homeX;
    cy += particles[i].homeY;
    cz += particles[i].homeZ;
  }
  cx /= written;
  cy /= written;
  cz /= written;
  // Apply yLift so the full body is visible in frame, plus X/Z position offsets.
  // Returning (cx - posX, cy - yLift, cz - posZ) lets the caller derive the
  // equal-and-opposite skin mesh offset so both swarm and skin stay co-located.
  for (let i = 0; i < written; i++) {
    particles[i].homeX -= cx - posX;
    particles[i].homeY -= cy - yLift;
    particles[i].homeZ -= cz - posZ;
  }
  return { x: cx - posX, y: cy - yLift, z: cz - posZ };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SceneV2(props: ISceneV2Props) {
  const {
    beat,
    particleCount,
    skinParticleCount = PARTICLE_CAPACITY,
    particleSize,
    color,
    opacity,
    swirlStrength,
    revealMode = "random",
    formTransition = "drift",
    hintSpeed = "slow",
    revealPacing = "current",
    beatDuration = 8,
    onBeatProgress,
    onReset,
    debugCamera,
    debugMeshRotation,
    figureScale = 1.0,
    orbitEnabled = false,
    surfaceMotion = "flow",
    surfaceDepthBias = "uniform",
    depthSizing = "flat",
    depthOpacityMode = "off",
    cubeScale = 2.5,
    hintCycles = 3,
    hintStyle = "bulge",
    hintSpread = 0.4,
    hintShape = "blob",
    revealStages = 4,
    waveSpeed = 1.5,
    transitionDuration = 2.25,
    hintMeltSpeed = 1.0,
    figurePosX = 0,
    figurePosY = 0.4,
    figurePosZ = 0,
    swarmSizeMultiplier = 2.0,
    statueModel = "nike",
  } = props;

  // Keep stable refs to latest props so useFrame closures always read fresh values
  const beatRef = useRef<TBeat>(beat);
  beatRef.current = beat;
  const orbitEnabledRef = useRef(orbitEnabled);
  orbitEnabledRef.current = orbitEnabled;
  const surfaceMotionRef = useRef(surfaceMotion);
  surfaceMotionRef.current = surfaceMotion;
  const surfaceDepthBiasRef = useRef(surfaceDepthBias);
  surfaceDepthBiasRef.current = surfaceDepthBias;
  const depthSizingRef = useRef(depthSizing);
  depthSizingRef.current = depthSizing;
  const swirlStrengthRef = useRef(swirlStrength);
  swirlStrengthRef.current = swirlStrength;
  const revealModeRef = useRef(revealMode);
  revealModeRef.current = revealMode;
  const formTransitionRef = useRef(formTransition);
  formTransitionRef.current = formTransition;
  const hintSpeedRef = useRef(hintSpeed);
  hintSpeedRef.current = hintSpeed;
  const revealPacingRef = useRef(revealPacing);
  revealPacingRef.current = revealPacing;
  const cubeScaleRef = useRef(cubeScale);
  cubeScaleRef.current = cubeScale;
  const hintCyclesRef = useRef(hintCycles);
  hintCyclesRef.current = hintCycles;
  const hintMeltSpeedRef = useRef(hintMeltSpeed);
  hintMeltSpeedRef.current = hintMeltSpeed;
  const hintStyleRef = useRef(hintStyle);
  hintStyleRef.current = hintStyle;
  const hintSpreadRef = useRef(hintSpread);
  hintSpreadRef.current = hintSpread;
  const hintShapeRef = useRef(hintShape);
  hintShapeRef.current = hintShape;
  const revealStagesRef = useRef(revealStages);
  revealStagesRef.current = revealStages;
  const waveSpeedRef = useRef(waveSpeed);
  waveSpeedRef.current = waveSpeed;
  const transitionDurationRef = useRef(transitionDuration);
  transitionDurationRef.current = transitionDuration;

  /**
   * Always 1.0 — previously ramped 0→1 on beat entry, now fixed so dynamics
   * engage instantly from frame 1. Smooth handoffs are achieved by a one-time
   * velocity dampening at beat entry instead of a progressive ramp multiplier.
   */
  const beatTransitionRef = useRef(1.0);

  /** Smoothly transitions to 0.8 in Reveal (beat 4) and Approved (beat 5) to reduce skin particle size 20%. */
  const skinSizeMultiplierRef = useRef(1.0);

  // ── Geometry & surface samples ────────────────────────────────────────────

  const geometryRef = useRef<BufferGeometry | null>(null);
  const homePositionsRef = useRef(new Float32Array(0));
  const homeNormalsRef = useRef(new Float32Array(0));
  /** Original mesh-space (unrotated) home positions. Never mutated after sampling — used as the source of truth when re-applying debugMeshRotation transforms. */
  const rawHomePositionsRef = useRef(new Float32Array(0));
  const geometryLoadedRef = useRef(false);

  // State-driven so the render re-runs when geometry/particles are ready
  const [skinGeometry, setSkinGeometry] = useState<BufferGeometry | null>(null);
  const [particleCount_ready, setParticleCountReady] = useState(0);

  // ── Shape targets (stable, rebuilt when particleCount changes) ────────────

  const cubeTargetsRef = useRef(new Float32Array(0));
  /**
   * Spatially-sorted cube targets: cubeTargets[i] is reassigned to the closest
   * available cube surface point to particles[i].homeX/Y/Z. This ensures that
   * each particle's cube position is geometrically near its figure-home position,
   * so transitions always feel local rather than particles flying across the scene.
   * Rebuilt whenever cube targets or home positions change.
   */
  const sortedCubeTargetsRef = useRef(new Float32Array(0));
  /** World-space origin of the ripple wave (centroid of top-20% homeY particles). */
  const waveOriginRef = useRef<{ x: number; y: number; z: number }>({
    x: 0,
    y: 0,
    z: 0,
  });
  /** Max distance from waveOrigin to any primary particle's home position. */
  const waveMaxDistRef = useRef<number>(1.5);
  /** Current wave Y position for Beat 4 Y-plane sweep; starts at maxHomeY, sweeps to minHomeY. */
  const waveRadiusBeat4Ref = useRef<number>(0);
  /** Min homeY among primary particles — lower bound of Beat 4 Y-plane sweep. */
  const waveMinYRef = useRef<number>(-1.5);
  /** Max homeY among primary particles — upper bound (start) of Beat 4 Y-plane sweep. */
  const waveMaxYRef = useRef<number>(1.5);

  // ── Particle simulation state ─────────────────────────────────────────────

  const particlesRef = useRef<IParticleV2[]>([]);
  /** Pre-sliced refs for separate boid steps — last 12% are orbit, first 88% are primary. */
  const primaryParticlesRef = useRef<IParticleV2[]>([]);
  const orbitParticlesRef = useRef<IParticleV2[]>([]);
  /**
   * Pre-computed random unit vectors for each orbit particle.
   * Stored as flat Float32Array [x0,y0,z0, x1,y1,z1, ...].
   * Using fixed spherical directions avoids the donut shape that results
   * from normalising homeX/Y/Z (model surface samples biased toward the figure's torso band).
   */
  const orbitDirsRef = useRef<Float32Array>(new Float32Array(0));
  /**
   * Per-particle shimmer offset magnitude for Beat 5 "shimmer" surface motion.
   * Length = primaryCount. Each value decays toward 0 each frame; random particles
   * are kicked to a positive outward offset to create the shimmer pop effect.
   */
  const shimmerOffsetRef = useRef<Float32Array>(new Float32Array(0));

  /**
   * Per-orbit-particle breakaway state for Beat 5.
   * When inactive, the particle sits on the figure surface.
   * When active, it briefly orbits around the figure then returns.
   */
  const breakawayRef = useRef<IBreakawayState[]>([]);

  // ── Transition state ──────────────────────────────────────────────────────

  const lerpWeightRef = useRef(getLerpWeightForBeat(beat));
  const transitionRef = useRef<ITransitionState>({
    active: false,
    fromLerpWeight: getLerpWeightForBeat(beat),
    toLerpWeight: getLerpWeightForBeat(beat),
    startTime: -1,
    toBeat: beat,
  });
  const prevBeatRef = useRef<TBeat>(beat);

  // ── Geometric shape rotation ──────────────────────────────────────────────

  const shapeRotationRef = useRef(0);
  const shapeRotationXRef = useRef(0);
  // ── Beat 1 pre-pull state ─────────────────────────────────────────────────

  const beat1StartTimeRef = useRef(-1);

  // ── Beat 2 cascade state ──────────────────────────────────────────────────

  const beat2StartTimeRef = useRef(-1);

  // ── Beat 4 multi-wave reveal state ────────────────────────────────────────

  const beat4StartTimeRef = useRef(-1);
  /** Accumulated Y rotation angle at the moment Beat 4 begins. Applied to cube
   *  targets throughout Beat 4 so the cube starts at the exact angle it had at
   *  the end of Hint — no flip at the Hint→Reveal boundary. */
  const beat4EntryRotYRef = useRef(0);
  /** Accumulated X rotation angle at the moment Beat 4 begins (see beat4EntryRotYRef). */
  const beat4EntryRotXRef = useRef(0);
  const wave1SetRef = useRef<Set<number>>(new Set());
  const sessionSeedRef = useRef(Math.floor(Math.random() * 1_000_000));

  // ── Marble emergence (Beats 3 & 4) ───────────────────────────────────────

  /** Per-particle region index: 0 = top (most dramatic), N-1 = bottom. */
  const regionIndexRef = useRef<Float32Array>(new Float32Array(0));
  /** Beat 3: total elapsed time since Beat 3 began (seconds). */
  const hintPhaseRef = useRef(0.0);
  /** Beat 3: clock time when Beat 3 started (for hint phase calculation). */
  const beat3StartTimeRef = useRef(-1);
  /** Beat 4: current active reveal stage (region index, 0 = first to emerge). */
  const revealStageRef = useRef(0);
  /** Beat 4: last stage index that triggered debris scatter (prevents repeat). */
  const lastRevealStageRef = useRef(-1);

  // ── Beat progress callback refs ───────────────────────────────────────────

  const onBeatProgressRef = useRef(onBeatProgress);
  onBeatProgressRef.current = onBeatProgress;
  const beatDurationRef = useRef(beatDuration);
  beatDurationRef.current = beatDuration;
  const beatProgressStartTimeRef = useRef<number>(-1);
  const prevBeatForProgressRef = useRef<TBeat>(beat);

  // ── Camera target ─────────────────────────────────────────────────────────

  const camTargetRef = useRef(new Vector3(...CAMERA_POSITIONS[beat]));

  // ── Debug overrides ───────────────────────────────────────────────────────

  const debugCameraRef = useRef(debugCamera);
  debugCameraRef.current = debugCamera;
  const debugMeshRotationRef = useRef(debugMeshRotation);
  debugMeshRotationRef.current = debugMeshRotation;
  const figureScaleRef = useRef(figureScale);
  figureScaleRef.current = figureScale;
  const figurePosXRef = useRef(figurePosX);
  figurePosXRef.current = figurePosX;
  const figurePosYRef = useRef(figurePosY);
  figurePosYRef.current = figurePosY;
  const figurePosZRef = useRef(figurePosZ);
  figurePosZRef.current = figurePosZ;
  const groupRef = useRef<Group | null>(null);
  /** Separate ref for the figure mesh group so debugMeshRotation only affects the figure, not particles. */
  const figureGroupRef = useRef<Group | null>(null);
  /** Ref to the OrbitControls instance — used to sync target on first orbit-enable frame. */
  const orbitControlsRef = useRef<ThreeOrbitControls | null>(null);

  // ── Beat 5 approved rotation state ─────────────────────────────────────────

  /** Accumulated Y-rotation offset for the Beat 5 figure auto/drag spin (radians). */
  const approvedRotYRef = useRef(0);
  /** True while the user is actively dragging to spin the figure in Beat 5. */
  const isDraggingApprovedRef = useRef(false);
  /** Canvas X position when the current drag started. */
  const dragStartXRef = useRef(0);
  /** approvedRotYRef value at the start of the current drag. */
  const dragStartRotYRef = useRef(0);
  /** Clock time when Beat 5 began (for settle delay). Reset to -1 when not in Beat 5. */
  const beat5StartTimeRef = useRef(-1);

  // ── Particle scatter-reset (exposed to parent via onReset prop) ───────────

  // resetRef.current is kept up-to-date every render so the stable wrapper
  // always has access to the latest particlesRef without stale closures.
  const resetRef = useRef<() => void>(() => {});
  resetRef.current = () => {
    const particles = particlesRef.current;
    if (particles.length === 0) return;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const angle = Math.random() * Math.PI * 2;
      const ringRadius = 3.2 + Math.random() * 0.8;
      const zSpread = (Math.random() - 0.5) * 2.0;
      p.x = Math.cos(angle) * ringRadius;
      p.y = Math.sin(angle) * ringRadius;
      p.z = zSpread;
      // Update stored initial (ring) position so Beat 1 halfway targets are correct
      p.initialX = p.x;
      p.initialY = p.y;
      p.initialZ = p.z;
      const speed = 0.001 + Math.random() * 0.0007; // matched to INITIAL_BOID_PARAMS speed range
      p.vx = -Math.sin(angle) * speed + (Math.random() - 0.5) * 0.0008;
      p.vy = Math.cos(angle) * speed + (Math.random() - 0.5) * 0.0008;
      p.vz = (Math.random() - 0.5) * 0.0005;
      p.targetX = p.x;
      p.targetY = p.y;
      p.targetZ = p.z;
      p.prevVX = p.vx;
      p.prevVY = p.vy;
      p.prevVZ = p.vz;
      p.queuedTurnX = 0;
      p.queuedTurnY = 0;
      p.queuedTurnZ = 0;
    }
    // Recompute targets for the current beat now that initialX/Y/Z are updated
    setTargetsForBeat(particles, beatRef.current, cubeTargetsRef.current);
  };
  // Stable wrapper — registered with parent once on mount
  const stableResetRef = useRef(() => resetRef.current());

  // ── Swarm centroid (for SkinParticleSystem proximity reveal) ─────────────

  // Mutated in place every frame so SkinParticleSystem.useFrame always reads
  // the latest value via its closed-over prop reference — no snap at beat
  // transitions from a frozen centroid.
  const skinCentroidRef = useRef({ x: 0, y: 0, z: 0 });

  // Negative of the centroid subtracted by applyRotationToHomes. Applied as
  // figureGroupRef.position so the SkinParticleSystem (which renders raw,
  // uncentered mesh positions) aligns with the centroid-adjusted swarm cloud.
  const figureOffsetRef = useRef({ x: 0, y: 0, z: 0 });

  // ── Wave & sorted-target helpers ─────────────────────────────────────────

  /**
   * Rebuilds sortedCubeTargetsRef and recomputes wave origin / max-distance.
   * Must be called after EITHER homeX/Y/Z values change (applyRotationToHomes)
   * OR cubeTargets change (generateCubeTargets). Both must be populated first.
   */
  function rebuildWaveAndSortedTargets(): void {
    const particles = particlesRef.current;
    const n = particles.length;
    if (n === 0 || cubeTargetsRef.current.length < n * 3) return;

    sortedCubeTargetsRef.current = reassignCubeTargetsByProximity(
      particles,
      cubeTargetsRef.current,
    );

    const orbitCount = Math.ceil(n * 0.06);
    const primaryCount = n - orbitCount;
    if (primaryCount === 0) return;

    // Wave origin = centroid of top 20% particles by -homeZ
    // With debugRotX ≈ -π/2, the figure's standing height (raw Y) maps to -Z in world
    // space. The head has the most-negative homeZ; -homeZ is the correct "up" axis.
    let maxNegZ = -Infinity,
      minNegZ = Infinity;
    for (let i = 0; i < primaryCount; i++) {
      const negZ = -particles[i].homeZ;
      if (negZ > maxNegZ) maxNegZ = negZ;
      if (negZ < minNegZ) minNegZ = negZ;
    }
    // Store -homeZ bounds for Beat 4 sweep (refs keep the same names to minimise diff)
    waveMinYRef.current = minNegZ;
    waveMaxYRef.current = maxNegZ;
    const threshold = minNegZ + (maxNegZ - minNegZ) * 0.8;
    let cx = 0,
      cy = 0,
      cz = 0,
      cnt = 0;
    for (let i = 0; i < primaryCount; i++) {
      if (-particles[i].homeZ >= threshold) {
        cx += particles[i].homeX;
        cy += particles[i].homeY;
        cz += particles[i].homeZ;
        cnt++;
      }
    }
    const ox = cnt > 0 ? cx / cnt : 0;
    const oy = cnt > 0 ? cy / cnt : 0;
    const oz = cnt > 0 ? cz / cnt : 0;
    waveOriginRef.current = { x: ox, y: oy, z: oz };

    // Max distance from wave origin to any primary particle
    let maxDist = 0;
    for (let i = 0; i < primaryCount; i++) {
      const ddx = particles[i].homeX - ox;
      const ddy = particles[i].homeY - oy;
      const ddz = particles[i].homeZ - oz;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (d > maxDist) maxDist = d;
    }
    waveMaxDistRef.current = Math.max(maxDist, 0.5);
  }

  // ── Load model on mount ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    loadStaticModel(
      import.meta.env.BASE_URL +
        (statueModel === "mercury" ? "Mercury.stl" : "model.stl"),
    ).then((geom) => {
      if (cancelled) return;

      geometryRef.current = geom;
      setSkinGeometry(geom);

      // Sample surface at full capacity for homes
      const count = Math.min(particleCount, PARTICLE_CAPACITY);
      const samples = sampleMeshSurface(geom, count, "areaWeighted");
      homePositionsRef.current = samples.positions;
      homeNormalsRef.current = samples.normals;
      // Store a copy of unrotated positions as the permanent source of truth
      rawHomePositionsRef.current = new Float32Array(samples.positions);

      // Shape targets (same count)
      cubeTargetsRef.current = generateCubeTargets(count, cubeScaleRef.current);

      // Create particles with home positions
      particlesRef.current = createParticlesV2(samples.positions, count);

      // Assign surface normals — createParticlesV2 leaves all normals as (0,1,0) by default;
      // the shader needs the actual mesh-surface normals for depthOpacityStrength to work.
      const surfaceNormals = homeNormalsRef.current;
      for (let i = 0; i < count; i++) {
        particlesRef.current[i].normalX = surfaceNormals[i * 3];
        particlesRef.current[i].normalY = surfaceNormals[i * 3 + 1];
        particlesRef.current[i].normalZ = surfaceNormals[i * 3 + 2];
      }

      const orbitCt = Math.ceil(count * 0.06);
      primaryParticlesRef.current = particlesRef.current.slice(
        0,
        count - orbitCt,
      );
      orbitParticlesRef.current = particlesRef.current.slice(count - orbitCt);

      // Allocate region index array (filled after rotation is applied in the
      // debugMeshRotation effect, which fires due to particleCount_ready change)
      regionIndexRef.current = new Float32Array(count);

      // Pre-compute stable random spherical directions for orbit particles.
      // Using random unit vectors (not homeX/Y/Z model-surface samples) gives
      // an even sphere distribution and avoids the donut artifact.
      const dirs = new Float32Array(orbitCt * 3);
      for (let i = 0; i < orbitCt; i++) {
        const theta = Math.acos(2 * Math.random() - 1); // polar angle (uniform on sphere)
        const phi = Math.random() * Math.PI * 2; // azimuthal angle
        dirs[i * 3] = Math.sin(theta) * Math.cos(phi);
        dirs[i * 3 + 1] = Math.cos(theta);
        dirs[i * 3 + 2] = Math.sin(theta) * Math.sin(phi);
      }
      orbitDirsRef.current = dirs;

      // Initialize shimmer offsets to zero for the primary (surface) particles
      shimmerOffsetRef.current = new Float32Array(count - orbitCt);

      // Initialize breakaway states — all inactive, sitting on surface
      breakawayRef.current = Array.from({ length: orbitCt }, () => ({
        active: false,
        timer: 0,
        duration: 2 + Math.random() * 3,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitRadius: 0.8 + Math.random() * 0.4,
        orbitSpeed: (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1),
      }));

      // Apply initial targets for the starting beat
      setTargetsForBeat(
        particlesRef.current,
        beatRef.current,
        cubeTargetsRef.current,
      );

      geometryLoadedRef.current = true;
      setParticleCountReady(count);

      // Register the stable scatter-reset function with the parent (once, after load)
      onReset?.(stableResetRef.current);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Rebuild particles when particleCount changes (after initial load) ─────

  useEffect(() => {
    if (!geometryLoadedRef.current || !geometryRef.current) return;

    const count = Math.min(particleCount, PARTICLE_CAPACITY);
    const geom = geometryRef.current;
    const samples = sampleMeshSurface(geom, count, "areaWeighted");
    homePositionsRef.current = samples.positions;
    homeNormalsRef.current = samples.normals;
    rawHomePositionsRef.current = new Float32Array(samples.positions);

    cubeTargetsRef.current = generateCubeTargets(count, cubeScaleRef.current);

    particlesRef.current = createParticlesV2(samples.positions, count);

    // Assign surface normals for depthOpacityStrength shader effect
    const surfaceNormals2 = homeNormalsRef.current;
    for (let i = 0; i < count; i++) {
      particlesRef.current[i].normalX = surfaceNormals2[i * 3];
      particlesRef.current[i].normalY = surfaceNormals2[i * 3 + 1];
      particlesRef.current[i].normalZ = surfaceNormals2[i * 3 + 2];
    }

    const oc = Math.ceil(count * 0.06);
    primaryParticlesRef.current = particlesRef.current.slice(0, count - oc);
    orbitParticlesRef.current = particlesRef.current.slice(count - oc);

    // Allocate fresh region index array (filled after rotation is applied)
    regionIndexRef.current = new Float32Array(count);

    const newDirs = new Float32Array(oc * 3);
    for (let i = 0; i < oc; i++) {
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      newDirs[i * 3] = Math.sin(theta) * Math.cos(phi);
      newDirs[i * 3 + 1] = Math.cos(theta);
      newDirs[i * 3 + 2] = Math.sin(theta) * Math.sin(phi);
    }
    orbitDirsRef.current = newDirs;
    shimmerOffsetRef.current = new Float32Array(count - oc);
    breakawayRef.current = Array.from({ length: oc }, () => ({
      active: false,
      timer: 0,
      duration: 2 + Math.random() * 3,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitRadius: 0.8 + Math.random() * 0.4,
      orbitSpeed: (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1),
    }));
    setTargetsForBeat(
      particlesRef.current,
      beatRef.current,
      cubeTargetsRef.current,
    );
    setParticleCountReady(count);
  }, [particleCount]);

  // ── React to surfaceDepthBias changes: re-sample surface with new weighting ──

  useEffect(() => {
    if (!geometryLoadedRef.current || !geometryRef.current) return;
    const particles = particlesRef.current;
    const count = particles.length;
    if (count === 0) return;

    const samples = sampleMeshSurfaceBiased(
      geometryRef.current,
      count,
      surfaceDepthBias,
    );
    homePositionsRef.current = samples.positions;
    homeNormalsRef.current = samples.normals;
    rawHomePositionsRef.current = new Float32Array(samples.positions);

    // Apply the current rotation/scale transform so home targets reflect the
    // oriented figure, not the raw unrotated mesh positions.
    const rot = debugMeshRotationRef.current ?? { x: -1.59, y: 0.01, z: -0.19 };
    const centroid = applyRotationToHomes(
      particles,
      rawHomePositionsRef.current,
      rot,
      figureScaleRef.current,
      figurePosYRef.current,
      figurePosXRef.current,
      figurePosZRef.current,
    );
    // Keep figureGroupRef offset in sync so the skin mesh aligns with the
    // centroid-adjusted swarm particle cloud.
    figureOffsetRef.current.x = -centroid.x;
    figureOffsetRef.current.y = -centroid.y;
    figureOffsetRef.current.z = -centroid.z;

    // Recompute region indices using the newly oriented homeY values
    if (regionIndexRef.current.length !== count) {
      regionIndexRef.current = new Float32Array(count);
    }
    computeRegionIndices(
      particles,
      regionIndexRef.current,
      revealStagesRef.current,
    );

    // Rebuild spatially-matched cube targets and wave metrics (homes changed)
    rebuildWaveAndSortedTargets();

    // Propagate new per-particle normals so depthOpacityStrength reflects the new surface sampling.
    // ParticleSystemV2.useFrame reads p.normalX/Y/Z each frame and uploads to the GPU buffer.
    const rebiasedNormals = homeNormalsRef.current;
    for (let i = 0; i < count; i++) {
      particles[i].normalX = rebiasedNormals[i * 3];
      particles[i].normalY = rebiasedNormals[i * 3 + 1];
      particles[i].normalZ = rebiasedNormals[i * 3 + 2];
    }
  }, [surfaceDepthBias]);

  // ── Regenerate cube targets when cubeScale changes ────────────────────────

  useEffect(() => {
    if (!geometryLoadedRef.current) return;
    const particles = particlesRef.current;
    if (particles.length === 0) return;
    cubeTargetsRef.current = generateCubeTargets(particles.length, cubeScale);
    // Rebuild sorted targets since cube positions changed (homes are unchanged)
    rebuildWaveAndSortedTargets();
    setTargetsForBeat(particles, beatRef.current, cubeTargetsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubeScale]);

  // ── Recompute region indices when revealStages slider changes ────────────

  useEffect(() => {
    const particles = particlesRef.current;
    if (particles.length === 0) return;
    if (regionIndexRef.current.length !== particles.length) {
      regionIndexRef.current = new Float32Array(particles.length);
    }
    computeRegionIndices(particles, regionIndexRef.current, revealStages);
  }, [revealStages]);

  // ── Re-apply rotation/scale to home positions when debug controls change ──

  useEffect(() => {
    const particles = particlesRef.current;
    const rawPos = rawHomePositionsRef.current;
    if (particles.length === 0 || rawPos.length === 0) return;

    const rot = debugMeshRotation ?? { x: -1.59, y: 0.01, z: -0.19 };
    const centroid = applyRotationToHomes(
      particles,
      rawPos,
      rot,
      figureScale,
      figurePosY,
      figurePosX,
      figurePosZ,
    );
    // Keep figureGroupRef offset in sync so the skin mesh aligns with the
    // centroid-adjusted swarm particle cloud.
    figureOffsetRef.current.x = -centroid.x;
    figureOffsetRef.current.y = -centroid.y;
    figureOffsetRef.current.z = -centroid.z;

    // Recompute region indices using updated homeY values
    if (regionIndexRef.current.length !== particles.length) {
      regionIndexRef.current = new Float32Array(particles.length);
    }
    computeRegionIndices(
      particles,
      regionIndexRef.current,
      revealStagesRef.current,
    );

    // Rebuild spatially-matched cube targets and wave metrics now that homes changed
    rebuildWaveAndSortedTargets();

    // Immediately refresh targets so Beat 5 surface targets reflect new orientation
    if (beatRef.current === 5) {
      setTargetsForBeat(particles, 5, cubeTargetsRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debugMeshRotation?.x,
    debugMeshRotation?.y,
    debugMeshRotation?.z,
    figureScale,
    figurePosX,
    figurePosY,
    figurePosZ,
    particleCount_ready,
  ]);

  // ── React to beat changes ─────────────────────────────────────────────────

  useEffect(() => {
    if (!geometryLoadedRef.current) return;
    if (beat === prevBeatRef.current) return;

    const particles = particlesRef.current;
    const fromBeat = prevBeatRef.current;
    const fromLerpWeight = getLerpWeightForBeat(fromBeat);
    const toLerpWeight = getLerpWeightForBeat(beat);

    // Transitioning from lerp → boid: give particles a small velocity kick
    if (toLerpWeight < fromLerpWeight) {
      kickstartVelocities(particles, SWIRL_BOID_PARAMS.minSpeed);
    }

    // Reset per-particle sizes when leaving Beat 5 so depth sizing doesn't persist
    if (fromBeat === 5 && beat !== 5) {
      for (let i = 0; i < particles.length; i++) particles[i].size = 1;
    }

    // Rebuild shape targets only for Beat 2. Beat 3 must reuse the exact same
    // sortedCubeTargetsRef that Beat 2 ended with — regenerating cube targets
    // here would assign new random positions, causing a position jump on the
    // first frame of Beat 3.
    // Skip if targets were already pre-assigned during Beat 1 entry (they are
    // identical — same generateCubeTargets params + same proximity assignment).
    if (beat === 2 && sortedCubeTargetsRef.current.length === 0) {
      cubeTargetsRef.current = generateCubeTargets(
        particles.length,
        cubeScaleRef.current,
      );
      // Rebuild spatially-matched targets so local transitions are preserved
      sortedCubeTargetsRef.current = reassignCubeTargetsByProximity(
        particles,
        cubeTargetsRef.current,
      );
    }
    // Beat 3: intentionally skip target rebuild — carry sortedCubeTargetsRef
    // from Beat 2 so each particle's cube assignment is identical across the
    // transition and no position snap occurs.

    // Set target positions for the incoming beat.
    // Beat 3 uses sorted (proximity-matched) targets so each particle's initial
    // target aligns with its cube position — no cross-particle travel at entry.
    setTargetsForBeat(
      particles,
      beat,
      beat === 3 ? sortedCubeTargetsRef.current : cubeTargetsRef.current,
    );

    // Preserve almost all momentum at beat entry (0.95×) so particles carry
    // their velocity through transitions. The previous formula (~0.5× at default
    // transitionDuration) was the root cause of the "slow Swirl In" (Beat 0→1)
    // and "speed burst at Form" (Beat 1→2) sensations: damping wiped out
    // momentum, then the higher lerp rate in Beat 2 felt like a sudden lurch.
    //
    // Beat 2 entry is excluded entirely: Beat 1 primary velocities are
    // near-zero (crushed to 0.45× every frame) so there is nothing useful to
    // damp. Applying any dampen — even 0.95× — creates a subtle frame-1
    // discontinuity that reads as a micro-lurch at Form entry.
    const primaryCtForDampen =
      particles.length - Math.ceil(particles.length * 0.06);
    if (beat !== 2) {
      const velocityDampenFactor = 0.95;
      const MICRO_V_THRESHOLD = 0.0005;
      for (let i = 0; i < primaryCtForDampen; i++) {
        particles[i].vx *= velocityDampenFactor;
        particles[i].vy *= velocityDampenFactor;
        particles[i].vz *= velocityDampenFactor;
        // Zero out micro-oscillations to prevent them from propagating
        if (Math.abs(particles[i].vx) < MICRO_V_THRESHOLD) particles[i].vx = 0;
        if (Math.abs(particles[i].vy) < MICRO_V_THRESHOLD) particles[i].vy = 0;
        if (Math.abs(particles[i].vz) < MICRO_V_THRESHOLD) particles[i].vz = 0;
      }
    }

    // Start cube rotation in Swirl In so it arrives at Form already spinning
    if (beat === 1) {
      shapeRotationRef.current = Math.PI / 5; // 36° — matches Beat 2's initial angle
      shapeRotationXRef.current = Math.PI / 8; // 22.5°
      beat1StartTimeRef.current = -1; // initialized on first useFrame tick
      // Pre-assign cube targets now so the second-half gentle pull has targets ready
      cubeTargetsRef.current = generateCubeTargets(
        particles.length,
        cubeScaleRef.current,
      );
      sortedCubeTargetsRef.current = reassignCubeTargetsByProximity(
        particles,
        cubeTargetsRef.current,
      );
    }

    // Reset cascade timer when entering beat 2
    if (beat === 2) {
      beat2StartTimeRef.current = -1; // initialized on first useFrame tick
      // Rotation carries over from Beat 1 — no hard-reset
    }

    // Reset Beat 3 melt state; spatially remap cube targets so particles spend
    // the full Hint beat (20 s) lerping toward their remapped positions. By Beat
    // 4 start all particles are already there — no positional jump occurs.
    if (beat === 3) {
      beat3StartTimeRef.current = -1;
      hintPhaseRef.current = 0;
      rebuildWaveAndSortedTargets();
    }

    // Reset Beat 4 staged reveal state; reset wave radius for new reveal pass.
    // Spatial remap (rebuildWaveAndSortedTargets) was already performed at Beat
    // 3 entry, giving particles the full Hint beat to lerp to remapped positions.
    if (beat === 4) {
      beat4StartTimeRef.current = -1; // reset; initialized on first useFrame tick
      revealStageRef.current = 0;
      // Capture the rotation angle at Beat 4 entry so cube targets in Beat 4
      // are displayed at the same angle the cube had at the end of Hint.
      // Without this capture, Beat 4 uses unrotated (angle=0) cube positions
      // while Beat 3 ended with accumulated rotation — causing a visible flip.
      beat4EntryRotYRef.current = shapeRotationRef.current;
      beat4EntryRotXRef.current = shapeRotationXRef.current;
      lastRevealStageRef.current = -1;
      // Use current particle Y positions (visual height in rotated cube) for wave order.
      // rebuildWaveAndSortedTargets() computed waveMaxY/MinY from -homeZ, which is
      // correct when skipping directly to Beat 4 but wrong after accumulated rotation.
      // Overwrite those refs with the actual particle Y range so the wave sweeps
      // from the visual top of the rotated cube regardless of accumulated rotation.
      let beat4MaxY = -Infinity;
      let beat4MinY = Infinity;
      for (let i = 0; i < particles.length; i++) {
        if (particles[i].y > beat4MaxY) beat4MaxY = particles[i].y;
        if (particles[i].y < beat4MinY) beat4MinY = particles[i].y;
      }
      waveMaxYRef.current = beat4MaxY;
      waveMinYRef.current = beat4MinY;
      // Start wave just above the top particle so no particles solidify on frame 1.
      waveRadiusBeat4Ref.current = beat4MaxY + (beat4MaxY - beat4MinY) * 0.02;
    }

    transitionRef.current = {
      active: true,
      fromLerpWeight: lerpWeightRef.current,
      toLerpWeight,
      startTime: -1, // set on first useFrame tick
      toBeat: beat,
    };

    prevBeatRef.current = beat;
  }, [beat]);

  // ── Sync OrbitControls target when orbit is first enabled ─────────────────
  //
  // The manual camera code calls camera.lookAt(0, 0.2, 0) for all non-Beat-0
  // beats. When OrbitControls becomes enabled (Beat 5), its internal target
  // defaults to (0, 0, 0). The first controls.update() call then snaps the
  // camera to look at (0, 0, 0) instead of (0, 0.2, 0), causing the figure
  // to visually jump ~40 px upward. Setting the target here — before the first
  // OrbitControls update() fires — keeps the camera orientation continuous.

  useEffect(() => {
    if (!orbitEnabled || !orbitControlsRef.current) return;
    orbitControlsRef.current.target.set(0, 0.2, 0);
  }, [orbitEnabled]);

  // ── Beat 5 drag-to-rotate: pointer events on the canvas ──────────────────

  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (beatRef.current !== 5) return;
      isDraggingApprovedRef.current = true;
      dragStartXRef.current = e.clientX;
      dragStartRotYRef.current = approvedRotYRef.current;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingApprovedRef.current) return;
      approvedRotYRef.current =
        dragStartRotYRef.current + (e.clientX - dragStartXRef.current) * 0.01;
    };

    const onPointerUp = () => {
      isDraggingApprovedRef.current = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [gl]);

  // ── Per-frame simulation ──────────────────────────────────────────────────

  useFrame((state, delta) => {
    const particles = particlesRef.current;
    if (particles.length === 0) return;

    const dt = Math.min(delta, 0.05); // cap for stability
    const elapsed = state.clock.elapsedTime;
    const currentBeat = beatRef.current;
    const n = particles.length;

    // Pivot point = figure centroid = posOffset (homeX/Y/Z values are centered
    // here by applyRotationToHomes). Q_delta must rotate around this point, not
    // the world origin, otherwise the off-center centroid gets rotated and causes
    // apparent squishing/distortion during drag.
    const beat5PivotX = figurePosXRef.current;
    const beat5PivotY = figurePosYRef.current;
    const beat5PivotZ = figurePosZRef.current;

    // Smoothly scale skin particles down 20% in Reveal (beat 4) and Approved (beat 5).
    const skinSizeTarget = currentBeat === 4 || currentBeat === 5 ? 0.8 : 1.0;
    skinSizeMultiplierRef.current +=
      (skinSizeTarget - skinSizeMultiplierRef.current) * 0.02;

    // ── Beat 5 auto-rotation: advance approved Y angle, compute trig ─────────
    // Starts after a 2.5 s settle delay; eases in over 1 s.
    // Resets to zero whenever we leave Beat 5.
    if (currentBeat === 5) {
      if (beat5StartTimeRef.current < 0) beat5StartTimeRef.current = elapsed;
      const beat5Elapsed = elapsed - beat5StartTimeRef.current;
      if (!isDraggingApprovedRef.current && beat5Elapsed > 2.5) {
        const rampT = Math.min(1, (beat5Elapsed - 2.5) / 1.0);
        approvedRotYRef.current += AUTO_ROT_SPEED * dt * (rampT * rampT);
      }
    } else {
      approvedRotYRef.current = 0;
      isDraggingApprovedRef.current = false;
      beat5StartTimeRef.current = -1;
    }

    // Beat 5: compute the quaternion delta once per frame so all particle sites
    // (orbit non-breakaway, shimmer, breathe, flow, still) share the same exact
    // rotation without per-site manual axis approximations.
    if (currentBeat === 5) {
      const baseRot = debugMeshRotationRef.current ?? {
        x: -1.59,
        y: 0.01,
        z: -0.19,
      };
      _beat5EulerBase.set(baseRot.x, baseRot.y, baseRot.z, "XYZ");
      _beat5EulerNew.set(
        baseRot.x,
        baseRot.y + approvedRotYRef.current,
        baseRot.z,
        "XYZ",
      );
      _beat5QuatBase.setFromEuler(_beat5EulerBase);
      _beat5QuatNew.setFromEuler(_beat5EulerNew);
      // Delta = Q_new * Q_base^-1; conjugate() == invert() for unit quaternions
      _beat5QuatDelta.copy(_beat5QuatNew).multiply(_beat5QuatBase.conjugate());
    }

    // Advance transition
    const trans = transitionRef.current;
    if (trans.active) {
      if (trans.startTime < 0) trans.startTime = elapsed;
      const t = Math.min((elapsed - trans.startTime) / TRANSITION_DURATION, 1);
      lerpWeightRef.current =
        trans.fromLerpWeight + (trans.toLerpWeight - trans.fromLerpWeight) * t;
      if (t >= 1) {
        trans.active = false;
        lerpWeightRef.current = trans.toLerpWeight;
      }
    }

    // ── Orbit / primary split (last 6% = orbit, first 94% = primary) ────────
    const orbitCount = Math.ceil(n * 0.06);
    const primaryCount = n - orbitCount;

    // ── Orbit particle targets (beat-conditional) ────────────────────────────
    // Beats 0/1: orbit particles blend into the ring (no separate sphere halo).
    // Beats 2/3: orbit particles follow the SAME geometric shape as primary particles.
    // Beat 4:    tighter sphere orbit close to the figure surface (radius 0.9).
    // Beat 5:    breakaway behavior — most particles sit on the surface, occasional
    //            small groups briefly orbit then return.
    if (currentBeat <= 1) {
      // In beats 0/1 orbit particles just follow boid forces like primary particles —
      // no separate sphere target so they stay within the ring.
    } else if (currentBeat === 4) {
      // Orbit particles target the figure surface (same as primary particles).
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.targetX = p.homeX;
        p.targetY = p.homeY;
        p.targetZ = p.homeZ;
      }
    } else if (currentBeat === 5) {
      // Breakaway logic: advance state, then set targets
      const breakaways = breakawayRef.current;
      const bCount = n - primaryCount;

      // Advance timers and orbit angles for active breakaways
      for (let i = 0; i < bCount; i++) {
        const bs = breakaways[i];
        if (bs.active) {
          bs.timer += dt;
          bs.orbitAngle += bs.orbitSpeed * dt;
          if (bs.timer >= bs.duration) {
            bs.active = false;
            bs.timer = 0;
          }
        }
      }

      // Randomly trigger a new group breakaway (roughly 1–2 times every few seconds)
      for (let i = 0; i < bCount; i++) {
        if (
          !breakaways[i].active &&
          Math.random() < (dt * 0.08) / Math.max(bCount, 1)
        ) {
          const groupSize = 3 + Math.floor(Math.random() * 6); // 3–8 particles
          for (let j = i; j < Math.min(i + groupSize, bCount); j++) {
            if (!breakaways[j].active) {
              breakaways[j].active = true;
              breakaways[j].timer = 0;
              breakaways[j].duration = 2 + Math.random() * 3;
              breakaways[j].orbitAngle = Math.random() * Math.PI * 2;
              breakaways[j].orbitRadius = 0.8 + Math.random() * 0.4;
              breakaways[j].orbitSpeed =
                (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1);
            }
          }
          break; // only one group per frame
        }
      }

      // Set targets based on breakaway state.
      // During drag, all orbit particles lock to their rotated home position so
      // the entire figure is perfectly rigid — no lagging breakaway particles.
      const isDragging5 = isDraggingApprovedRef.current;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        const bi = i - primaryCount;
        const bs = bi < breakaways.length ? breakaways[bi] : null;
        if (bs?.active && !isDragging5) {
          p.targetX = Math.cos(bs.orbitAngle) * bs.orbitRadius;
          p.targetY = Math.sin(bs.orbitAngle * 0.3) * 0.4;
          p.targetZ = Math.sin(bs.orbitAngle) * bs.orbitRadius;
        } else {
          // Non-active OR dragging: quaternion delta rotates home → current pose.
          // Subtract pivot before rotating and add back after so the figure
          // rotates around its centroid (posOffset), not the world origin.
          _beat5Vec.set(
            p.homeX - beat5PivotX,
            p.homeY - beat5PivotY,
            p.homeZ - beat5PivotZ,
          );
          _beat5Vec.applyQuaternion(_beat5QuatDelta);
          p.targetX = _beat5Vec.x + beat5PivotX;
          p.targetY = _beat5Vec.y + beat5PivotY;
          p.targetZ = _beat5Vec.z + beat5PivotZ;
        }
      }
    } else {
      // Beats 2/3: use spatially-matched cube targets so orbit particles also
      // stay local during transitions (same sorted targets as primary particles).
      const shapeT =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        const o = i * 3;
        if (o + 2 < shapeT.length) {
          p.targetX = shapeT[o];
          p.targetY = shapeT[o + 1];
          p.targetZ = shapeT[o + 2];
        }
      }
    }

    // ── Beat-specific simulation ──────────────────────────────────────────

    if (currentBeat === 2) {
      // ── Beat 2: rotating geometric shape + jitter + orbiting particles ───

      if (beat2StartTimeRef.current < 0) beat2StartTimeRef.current = elapsed;
      const beat2Elapsed = elapsed - beat2StartTimeRef.current;
      const beat2Progress = Math.min(
        1,
        beat2Elapsed / Math.max(beatDurationRef.current, 1),
      );

      const rotYSpeed2 = 0.00225 * dt * 60;
      const rotXSpeed2 = 0.00075 * dt * 60;

      if (beat2Progress > 0.75) {
        // Final 25%: reduce speed by up to 50% so Beat 3 starts from a predictable angle
        const settleT2 = (beat2Progress - 0.75) / 0.25;
        const settleSmooth2 = settleT2 * settleT2 * (3 - 2 * settleT2);
        shapeRotationRef.current += rotYSpeed2 * (1 - settleSmooth2 * 0.5);
        shapeRotationXRef.current += rotXSpeed2 * (1 - settleSmooth2 * 0.5);
      } else {
        shapeRotationRef.current += rotYSpeed2;
        shapeRotationXRef.current += rotXSpeed2;
      }

      const cosY = Math.cos(shapeRotationRef.current);
      const sinY = Math.sin(shapeRotationRef.current);
      const cosX = Math.cos(shapeRotationXRef.current);
      const sinX = Math.sin(shapeRotationXRef.current);

      // Use spatially-matched cube targets so Beat 2→3→4 transitions stay local
      const origTargets =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;
      const tOscShape = elapsed * 0.8;
      const shapeJitter = 0.012;
      for (let i = 0; i < primaryCount; i++) {
        const o = i * 3;
        const baseX = origTargets[o];
        const baseY = origTargets[o + 1];
        const baseZ = origTargets[o + 2];
        const phase = i * 0.37;
        const rx = cosY * baseX - sinY * baseZ;
        const ry = baseY;
        const rz = sinY * baseX + cosY * baseZ;
        const finalX = rx;
        const finalY = cosX * ry - sinX * rz;
        const finalZ = sinX * ry + cosX * rz;
        particles[i].targetX =
          finalX + Math.sin(tOscShape + phase) * shapeJitter;
        particles[i].targetY =
          finalY + Math.cos(tOscShape * 0.7 + phase) * shapeJitter;
        particles[i].targetZ =
          finalZ + Math.sin(tOscShape * 1.1 + phase * 1.3) * shapeJitter;
      }

      // Only orbit particles use boid flocking in Beat 2 — primary particles use
      // deterministic swirl forces instead, preventing the "gnats" chaotic feeling.
      stepBoids(
        orbitParticlesRef.current as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // ── Inward spiral toward cube positions ───────────────────────────────
      // Combines tangential rotation around Y, radial pull toward target radius,
      // and gentle Y pull — particles gracefully drain into cube positions rather
      // than bursting chaotically.
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const i3 = i * 3;

        // Target cube position (spatially matched, pre-rotation)
        const tcx = sortedCubeTargetsRef.current[i3];
        const tcy = sortedCubeTargetsRef.current[i3 + 1];
        const tcz = sortedCubeTargetsRef.current[i3 + 2];

        // Current XZ distance from Y axis
        const px = p.x,
          pz = p.z;
        const r = Math.sqrt(px * px + pz * pz) + 0.0001;

        // 1. Tangential rotation force (around Y axis, counter-clockwise from above)
        const swirlStrength = 0.0006;
        const tx = -pz / r;
        const tz = px / r;
        p.vx += tx * swirlStrength;
        p.vz += tz * swirlStrength;

        // 2. Inward radial force — pulls particles toward target XZ radius
        const targetR = Math.sqrt(tcx * tcx + tcz * tcz) + 0.0001;
        const radialPull = (targetR - r) * 0.003;
        p.vx += (px / r) * radialPull;
        p.vz += (pz / r) * radialPull;

        // 3. Y-axis pull toward target height (slow, gentle)
        const yPull = (tcy - p.y) * 0.008;
        p.vy += yPull;

        // 4. Speed cap — keep motion deliberate
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        const speedLimit = 0.001;
        if (spd > speedLimit) {
          p.vx *= speedLimit / spd;
          p.vy *= speedLimit / spd;
          p.vz *= speedLimit / spd;
        }
      }

      // Smooth damped lerp toward rotated cube target — uses p.targetX/Y/Z which
      // already have the rotation matrix applied (computed in the loop above).
      // Ramp from Beat 1's approximate effective alpha (~0.009/frame at default
      // beatDuration=8) up to Beat 2's steady-state rate over 5 s so there is no
      // sudden speed burst when transitioning from Swirl In to Form.
      const LERP_RATE_BEAT1_APPROX = 0.0063;
      const LERP_RATE_BEAT2_TARGET = 0.0175;
      const beat2Warmup = Math.min(1, beat2Elapsed / 5.0);
      const lerpRate2 = lerp(
        LERP_RATE_BEAT1_APPROX,
        LERP_RATE_BEAT2_TARGET,
        beat2Warmup * beat2Warmup,
      );
      // Ramp velocity damping from Beat 1's 0.45 to Beat 2's 0.85 over 5 s.
      // Without this ramp the sudden jump in damping coefficient creates a subtle
      // change in momentum character on frame 1, contributing to the perceived
      // acceleration at Form entry.
      const BEAT1_VEL_DAMP = 0.45;
      const BEAT2_VEL_DAMP_STEADY = 0.85;
      const velDamp2 = lerp(BEAT1_VEL_DAMP, BEAT2_VEL_DAMP_STEADY, beat2Warmup);
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * lerpRate2;
        p.y += (p.targetY - p.y) * lerpRate2;
        p.z += (p.targetZ - p.z) * lerpRate2;
        p.vx *= velDamp2;
        p.vy *= velDamp2;
        p.vz *= velDamp2;
      }

      // Center-repulsion: keeps particles from passing through the cube center.
      const minR2 = 0.5;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        if (dist < minR2 && dist > 0.001) {
          const push = (minR2 - dist) * 0.02;
          p.vx += (p.x / dist) * push;
          p.vy += (p.y / dist) * push;
          p.vz += (p.z / dist) * push;
        }
      }

      const orbitAlpha2 = (1 - Math.exp(-0.3 * dt)) * 0.05;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * orbitAlpha2;
        p.y += (p.targetY - p.y) * orbitAlpha2;
        p.z += (p.targetZ - p.z) * orbitAlpha2;
      }
    } else if (currentBeat === 3) {
      // ---- HINT BEAT (Beat 3) ----
      // Shape: slow breathing morph cube→sphere→elongated→cube
      // Rotation: continuous, guided toward clean angle in final 25%
      // Swarm: tightening orbit
      // Handoff: returnToSquare blends back to cube before Beat 4

      if (beat3StartTimeRef.current < 0) beat3StartTimeRef.current = elapsed;
      const beat3Elapsed = elapsed - beat3StartTimeRef.current;
      hintPhaseRef.current = beat3Elapsed;

      const beat3Progress = Math.min(
        1,
        beat3Elapsed / Math.max(beatDurationRef.current, 1),
      );

      // Shape breathing: very slow dreamy morph cycle; speed controlled by hintMeltSpeed slider.
      // 0.08 → one full oscillation ≈ 12.5 s at default hintMeltSpeed=1.0.
      // A 300ms delay syncs the morph start with the text fade-in in AppV2
      // ("Every business has its own shape" appears after a 300ms cross-fade).
      const breatheSpeed = 0.08 * hintMeltSpeedRef.current;
      const MORPH_DELAY = 0.3;
      const morphElapsed = Math.max(0, beat3Elapsed - MORPH_DELAY);
      const morphPhase = morphElapsed * breatheSpeed;
      // In the final 45%, steer targets back to cube so Beat 4 starts clean.
      // Finishes at 85% so the last 15% is fully at cube — clean handoff to Beat 4.
      const RETURN_START = 0.55;
      const RETURN_END = 0.85;
      const returnToSquare =
        beat3Progress > RETURN_START
          ? smoothstep(
              Math.min(
                1,
                (beat3Progress - RETURN_START) / (RETURN_END - RETURN_START),
              ),
            )
          : 0;

      const rotYSpeed3 = 0.00225 * dt * 60;
      const rotXSpeed3 = 0.00075 * dt * 60;

      // Decelerate rotation over the second half of Beat 3 (50%→100%), ramping
      // speed from 1→0 so the cube arrives at Beat 4 already stationary with no
      // visible snap or steering nudge.
      const BEAT3_DECEL_START = 0.5;
      const rotDeltaScale =
        beat3Progress >= BEAT3_DECEL_START
          ? 1 - (beat3Progress - BEAT3_DECEL_START) / (1 - BEAT3_DECEL_START)
          : 1;
      shapeRotationRef.current += rotYSpeed3 * rotDeltaScale;
      shapeRotationXRef.current += rotXSpeed3 * rotDeltaScale;
      const cosY3 = Math.cos(shapeRotationRef.current);
      const sinY3 = Math.sin(shapeRotationRef.current);
      const cosX3 = Math.cos(shapeRotationXRef.current);
      const sinX3 = Math.sin(shapeRotationXRef.current);

      const sortedTargets3 =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;

      for (let i = 0; i < primaryCount; i++) {
        const i3 = i * 3;
        const p = particles[i];

        const baseX = sortedTargets3[i3];
        const baseY = sortedTargets3[i3 + 1];
        const baseZ = sortedTargets3[i3 + 2];

        // Breathing morph: cycle cube→sphere→cube; blend back to cube in final 25%.
        // With the cosine formula, morphPhase=0 maps to t=0 (pure cube) — no phase
        // offset is needed. (A stale +0.75 offset was previously present here; it
        // was correct for a sin-based formula but caused the morph to start at
        // t=0.5 with cos, creating a shape jump on Beat 3 entry.)
        const [morphTargX, morphTargY, morphTargZ] = morphCubeTarget(
          baseX,
          baseY,
          baseZ,
          morphPhase,
        );
        const preMorphX = lerp(morphTargX, baseX, returnToSquare);
        const preMorphY = lerp(morphTargY, baseY, returnToSquare);
        const preMorphZ = lerp(morphTargZ, baseZ, returnToSquare);

        // Rotate morphed target to current cube spin angle
        const rx3 = cosY3 * preMorphX - sinY3 * preMorphZ;
        const ry3 = preMorphY;
        const rz3 = sinY3 * preMorphX + cosY3 * preMorphZ;
        const finalX3 = rx3;
        const finalY3 = cosX3 * ry3 - sinX3 * rz3;
        const finalZ3 = sinX3 * ry3 + cosX3 * rz3;

        // Smooth damped lerp toward morphed target — no spring overshoot.
        // Ramp from Beat 2's lerp rate (0.0175) to Beat 3's target rate (0.03)
        // over the first 2 seconds so there is no speed surge on entry.
        const LERP_RATE_END_2 = 0.025;
        const LERP_RATE_TARGET_3 = 0.03;
        const beat3Warmup = Math.min(1, beat3Elapsed / 2.0);
        const lerpRate3 = lerp(
          LERP_RATE_END_2,
          LERP_RATE_TARGET_3,
          beat3Warmup,
        );
        p.x += (finalX3 - p.x) * lerpRate3;
        p.y += (finalY3 - p.y) * lerpRate3;
        p.z += (finalZ3 - p.z) * lerpRate3;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.vz *= 0.85;
      }

      // Swarm particles: gradually tighten orbit radius as the shape clarifies.
      // Interpolate target scale from 1.0 → 0.6 over the full beat duration,
      // giving the feeling of being drawn inward toward the forming shape.
      const orbitTighten3 = Math.min(
        beat3Elapsed / Math.max(beatDurationRef.current, 1),
        1,
      );
      const orbitRadiusScale3 = 1.0 - orbitTighten3 * 0.4;
      const orbitAlpha3 = (1 - Math.exp(-0.3 * dt)) * 0.05;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.x += (p.targetX * orbitRadiusScale3 - p.x) * orbitAlpha3;
        p.y += (p.targetY * orbitRadiusScale3 - p.y) * orbitAlpha3;
        p.z += (p.targetZ * orbitRadiusScale3 - p.z) * orbitAlpha3;
      }
    } else if (currentBeat === 4) {
      // ── Beat 4: Ripple wave reveal — cube permanently deforms into figure ─
      //
      // The same wave mechanism as Beat 3 but monotonically advancing:
      // the wave radiates from the figure's top and particles permanently
      // solidify at their home positions as the wave passes them.
      // Particles behind the wave front stay at homeX/Y/Z (solidified).
      // Particles ahead of the wave remain at their spatially-matched cube target.
      // revealStages maps wave progress to debris scatter trigger points.

      if (beat4StartTimeRef.current < 0) beat4StartTimeRef.current = elapsed;

      // Y-plane sweep: waveRadiusBeat4Ref holds the current sweep Y position.
      // It starts just above maxHomeY and decreases to minHomeY, revealing
      // particles top-first like a curtain dropping from the top of the figure.
      const waveYRange4 = Math.max(
        waveMaxYRef.current - waveMinYRef.current,
        0.1,
      );
      const waveRate4 =
        (waveYRange4 * waveSpeedRef.current * 0.85) /
        Math.max(beatDurationRef.current, 1);
      waveRadiusBeat4Ref.current -= waveRate4 * dt;
      const waveY4 = waveRadiusBeat4Ref.current;
      // Blend zone in Y units — 38% of total height for a wide, slow-melt feel
      const waveWidthY4 = waveYRange4 * 0.38;

      const sortedTargets4 =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;

      const numStages4 = revealStagesRef.current;
      // Wave progress 0→1 as sweep moves from maxHomeY down to minHomeY
      const waveProgress4 = Math.max(
        0,
        (waveMaxYRef.current - waveY4) / waveYRange4,
      );
      const currentStage4 = Math.min(
        Math.floor(waveProgress4 * numStages4),
        numStages4 - 1,
      );
      revealStageRef.current = currentStage4;

      if (currentStage4 !== lastRevealStageRef.current) {
        lastRevealStageRef.current = currentStage4;
        applyDebrisScatter(
          particles,
          primaryCount,
          regionIndexRef.current,
          currentStage4,
          n,
        );
      }

      const beat4Elapsed = elapsed - beat4StartTimeRef.current;

      // The cube is held at the rotation angle captured at Beat 4 entry so it
      // starts exactly where Hint left off — no flip at the beat boundary.
      const cosY4 = Math.cos(beat4EntryRotYRef.current);
      const sinY4 = Math.sin(beat4EntryRotYRef.current);
      const cosX4 = Math.cos(beat4EntryRotXRef.current);
      const sinX4 = Math.sin(beat4EntryRotXRef.current);

      const figJitter4 = 0.006;
      const tOscFig4 = elapsed * 0.5;

      for (let i = 0; i < primaryCount; i++) {
        const o = i * 3;
        const p = particles[i];
        const phase = i * 0.37;

        if (p.y - waveY4 >= waveWidthY4) {
          // Solidified: above wave front (high visual Y), permanently at figure surface
          p.targetX = p.homeX + Math.sin(tOscFig4 + phase) * figJitter4;
          p.targetY = p.homeY + Math.cos(tOscFig4 * 0.7 + phase) * figJitter4;
          p.targetZ =
            p.homeZ + Math.sin(tOscFig4 * 1.1 + phase * 1.3) * figJitter4;
        } else {
          // Wave front or not yet reached: lerp between rotated cube target and home.
          // Apply the Beat 4 entry rotation so the cube starts at the same angle
          // as the end of Hint — prevents the flip caused by jumping from
          // rotation(accumulated_angle)*cubePos to unrotated cubePos on frame 1.
          const baseX4 = sortedTargets4[o];
          const baseY4 = sortedTargets4[o + 1];
          const baseZ4 = sortedTargets4[o + 2];
          const rx4 = cosY4 * baseX4 - sinY4 * baseZ4;
          const ry4 = baseY4;
          const rz4 = sinY4 * baseX4 + cosY4 * baseZ4;
          const cubeX4 = rx4;
          const cubeY4 = cosX4 * ry4 - sinX4 * rz4;
          const cubeZ4 = sinX4 * ry4 + cosX4 * rz4;

          // waveEdgeY4 > 0 means particle is above the wave sweep plane (visually higher)
          const waveEdgeY4 = p.y - waveY4;
          const t4Raw = Math.max(0, Math.min(1, waveEdgeY4 / waveWidthY4));
          // Double smoothstep: smoothstep(smoothstep(t)) for very gentle ease
          const sm1 = t4Raw * t4Raw * (3 - 2 * t4Raw);
          const t4 = sm1 * sm1 * (3 - 2 * sm1);
          p.targetX = cubeX4 * (1 - t4) + p.homeX * t4;
          p.targetY = cubeY4 * (1 - t4) + p.homeY * t4;
          p.targetZ = cubeZ4 * (1 - t4) + p.homeZ * t4;
        }
      }

      // Only orbit particles use boid flocking in Beat 4 — primary particles must
      // stay locked to the rotating cube target until the wave releases them.
      // Passing all particles to stepBoids causes the boid home-spring to pull
      // primary particles toward homeX/Y/Z (the figure), deforming the cube before
      // the wave arrives. This matches the Beat 2 pattern exactly.
      stepBoids(
        orbitParticlesRef.current as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // Constant lerp rate matching Beat 3's final rate — no warmup ramp needed
      // since particles stay locked to their cube positions (not traveling to new
      // targets) until the wave reaches them, so there is no deceleration jerk.
      const lerpRate4 = 0.03;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * lerpRate4;
        p.y += (p.targetY - p.y) * lerpRate4;
        p.z += (p.targetZ - p.z) * lerpRate4;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.vz *= 0.85;
      }

      // Gentle center-repulsion: prevents particles from cutting through the figure center
      const minR4 = 0.5;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        if (dist < minR4 && dist > 0.001) {
          const push = (minR4 - dist) * 0.02;
          p.vx += (p.x / dist) * push;
          p.vy += (p.y / dist) * push;
          p.vz += (p.z / dist) * push;
        }
      }

      // In the second half of Beat 4, blend orbit alpha toward Beat 5's rate so
      // orbit particles pre-drift close to their home positions before Beat 5 begins —
      // no rush or lurch when Beat 5 starts. Both beats share the same target (homeX/Y/Z).
      const beat4TimeProgress = Math.min(
        1,
        beat4Elapsed / Math.max(beatDurationRef.current, 1),
      );
      const orbitAlphaBase4 = (1 - Math.exp(-0.3 * dt)) * 0.05; // Beat 4 slow rate
      let orbitAlpha4 = orbitAlphaBase4;
      if (beat4TimeProgress > 0.5) {
        const blendT = (beat4TimeProgress - 0.5) / 0.5; // 0→1 in second half
        const blendSmooth = blendT * blendT; // ease in — accelerates gently
        // Beat 5's orbit alpha (getLerpSpeedForBeat(5)=1.2, lerpWeight=1, beatTransition=1)
        const orbitAlphaBeat5 = 1 - Math.exp(-1.2 * dt);
        orbitAlpha4 = lerp(orbitAlphaBase4, orbitAlphaBeat5, blendSmooth);
      }
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * orbitAlpha4;
        p.y += (p.targetY - p.y) * orbitAlpha4;
        p.z += (p.targetZ - p.z) * orbitAlpha4;
      }
    } else {
      // ── Beats 0, 1, 5 ────────────────────────────────────────────────────

      if (currentBeat === 5) {
        // Beat 5: lerp primary toward home with per-mode surface motion
        const motion = surfaceMotionRef.current;
        if (motion === "shimmer") {
          // Decay all per-particle shimmer offsets (half-life ~0.23 s at decay rate 3)
          const shimmerOffs = shimmerOffsetRef.current;
          const shimmerDecay = Math.exp(-3 * dt);
          for (let i = 0; i < primaryCount; i++) {
            shimmerOffs[i] *= shimmerDecay;
          }
          // Kick ~2% of surface particles to a random outward pop each frame
          const kickCount = Math.max(1, Math.ceil(primaryCount * 0.02));
          for (let k = 0; k < kickCount; k++) {
            const ri = Math.floor(Math.random() * primaryCount);
            shimmerOffs[ri] = 0.03 + Math.random() * 0.05;
          }
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            _beat5Vec.set(
              p.homeX - beat5PivotX,
              p.homeY - beat5PivotY,
              p.homeZ - beat5PivotZ,
            );
            _beat5Vec.applyQuaternion(_beat5QuatDelta);
            const rhX = _beat5Vec.x;
            const rhY = _beat5Vec.y;
            const rhZ = _beat5Vec.z;
            const homeLen = Math.sqrt(rhX * rhX + rhY * rhY + rhZ * rhZ);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              const off = shimmerOffs[i];
              p.targetX = rhX + rhX * invLen * off + beat5PivotX;
              p.targetY = rhY + rhY * invLen * off + beat5PivotY;
              p.targetZ = rhZ + rhZ * invLen * off + beat5PivotZ;
            } else {
              p.targetX = rhX + beat5PivotX;
              p.targetY = rhY + beat5PivotY;
              p.targetZ = rhZ + beat5PivotZ;
            }
          }
        } else if (motion === "breathe") {
          // All surface particles pulse outward and back together (sinusoidal, synchronized)
          const breatheOffset = Math.sin(elapsed * 0.8) * 0.04;
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            _beat5Vec.set(
              p.homeX - beat5PivotX,
              p.homeY - beat5PivotY,
              p.homeZ - beat5PivotZ,
            );
            _beat5Vec.applyQuaternion(_beat5QuatDelta);
            const rhX = _beat5Vec.x;
            const rhY = _beat5Vec.y;
            const rhZ = _beat5Vec.z;
            const homeLen = Math.sqrt(rhX * rhX + rhY * rhY + rhZ * rhZ);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              p.targetX = rhX + rhX * invLen * breatheOffset + beat5PivotX;
              p.targetY = rhY + rhY * invLen * breatheOffset + beat5PivotY;
              p.targetZ = rhZ + rhZ * invLen * breatheOffset + beat5PivotZ;
            } else {
              p.targetX = rhX + beat5PivotX;
              p.targetY = rhY + beat5PivotY;
              p.targetZ = rhZ + beat5PivotZ;
            }
          }
        } else if (motion === "flow") {
          // Each particle has its own independent per-particle noise phase offset
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            _beat5Vec.set(
              p.homeX - beat5PivotX,
              p.homeY - beat5PivotY,
              p.homeZ - beat5PivotZ,
            );
            _beat5Vec.applyQuaternion(_beat5QuatDelta);
            const rhX = _beat5Vec.x;
            const rhY = _beat5Vec.y;
            const rhZ = _beat5Vec.z;
            const homeLen = Math.sqrt(rhX * rhX + rhY * rhY + rhZ * rhZ);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              const flowOffset = Math.sin(elapsed * 0.6 + i * 0.37) * 0.025;
              p.targetX = rhX + rhX * invLen * flowOffset + beat5PivotX;
              p.targetY = rhY + rhY * invLen * flowOffset + beat5PivotY;
              p.targetZ = rhZ + rhZ * invLen * flowOffset + beat5PivotZ;
            } else {
              p.targetX = rhX + beat5PivotX;
              p.targetY = rhY + beat5PivotY;
              p.targetZ = rhZ + beat5PivotZ;
            }
          }
        } else {
          // still mode: particles rest exactly on the quaternion-rotated surface.
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            _beat5Vec.set(
              p.homeX - beat5PivotX,
              p.homeY - beat5PivotY,
              p.homeZ - beat5PivotZ,
            );
            _beat5Vec.applyQuaternion(_beat5QuatDelta);
            p.targetX = _beat5Vec.x + beat5PivotX;
            p.targetY = _beat5Vec.y + beat5PivotY;
            p.targetZ = _beat5Vec.z + beat5PivotZ;
          }
        }

        // Snap particles directly to their rotated surface targets so the figure
        // is fully rigid during drag rotation with zero deformation lag. Velocity
        // is zeroed to prevent any residual drift from disrupting the rigid lock.
        for (let i = 0; i < primaryCount; i++) {
          const p = particles[i];
          p.x = p.targetX;
          p.y = p.targetY;
          p.z = p.targetZ;
          p.vx = 0;
          p.vy = 0;
          p.vz = 0;
        }

        // ── Depth sizing: scale p.size per surface particle based on camera angle ──
        const ds = depthSizingRef.current;
        if (ds === "flat") {
          for (let i = 0; i < primaryCount; i++) particles[i].size = 1;
        } else {
          const camPos = state.camera.position;
          const camLen = Math.sqrt(
            camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z,
          );
          const iCam = camLen > 1e-8 ? 1 / camLen : 1;
          const cdX = camPos.x * iCam;
          const cdY = camPos.y * iCam;
          const cdZ = camPos.z * iCam;

          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            const hLen = Math.sqrt(
              p.homeX * p.homeX + p.homeY * p.homeY + p.homeZ * p.homeZ,
            );
            const iH = hLen > 1e-8 ? 1 / hLen : 1;
            const dot =
              p.homeX * iH * cdX + p.homeY * iH * cdY + p.homeZ * iH * cdZ;

            if (ds === "depth") {
              // front-facing → larger (1.5×), back-facing → smaller (0.5×)
              p.size = 1.0 + dot * 0.5;
            } else {
              // rim: silhouette edge (dot ≈ 0) → largest (1.5×), poles → smallest (0.5×)
              p.size = 1.5 - Math.abs(dot);
            }
          }
        }
      } else if (currentBeat === 1) {
        if (beat1StartTimeRef.current < 0) beat1StartTimeRef.current = elapsed;
        const beat1Elapsed = elapsed - beat1StartTimeRef.current;
        const beat1Progress = Math.min(
          1,
          beat1Elapsed / Math.max(beatDurationRef.current, 1),
        );

        // Cube rotation in Swirl In — same constant speed as Beat 2 and Beat 3
        shapeRotationRef.current += 0.00225 * dt * 60;
        shapeRotationXRef.current += 0.00075 * dt * 60;

        // Beat 1: lerp primary particles toward the halfway point (50% ring, 50% shape).
        // Scale speed so the lerp reaches ~99% in beatDuration seconds.
        // beatTransitionRef ramps from 0→1 so at beat entry particles continue their
        // boid-driven momentum from Beat 0 rather than snapping to the lerp target.
        const lerpSpeed1 = 4.6 / Math.max(beatDurationRef.current, 1);
        const alpha1 =
          (1 - Math.exp(-lerpSpeed1 * dt)) *
          lerpWeightRef.current *
          beatTransitionRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const p = particles[i];
          p.x += (p.targetX - p.x) * alpha1;
          p.y += (p.targetY - p.y) * alpha1;
          p.z += (p.targetZ - p.z) * alpha1;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
        }

        // In the last 70% of Beat 1, gently pull particles toward their pre-assigned
        // cube targets so they're already 30–40% of the way there when Beat 2 starts.
        // The pull starts at 0 and ease-in increases to cubeLerpRate=0.012 at beat end.
        //
        // IMPORTANT: apply the same Y+X rotation that Beat 2 uses so the direction of
        // pull is already aligned with Beat 2's rotated targets. Without this, Beat 1
        // pulls toward the raw unrotated cube face (e.g. +X) while Beat 2 immediately
        // targets the rotated face (e.g. +X rotated 62° over 8 s) — the sudden
        // direction change is the primary cause of the visible acceleration at Beat 2 entry.
        if (
          beat1Progress > 0.3 &&
          sortedCubeTargetsRef.current.length >= primaryCount * 3
        ) {
          const pullT = (beat1Progress - 0.3) / 0.7; // 0→1 over last 70% of beat
          const pullSmooth = pullT * pullT; // ease in
          const cubeLerpRate = pullSmooth * 0.012;

          // Precompute rotation matrices once outside the per-particle loop
          const cosYPull = Math.cos(shapeRotationRef.current);
          const sinYPull = Math.sin(shapeRotationRef.current);
          const cosXPull = Math.cos(shapeRotationXRef.current);
          const sinXPull = Math.sin(shapeRotationXRef.current);

          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            const i3 = i * 3;
            const baseX1 = sortedCubeTargetsRef.current[i3];
            const baseY1 = sortedCubeTargetsRef.current[i3 + 1];
            const baseZ1 = sortedCubeTargetsRef.current[i3 + 2];
            // Apply same Y-axis then X-axis rotation that Beat 2 uses each frame
            const rx1 = cosYPull * baseX1 - sinYPull * baseZ1;
            const ry1 = baseY1;
            const rz1 = sinYPull * baseX1 + cosYPull * baseZ1;
            const cubeTargX = rx1;
            const cubeTargY = cosXPull * ry1 - sinXPull * rz1;
            const cubeTargZ = sinXPull * ry1 + cosXPull * rz1;

            p.x += (cubeTargX - p.x) * cubeLerpRate;
            p.y += (cubeTargY - p.y) * cubeLerpRate;
            p.z += (cubeTargZ - p.z) * cubeLerpRate;
          }
        }
      } else {
        // Beat 0: swirl boid on primary particles with ring-maintaining nudge
        const boidParams = getBoidParamsForBeat(
          currentBeat,
          swirlStrengthRef.current,
        );
        stepBoids(
          primaryParticlesRef.current as unknown as IBoidParticle[],
          boidParams,
          elapsed,
        );

        const primaryParticles = primaryParticlesRef.current;
        const ringMin = 3.2;
        const ringTarget = 4.0;
        for (const p of primaryParticles) {
          const dist = Math.sqrt(p.x * p.x + p.y * p.y);
          const safeDist = Math.max(dist, 0.01);
          const dx = p.x / safeDist;
          const dy = p.y / safeDist;

          // Spring toward ring target (0.003 = 0.0042 × ~0.7, another 30% reduction for graceful drift)
          const delta = dist - ringTarget;
          const springForce = -delta * 0.003;
          p.vx += dx * springForce;
          p.vy += dy * springForce;

          // Hard clamp: never let particles inside the inner boundary
          if (dist < ringMin) {
            p.x = dx * ringMin;
            p.y = dy * ringMin;
            // Zero the inward radial velocity component
            const radialV = p.vx * dx + p.vy * dy;
            if (radialV < 0) {
              p.vx -= radialV * dx;
              p.vy -= radialV * dy;
            }
          }

          // Z-axis: weak spring toward Z=0 + gentle damping gives the ring
          // visible torus thickness (~±1 unit) while keeping it centred.
          p.vz -= p.z * 0.001;
          p.vz *= 0.97;
        }
      }

      // Orbit boid step runs for ALL non-shape beats (0, 1, 5)
      stepBoids(
        orbitParticlesRef.current as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // Lerp orbit particles toward their targets.
      // Beat 5: surface-sitting particles use the same tight alpha as primaries
      // so they settle firmly on the mesh; actively orbiting particles use the
      // slower gentle alpha for smooth orbital motion.
      const orbitAlphaElse = (1 - Math.exp(-0.3 * dt)) * 0.05;
      if (currentBeat === 5) {
        // Beat 5 orbit particles: ALL snap directly, no lerp, fully rigid
        for (let i = primaryCount; i < n; i++) {
          const p = particles[i];
          p.x = p.targetX;
          p.y = p.targetY;
          p.z = p.targetZ;
          p.vx = 0;
          p.vy = 0;
          p.vz = 0;
        }
      } else {
        for (let i = primaryCount; i < n; i++) {
          const p = particles[i];
          p.x += (p.targetX - p.x) * orbitAlphaElse;
          p.y += (p.targetY - p.y) * orbitAlphaElse;
          p.z += (p.targetZ - p.z) * orbitAlphaElse;
        }
      }
    }

    // ── Camera lerp toward per-beat target ───────────────────────────────

    if (!orbitEnabledRef.current) {
      if (debugCameraRef.current) {
        const { x, y, z, lookAtY } = debugCameraRef.current;
        state.camera.position.set(x, y, z);
        state.camera.lookAt(0, lookAtY, 0);
        state.camera.updateMatrixWorld();
      } else {
        const [tx, ty, tz] = CAMERA_POSITIONS[currentBeat];
        camTargetRef.current.set(tx, ty, tz);
        state.camera.position.lerp(camTargetRef.current, 0.008);
        // Beat 0: look straight at the ring center (Y=0); other beats: slight upward offset
        state.camera.lookAt(0, currentBeat === 0 ? 0 : 0.2, 0);
      }
    }

    // ── Debug mesh rotation (figure mesh only — particles stay unrotated) ────

    if (figureGroupRef.current) {
      const rot = debugMeshRotationRef.current ?? {
        x: -1.59,
        y: 0.01,
        z: -0.19,
      };
      // In Beat 5, add the approved spin/tilt offsets so the skin mesh co-rotates
      // with the swarm particle cloud.
      const addRotY = currentBeat === 5 ? approvedRotYRef.current : 0;
      figureGroupRef.current.rotation.set(rot.x, rot.y + addRotY, rot.z);
      figureGroupRef.current.scale.setScalar(figureScaleRef.current ?? 1.0);
      // Shift the skin mesh group by the negative centroid so it aligns with
      // the centroid-adjusted swarm particle cloud (homeX/Y/Z are centered at
      // origin; raw mesh positions are not).
      const off = figureOffsetRef.current;
      figureGroupRef.current.position.set(off.x, off.y, off.z);
    }

    // ── Compute centroid for proximity shader ─────────────────────────────
    // Mutate the existing object in place so SkinParticleSystem.useFrame —
    // which closed over the same object reference at render time — always reads
    // the current frame's centroid without waiting for the next React re-render.

    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < n; i++) {
      cx += particles[i].x;
      cy += particles[i].y;
      cz += particles[i].z;
    }
    skinCentroidRef.current.x = cx / n;
    skinCentroidRef.current.y = cy / n;
    skinCentroidRef.current.z = cz / n;

    // ── Beat progress callback ────────────────────────────────────────────

    const progressCb = onBeatProgressRef.current;
    if (progressCb) {
      if (
        currentBeat !== prevBeatForProgressRef.current ||
        beatProgressStartTimeRef.current < 0
      ) {
        beatProgressStartTimeRef.current = elapsed;
        prevBeatForProgressRef.current = currentBeat;
      }
      const durationSec = beatDurationRef.current;
      const progress = Math.min(
        (elapsed - beatProgressStartTimeRef.current) / durationSec,
        1,
      );
      progressCb(progress);
    }
  });

  // ── Derived skin state ────────────────────────────────────────────────────

  const proximityMode = beat >= 4;
  const skinOpacity = useMemo(() => {
    if (beat <= 3) return 0;
    if (beat === 4) return 0.3;
    return 0.3; // approved
  }, [beat]);

  // Opacity is controlled solely by the user's `opacity` prop, `depthOpacityMode`,
  // and `depthSizing` — no per-beat hard-coded overrides.

  const depthOpacityStrength = useMemo(() => {
    switch (depthOpacityMode) {
      case "subtle":
        return 0.45;
      case "strong":
        return 0.82;
      default:
        return 0;
    }
  }, [depthOpacityMode]);

  // Use state-driven values for render gating so React re-renders after model load
  const particles = particlesRef.current;

  return (
    <>
      <color attach="background" args={["#0a0a0f"]} />

      <OrbitControls
        ref={orbitControlsRef}
        enabled={orbitEnabled}
        enablePan={false}
        enableZoom={true}
        enableRotate={beat !== 5}
      />

      <ambientLight intensity={0.4} />
      <directionalLight intensity={2.0} position={[3, 5, 3]} />
      <directionalLight intensity={1.5} position={[-4, -3, -3]} />

      {/* Figure mesh in its own group so debugMeshRotation only rotates the figure. */}
      <group ref={figureGroupRef}>
        {skinGeometry !== null && skinOpacity > 0 && (
          <SkinParticleSystem
            key={skinGeometry.uuid}
            contourDensity={0.65}
            depthFade={0.15}
            geometry={skinGeometry}
            isDarkMode
            normalShading={0}
            particleCount={Math.min(skinParticleCount, PARTICLE_CAPACITY)}
            particleSize={particleSize * 2.5 * skinSizeMultiplierRef.current}
            proximityMode={proximityMode}
            proximityRadius={0.5}
            skinColor={color}
            skinOpacity={skinOpacity}
            swarmCentroid={skinCentroidRef.current}
          />
        )}
      </group>

      {/* Particles in an unrotated group — their XY-plane ring must not be tilted. */}
      <group ref={groupRef}>
        {particleCount_ready > 0 && (
          <ParticleSystemV2
            particles={particles}
            count={particleCount_ready}
            particleSize={particleSize * swarmSizeMultiplier}
            color={color}
            opacity={opacity}
            depthOpacityStrength={depthOpacityStrength}
          />
        )}
      </group>
    </>
  );
}

export type { IParticleV2 };
