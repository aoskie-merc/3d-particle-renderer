export interface IBoidParams {
  /** Neighbor search radius (normalized mesh units). */
  visualRange: number;
  /** Separation threshold — particles closer than this repel. */
  separationDist: number;
  /** Separation steering strength. */
  separationFactor: number;
  /** Alignment steering strength. */
  alignmentFactor: number;
  /** Cohesion steering strength. */
  cohesionFactor: number;
  /** Pull toward the orbiting attractor point. */
  attractorFactor: number;
  /** Spring pull back toward original surface home position. */
  homeSpringFactor: number;
  /** Distance from home before the spring ramps up aggressively. */
  maxHomeDistance: number;
  /** Max speed (normalized units per frame). */
  speedLimit: number;
  /** Min speed — keeps the flock alive. */
  minSpeed: number;
  /** Per-particle random jitter magnitude. */
  noiseMagnitude: number;
  /** Attractor orbit speed multiplier. */
  orbitSpeed: number;
  /** Attractor angular amplitude: 0 = stationary on surface, 1 = full hemisphere sweep. */
  orbitRadius: number;
  /** Split pulse intensity (0 = disabled, 1 = dramatic). */
  splitIntensity: number;
  /** Split pulse frequency multiplier (higher = more frequent splits). */
  splitSpeed: number;
  /** Split force distance decay (higher = more localized effect). */
  splitDecay: number;
  /** Momentum — fraction of old velocity retained when blending forces (0 = no inertia, 1 = frozen). */
  steeringInertia: number;
  /** Elongation bias along the flock's travel direction. */
  velocityStretchFactor: number;
  /** Tangential force making particles orbit/swirl around the model center. */
  swirlStrength: number;
  /** When set, replaces the Lissajous orbit attractor with a fixed world-space position. */
  attractorOverride?: { x: number; y: number; z: number } | null;
  /** When > 0, uses a shell attractor that pulls particles to this radius from attractorOverride center. */
  shellAttractorRadius: number;
  /** Multiplier applied on top of attractorFactor when override is active. */
  attractorBoost?: number;
  /** Time elapsed since the shell attractor was last activated (seconds). Resets on each activation so the tumbling axis starts from a consistent phase instead of wherever the global clock happens to be. */
  shellElapsed?: number;
}

export const BOID_DEFAULTS: Readonly<IBoidParams> = {
  visualRange: 0.095,
  separationDist: 0.02,
  separationFactor: 0.012,
  alignmentFactor: 0.022,
  cohesionFactor: 0.0006,
  attractorFactor: 0.0003,
  homeSpringFactor: 0.0002,
  maxHomeDistance: 0.3,
  speedLimit: 0.006,
  minSpeed: 0.0024,
  noiseMagnitude: 0.0003,
  orbitSpeed: 0.15,
  orbitRadius: 1.3,
  splitIntensity: 0.25,
  splitSpeed: 2.55,
  splitDecay: 3.0,
  steeringInertia: 0.76,
  swirlStrength: 0.003,
  velocityStretchFactor: 0.01,
  shellAttractorRadius: 0,
};
