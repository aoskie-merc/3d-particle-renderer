import type {
  TBlendModeKey,
  TDirectionBias,
  TDistributionMethod,
} from "./types";

import { BOID_DEFAULTS } from "./sim/boidParams";

/** All tunable particle + view settings (`appPreferencesPersistence` hydrates defaults from localStorage). */
export interface IParticleSettings {
  blendMode: TBlendModeKey;
  color: string;
  distribution: TDistributionMethod;
  directionBias: TDirectionBias;
  movementAmplitude: number;
  movementSpeed: number;
  /** Drop landing frosted panel (CSS --panel-opacity). */
  panelOpacity: number;
  /** Drop landing backdrop blur px (CSS --panel-blur). */
  panelBlur: number;
  opacity: number;
  particleCount: number;
  particleSize: number;
  showWireframe: boolean;
  surfaceNormalOffset: number;
  vibrationAmplitude: number;
  vibrationDamping: number;
  vibrationFrequency: number;
  vibrationNoiseScale: number;
  wireOpacity: number;

  /** Boid / murmuration swarm parameters. */
  boidVisualRange: number;
  boidSeparation: number;
  boidAlignment: number;
  boidCohesion: number;
  boidHomeSpring: number;
  boidSpeedLimit: number;
  boidNoise: number;

  /** Landing page boid dot radius in CSS px. */
  landingParticleSize: number;

  /** Landing page particle count. */
  landingParticleCount: number;

  /** Swarm motion — orbit & split controls. */
  swarmOrbitSpeed: number;
  swarmOrbitRadius: number;
  swarmSplitIntensity: number;
  swarmSplitSpeed: number;

  /** When enabled, skin opacity is driven by proximity to the swarm centroid. */
  proximityReveal: boolean;

  /** Base model particle skin replaces wire shell when enabled. */
  skinEnabled: boolean;
  skinParticleCount: number;
  skinParticleSize: number;
  skinDepthFade: number;
  skinNormalShading: number;
  skinContourDensity: number;
  skinColor: string;
  skinOpacity: number;
}

/** Defaults match Mercury dark canvas + light-beige particles (see theme.ts). */
export const PARTICLE_SETTINGS_DEFAULTS: IParticleSettings = {
  blendMode: "normal",
  color: "#eccc98",
  distribution: "areaWeighted",
  directionBias: "random",
  movementAmplitude: 1.09,
  movementSpeed: 0.18,
  panelBlur: 12,
  panelOpacity: 0.7,
  opacity: 0.76,
  particleCount: 9_728,
  particleSize: 0.002,
  showWireframe: false,
  surfaceNormalOffset: 0.354,
  vibrationAmplitude: 0.035,
  vibrationDamping: 0.35,
  vibrationFrequency: 0.23,
  vibrationNoiseScale: 0.92,
  wireOpacity: 0.28,
  landingParticleSize: 2.5,
  landingParticleCount: 120,
  boidVisualRange: BOID_DEFAULTS.visualRange,
  boidSeparation: BOID_DEFAULTS.separationFactor,
  boidAlignment: BOID_DEFAULTS.alignmentFactor,
  boidCohesion: BOID_DEFAULTS.cohesionFactor,
  boidHomeSpring: BOID_DEFAULTS.homeSpringFactor,
  boidSpeedLimit: BOID_DEFAULTS.speedLimit,
  boidNoise: BOID_DEFAULTS.noiseMagnitude,
  swarmOrbitSpeed: BOID_DEFAULTS.orbitSpeed,
  swarmOrbitRadius: BOID_DEFAULTS.orbitRadius,
  swarmSplitIntensity: BOID_DEFAULTS.splitIntensity,
  swarmSplitSpeed: BOID_DEFAULTS.splitSpeed,
  proximityReveal: false,
  skinEnabled: true,
  skinParticleCount: 135_936,
  skinParticleSize: 0.0055,
  skinDepthFade: 0.13,
  skinNormalShading: 0,
  skinContourDensity: 0.68,
  skinColor: "#c8b79b",
  skinOpacity: 0.81,
};
