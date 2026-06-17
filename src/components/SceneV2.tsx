import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { useEffect, useMemo, useRef, useState } from "react";

import { Euler, Matrix4, Vector3 } from "three";
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
  THintMotionStyle,
  TSurfaceDepthBias,
  TDepthSizing,
  TDepthOpacityMode,
  THintShape,
  THintStyle,
  THintClarity,
} from "../types";
import ParticleSystemV2 from "./ParticleSystemV2";
import SkinParticleSystem from "./SkinParticleSystem";

import type { BufferGeometry, Group } from "three";

// ── Transition constants ───────────────────────────────────────────────────────

const TRANSITION_DURATION = 0.5; // seconds

// ── Camera targets per beat ────────────────────────────────────────────────────

export const CAMERA_POSITIONS: Record<TBeat, [number, number, number]> = {
  0: [0, 0, 6], // Beat 0: facing the XY ring, looking through the donut hole
  1: [-0.8, 0.4, 4.5], // Beat 1: pulled back to give particles room to swirl in
  2: [-1.0, 0.3, 3.8], // Beat 2: medium distance, 3/4 angle for geometric shape
  3: [-1.0, 0.3, 3.6], // Beat 3: slightly closer as shape hints at figure
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

/** Cubic ease-in-out (smootherstep). */
function cubicEase(t: number): number {
  return t * t * (3 - 2 * t);
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
  /** Controls how strongly the cube morphs toward the figure contours during Beat 3. */
  hintClarity?: THintClarity;
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
  /** Controls the motion style of the cube deformation during Beat 3 (Hint). */
  hintMotionStyle?: THintMotionStyle;
  /** Multiplier on the sweep period for "searching" motion style (0.2–3.0, default 1.0). */
  hintSweepSpeed?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Applies a rotation+scale transform to all particles' homeX/Y/Z using the
 * provided raw (unrotated) mesh-space positions. Mirrors the transform that
 * figureGroupRef applies to SkinParticleSystem so swarm particle home targets
 * stay in sync with the visually-rotated figure mesh.
 *
 * After transforming, the centroid of all home positions is subtracted so the
 * figure is always centered at the world origin. This prevents a visual shift
 * when particles transition from cube targets (centered at origin) to figure
 * targets — the "center of mass" of the figure particle cloud matches the cube.
 *
 * Returns the centroid that was subtracted (in world space). The caller uses
 * this to apply an equal-and-opposite position offset to figureGroupRef so
 * the SkinParticleSystem (which renders the raw uncentered mesh positions) stays
 * visually co-located with the centroid-adjusted swarm particle cloud.
 */
function applyRotationToHomes(
  particles: IParticleV2[],
  rawPos: Float32Array,
  rotation: { x: number; y: number; z: number },
  scale: number,
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
  for (let i = 0; i < written; i++) {
    particles[i].homeX -= cx;
    particles[i].homeY -= cy;
    particles[i].homeZ -= cz;
  }
  return { x: cx, y: cy, z: cz };
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
    hintClarity = "whisper",
    hintStyle = "bulge",
    hintSpread = 0.4,
    hintShape = "blob",
    revealStages = 4,
    waveSpeed = 1.5,
    transitionDuration = 2.25,
    hintMotionStyle = "searching",
    hintSweepSpeed = 1.0,
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
  const hintClarityRef = useRef(hintClarity);
  hintClarityRef.current = hintClarity;
  const hintMotionStyleRef = useRef(hintMotionStyle);
  hintMotionStyleRef.current = hintMotionStyle;
  const hintSweepSpeedRef = useRef(hintSweepSpeed);
  hintSweepSpeedRef.current = hintSweepSpeed;
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
  /** Current wave radius for Beat 4 monotonic reveal; reset to 0 each time Beat 4 begins. */
  const waveRadiusBeat4Ref = useRef<number>(0);

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
  /** Cube rotation Y-angle at the moment Beat 4 begins — used to smoothly wind down to 0. */
  const beat4EntryRotYRef = useRef(0);
  /** Cube rotation X-angle at the moment Beat 4 begins — used to smoothly wind down to 0. */
  const beat4EntryRotXRef = useRef(0);
  /**
   * Particle positions (x/y/z) captured at the moment Beat 4 begins.
   * Used to blend targets from entry positions toward wave-based targets over
   * warmupDuration4 seconds so particles never jump (collapse through center).
   * Flat Float32Array: [x0,y0,z0, x1,y1,z1, ...] for primaryCount particles.
   */
  const beat4EntryPosRef = useRef<Float32Array>(new Float32Array(0));
  // ── Beat 2 cascade state ──────────────────────────────────────────────────

  const beat2StartTimeRef = useRef(-1);

  // ── Beat 4 multi-wave reveal state ────────────────────────────────────────

  const beat4StartTimeRef = useRef(-1);
  const wave1SetRef = useRef<Set<number>>(new Set());
  const sessionSeedRef = useRef(Math.floor(Math.random() * 1_000_000));

  // ── Marble emergence (Beats 3 & 4) ───────────────────────────────────────

  /** Per-particle region index: 0 = top (most dramatic), N-1 = bottom. */
  const regionIndexRef = useRef<Float32Array>(new Float32Array(0));
  /** Beat 3: total elapsed time since Beat 3 began (seconds). */
  const hintPhaseRef = useRef(0.0);
  /** Beat 3: clock time when Beat 3 started (for hint phase calculation). */
  const beat3StartTimeRef = useRef(-1);
  /** Beat 3: current morphFraction (0–maxMorphFraction); updated every frame for smooth Beat 4 handoff. */
  const beat3MorphFractionRef = useRef(0);
  /** Beat 3: slowly rotating attention direction used for spatial variation. */
  const beat3AttentionCentroidRef = useRef(new Vector3());
  /** Beat 3: low-pass filtered attention direction for Searching mode (prevents sudden jumps). */
  const beat3AttentionRef = useRef({ x: 0, y: 1, z: 0 });
  /** Beat 3: per-particle curvature + prominence weights (0–1); computed at beat entry. */
  const beat3ParticleWeightsRef = useRef(new Float32Array(0));
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
  const groupRef = useRef<Group | null>(null);
  /** Separate ref for the figure mesh group so debugMeshRotation only affects the figure, not particles. */
  const figureGroupRef = useRef<Group | null>(null);
  /** Ref to the OrbitControls instance — used to sync target on first orbit-enable frame. */
  const orbitControlsRef = useRef<ThreeOrbitControls | null>(null);

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

    // Wave origin = centroid of top 20% particles by homeY
    let maxY = -Infinity,
      minY = Infinity;
    for (let i = 0; i < primaryCount; i++) {
      if (particles[i].homeY > maxY) maxY = particles[i].homeY;
      if (particles[i].homeY < minY) minY = particles[i].homeY;
    }
    const threshold = minY + (maxY - minY) * 0.8;
    let cx = 0,
      cy = 0,
      cz = 0,
      cnt = 0;
    for (let i = 0; i < primaryCount; i++) {
      if (particles[i].homeY >= threshold) {
        cx += particles[i].homeX;
        cy += particles[i].homeY;
        cz += particles[i].homeZ;
        cnt++;
      }
    }
    const ox = cnt > 0 ? cx / cnt : 0;
    const oy = cnt > 0 ? cy / cnt : maxY;
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

    loadStaticModel(import.meta.env.BASE_URL + "model.stl").then((geom) => {
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
    const centroid = applyRotationToHomes(particles, rawPos, rot, figureScale);
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

    // Rebuild shape targets for beats 2/3 before setting targets so that beat 3
    // can use the proximity-matched sorted array as its baseline (no crossing).
    if (beat === 2 || beat === 3) {
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

    // Set target positions for the incoming beat.
    // Beat 3 uses sorted (proximity-matched) targets so each particle's initial
    // target aligns with its cube position — no cross-particle travel at entry.
    setTargetsForBeat(
      particles,
      beat,
      beat === 3 ? sortedCubeTargetsRef.current : cubeTargetsRef.current,
    );

    // One-time velocity dampen at beat entry: preserves momentum direction while
    // reducing magnitude for a smooth handoff without a ramp-up delay.
    // transitionDuration slider (0.5–4.0) maps to a dampening factor (0.2–0.8).
    const velocityDampenFactor =
      0.2 +
      ((Math.max(0.5, Math.min(transitionDurationRef.current, 4.0)) - 0.5) /
        3.5) *
        0.6;
    const primaryCtForDampen =
      particles.length - Math.ceil(particles.length * 0.06);
    for (let i = 0; i < primaryCtForDampen; i++) {
      particles[i].vx *= velocityDampenFactor;
      particles[i].vy *= velocityDampenFactor;
      particles[i].vz *= velocityDampenFactor;
    }

    // Reset cascade timer when entering beat 2
    if (beat === 2) {
      beat2StartTimeRef.current = -1; // initialized on first useFrame tick
    }

    // Reset Beat 3 morphing clay state and pre-compute per-particle weights
    if (beat === 3) {
      beat3StartTimeRef.current = -1;
      hintPhaseRef.current = 0;
      beat3MorphFractionRef.current = 0;

      // Pre-compute per-particle curvature + prominence weights (0–1).
      // Higher weight = more likely to drift toward figure surface during hint.
      const weightArr = new Float32Array(primaryCtForDampen);
      let minY3 = Infinity,
        maxY3 = -Infinity,
        maxXAbs3 = 0;
      for (let i = 0; i < primaryCtForDampen; i++) {
        const p = particles[i];
        if (p.homeY < minY3) minY3 = p.homeY;
        if (p.homeY > maxY3) maxY3 = p.homeY;
        const ax = Math.abs(p.homeX);
        if (ax > maxXAbs3) maxXAbs3 = ax;
      }
      const yRange3 = maxY3 - minY3 + 0.001;
      for (let i = 0; i < primaryCtForDampen; i++) {
        const p = particles[i];
        const yNorm = (p.homeY - minY3) / yRange3;
        const xNorm = Math.abs(p.homeX) / (maxXAbs3 + 0.001);
        if (yNorm > 0.8) {
          weightArr[i] = 1.0; // head / top — most dramatic
        } else if (xNorm > 0.7) {
          weightArr[i] = 0.7; // extremities (hands, arms)
        } else {
          weightArr[i] = 0.3; // flat body regions
        }
      }
      // Boost by local surface curvature: creases, face, hands peek through more
      const curvRadius2 = 0.09;
      const curvStep = Math.max(1, Math.floor(primaryCtForDampen / 40));
      for (let i = 0; i < primaryCtForDampen; i++) {
        const pi = particles[i];
        let curvSum = 0;
        let curvCnt = 0;
        for (let j = 0; j < primaryCtForDampen; j += curvStep) {
          const pj = particles[j];
          const dx = pj.homeX - pi.homeX;
          const dy = pj.homeY - pi.homeY;
          const dz = pj.homeZ - pi.homeZ;
          if (dx * dx + dy * dy + dz * dz < curvRadius2) {
            const dot =
              pi.normalX * pj.normalX +
              pi.normalY * pj.normalY +
              pi.normalZ * pj.normalZ;
            curvSum += 1 - dot;
            curvCnt++;
          }
        }
        const curvature = curvCnt > 0 ? curvSum / curvCnt : 0;
        weightArr[i] = Math.min(1.0, weightArr[i] + curvature * 0.5);
      }
      beat3ParticleWeightsRef.current = weightArr;
    }

    // Reset Beat 4 staged reveal state; reset wave radius for new reveal pass
    if (beat === 4) {
      // Snapshot Beat 3's cube rotation so Beat 4 can smoothly unwind it to 0
      // instead of jumping to the unrotated cube targets and causing a rush/collapse.
      beat4EntryRotYRef.current = shapeRotationRef.current;
      beat4EntryRotXRef.current = shapeRotationXRef.current;
      beat4StartTimeRef.current = -1; // reset; initialized on first useFrame tick
      revealStageRef.current = 0;
      lastRevealStageRef.current = -1;
      // Start the wave already covering the most dramatic region (head/top area)
      // so hint particles that were emerged near the figure don't collapse back to
      // the cube before the wave catches them.
      waveRadiusBeat4Ref.current = waveMaxDistRef.current * 0.25;
      // Capture current positions so Beat 4 targets blend from here — not from the
      // unrotated cube targets — during the warmup window. This prevents the collapse
      // (particles rushing through the center) that occurs when Beat 3's rotated cube
      // positions are suddenly replaced by Beat 4's unrotated figure targets.
      const entryPosBuf = new Float32Array(primaryCtForDampen * 3);
      for (let i = 0; i < primaryCtForDampen; i++) {
        entryPosBuf[i * 3] = particles[i].x;
        entryPosBuf[i * 3 + 1] = particles[i].y;
        entryPosBuf[i * 3 + 2] = particles[i].z;
      }
      beat4EntryPosRef.current = entryPosBuf;
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

  // ── Per-frame simulation ──────────────────────────────────────────────────

  useFrame((state, delta) => {
    const particles = particlesRef.current;
    if (particles.length === 0) return;

    const dt = Math.min(delta, 0.05); // cap for stability
    const elapsed = state.clock.elapsedTime;
    const currentBeat = beatRef.current;
    const n = particles.length;

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

      // Set targets based on breakaway state
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        const bi = i - primaryCount;
        const bs = bi < breakaways.length ? breakaways[bi] : null;
        if (bs?.active) {
          p.targetX = Math.cos(bs.orbitAngle) * bs.orbitRadius;
          p.targetY = Math.sin(bs.orbitAngle * 0.3) * 0.4;
          p.targetZ = Math.sin(bs.orbitAngle) * bs.orbitRadius;
        } else {
          p.targetX = p.homeX;
          p.targetY = p.homeY;
          p.targetZ = p.homeZ;
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

      shapeRotationRef.current += 0.001 * dt * 60;
      shapeRotationXRef.current += (0.001 / 20) * dt * 60;

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

      // Gentle deterministic swirl force around Y axis for primary particles.
      // Gives each particle a continuous rotation as it spirals toward its cube target
      // — leaves slowly spiraling down rather than gnats rushing chaotically.
      const swirl2Strength = 0.0004;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const px = p.x;
        const pz = p.z;
        const dist2d = Math.sqrt(px * px + pz * pz) + 0.001;
        const tx = -pz / dist2d;
        const tz = px / dist2d;
        p.vx += tx * swirl2Strength;
        p.vz += tz * swirl2Strength;
      }

      if (formTransitionRef.current === "cascade") {
        if (beat2StartTimeRef.current < 0) beat2StartTimeRef.current = elapsed;
        const beat2Elapsed = elapsed - beat2StartTimeRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const delay = (i / Math.max(primaryCount - 1, 1)) * 8.0;
          const effectiveElapsed = Math.max(0, beat2Elapsed - delay);
          const cascadeAlpha =
            (1 - Math.exp(-0.8 * effectiveElapsed)) *
            lerpWeightRef.current *
            beatTransitionRef.current;
          const p = particles[i];
          p.x += (p.targetX - p.x) * cascadeAlpha;
          p.y += (p.targetY - p.y) * cascadeAlpha;
          p.z += (p.targetZ - p.z) * cascadeAlpha;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
        }
      } else {
        // Lerp speed scaled for ~80% convergence by end of beat.
        // fast mode uses a 5× multiplier to preserve the relative "snap" feel.
        const baseLerp2 = 2.3 / Math.max(beatDurationRef.current, 1);
        const effectiveLerp2 = baseLerp2;
        const lerpSpeed2 =
          formTransitionRef.current === "fast"
            ? effectiveLerp2 * 5
            : effectiveLerp2;
        const shapeAlpha2 =
          (1 - Math.exp(-lerpSpeed2 * dt)) *
          lerpWeightRef.current *
          beatTransitionRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const p = particles[i];
          p.x += (p.targetX - p.x) * shapeAlpha2;
          p.y += (p.targetY - p.y) * shapeAlpha2;
          p.z += (p.targetZ - p.z) * shapeAlpha2;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
        }
      }

      // Speed cap for primary particles: much lower than orbit particles to prevent
      // the chaotic "gnats" feel — particles move gracefully toward their targets.
      const BEAT2_SPEED_LIMIT = 0.0008;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const speed2 = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        if (speed2 > BEAT2_SPEED_LIMIT) {
          const scale = BEAT2_SPEED_LIMIT / speed2;
          p.vx *= scale;
          p.vy *= scale;
          p.vz *= scale;
        }
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
      // ── Beat 3: Hint — morphing clay drift ──────────────────────────────────
      //
      // Particles continuously and slowly drift between the cube shape and the
      // figure's contours, as if being gently molded from the inside.
      // Never fully becomes the figure (capped at maxMorphFraction) and never
      // fully returns to a rigid cube — just a slow organic drift between the two.

      if (beat3StartTimeRef.current < 0) beat3StartTimeRef.current = elapsed;
      const beat3Elapsed = elapsed - beat3StartTimeRef.current;
      hintPhaseRef.current = beat3Elapsed;

      const t = beat3Elapsed;

      // Map hintClarity to maxMorphFraction: whisper=0.35, subtle=0.55, suggestive=0.70
      const clarityFraction =
        hintClarityRef.current === "suggestive"
          ? 0.7
          : hintClarityRef.current === "subtle"
            ? 0.55
            : 0.35;

      const motionStyle = hintMotionStyleRef.current;
      const sweepSpeed = hintSweepSpeedRef.current;

      // ── Motion style: compute morphFraction and attNX/Y/Z per style ─────────

      let morphFraction: number;
      let attNX: number;
      let attNY: number;
      let attNZ: number;

      if (motionStyle === "breathing") {
        // Whole mass slowly inhales/exhales — 7s cycle
        const breathPhase = Math.sin(t * ((Math.PI * 2) / 7.0));
        morphFraction = clarityFraction * (0.5 + 0.5 * breathPhase);
        // Uniform: slowly rotating attention (same gentle drift as before)
        const bAX = Math.sin(t * 0.15);
        const bAY = Math.cos(t * 0.12) * 0.5;
        const bAZ = Math.sin(t * 0.08 + 0.5);
        const bLen = Math.sqrt(bAX * bAX + bAY * bAY + bAZ * bAZ);
        attNX = bLen > 0.001 ? bAX / bLen : 0;
        attNY = bLen > 0.001 ? bAY / bLen : 1;
        attNZ = bLen > 0.001 ? bAZ / bLen : 0;
      } else if (motionStyle === "melting") {
        // Organic drift, pulled by curvature — no sharp spatial focus
        const rawMorph =
          clarityFraction *
          (0.5 +
            0.3 * Math.sin(t * 0.4) +
            0.2 * Math.sin(t * 0.7 + 1.2) +
            0.1 * Math.sin(t * 1.1 + 2.4));
        morphFraction = Math.max(0, Math.min(clarityFraction, rawMorph));
        const mAX = Math.sin(t * 0.15);
        const mAY = Math.cos(t * 0.12) * 0.5;
        const mAZ = Math.sin(t * 0.08 + 0.5);
        const mLen = Math.sqrt(mAX * mAX + mAY * mAY + mAZ * mAZ);
        attNX = mLen > 0.001 ? mAX / mLen : 0;
        attNY = mLen > 0.001 ? mAY / mLen : 1;
        attNZ = mLen > 0.001 ? mAZ / mLen : 0;
      } else {
        // "searching" — one region at a time, sweeping slowly
        const SWEEP_PERIOD = 8.0; // seconds per full sweep
        const effectiveSweepPeriod = SWEEP_PERIOD / sweepSpeed;
        const sweepAngle = (t / effectiveSweepPeriod) * Math.PI * 2;

        // Attention point sweeps around the figure: head → right shoulder → torso → left shoulder
        const sAX = Math.sin(sweepAngle) * 0.4;
        const sAY = 0.3 + Math.cos(sweepAngle * 0.7) * 0.5;
        const sAZ = Math.cos(sweepAngle * 0.5) * 0.3;
        const sLen = Math.sqrt(sAX * sAX + sAY * sAY + sAZ * sAZ);
        const targetAX = sLen > 0.001 ? sAX / sLen : 0;
        const targetAY = sLen > 0.001 ? sAY / sLen : 1;
        const targetAZ = sLen > 0.001 ? sAZ / sLen : 0;

        // Smooth the attention direction with a slow lerp to prevent sudden jumps
        const attSmoothRate = Math.min(1, dt * 0.5);
        beat3AttentionRef.current.x +=
          (targetAX - beat3AttentionRef.current.x) * attSmoothRate;
        beat3AttentionRef.current.y +=
          (targetAY - beat3AttentionRef.current.y) * attSmoothRate;
        beat3AttentionRef.current.z +=
          (targetAZ - beat3AttentionRef.current.z) * attSmoothRate;
        const attLen =
          Math.sqrt(
            beat3AttentionRef.current.x ** 2 +
              beat3AttentionRef.current.y ** 2 +
              beat3AttentionRef.current.z ** 2,
          ) + 0.001;
        attNX = beat3AttentionRef.current.x / attLen;
        attNY = beat3AttentionRef.current.y / attLen;
        attNZ = beat3AttentionRef.current.z / attLen;

        // Slow sine pulse on morphFraction so particles don't all peak simultaneously
        const pulsePhase = Math.sin(t * 0.3 + 1.0);
        morphFraction = clarityFraction * (0.7 + 0.2 * pulsePhase);
      }

      beat3MorphFractionRef.current = morphFraction;

      // Cube continues to rotate (same as Beat 2)
      shapeRotationRef.current += 0.001 * dt * 60;
      shapeRotationXRef.current += (0.001 / 20) * dt * 60;
      const cosY3 = Math.cos(shapeRotationRef.current);
      const sinY3 = Math.sin(shapeRotationRef.current);
      const cosX3 = Math.cos(shapeRotationXRef.current);
      const sinX3 = Math.sin(shapeRotationXRef.current);

      const sortedTargets3 =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;
      const tOscShape3 = elapsed * 0.8;
      const shapeJitter3 = 0.012;

      const weights3 = beat3ParticleWeightsRef.current;

      // Accumulate centroid of the most attention-aligned particles for swarm attraction
      let centX3 = 0,
        centY3 = 0,
        centZ3 = 0,
        centCnt3 = 0;

      for (let i = 0; i < primaryCount; i++) {
        const o = i * 3;
        const baseX = sortedTargets3[o];
        const baseY = sortedTargets3[o + 1];
        const baseZ = sortedTargets3[o + 2];
        const phase = i * 0.37;

        // Rotate cube target (cube keeps spinning during hint)
        const rx3 = cosY3 * baseX - sinY3 * baseZ;
        const ry3 = baseY;
        const rz3 = sinY3 * baseX + cosY3 * baseZ;
        const cubeX = rx3 + Math.sin(tOscShape3 + phase) * shapeJitter3;
        const cubeY =
          cosX3 * ry3 -
          sinX3 * rz3 +
          Math.cos(tOscShape3 * 0.7 + phase) * shapeJitter3;
        const cubeZ =
          sinX3 * ry3 +
          cosX3 * rz3 +
          Math.sin(tOscShape3 * 1.1 + phase * 1.3) * shapeJitter3;

        const p = particles[i];

        const particleWeight = i < weights3.length ? weights3[i] : 0.3;

        // How aligned is this particle's home position with the attention direction?
        const hLen = Math.sqrt(
          p.homeX * p.homeX + p.homeY * p.homeY + p.homeZ * p.homeZ,
        );
        const hNX = hLen > 0.001 ? p.homeX / hLen : 0;
        const hNY = hLen > 0.001 ? p.homeY / hLen : 0;
        const hNZ = hLen > 0.001 ? p.homeZ / hLen : 0;
        const alignment = hNX * attNX + hNY * attNY + hNZ * attNZ;

        let spatialWeight: number;
        let particleMorphFraction: number;

        if (motionStyle === "searching") {
          // Sharp spatial falloff — only particles in the focused region morph deeply
          const FOCUS_SHARPNESS = 2.0; // was 4.0 — softer edge, less abrupt activation
          spatialWeight = Math.max(0, alignment) ** FOCUS_SHARPNESS;
          const combinedWeight = spatialWeight * (0.3 + 0.7 * particleWeight);
          particleMorphFraction = morphFraction * combinedWeight;
        } else if (motionStyle === "melting") {
          // Particles far from home (still cube-shaped) get the most pull
          const distToHome = Math.sqrt(
            (p.x - p.homeX) ** 2 + (p.y - p.homeY) ** 2 + (p.z - p.homeZ) ** 2,
          );
          const proximityWeight = Math.exp(-distToHome * 2.0);
          const pullWeight = 1.0 - proximityWeight;
          spatialWeight = Math.max(0, alignment);
          particleMorphFraction =
            morphFraction * pullWeight * (0.3 + 0.7 * particleWeight);
        } else {
          // "breathing" — uniform, weighted by curvature
          spatialWeight = 0.5 + 0.5 * particleWeight;
          particleMorphFraction = morphFraction * spatialWeight;
        }

        // Blend fraction: moves particle target toward figure home position
        const blendFactor = Math.min(1, particleMorphFraction);
        p.targetX = cubeX + (p.homeX - cubeX) * blendFactor;
        p.targetY = cubeY + (p.homeY - cubeY) * blendFactor;
        p.targetZ = cubeZ + (p.homeZ - cubeZ) * blendFactor;

        // Accumulate centroid of highly-active particles for swarm attraction
        if (spatialWeight > 0.7) {
          centX3 += p.homeX;
          centY3 += p.homeY;
          centZ3 += p.homeZ;
          centCnt3++;
        }
      }

      if (centCnt3 > 0) {
        beat3AttentionCentroidRef.current.set(
          centX3 / centCnt3,
          centY3 / centCnt3,
          centZ3 / centCnt3,
        );
      }

      stepBoids(
        particles as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // Full spring from frame 1 — sorted targets mean no crossing, so no warmup needed
      const springK3 = 0.025;
      const damping3 = 0.82;
      const SHIMMER_AMP_3 = 0.002;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        // Subtle per-particle noise keeps the surface alive between hint pulses —
        // continuous wonder, never fully still. Golden-ratio phase offset for variety.
        const shimmerPhase3 = i * 0.137;
        p.vx += Math.sin(elapsed * 0.8 + shimmerPhase3) * SHIMMER_AMP_3 * dt;
        p.vy +=
          Math.cos(elapsed * 0.56 + shimmerPhase3 * 1.3) * SHIMMER_AMP_3 * dt;
        p.vz +=
          Math.sin(elapsed * 0.4 + shimmerPhase3 * 0.7) * SHIMMER_AMP_3 * dt;
        p.vx += (p.targetX - p.x) * springK3;
        p.vy += (p.targetY - p.y) * springK3;
        p.vz += (p.targetZ - p.z) * springK3;
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.vx *= damping3;
        p.vy *= damping3;
        p.vz *= damping3;
      }

      // Swarm/orbit particles: lerp toward cube target + weak pull toward the active region
      const attentionCentroid3 = beat3AttentionCentroidRef.current;
      const attractionStrength3 = 0.002;
      const orbitAlpha3 = (1 - Math.exp(-0.3 * dt)) * 0.05;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * orbitAlpha3;
        p.y += (p.targetY - p.y) * orbitAlpha3;
        p.z += (p.targetZ - p.z) * orbitAlpha3;
        const dx3 = attentionCentroid3.x - p.x;
        const dy3 = attentionCentroid3.y - p.y;
        const dz3 = attentionCentroid3.z - p.z;
        p.x += dx3 * attractionStrength3;
        p.y += dy3 * attractionStrength3;
        p.z += dz3 * attractionStrength3;
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

      // Advance wave radius so it covers waveMaxDist in exactly beatDuration seconds.
      const waveRate =
        waveMaxDistRef.current / Math.max(beatDurationRef.current, 1);
      waveRadiusBeat4Ref.current += waveRate * dt;
      const waveRadius4 = waveRadiusBeat4Ref.current;
      const waveMaxDist4 = waveMaxDistRef.current;
      const waveWidth4 = Math.max(0.2, waveMaxDist4 * 0.2);

      const waveOX4 = waveOriginRef.current.x;
      const waveOY4 = waveOriginRef.current.y;
      const waveOZ4 = waveOriginRef.current.z;

      const sortedTargets4 =
        sortedCubeTargetsRef.current.length > 0
          ? sortedCubeTargetsRef.current
          : cubeTargetsRef.current;

      const numStages4 = revealStagesRef.current;
      // Map wave progress (0→1 at maxDist) to stage index for debris scatter
      const waveProgress4 = waveRadius4 / Math.max(waveMaxDist4, 0.001);
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
      const warmupDuration4 = 2.0;

      // How much to blend toward entry positions (1.0 at start → 0.0 at warmupDuration4).
      // Ensures particles flow from wherever they were in Beat 3 rather than jumping.
      const posBlend4 =
        beat4Elapsed < warmupDuration4 ? 1 - beat4Elapsed / warmupDuration4 : 0;
      const entryPos4 = beat4EntryPosRef.current;

      // Smoothstep-decelerate the cube rotation from the Beat 3 entry angle to 0
      // over the first 2.0 s so there is no sudden orientation snap at the transition.
      let rotY4 = 0;
      let rotX4 = 0;
      if (beat4Elapsed < warmupDuration4) {
        const tSmooth = beat4Elapsed / warmupDuration4;
        const smooth = tSmooth * tSmooth * (3 - 2 * tSmooth); // smoothstep
        rotY4 = beat4EntryRotYRef.current * (1 - smooth);
        rotX4 = beat4EntryRotXRef.current * (1 - smooth);
      }
      const cosY4 = isFinite(rotY4) ? Math.cos(rotY4) : 1;
      const sinY4 = isFinite(rotY4) ? Math.sin(rotY4) : 0;
      const cosX4 = isFinite(rotX4) ? Math.cos(rotX4) : 1;
      const sinX4 = isFinite(rotX4) ? Math.sin(rotX4) : 0;

      const figJitter4 = 0.006;
      const tOscFig4 = elapsed * 0.5;

      for (let i = 0; i < primaryCount; i++) {
        const o = i * 3;
        const p = particles[i];
        const phase = i * 0.37;

        const ddx4 = p.homeX - waveOX4;
        const ddy4 = p.homeY - waveOY4;
        const ddz4 = p.homeZ - waveOZ4;
        const distFromOrigin4 = Math.sqrt(
          ddx4 * ddx4 + ddy4 * ddy4 + ddz4 * ddz4,
        );

        if (distFromOrigin4 < waveRadius4 - waveWidth4) {
          // Solidified: permanently at figure surface with gentle jitter
          p.targetX = p.homeX + Math.sin(tOscFig4 + phase) * figJitter4;
          p.targetY = p.homeY + Math.cos(tOscFig4 * 0.7 + phase) * figJitter4;
          p.targetZ =
            p.homeZ + Math.sin(tOscFig4 * 1.1 + phase * 1.3) * figJitter4;
        } else {
          // Wave front or not yet reached: lerp between (rotated) cube target and home.
          // Apply Y-axis then X-axis rotation matching Beat 3's formula exactly,
          // with the angle smoothly decelerating from the Beat 3 entry angle to 0
          // over warmupDuration4 so there is no sudden orientation snap.
          const baseX4 = sortedTargets4[o];
          const baseY4 = sortedTargets4[o + 1];
          const baseZ4 = sortedTargets4[o + 2];
          const rx4 = cosY4 * baseX4 - sinY4 * baseZ4;
          const ry4 = baseY4;
          const rz4 = sinY4 * baseX4 + cosY4 * baseZ4;
          const cubeX4 = rx4;
          const cubeY4 = cosX4 * ry4 - sinX4 * rz4;
          const cubeZ4 = sinX4 * ry4 + cosX4 * rz4;

          const waveEdge4 = waveRadius4 - distFromOrigin4;
          const rawFrac4 = Math.max(0, Math.min(1, waveEdge4 / waveWidth4));
          const t4 = rawFrac4 * rawFrac4 * (3 - 2 * rawFrac4); // smoothstep
          p.targetX = cubeX4 * (1 - t4) + p.homeX * t4;
          p.targetY = cubeY4 * (1 - t4) + p.homeY * t4;
          p.targetZ = cubeZ4 * (1 - t4) + p.homeZ * t4;
        }

        // Blend targets toward entry positions during warmup so particles start
        // exactly where they were in Beat 3 and flow smoothly — no collapse.
        if (posBlend4 > 0 && entryPos4.length >= primaryCount * 3) {
          const eo = i * 3;
          p.targetX = p.targetX * (1 - posBlend4) + entryPos4[eo] * posBlend4;
          p.targetY =
            p.targetY * (1 - posBlend4) + entryPos4[eo + 1] * posBlend4;
          p.targetZ =
            p.targetZ * (1 - posBlend4) + entryPos4[eo + 2] * posBlend4;
        }
      }

      stepBoids(
        particles as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      const springK4 = 0.08;
      const damping4 = 0.45;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        p.vx += (p.targetX - p.x) * springK4;
        p.vy += (p.targetY - p.y) * springK4;
        p.vz += (p.targetZ - p.z) * springK4;
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.vx *= damping4;
        p.vy *= damping4;
        p.vz *= damping4;
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

      const orbitAlpha4 = (1 - Math.exp(-0.3 * dt)) * 0.05;
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
            const hx = p.homeX,
              hy = p.homeY,
              hz = p.homeZ;
            const homeLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              const off = shimmerOffs[i];
              p.targetX = hx + hx * invLen * off;
              p.targetY = hy + hy * invLen * off;
              p.targetZ = hz + hz * invLen * off;
            } else {
              p.targetX = hx;
              p.targetY = hy;
              p.targetZ = hz;
            }
          }
        } else if (motion === "breathe") {
          // All surface particles pulse outward and back together (sinusoidal, synchronized)
          const breatheOffset = Math.sin(elapsed * 0.8) * 0.04;
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            const hx = p.homeX,
              hy = p.homeY,
              hz = p.homeZ;
            const homeLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              p.targetX = hx + hx * invLen * breatheOffset;
              p.targetY = hy + hy * invLen * breatheOffset;
              p.targetZ = hz + hz * invLen * breatheOffset;
            } else {
              p.targetX = hx;
              p.targetY = hy;
              p.targetZ = hz;
            }
          }
        } else if (motion === "flow") {
          // Each particle has its own independent per-particle noise phase offset
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            const hx = p.homeX,
              hy = p.homeY,
              hz = p.homeZ;
            const homeLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (homeLen > 1e-6) {
              const invLen = 1 / homeLen;
              const flowOffset = Math.sin(elapsed * 0.6 + i * 0.37) * 0.025;
              p.targetX = hx + hx * invLen * flowOffset;
              p.targetY = hy + hy * invLen * flowOffset;
              p.targetZ = hz + hz * invLen * flowOffset;
            } else {
              p.targetX = p.homeX;
              p.targetY = p.homeY;
              p.targetZ = p.homeZ;
            }
          }
        } else {
          // still: no offset, particles rest exactly on surface
          for (let i = 0; i < primaryCount; i++) {
            const p = particles[i];
            p.targetX = p.homeX;
            p.targetY = p.homeY;
            p.targetZ = p.homeZ;
          }
        }

        const lerpSpeed5 = getLerpSpeedForBeat(5);
        const alpha5 =
          (1 - Math.exp(-lerpSpeed5 * dt)) *
          lerpWeightRef.current *
          beatTransitionRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const p = particles[i];
          p.x += (p.targetX - p.x) * alpha5;
          p.y += (p.targetY - p.y) * alpha5;
          p.z += (p.targetZ - p.z) * alpha5;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
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
        const alpha5Orbit =
          (1 - Math.exp(-getLerpSpeedForBeat(5) * dt)) *
          lerpWeightRef.current *
          beatTransitionRef.current;
        const breakaways = breakawayRef.current;
        for (let i = primaryCount; i < n; i++) {
          const p = particles[i];
          const bi = i - primaryCount;
          const isActive = bi < breakaways.length && breakaways[bi].active;
          const alpha = isActive ? orbitAlphaElse : alpha5Orbit;
          p.x += (p.targetX - p.x) * alpha;
          p.y += (p.targetY - p.y) * alpha;
          p.z += (p.targetZ - p.z) * alpha;
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
        state.camera.position.lerp(camTargetRef.current, 0.02);
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
      figureGroupRef.current.rotation.set(rot.x, rot.y, rot.z);
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
        enableRotate={true}
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
            particleSize={particleSize * 2.5}
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
            particleSize={particleSize}
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
