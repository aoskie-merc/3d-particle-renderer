import { useLayoutEffect } from 'react';

import { useThree } from '@react-three/fiber';

import { PerspectiveCamera } from 'three';

export interface IAdaptivePerspectiveProps {
  fitRadius: number;
}

/** Frames the orbit camera using the (already normalised) mesh bounding sphere radius. */
export default function AdaptivePerspective(props: Readonly<IAdaptivePerspectiveProps>) {
  const { fitRadius } = props;
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) {
      return;
    }

    const rig = camera;
    const r = Math.max(fitRadius, 1e-4);
    const dist = Math.max(r * 4.15, r * 2.85 + 2.05) / 1.5;

    /*
     * R3F hands out THREE camera objects intentionally for imperative tweaks.
     * react-hooks/immutability flags positional / clip-plane writes on that ref.
     */
    /* eslint-disable react-hooks/immutability */
    rig.position.set(0.0254, -3.1643, 0.7622);
    rig.up.set(0.0238, -0.1913, 0.9812);
    rig.quaternion.set(0.618721, 0.010073, -0.006473, 0.785519);
    rig.updateProjectionMatrix();
    rig.near = Math.max(dist * 0.00012, Math.min(r * 0.04, dist * 0.02));
    rig.far = Math.max(dist * 40, r * 64, 200);
    rig.updateProjectionMatrix();
    /* eslint-enable react-hooks/immutability */
  }, [camera, fitRadius]);

  return null;
}
