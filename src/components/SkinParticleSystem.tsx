import { useFrame, useThree } from "@react-three/fiber";

import { useEffect, useMemo, useRef, useState } from "react";

import type { BufferGeometry } from "three";
import {
  BufferAttribute,
  BufferGeometry as SkinGeometry,
  Color,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Points as PointsMesh } from "three";

import { sampleMeshSurface } from "../utils/surfaceSampler";

/* eslint-disable react-hooks/immutability -- ShaderMaterial uniforms & draw-range (Three.js uploads each frame). */

export interface ISkinParticleSystemProps {
  contourDensity: number;
  depthFade: number;
  geometry: BufferGeometry;
  normalShading: number;
  particleCount: number;
  particleSize: number;
  skinColor: string;
  skinOpacity: number;
  /** Y-plane of the sweep highlight; null/undefined = no highlight active. */
  sweepHighlightY?: number | null;
}

const LIGHT_WORLD_DIR = new Vector3(0.5, 0.8, 0.35).normalize();

/** Initial uniform bag for ShaderMaterial; values are rewritten every frame via Three.js refs. */
function skinUniformHandles() {
  return {
    camWorldPos: { value: new Vector3() },
    lightWorldDir: { value: LIGHT_WORLD_DIR.clone() },
    skinBaseRgb: { value: new Vector3(1, 1, 1) },
    skinOpacity: { value: 1 },
    skinNormalShading: { value: 0 },
    skinDepthFade: { value: 0 },
    skinContourDensity: { value: 0 },
    particleWorldRadius: { value: 1 },
    depthSpanHint: { value: 24 },
    focalPixelScale: { value: 420 },
    sweepHighlightY: { value: -999.0 },
    sweepHighlightActive: { value: 0.0 },
  };
}

/** Dense static surface particle cloud with depth/normal/silhouette shading. */
export default function SkinParticleSystem(props: ISkinParticleSystemProps) {
  const {
    contourDensity,
    depthFade,
    geometry,
    normalShading,
    particleCount,
    particleSize,
    skinColor,
    skinOpacity,
    sweepHighlightY = null,
  } = props;

  const { camera, viewport } = useThree();
  const pointsRef = useRef<PointsMesh>(null);
  const camScratch = useRef(new Vector3());
  const tintColor = useMemo(() => new Color(skinColor), [skinColor]);

  const samples = useMemo(
    () => sampleMeshSurface(geometry, particleCount, "areaWeighted"),
    [geometry, particleCount],
  );

  const pointsGeometry = useMemo(() => {
    const geo = new SkinGeometry();
    const pos = Float32Array.from(samples.positions);
    const nurm = Float32Array.from(samples.normals);
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("instanceNormal", new BufferAttribute(nurm, 3));
    return geo;
  }, [samples.normals, samples.positions]);

  const depthSpanHintDerived = useMemo(() => {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    return sphere && Number.isFinite(sphere.radius)
      ? Math.max(sphere.radius * 5.25, 2)
      : 24;
  }, [geometry]);

  /** Single Three ShaderMaterial bundle; uniforms are tweaked every frame outside React reconciliation. */
  const [skinGpu] = useState(() => {
    const uniforms = skinUniformHandles();

    const shaderMaterial = new ShaderMaterial({
      depthWrite: true,
      depthTest: true,
      transparent: true,
      blending: NormalBlending,
      premultipliedAlpha: false,
      uniforms,
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
    });

    return { shaderMaterial, uniforms };
  });

  const material = skinGpu.shaderMaterial;

  const drawable = samples.positions.length / 3;

  useEffect(() => {
    const mat = skinGpu.shaderMaterial;

    return (): void => {
      mat.dispose();
    };
  }, [skinGpu]);

  useEffect(() => {
    const geo = pointsGeometry;

    return (): void => {
      geo.dispose();
    };
  }, [pointsGeometry]);

  useFrame(() => {
    const uniforms = skinGpu.uniforms;

    uniforms.depthSpanHint.value = depthSpanHintDerived;

    uniforms.skinBaseRgb.value.set(tintColor.r, tintColor.g, tintColor.b);

    camera.getWorldPosition(camScratch.current);
    uniforms.camWorldPos.value.copy(camScratch.current);

    const projection = camera.projectionMatrix?.elements;
    const pr = typeof projection?.[5] === "number" ? projection[5] : 1;
    uniforms.focalPixelScale.value = (viewport.height * pr) / 2;

    uniforms.skinOpacity.value = skinOpacity;
    uniforms.skinNormalShading.value = normalShading;
    uniforms.skinDepthFade.value = depthFade;
    uniforms.skinContourDensity.value = contourDensity;
    uniforms.particleWorldRadius.value = particleSize * 8.0;
    uniforms.lightWorldDir.value.copy(LIGHT_WORLD_DIR);

    const highlightActive = sweepHighlightY !== null;
    uniforms.sweepHighlightY.value = highlightActive ? sweepHighlightY : -999.0;
    uniforms.sweepHighlightActive.value = highlightActive ? 1.0 : 0.0;

    const meshPoints = pointsRef.current;

    if (meshPoints !== null) {
      meshPoints.geometry.setDrawRange(0, drawable);
    }
  });

  return (
    <points
      ref={pointsRef}
      geometry={pointsGeometry}
      material={material}
      frustumCulled={false}
      renderOrder={-30}
      visible={drawable > 0}
    />
  );
}

const VERT_SHADER = /* glsl */ `
attribute vec3 instanceNormal;

uniform vec3 camWorldPos;
uniform vec3 lightWorldDir;
uniform vec3 skinBaseRgb;
uniform float skinOpacity;
uniform float skinNormalShading;
uniform float skinDepthFade;
uniform float skinContourDensity;
uniform float particleWorldRadius;
uniform float depthSpanHint;
uniform float focalPixelScale;
uniform float sweepHighlightY;
uniform float sweepHighlightActive;

varying vec3 vColor;
varying float vAlpha;
varying float vWorldY;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldY = worldPos.y;

  vec3 N = normalize(mat3(normalMatrix) * instanceNormal);
  vec3 V = normalize(camWorldPos - worldPos.xyz);

  float edge = 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0);

  float NdL = max(dot(N, lightWorldDir), 0.0);
  float normalOpacity = mix(1.0, NdL, skinNormalShading);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  float dist = length(camWorldPos - worldPos.xyz);
  float nDist = clamp(dist / depthSpanHint, 0.0, 1.0);
  float depthOpacityMul = clamp(1.0 - skinDepthFade * nDist, 0.0, 1.0);

  float contourGlow = pow(edge, 2.05);
  float contourAmp = mix(1.0, 1.0 + contourGlow * 0.62, clamp(skinContourDensity, 0.0, 1.0));
  float radialSize =
    particleWorldRadius
    * (1.0 - 0.3 * skinDepthFade * nDist)
    * mix(1.0, 1.0 + edge * 0.42, clamp(skinContourDensity, 0.0, 1.0));

  float litBoost = pow(mix(0.38, 1.0, NdL), mix(1.5, 0.86, clamp(skinNormalShading, 0.0, 1.0)));
  litBoost *= mix(1.0, 0.5 + depthOpacityMul * 0.76, clamp(skinDepthFade, 0.0, 1.0));
  litBoost *= contourAmp;

  vColor = skinBaseRgb * litBoost;

  vAlpha =
    clamp(
      skinOpacity * depthOpacityMul * normalOpacity * mix(1.0, contourAmp * 1.06, contourGlow * clamp(skinContourDensity, 0.0, 1.0)),
      0.001,
      1.0);

  gl_Position = projectionMatrix * mvPosition;
  float invZ = max(0.002, -mvPosition.z);
  gl_PointSize = clamp(radialSize * focalPixelScale / invZ, 1.0, 64.0);
}
`;

const FRAG_SHADER = /* glsl */ `
uniform float sweepHighlightY;
uniform float sweepHighlightActive;

varying vec3 vColor;
varying float vAlpha;
varying float vWorldY;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float r = length(c);
  if (r > 0.5) discard;

  float soft = clamp(1.0 - smoothstep(0.38, 0.5, r), 0.0, 1.0);

  float highlightBoost = 0.0;
  if (sweepHighlightActive > 0.5) {
    float dist = abs(vWorldY - sweepHighlightY);
    highlightBoost = clamp(1.0 - dist / 0.3, 0.0, 1.0);
    highlightBoost *= highlightBoost;
  }

  float finalAlpha = mix(vAlpha, clamp(vAlpha + highlightBoost * (1.0 - vAlpha), 0.0, 1.0), sweepHighlightActive);

  gl_FragColor = vec4(vColor, finalAlpha * soft);
}
`;
