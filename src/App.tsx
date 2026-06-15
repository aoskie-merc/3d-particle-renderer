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

  const [animPath, setAnimPath] = useState<"statue" | "orb">(
    bundled.animPath ?? "statue",
  );

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
      { appearance, particleColorFollowsTheme, settings, animPath },
      500,
    );
    return () => cancelScheduledPersistHydratedAppState();
  }, [appearance, particleColorFollowsTheme, settings, animPath]);

  // ── Swarm centroid (updated per-frame from ParticleSystem) ──
  const swarmCentroidRef = useRef({ x: 0, y: -5, z: 0 });
  const [swarmCentroid, setSwarmCentroid] = useState({ x: 0, y: -5, z: 0 });
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
  const [triggerPhase, setTriggerPhase] = useState<TTriggerPhase>("initial");
  const [sweepY, setSweepY] = useState<number | null>(null);
  const [attractorOverride, setAttractorOverride] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>({ x: 0, y: -2.2, z: 0 });
  const [attractorBoost, setAttractorBoost] = useState<number | undefined>(2);
  const [homeSpringOverride, setHomeSpringOverride] = useState<
    number | undefined
  >(undefined);
  const [forceProximityMode, setForceProximityMode] = useState(true);
  const [teleportSignal, setTeleportSignal] = useState<{
    x: number;
    y: number;
    z: number;
    timestamp: number;
    scatterX?: number;
    scatterY?: number;
    nearFraction?: number;
    nearZMin?: number;
    nearZMax?: number;
    farZMin?: number;
    farZMax?: number;
  } | null>({
    x: 0,
    y: -2.5,
    z: 0,
    timestamp: Date.now(),
    scatterX: 1.8,
    scatterY: 0.8,
    nearFraction: 0.03,
    nearZMin: 0.1,
    nearZMax: 0.5,
    farZMin: -0.3,
    farZMax: -2.0,
  });
  const [resetVelocitiesSignal, setResetVelocitiesSignal] = useState(0);
  const [orbSteadyState, setOrbSteadyState] = useState(false);
  const [orbFormingPhase, setOrbFormingPhase] = useState(false);
  const animRafRef = useRef(0);

  const [animDurationMs, setAnimDurationMs] = useState(1000);
  const animDurationMsRef = useRef(animDurationMs);
  animDurationMsRef.current = animDurationMs;

  const ENTER_EXIT_FAR_Y = -5;

  const handleTrigger = useCallback(
    (trigger: TTriggerPhase) => {
      if (animRafRef.current) cancelAnimationFrame(animRafRef.current);
      setOrbFormingPhase(false);

      // ── Initial: instant teleport — particles to bottom edge, murmurating ──
      if (trigger === "initial") {
        setTeleportSignal({
          x: 0,
          y: -2.5,
          z: 0,
          timestamp: Date.now(),
          scatterX: 1.8,
          scatterY: 0.8,
          nearFraction: 0.03,
          nearZMin: 0.1,
          nearZMax: 0.5,
          farZMin: -0.3,
          farZMax: -2.0,
        });
        setAttractorOverride({ x: 0, y: -2.2, z: 0 });
        setAttractorBoost(2);
        setForceProximityMode(true);
        setHomeSpringOverride(undefined);
        setSweepY(null);
        setTriggerPhase("initial");
        return;
      }

      // ── Formed ──
      if (trigger === "formed") {
        if (animPath === "orb") {
          // Orb path: collapse orb onto model
          const computeSpring = () =>
            Math.min(Math.max(50 / animDurationMsRef.current, 0.004), 0.5);

          setForceProximityMode(true);
          setAttractorOverride(null);
          setAttractorBoost(undefined);
          setHomeSpringOverride(computeSpring());
          setSweepY(null);
          setTriggerPhase("formed");

          const formedStart = performance.now();
          let centroidArrived = false;

          function animateOrbFormed(now: number) {
            const elapsed = now - formedStart;
            const c = swarmCentroidRef.current;

            if (!centroidArrived && c.y > -0.2) {
              centroidArrived = true;
              setHomeSpringOverride(undefined);
            }

            if (elapsed >= animDurationMsRef.current) {
              setForceProximityMode(false);
              return;
            }

            animRafRef.current = requestAnimationFrame(animateOrbFormed);
          }

          animRafRef.current = requestAnimationFrame(animateOrbFormed);
          return;
        }

        // Statue path: tighten orbit for animDurationMs, then release
        setAttractorOverride(null);
        setAttractorBoost(undefined);
        setHomeSpringOverride(0.02);
        setForceProximityMode(false);
        setSweepY(null);
        setTriggerPhase("formed");

        const tightenStart = performance.now();
        function animateFormed(now: number) {
          if (now - tightenStart >= animDurationMs) {
            setHomeSpringOverride(undefined);
            return;
          }
          animRafRef.current = requestAnimationFrame(animateFormed);
        }
        animRafRef.current = requestAnimationFrame(animateFormed);
        return;
      }

      // ── Peek: bottom-to-top attractor sweep (statue only) ──
      if (trigger === "peek") {
        if (animPath === "orb") return;

        setTriggerPhase("peek");
        setSweepY(null);
        setForceProximityMode(true);

        const modelBottom = -1.2;
        const modelTop = 1.4;
        const LOOP_X = 1.0;
        const LOOP_Z = 0.6;
        const SWEEP_Z = 0.4;
        const MAX_STAGE1_MS = 700;
        const SEEK_SPRING = 0.08;
        let arrivedAt = 0;

        setAttractorOverride({ x: LOOP_X, y: 0, z: LOOP_Z });
        setAttractorBoost(10);

        const startTime = performance.now();
        let stage = 1;
        let stage2Start = 0;

        function animatePeek(now: number) {
          const elapsed = now - startTime;
          const c = swarmCentroidRef.current;
          const centroidXZ = Math.sqrt(c.x * c.x + c.z * c.z);

          if (stage === 1) {
            if (centroidXZ > 0.4 || elapsed > MAX_STAGE1_MS) {
              stage = 2;
              stage2Start = now;
              setAttractorOverride({ x: 0, y: modelBottom, z: SWEEP_Z });
              setAttractorBoost(14);
            }
          } else if (stage === 2) {
            const st2 = Math.min((now - stage2Start) / animDurationMs, 1);
            const eased = st2 * st2 * (3 - 2 * st2);
            const currentSweepY =
              modelBottom + (modelTop - modelBottom) * eased;
            const sweepZ = SWEEP_Z * (1 - eased * 0.6);
            setAttractorOverride({ x: 0, y: currentSweepY, z: sweepZ });
            if (st2 >= 1) {
              stage = 3;
              setAttractorOverride(null);
              setAttractorBoost(undefined);
              setHomeSpringOverride(SEEK_SPRING);
            }
          } else if (stage === 3) {
            const centroidY = c.y;
            const arrived = centroidY > -0.5;
            if (arrived && arrivedAt === 0) arrivedAt = now;
            const done = arrivedAt > 0 && now - arrivedAt > 200;
            const timedOut =
              now - startTime > MAX_STAGE1_MS + animDurationMs + 1500;
            if (done || timedOut) {
              setHomeSpringOverride(undefined);
              setForceProximityMode(false);
              setTriggerPhase("formed");
              return;
            }
          }

          animRafRef.current = requestAnimationFrame(animatePeek);
        }

        animRafRef.current = requestAnimationFrame(animatePeek);
        return;
      }

      // ── Enter: fly particles from off-screen into model ──
      if (trigger === "enter") {
        if (animPath === "orb") {
          setOrbSteadyState(false);
          setTriggerPhase("enter");
          setSweepY(null);
          setForceProximityMode(true);

          const orbBoost = Math.max(
            3,
            Math.min(6, 5 / (settings.orbRadius ?? 1.0)),
          );

          const activateShell = () => {
            setHomeSpringOverride(0.000005);
            setAttractorOverride({ x: 0, y: 0.5, z: 0 });
            setAttractorBoost(orbBoost);
            setTimeout(() => {
              setOrbSteadyState(true);
            }, 2000);
          };

          if (triggerPhase === "initial") {
            // Phase 0 — "Forming": converge toward model homes (like Formed state)
            const computeFormSpring = () =>
              Math.min(Math.max(50 / animDurationMsRef.current, 0.004), 0.5);

            setOrbFormingPhase(true);
            setAttractorOverride(null);
            setAttractorBoost(undefined);
            setHomeSpringOverride(computeFormSpring());

            setTimeout(() => {
              // Forming done — go directly to shell phase
              setOrbFormingPhase(false);
              activateShell();
            }, animDurationMsRef.current / 2);
          } else {
            // From formed/exit or any other state: activate shell immediately
            setHomeSpringOverride(0.000005);
            setAttractorOverride({ x: 0, y: 0.5, z: 0 });
            setAttractorBoost(orbBoost);
            setResetVelocitiesSignal((s) => s + 1);
            setTimeout(() => {
              setOrbSteadyState(true);
            }, 2000);
          }
          return;
        }

        // Statue path: fly in with homeSpring, mystery mode attractors
        const enterMode = settings.enterSwarmMode;

        const runEnterAnimation = () => {
          setTriggerPhase("enter");
          setSweepY(null);
          setForceProximityMode(true);
          setAttractorOverride(null);
          setAttractorBoost(undefined);

          const computeSpring = () =>
            Math.min(Math.max(50 / animDurationMsRef.current, 0.004), 0.5);

          setHomeSpringOverride(computeSpring());

          let stage2Start = 0;
          let springReleased = false;
          let lastSpring = computeSpring();
          let driftActive = false;

          function animateEnter(now: number) {
            if (stage2Start === 0) stage2Start = now;
            const stage2Elapsed = now - stage2Start;
            const centroidY = swarmCentroidRef.current.y;

            // Real-time: update seek speed if anim duration slider changed
            if (!springReleased) {
              const currentSpring = computeSpring();
              if (currentSpring !== lastSpring) {
                lastSpring = currentSpring;
                setHomeSpringOverride(currentSpring);
              }
            }

            // Release direct-seek once particles have arrived so murmuration resumes
            if (!springReleased && centroidY > -0.2) {
              springReleased = true;
              setHomeSpringOverride(undefined);

              if (enterMode === "orbit") {
                setAttractorOverride({ x: 2.2, y: 0.5, z: 1.8 });
                setAttractorBoost(5);
              } else if (enterMode === "drift") {
                driftActive = true;
              }
            }

            // Murmur sub-loop: slowly rotate attractor around model at large radius
            if (springReleased && enterMode === "murmur") {
              const angle = stage2Elapsed * 0.0007; // ~9s full rotation
              setAttractorOverride({
                x: Math.cos(angle) * 2.5,
                y: Math.sin(angle * 0.6) * 0.8,
                z: Math.sin(angle) * 2.5,
              });
              setAttractorBoost(3);
            }

            // Drift sub-loop: figure-8 oscillation with large amplitude
            if (driftActive && springReleased) {
              setAttractorOverride({
                x: Math.cos(stage2Elapsed / 1200) * 1.5,
                y: Math.sin(stage2Elapsed / 700) * 2.8,
                z: 0.5,
              });
              setAttractorBoost(5);
            }

            // Hold proximity mode for the full anim duration, then finish
            const done = stage2Elapsed >= animDurationMsRef.current;
            const timedOut =
              stage2Elapsed > animDurationMsRef.current * 2 + 2000;
            if (done || timedOut) {
              if (!springReleased) setHomeSpringOverride(undefined);
              setAttractorOverride(null);
              setAttractorBoost(undefined);
              setForceProximityMode(false);
              return;
            }

            animRafRef.current = requestAnimationFrame(animateEnter);
          }

          animRafRef.current = requestAnimationFrame(animateEnter);
        };

        // From "formed": auto-run Exit first, then Enter when complete
        if (triggerPhase === "formed") {
          setTriggerPhase("exit");
          setSweepY(null);
          setHomeSpringOverride(undefined);
          setResetVelocitiesSignal((s) => s + 1);
          setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
          setAttractorBoost(20);

          const exitStart = performance.now();
          function autoExitThenEnter(now: number) {
            const elapsed = now - exitStart;
            if (elapsed < animDurationMs) {
              setAttractorBoost(20 + 12 * (elapsed / animDurationMs));
              animRafRef.current = requestAnimationFrame(autoExitThenEnter);
            } else {
              setAttractorBoost(32);
              runEnterAnimation();
            }
          }
          animRafRef.current = requestAnimationFrame(autoExitThenEnter);
          return;
        }

        // From "initial", "exit", or any other state: run enter directly
        runEnterAnimation();
        return;
      }

      // ── Exit: particles fly off-screen ──
      if (trigger === "exit") {
        setTriggerPhase("exit");
        setSweepY(null);
        setHomeSpringOverride(undefined);
        setResetVelocitiesSignal((s) => s + 1);
        setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
        setAttractorBoost(20);

        const startTime = performance.now();

        function animateExit(now: number) {
          const elapsed = now - startTime;
          if (elapsed < animDurationMs) {
            const t = elapsed / animDurationMs;
            setAttractorBoost(20 + 12 * t);
            animRafRef.current = requestAnimationFrame(animateExit);
          } else {
            setAttractorOverride({ x: 0, y: ENTER_EXIT_FAR_Y, z: 0 });
            setAttractorBoost(32);
            // Stay at "exit" — particles held off-screen, ready for Enter
          }
        }

        animRafRef.current = requestAnimationFrame(animateExit);
        return;
      }
    },
    [
      animDurationMs,
      animPath,
      triggerPhase,
      settings.enterSwarmMode,
      settings.orbRadius,
    ],
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
        triggerPhase={triggerPhase}
        onTrigger={handleTrigger}
        animPath={animPath}
        onPathChange={(path) => {
          setAnimPath(path);
          handleTrigger("initial");
        }}
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
            animPath={animPath}
            appearance={appearance}
            attractorBoost={attractorBoost}
            orbFormingPhase={orbFormingPhase}
            orbSteadyState={orbSteadyState}
            attractorOverride={attractorOverride}
            forceProximityMode={
              forceProximityMode ||
              triggerPhase === "peek" ||
              triggerPhase === "exit" ||
              triggerPhase === "initial"
            }
            geometry={geometry}
            homeSpringOverride={homeSpringOverride}
            lockCamera={triggerPhase !== "formed"}
            onCentroidUpdate={handleCentroidUpdate}
            resetVelocitiesSignal={resetVelocitiesSignal}
            settings={settings}
            swarmCentroid={swarmCentroid}
            sweepHighlightY={sweepY}
            teleportSignal={teleportSignal}
            triggerPhase={triggerPhase}
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
