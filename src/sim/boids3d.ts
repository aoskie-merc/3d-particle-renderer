import type { IBoidParams } from "./boidParams";

export interface IBoidParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  size: number;
  opacity: number;
  noiseAngle: number;
  noiseSpeed: number;
  prevVX: number;
  prevVY: number;
  prevVZ: number;
  queuedTurnX: number;
  queuedTurnY: number;
  queuedTurnZ: number;
}

/* ---------- spatial hash grid (allocation-free after warmup) ---------- */

const PRIME_X = 73856093;
const PRIME_Y = 19349663;
const PRIME_Z = 83492791;

function hashKey(cx: number, cy: number, cz: number): number {
  return (cx * PRIME_X) ^ (cy * PRIME_Y) ^ (cz * PRIME_Z);
}

let _gridKeys = new Int32Array(4096);
let _gridSorted = new Int32Array(4096);
const _gridStarts = new Map<number, number>();
const _gridCounts = new Map<number, number>();

function ensureGridCapacity(n: number): void {
  if (_gridKeys.length < n) {
    const cap = n * 2;
    _gridKeys = new Int32Array(cap);
    _gridSorted = new Int32Array(cap);
  }
}

function buildGrid(
  particles: IBoidParticle[],
  cellSize: number,
  n: number,
): void {
  ensureGridCapacity(n);
  _gridStarts.clear();
  _gridCounts.clear();
  const invCell = 1 / cellSize;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const key = hashKey(
      Math.floor(p.x * invCell),
      Math.floor(p.y * invCell),
      Math.floor(p.z * invCell),
    );
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

let _neighbors = new Int32Array(4096);

/**
 * Write neighbor indices into the shared `_neighbors` buffer and return
 * the count.  Zero allocations after the buffer reaches its high-water mark.
 */
function queryNeighbors(
  x: number,
  y: number,
  z: number,
  range: number,
  cellSize: number,
): number {
  let nc = 0;
  const invCell = 1 / cellSize;
  const minCx = Math.floor((x - range) * invCell);
  const maxCx = Math.floor((x + range) * invCell);
  const minCy = Math.floor((y - range) * invCell);
  const maxCy = Math.floor((y + range) * invCell);
  const minCz = Math.floor((z - range) * invCell);
  const maxCz = Math.floor((z + range) * invCell);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const start = _gridStarts.get(hashKey(cx, cy, cz));
        if (start === undefined) continue;
        const count = _gridCounts.get(hashKey(cx, cy, cz))!;
        for (let k = 0; k < count; k++) {
          _neighbors[nc++] = _gridSorted[start + k];
        }
      }
    }
  }
  return nc;
}

/**
 * Initialise boid particles from surface-sampled positions and normals.
 * Positions become `home` coordinates; initial positions are offset slightly
 * along the surface normal so the flock starts near but not exactly on the mesh.
 */
export function createBoidParticles(
  positions: Float32Array,
  normals: Float32Array,
  count: number,
  surfaceOffset: number,
): IBoidParticle[] {
  const particles: IBoidParticle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const hx = positions[o];
    const hy = positions[o + 1];
    const hz = positions[o + 2];
    const nx = normals[o];
    const ny = normals[o + 1];
    const nz = normals[o + 2];

    const jitter = 0.01;
    const ivx = (Math.random() - 0.5) * 0.004;
    const ivy = (Math.random() - 0.5) * 0.004;
    const ivz = (Math.random() - 0.5) * 0.004;
    particles[i] = {
      x: hx + nx * surfaceOffset + (Math.random() - 0.5) * jitter,
      y: hy + ny * surfaceOffset + (Math.random() - 0.5) * jitter,
      z: hz + nz * surfaceOffset + (Math.random() - 0.5) * jitter,
      vx: ivx,
      vy: ivy,
      vz: ivz,
      homeX: hx + nx * surfaceOffset,
      homeY: hy + ny * surfaceOffset,
      homeZ: hz + nz * surfaceOffset,
      normalX: nx,
      normalY: ny,
      normalZ: nz,
      size: 1,
      opacity: 1,
      noiseAngle: Math.random() * Math.PI * 2,
      noiseSpeed: 0.008 + Math.random() * 0.02,
      prevVX: ivx,
      prevVY: ivy,
      prevVZ: ivz,
      queuedTurnX: 0,
      queuedTurnY: 0,
      queuedTurnZ: 0,
    };
  }
  return particles;
}

/**
 * Performance threshold: above this count we only run neighbor queries on a
 * subset of particles each frame to stay within budget.
 */
const PARTIAL_UPDATE_THRESHOLD = 4000;

let partialOffset = 0;

const TURN_DETECT_COS = 0.85;
const TURN_DETECT_COS_SQ = TURN_DETECT_COS * TURN_DETECT_COS;
const TURN_MIN_SPD_SQ = 0.000001;
const TURN_PROPAGATION_RATE = 0.4;
const TURN_QUEUE_DECAY = 0.6;

/**
 * Advance all boid particles one frame.
 *
 * `elapsed` is the R3F clock time in seconds — used to drive the sweeping
 * attractor and the periodic split pulse that creates murmuration-like
 * splitting / merging behavior.
 */
export function stepBoids(
  particles: IBoidParticle[],
  params: IBoidParams,
  elapsed: number,
): void {
  const {
    alignmentFactor,
    attractorFactor,
    cohesionFactor,
    homeSpringFactor,
    maxHomeDistance,
    minSpeed,
    noiseMagnitude,
    orbitRadius,
    orbitSpeed,
    separationDist,
    separationFactor,
    speedLimit,
    splitDecay,
    splitIntensity,
    splitSpeed,
    steeringInertia,
    velocityStretchFactor,
    visualRange,
  } = params;

  const n = particles.length;
  if (n === 0) return;

  // Ensure neighbor buffer fits all particles (worst case)
  if (_neighbors.length < n) {
    _neighbors = new Int32Array(n * 2);
  }

  // --- First pass: flock average velocity + snapshot prevV for turn detection ---
  let flockVX = 0;
  let flockVY = 0;
  let flockVZ = 0;
  for (let i = 0; i < n; i++) {
    const p = particles[i];
    flockVX += p.vx;
    flockVY += p.vy;
    flockVZ += p.vz;
    p.prevVX = p.vx;
    p.prevVY = p.vy;
    p.prevVZ = p.vz;
  }
  flockVX /= n;
  flockVY /= n;
  flockVZ /= n;
  const flockSpeed =
    Math.sqrt(flockVX * flockVX + flockVY * flockVY + flockVZ * flockVZ) ||
    0.001;
  const headX = flockVX / flockSpeed;
  const headY = flockVY / flockSpeed;
  const headZ = flockVZ / flockSpeed;

  // --- Attractor: large sweeping arcs (low-frequency Lissajous + drift) ---
  const t = elapsed * orbitSpeed;
  const r = orbitRadius;
  const attractX =
    Math.sin(t * 0.07) * 0.6 * r +
    Math.sin(t * 0.03 + 2.1) * 0.3 * r +
    Math.sin(t * 0.17 + 0.8) * 0.1 * r;
  const attractY =
    Math.cos(t * 0.05) * 0.5 * r +
    Math.sin(t * 0.025 + 1.3) * 0.25 * r +
    Math.cos(t * 0.13 + 1.7) * 0.08 * r;
  const attractZ =
    Math.sin(t * 0.06 + 1.0) * 0.55 * r +
    Math.cos(t * 0.035 + 0.5) * 0.28 * r +
    Math.sin(t * 0.15 + 2.5) * 0.09 * r;

  // --- Split pulse along flock heading perpendicular ---
  const st = elapsed * splitSpeed;
  const pulse1 = Math.pow(Math.max(0, Math.sin(st * 0.3)), 12);
  const pulse2 = Math.pow(Math.max(0, Math.sin(st * 0.19 + 1.5)), 12);
  const autoSplit = Math.max(pulse1, pulse2) * splitIntensity;

  // Split plane perpendicular to flock heading
  let perpX: number;
  let perpY: number;
  let perpZ: number;
  if (Math.abs(headY) < 0.9) {
    perpX = headZ;
    perpY = 0;
    perpZ = -headX;
  } else {
    perpX = 0;
    perpY = -headZ;
    perpZ = headY;
  }
  const perpLen = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ) || 1;
  perpX /= perpLen;
  perpY /= perpLen;
  perpZ /= perpLen;

  const splitRot = st * 0.15 + Math.sin(st * 0.07) * 0.5;
  const cosR = Math.cos(splitRot);
  const sinR = Math.sin(splitRot);
  const p2X = headY * perpZ - headZ * perpY;
  const p2Y = headZ * perpX - headX * perpZ;
  const p2Z = headX * perpY - headY * perpX;
  const splitNX = perpX * cosR + p2X * sinR;
  const splitNY = perpY * cosR + p2Y * sinR;
  const splitNZ = perpZ * cosR + p2Z * sinR;
  const splitStrength = 0.02;

  // --- Spatial grid (counting-sort into pre-allocated flat buffer) ---
  const cellSize = Math.max(visualRange, 0.01);
  buildGrid(particles, cellSize, n);
  const vrSq = visualRange * visualRange;
  const sepSq = separationDist * separationDist;
  const maxHomeSq = maxHomeDistance * maxHomeDistance;

  const doPartial = n > PARTIAL_UPDATE_THRESHOLD;
  const batchSize = doPartial ? Math.min(n, Math.ceil(n * 0.5)) : n;
  const startIdx = doPartial ? partialOffset % n : 0;
  if (doPartial) {
    partialOffset = (partialOffset + batchSize) % n;
  }

  const oneMinusInertia = 1 - steeringInertia;

  // --- Main update loop ---
  for (let i = 0; i < n; i++) {
    const p = particles[i];

    const oldVX = p.vx;
    const oldVY = p.vy;
    const oldVZ = p.vz;

    const doNeighborQuery =
      !doPartial ||
      (i >= startIdx && i < startIdx + batchSize) ||
      (startIdx + batchSize > n && i < (startIdx + batchSize) % n);

    if (doNeighborQuery) {
      let sepX = 0;
      let sepY = 0;
      let sepZ = 0;
      let aliX = 0;
      let aliY = 0;
      let aliZ = 0;
      let cohX = 0;
      let cohY = 0;
      let cohZ = 0;
      let neighbors = 0;
      let cohCount = 0;

      const pSpd = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 0.001;
      const pDirX = p.vx / pSpd;
      const pDirY = p.vy / pSpd;
      const pDirZ = p.vz / pSpd;

      let turnAccX = 0;
      let turnAccY = 0;
      let turnAccZ = 0;

      const nc = queryNeighbors(p.x, p.y, p.z, visualRange, cellSize);
      for (let k = 0; k < nc; k++) {
        const j = _neighbors[k];
        if (j === i) continue;
        const o = particles[j];
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const dz = o.z - p.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < vrSq) {
          neighbors++;
          aliX += o.vx;
          aliY += o.vy;
          aliZ += o.vz;

          // Asymmetric cohesion: only toward neighbors AHEAD in travel direction
          const ahead = dx * pDirX + dy * pDirY + dz * pDirZ;
          if (ahead > 0) {
            cohX += o.x;
            cohY += o.y;
            cohZ += o.z;
            cohCount++;
          }

          if (distSq < sepSq) {
            const dist = Math.sqrt(distSq) || 1;
            sepX -= dx / dist;
            sepY -= dy / dist;
            sepZ -= dz / dist;
          }

          // Turn detection — sqrt-free: compare dot² against cos²·spd² products
          const oPrevSpdSq =
            o.prevVX * o.prevVX + o.prevVY * o.prevVY + o.prevVZ * o.prevVZ;
          const oCurSpdSq = o.vx * o.vx + o.vy * o.vy + o.vz * o.vz;
          if (oPrevSpdSq > TURN_MIN_SPD_SQ && oCurSpdSq > TURN_MIN_SPD_SQ) {
            const dot = o.vx * o.prevVX + o.vy * o.prevVY + o.vz * o.prevVZ;
            if (
              dot < 0 ||
              dot * dot < TURN_DETECT_COS_SQ * oCurSpdSq * oPrevSpdSq
            ) {
              const turnScale = 1 / (1 + distSq * 80);
              turnAccX += (o.vx - o.prevVX) * turnScale;
              turnAccY += (o.vy - o.prevVY) * turnScale;
              turnAccZ += (o.vz - o.prevVZ) * turnScale;
            }
          }
        }
      }

      if (neighbors > 0) {
        aliX /= neighbors;
        aliY /= neighbors;
        aliZ /= neighbors;
        p.vx += (aliX - p.vx) * alignmentFactor;
        p.vy += (aliY - p.vy) * alignmentFactor;
        p.vz += (aliZ - p.vz) * alignmentFactor;
      }

      if (cohCount > 0) {
        cohX /= cohCount;
        cohY /= cohCount;
        cohZ /= cohCount;
        p.vx += (cohX - p.x) * cohesionFactor;
        p.vy += (cohY - p.y) * cohesionFactor;
        p.vz += (cohZ - p.z) * cohesionFactor;
      }

      p.vx += sepX * separationFactor;
      p.vy += sepY * separationFactor;
      p.vz += sepZ * separationFactor;

      p.queuedTurnX += turnAccX;
      p.queuedTurnY += turnAccY;
      p.queuedTurnZ += turnAccZ;
    }

    // Velocity-aligned stretch: bias along the flock's travel direction
    const dotHead = p.vx * headX + p.vy * headY + p.vz * headZ;
    p.vx += headX * dotHead * velocityStretchFactor;
    p.vy += headY * dotHead * velocityStretchFactor;
    p.vz += headZ * dotHead * velocityStretchFactor;

    // Attractor — gentle sweep
    p.vx += (attractX - p.x) * attractorFactor;
    p.vy += (attractY - p.y) * attractorFactor;
    p.vz += (attractZ - p.z) * attractorFactor;

    // Split pulse — push to opposite sides of the flock-perpendicular plane
    if (autoSplit > 0.05) {
      const tcx = p.x - attractX;
      const tcy = p.y - attractY;
      const tcz = p.z - attractZ;
      const dToPlane = tcx * splitNX + tcy * splitNY + tcz * splitNZ;
      const sign = dToPlane > 0 ? 1 : -1;
      const prox = Math.exp(-Math.abs(dToPlane) * splitDecay);
      const sf = sign * autoSplit * splitStrength * prox;
      p.vx += splitNX * sf + headX * sf * 0.3 * sign;
      p.vy += splitNY * sf + headY * sf * 0.3 * sign;
      p.vz += splitNZ * sf + headZ * sf * 0.3 * sign;
    }

    // Home spring — very gentle, ramps beyond maxHomeDistance
    const dhx = p.homeX - p.x;
    const dhy = p.homeY - p.y;
    const dhz = p.homeZ - p.z;
    const homeDist2 = dhx * dhx + dhy * dhy + dhz * dhz;
    let springK = homeSpringFactor;
    if (homeDist2 > maxHomeSq) {
      springK *= 1 + (Math.sqrt(homeDist2) - maxHomeDistance) * 4;
    }
    p.vx += dhx * springK;
    p.vy += dhy * springK;
    p.vz += dhz * springK;

    // Noise
    p.noiseAngle += p.noiseSpeed;
    const noisePhi = p.noiseAngle;
    const noiseTheta = p.noiseAngle * 0.7 + i * 0.001;
    const sinPhi = Math.sin(noisePhi);
    const cosPhi = Math.cos(noisePhi);
    const sinTheta = Math.sin(noiseTheta);
    const cosTheta = Math.cos(noiseTheta);
    p.vx += cosPhi * sinTheta * noiseMagnitude;
    p.vy += sinPhi * noiseMagnitude;
    p.vz += cosPhi * cosTheta * noiseMagnitude;

    // Steering inertia: blend forces with previous velocity for momentum
    p.vx = oldVX * steeringInertia + p.vx * oneMinusInertia;
    p.vy = oldVY * steeringInertia + p.vy * oneMinusInertia;
    p.vz = oldVZ * steeringInertia + p.vz * oneMinusInertia;

    // Turn propagation (applied AFTER inertia so it bypasses damping)
    p.vx += p.queuedTurnX * TURN_PROPAGATION_RATE;
    p.vy += p.queuedTurnY * TURN_PROPAGATION_RATE;
    p.vz += p.queuedTurnZ * TURN_PROPAGATION_RATE;
    p.queuedTurnX *= TURN_QUEUE_DECAY;
    p.queuedTurnY *= TURN_QUEUE_DECAY;
    p.queuedTurnZ *= TURN_QUEUE_DECAY;

    // Speed clamp
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    if (speed > speedLimit) {
      const s = speedLimit / speed;
      p.vx *= s;
      p.vy *= s;
      p.vz *= s;
    } else if (speed > 0 && speed < minSpeed) {
      const s = minSpeed / speed;
      p.vx *= s;
      p.vy *= s;
      p.vz *= s;
    }

    // Integrate
    p.x += p.vx;
    p.y += p.vy;
    p.z += p.vz;
  }
}
