import { Canvas } from "@react-three/fiber";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TBeat } from "./sim/particleSimV2";
import type {
  TSurfaceDepthBias,
  TDepthSizing,
  TDepthOpacityMode,
  THintShape,
  THintStyle,
} from "./types";
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

function getOverlayContent(
  beat: Exclude<TBeat, 0>,
  isSecondHalf: boolean,
): IOverlayContent {
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

/**
 * Relative width weights for each beat segment in the scrubber track.
 * Index matches TBeat (0–5). Matches DEFAULT_BEAT_DURATIONS (seconds).
 * Total weight = 60.
 */
const BEAT_WEIGHTS: readonly number[] = [4, 6, 8, 12, 20, 10];

const TOTAL_BEAT_WEIGHT = BEAT_WEIGHTS.reduce((s, w) => s + w, 0);

/**
 * Normalized scrubber position (0–1) at which each beat starts,
 * proportional to BEAT_WEIGHTS. beatThresholds[i] is where beat i begins.
 * Result: [0, 0.067, 0.167, 0.3, 0.5, 0.833]
 */
const BEAT_THRESHOLDS: readonly number[] = BEAT_WEIGHTS.reduce<number[]>(
  (acc, _w, i) =>
    acc.concat(
      i === 0 ? 0 : acc[i - 1] + BEAT_WEIGHTS[i - 1] / TOTAL_BEAT_WEIGHT,
    ),
  [],
);

/** All beats shown in the beats panel, including beat 0. */
const ALL_DISPLAY_BEATS: TBeat[] = [0, 1, 2, 3, 4, 5];

const DS_MAGIC_COLORS = [
  { label: "Neutral 300", value: "#c8cad4" }, // default
  { label: "Neutral 400", value: "#b4b7c8" },
  { label: "Neutral 600", value: "#707393" },
  { label: "Purple 300", value: "#a7b6f8" },
  { label: "Purple 400", value: "#8da4f5" },
  { label: "Purple 600", value: "#5266eb" },
  { label: "Blue 300", value: "#8fd0e1" },
  { label: "Blue 400", value: "#77becf" },
  { label: "Blue 600", value: "#007f95" },
  { label: "Green 300", value: "#95d5af" },
  { label: "Green 400", value: "#77c599" },
  { label: "Teal 600", value: "#188554" },
  { label: "Beige 300", value: "#d5c69f" },
  { label: "Beige 400", value: "#c3b389" },
  { label: "Orange 300", value: "#ffb392" },
  { label: "Red 300", value: "#fdb2c8" },
  { label: "Red 400", value: "#fc92b4" },
] as const;

type TDensityLabel = "Sparse" | "Medium" | "Dense";

const DENSITY_PRESETS: {
  label: TDensityLabel;
  swarmCount: number;
  skinCount: number;
}[] = [
  { label: "Sparse", swarmCount: 4_000, skinCount: 20_000 },
  { label: "Medium", swarmCount: 6_000, skinCount: 40_000 },
  { label: "Dense", swarmCount: 8_000, skinCount: 65_000 },
];

const DEFAULT_BEAT_DURATIONS: Record<TBeat, number> = {
  0: 4, // Initial
  1: 6, // Swirl In
  2: 8, // Form
  3: 12, // Hint (3 cycles × 4.2 s ≈ 12.6 s)
  4: 20, // Reveal
  5: 10, // Approved
};

const ACCORDION_SECTIONS = [
  "Playback",
  "Particles",
  "Reveal",
  "Swirl",
  "Animation",
  "Geometry",
  "Surface Depth",
] as const;
type TSection = (typeof ACCORDION_SECTIONS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
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

/**
 * Given a normalized scrubber position (0–1, weight-proportional),
 * returns the TBeat index for that position using the provided thresholds.
 */
function beatAtScrubberPos(
  normalized: number,
  thresholds: readonly number[],
): TBeat {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const threshold = thresholds[i];
    if (threshold !== undefined && normalized >= threshold) return i as TBeat;
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
  const [beatDurations, setBeatDurations] = useState<Record<TBeat, number>>(
    DEFAULT_BEAT_DURATIONS,
  );

  // ── Dynamic scrubber weights (mirror beatDurations) ──────────────────────
  const beatWeights = useMemo(
    () => ALL_DISPLAY_BEATS.map((b) => beatDurations[b]),
    [beatDurations],
  );
  const totalBeatWeight = useMemo(
    () => beatWeights.reduce((s, w) => s + w, 0),
    [beatWeights],
  );
  const beatThresholds = useMemo(
    () =>
      beatWeights.reduce<number[]>(
        (acc, _w, i) =>
          acc.concat(
            i === 0 ? 0 : acc[i - 1] + beatWeights[i - 1] / totalBeatWeight,
          ),
        [],
      ),
    [beatWeights, totalBeatWeight],
  );
  const beatThresholdsRef = useRef<readonly number[]>(beatThresholds);
  useEffect(() => {
    beatThresholdsRef.current = beatThresholds;
  }, [beatThresholds]);

  const beatStartTimeRef = useRef<number>(Date.now());

  // ── Scene reset ref ───────────────────────────────────────────────────
  const sceneResetFnRef = useRef<(() => void) | undefined>(undefined);

  // ── Scrubber position (weight-based, 0–1000) ──────────────────────────
  // scrubberValue drives the <input type="range"> and the thumb position.
  // normalizedTime is derived (scrubberValue / 1000) and is weight-proportional.
  // durationNorm is duration-based (0–1 across beats 1–5) and is used only
  // by the playback RAF so it can resume from the correct clock position.
  const [scrubberValue, setScrubberValue] = useState(0);
  const normalizedTime = scrubberValue / 1000;
  const [durationNorm, setDurationNorm] = useState(0);

  // Ref so the beat→scrubberValue effect can read the current value without
  // adding scrubberValue to its dependency array (which would cause loops).
  const scrubberValueRef = useRef(scrubberValue);
  scrubberValueRef.current = scrubberValue;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrubberRafRef = useRef<number>(0);

  // ── Settings ──────────────────────────────────────────────────────────────
  // Fixed swarm count — Dense/Sparse only affects the surface skin layer.
  const [densityLabel, setDensityLabel] = useState<TDensityLabel>("Medium");
  const densityPreset =
    DENSITY_PRESETS.find((p) => p.label === densityLabel) ?? DENSITY_PRESETS[1];
  const particleCount = densityPreset.swarmCount;
  const skinParticleCount = densityPreset.skinCount;
  const [particleSize, setParticleSize] = useState(0.0033);
  const [opacity, setOpacity] = useState(0.8);
  const [swirlStrength, setSwirlStrength] = useState(0.001);
  const [revealMode, setRevealMode] = useState<"anatomical" | "random">(
    "random",
  );
  const [formTransition, setFormTransition] = useState<
    "fast" | "drift" | "cascade"
  >("drift");
  const [hintSpeed, setHintSpeed] = useState<"subtle" | "slow" | "medium">(
    "slow",
  );
  const [revealPacing, setRevealPacing] = useState<
    "dramatic" | "burst" | "current"
  >("current");
  const [surfaceMotion, setSurfaceMotion] = useState<
    "still" | "shimmer" | "breathe" | "flow"
  >("flow");
  const [surfaceDepthBias, setSurfaceDepthBias] =
    useState<TSurfaceDepthBias>("crease");
  const [depthSizing, setDepthSizing] = useState<TDepthSizing>("depth");
  const [depthOpacityMode, setDepthOpacityMode] =
    useState<TDepthOpacityMode>("off");
  const [cubeScale, setCubeScale] = useState(1.5);
  const [hintCycles, setHintCycles] = useState(3);
  const [hintStyle, setHintStyle] = useState<THintStyle>("bulge");
  const [hintSpread, setHintSpread] = useState(0.54);
  const [hintShape, setHintShape] = useState<THintShape>("blob");
  const [hintMeltSpeed, setHintMeltSpeed] = useState(1.0);
  const [revealStages, setRevealStages] = useState(4);
  const [waveSpeed, setWaveSpeed] = useState(1.5);
  const [transitionDuration, setTransitionDuration] = useState(2.25);
  const [particleColor, setParticleColor] = useState("#c8cad4");

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
  const [figureScale, setFigureScale] = useState(1.66);
  const [figurePosX, setFigurePosX] = useState(0);
  const [figurePosY, setFigurePosY] = useState(0.9);
  const [figurePosZ, setFigurePosZ] = useState(0);

  // ── Text overlay state ────────────────────────────────────────────────────
  const [displayedOverlay, setDisplayedOverlay] = useState<IOverlayContent>(
    () => getOverlayContent(1, false),
  );
  const [textVisible, setTextVisible] = useState(false);
  const textTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const beat3CrossedRef = useRef(false);
  const beatRefForCb = useRef<TBeat>(beat);
  beatRefForCb.current = beat;

  // ── Slider proximity reveal ───────────────────────────────────────────────
  const [sliderVisible, setSliderVisible] = useState(false);
  const sliderHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (window.innerHeight - e.clientY <= 40) {
        if (sliderHideTimerRef.current) {
          clearTimeout(sliderHideTimerRef.current);
          sliderHideTimerRef.current = null;
        }
        setSliderVisible(true);
      } else {
        if (!sliderHideTimerRef.current) {
          sliderHideTimerRef.current = setTimeout(() => {
            setSliderVisible(false);
            sliderHideTimerRef.current = null;
          }, 150);
        }
      }
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (sliderHideTimerRef.current) clearTimeout(sliderHideTimerRef.current);
    };
  }, []);

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
      if (textTransitionTimerRef.current)
        clearTimeout(textTransitionTimerRef.current);
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
      if (
        beatRefForCb.current === 3 &&
        progress >= 0.5 &&
        !beat3CrossedRef.current
      ) {
        beat3CrossedRef.current = true;
        doTextTransition(
          {
            headline: "Your business is coming into focus",
            subtext: "We're putting it all together",
          },
          200,
        );
      }
    },
    [doTextTransition],
  );

  // Fade in initial text on mount, then react to beat changes
  useEffect(() => {
    beatStartTimeRef.current = Date.now();
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
      if (textTransitionTimerRef.current)
        clearTimeout(textTransitionTimerRef.current);
    };
  }, []);

  // ── Playback RAF ─────────────────────────────────────────────────────────
  const playRafRef = useRef(0);
  const playStartTimeRef = useRef(0);
  const playStartNormRef = useRef(0);

  const totalDurationMs = useMemo(
    () => BEATS.reduce((sum, b) => sum + beatDurations[b], 0) * 1000,
    [beatDurations],
  );

  // ── Auto-advance: after each beat's duration elapses, move to the next beat ──
  useEffect(() => {
    if (beat >= 5 || isPlaying) return;
    const timer = setTimeout(() => {
      setBeat((prev) => Math.min(prev + 1, 5) as TBeat);
    }, beatDurations[beat] * 1000);
    return () => clearTimeout(timer);
  }, [beat, beatDurations, isPlaying]);

  const stopPlayback = useCallback(() => {
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    playStartTimeRef.current = performance.now();
    playStartNormRef.current = durationNorm;
    setIsPlaying(true);

    function tick(now: number) {
      const elapsed = now - playStartTimeRef.current;
      const dt = elapsed / totalDurationMs;
      const t = Math.min(playStartNormRef.current + dt, 1);

      setDurationNorm(t);
      const { beat: newBeat, progress } = beatAtTime(t, beatDurations);
      setBeat(newBeat);

      // Map beat + within-beat progress → weight-proportional scrubber position
      const thresh0 = beatThresholdsRef.current[newBeat] ?? 0;
      const thresh1 = beatThresholdsRef.current[newBeat + 1] ?? 1;
      setScrubberValue(
        Math.round((thresh0 + progress * (thresh1 - thresh0)) * 1000),
      );

      if (t < 1) {
        playRafRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
      }
    }

    playRafRef.current = requestAnimationFrame(tick);
  }, [durationNorm, totalDurationMs, beatDurations]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (durationNorm >= 1) {
        setDurationNorm(0);
        setBeat(1);
        setScrubberValue(
          Math.round((beatThresholdsRef.current[1] ?? 0) * 1000),
        );
        playStartNormRef.current = 0;
        playStartTimeRef.current = performance.now();
        setIsPlaying(true);

        function tickRestart(now: number) {
          const elapsed = now - playStartTimeRef.current;
          const dt = elapsed / totalDurationMs;
          const t = Math.min(dt, 1);
          setDurationNorm(t);
          const { beat: newBeat, progress } = beatAtTime(t, beatDurations);
          setBeat(newBeat);
          const thresh0 = beatThresholdsRef.current[newBeat] ?? 0;
          const thresh1 = beatThresholdsRef.current[newBeat + 1] ?? 1;
          setScrubberValue(
            Math.round((thresh0 + progress * (thresh1 - thresh0)) * 1000),
          );
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
    durationNorm,
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

  // ── Smooth scrubber RAF loop ───────────────────────────────────────────────
  // Drives scrubberValue from elapsed time within the current beat so the
  // thumb moves continuously rather than snapping on each beat change.
  useEffect(() => {
    const tick = () => {
      if (!isDragging) {
        const elapsed = (Date.now() - beatStartTimeRef.current) / 1000;
        const beatDur = beatDurations[beat];
        const progressInBeat = Math.min(elapsed / Math.max(beatDur, 0.001), 1);

        const beatStart = beatThresholdsRef.current[beat] ?? 0;
        const beatEnd = beatThresholdsRef.current[beat + 1] ?? 1;

        const scrubberPos = beatStart + progressInBeat * (beatEnd - beatStart);
        setScrubberValue(Math.round(scrubberPos * 1000));
      }
      scrubberRafRef.current = requestAnimationFrame(tick);
    };
    scrubberRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(scrubberRafRef.current);
  }, [beat, isDragging, beatDurations, beatThresholds]);

  // ── Beat stepper ──────────────────────────────────────────────────────────
  const handleBeatClick = useCallback(
    (b: TBeat) => {
      stopPlayback();
      setBeat(b);
      setScrubberValue(Math.round((beatThresholds[b] ?? 0) * 1000));
      setDurationNorm(beatStartT(b, beatDurations));
    },
    [stopPlayback, beatDurations, beatThresholds],
  );

  // ── Scrubber drag ─────────────────────────────────────────────────────────
  const handleScrubberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stopPlayback();
      const raw = parseInt(e.target.value, 10);
      const weightedNorm = raw / 1000;
      const newBeat = beatAtScrubberPos(weightedNorm, beatThresholds);
      setScrubberValue(raw);
      setBeat(newBeat);
      // Snap durationNorm to beat start so playback can resume correctly
      setDurationNorm(beatStartT(newBeat, beatDurations));
    },
    [stopPlayback, beatDurations, beatThresholds],
  );

  // ── Beat duration patch ───────────────────────────────────────────────────
  const patchBeatDuration = useCallback((b: TBeat, s: number) => {
    setBeatDurations((prev) => ({ ...prev, [b]: s }));
  }, []);

  // ── Restart ───────────────────────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    stopPlayback();
    setScrubberValue(0);
    setDurationNorm(0);
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
  function getPanelStyle(
    ref: React.RefObject<HTMLDivElement | null>,
  ): React.CSSProperties {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return {};
    // rect.top is the button's top edge (inside the nav pill).
    // The pill has 6px padding above the buttons, so pill top = rect.top - 6.
    // We want 8px above the pill top, so bottom = windowHeight - pillTop + 8.
    return {
      position: "fixed",
      right: window.innerWidth - rect.right,
      left: "auto",
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
            particleCount={particleCount}
            skinParticleCount={skinParticleCount}
            particleSize={particleSize}
            color={particleColor}
            opacity={opacity}
            swirlStrength={swirlStrength}
            revealMode={revealMode}
            formTransition={formTransition}
            hintSpeed={hintSpeed}
            revealPacing={revealPacing}
            surfaceMotion={surfaceMotion}
            surfaceDepthBias={surfaceDepthBias}
            depthSizing={depthSizing}
            depthOpacityMode={depthOpacityMode}
            beatDuration={beatDurations[beat]}
            onBeatProgress={handleBeatProgress}
            onReset={handleSceneResetRegistration}
            orbitEnabled={beat === 5}
            debugMeshRotation={{ x: debugRotX, y: debugRotY, z: debugRotZ }}
            figureScale={figureScale}
            figurePosX={figurePosX}
            figurePosY={figurePosY}
            figurePosZ={figurePosZ}
            cubeScale={cubeScale}
            hintCycles={hintCycles}
            hintStyle={hintStyle}
            hintSpread={hintSpread}
            hintShape={hintShape}
            hintMeltSpeed={hintMeltSpeed}
            revealStages={revealStages}
            waveSpeed={waveSpeed}
            transitionDuration={transitionDuration}
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
          <div
            className={`${styles.textBlock} ${textVisible ? styles.textBlockVisible : ""}`}
          >
            <p className={styles.overlayHeadline}>
              {displayedOverlay.headline}
            </p>
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

      {/* ── Timeline scrubber (slides up from bottom on proximity) ────────── */}
      <div
        className={`${styles.scrubberWrap}${sliderVisible ? ` ${styles.scrubberWrapVisible}` : ""}`}
      >
        <div className={styles.scrubberInner}>
          {sliderVisible && (
            <span
              className={styles.scrubberBeatLabel}
              style={{ left: `${normalizedTime * 100}%` }}
            >
              {BEAT_LABELS[beat]}
            </span>
          )}
          {/* Hidden range input — handles all drag/click interaction */}
          <input
            className={styles.scrubberInput}
            type="range"
            min={0}
            max={1000}
            step={1}
            value={scrubberValue}
            onChange={handleScrubberChange}
            onPointerDown={() => setIsDragging(true)}
            onPointerUp={(e) => {
              setIsDragging(false);
              const pos = Number((e.target as HTMLInputElement).value) / 1000;
              const newBeat = beatAtScrubberPos(pos, beatThresholdsRef.current);
              const beatStart = beatThresholdsRef.current[newBeat] ?? 0;
              const beatEnd = beatThresholdsRef.current[newBeat + 1] ?? 1;
              const progressInBeat =
                beatEnd > beatStart
                  ? (pos - beatStart) / (beatEnd - beatStart)
                  : 0;
              beatStartTimeRef.current =
                Date.now() - progressInBeat * beatDurations[newBeat] * 1000;
            }}
            onPointerCancel={() => setIsDragging(false)}
          />
          {/* Visual segmented track */}
          <div className={styles.scrubberTrack}>
            {beatWeights.map((weight, i) => (
              <div
                key={i}
                className={styles.scrubberSegment}
                style={{ flex: weight }}
              />
            ))}
          </div>
          {/* Custom thumb dot */}
          <div
            className={styles.scrubberThumb}
            style={{ left: `${normalizedTime * 100}%` }}
          />
        </div>
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
            <ChevronRightIcon className={styles.navIcon} />
          ) : (
            <ChevronLeftIcon className={styles.navIcon} />
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
        <div
          className={styles.beatsPanel}
          style={getPanelStyle(beatsWrapRef)}
          onClick={(e) => e.stopPropagation()}
        >
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
          <button className={styles.beatsPlayBtn} onClick={togglePlay}>
            {isPlaying ? "■ Stop" : "▶ Play sequence"}
          </button>
        </div>
      )}

      {/* ── Controls panel (outside nav so it isn't clipped by overflow:hidden) ── */}
      {controlsOpen && (
        <div
          className={styles.controlsPanel}
          style={getPanelStyle(controlsWrapRef)}
          onClick={(e) => e.stopPropagation()}
        >
          <p className={styles.panelHeading}>Controls</p>

          {/* Playback */}
          <div className={styles.accordionSection}>
            <button
              className={styles.accordionHeader}
              onClick={() => toggleSection("Playback")}
            >
              <span>Playback</span>
              <span
                className={
                  openSections.has("Playback")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
            </button>
            {openSections.has("Playback") && (
              <div className={styles.accordionBody}>
                {BEATS.map((b) => (
                  <div key={b} className={styles.controlRow}>
                    <label className={styles.controlLabel}>
                      <span>{BEAT_LABELS[b]}</span>
                      <EditableSliderValue
                        displayValue={formatSeconds(beatDurations[b])}
                        inputDefault={beatDurations[b]}
                        onCommit={(v) => patchBeatDuration(b, Math.round(v))}
                        min={2}
                        max={60}
                      />
                    </label>
                    <input
                      className={styles.slider}
                      type="range"
                      min={2}
                      max={60}
                      step={1}
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
              <span
                className={
                  openSections.has("Particles")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
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
                    onChange={(e) =>
                      setParticleSize(parseFloat(e.target.value))
                    }
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
                    {DENSITY_PRESETS.map(({ label }) => (
                      <button
                        key={label}
                        className={`${styles.segmentBtn} ${densityLabel === label ? styles.segmentBtnActive : ""}`}
                        onClick={() => setDensityLabel(label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.controlRow}>
                  <span className={styles.controlLabelText}>
                    Particle Color
                  </span>
                  <select
                    className={styles.colorSelect}
                    value={particleColor}
                    onChange={(e) => setParticleColor(e.target.value)}
                  >
                    {DS_MAGIC_COLORS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
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
              <span
                className={
                  openSections.has("Reveal")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
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
              <span
                className={
                  openSections.has("Swirl")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
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
                    onChange={(e) =>
                      setSwirlStrength(parseFloat(e.target.value))
                    }
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
              <span
                className={
                  openSections.has("Animation")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
            </button>
            {openSections.has("Animation") && (
              <div className={styles.accordionBody}>
                <div className={styles.controlRow}>
                  <span className={styles.controlLabelText}>
                    Form Transition
                  </span>
                  <div className={styles.segmented}>
                    {(["fast", "drift", "cascade"] as const).map((m) => (
                      <button
                        key={m}
                        className={`${styles.segmentBtn} ${formTransition === m ? styles.segmentBtnActive : ""}`}
                        onClick={() => setFormTransition(m)}
                      >
                        {m === "fast"
                          ? "Fast"
                          : m === "drift"
                            ? "Drift"
                            : "Cascade"}
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
                        {m === "subtle"
                          ? "Subtle"
                          : m === "slow"
                            ? "Slow"
                            : "Medium"}
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
                        {m === "dramatic"
                          ? "Dramatic"
                          : m === "burst"
                            ? "Burst"
                            : "Current"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.controlRow}>
                  <span className={styles.controlLabelText}>
                    Surface Motion
                  </span>
                  <div className={styles.segmented}>
                    {(["still", "shimmer", "breathe", "flow"] as const).map(
                      (m) => (
                        <button
                          key={m}
                          className={`${styles.segmentBtn} ${surfaceMotion === m ? styles.segmentBtnActive : ""}`}
                          onClick={() => setSurfaceMotion(m)}
                        >
                          {m === "still"
                            ? "Still"
                            : m === "shimmer"
                              ? "Shimmer"
                              : m === "breathe"
                                ? "Breathe"
                                : "Flow"}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Melt Speed</span>
                    <EditableSliderValue
                      displayValue={hintMeltSpeed.toFixed(1)}
                      inputDefault={hintMeltSpeed}
                      onCommit={setHintMeltSpeed}
                      min={0.2}
                      max={3.0}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.1}
                    value={hintMeltSpeed}
                    onChange={(e) =>
                      setHintMeltSpeed(parseFloat(e.target.value))
                    }
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Reveal Stages</span>
                    <EditableSliderValue
                      displayValue={String(revealStages)}
                      inputDefault={revealStages}
                      onCommit={(v) => setRevealStages(Math.round(v))}
                      min={1}
                      max={6}
                      parse={(s) => parseInt(s, 10)}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={revealStages}
                    onChange={(e) =>
                      setRevealStages(parseInt(e.target.value, 10))
                    }
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Wave Speed</span>
                    <EditableSliderValue
                      displayValue={waveSpeed.toFixed(1)}
                      inputDefault={waveSpeed}
                      onCommit={setWaveSpeed}
                      min={0.1}
                      max={3.0}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0.1}
                    max={3.0}
                    step={0.1}
                    value={waveSpeed}
                    onChange={(e) => setWaveSpeed(parseFloat(e.target.value))}
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Velocity Blend</span>
                    <EditableSliderValue
                      displayValue={(
                        0.2 +
                        ((transitionDuration - 0.5) / 3.5) * 0.6
                      ).toFixed(2)}
                      inputDefault={transitionDuration}
                      onCommit={setTransitionDuration}
                      min={0.5}
                      max={4.0}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0.5}
                    max={4.0}
                    step={0.1}
                    value={transitionDuration}
                    onChange={(e) =>
                      setTransitionDuration(parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Geometry */}
          <div className={styles.accordionSection}>
            <button
              className={styles.accordionHeader}
              onClick={() => toggleSection("Geometry")}
            >
              <span>Geometry</span>
              <span
                className={
                  openSections.has("Geometry")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
            </button>
            {openSections.has("Geometry") && (
              <div className={styles.accordionBody}>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Cube Scale</span>
                    <EditableSliderValue
                      displayValue={cubeScale.toFixed(1)}
                      inputDefault={cubeScale}
                      onCommit={setCubeScale}
                      min={0.5}
                      max={5.0}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    value={cubeScale}
                    onChange={(e) => setCubeScale(parseFloat(e.target.value))}
                  />
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
              <span
                className={
                  openSections.has("Surface Depth")
                    ? styles.chevronOpen
                    : styles.chevron
                }
              >
                ▾
              </span>
            </button>
            {openSections.has("Surface Depth") && (
              <div className={styles.accordionBody}>
                <div className={styles.controlRow}>
                  <span className={styles.controlLabelText}>
                    Particle Density Bias
                  </span>
                  <div className={styles.segmented}>
                    {(["uniform", "crease", "shadow"] as const).map((m) => (
                      <button
                        key={m}
                        className={`${styles.segmentBtn} ${surfaceDepthBias === m ? styles.segmentBtnActive : ""}`}
                        onClick={() => setSurfaceDepthBias(m)}
                      >
                        {m === "uniform"
                          ? "Uniform"
                          : m === "crease"
                            ? "Crease"
                            : "Shadow"}
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
                        {m === "flat"
                          ? "Flat"
                          : m === "depth"
                            ? "Depth"
                            : "Rim"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.controlRow}>
                  <span className={styles.controlLabelText}>Depth Opacity</span>
                  <div className={styles.segmented}>
                    {(["off", "subtle", "strong"] as const).map((m) => (
                      <button
                        key={m}
                        className={`${styles.segmentBtn} ${depthOpacityMode === m ? styles.segmentBtnActive : ""}`}
                        onClick={() => setDepthOpacityMode(m)}
                      >
                        {m === "off"
                          ? "Off"
                          : m === "subtle"
                            ? "Subtle"
                            : "Strong"}
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
              <span
                className={
                  debugSectionOpen ? styles.chevronOpen : styles.chevron
                }
              >
                ▾
              </span>
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
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Scale</span>
                    <EditableSliderValue
                      displayValue={figureScale.toFixed(2)}
                      inputDefault={figureScale}
                      onCommit={setFigureScale}
                      min={0.1}
                      max={3.0}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0.1}
                    max={3.0}
                    step={0.01}
                    value={figureScale}
                    onChange={(e) => setFigureScale(parseFloat(e.target.value))}
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Position X</span>
                    <EditableSliderValue
                      displayValue={figurePosX.toFixed(2)}
                      inputDefault={figurePosX}
                      onCommit={setFigurePosX}
                      min={-2}
                      max={2}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={-2}
                    max={2}
                    step={0.05}
                    value={figurePosX}
                    onChange={(e) => setFigurePosX(parseFloat(e.target.value))}
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Position Y</span>
                    <EditableSliderValue
                      displayValue={figurePosY.toFixed(2)}
                      inputDefault={figurePosY}
                      onCommit={setFigurePosY}
                      min={-1}
                      max={3}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={-1}
                    max={3}
                    step={0.05}
                    value={figurePosY}
                    onChange={(e) => setFigurePosY(parseFloat(e.target.value))}
                  />
                </div>
                <div className={styles.controlRow}>
                  <label className={styles.controlLabel}>
                    <span>Position Z</span>
                    <EditableSliderValue
                      displayValue={figurePosZ.toFixed(2)}
                      inputDefault={figurePosZ}
                      onCommit={setFigurePosZ}
                      min={-2}
                      max={2}
                    />
                  </label>
                  <input
                    className={styles.slider}
                    type="range"
                    min={-2}
                    max={2}
                    step={0.05}
                    value={figurePosZ}
                    onChange={(e) => setFigurePosZ(parseFloat(e.target.value))}
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
