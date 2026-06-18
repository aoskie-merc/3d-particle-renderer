/**
 * 2D boid / murmuration simulation for the landing page particle overlay.
 *
 * Mirrors the rules in boids3d.ts (separation, alignment, cohesion, attractor,
 * noise, speed clamping, split pulse, home spring) but operates in screen-pixel
 * coordinates with a delta-time–based integrator.
 */

export interface IBoid2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Steering accumulator (smoothed into velocity for inertia). */
  steerX: number;
  steerY: number;
  homeX: number;
  homeY: number;
  noiseAngle: number;
  noiseSpeed: number;
  dotR: number;
}

export interface IBoid2DParams {
  visualRange: number;
  separationDist: number;
  separationFactor: number;
  alignmentFactor: number;
  cohesionFactor: number;
  attractorFactor: number;
  homeSpringFactor: number;
  maxHomeDistance: number;
  speedLimit: number;
  minSpeed: number;
  noiseMagnitude: number;
  orbitSpeed: number;
  orbitRadiusX: number;
  orbitRadiusY: number;
  splitIntensity: number;
  splitSpeed: number;
  splitDecay: number;
  /** 0–1: how much of the steer accumulator mixes into velocity per second.
   *  Lower = more momentum / sweepier turns. */
  steerInertia: number;
  /** Velocity damping per second (0 = no damping, 1 = full stop). */
  drag: number;
}

export const BOID_2D_DEFAULTS: Readonly<IBoid2DParams> = {
  visualRange: 80,
  separationDist: 22,
  separationFactor: 60,
  alignmentFactor: 0.08,
  cohesionFactor: 0.6,
  attractorFactor: 0.4,
  homeSpringFactor: 0.04,
  maxHomeDistance: 600,
  speedLimit: 180,
  minSpeed: 30,
  noiseMagnitude: 40,
  orbitSpeed: 1.0,
  orbitRadiusX: 400,
  orbitRadiusY: 320,
  splitIntensity: 0.7,
  splitSpeed: 1.0,
  splitDecay: 0.02,
  steerInertia: 6.0,
  drag: 0.3,
};

/* ---------- spatial hash grid (2D, allocation-free after warmup) ---------- */

const PRIME_X = 73856093;
const PRIME_Y = 19349663;

function hashKey(cx: number, cy: number): number {
  return (cx * PRIME_X) ^ (cy * PRIME_Y);
}

let _gridKeys = new Int32Array(512);
let _gridSorted = new Int32Array(512);
const _gridStarts = new Map<number, number>();
const _gridCounts = new Map<number, number>();

function ensureGridCapacity(n: number): void {
  if (_gridKeys.length < n) {
    const cap = n * 2;
    _gridKeys = new Int32Array(cap);
    _gridSorted = new Int32Array(cap);
  }
}

function buildGrid(particles: IBoid2D[], cellSize: number, n: number): void {
  ensureGridCapacity(n);
  _gridStarts.clear();
  _gridCounts.clear();
  const inv = 1 / cellSize;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const key = hashKey(Math.floor(p.x * inv), Math.floor(p.y * inv));
    _gridKeys[i] = key;
    _gridCounts.set(key, (_gridCounts.get(key) ?? 0) + 1);
  }

  let offset = 0;
  for (const [key, cnt] of _gridCounts) {
    _gridStarts.set(key, offset);
    offset += cnt;
  }

  for (const key of _gridCounts.keys()) {
    _gridCounts.set(key, 0);
  }
  for (let i = 0; i < n; i++) {
    const key = _gridKeys[i];
    const start = _gridStarts.get(key)!;
    const cursor = _gridCounts.get(key)!;
    _gridSorted[start + cursor] = i;
    _gridCounts.set(key, cursor + 1);
  }
}

let _neighbors = new Int32Array(512);

function queryNeighbors(
  x: number,
  y: number,
  range: number,
  cellSize: number,
): number {
  let nc = 0;
  const inv = 1 / cellSize;
  const minCx = Math.floor((x - range) * inv);
  const maxCx = Math.floor((x + range) * inv);
  const minCy = Math.floor((y - range) * inv);
  const maxCy = Math.floor((y + range) * inv);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const key = hashKey(cx, cy);
      const start = _gridStarts.get(key);
      if (start === undefined) continue;
      const count = _gridCounts.get(key)!;
      for (let k = 0; k < count; k++) {
        _neighbors[nc++] = _gridSorted[start + k];
      }
    }
  }
  return nc;
}

/* ---------- public API ---------- */

export function createBoid2DParticles(
  count: number,
  centerX: number,
  centerY: number,
): IBoid2D[] {
  const particles: IBoid2D[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 180;
    particles[i] = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      steerX: 0,
      steerY: 0,
      homeX: centerX,
      homeY: centerY,
      noiseAngle: Math.random() * Math.PI * 2,
      noiseSpeed: 0.5 + Math.random() * 1.5,
      dotR: 1.1 + Math.random() * 1.9,
    };
  }
  return particles;
}

export function repositionBoid2DParticles(
  particles: IBoid2D[],
  centerX: number,
  centerY: number,
): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const offsetX = p.x - p.homeX;
    const offsetY = p.y - p.homeY;
    p.homeX = centerX;
    p.homeY = centerY;
    p.x = centerX + offsetX;
    p.y = centerY + offsetY;
  }
}

/**
 * Advance the 2D boid flock one tick.
 *
 * @param elapsed  Monotonic time in seconds (drives attractor orbit & split pulse)
 * @param dt       Frame delta in seconds
 */
export function stepBoids2D(
  particles: IBoid2D[],
  params: IBoid2DParams,
  elapsed: number,
  dt: number,
): void {
  const {
    alignmentFactor,
    attractorFactor,
    cohesionFactor,
    drag,
    homeSpringFactor,
    maxHomeDistance,
    minSpeed,
    noiseMagnitude,
    orbitRadiusX,
    orbitRadiusY,
    orbitSpeed,
    separationDist,
    separationFactor,
    speedLimit,
    splitDecay,
    splitIntensity,
    splitSpeed,
    steerInertia,
    visualRange,
  } = params;

  const n = particles.length;
  if (n === 0) return;

  if (_neighbors.length < n) {
    _neighbors = new Int32Array(n * 2);
  }

  const t = elapsed * orbitSpeed;

  const homeX0 = particles[0].homeX;
  const homeY0 = particles[0].homeY;

  const attractX =
    homeX0 +
    Math.sin(t * 0.37) * 0.45 * orbitRadiusX +
    Math.sin(t * 0.13) * 0.25 * orbitRadiusX;
  const attractY =
    homeY0 +
    Math.cos(t * 0.29) * 0.4 * orbitRadiusY +
    Math.sin(t * 0.11) * 0.2 * orbitRadiusY;

  const st = elapsed * splitSpeed;
  const p1 = Math.pow(Math.max(0, Math.sin(st * 0.8)), 8);
  const p2 = Math.pow(Math.max(0, Math.sin(st * 0.55 + 1.5)), 8);
  const p3 = Math.pow(Math.max(0, Math.sin(st * 0.35 + 3.0)), 8);
  const autoSplit = Math.max(p1, p2, p3) * splitIntensity;

  const splitAngle = st * 0.2 + Math.sin(st * 0.13) * 0.8;
  const lineNx = Math.cos(splitAngle);
  const lineNy = Math.sin(splitAngle);

  const splitStrength = 8;

  const cellSize = Math.max(visualRange, 1);
  buildGrid(particles, cellSize, n);
  const vrSq = visualRange * visualRange;
  const sepSq = separationDist * separationDist;
  const maxHomeSq = maxHomeDistance * maxHomeDistance;

  const dtInertia = Math.min(1, steerInertia * dt);
  const dtDrag = Math.min(1, drag * dt);

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    let sx = 0;
    let sy = 0;

    let sepX = 0;
    let sepY = 0;
    let aliX = 0;
    let aliY = 0;
    let cohX = 0;
    let cohY = 0;
    let neighbors = 0;

    const nc = queryNeighbors(p.x, p.y, visualRange, cellSize);
    for (let k = 0; k < nc; k++) {
      const j = _neighbors[k];
      if (j === i) continue;
      const o = particles[j];
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < vrSq) {
        neighbors++;
        aliX += o.vx;
        aliY += o.vy;
        cohX += o.x;
        cohY += o.y;

        if (distSq < sepSq) {
          const dist = Math.sqrt(distSq) || 1;
          sepX -= dx / dist;
          sepY -= dy / dist;
        }
      }
    }

    if (neighbors > 0) {
      aliX /= neighbors;
      aliY /= neighbors;
      sx += (aliX - p.vx) * alignmentFactor;
      sy += (aliY - p.vy) * alignmentFactor;

      cohX /= neighbors;
      cohY /= neighbors;
      sx += (cohX - p.x) * cohesionFactor;
      sy += (cohY - p.y) * cohesionFactor;
    }

    sx += sepX * separationFactor;
    sy += sepY * separationFactor;

    // Attractor
    sx += (attractX - p.x) * attractorFactor;
    sy += (attractY - p.y) * attractorFactor;

    // Split pulse
    if (autoSplit > 0.05) {
      const toCx = p.x - attractX;
      const toCy = p.y - attractY;
      const distToLine = toCx * lineNx + toCy * lineNy;
      const sign = distToLine > 0 ? 1 : -1;
      const proximity = Math.exp(-Math.abs(distToLine) * splitDecay);
      const force = sign * autoSplit * splitStrength * proximity;
      sx += lineNx * force;
      sy += lineNy * force;
    }

    // Home spring
    const dhx = p.homeX - p.x;
    const dhy = p.homeY - p.y;
    const homeDist2 = dhx * dhx + dhy * dhy;
    let springK = homeSpringFactor;
    if (homeDist2 > maxHomeSq) {
      springK *= 1 + (Math.sqrt(homeDist2) - maxHomeDistance) * 0.02;
    }
    sx += dhx * springK;
    sy += dhy * springK;

    // Noise
    p.noiseAngle += p.noiseSpeed * dt;
    const na = p.noiseAngle;
    sx += Math.cos(na + i * 0.37) * noiseMagnitude;
    sy += Math.sin(na + i * 0.53) * noiseMagnitude;

    // Steering inertia: blend accumulated steer into velocity smoothly
    p.steerX += (sx - p.steerX) * dtInertia;
    p.steerY += (sy - p.steerY) * dtInertia;

    p.vx += p.steerX * dt;
    p.vy += p.steerY * dt;

    // Drag
    p.vx *= 1 - dtDrag;
    p.vy *= 1 - dtDrag;

    // Speed clamp
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > speedLimit) {
      const s = speedLimit / speed;
      p.vx *= s;
      p.vy *= s;
    } else if (speed > 0 && speed < minSpeed) {
      const s = minSpeed / speed;
      p.vx *= s;
      p.vy *= s;
    }

    // Integrate
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
