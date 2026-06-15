import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';

import { useCallback, useEffect, useRef } from 'react';

import { Quaternion, Vector3 } from 'three';

const DEFAULT_POSITION = new Vector3(0.0254, -3.1643, 0.7622);
const DEFAULT_QUATERNION = new Quaternion(0.618721, 0.010073, -0.006473, 0.785519);
const DEFAULT_UP = new Vector3(0.0238, -0.1913, 0.9812);

const MAX_POLAR_DEVIATION = Math.PI / 2;
const MAX_AZIMUTH_DEVIATION = Math.PI / 2;

const LERP_SPEED = 3.5;

interface ISpringOrbitControlsProps {
  enabled?: boolean;
  maxDistance: number;
  minDistance: number;
}

export default function SpringOrbitControls(props: ISpringOrbitControlsProps) {
  const { enabled = true, maxDistance, minDistance } = props;
  const { camera } = useThree();
  const isDragging = useRef(false);
  const shouldReturn = useRef(false);

  const onStart = useCallback(() => {
    isDragging.current = true;
    shouldReturn.current = false;
  }, []);

  const onEnd = useCallback(() => {
    isDragging.current = false;
    shouldReturn.current = true;
  }, []);

  useEffect(() => {
    camera.up.copy(DEFAULT_UP);
  }, [camera]);

  useFrame((_, delta) => {
    if (!shouldReturn.current || isDragging.current) return;

    const t = 1 - Math.exp(-LERP_SPEED * delta);

    camera.position.lerp(DEFAULT_POSITION, t);
    camera.quaternion.slerp(DEFAULT_QUATERNION, t);
    camera.up.lerp(DEFAULT_UP, t);

    if (camera.position.distanceTo(DEFAULT_POSITION) < 0.001) {
      camera.position.copy(DEFAULT_POSITION);
      camera.quaternion.copy(DEFAULT_QUATERNION);
      camera.up.copy(DEFAULT_UP);
      shouldReturn.current = false;
    }
  });

  const basePolar = Math.PI / 2;

  return (
    <OrbitControls
      dampingFactor={0.1}
      enableDamping
      enablePan={false}
      enableRotate={enabled}
      enableZoom={enabled}
      maxAzimuthAngle={MAX_AZIMUTH_DEVIATION}
      maxDistance={maxDistance}
      maxPolarAngle={basePolar + MAX_POLAR_DEVIATION}
      minAzimuthAngle={-MAX_AZIMUTH_DEVIATION}
      minDistance={minDistance}
      minPolarAngle={basePolar - MAX_POLAR_DEVIATION}
      rotateSpeed={0.5}
      onEnd={onEnd}
      onStart={onStart}
    />
  );
}
