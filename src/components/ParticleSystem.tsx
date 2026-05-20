import { useFrame } from '@react-three/fiber';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import type { BufferGeometry, InstancedMesh } from 'three';
import {
  AdditiveBlending,
  DynamicDrawUsage,
  MeshBasicMaterial,
  MultiplyBlending,
  NormalBlending,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';

import type { TBlendModeKey, TDirectionBias, TDistributionMethod } from '../types';
import { turbulence3 } from '../utils/noise';
import { PARTICLE_CAPACITY, sampleMeshSurface } from '../utils/surfaceSampler';

export interface IParticleSystemProps {
  geometry: BufferGeometry;
  particleCount: number;
  distribution: TDistributionMethod;
  surfaceNormalOffset: number;
  movementSpeed: number;
  movementAmplitude: number;
  directionBias: TDirectionBias;
  vibrationFrequency: number;
  vibrationAmplitude: number;
  vibrationDamping: number;
  vibrationNoiseScale: number;
  particleSize: number;
  color: string;
  opacity: number;
  blendMode: TBlendModeKey;
}

const TWO_PI = Math.PI * 2;

const blendingForMode = (mode: TBlendModeKey) => {
  switch (mode) {
    case 'additive':
      return AdditiveBlending;
    case 'multiply':
      return MultiplyBlending;
    case 'normal':
    default:
      return NormalBlending;
  }
};

export default function ParticleSystem(props: IParticleSystemProps) {
  const {
    blendMode,
    color,
    directionBias,
    distribution,
    geometry,
    movementAmplitude,
    movementSpeed,
    opacity,
    particleCount,
    particleSize,
    surfaceNormalOffset,
    vibrationAmplitude,
    vibrationDamping,
    vibrationFrequency,
    vibrationNoiseScale,
  } = props;

  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const samples = useMemo(
    () => sampleMeshSurface(geometry, particleCount, distribution),
    [distribution, geometry, particleCount],
  );

  const count = samples.positions.length / 3;

  const animation = useMemo(() => {
    const movePhase = new Float32Array(count);
    const vibPhase = new Float32Array(count);
    const randomDir = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      movePhase[index] = seed01(index + 173) * TWO_PI;
      vibPhase[index] = seed01(index + 983) * TWO_PI;

      const base = index * 3;
      randomDir[base] = seed01(index * 3 + 211) * 2 - 1;
      randomDir[base + 1] = seed01(index * 3 + 389) * 2 - 1;
      randomDir[base + 2] = seed01(index * 3 + 571) * 2 - 1;
      normalizeInPlace(randomDir, base);
    }

    return {
      movePhase,
      randomDir,
      vibPhase,
    };
  }, [count]);

  const baseGeometry = useMemo(() => new SphereGeometry(1, 12, 12), []);

  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        blending: NormalBlending,
        color,
        depthWrite: true,
        opacity: 1,
        toneMapped: false,
        transparent: true,
      }),
    // Stable reference — never recreate
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
    material.blending = blendingForMode(blendMode);
    material.depthWrite = blendMode === 'normal' ? opacity >= 1 : false;
    material.transparent = opacity < 1 || blendMode !== 'normal';
    material.needsUpdate = true;
  }, [material, blendMode, color, opacity]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const scratchRadial = useMemo(() => new Vector3(), []);
  const scratchTangent = useMemo(() => new Vector3(), []);
  const scratchNormal = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;

    if (!mesh || count <= 0) {
      return;
    }

    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = count;

    dummy.rotation.set(0, 0, 0);
    const samplePositions = samples.positions;
    const sampleNormals = samples.normals;

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;

      dummy.position.set(
        samplePositions[offset],
        samplePositions[offset + 1],
        samplePositions[offset + 2],
      );

      scratchNormal.set(
        sampleNormals[offset],
        sampleNormals[offset + 1],
        sampleNormals[offset + 2],
      );

      dummy.position.addScaledVector(scratchNormal, surfaceNormalOffset);
      dummy.scale.setScalar(particleSize);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [
    count,
    dummy,
    particleSize,
    samples,
    scratchNormal,
    surfaceNormalOffset,
  ]);

  const scratchMove = useMemo(() => new Vector3(), []);
  const scratchTemp = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);

  useFrame((state) => {
    const mesh = meshRef.current;

    if (!mesh || count <= 0) {
      return;
    }

    const elapsed = state.clock.elapsedTime;
    const dampMul = 1 / (1 + vibrationDamping);
    const { movePhase, randomDir, vibPhase } = animation;
    const { normals, positions } = samples;

    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;

      scratchNormal.set(
        normals[offset],
        normals[offset + 1],
        normals[offset + 2],
      );

      dummy.position.set(
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      );

      dummy.position.addScaledVector(scratchNormal, surfaceNormalOffset);

      scratchRadial.copy(dummy.position).normalize();

      scratchTangent.copy(scratchRadial).sub(
        scratchTemp.copy(scratchNormal).multiplyScalar(
          scratchRadial.dot(scratchNormal),
        ),
      );

      if (scratchTangent.lengthSq() < 1e-6) {
        scratchTangent.copy(up).cross(scratchNormal).normalize();

        if (scratchTangent.lengthSq() < 1e-6) {
          scratchTangent.copy(scratchNormal).cross(scratchRadial).normalize();
        }
      } else {
        scratchTangent.normalize();
      }

      const randomX = randomDir[offset];
      const randomY = randomDir[offset + 1];
      const randomZ = randomDir[offset + 2];
      scratchMove.set(randomX, randomY, randomZ);

      switch (directionBias) {
        case 'radial':
          scratchMove.copy(scratchRadial);
          break;
        case 'tangential':
          scratchMove.copy(scratchTangent);
          break;
        case 'random':
        default:
          break;
      }

      const oscillationMovement =
        movementAmplitude * Math.sin(movementSpeed * elapsed + movePhase[i]);
      dummy.position.addScaledVector(scratchMove, oscillationMovement);

      const harmonic =
        vibrationAmplitude *
        dampMul *
        Math.sin(elapsed * TWO_PI * vibrationFrequency + vibPhase[i]);

      let noiseContribution = turbulence3(
        dummy.position.x * vibrationNoiseScale,
        dummy.position.y * vibrationNoiseScale,
        dummy.position.z * vibrationNoiseScale + vibrationFrequency * elapsed * 0.18,
        elapsed + movePhase[i] * 0.33,
      );

      noiseContribution *= vibrationAmplitude * dampMul * 0.28;

      dummy.position.addScaledVector(scratchNormal, harmonic + noiseContribution);

      dummy.rotation.set(0, 0, 0);

      dummy.scale.setScalar(particleSize);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      args={[baseGeometry, material, PARTICLE_CAPACITY]}
      frustumCulled={false}
      ref={meshRef}
      renderOrder={10}
    />
  );
}

function seed01(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function normalizeInPlace(store: Float32Array, ptr: number) {
  let x = store[ptr];
  let y = store[ptr + 1];
  let z = store[ptr + 2];

  const lenSq = x * x + y * y + z * z;

  if (lenSq < 1e-12) {
    store[ptr] = 1;
    store[ptr + 1] = 0;
    store[ptr + 2] = 0;
    return;
  }

  const invLen = 1 / Math.sqrt(lenSq);
  x *= invLen;
  y *= invLen;
  z *= invLen;

  store[ptr] = x;
  store[ptr + 1] = y;
  store[ptr + 2] = z;
}
