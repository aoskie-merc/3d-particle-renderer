import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { useEffect, useMemo, useRef, useState } from "react";

import { Vector3 } from "three";

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
  setTargetsForBeat,
} from "../sim/particleSimV2";
import {
  PARTICLE_CAPACITY,
  sampleMeshSurface,
  sampleMeshSurfaceBiased,
} from "../utils/surfaceSampler";
import { loadStaticModel } from "../utils/meshIngest";
import type { TSurfaceDepthBias, TDepthSizing } from "../types";
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
  beatDurationMs?: number;
  onBeatProgress?: (progress: number) => void;
  /** Registration callback: SceneV2 passes its scatter-reset function to the parent on mount. */
  onReset?: (resetFn: () => void) => void;
  /** Debug: when provided, overrides the beat-based camera position with these values. */
  debugCamera?: { x: number; y: number; z: number; lookAtY: number };
  /** Debug: when provided, sets the particle group's rotation each frame. */
  debugMeshRotation?: { x: number; y: number; z: number };
  /** When true (Beat 5), OrbitControls are enabled and camera lerp is paused. */
  orbitEnabled?: boolean;
  /** Controls how surface particles move during Beat 5 (Approved). */
  surfaceMotion?: "still" | "shimmer" | "breathe" | "flow";
  /** Controls which surface areas receive more particles during Beat 5. */
  surfaceDepthBias?: TSurfaceDepthBias;
  /** Controls how particle size varies based on surface orientation to camera during Beat 5. */
  depthSizing?: TDepthSizing;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SceneV2(props: ISceneV2Props) {
  const {
    beat,
    particleCount,
    particleSize,
    color,
    opacity,
    swirlStrength,
    revealMode = "random",
    formTransition = "drift",
    hintSpeed = "slow",
    revealPacing = "current",
    beatDurationMs = 8000,
    onBeatProgress,
    onReset,
    debugCamera,
    debugMeshRotation,
    orbitEnabled = false,
    surfaceMotion = "flow",
    surfaceDepthBias = "uniform",
    depthSizing = "flat",
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

  // ── Geometry & surface samples ────────────────────────────────────────────

  const geometryRef = useRef<BufferGeometry | null>(null);
  const homePositionsRef = useRef(new Float32Array(0));
  const homeNormalsRef = useRef(new Float32Array(0));
  const geometryLoadedRef = useRef(false);

  // State-driven so the render re-runs when geometry/particles are ready
  const [skinGeometry, setSkinGeometry] = useState<BufferGeometry | null>(null);
  const [particleCount_ready, setParticleCountReady] = useState(0);

  // ── Shape targets (stable, rebuilt when particleCount changes) ────────────

  const cubeTargetsRef = useRef(new Float32Array(0));

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

  // ── Beat 2 cascade state ──────────────────────────────────────────────────

  const beat2StartTimeRef = useRef(-1);

  // ── Beat 4 multi-wave reveal state ────────────────────────────────────────

  const beat4StartTimeRef = useRef(-1);
  const wave1SetRef = useRef<Set<number>>(new Set());
  const sessionSeedRef = useRef(Math.floor(Math.random() * 1_000_000));

  // ── Beat progress callback refs ───────────────────────────────────────────

  const onBeatProgressRef = useRef(onBeatProgress);
  onBeatProgressRef.current = onBeatProgress;
  const beatDurationMsRef = useRef(beatDurationMs);
  beatDurationMsRef.current = beatDurationMs;
  const beatProgressStartTimeRef = useRef<number>(-1);
  const prevBeatForProgressRef = useRef<TBeat>(beat);

  // ── Camera target ─────────────────────────────────────────────────────────

  const camTargetRef = useRef(new Vector3(...CAMERA_POSITIONS[beat]));

  // ── Debug overrides ───────────────────────────────────────────────────────

  const debugCameraRef = useRef(debugCamera);
  debugCameraRef.current = debugCamera;
  const debugMeshRotationRef = useRef(debugMeshRotation);
  debugMeshRotationRef.current = debugMeshRotation;
  const groupRef = useRef<Group | null>(null);
  /** Separate ref for the figure mesh group so debugMeshRotation only affects the figure, not particles. */
  const figureGroupRef = useRef<Group | null>(null);

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
      const speed = 0.004 + Math.random() * 0.003;
      p.vx = -Math.sin(angle) * speed + (Math.random() - 0.5) * 0.002;
      p.vy = Math.cos(angle) * speed + (Math.random() - 0.5) * 0.002;
      p.vz = (Math.random() - 0.5) * 0.001;
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
    setTargetsForBeat(
      particles,
      beatRef.current,
      cubeTargetsRef.current,
    );
  };
  // Stable wrapper — registered with parent once on mount
  const stableResetRef = useRef(() => resetRef.current());

  // ── Swarm centroid (for SkinParticleSystem proximity reveal) ─────────────

  const centroidRef = useRef({ x: 0, y: 0, z: 0 });
  const skinCentroidRef = useRef({ x: 0, y: 0, z: 0 });

  // ── Load model on mount ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    loadStaticModel("/model.stl").then((geom) => {
      if (cancelled) return;

      geometryRef.current = geom;
      setSkinGeometry(geom);

      // Sample surface at full capacity for homes
      const count = Math.min(particleCount, PARTICLE_CAPACITY);
      const samples = sampleMeshSurface(geom, count, "areaWeighted");
      homePositionsRef.current = samples.positions;
      homeNormalsRef.current = samples.normals;

      // Shape targets (same count)
      cubeTargetsRef.current = generateCubeTargets(count, 1.2);

      // Create particles with home positions
      particlesRef.current = createParticlesV2(samples.positions, count);
      const orbitCt = Math.ceil(count * 0.06);
      primaryParticlesRef.current = particlesRef.current.slice(
        0,
        count - orbitCt,
      );
      orbitParticlesRef.current = particlesRef.current.slice(count - orbitCt);

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

    cubeTargetsRef.current = generateCubeTargets(count, 1.2);

    particlesRef.current = createParticlesV2(samples.positions, count);
    const oc = Math.ceil(count * 0.06);
    primaryParticlesRef.current = particlesRef.current.slice(0, count - oc);
    orbitParticlesRef.current = particlesRef.current.slice(count - oc);

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

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      particles[i].homeX = samples.positions[o];
      particles[i].homeY = samples.positions[o + 1];
      particles[i].homeZ = samples.positions[o + 2];
    }
  }, [surfaceDepthBias]);

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

    // Set target positions for the incoming beat
    setTargetsForBeat(
      particles,
      beat,
      cubeTargetsRef.current,
    );

    // Rebuild shape targets for beats 2/3 when shape might have changed
    if (beat === 2 || beat === 3) {
      cubeTargetsRef.current = generateCubeTargets(particles.length, 1.2);
    }

    // Reset cascade timer when entering beat 2
    if (beat === 2) {
      beat2StartTimeRef.current = -1; // initialized on first useFrame tick
    }

    // Initialize beat 4 multi-wave reveal
    if (beat === 4) {
      beat4StartTimeRef.current = -1; // reset; initialized on first useFrame tick
      computeWave1Group(
        particles,
        revealModeRef.current,
        particles.length,
        sessionSeedRef.current,
        wave1SetRef,
      );
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
    // Beats 0/1: large atmospheric sphere so particles look like a halo around the scene.
    // Beats 2/3: orbit particles follow the SAME geometric shape as primary particles.
    // Beat 4:    tighter sphere orbit close to the figure surface (radius 0.9).
    // Beat 5:    breakaway behavior — most particles sit on the surface, occasional
    //            small groups briefly orbit then return.
    if (currentBeat <= 1) {
      const dirs = orbitDirsRef.current;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        const di = (i - primaryCount) * 3;
        if (di + 2 < dirs.length) {
          p.targetX = dirs[di] * 1.5;
          p.targetY = dirs[di + 1] * 1.5;
          p.targetZ = dirs[di + 2] * 1.5;
        }
      }
    } else if (currentBeat === 4) {
      const dirs = orbitDirsRef.current;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        const di = (i - primaryCount) * 3;
        if (di + 2 < dirs.length) {
          p.targetX = dirs[di] * 0.9;
          p.targetY = dirs[di + 1] * 0.9;
          p.targetZ = dirs[di + 2] * 0.9;
        }
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
        if (!breakaways[i].active && Math.random() < dt * 0.08 / Math.max(bCount, 1)) {
          const groupSize = 3 + Math.floor(Math.random() * 6); // 3–8 particles
          for (let j = i; j < Math.min(i + groupSize, bCount); j++) {
            if (!breakaways[j].active) {
              breakaways[j].active = true;
              breakaways[j].timer = 0;
              breakaways[j].duration = 2 + Math.random() * 3;
              breakaways[j].orbitAngle = Math.random() * Math.PI * 2;
              breakaways[j].orbitRadius = 0.8 + Math.random() * 0.4;
              breakaways[j].orbitSpeed = (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1);
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
      // Beats 2/3: use the same cube targets as primary particles so all particles
      // contribute to a single coherent shape (no separate halo visible).
      const shapeT = cubeTargetsRef.current;
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

    if (currentBeat === 2 || currentBeat === 3) {
      // ── Beats 2/3: rotating geometric shape + jitter + orbiting particles ──

      shapeRotationRef.current += 0.003 * dt * 60;
      shapeRotationXRef.current += (0.003 / 20) * dt * 60; // ~0.00015 per frame at 60fps

      const cosY = Math.cos(shapeRotationRef.current);
      const sinY = Math.sin(shapeRotationRef.current);
      const cosX = Math.cos(shapeRotationXRef.current);
      const sinX = Math.sin(shapeRotationXRef.current);

      const origTargets = cubeTargetsRef.current;

      // Update primary particle targets: Y-axis rotation + X-axis rotation (slow) + per-particle sinusoidal jitter
      const tOscShape = elapsed * 0.8;
      const shapeJitter = 0.012;
      for (let i = 0; i < primaryCount; i++) {
        const o = i * 3;
        const baseX = origTargets[o];
        const baseY = origTargets[o + 1];
        const baseZ = origTargets[o + 2];
        const phase = i * 0.37;

        // Y rotation
        const rx = cosY * baseX - sinY * baseZ;
        const ry = baseY;
        const rz = sinY * baseX + cosY * baseZ;

        // X rotation (slow)
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

      // Boid physics on all particles
      stepBoids(
        particles as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // Per-primary lerp — speed depends on beat and active control
      if (currentBeat === 2 && formTransitionRef.current === "cascade") {
        // Cascade: stagger arrival so particles settle in waves indexed by position
        if (beat2StartTimeRef.current < 0) beat2StartTimeRef.current = elapsed;
        const beat2Elapsed = elapsed - beat2StartTimeRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const delay = (i / Math.max(primaryCount - 1, 1)) * 8.0;
          const effectiveElapsed = Math.max(0, beat2Elapsed - delay);
          const cascadeAlpha =
            (1 - Math.exp(-0.8 * effectiveElapsed)) * lerpWeightRef.current;
          const p = particles[i];
          p.x += (p.targetX - p.x) * cascadeAlpha;
          p.y += (p.targetY - p.y) * cascadeAlpha;
          p.z += (p.targetZ - p.z) * cascadeAlpha;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
        }
      } else {
        let lerpSpeed: number;
        if (currentBeat === 2) {
          lerpSpeed = formTransitionRef.current === "fast" ? 2.5 : 0.5; // fast or drift
        } else {
          // Beat 3 (hint)
          const hs = hintSpeedRef.current;
          lerpSpeed = hs === "subtle" ? 0.15 : hs === "slow" ? 0.35 : 0.8;
        }
        const shapeAlpha =
          (1 - Math.exp(-lerpSpeed * dt)) * lerpWeightRef.current;
        for (let i = 0; i < primaryCount; i++) {
          const p = particles[i];
          p.x += (p.targetX - p.x) * shapeAlpha;
          p.y += (p.targetY - p.y) * shapeAlpha;
          p.z += (p.targetZ - p.z) * shapeAlpha;
          p.vx *= 0.45;
          p.vy *= 0.45;
          p.vz *= 0.45;
        }
      }

      // Anti-crossing: soft repulsion from shape center prevents particles from
      // passing through the interior when approaching from the opposite side.
      const minR = 0.65;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        if (dist < minR && dist > 0.001) {
          const force = (minR - dist) * 0.12;
          p.x += (p.x / dist) * force;
          p.y += (p.y / dist) * force;
          p.z += (p.z / dist) * force;
        }
      }

      // Gentle lerp for orbit particles (boid-dominant)
      const orbitAlpha23 = (1 - Math.exp(-0.3 * dt)) * 0.05;
      for (let i = primaryCount; i < n; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * orbitAlpha23;
        p.y += (p.targetY - p.y) * orbitAlpha23;
        p.z += (p.targetZ - p.z) * orbitAlpha23;
      }
    } else if (currentBeat === 4) {
      // ── Beat 4: multi-wave reveal with figure-surface jitter ─────────────

      if (beat4StartTimeRef.current < 0) {
        beat4StartTimeRef.current = elapsed;
      }

      const beat4Elapsed = elapsed - beat4StartTimeRef.current;

      const rp = revealPacingRef.current;
      const REVEAL_DURATION =
        rp === "dramatic" ? 30.0 : rp === "burst" ? 15.0 : 20.0;
      const wave1Threshold =
        rp === "dramatic" ? 0.2 : rp === "burst" ? 0.4 : 0.35;
      const retractThreshold =
        rp === "dramatic" ? 0.5 : rp === "burst" ? 0.5 : 0.55;

      const tPhase = Math.min(beat4Elapsed / REVEAL_DURATION, 1.0);

      const wave1Set = wave1SetRef.current;

      const shapeTargets = cubeTargetsRef.current;

      const figJitter = 0.006;
      const tOscFig = elapsed * 0.5;

      // Set targets per sub-phase for PRIMARY particles only
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const o = i * 3;
        const phase = i * 0.37;

        if (tPhase >= retractThreshold) {
          // Sub-phase 3 (final reveal): all primary → home with jitter
          p.targetX = p.homeX + Math.sin(tOscFig + phase) * figJitter;
          p.targetY = p.homeY + Math.cos(tOscFig * 0.7 + phase) * figJitter;
          p.targetZ =
            p.homeZ + Math.sin(tOscFig * 1.1 + phase * 1.3) * figJitter;
        } else if (tPhase >= wave1Threshold) {
          // Sub-phase 2 (retract): wave1 → 50% back toward shape; others → shape
          if (wave1Set.has(i)) {
            p.targetX = 0.5 * p.homeX + 0.5 * shapeTargets[o];
            p.targetY = 0.5 * p.homeY + 0.5 * shapeTargets[o + 1];
            p.targetZ = 0.5 * p.homeZ + 0.5 * shapeTargets[o + 2];
          } else {
            p.targetX = shapeTargets[o];
            p.targetY = shapeTargets[o + 1];
            p.targetZ = shapeTargets[o + 2];
          }
        } else {
          // Sub-phase 1 (wave1): wave1 → home with jitter; others → shape
          if (wave1Set.has(i)) {
            p.targetX = p.homeX + Math.sin(tOscFig + phase) * figJitter;
            p.targetY = p.homeY + Math.cos(tOscFig * 0.7 + phase) * figJitter;
            p.targetZ =
              p.homeZ + Math.sin(tOscFig * 1.1 + phase * 1.3) * figJitter;
          } else {
            p.targetX = shapeTargets[o];
            p.targetY = shapeTargets[o + 1];
            p.targetZ = shapeTargets[o + 2];
          }
        }
      }

      // Run boid physics on all particles
      stepBoids(
        particles as unknown as IBoidParticle[],
        ORBIT_BOID_PARAMS,
        elapsed,
      );

      // Lerp speed varies by sub-phase and revealPacing mode
      let lerpSpeed4: number;
      if (rp === "burst") {
        lerpSpeed4 =
          tPhase < wave1Threshold ? 3.5 : tPhase < retractThreshold ? 1.2 : 2.5;
      } else {
        // "current" / "dramatic": sub-phase 1 uses a gentle 1.0 speed (was 2.0) so
        // particles arc around the figure rather than cutting straight through its centre.
        lerpSpeed4 =
          tPhase < wave1Threshold ? 1.0 : tPhase < retractThreshold ? 0.6 : 1.5;
      }
      const alpha4 = 1 - Math.exp(-lerpSpeed4 * dt);

      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        p.x += (p.targetX - p.x) * alpha4;
        p.y += (p.targetY - p.y) * alpha4;
        p.z += (p.targetZ - p.z) * alpha4;
        p.vx *= 0.45;
        p.vy *= 0.45;
        p.vz *= 0.45;
      }

      // Anti-crossing: stronger repulsion (was 0.35) prevents particles from
      // lerping straight through the figure's centre when arriving from opposite sides.
      const minR4 = 0.55;
      for (let i = 0; i < primaryCount; i++) {
        const p = particles[i];
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        if (dist < minR4 && dist > 0.001) {
          const force = (minR4 - dist) * 0.12;
          p.x += (p.x / dist) * force;
          p.y += (p.y / dist) * force;
          p.z += (p.z / dist) * force;
        }
      }

      // Gentle lerp for orbit particles (boid-dominant)
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

        const alpha5 =
          (1 - Math.exp(-getLerpSpeedForBeat(5) * dt)) * lerpWeightRef.current;
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
        // Beat 1: lerp primary particles toward the halfway point (50% ring, 50% shape)
        const lerpSpeed1 = getLerpSpeedForBeat(1);
        const alpha1 = (1 - Math.exp(-lerpSpeed1 * dt)) * lerpWeightRef.current;
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

          // Strong spring toward ring target (0.0042 = 0.006 × 0.7, 30% slower)
          const delta = dist - ringTarget;
          const springForce = -delta * 0.0042;
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
          (1 - Math.exp(-getLerpSpeedForBeat(5) * dt)) * lerpWeightRef.current;
        const breakaways = breakawayRef.current;
        for (let i = primaryCount; i < n; i++) {
          const p = particles[i];
          const bi = i - primaryCount;
          const isActive =
            bi < breakaways.length && breakaways[bi].active;
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

    if (debugMeshRotationRef.current && figureGroupRef.current) {
      const { x, y, z } = debugMeshRotationRef.current;
      figureGroupRef.current.rotation.set(x, y, z);
    } else if (!debugMeshRotationRef.current && figureGroupRef.current) {
      figureGroupRef.current.rotation.set(0, 0, 0);
    }

    // ── Compute centroid for proximity shader ─────────────────────────────

    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < n; i++) {
      cx += particles[i].x;
      cy += particles[i].y;
      cz += particles[i].z;
    }
    centroidRef.current = { x: cx / n, y: cy / n, z: cz / n };
    skinCentroidRef.current = centroidRef.current;

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
      const durationSec = beatDurationMsRef.current / 1000;
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

  const opacityMultiplierForBeat = useMemo(() => {
    return beat === 2 || beat === 3 ? 0.6 : 1.0;
  }, [beat]);

  // Use state-driven values for render gating so React re-renders after model load
  const particles = particlesRef.current;

  return (
    <>
      <color attach="background" args={["#0a0a0f"]} />

      <OrbitControls
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
            particleCount={Math.min(80_000, PARTICLE_CAPACITY)}
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
            opacityMultiplier={opacityMultiplierForBeat}
          />
        )}
      </group>
    </>
  );
}

export type { IParticleV2 };
