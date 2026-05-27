import { Canvas } from '@react-three/fiber';

import { useCallback, useEffect, useState } from 'react';

import type { BufferGeometry } from 'three';

import {
  cancelScheduledPersistHydratedAppState,
  loadCustomBaselineSettings,
  loadHydratedAppState,
  persistCustomBaselineSettings,
  schedulePersistHydratedAppState,
} from './appPreferencesPersistence';
import Scene from './components/Scene';
import SettingsChrome from './components/SettingsChrome';
import ThemeToggle from './components/ThemeToggle';
import type { IParticleSettings } from './particleSettings';
import {
  type TMercuryAppearance,
  mercuryDefaultParticleHex,
} from './theme';
import { loadStaticModel } from './utils/meshIngest';

export default function App() {
  const [bundled] = useState(() => loadHydratedAppState());
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [settings, setSettings] = useState<IParticleSettings>(bundled.settings);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [appearance, setAppearance] = useState<TMercuryAppearance>(bundled.appearance);
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

  useEffect(() => {
    let cancelled = false;
    loadStaticModel('/model.stl').then((geom) => {
      if (!cancelled) setGeometry(geom);
    });
    return () => { cancelled = true; };
  }, []);

  const patchSettings = useCallback((partial: Partial<IParticleSettings>) => {
    if (partial.color !== undefined || partial.skinColor !== undefined) {
      setParticleColorFollowsTheme(false);
    }
    setSettings((previous: IParticleSettings) => ({ ...previous, ...partial }));
  }, []);

  const normalizeCssHexForCompare = useCallback((raw: string): string => {
    const t = raw.trim();
    if (!t.startsWith('#')) return t.toLowerCase();
    let hex = t.slice(1).toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) {
      hex = hex.split('').map((ch: string) => ch + ch).join('');
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

  return (
    <main aria-label="Particle workspace" className="viewport" tabIndex={-1}>
      <ThemeToggle appearance={appearance} setAppearance={setAppearance} />

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
            powerPreference: 'high-performance',
          }}
          shadows={false}
        >
          <Scene appearance={appearance} geometry={geometry} settings={settings} />
        </Canvas>
      ) : (
        <div className="loading-model">Loading model…</div>
      )}

      <SettingsChrome
        panelOpen={sidebarOpen}
        particleControlsEnabled={geometry !== null}
        resetToDefault={resetToDefault}
        saveAsDefault={saveAsDefault}
        setPanelOpen={setSidebarOpen}
        settings={settings}
        onPatch={patchSettings}
      />
    </main>
  );
}
