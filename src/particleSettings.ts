import type { TBlendModeKey, TDirectionBias, TDistributionMethod } from './types';

import { DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS } from './theme';

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
  blendMode: 'normal',
  color: DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS,
  distribution: 'areaWeighted',
  directionBias: 'radial',
  movementAmplitude: 0.09,
  movementSpeed: 0.94,
  panelBlur: 12,
  panelOpacity: 0.7,
  opacity: 0.9,
  particleCount: 12_000,
  particleSize: 0.024,
  showWireframe: false,
  surfaceNormalOffset: 0.035,
  vibrationAmplitude: 0.09,
  vibrationDamping: 0.35,
  vibrationFrequency: 0.85,
  vibrationNoiseScale: 0.92,
  wireOpacity: 0.28,
  skinEnabled: false,
  skinParticleCount: 32_768,
  skinParticleSize: 0.028,
  skinDepthFade: 0.3,
  skinNormalShading: 0.5,
  skinContourDensity: 0.45,
  skinColor: DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS,
  skinOpacity: 0.92,
};
