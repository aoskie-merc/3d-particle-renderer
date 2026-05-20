import styles from './SettingsChrome.module.css';

import type {
  ChangeEvent,
  Dispatch,
  ReactElement,
  ReactNode,
  SetStateAction,
} from 'react';

import { useEffect, useRef, useState } from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSliders } from '@fortawesome/free-solid-svg-icons';

import type { IParticleSettings } from '../particleSettings';

import type { TBlendModeKey, TDirectionBias, TDistributionMethod } from '../types';

import { PARTICLE_CAPACITY } from '../utils/surfaceSampler';
import { snapParticleCountForUi } from '../utils/particleCountUi';
import { SKIN_PARTICLE_CAPACITY, snapSkinParticleCountForUi } from '../utils/skinParticleCountUi';

interface IProps {
  onPatch: (patch: Partial<IParticleSettings>) => void;
  panelOpen: boolean;
  particleControlsEnabled: boolean;
  resetToDefault: () => void;
  saveAsDefault: () => void;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  settings: IParticleSettings;
}

function Section(props: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Slider(
  props: Readonly<{
    disabled?: boolean;
    label: string;
    max: number;
    min: number;
    onChange(next: number): void;
    roundDisplay?: boolean;
    step: number;
    value: number;
  }>,
) {
  const { disabled = false, label, max, min, onChange, roundDisplay, step, value } = props;
  const textValue = roundDisplay
    ? String(Math.round(value))
    : value.toPrecision(5).replace(/\.?0+$/, '');

  return (
    <label className={`${styles.row} ${disabled ? styles.rowDisabled : ''}`}>
      <div className={styles.rowHeading}>
        <span className={styles.label}>{label}</span>
        <span className={styles.valueChip}>
          <input
            className={styles.num}
            aria-label={`${label} number`}
            disabled={disabled}
            max={max}
            min={min}
            step={step}
            type="number"
            value={textValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const next = Number.parseFloat(event.target.value);

              if (Number.isFinite(next)) {
                onChange(Math.min(max, Math.max(min, next)));
              }
            }}
          />
        </span>
      </div>
      <input
        className={styles.range}
        aria-label={`${label} slider`}
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = Number.parseFloat(event.target.value);

          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
      />
    </label>
  );
}

function GearGlyph(): ReactElement {
  return (
    <FontAwesomeIcon icon={faSliders} className={styles.gearChar} />
  );
}

/** Gear toggle + dim backdrop + collapsible sidebar for particle tuning. */
export default function SettingsChrome(props: Readonly<IProps>): ReactElement {
  const {
    onPatch,
    panelOpen: open,
    particleControlsEnabled,
    resetToDefault,
    saveAsDefault,
    setPanelOpen: setOpen,
    settings,
  } = props;

  const saveFlashTimerRef = useRef<number | undefined>(undefined);
  const [savePrimaryLabel, setSavePrimaryLabel] = useState('Save as default');

  useEffect(
    (): (() => void) => (): void => {
      if (saveFlashTimerRef.current !== undefined) {
        window.clearTimeout(saveFlashTimerRef.current);
      }
    },
    [],
  );

  function handleSaveDefaultClick(): void {
    saveAsDefault();
    setSavePrimaryLabel('Saved!');
    if (saveFlashTimerRef.current !== undefined) {
      window.clearTimeout(saveFlashTimerRef.current);
    }
    saveFlashTimerRef.current = window.setTimeout(() => {
      saveFlashTimerRef.current = undefined;
      setSavePrimaryLabel('Save as default');
    }, 1500);
  }

  return (
    <>
      <button
        aria-controls="particle-sidebar"
        aria-expanded={open}
        className={`${styles.toggleFab} ${open ? styles.toggleFabActive : ''}`}
        title="Settings"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
      >
        <GearGlyph />
        <span className={styles.sr}>Open settings sidebar</span>
      </button>

      <button
        aria-hidden={!open ? true : undefined}
        className={`${styles.dim} ${open ? styles.dimShow : styles.dimHide}`}
        tabIndex={open ? 0 : -1}
        type="button"
        onClick={() => setOpen(false)}
      />

      <aside
        className={`${styles.sheet} ${open ? styles.sheetOpen : ''}`}
        aria-hidden={!open}
        id="particle-sidebar"
      >
        <header className={styles.sheetHeading}>
          <div>
            <p className={styles.sheetKicker}>3D Particle Renderer</p>
            <p className={styles.sheetTitle}>Parameters</p>
          </div>
          <button
            className={styles.iconClose}
            title="Collapse panel"
            type="button"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden>×</span>
            <span className={styles.sr}>Collapse settings panel</span>
          </button>
        </header>

        <div className={styles.sheetBody}>
          <Section title="Upload panel">
            <Slider
              label="Landing panel opacity"
              max={1}
              min={0}
              step={0.01}
              value={settings.panelOpacity}
              onChange={(next: number): void => {
                onPatch({ panelOpacity: next });
              }}
            />
            <Slider
              label="Landing panel blur (px)"
              max={20}
              min={0}
              roundDisplay
              step={1}
              value={settings.panelBlur}
              onChange={(next: number): void => {
                onPatch({ panelBlur: Math.round(next) });
              }}
            />
          </Section>

          {particleControlsEnabled ? (
            <>
          <Section title="Base Model">
            <label className={styles.checkRow}>
              <input
                checked={settings.skinEnabled}
                type="checkbox"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onPatch({ skinEnabled: event.target.checked });
                }}
              />

              <span>Enable particle skin</span>
            </label>

            <Slider
              disabled={!settings.skinEnabled}
              label="Skin particle count"
              max={SKIN_PARTICLE_CAPACITY}
              min={5000}
              roundDisplay
              step={256}
              value={settings.skinParticleCount}
              onChange={(next: number) => {
                onPatch({ skinParticleCount: snapSkinParticleCountForUi(next) });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Skin particle size"
              max={0.05}
              min={0.001}
              step={0.0005}
              value={settings.skinParticleSize}
              onChange={(next: number) => {
                onPatch({ skinParticleSize: next });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Depth fade intensity"
              max={1}
              min={0}
              step={0.01}
              value={settings.skinDepthFade}
              onChange={(next: number) => {
                onPatch({ skinDepthFade: next });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Normal shading intensity"
              max={1}
              min={0}
              step={0.01}
              value={settings.skinNormalShading}
              onChange={(next: number) => {
                onPatch({ skinNormalShading: next });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Contour density bias"
              max={1}
              min={0}
              step={0.01}
              value={settings.skinContourDensity}
              onChange={(next: number) => {
                onPatch({ skinContourDensity: next });
              }}
            />

            <label className={`${styles.rowCompact} ${!settings.skinEnabled ? styles.rowDisabled : ''}`}>
              <span className={styles.label}>Skin color</span>
              <input
                className={styles.colorField}
                type="color"
                value={settings.skinColor}
                aria-label="Base model skin tint"
                disabled={!settings.skinEnabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onPatch({ skinColor: event.target.value });
                }}
              />
            </label>

            <Slider
              disabled={!settings.skinEnabled}
              label="Skin opacity"
              max={1}
              min={0}
              step={0.01}
              value={settings.skinOpacity}
              onChange={(next: number) => {
                onPatch({ skinOpacity: next });
              }}
            />
          </Section>

          <Section title="Surface">
            <label className={styles.rowCompact}>
              <span className={styles.label}>Distribution</span>
              <select
                className={styles.select}
                value={settings.distribution}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const next = event.target.value as TDistributionMethod;

                  if (next === 'areaWeighted' || next === 'triangleUniform') {
                    onPatch({ distribution: next });
                  }
                }}
              >
                <option value="areaWeighted">Area weighted (surface uniform)</option>
                <option value="triangleUniform">Uniform random triangle</option>
              </select>
            </label>

            <Slider
              label="Particle count"
              max={PARTICLE_CAPACITY}
              min={1024}
              roundDisplay
              step={512}
              value={settings.particleCount}
              onChange={(next: number) => {
                onPatch({ particleCount: snapParticleCountForUi(next) });
              }}
            />

            <Slider
              label="Normal offset"
              max={0.85}
              min={-0.35}
              step={0.001}
              value={settings.surfaceNormalOffset}
              onChange={(next: number) => {
                onPatch({ surfaceNormalOffset: next });
              }}
            />
          </Section>

          <Section title="Movement">
            <label className={styles.rowCompact}>
              <span className={styles.label}>Direction bias</span>
              <select
                className={styles.select}
                value={settings.directionBias}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const next = event.target.value as TDirectionBias;

                  if (next === 'radial' || next === 'tangential' || next === 'random') {
                    onPatch({ directionBias: next });
                  }
                }}
              >
                <option value="radial">Radial · away from center</option>
                <option value="tangential">Tangential · along surface shear</option>
                <option value="random">Random jitter field</option>
              </select>
            </label>

            <Slider
              label="Speed"
              max={4}
              min={0.1}
              step={0.01}
              value={settings.movementSpeed}
              onChange={(next: number) => {
                onPatch({ movementSpeed: next });
              }}
            />

            <Slider
              label="Amplitude"
              max={1.35}
              min={0}
              step={0.01}
              value={settings.movementAmplitude}
              onChange={(next: number) => {
                onPatch({ movementAmplitude: next });
              }}
            />
          </Section>

          <Section title="Vibration">
            <Slider
              label="Frequency"
              max={4.35}
              min={0.1}
              step={0.01}
              value={settings.vibrationFrequency}
              onChange={(next: number) => {
                onPatch({ vibrationFrequency: next });
              }}
            />

            <Slider
              label="Amplitude"
              max={0.85}
              min={0}
              step={0.005}
              value={settings.vibrationAmplitude}
              onChange={(next: number) => {
                onPatch({ vibrationAmplitude: next });
              }}
            />

            <Slider
              label="Damping"
              max={6}
              min={0}
              step={0.05}
              value={settings.vibrationDamping}
              onChange={(next: number) => {
                onPatch({ vibrationDamping: next });
              }}
            />

            <Slider
              label="Noise scale"
              max={2.95}
              min={0}
              step={0.02}
              value={settings.vibrationNoiseScale}
              onChange={(next: number) => {
                onPatch({ vibrationNoiseScale: next });
              }}
            />
          </Section>

          <Section title="Appearance">
            <label className={styles.rowCompact}>
              <span className={styles.label}>Blend mode</span>
              <select
                className={styles.select}
                value={settings.blendMode}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const next = event.target.value as TBlendModeKey;

                  if (
                    next === 'normal' ||
                    next === 'additive' ||
                    next === 'multiply'
                  ) {
                    onPatch({ blendMode: next });
                  }
                }}
              >
                <option value="normal">Normal</option>
                <option value="additive">Additive glow</option>
                <option value="multiply">Multiply</option>
              </select>
            </label>

            <label className={styles.rowCompact}>
              <span className={styles.label}>Particle color</span>
              <input
                className={styles.colorField}
                type="color"
                value={settings.color}
                aria-label="Particle tint"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onPatch({ color: event.target.value });
                }}
              />
            </label>

            <Slider
              label="Opacity"
              max={1}
              min={0.05}
              step={0.01}
              value={settings.opacity}
              onChange={(next: number) => {
                onPatch({ opacity: next });
              }}
            />

            <Slider
              label="Particle size"
              max={0.16}
              min={0.002}
              step={0.0005}
              value={settings.particleSize}
              onChange={(next: number) => {
                onPatch({ particleSize: next });
              }}
            />

            <label className={styles.checkRow}>
              <input
                checked={settings.showWireframe}
                disabled={settings.skinEnabled}
                type="checkbox"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onPatch({ showWireframe: event.target.checked });
                }}
              />

              <span>Show wireframe shell</span>
            </label>

            <Slider
              disabled={!settings.showWireframe || settings.skinEnabled}
              label="Wireframe visibility"
              max={0.6}
              min={0.02}
              step={0.01}
              value={settings.wireOpacity}
              onChange={(next: number) => {
                onPatch({ wireOpacity: next });
              }}
            />
          </Section>
            </>
          ) : null}
        </div>

        <footer className={styles.sheetFooter}>
          <div className={styles.footerActions}>
            <button
              className={styles.dsSecondaryFooter}
              type="button"
              onClick={handleSaveDefaultClick}
            >
              {savePrimaryLabel}
            </button>
            <button
              className={styles.dsSecondaryFooter}
              type="button"
              onClick={resetToDefault}
            >
              Reset to default
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
