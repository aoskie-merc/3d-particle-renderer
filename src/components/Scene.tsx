import { useMemo } from "react";

import AdaptivePerspective from "./AdaptivePerspective";
import GhostMesh from "./GhostMesh";
import ParticleSystem from "./ParticleSystem";
import SkinParticleSystem from "./SkinParticleSystem";
import SpringOrbitControls from "./SpringOrbitControls";

import type { BufferGeometry } from "three";

import type { IParticleSettings } from "../particleSettings";
import type { TMercuryAppearance } from "../theme";
import { mercuryCanvasHex } from "../theme";

import { CANONICAL_MESH_RADIUS } from "../utils/geometryNormalize";

export interface ISceneProps {
  appearance: TMercuryAppearance;
  geometry: BufferGeometry;
  settings: IParticleSettings;
}

export default function Scene(props: ISceneProps) {
  const { appearance, geometry, settings } = props;

  const clears = mercuryCanvasHex(appearance);
  const skyColor = appearance === "dark" ? "#c3c3cc" : "#fbfcfd";
  const groundColor = appearance === "dark" ? "#171721" : "#dddde5";

  const fitRadius = useMemo(() => {
    geometry.computeBoundingSphere();

    const r = geometry.boundingSphere?.radius;

    return r && Number.isFinite(r)
      ? Math.max(r, CANONICAL_MESH_RADIUS / 320)
      : CANONICAL_MESH_RADIUS;
  }, [geometry]);

  return (
    <>
      <color attach="background" args={[clears]} />

      <AdaptivePerspective fitRadius={fitRadius} />

      <hemisphereLight args={[skyColor, groundColor, 0.48]} />

      <ambientLight intensity={appearance === "dark" ? 0.36 : 0.42} />

      <directionalLight
        intensity={appearance === "dark" ? 2.08 : 1.78}
        position={[fitRadius * 12, fitRadius * 17, fitRadius * 9]}
      />

      <directionalLight
        intensity={appearance === "dark" ? 2.15 : 1.85}
        position={[-fitRadius * 18, -fitRadius * 22, -fitRadius * 19]}
      />

      <SpringOrbitControls
        maxDistance={Math.max(fitRadius * 28, CANONICAL_MESH_RADIUS * 8)}
        minDistance={Math.max(fitRadius * 0.08, CANONICAL_MESH_RADIUS * 0.12)}
      />

      {!settings.skinEnabled && settings.showWireframe ? (
        <GhostMesh
          appearance={appearance}
          geometry={geometry}
          wireOpacity={settings.wireOpacity}
        />
      ) : null}

      {settings.skinEnabled ? (
        <SkinParticleSystem
          key={`${geometry.uuid}-skin`}
          contourDensity={settings.skinContourDensity}
          depthFade={settings.skinDepthFade}
          geometry={geometry}
          normalShading={settings.skinNormalShading}
          particleCount={settings.skinParticleCount}
          particleSize={settings.skinParticleSize}
          skinColor={settings.skinColor}
          skinOpacity={settings.skinOpacity}
        />
      ) : null}

      <ParticleSystem
        key={geometry.uuid}
        blendMode={settings.blendMode}
        boidAlignment={settings.boidAlignment}
        boidCohesion={settings.boidCohesion}
        boidHomeSpring={settings.boidHomeSpring}
        boidNoise={settings.boidNoise}
        boidSeparation={settings.boidSeparation}
        boidSpeedLimit={settings.boidSpeedLimit}
        boidVisualRange={settings.boidVisualRange}
        color={settings.color}
        distribution={settings.distribution}
        geometry={geometry}
        opacity={settings.opacity}
        particleCount={settings.particleCount}
        particleSize={settings.particleSize}
        surfaceNormalOffset={settings.surfaceNormalOffset}
        swarmOrbitSpeed={settings.swarmOrbitSpeed}
        swarmOrbitRadius={settings.swarmOrbitRadius}
        swarmSplitIntensity={settings.swarmSplitIntensity}
        swarmSplitSpeed={settings.swarmSplitSpeed}
      />
    </>
  );
}
