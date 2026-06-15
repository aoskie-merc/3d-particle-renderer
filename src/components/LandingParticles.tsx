/**
 * Decorative 2D canvas: boid particles swarm around the upload panel center
 * in murmuration patterns, fading out toward the viewport edge.
 */

import type { RefObject } from "react";
import { memo, useEffect, useRef } from "react";

import type { IBoid2DParams } from "../sim/boids2d";
import {
  BOID_2D_DEFAULTS,
  createBoid2DParticles,
  repositionBoid2DParticles,
  stepBoids2D,
} from "../sim/boids2d";
import { BOID_DEFAULTS } from "../sim/boidParams";
import type { TMercuryAppearance } from "../theme";
import { mercuryDefaultParticleHex } from "../theme";

import styles from "./LandingParticles.module.css";

const BASE_ALPHA = 0.72;
const INNER_REVEAL_PX = 14;
const TWO_PI = Math.PI * 2;

interface ILandingParticlesProps {
  anchorRef: RefObject<HTMLElement | null>;
  appearance: TMercuryAppearance;
  boidAlignment: number;
  boidCohesion: number;
  boidNoise: number;
  boidSeparation: number;
  boidSpeedLimit: number;
  boidVisualRange: number;
  landingParticleCount: number;
  landingParticleSize: number;
  swarmOrbitSpeed: number;
  swarmOrbitRadius: number;
  swarmSplitIntensity: number;
  swarmSplitSpeed: number;
}

/**
 * Map a 3D slider value to its 2D pixel-space equivalent by scaling
 * proportionally: 2dValue = 2dDefault * (sliderValue / 3dDefault).
 */
function scale2D(
  slider3D: number,
  default3D: number,
  default2D: number,
): number {
  if (default3D === 0) return default2D;
  return default2D * (slider3D / default3D);
}

function hexToRgbTuple(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((char: string): string => char + char)
      .join("");
  }
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) {
    return [250, 240, 228];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const LandingParticles = memo(function LandingParticles(
  props: ILandingParticlesProps,
) {
  const {
    anchorRef,
    appearance,
    boidAlignment,
    boidCohesion,
    boidNoise,
    boidSeparation,
    boidSpeedLimit,
    boidVisualRange,
    landingParticleCount,
    landingParticleSize,
    swarmOrbitSpeed,
    swarmOrbitRadius,
    swarmSplitIntensity,
    swarmSplitSpeed,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boidsRef = useRef<ReturnType<typeof createBoid2DParticles>>([]);
  const countRef = useRef(landingParticleCount);
  countRef.current = landingParticleCount;
  const elapsedRef = useRef(0);
  const lastTsRef = useRef(0);
  const centerRef = useRef({ cx: 0, cy: 0 });

  const particleSizeRef = useRef(landingParticleSize);
  particleSizeRef.current = landingParticleSize;

  const paramsRef = useRef<IBoid2DParams>({ ...BOID_2D_DEFAULTS });

  paramsRef.current = {
    ...BOID_2D_DEFAULTS,
    visualRange: scale2D(
      boidVisualRange,
      BOID_DEFAULTS.visualRange,
      BOID_2D_DEFAULTS.visualRange,
    ),
    separationDist: scale2D(
      boidVisualRange,
      BOID_DEFAULTS.visualRange,
      BOID_2D_DEFAULTS.separationDist,
    ),
    separationFactor: scale2D(
      boidSeparation,
      BOID_DEFAULTS.separationFactor,
      BOID_2D_DEFAULTS.separationFactor,
    ),
    alignmentFactor: scale2D(
      boidAlignment,
      BOID_DEFAULTS.alignmentFactor,
      BOID_2D_DEFAULTS.alignmentFactor,
    ),
    cohesionFactor: scale2D(
      boidCohesion,
      BOID_DEFAULTS.cohesionFactor,
      BOID_2D_DEFAULTS.cohesionFactor,
    ),
    speedLimit: scale2D(
      boidSpeedLimit,
      BOID_DEFAULTS.speedLimit,
      BOID_2D_DEFAULTS.speedLimit,
    ),
    minSpeed: scale2D(
      boidSpeedLimit,
      BOID_DEFAULTS.speedLimit,
      BOID_2D_DEFAULTS.minSpeed,
    ),
    noiseMagnitude: scale2D(
      boidNoise,
      BOID_DEFAULTS.noiseMagnitude,
      BOID_2D_DEFAULTS.noiseMagnitude,
    ),
    orbitSpeed: scale2D(
      swarmOrbitSpeed,
      BOID_DEFAULTS.orbitSpeed,
      BOID_2D_DEFAULTS.orbitSpeed,
    ),
    orbitRadiusX: scale2D(
      swarmOrbitRadius,
      BOID_DEFAULTS.orbitRadius,
      BOID_2D_DEFAULTS.orbitRadiusX,
    ),
    orbitRadiusY: scale2D(
      swarmOrbitRadius,
      BOID_DEFAULTS.orbitRadius,
      BOID_2D_DEFAULTS.orbitRadiusY,
    ),
    splitIntensity: scale2D(
      swarmSplitIntensity,
      BOID_DEFAULTS.splitIntensity,
      BOID_2D_DEFAULTS.splitIntensity,
    ),
    splitSpeed: scale2D(
      swarmSplitSpeed,
      BOID_DEFAULTS.splitSpeed,
      BOID_2D_DEFAULTS.splitSpeed,
    ),
  };

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return undefined;

    const ctxRaw = canvas.getContext("2d");

    if (!ctxRaw) return undefined;

    const ctx = ctxRaw;

    const [cr, cg, cb] = hexToRgbTuple(mercuryDefaultParticleHex(appearance));
    const solidFill = `rgb(${cr}, ${cg}, ${cb})`;

    let rafId = 0;

    const updateCenter = (): void => {
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      let cx = cssW / 2;
      let cy = cssH / 2;

      if (anchorRef.current) {
        const ar = anchorRef.current.getBoundingClientRect();
        const lr = canvas.getBoundingClientRect();

        cx = ar.left + ar.width / 2 - lr.left;
        cy = ar.top + ar.height / 2 - lr.top;
      }

      centerRef.current.cx = cx;
      centerRef.current.cy = cy;
    };

    const resizeCanvas = (): void => {
      const parent = canvas.parentElement;
      const cssW = Math.max(
        8,
        Math.floor(parent?.clientWidth ?? window.innerWidth),
      );
      const cssH = Math.max(
        8,
        Math.floor(parent?.clientHeight ?? window.innerHeight),
      );
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio ?? 1));

      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);

      updateCenter();
      const { cx, cy } = centerRef.current;

      const safeCount = Number.isFinite(landingParticleCount) && landingParticleCount > 0 ? Math.round(landingParticleCount) : 120;
      if (boidsRef.current.length === 0) {
        boidsRef.current = createBoid2DParticles(safeCount, cx, cy);
      } else {
        const valid = boidsRef.current.filter((b) => b != null);
        boidsRef.current = valid;
        if (valid.length > 0) {
          repositionBoid2DParticles(boidsRef.current, cx, cy);
        }
      }
    };

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resizeCanvas();
          })
        : null;

    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    lastTsRef.current = 0;
    elapsedRef.current = 0;

    const tick = (now: number): void => {
      rafId = window.requestAnimationFrame(tick);

      const previous = lastTsRef.current === 0 ? now : lastTsRef.current;

      lastTsRef.current = now;

      let dt = (now - previous) / 1000;

      if (!Number.isFinite(dt)) dt = 1 / 60;

      dt = Math.min(dt, 0.05);

      elapsedRef.current += dt;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;

      updateCenter();
      const { cx, cy } = centerRef.current;

      const rawCount = countRef.current;
      const target = Number.isFinite(rawCount) && rawCount > 0 ? Math.round(rawCount) : 120;
      const current = boidsRef.current.length;
      if (current < target) {
        const extra = createBoid2DParticles(target - current, cx, cy);
        for (let i = 0; i < extra.length; i++) {
          boidsRef.current.push(extra[i]);
        }
      } else if (current > target) {
        boidsRef.current.splice(target);
      }

      const fadeDist = Math.sqrt(cssW * cssW + cssH * cssH) * 0.52;
      const fadeInner = fadeDist * 0.28;
      const fadeRange = fadeDist * 0.78;
      const invFadeRange = fadeRange > 0 ? 1 / fadeRange : 0;

      stepBoids2D(boidsRef.current, paramsRef.current, elapsedRef.current, dt);

      ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0);
      ctx.clearRect(0, 0, cssW + 4, cssH + 4);

      ctx.fillStyle = solidFill;

      const boids = boidsRef.current;
      for (let bi = 0; bi < boids.length; bi++) {
        const boid = boids[bi];
        const dx = boid.x - cx;
        const dy = boid.y - cy;
        const distCss = Math.sqrt(dx * dx + dy * dy);

        const innerAlpha = clamp01((distCss - 1) / INNER_REVEAL_PX);

        const edgeAlpha = 1 - clamp01((distCss - fadeInner) * invFadeRange);

        const alpha = BASE_ALPHA * innerAlpha * edgeAlpha;

        if (alpha < 0.018) continue;

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(boid.x, boid.y, particleSizeRef.current, 0, TWO_PI);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [anchorRef, appearance]);

  return (
    <div aria-hidden className={styles.root}>
      <canvas className={styles.canvas} ref={canvasRef} />
    </div>
  );
});

export default LandingParticles;
