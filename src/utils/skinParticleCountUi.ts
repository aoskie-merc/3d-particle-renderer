const MIN_SKIN = 5000;
const STEP = 256;

export const SKIN_PARTICLE_CAPACITY = 262_144;

/** Snap requested skin particle count to UI/store constraints (5000–262144). */
export function snapSkinParticleCountForUi(raw: number): number {
  if (!Number.isFinite(raw)) {
    return MIN_SKIN;
  }
  let next = Math.round(raw / STEP) * STEP;
  next = Math.max(MIN_SKIN, Math.min(SKIN_PARTICLE_CAPACITY, next));

  return next;
}
