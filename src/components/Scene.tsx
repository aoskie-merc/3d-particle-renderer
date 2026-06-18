import { useMemo } from "react";

import AdaptivePerspective from "./AdaptivePerspective";
import GhostMesh from "./GhostMesh";
import ParticleSystem from "./ParticleSystem";
import SkinParticleSystem from "./SkinParticleSystem";
import SpringOrbitControls from "./SpringOrbitControls";

import type { BufferGeometry } from "three";

import type { IParticleSettings } from "../particleSettings";
import type { TMercuryAppearance } from "../theme";
import { mercuryCanvasHex } from "../theme";

import { CANONICAL_MESH_RADIUS } from "../utils/geometryNormalize";

export interface ISceneProps {
  appearance: TMercuryAppearance;
  geometry: BufferGeometry;
  settings: IParticleSettings;
  /** External pulse timestamp — triggers swarm burst on verification check completion */
  pulseTimestamp?: number;
  /** When set, overrides the swarm attractor to this position (sweep trigger). */
  attractorOverride?: { x: number; y: number; z: number } | null;
  /** Multiplier for attractor force when override is active. */
  attractorBoost?: number;
  /** When timestamp changes, teleport all boids to the given position. */
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
  /** Y-plane of the sweep highlight for skin particles; null = inactive. */
  sweepHighlightY?: number | null;
  /** Callback from ParticleSystem with the current swarm centroid. */
  onCentroidUpdate?: (pos: { x: number; y: number; z: number }) => void;
  /** Live swarm centroid passed to SkinParticleSystem for proximity-based opacity. */
  swarmCentroid?: { x: number; y: number; z: number };
  /** When true, disables camera orbit controls (used during enter/exit). */
  lockCamera?: boolean;
  /** Overrides the boid homeSpringFactor to snap particles to surface. */
  homeSpringOverride?: number;
  /** When true, forces proximity-based skin opacity regardless of settings toggle. */
  forceProximityMode?: boolean;
  /** When value changes, zero all boid velocities (used after enter animation). */
  resetVelocitiesSignal?: number;
  /** Current trigger phase — used to apply phase-specific overrides (e.g. speed cap). */
  triggerPhase?: string;
  /** Which animation path is active — controls orb-specific overrides. */
  animPath?: "statue" | "orb";
  /** When true, the orb enter animation has transitioned to its steady globe-rotation phase. */
  orbSteadyState?: boolean;
  /** When true (initial→enter only), particles fly to model homes before shell phase. */
  orbFormingPhase?: boolean;
}

export default function Scene(props: ISceneProps) {
  const { appearance, geometry, settings } = props;

  const clears = mercuryCanvasHex(appearance);
  const skyColor = appearance === "dark" ? "#c3c3cc" : "#fbfcfd";
  const groundColor = appearance === "dark" ? "#171721" : "#dddde5";

  const fitRadius = useMemo(() => {
    geometry.computeBoundingSphere();

    const r = geometry.boundingSphere?.radius;

    return r && Number.isFinite(r)
      ? Math.max(r, CANONICAL_MESH_RADIUS / 320)
      : CANONICAL_MESH_RADIUS;
  }, [geometry]);

  return (
    <>
      <color attach="background" args={[clears]} />

      <AdaptivePerspective fitRadius={fitRadius} />

      <hemisphereLight args={[skyColor, groundColor, 0.48]} />

      <ambientLight intensity={appearance === "dark" ? 0.36 : 0.42} />

      <directionalLight
        intensity={appearance === "dark" ? 2.08 : 1.78}
        position={[fitRadius * 12, fitRadius * 17, fitRadius * 9]}
      />

      <directionalLight
        intensity={appearance === "dark" ? 2.15 : 1.85}
        position={[-fitRadius * 18, -fitRadius * 22, -fitRadius * 19]}
      />

      <SpringOrbitControls
        enabled={!props.lockCamera}
        maxDistance={Math.max(fitRadius * 28, CANONICAL_MESH_RADIUS * 8)}
        minDistance={Math.max(fitRadius * 0.08, CANONICAL_MESH_RADIUS * 0.12)}
      />

      {!settings.skinEnabled && settings.showWireframe ? (
        <GhostMesh
          appearance={appearance}
          geometry={geometry}
          wireOpacity={settings.wireOpacity}
        />
      ) : null}

      {settings.skinEnabled ? (
        <SkinParticleSystem
          key={`${geometry.uuid}-skin`}
          contourDensity={settings.skinContourDensity}
          depthFade={settings.skinDepthFade}
          geometry={geometry}
          isDarkMode={appearance === "dark"}
          normalShading={settings.skinNormalShading}
          particleCount={settings.skinParticleCount}
          particleSize={settings.particleSize}
          proximityMode={
            (settings.proximityReveal || !!props.forceProximityMode) &&
            props.triggerPhase !== "formed"
          }
          proximityRadius={settings.proximityRadius}
          skinColor={settings.skinColor}
          skinOpacity={
            props.animPath === "orb" && props.triggerPhase !== "formed"
              ? 0
              : settings.skinOpacity
          }
          swarmCentroid={props.swarmCentroid}
          sweepHighlightY={props.sweepHighlightY}
        />
      ) : null}

      <ParticleSystem
        key={geometry.uuid}
        attractorBoost={props.attractorBoost}
        attractorOverride={props.attractorOverride}
        homeSpringOverride={props.homeSpringOverride}
        resetVelocitiesSignal={props.resetVelocitiesSignal}
        blendMode={settings.blendMode}
        boidAlignment={settings.boidAlignment}
        boidCohesion={settings.boidCohesion}
        boidHomeSpring={settings.boidHomeSpring}
        boidNoise={settings.boidNoise}
        boidSeparation={settings.boidSeparation}
        boidSpeedLimit={settings.boidSpeedLimit}
        boidVisualRange={settings.boidVisualRange}
        color={settings.color}
        distribution={settings.distribution}
        geometry={geometry}
        onCentroidUpdate={props.onCentroidUpdate}
        opacity={settings.opacity}
        particleCount={settings.particleCount}
        particleSize={settings.particleSize}
        pulseTimestamp={props.pulseTimestamp}
        surfaceNormalOffset={settings.surfaceNormalOffset}
        swarmOrbitSpeed={settings.swarmOrbitSpeed}
        swarmOrbitRadius={settings.swarmOrbitRadius}
        swarmSwirlStrength={settings.swarmSwirlStrength}
        swarmSplitIntensity={settings.swarmSplitIntensity}
        swarmSplitSpeed={settings.swarmSplitSpeed}
        teleportSignal={props.teleportSignal}
        speedMultiplier={
          props.triggerPhase === "initial"
            ? 0.85
            : props.animPath === "orb" &&
                props.triggerPhase === "enter" &&
                !props.orbFormingPhase
              ? 3.0
              : 1.0
        }
        noiseMultiplier={
          props.triggerPhase === "initial"
            ? 0.35
            : props.animPath === "orb" &&
                props.triggerPhase === "enter" &&
                !props.orbFormingPhase
              ? 0.5
              : 1.0
        }
        steeringInertiaOverride={
          props.triggerPhase === "initial"
            ? 0.92
            : props.animPath === "orb" &&
                props.triggerPhase === "enter" &&
                !props.orbFormingPhase
              ? 0.65
              : undefined
        }
        swirlStrengthOverride={
          props.animPath === "orb" &&
          props.triggerPhase === "enter" &&
          !props.orbFormingPhase
            ? props.orbSteadyState
              ? 0.003
              : 0.022
            : undefined
        }
        shellAttractorRadius={
          props.animPath === "orb" &&
          props.triggerPhase === "enter" &&
          !props.orbFormingPhase
            ? (settings.orbRadius ?? 1.0)
            : 0
        }
        cohesionOverride={
          props.animPath === "orb" &&
          props.triggerPhase === "enter" &&
          !props.orbFormingPhase
            ? 0
            : undefined
        }
        separationOverride={
          props.animPath === "orb" &&
          props.triggerPhase === "enter" &&
          !props.orbFormingPhase
            ? 0
            : undefined
        }
        alignmentOverride={
          props.animPath === "orb" &&
          props.triggerPhase === "enter" &&
          !props.orbFormingPhase
            ? 0
            : undefined
        }
        opacityMultiplier={props.triggerPhase === "formed" ? 0.5 : 1}
      />
    </>
  );
}
