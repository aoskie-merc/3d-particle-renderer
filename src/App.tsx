import { Canvas } from "@react-three/fiber";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BufferGeometry } from "three";

import {
  cancelScheduledPersistHydratedAppState,
  loadCustomBaselineSettings,
  loadHydratedAppState,
  persistCustomBaselineSettings,
  schedulePersistHydratedAppState,
} from "./appPreferencesPersistence";
import Scene from "./components/Scene";
import SettingsChrome from "./components/SettingsChrome";
import ThemeToggle from "./components/ThemeToggle";
import TriggerBar from "./components/TriggerBar";
import type { TTriggerPhase } from "./components/TriggerBar";
import type { IParticleSettings } from "./particleSettings";
import { type TMercuryAppearance, mercuryDefaultParticleHex } from "./theme";
import { loadStaticModel } from "./utils/meshIngest";

export default function App() {
  const [bundled] = useState(() => loadHydratedAppState());
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [settings, setSettings] = useState<IParticleSettings>(bundled.settings);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [appearance, setAppearance] = useState<TMercuryAppearance>(
    bundled.appearance,
  );
  const [particleColorFollowsTheme, setParticleColorFollowsTheme] =
    useState<boolean>(bundled.particleColorFollowsTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);

  useEffect(() => {
    if (!particleColorFollowsTheme) return;
    setSettings((previous) => ({
      ...previous,
      color: mercuryDefaultParticleHex(appearance),
      skinColor: mercuryDefaultParticleHex(appearance),
    }));
  }, [appearance, particleColorFollowsTheme]);

  useEffect(() => {
    schedulePersistHydratedAppState(
      { appearance, particleColorFollowsTheme, settings },
      500,
    );
    return () => cancelScheduledPersistHydratedAppState();
  }, [appearance, particleColorFollowsTheme, settings]);

  // ── Swarm centroid (updated per-frame from ParticleSystem) ──
  const swarmCentroidRef = useRef({ x: 0, y: 0, z: 0 });
  const [swarmCentroid, setSwarmCentroid] = useState({ x: 0, y: 0, z: 0 });
  const centroidFrameCount = useRef(0);
  const handleCentroidUpdate = useCallback(
    (pos: { x: number; y: number; z: number }) => {
      swarmCentroidRef.current = pos;
      // Throttle state updates to every 3 frames to avoid excessive re-renders
      centroidFrameCount.current += 1;
      if (centroidFrameCount.current % 3 === 0) {
        setSwarmCentroid(pos);
      }
    },
    [],
  );

  const proximityRevealRef = useRef(settings.proximityReveal);
  proximityRevealRef.current = settings.proximityReveal;

  // ── Trigger animation state ──
  const [triggerPhase, setTriggerPhase] = useState<TTriggerPhase>("idle");
  const [sweepY, setSweepY] = useState<number | null>(null);
  const [attractorOverride, setAttractorOverride] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);
  const [attractorBoost, setAttractorBoost] = useState<number | undefined>(
    undefined,
  );
  const [teleportSignal, setTeleportSignal] = useState<{
    x: number;
    y: number;
    z: number;
    timestamp: number;
  } | null>(null);
  const animRafRef = useRef(0);

  const [animDurationMs, setAnimDurationMs] = useState(1000);

  const ENTER_EXIT_FAR_Y = -4.0;

  const handleTrigger = useCallback(
    (trigger: TTriggerPhase) => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);

      if (trigger === "sweep-up") {
        setTriggerPhase("sweep-up");

        const modelBottom = -1.2;
        const modelTop = 1.4;
        const loopOutX = 2.8;
        const loopOutZ = 1.5;
        const loopOutY = -0.5;
        const holdDuration = 300;

        // Phase split: 35% looping out, 65% sweeping across
        const loopFraction = 0.35;

        setSweepY(null);
        setAttractorOverride({ x: 0, y: modelBottom, z: 0 });
        setAttractorBoost(10);

        const startTime = performance.now();

        function animateSweep(now: number) {
          const elapsed = now - startTime;
          const totalDuration = animDurationMs;

          if (elapsed < totalDuration) {
            const t = elapsed / totalDuration;

            let x: number;
            let y: number;
            let z: number;

            if (t < loopFraction) {
              // Phase 1: Loop outward from below model to the side
              const lt = t / loopFraction;
              const eased = lt * lt * (3 - 2 * lt);
              // Arc out: quarter-circle from bottom-center to side
              const angle = -Math.PI / 2 + eased * (Math.PI / 2);
              x = loopOutX * Math.cos(angle - Math.PI / 2) * eased;
              z = loopOutZ * eased * Math.sin(angle);
              y = modelBottom + (loopOutY - modelBottom) * eased;
              // No skin reveal during loop-out
              setSweepY(null);
            } else {
              // Phase 2: Sweep back across model bottom-to-top
              const st = (t - loopFraction) / (1 - loopFraction);
              const eased = st * st * (3 - 2 * st);
              // Arc back from side to center while rising
              const returnEase = 1 - Math.pow(1 - st, 2);
              x = loopOutX * (1 - returnEase);
              z = loopOutZ * (1 - returnEase) * 0.5;
              y = modelBottom + (modelTop - modelBottom) * eased;
              // When proximity reveal is on, the centroid handles skin reveal;
              // otherwise use the Y-plane sweep
              if (!proximityRevealRef.current) {
                setSweepY(y);
              }
            }

            setAttractorOverride({ x, y, z });
            animRafRef.current = requestAnimationFrame(animateSweep);
          } else if (elapsed < totalDuration + holdDuration) {
            animRafRef.current = requestAnimationFrame(animateSweep);
          } else {
            setSweepY(null);
            setAttractorOverride(null);
            setAttractorBoost(undefined);
            setTriggerPhase("idle");
          }
        }

        animRafRef.current = requestAnimationFrame(animateSweep);
        return;
      }

      if (trigger === "enter") {
        setTriggerPhase("enter");
        setSweepY(null);

        setTeleportSignal({
          x: 0,
          y: ENTER_EXIT_FAR_Y,
          z: 0,
          timestamp: performance.now(),
        });

        setAttractorOverride({ x: 0, y: 0, z: 0 });
        setAttractorBoost(12);

        const startTime = performance.now();

        function animateEnter(now: number) {
          const elapsed = now - startTime;
          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            const boost = 12 * (1 - t * t);
            setAttractorBoost(Math.max(1, boost));
            animRafRef.current = requestAnimationFrame(animateEnter);
          } else {
            setAttractorOverride(null);
            setAttractorBoost(undefined);
            setTriggerPhase("idle");
          }
        }

        animRafRef.current = requestAnimationFrame(animateEnter);
        return;
      }

      if (trigger === "exit") {
        setTriggerPhase("exit");
        setSweepY(null);

        setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
        setAttractorBoost(20);

        const startTime = performance.now();

        function animateExit(now: number) {
          const elapsed = now - startTime;
          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            const boost = 20 + 12 * t;
            setAttractorBoost(boost);
            animRafRef.current = requestAnimationFrame(animateExit);
          } else {
            setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
            setAttractorBoost(32);
            setTriggerPhase("hidden");
          }
        }

        animRafRef.current = requestAnimationFrame(animateExit);
        return;
      }
    },
    [animDurationMs],
  );

  useEffect(() => {
    return () => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadStaticModel("/model.stl").then((geom) => {
      if (!cancelled) setGeometry(geom);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSettings = useCallback((partial: Partial<IParticleSettings>) => {
    if (partial.color !== undefined || partial.skinColor !== undefined) {
      setParticleColorFollowsTheme(false);
    }
    setSettings((previous: IParticleSettings) => ({ ...previous, ...partial }));
  }, []);

  const normalizeCssHexForCompare = useCallback((raw: string): string => {
    const t = raw.trim();
    if (!t.startsWith("#")) return t.toLowerCase();
    let hex = t.slice(1).toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) {
      hex = hex
        .split("")
        .map((ch: string) => ch + ch)
        .join("");
    }
    return `#${hex.slice(0, 6)}`;
  }, []);

  const applyBaselineSettings = useCallback(
    (base: IParticleSettings) => {
      const themeHex = mercuryDefaultParticleHex(appearance);
      const colorMatches =
        normalizeCssHexForCompare(base.color) ===
        normalizeCssHexForCompare(themeHex);
      const skinMatches =
        normalizeCssHexForCompare(base.skinColor) ===
        normalizeCssHexForCompare(themeHex);

      if (colorMatches && skinMatches) {
        setParticleColorFollowsTheme(true);
        setSettings({ ...base, color: themeHex, skinColor: themeHex });
      } else {
        setParticleColorFollowsTheme(false);
        setSettings(base);
      }
    },
    [appearance, normalizeCssHexForCompare],
  );

  const resetToDefault = useCallback(() => {
    applyBaselineSettings(loadCustomBaselineSettings());
  }, [applyBaselineSettings]);

  const saveAsDefault = useCallback(() => {
    persistCustomBaselineSettings(settings);
  }, [settings]);

  return (
    <main aria-label="Particle workspace" className="viewport" tabIndex={-1}>
      <ThemeToggle
        appearance={appearance}
        hidden={sidebarOpen}
        setAppearance={setAppearance}
      />

      <TriggerBar phase={triggerPhase} onTrigger={handleTrigger} />

      {geometry ? (
        <Canvas
          camera={{
            far: 200,
            fov: 45,
            near: 0.1,
            position: [3.95, 2.92, 5.45],
          }}
          dpr={[1, 2]}
          gl={{
            alpha: false,
            antialias: true,
            logarithmicDepthBuffer: false,
            powerPreference: "high-performance",
          }}
          shadows={false}
        >
          <Scene
            appearance={appearance}
            attractorBoost={attractorBoost}
            attractorOverride={attractorOverride}
            geometry={geometry}
            onCentroidUpdate={handleCentroidUpdate}
            settings={settings}
            swarmCentroid={swarmCentroid}
            sweepHighlightY={sweepY}
            teleportSignal={teleportSignal}
          />
        </Canvas>
      ) : (
        <div className="loading-model">Loading model…</div>
      )}

      <SettingsChrome
        animDuration={animDurationMs}
        onAnimDurationChange={setAnimDurationMs}
        panelOpen={sidebarOpen}
        resetToDefault={resetToDefault}
        saveAsDefault={saveAsDefault}
        setPanelOpen={setSidebarOpen}
        settings={settings}
        onPatch={patchSettings}
      />
    </main>
  );
}
