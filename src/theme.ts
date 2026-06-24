/**
 * Mirrors Mercury semantic canvas colors from mercury-web/src/design-system/tokens/customProperties.css
 * - Light : `:root { --ds-background-canvas }` (= #ededf3)
 * - Dark : `[data-theme='dark'] { --ds-background-canvas }` (= #10101a)
 */
export type TMercuryAppearance = 'light' | 'dark';

export const MERCURY_CANVAS_LIGHT = '#ededf3';

export const MERCURY_CANVAS_DARK = '#0c0b12';

/** Warm sand particle on dark canvas — matches SwarmCanvas prototype palette mid-range. */
export const DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS = '#c8b79b';

/** Deeper tan contrast on Mercury light-gray canvas (#b8a080 range). */
export const DEFAULT_PARTICLE_COLOR_ON_LIGHT_CANVAS = '#b8a080';

export function mercuryCanvasHex(appearance: TMercuryAppearance): string {
  return appearance === 'dark' ? MERCURY_CANVAS_DARK : MERCURY_CANVAS_LIGHT;
}

export function mercuryDefaultParticleHex(appearance: TMercuryAppearance): string {
  return appearance === 'dark'
    ? DEFAULT_PARTICLE_COLOR_ON_DARK_CANVAS
    : DEFAULT_PARTICLE_COLOR_ON_LIGHT_CANVAS;
}
