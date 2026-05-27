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
}

export const BOID_DEFAULTS: Readonly<IBoidParams> = {
  visualRange: 0.14,
  separationDist: 0.03,
  separationFactor: 0.04,
  alignmentFactor: 0.045,
  cohesionFactor: 0.003,
  attractorFactor: 0.0003,
  homeSpringFactor: 0.0005,
  maxHomeDistance: 0.3,
  speedLimit: 0.005,
  minSpeed: 0.002,
  noiseMagnitude: 0.0006,
  orbitSpeed: 1.0,
  orbitRadius: 0.2,
  splitIntensity: 0.35,
  splitSpeed: 1.0,
  splitDecay: 3.0,
  steeringInertia: 0.68,
  velocityStretchFactor: 0.006,
};
