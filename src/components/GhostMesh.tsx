import type { BufferGeometry } from 'three';

import type { TMercuryAppearance } from '../theme';

export interface IGhostMeshProps {
  appearance: TMercuryAppearance;
  geometry: BufferGeometry;
  wireOpacity: number;
}

/** Wireframe silhouette of source mesh so particles retain spatial context. */
export default function GhostMesh(props: IGhostMeshProps) {
  const { appearance, geometry, wireOpacity } = props;
  const clampedOpacity = Math.min(1, Math.max(0, wireOpacity));
  const color = appearance === 'dark' ? '#9d9da8' : '#5a5548';

  return (
    <mesh geometry={geometry} renderOrder={-50}>
      <meshBasicMaterial
        attach="material"
        color={color}
        depthWrite={false}
        opacity={clampedOpacity}
        transparent={clampedOpacity < 1}
        wireframe
      />
    </mesh>
  );
}
