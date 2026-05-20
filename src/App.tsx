import { Canvas } from '@react-three/fiber';

import type { DragEvent as ReactDragEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { BufferGeometry } from 'three';

import {
  cancelScheduledPersistHydratedAppState,
  loadCustomBaselineSettings,
  loadHydratedAppState,
  persistCustomBaselineSettings,
  schedulePersistHydratedAppState,
} from './appPreferencesPersistence';
import DropLanding from './components/DropLanding';
import Scene from './components/Scene';
import SettingsChrome from './components/SettingsChrome';
import ThemeToggle from './components/ThemeToggle';
import type { IParticleSettings } from './particleSettings';
import {
  type TMercuryAppearance,
  mercuryDefaultParticleHex,
} from './theme';
import { ingestMeshFile } from './utils/meshIngest';

export default function App() {
  const [bundled] = useState(() => loadHydratedAppState());
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [settings, setSettings] = useState<IParticleSettings>(bundled.settings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [appearance, setAppearance] = useState<TMercuryAppearance>(bundled.appearance);
  const [particleColorFollowsTheme, setParticleColorFollowsTheme] =
    useState<boolean>(bundled.particleColorFollowsTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);

  /*
   * When theme-tracking is on, repaint default particle/skin tints whenever appearance flips.
   * react-hooks/set-state-in-effect flags this synchronous sync as “cascading”; it is intentional UX.
   */
  useEffect(() => {
    if (!particleColorFollowsTheme) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- theme drives default beige tints only when following theme
    setSettings((previous) => ({
      ...previous,
      color: mercuryDefaultParticleHex(appearance),
      skinColor: mercuryDefaultParticleHex(appearance),
    }));
  }, [appearance, particleColorFollowsTheme]);

  useEffect(() => {
    schedulePersistHydratedAppState(
      {
        appearance,
        particleColorFollowsTheme,
        settings,
      },
      500,
    );

    return () => cancelScheduledPersistHydratedAppState();
  }, [appearance, particleColorFollowsTheme, settings]);

  const applyFile = useCallback(async (file: File) => {
    try {
      setLoadError(null);
      const next = await ingestMeshFile(file);

      setGeometry((previous: BufferGeometry | null) => {
        if (previous) {
          previous.dispose();
        }

        return next;
      });
      setSidebarOpen(false);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Could not parse that mesh file.';
      setLoadError(message);
    }
  }, []);

  const patchSettings = useCallback((partial: Partial<IParticleSettings>) => {
    if (partial.color !== undefined || partial.skinColor !== undefined) {
      setParticleColorFollowsTheme(false);
    }

    setSettings((previous: IParticleSettings) => ({
      ...previous,
      ...partial,
    }));
  }, []);

  const normalizeCssHexForCompare = useCallback((raw: string): string => {
    const t = raw.trim();
    if (!t.startsWith('#')) return t.toLowerCase();
    let hex = t.slice(1).toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) {
      hex = hex
        .split('')
        .map((ch: string) => ch + ch)
        .join('');
    }

    return `#${hex.slice(0, 6)}`;
  }, []);

  const applyBaselineSettings = useCallback(
    (base: IParticleSettings) => {
      const themeHex = mercuryDefaultParticleHex(appearance);

      const colorMatches =
        normalizeCssHexForCompare(base.color) === normalizeCssHexForCompare(themeHex);
      const skinMatches =
        normalizeCssHexForCompare(base.skinColor) === normalizeCssHexForCompare(themeHex);

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

  const preventNav = useCallback((event: ReactDragEvent) => {
    event.preventDefault();
  }, []);

  const absorbDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files.item(0);

      if (file) {
        void applyFile(file);
      }
    },
    [applyFile],
  );

  const mesh = geometry;

  return (
    <main
      aria-label="Particle workspace"
      className="viewport"
      tabIndex={-1}
      onDragOver={(event: ReactDragEvent<HTMLElement>) => {
        preventNav(event);
      }}
      onDrop={absorbDrop}
    >
      <ThemeToggle appearance={appearance} setAppearance={setAppearance} />

      {mesh ? (
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
            powerPreference: 'high-performance',
          }}
          shadows={false}
        >
          <Scene appearance={appearance} geometry={mesh} settings={settings} />
        </Canvas>
      ) : (
        <DropLanding
          appearance={appearance}
          loadError={loadError}
          panelBlur={settings.panelBlur}
          panelOpacity={settings.panelOpacity}
          onFileChosen={(file: File): void => {
            void applyFile(file);
          }}
        />
      )}

      <SettingsChrome
        panelOpen={sidebarOpen}
        particleControlsEnabled={mesh !== null}
        resetToDefault={resetToDefault}
        saveAsDefault={saveAsDefault}
        setPanelOpen={setSidebarOpen}
        settings={settings}
        onPatch={patchSettings}
      />

      {loadError ? (
        <div className="mesh-error-toast">
          <p className="mesh-error-toast__text">{loadError}</p>
          <button
            aria-label="Dismiss error"
            className="mesh-error-toast__dismiss"
            type="button"
            onClick={() => setLoadError(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}
