/**
 * Mercury (Roman god) bust icon: crisp cameo silhouette + particle dots for dissolution.
 * Monochrome via currentColor (theme accent from .icon).
 */

import styles from './DropLanding.module.css';

/** Main silhouette — right-facing profile, petasos wing, neck & shoulders (cameo-style). */
const SILHOUETTE_D =
  'M 4 44 C 1 30 3 14 18 9 C 32 4 48 7 56 14 C 62 21 62 32 59 40 ' +
  'C 58 50 52 58 42 61 C 32 64 22 65 16 70 C 12 74 20 77 38 77 ' +
  'C 52 77 62 74 60 68';

/** Inner wing / temple arc (lighter stroke, petasos readability). */
const WING_DETAIL_D = 'M 9 40 C 7 28 11 15 22 11 C 34 8 46 12 52 16';

interface IDot {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly o: number;
}

/** Decorative dots along contours + drifting particles (opacity 0.2–0.6). */
function buildParticleDots(): readonly IDot[] {
  const dots: IDot[] = [];

  const add = (cx: number, cy: number, r: number, o: number): void => {
    dots.push({ cx, cy, r, o });
  };

  /** Drift off silhouette (dim) */

  const drifts: readonly (readonly [number, number, number, number])[] = [
    [1, 24, 0.6, 0.22],
    [0, 52, 0.55, 0.26],
    [72, 18, 0.65, 0.28],
    [73, 55, 0.55, 0.24],
    [68, 72, 0.7, 0.3],
    [6, 68, 0.6, 0.32],
    [14, 4, 0.5, 0.35],
    [58, 2, 0.55, 0.3],
  ];
  drifts.forEach(([cx, cy, r, o]) => add(cx, cy, r, o));

  /** Wing edge scatter */
  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    add(4 + t * 10, 26 + Math.sin(t * 3.1) * 6, 0.5 + (i % 3) * 0.25, 0.35 + t * 0.15);
  }

  /** Crown / helmet rim */
  for (let i = 0; i < 10; i += 1) {
    const t = i / 9;
    add(22 + t * 28, 9 + Math.sin(t * Math.PI) * 2.5, 0.6 + (i % 2) * 0.35, 0.4 + t * 0.12);
  }

  /** Face profile ribbon (offset outside outline) */

  const faceRibbon: readonly (readonly [number, number])[] = [
    [54, 22],
    [58, 30],
    [59, 38],
    [57, 46],
    [51, 54],
    [42, 58],
    [33, 59],
  ];
  faceRibbon.forEach(([x, y], i) => {
    add(x + 1.2, y - 0.6, 0.55 + (i % 3) * 0.3, 0.42 + (i % 4) * 0.04);
    add(x + 2.4, y + 0.8, 0.45, 0.28); /* dissolve outward */
  });

  /** Chin → neck */

  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    add(24 - t * 6, 62 + t * 10, 0.55, 0.38 + t * 0.1);
  }

  /** Shoulder dissolution */

  for (let i = 0; i < 9; i += 1) {
    const t = i / 8;
    add(18 + t * 32, 76 + Math.sin(t * 6) * 1.2, 0.5 + (i % 4) * 0.28, 0.32 + (1 - t) * 0.2);
  }

  /** Back-of-head halo */
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    add(14 + t * 5, 18 + t * 22, 0.5, 0.34 + t * 0.08);
  }

  return dots;
}

const PARTICLE_DOTS = buildParticleDots();

const outlineProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.35,
  strokeOpacity: 0.88,
};

const wingDetailProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.15,
  strokeOpacity: 0.42,
};

export default function MercuryBustIcon() {
  return (
    <svg
      aria-hidden
      className={styles.icon}
      fill="none"
      height="76"
      viewBox="0 0 74 76"
      width="74"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g>
        {/* Structural silhouette */}
        <path d={SILHOUETTE_D} {...outlineProps} />
        <path d={WING_DETAIL_D} {...wingDetailProps} />

        {/* Particle dissolution */}
        {PARTICLE_DOTS.map((dot: IDot, index: number) => (
          <circle
            key={`mercury-particle-${index}`}
            cx={dot.cx}
            cy={dot.cy}
            fill="currentColor"
            fillOpacity={dot.o}
            r={dot.r}
          />
        ))}
      </g>
    </svg>
  );
}
