import { useFrame } from "@react-three/fiber";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Points } from "three";

import type { IParticleV2 } from "../sim/particleSimV2";

/* eslint-disable react-hooks/immutability -- ShaderMaterial uniforms are mutated each frame by Three.js */
/* eslint-disable react-hooks/refs -- Pattern: ref.current = prop during render for stale-closure-free useFrame access */

/** Max particle count — buffer is pre-allocated to this size. */
export const PARTICLE_CAPACITY_V2 = 20_000;

export interface IParticleSystemV2Props {
  /** Particle array — identity is stable, contents mutated each frame by SceneV2. */
  particles: IParticleV2[];
  /** Actual number of particles to render (≤ PARTICLE_CAPACITY_V2). */
  count: number;
  particleSize: number;
  color: string;
  opacity: number;
  opacityMultiplier?: number;
  /**
   * 0 = no depth/normal variation (uniform look).
   * 0.45 = subtle — gentle shading, slight silhouette emphasis.
   * 0.82 = strong — back-facing normals fade significantly, clear depth.
   */
  depthOpacityStrength?: number;
}

const LIGHT_WORLD_DIR = new Vector3(0.5, 0.8, 0.35).normalize();
const DEPTH_SPAN_HINT = 12.0;

function makeUniforms(color: string) {
  const hex = parseInt(color.replace("#", ""), 16);
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return {
    baseColor: { value: new Vector3(r, g, b) },
    baseOpacity: { value: 1.0 },
    depthOpacityStrength: { value: 0.0 },
    particleWorldRadius: { value: 0.002 },
    focalPixelScale: { value: 500.0 },
    camWorldPos: { value: new Vector3() },
    lightWorldDir: { value: LIGHT_WORLD_DIR.clone() },
    depthSpanHint: { value: DEPTH_SPAN_HINT },
  };
}

export default function ParticleSystemV2(props: IParticleSystemV2Props) {
  const {
    particles,
    count,
    particleSize,
    color,
    opacity,
    opacityMultiplier = 1,
    depthOpacityStrength = 0,
  } = props;

  const pointsRef = useRef<Points>(null);
  const camScratch = useRef(new Vector3());

  // Per-frame mutable refs so the frame loop never captures stale closures
  const sizeRef = useRef(particleSize);
  sizeRef.current = particleSize;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const opacityMultRef = useRef(opacityMultiplier);
  opacityMultRef.current = opacityMultiplier;
  const depthOpacityRef = useRef(depthOpacityStrength);
  depthOpacityRef.current = depthOpacityStrength;

  // ── Typed arrays (pre-allocated to capacity) ───────────────────────────────
  // Rebuilt when count changes to match the new particle array length.
  const buffersRef = useRef<{
    pos: Float32Array;
    nrm: Float32Array;
    siz: Float32Array;
  } | null>(null);

  const [gpu] = useMemo(() => {
    const geo = new BufferGeometry();

    // Pre-allocate at max capacity; actual draw range set per-frame
    const pos = new Float32Array(PARTICLE_CAPACITY_V2 * 3);
    const nrm = new Float32Array(PARTICLE_CAPACITY_V2 * 3);
    const siz = new Float32Array(PARTICLE_CAPACITY_V2);

    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("instanceNormal", new BufferAttribute(nrm, 3));
    geo.setAttribute("instanceSize", new BufferAttribute(siz, 1));

    const uniforms = makeUniforms("#ffffff");
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      premultipliedAlpha: false,
      uniforms,
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
    });

    return [{ geo, mat, uniforms, pos, nrm, siz }] as const;
    // Stable — created once for the lifetime of this component
  }, []);

  const { geo, mat, uniforms, pos, nrm, siz } = gpu;

  // Keep buffer refs accessible in layout effects without re-creating buffers
  buffersRef.current = { pos, nrm, siz };

  // ── Sync base color from prop ──────────────────────────────────────────────
  useEffect(() => {
    const hex = parseInt(color.replace("#", ""), 16);
    uniforms.baseColor.value.set(
      ((hex >> 16) & 255) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255,
    );
  }, [color, uniforms]);

  // ── Write normals once per particle set (normals are static after spawn) ───
  useLayoutEffect(() => {
    const { nrm: nArray } = buffersRef.current!;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (!p) continue;
      const o = i * 3;
      nArray[o] = p.normalX;
      nArray[o + 1] = p.normalY;
      nArray[o + 2] = p.normalZ;
    }
    const nrmAttr = geo.getAttribute("instanceNormal") as BufferAttribute;
    nrmAttr.needsUpdate = true;
  }, [count, geo, particles]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat]);

  // ── Per-frame: write positions, sizes, and uniforms ────────────────────────
  useFrame((state) => {
    const pts = pointsRef.current;
    if (!pts || count <= 0 || particles.length === 0) return;

    const { pos: pArray, nrm: nArray, siz: sArray } = buffersRef.current!;
    const s = sizeRef.current;

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const o = i * 3;
      pArray[o] = p.x;
      pArray[o + 1] = p.y;
      pArray[o + 2] = p.z;
      sArray[i] = p.size;
      // Write normals each frame so surfaceDepthBias resampling is reflected immediately
      nArray[o] = p.normalX;
      nArray[o + 1] = p.normalY;
      nArray[o + 2] = p.normalZ;
    }

    const posAttr = geo.getAttribute("position") as BufferAttribute;
    posAttr.needsUpdate = true;
    const sizAttr = geo.getAttribute("instanceSize") as BufferAttribute;
    sizAttr.needsUpdate = true;
    const nrmAttr = geo.getAttribute("instanceNormal") as BufferAttribute;
    nrmAttr.needsUpdate = true;
    geo.setDrawRange(0, count);

    // Uniforms
    const effectiveOpacity = opacityRef.current * opacityMultRef.current;
    uniforms.baseOpacity.value = effectiveOpacity;
    uniforms.depthOpacityStrength.value = depthOpacityRef.current;
    // World radius = sphere-equivalent radius so on-screen size matches prior InstancedMesh
    uniforms.particleWorldRadius.value = 0.625 * s;

    state.camera.getWorldPosition(camScratch.current);
    uniforms.camWorldPos.value.copy(camScratch.current);

    // focalPixelScale = focalLength × drawingBufferHeight (device pixels).
    // Using state.size.height × dpr gives the physical pixel count the GPU actually renders.
    // The old state.viewport.height was in world-space units (~4), making computed
    // gl_PointSize ~400× too small and clamped to 1.5 px regardless of the size slider.
    const pr = state.camera.projectionMatrix.elements[5];
    uniforms.focalPixelScale.value = state.size.height * state.viewport.dpr * pr;
    uniforms.lightWorldDir.value.copy(LIGHT_WORLD_DIR);
  });

  return (
    <points
      ref={pointsRef}
      geometry={geo}
      material={mat}
      frustumCulled={false}
      renderOrder={10}
    />
  );
}

// ── Shaders ──────────────────────────────────────────────────────────────────

const VERT_SHADER = /* glsl */ `
attribute vec3 instanceNormal;
attribute float instanceSize;

uniform vec3 camWorldPos;
uniform vec3 lightWorldDir;
uniform vec3 baseColor;
uniform float baseOpacity;
uniform float depthOpacityStrength;
uniform float particleWorldRadius;
uniform float focalPixelScale;
uniform float depthSpanHint;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 V = normalize(camWorldPos - worldPos.xyz);
  vec3 N = normalize(instanceNormal);

  // Camera-facing factor: 1 = front-facing normal, 0 = back-facing
  float NdotV = dot(N, V);
  float facing = clamp(NdotV, 0.0, 1.0);
  // Silhouette rim: 1 = edge-on (rim), 0 = pole
  float rim = 1.0 - clamp(abs(NdotV), 0.0, 1.0);

  // Normal-based opacity — back-facing normals fade; rims get contour boost
  float normalMod = mix(1.0, max(0.2, facing + rim * 0.45), depthOpacityStrength);

  // Directional light contribution to brightness
  float NdL = clamp(dot(N, lightWorldDir), 0.0, 1.0);
  float lightTint = mix(1.0, 0.5 + 0.6 * NdL, depthOpacityStrength * 0.55);

  // Distance-based fade (far particles dim slightly)
  float dist = length(camWorldPos - worldPos.xyz);
  float nDist = clamp(dist / depthSpanHint, 0.0, 1.0);
  float depthMod = mix(1.0, 1.0 - 0.45 * nDist, depthOpacityStrength);

  vColor = baseColor * lightTint;
  vAlpha = clamp(baseOpacity * normalMod * depthMod, 0.001, 1.0);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float invZ = max(0.002, -mvPosition.z);
  gl_PointSize = clamp(particleWorldRadius * instanceSize * focalPixelScale / invZ, 1.5, 20.0);
}
`;

const FRAG_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float soft = 1.0 - smoothstep(0.32, 0.5, r);
  gl_FragColor = vec4(vColor, vAlpha * soft);
}
`;
