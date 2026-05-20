/**
 * Decorative 2D canvas: particles emit from the drop panel center, gain noise with distance,
 * and fade out toward the viewport edge.
 */

import type { RefObject } from 'react';
import { memo, useEffect, useRef } from 'react';

import type { TMercuryAppearance } from '../theme';
import { mercuryDefaultParticleHex } from '../theme';

import styles from './LandingParticles.module.css';

const ACTIVE_COUNT = 120;
const BASE_ALPHA = 0.72;
const INNER_REVEAL_FR = 0.058;
const NOISE_DISTANCE_POWER = 1.62;

interface ILandingParticlesProps {
  anchorRef: RefObject<HTMLElement | null>;
  appearance: TMercuryAppearance;
}

interface IParticleSim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  noiseSeed: number;
  phaseB: number;
  dotR: number;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((char: string): string => char + char)
      .join('');
  }
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) {
    return [250, 240, 228];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function respawn(particle: IParticleSim, cxCss: number, cyCss: number): void {
  const theta = Math.random() * Math.PI * 2;
  const speed = 52 + Math.random() * 88;

  particle.noiseSeed = Math.random() * Math.PI * 2;
  particle.phaseB = Math.random() * Math.PI * 2;
  particle.dotR = 1.1 + Math.random() * 1.9;
  particle.x = cxCss + Math.cos(theta) * 1.5;
  particle.y = cyCss + Math.sin(theta) * 1.5;
  particle.vx = Math.cos(theta) * speed;
  particle.vy = Math.sin(theta) * speed;
  particle.t = 0;
}

function ensurePool(poolRef: { current: IParticleSim[] }): void {
  if (poolRef.current.length === ACTIVE_COUNT) return;
  poolRef.current = [];
  while (poolRef.current.length < ACTIVE_COUNT) {
    poolRef.current.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      t: 0,
      noiseSeed: 0,
      phaseB: 0,
      dotR: 2,
    });
  }
}

function initPoolAt(poolRef: { current: IParticleSim[] }, cxCss: number, cyCss: number): void {
  ensurePool(poolRef);
  for (const particle of poolRef.current) {
    respawn(particle, cxCss, cyCss);
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const LandingParticles = memo(function LandingParticles(props: ILandingParticlesProps) {
  const { anchorRef, appearance } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poolRef = useRef<IParticleSim[]>([]);
  const lastTsRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return undefined;

    const ctxRaw = canvas.getContext('2d');

    if (!ctxRaw) return undefined;

    const ctx = ctxRaw;

    const rgbCsv = hexToRgbTuple(mercuryDefaultParticleHex(appearance)).join(', ');

    let rafId = 0;

    const resizeAndRespawnAll = (): void => {
      const parent = canvas.parentElement;
      const cssW = Math.max(8, Math.floor(parent?.clientWidth ?? window.innerWidth));
      const cssH = Math.max(8, Math.floor(parent?.clientHeight ?? window.innerHeight));
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio ?? 1));

      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);

      let cxCss = cssW / 2;
      let cyCss = cssH / 2;

      if (anchorRef.current) {
        const ar = anchorRef.current.getBoundingClientRect();
        const lr = canvas.getBoundingClientRect();

        cxCss = ar.left + ar.width / 2 - lr.left;
        cyCss = ar.top + ar.height / 2 - lr.top;
      }

      initPoolAt(poolRef, cxCss, cyCss);
    };

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            resizeAndRespawnAll();
          })
        : null;

    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    window.addEventListener('resize', resizeAndRespawnAll);
    resizeAndRespawnAll();

    lastTsRef.current = 0;

    const tick = (now: number): void => {
      rafId = window.requestAnimationFrame(tick);

      const previous = lastTsRef.current === 0 ? now : lastTsRef.current;

      lastTsRef.current = now;

      let dt = (now - previous) / 1000;

      if (!Number.isFinite(dt)) dt = 1 / 60;

      dt = Math.min(dt, 0.05);

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;

      let cxCss = cssW / 2;
      let cyCss = cssH / 2;

      if (anchorRef.current) {
        const ar = anchorRef.current.getBoundingClientRect();
        const lr = canvas.getBoundingClientRect();

        cxCss = ar.left + ar.width / 2 - lr.left;
        cyCss = ar.top + ar.height / 2 - lr.top;
      }

      const fadeDist = Math.hypot(cssW, cssH) * 0.52;

      const innerRevealPx = Math.max(22, fadeDist * INNER_REVEAL_FR);

      ensurePool(poolRef);

      ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0);
      ctx.clearRect(0, 0, cssW + 4, cssH + 4);

      const rgb = rgbCsv;

      for (const particle of poolRef.current) {
        particle.t += dt;

        const rdx = particle.x - cxCss;
        const rdy = particle.y - cyCss;

        const distCss = Math.hypot(rdx, rdy);

        let rxOut: number;
        let ryOut: number;

        if (distCss > 14) {
          rxOut = rdx / distCss;
          ryOut = rdy / distCss;
        } else {
          const speedMag = Math.hypot(particle.vx, particle.vy);

          if (speedMag > 8) {
            rxOut = particle.vx / speedMag;
            ryOut = particle.vy / speedMag;
          } else {
            rxOut = 1;
            ryOut = 0;
          }
        }

        const px = -ryOut;
        const py = rxOut;

        const noiseT = clamp01(
          (distCss - innerRevealPx * 0.4) / Math.max(18, fadeDist * 0.72),
        );

        const noiseMag = noiseT ** NOISE_DISTANCE_POWER;

        const w1 = Math.sin(particle.t * 10.2 + particle.noiseSeed);
        const w2 = Math.cos(particle.t * 6.7 + particle.phaseB);

        /** Perpendicular jitter grows with distance from emitter. */

        particle.vx += (w1 * px + w2 * py * 0.35) * noiseMag * 62 * dt;
        particle.vy += (w1 * py - w2 * px * 0.35) * noiseMag * 62 * dt;

        /** Mild outward bias so motion stays generally radial. */

        particle.vx += rxOut * 14 * dt;
        particle.vy += ryOut * 14 * dt;

        particle.vx *= 1 - 0.22 * dt;
        particle.vy *= 1 - 0.22 * dt;

        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;

        const postDist = Math.hypot(particle.x - cxCss, particle.y - cyCss);

        const innerAlpha = clamp01((postDist - 1) / innerRevealPx);

        const edgeAlpha = 1 - clamp01((postDist - fadeDist * 0.28) / (fadeDist * 0.78));

        const alpha = BASE_ALPHA * innerAlpha * edgeAlpha;

        if (alpha < 0.018 || postDist > fadeDist * 1.12) {
          respawn(particle, cxCss, cyCss);
          continue;
        }

        ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(4)})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', resizeAndRespawnAll);
    };
  }, [anchorRef, appearance]);

  return (
    <div aria-hidden className={styles.root}>
      <canvas className={styles.canvas} ref={canvasRef} />
    </div>
  );
});

export default LandingParticles;
