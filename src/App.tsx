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

  const SWEEP_BOTTOM = -2.0;
  const SWEEP_TOP = 2.0;
  const SWEEP_FADE_DURATION_MS = Math.round(animDurationMs * 0.4);

  const ENTER_EXIT_FAR_Y = -4.0;

  const handleTrigger = useCallback(
    (trigger: TTriggerPhase) => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);

      if (trigger === "sweep-up") {
        setTriggerPhase("sweep-up");
        setSweepY(SWEEP_BOTTOM);
        setAttractorOverride({ x: 0, y: SWEEP_BOTTOM, z: 0 });
        setAttractorBoost(undefined);

        const startTime = performance.now();

        function animateSweep(now: number) {
          const elapsed = now - startTime;

          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            const eased = t * t * (3 - 2 * t);
            const y = SWEEP_BOTTOM + (SWEEP_TOP - SWEEP_BOTTOM) * eased;
            setSweepY(y);
            setAttractorOverride({ x: 0, y, z: 0 });
            animRafRef.current = requestAnimationFrame(animateSweep);
          } else {
            const fadeElapsed = elapsed - animDurationMs;

            if (fadeElapsed < SWEEP_FADE_DURATION_MS) {
              const fadeT = fadeElapsed / SWEEP_FADE_DURATION_MS;
              const fadeEased = fadeT * fadeT;
              const y = SWEEP_TOP + fadeEased * 1.0;
              setSweepY(y);
              setAttractorOverride({ x: 0, y, z: 0 });
              animRafRef.current = requestAnimationFrame(animateSweep);
            } else {
              setSweepY(null);
              setAttractorOverride(null);
              setTriggerPhase("idle");
            }
          }
        }

        animRafRef.current = requestAnimationFrame(animateSweep);
        return;
      }

      if (trigger === "enter") {
        setTriggerPhase("enter");
        setSweepY(null);
        setAttractorBoost(8);
        setTeleportSignal({
          x: 0,
          y: ENTER_EXIT_FAR_Y,
          z: 0,
          timestamp: performance.now(),
        });
        setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });

        const startTime = performance.now();

        function animateEnter(now: number) {
          const elapsed = now - startTime;
          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            const eased = t * t * (3 - 2 * t);
            const y = ENTER_EXIT_FAR_Y + (0 - ENTER_EXIT_FAR_Y) * eased;
            setAttractorOverride({ x: 0, y, z: 0 });
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
        setAttractorBoost(14);
        setAttractorOverride({ x: 0, y: 0, z: 0 });

        const startTime = performance.now();

        function animateExit(now: number) {
          const elapsed = now - startTime;
          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            const eased = t * t * (3 - 2 * t);
            const y = 0 + (ENTER_EXIT_FAR_Y - 0) * eased;
            setAttractorOverride({ x: 0, y, z: 0 });
            animRafRef.current = requestAnimationFrame(animateExit);
          } else {
            setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
            setTriggerPhase("hidden");
          }
        }

        animRafRef.current = requestAnimationFrame(animateExit);
        return;
      }
    },
    [animDurationMs, SWEEP_FADE_DURATION_MS],
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

      <TriggerBar
        duration={animDurationMs}
        phase={triggerPhase}
        onDurationChange={setAnimDurationMs}
        onTrigger={handleTrigger}
      />

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
            settings={settings}
            sweepHighlightY={sweepY}
            teleportSignal={teleportSignal}
          />
        </Canvas>
      ) : (
        <div className="loading-model">Loading model…</div>
      )}

      <SettingsChrome
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
