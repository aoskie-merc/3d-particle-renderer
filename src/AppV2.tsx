import { Canvas } from "@react-three/fiber";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TBeat } from "./sim/particleSimV2";
import type { TSurfaceDepthBias, TDepthSizing } from "./types";
import SceneV2 from "./components/SceneV2";
import styles from "./AppV2.module.css";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayerGroupIcon,
  RotateLeftIcon,
  SlidersIcon,
} from "./icons/NavIcons";

// ── Overlay content ────────────────────────────────────────────────────────────

interface IOverlayContent {
  headline: string;
  subtext: string;
  showCta?: boolean;
}

function getOverlayContent(beat: Exclude<TBeat, 0>, isSecondHalf: boolean): IOverlayContent {
  switch (beat) {
    case 1:
      return {
        headline: "We're reviewing your application.",
        subtext: "Most are approved in under a minute",
      };
    case 2:
      return {
        headline: "Every detail matters",
        subtext: "We're getting to know your business",
      };
    case 3:
      if (isSecondHalf) {
        return {
          headline: "Your business is coming into focus",
          subtext: "We're putting it all together",
        };
      }
      return {
        headline: "Every business has its own shape",
        subtext: "We're understanding yours",
      };
    case 4:
      return {
        headline: "Your business is coming into focus",
        subtext: "We're putting it all together",
      };
    case 5:
      return {
        headline: "Welcome to Mercury",
        subtext: "We're better because you're here",
        showCta: true,
      };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BEAT_LABELS: Record<TBeat, string> = {
  0: "Initial",
  1: "Swirl in",
  2: "Form",
  3: "Hint",
  4: "Reveal",
  5: "Approved",
};

/** Beats used in the playback timeline (excludes beat 0 "Initial" pre-animation state). */
const BEATS: TBeat[] = [1, 2, 3, 4, 5];

/** All beats shown in the beats panel, including beat 0. */
const ALL_DISPLAY_BEATS: TBeat[] = [0, 1, 2, 3, 4, 5];

const DENSITY_PRESETS: { label: string; count: number }[] = [
  { label: "Sparse", count: 2_000 },
  { label: "Medium", count: 6_000 },
  { label: "Dense", count: 15_000 },
];

const DEFAULT_BEAT_DURATIONS: Record<TBeat, number> = {
  0: 0,       // Initial: not part of the playback timeline
  1: 8_000,
  2: 10_000,
  3: 8_000,
  4: 20_000,
  5: 12_000,
};

const ACCORDION_SECTIONS = ["Playback", "Particles", "Shape", "Reveal", "Swirl", "Animation", "Surface Depth"] as const;
type TSection = (typeof ACCORDION_SECTIONS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function beatAtTime(
  t: number,
  durations: Record<TBeat, number>,
): { beat: TBeat; progress: number } {
  const total = BEATS.reduce((sum, b) => sum + durations[b], 0);
  let cursor = t * total;
  for (const beat of BEATS) {
    const d = durations[beat];
    if (cursor <= d) return { beat, progress: cursor / d };
    cursor -= d;
  }
  return { beat: 5, progress: 1 };
}

function beatStartT(beat: TBeat, durations: Record<TBeat, number>): number {
  const total = BEATS.reduce((sum, b) => sum + durations[b], 0);
  let acc = 0;
  for (const b of BEATS) {
    if (b === beat) return acc / total;
    acc += durations[b];
  }
  return 0;
}

// ── EditableSliderValue ────────────────────────────────────────────────────────

interface IEditableSliderValueProps {
  /** Formatted string shown in display mode */
  displayValue: string;
  /** Value pre-filled in the input when editing starts */
  inputDefault: number | string;
  /** Called with the clamped number on Enter or blur */
  onCommit: (v: number) => void;
  min: number;
  max: number;
  /** Custom parse function (raw string → number). Defaults to parseFloat. */
  parse?: (raw: string) => number;
}

function EditableSliderValue({
  displayValue,
  inputDefault,
  onCommit,
  min,
  max,
  parse = parseFloat,
}: IEditableSliderValueProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(String(inputDefault));
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = parse(draft);
    if (!isNaN(parsed)) {
      onCommit(Math.min(max, Math.max(min, parsed)));
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.editableValueInput}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className={styles.editableValueSpan}
      onClick={startEditing}
      title="Click to edit"
    >
      {displayValue}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppV2() {
  // ── Beat & timeline state ─────────────────────────────────────────────────
  const [beat, setBeat] = useState<TBeat>(0);
  const [beatDurations, setBeatDurations] =
    useState<Record<TBeat, number>>(DEFAULT_BEAT_DURATIONS);

  // ── Scene reset ref ───────────────────────────────────────────────────
  const sceneResetFnRef = useRef<(() => void) | undefined>(undefined);
  const [normalizedTime, setNormalizedTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Settings ──────────────────────────────────────────────────────────────
  const [shape, setShape] = useState<"sphere" | "cube">("cube");
  const [particleCount, setParticleCount] = useState(6_000);
  const [particleSize, setParticleSize] = useState(0.0036);
  const [opacity, setOpacity] = useState(0.8);
  const [swirlStrength, setSwirlStrength] = useState(0.001);
  const [revealMode, setRevealMode] = useState<"anatomical" | "random">("random");
  const [formTransition, setFormTransition] = useState<"fast" | "drift" | "cascade">("drift");
  const [hintSpeed, setHintSpeed] = useState<"subtle" | "slow" | "medium">("slow");
  const [revealPacing, setRevealPacing] = useState<"dramatic" | "burst" | "current">("current");
  const [surfaceMotion, setSurfaceMotion] = useState<"still" | "shimmer" | "breathe" | "flow">("flow");
  const [surfaceDepthBias, setSurfaceDepthBias] = useState<TSurfaceDepthBias>("uniform");
  const [depthSizing, setDepthSizing] = useState<TDepthSizing>("flat");

  // ── Panel state ───────────────────────────────────────────────────────────
  const [beatsOpen, setBeatsOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const beatsWrapRef = useRef<HTMLDivElement>(null);
  const controlsWrapRef = useRef<HTMLDivElement>(null);
  const [openSections, setOpenSections] = useState<Set<TSection>>(
    new Set<TSection>(["Playback", "Particles"]),
  );

  // ── Figure orientation state ──────────────────────────────────────────────
  const [debugSectionOpen, setDebugSectionOpen] = useState(false);
  const [debugRotX, setDebugRotX] = useState(-1.59);
  const [debugRotY, setDebugRotY] = useState(0.01);
  const [debugRotZ, setDebugRotZ] = useState(-0.19);

  // ── Text overlay state ────────────────────────────────────────────────────
  const [displayedOverlay, setDisplayedOverlay] = useState<IOverlayContent>(
    () => getOverlayContent(1, false),
  );
  const [textVisible, setTextVisible] = useState(false);
  const textTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beat3CrossedRef = useRef(false);
  const beatRefForCb = useRef<TBeat>(beat);
  beatRefForCb.current = beat;

  // ── Nav expand/collapse ───────────────────────────────────────────────────
  const [navExpanded, setNavExpanded] = useState(false);

  // Auto-expand nav whenever a panel opens
  useEffect(() => {
    if (beatsOpen || controlsOpen) {
      setNavExpanded(true);
    }
  }, [beatsOpen, controlsOpen]);

  const toggleNav = useCallback(() => {
    setNavExpanded((prev) => !prev);
  }, []);

  const toggleSection = useCallback((section: TSection) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  // ── Text overlay helpers ──────────────────────────────────────────────────

  const doTextTransition = useCallback(
    (content: IOverlayContent, fadeOutMs: number) => {
      if (textTransitionTimerRef.current) clearTimeout(textTransitionTimerRef.current);
      setTextVisible(false);
      textTransitionTimerRef.current = setTimeout(() => {
        setDisplayedOverlay(content);
        setTextVisible(true);
      }, fadeOutMs);
    },
    [],
  );

  const handleBeatProgress = useCallback(
    (progress: number) => {
      if (beatRefForCb.current === 3 && progress >= 0.5 && !beat3CrossedRef.current) {
        beat3CrossedRef.current = true;
        doTextTransition(
          { headline: "Your business is coming into focus", subtext: "We're putting it all together" },
          200,
        );
      }
    },
    [doTextTransition],
  );

  // Fade in initial text on mount, then react to beat changes
  useEffect(() => {
    beat3CrossedRef.current = false;
    if (beat === 0) {
      // Beat 0 "Initial": no text overlay
      setTextVisible(false);
      return;
    }
    doTextTransition(getOverlayContent(beat, false), 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, doTextTransition]);

  // Cleanup overlay timer on unmount
  useEffect(() => {
    return () => {
      if (textTransitionTimerRef.current) clearTimeout(textTransitionTimerRef.current);
    };
  }, []);

  // ── Playback RAF ─────────────────────────────────────────────────────────
  const playRafRef = useRef(0);
  const playStartTimeRef = useRef(0);
  const playStartNormRef = useRef(0);

  const totalDurationMs = useMemo(
    () => BEATS.reduce((sum, b) => sum + beatDurations[b], 0),
    [beatDurations],
  );

  const stopPlayback = useCallback(() => {
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    playStartTimeRef.current = performance.now();
    playStartNormRef.current = normalizedTime;
    setIsPlaying(true);

    function tick(now: number) {
      const elapsed = now - playStartTimeRef.current;
      const dt = elapsed / totalDurationMs;
      const t = Math.min(playStartNormRef.current + dt, 1);

      setNormalizedTime(t);
      const { beat: newBeat } = beatAtTime(t, beatDurations);
      setBeat(newBeat);

      if (t < 1) {
        playRafRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
      }
    }

    playRafRef.current = requestAnimationFrame(tick);
  }, [normalizedTime, totalDurationMs, beatDurations]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (normalizedTime >= 1) {
        setNormalizedTime(0);
        setBeat(1);
        playStartNormRef.current = 0;
        playStartTimeRef.current = performance.now();
        setIsPlaying(true);

        function tickRestart(now: number) {
          const elapsed = now - playStartTimeRef.current;
          const dt = elapsed / totalDurationMs;
          const t = Math.min(dt, 1);
          setNormalizedTime(t);
          const { beat: newBeat } = beatAtTime(t, beatDurations);
          setBeat(newBeat);
          if (t < 1) {
            playRafRef.current = requestAnimationFrame(tickRestart);
          } else {
            setIsPlaying(false);
          }
        }
        playRafRef.current = requestAnimationFrame(tickRestart);
      } else {
        startPlayback();
      }
    }
  }, [
    isPlaying,
    normalizedTime,
    startPlayback,
    stopPlayback,
    totalDurationMs,
    beatDurations,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    };
  }, []);

  // ── Beat stepper ──────────────────────────────────────────────────────────
  const handleBeatClick = useCallback(
    (b: TBeat) => {
      stopPlayback();
      setBeat(b);
      setNormalizedTime(beatStartT(b, beatDurations));
    },
    [stopPlayback, beatDurations],
  );

  // ── Scrubber drag ─────────────────────────────────────────────────────────
  const handleScrubberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stopPlayback();
      const t = parseFloat(e.target.value);
      setNormalizedTime(t);
      const { beat: newBeat } = beatAtTime(t, beatDurations);
      setBeat(newBeat);
    },
    [stopPlayback, beatDurations],
  );

  // ── Beat duration patch ───────────────────────────────────────────────────
  const patchBeatDuration = useCallback((b: TBeat, ms: number) => {
    setBeatDurations((prev) => ({ ...prev, [b]: ms }));
  }, []);

  // ── Restart ───────────────────────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    stopPlayback();
    setNormalizedTime(0);
    setBeat(0);
    sceneResetFnRef.current?.();
  }, [stopPlayback]);

  // ── Scene reset registration ──────────────────────────────────────────────
  const handleSceneResetRegistration = useCallback((fn: () => void) => {
    sceneResetFnRef.current = fn;
  }, []);

  // ── Panel toggles ─────────────────────────────────────────────────────────
  const toggleBeats = useCallback(() => {
    setBeatsOpen((o) => !o);
    setControlsOpen(false);
  }, []);

  const toggleControls = useCallback(() => {
    setControlsOpen((o) => !o);
    setBeatsOpen(false);
  }, []);

  const closePanels = useCallback(() => {
    setBeatsOpen(false);
    setControlsOpen(false);
  }, []);

  // Compute position: fixed coordinates from a wrapper ref so panels escape
  // the nav bar's overflow-x:clip and render at their natural width.
  function getPanelStyle(ref: React.RefObject<HTMLDivElement | null>): React.CSSProperties {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return {};
    // rect.top is the button's top edge (inside the nav pill).
    // The pill has 6px padding above the buttons, so pill top = rect.top - 6.
    // We want 8px above the pill top, so bottom = windowHeight - pillTop + 8.
    return {
      position: "fixed",
      left: rect.left,
      bottom: window.innerHeight - rect.top + 22,
    };
  }

  return (
    <div className={styles.app}>
      {/* ── Full-screen Canvas ──────────────────────────────────────────── */}
      <div className={styles.canvasWrap}>
        <Canvas
          camera={{
            fov: 45,
            near: 0.1,
            far: 200,
            position: [0, 0.5, 5],
          }}
          dpr={[1, 2]}
          gl={{
            alpha: false,
            antialias: true,
            powerPreference: "high-performance",
          }}
          shadows={false}
        >
          <SceneV2
            beat={beat}
            shape={shape}
            particleCount={particleCount}
            particleSize={particleSize}
            color="#ffffff"
            opacity={opacity}
            swirlStrength={swirlStrength}
            revealMode={revealMode}
            formTransition={formTransition}
            hintSpeed={hintSpeed}
            revealPacing={revealPacing}
            surfaceMotion={surfaceMotion}
            surfaceDepthBias={surfaceDepthBias}
            depthSizing={depthSizing}
            beatDurationMs={beatDurations[beat]}
            onBeatProgress={handleBeatProgress}
            onReset={handleSceneResetRegistration}
            orbitEnabled={beat === 5}
            debugMeshRotation={{ x: debugRotX, y: debugRotY, z: debugRotZ }}
          />
        </Canvas>
      </div>

      {/* ── Logo mark ───────────────────────────────────────────────────── */}
      <img
        className={styles.logoMark}
        src="/mercury-logo-lockup.svg"
        alt="Mercury"
        draggable={false}
      />

      {/* ── User name (top-right) ────────────────────────────────────────── */}
      <div className={styles.userName}>
        Jane Black <span className={styles.userChevron}>∨</span>
      </div>

      {/* ── Text overlay ────────────────────────────────────────────────── */}
      {beat !== 0 && (
        <div className={styles.textOverlay}>
          <div className={`${styles.textBlock} ${textVisible ? styles.textBlockVisible : ""}`}>
            <p className={styles.overlayHeadline}>{displayedOverlay.headline}</p>
            <p className={styles.overlaySubtext}>{displayedOverlay.subtext}</p>
            {displayedOverlay.showCta && (
              <button
                className={styles.ctaButton}
                onClick={() => console.log("Set up account clicked")}
              >
                Set up account
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Backdrop (closes panels on outside click) ────────────────── */}
      {(beatsOpen || controlsOpen) && (
        <div className={styles.backdrop} onClick={closePanels} />
      )}


      {/* ── Timeline scrubber (thin bar at very bottom edge) ────────────── */}
      <div
        className={`${styles.scrubberWrap}${navExpanded ? "" : ` ${styles.scrubberWrapCollapsed}`}`}
      >
        <input
          className={styles.scrubberTrack}
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={normalizedTime}
          onChange={handleScrubberChange}
        />
      </div>

      {/* ── Bottom navigation bar (pill, expands horizontally) ───────────── */}
      <nav
        className={`${styles.bottomNav}${navExpanded ? "" : ` ${styles.bottomNavCollapsed}`}`}
      >
        {/* Chevron is the first child — always visible, acts as toggle */}
        <button
          className={styles.navChevron}
          onClick={toggleNav}
          title={navExpanded ? "Collapse nav" : "Expand nav"}
          aria-label={navExpanded ? "Collapse nav" : "Expand nav"}
        >
          {navExpanded ? (
            <ChevronLeftIcon className={styles.navIcon} />
          ) : (
            <ChevronRightIcon className={styles.navIcon} />
          )}
        </button>

        <button
          className={styles.navBtn}
          onClick={() => window.history.back()}
          title="Go back"
        >
          <ArrowLeftIcon className={styles.navIcon} />
          <span className={styles.navLabel}>Back</span>
        </button>

        <button
          className={styles.navBtn}
          onClick={handleRestart}
          title="Restart"
        >
          <RotateLeftIcon className={styles.navIcon} />
          <span className={styles.navLabel}>Restart</span>
        </button>

        <div className={styles.navBtnWrap} ref={beatsWrapRef}>
          <button
            className={`${styles.navBtn} ${beatsOpen ? styles.navBtnActive : ""}`}
            onClick={toggleBeats}
            title="Beats"
          >
            <LayerGroupIcon className={styles.navIcon} />
            <span className={styles.navLabel}>Beats</span>
          </button>
        </div>

        <div className={styles.navBtnWrap} ref={controlsWrapRef}>
          <button
            className={`${styles.navBtn} ${controlsOpen ? styles.navBtnActive : ""}`}
            onClick={toggleControls}
            title="Controls"
          >
            <SlidersIcon className={styles.navIcon} />
            <span className={styles.navLabel}>Controls</span>
          </button>
        </div>
      </nav>

      {/* ── Beats panel (outside nav so it isn't clipped by overflow:hidden) ── */}
      {beatsOpen && (
        <div className={styles.beatsPanel} style={getPanelStyle(beatsWrapRef)} onClick={(e) => e.stopPropagation()}>
          <div className={styles.beatsPanelHeader}>
            <span className={styles.beatsPanelTitle}>BEATS</span>
            <button
              className={styles.beatsPanelChevron}
              onClick={() => setBeatsOpen(false)}
              aria-label="Close beats panel"
            >
              ▾
            </button>
          </div>
          <ul className={styles.beatList}>
            {ALL_DISPLAY_BEATS.map((b) => (
              <li
                key={b}
                className={`${styles.beatRow} ${beat === b ? styles.beatRowActive : ""}`}
                onClick={() => handleBeatClick(b)}
              >
                {BEAT_LABELS[b]}
              </li>
            ))}
          </ul>
          <button
            className={styles.beatsPlayBtn}
            onClick={togglePlay}
          >
            {isPlaying ? "■ Stop" : "▶ Play sequence"}
          </button>
        </div>
      )}

      {/* ── Controls panel (outside nav so it isn't clipped by overflow:hidden) ── */}
      {controlsOpen && (
        <div className={styles.controlsPanel} style={getPanelStyle(controlsWrapRef)} onClick={(e) => e.stopPropagation()}>
              <p className={styles.panelHeading}>Controls</p>

              {/* Playback */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Playback")}
                >
                  <span>Playback</span>
                  <span className={openSections.has("Playback") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Playback") && (
                  <div className={styles.accordionBody}>
                    {BEATS.map((b) => (
                      <div key={b} className={styles.controlRow}>
                        <label className={styles.controlLabel}>
                          <span>{BEAT_LABELS[b]}</span>
                          <EditableSliderValue
                            displayValue={formatSeconds(beatDurations[b])}
                            inputDefault={beatDurations[b] / 1000}
                            onCommit={(v) => patchBeatDuration(b, Math.round(v) * 1000)}
                            min={2}
                            max={30}
                          />
                        </label>
                        <input
                          className={styles.slider}
                          type="range"
                          min={2_000}
                          max={30_000}
                          step={1_000}
                          value={beatDurations[b]}
                          onChange={(e) =>
                            patchBeatDuration(b, parseInt(e.target.value))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Particles */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Particles")}
                >
                  <span>Particles</span>
                  <span className={openSections.has("Particles") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Particles") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Size</span>
                        <EditableSliderValue
                          displayValue={particleSize.toFixed(4)}
                          inputDefault={particleSize}
                          onCommit={setParticleSize}
                          min={0.001}
                          max={0.012}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={0.001}
                        max={0.012}
                        step={0.0002}
                        value={particleSize}
                        onChange={(e) => setParticleSize(parseFloat(e.target.value))}
                      />
                    </div>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Opacity</span>
                        <EditableSliderValue
                          displayValue={opacity.toFixed(2)}
                          inputDefault={opacity}
                          onCommit={setOpacity}
                          min={0.1}
                          max={1}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.01}
                        value={opacity}
                        onChange={(e) => setOpacity(parseFloat(e.target.value))}
                      />
                    </div>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Density</span>
                      <div className={styles.segmented}>
                        {DENSITY_PRESETS.map(({ label, count }) => (
                          <button
                            key={label}
                            className={`${styles.segmentBtn} ${particleCount === count ? styles.segmentBtnActive : ""}`}
                            onClick={() => setParticleCount(count)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Shape */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Shape")}
                >
                  <span>Shape</span>
                  <span className={openSections.has("Shape") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Shape") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Beat 2 shape</span>
                      <div className={styles.segmented}>
                        {(["cube", "sphere"] as const).map((s) => (
                          <button
                            key={s}
                            className={`${styles.segmentBtn} ${shape === s ? styles.segmentBtnActive : ""}`}
                            onClick={() => setShape(s)}
                          >
                            {s === "cube" ? "Cube" : "Sphere"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Reveal */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Reveal")}
                >
                  <span>Reveal</span>
                  <span className={openSections.has("Reveal") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Reveal") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Reveal mode</span>
                      <div className={styles.segmented}>
                        {(["random", "anatomical"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${revealMode === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setRevealMode(m)}
                          >
                            {m === "random" ? "Random" : "Anatomical"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Swirl */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Swirl")}
                >
                  <span>Swirl</span>
                  <span className={openSections.has("Swirl") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Swirl") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Strength</span>
                        <EditableSliderValue
                          displayValue={swirlStrength.toFixed(4)}
                          inputDefault={swirlStrength}
                          onCommit={setSwirlStrength}
                          min={0}
                          max={0.012}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={0}
                        max={0.012}
                        step={0.0002}
                        value={swirlStrength}
                        onChange={(e) => setSwirlStrength(parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Animation */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Animation")}
                >
                  <span>Animation</span>
                  <span className={openSections.has("Animation") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Animation") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Form Transition</span>
                      <div className={styles.segmented}>
                        {(["fast", "drift", "cascade"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${formTransition === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setFormTransition(m)}
                          >
                            {m === "fast" ? "Fast" : m === "drift" ? "Drift" : "Cascade"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Hint Speed</span>
                      <div className={styles.segmented}>
                        {(["subtle", "slow", "medium"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${hintSpeed === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setHintSpeed(m)}
                          >
                            {m === "subtle" ? "Subtle" : m === "slow" ? "Slow" : "Medium"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Reveal Pacing</span>
                      <div className={styles.segmented}>
                        {(["dramatic", "burst", "current"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${revealPacing === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setRevealPacing(m)}
                          >
                            {m === "dramatic" ? "Dramatic" : m === "burst" ? "Burst" : "Current"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Surface Motion</span>
                      <div className={styles.segmented}>
                        {(["still", "shimmer", "breathe", "flow"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${surfaceMotion === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setSurfaceMotion(m)}
                          >
                            {m === "still" ? "Still" : m === "shimmer" ? "Shimmer" : m === "breathe" ? "Breathe" : "Flow"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Surface Depth */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleSection("Surface Depth")}
                >
                  <span>Surface Depth</span>
                  <span className={openSections.has("Surface Depth") ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {openSections.has("Surface Depth") && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Particle Density Bias</span>
                      <div className={styles.segmented}>
                        {(["uniform", "crease", "shadow"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${surfaceDepthBias === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setSurfaceDepthBias(m)}
                          >
                            {m === "uniform" ? "Uniform" : m === "crease" ? "Crease" : "Shadow"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.controlRow}>
                      <span className={styles.controlLabelText}>Depth Sizing</span>
                      <div className={styles.segmented}>
                        {(["flat", "depth", "rim"] as const).map((m) => (
                          <button
                            key={m}
                            className={`${styles.segmentBtn} ${depthSizing === m ? styles.segmentBtnActive : ""}`}
                            onClick={() => setDepthSizing(m)}
                          >
                            {m === "flat" ? "Flat" : m === "depth" ? "Depth" : "Rim"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Figure Orientation */}
              <div className={styles.accordionSection}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => setDebugSectionOpen((o) => !o)}
                >
                  <span>Figure Orientation</span>
                  <span className={debugSectionOpen ? styles.chevronOpen : styles.chevron}>▾</span>
                </button>
                {debugSectionOpen && (
                  <div className={styles.accordionBody}>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Rotate X</span>
                        <EditableSliderValue
                          displayValue={debugRotX.toFixed(2)}
                          inputDefault={debugRotX}
                          onCommit={setDebugRotX}
                          min={-3.14}
                          max={3.14}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={-3.14}
                        max={3.14}
                        step={0.05}
                        value={debugRotX}
                        onChange={(e) => setDebugRotX(parseFloat(e.target.value))}
                      />
                    </div>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Rotate Y</span>
                        <EditableSliderValue
                          displayValue={debugRotY.toFixed(2)}
                          inputDefault={debugRotY}
                          onCommit={setDebugRotY}
                          min={-3.14}
                          max={3.14}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={-3.14}
                        max={3.14}
                        step={0.05}
                        value={debugRotY}
                        onChange={(e) => setDebugRotY(parseFloat(e.target.value))}
                      />
                    </div>
                    <div className={styles.controlRow}>
                      <label className={styles.controlLabel}>
                        <span>Rotate Z</span>
                        <EditableSliderValue
                          displayValue={debugRotZ.toFixed(2)}
                          inputDefault={debugRotZ}
                          onCommit={setDebugRotZ}
                          min={-3.14}
                          max={3.14}
                        />
                      </label>
                      <input
                        className={styles.slider}
                        type="range"
                        min={-3.14}
                        max={3.14}
                        step={0.05}
                        value={debugRotZ}
                        onChange={(e) => setDebugRotZ(parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
        </div>
      )}
    </div>
  );
}

