import { PARTICLE_CAPACITY } from './surfaceSampler';

/** Range + step snapping used by SettingsChrome sliders and localStorage hydrate. */
const MIN = 1024;
const STEP = 512;

export function snapParticleCountForUi(raw: number): number {
  const gated = Math.min(PARTICLE_CAPACITY, Math.max(MIN, raw));
  const snapped = Math.round((gated - MIN) / STEP) * STEP + MIN;
  return Math.min(PARTICLE_CAPACITY, Math.max(MIN, snapped));
}
