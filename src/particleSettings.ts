import type {
  TBlendModeKey,
  TDirectionBias,
  TDistributionMethod,
} from "./types";

import { BOID_DEFAULTS } from "./sim/boidParams";
import { DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS } from "./theme";

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
  color: DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS,
  distribution: "areaWeighted",
  directionBias: "radial",
  movementAmplitude: 0.09,
  movementSpeed: 0.94,
  panelBlur: 12,
  panelOpacity: 0.7,
  opacity: 0.9,
  particleCount: 2_000,
  particleSize: 0.003,
  showWireframe: false,
  surfaceNormalOffset: 0.035,
  vibrationAmplitude: 0.09,
  vibrationDamping: 0.35,
  vibrationFrequency: 0.85,
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
  skinEnabled: false,
  skinParticleCount: 32_768,
  skinParticleSize: 0.028,
  skinDepthFade: 0.3,
  skinNormalShading: 0.5,
  skinContourDensity: 0.45,
  skinColor: DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS,
  skinOpacity: 0.92,
};
