import {
  PARTICLE_SETTINGS_DEFAULTS,
  type IParticleSettings,
} from "./particleSettings";
import type { TMercuryAppearance } from "./theme";
import { mercuryDefaultParticleHex } from "./theme";
import type {
  TBlendModeKey,
  TDirectionBias,
  TDistributionMethod,
} from "./types";
import { snapParticleCountForUi } from "./utils/particleCountUi";
import { snapSkinParticleCountForUi } from "./utils/skinParticleCountUi";

export const STORAGE_KEY_SETTINGS = "swarm-sculpture-settings";

export const STORAGE_KEY_THEME = "3d-particle-mapper-theme";

/** `true` when the user customized particle color (`!particleColorFollowsTheme`). */
export const STORAGE_KEY_COLOR_OVERRIDDEN =
  "3d-particle-mapper-color-overridden";

export const STORAGE_KEY_CUSTOM_DEFAULTS = "3d-particle-mapper-custom-defaults";

export interface IHydratedAppState {
  appearance: TMercuryAppearance;
  particleColorFollowsTheme: boolean;
  settings: IParticleSettings;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function syncThemeDatasetFromStoredTheme(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_THEME);
    document.documentElement.dataset.theme =
      raw === "light" || raw === "dark" ? raw : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
}

export function mergeParticleSettingsFromUnknown(
  raw: unknown,
): IParticleSettings {
  return mergeParticleSettingsStored(raw);
}

function mergeParticleSettingsStored(raw: unknown): IParticleSettings {
  const d = PARTICLE_SETTINGS_DEFAULTS;
  if (!raw || typeof raw !== "object") {
    return { ...d };
  }
  const record = raw as Record<string, unknown>;

  const pickBlendMode = (
    candidate: unknown,
    fallback: TBlendModeKey,
  ): TBlendModeKey =>
    candidate === "normal" ||
    candidate === "additive" ||
    candidate === "multiply"
      ? candidate
      : fallback;

  const pickDistribution = (
    candidate: unknown,
    fallback: TDistributionMethod,
  ): TDistributionMethod =>
    candidate === "areaWeighted" || candidate === "triangleUniform"
      ? candidate
      : fallback;

  const pickBias = (
    candidate: unknown,
    fallback: TDirectionBias,
  ): TDirectionBias =>
    candidate === "radial" ||
    candidate === "tangential" ||
    candidate === "random"
      ? candidate
      : fallback;

  const num = (
    candidate: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const next = typeof candidate === "number" ? candidate : Number(candidate);
    return Number.isFinite(next)
      ? Math.min(max, Math.max(min, next))
      : fallback;
  };

  function pickStoredColor(candidate: unknown, fallback: string): string {
    if (typeof candidate !== "string") return fallback;
    const trimmed = candidate.trim();
    return /^#[0-9a-f]{3}$/i.test(trimmed) ||
      /^#[0-9a-f]{4}$/i.test(trimmed) ||
      /^#[0-9a-f]{6}$/i.test(trimmed) ||
      /^#[0-9a-f]{8}$/i.test(trimmed)
      ? trimmed
      : fallback;
  }

  return {
    blendMode: pickBlendMode(record.blendMode, d.blendMode),
    color: pickStoredColor(record.color, d.color),
    distribution: pickDistribution(record.distribution, d.distribution),
    directionBias: pickBias(record.directionBias, d.directionBias),
    movementAmplitude: num(record.movementAmplitude, d.movementAmplitude, 0, 5),
    movementSpeed: num(record.movementSpeed, d.movementSpeed, 0, 40),
    panelBlur: Math.round(num(record.panelBlur, d.panelBlur, 0, 20)),
    panelOpacity: num(record.panelOpacity, d.panelOpacity, 0, 1),
    opacity: num(record.opacity, d.opacity, 0.05, 1),
    particleCount: snapParticleCountForUi(
      typeof record.particleCount === "number"
        ? record.particleCount
        : Number(record.particleCount) || d.particleCount,
    ),
    particleSize: num(record.particleSize, d.particleSize, 0.0005, 0.2),
    showWireframe:
      typeof record.showWireframe === "boolean"
        ? record.showWireframe
        : d.showWireframe,
    surfaceNormalOffset: num(
      record.surfaceNormalOffset,
      d.surfaceNormalOffset,
      -1,
      1,
    ),
    vibrationAmplitude: num(
      record.vibrationAmplitude,
      d.vibrationAmplitude,
      0,
      10,
    ),
    vibrationDamping: num(record.vibrationDamping, d.vibrationDamping, 0, 10),
    vibrationFrequency: num(
      record.vibrationFrequency,
      d.vibrationFrequency,
      0,
      60,
    ),
    vibrationNoiseScale: num(
      record.vibrationNoiseScale,
      d.vibrationNoiseScale,
      0,
      40,
    ),
    wireOpacity: num(record.wireOpacity, d.wireOpacity, 0, 1),
    landingParticleSize: num(
      record.landingParticleSize,
      d.landingParticleSize,
      1,
      6,
    ),
    landingParticleCount: num(
      record.landingParticleCount,
      d.landingParticleCount,
      120,
      600,
    ),
    boidVisualRange: num(record.boidVisualRange, d.boidVisualRange, 0.05, 0.5),
    boidSeparation: num(record.boidSeparation, d.boidSeparation, 0, 0.2),
    boidAlignment: num(record.boidAlignment, d.boidAlignment, 0, 0.2),
    boidCohesion: num(record.boidCohesion, d.boidCohesion, 0, 0.02),
    boidHomeSpring: num(record.boidHomeSpring, d.boidHomeSpring, 0, 0.01),
    boidSpeedLimit: num(record.boidSpeedLimit, d.boidSpeedLimit, 0.005, 0.1),
    boidNoise: num(record.boidNoise, d.boidNoise, 0, 0.01),
    swarmOrbitSpeed: num(record.swarmOrbitSpeed, d.swarmOrbitSpeed, 0.1, 5),
    swarmOrbitRadius: num(record.swarmOrbitRadius, d.swarmOrbitRadius, 0.5, 6),
    swarmSplitIntensity: num(
      record.swarmSplitIntensity,
      d.swarmSplitIntensity,
      0,
      1,
    ),
    swarmSplitSpeed: num(record.swarmSplitSpeed, d.swarmSplitSpeed, 0.1, 3),
    skinEnabled:
      typeof record.skinEnabled === "boolean"
        ? record.skinEnabled
        : d.skinEnabled,
    skinParticleCount: snapSkinParticleCountForUi(
      typeof record.skinParticleCount === "number"
        ? record.skinParticleCount
        : Number(record.skinParticleCount) || d.skinParticleCount,
    ),
    skinParticleSize: num(
      record.skinParticleSize,
      d.skinParticleSize,
      0.001,
      0.05,
    ),
    skinDepthFade: num(record.skinDepthFade, d.skinDepthFade, 0, 1),
    skinNormalShading: num(record.skinNormalShading, d.skinNormalShading, 0, 1),
    skinContourDensity: num(
      record.skinContourDensity,
      d.skinContourDensity,
      0,
      1,
    ),
    skinColor: pickStoredColor(record.skinColor, d.skinColor),
    skinOpacity: num(record.skinOpacity, d.skinOpacity, 0, 1),
  };
}

/** Read persisted preferences once; merges with coded defaults safely. */
export function loadHydratedAppState(): IHydratedAppState {
  let appearance: TMercuryAppearance = "dark";
  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY_THEME);
    if (storedTheme === "light" || storedTheme === "dark")
      appearance = storedTheme;
  } catch {
    /* noop */
  }

  let colorOverridden = false;
  try {
    const ov = window.localStorage.getItem(STORAGE_KEY_COLOR_OVERRIDDEN);
    if (ov === "true") colorOverridden = true;
    else if (ov !== "false" && ov != null) colorOverridden = false;
  } catch {
    /* noop */
  }

  const particleColorFollowsTheme = !colorOverridden;

  let rawSettings: unknown;
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY_SETTINGS);
    rawSettings = serialized ? JSON.parse(serialized) : {};
  } catch {
    rawSettings = {};
  }

  const settings = mergeParticleSettingsStored(rawSettings);

  if (particleColorFollowsTheme) {
    const themeParticles = mercuryDefaultParticleHex(appearance);
    settings.color = themeParticles;
    settings.skinColor = themeParticles;
  }

  return { appearance, particleColorFollowsTheme, settings };
}

function writePersist(state: IHydratedAppState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_THEME, state.appearance);
    window.localStorage.setItem(
      STORAGE_KEY_COLOR_OVERRIDDEN,
      state.particleColorFollowsTheme ? "false" : "true",
    );
    window.localStorage.setItem(
      STORAGE_KEY_SETTINGS,
      JSON.stringify(state.settings),
    );
  } catch {
    /* quota / blocked */
  }
}

export function cancelScheduledPersistHydratedAppState(): void {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
    persistTimer = undefined;
  }
}

export function schedulePersistHydratedAppState(
  state: IHydratedAppState,
  debounceMs = 500,
): void {
  cancelScheduledPersistHydratedAppState();
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    writePersist(state);
  }, debounceMs);
}

/** Footer preset from “Save as default” (validated merge). */
export function loadCustomBaselineSettings(): IParticleSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CUSTOM_DEFAULTS);
    if (raw === null || raw === "") {
      return { ...PARTICLE_SETTINGS_DEFAULTS };
    }

    return mergeParticleSettingsStored(JSON.parse(raw));
  } catch {
    return { ...PARTICLE_SETTINGS_DEFAULTS };
  }
}

export function persistCustomBaselineSettings(
  settings: IParticleSettings,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY_CUSTOM_DEFAULTS,
      JSON.stringify(settings),
    );
  } catch {
    /* quota / blocked */
  }
}
