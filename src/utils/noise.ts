/**
 * Lightweight 3D turbulence for vibration layering (no heavy deps).
 * Combines phased sinusoids — enough for organic shimmering motion at scale.
 */
export function turbulence3(x: number, y: number, z: number, t: number): number {
  const wx = x * 1.7 + y * 0.3 + t * 0.82;
  const wy = y * 1.3 - z * 0.91 + t * 0.64;
  const wz = z * 1.51 + x * 0.41 - t * 0.71;
  let v = Math.sin(wx) * Math.cos(wy) + Math.sin(wy + wz * 1.07) * 0.62;
  v += Math.sin(wx * 2.07 + wy * -1.41) * 0.35;
  v += Math.cos(wz * 1.89 + wx * -0.33 + t * 1.73) * 0.26;
  return v;
}
