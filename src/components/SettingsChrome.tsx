import styles from "./SettingsChrome.module.css";

import type {
  ChangeEvent,
  Dispatch,
  ReactElement,
  ReactNode,
  SetStateAction,
} from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSliders, faXmark } from "@fortawesome/free-solid-svg-icons";

import type { IParticleSettings } from "../particleSettings";

import { PARTICLE_CAPACITY } from "../utils/surfaceSampler";
import { snapParticleCountForUi } from "../utils/particleCountUi";
import {
  SKIN_PARTICLE_CAPACITY,
  snapSkinParticleCountForUi,
} from "../utils/skinParticleCountUi";

interface IProps {
  onPatch: (patch: Partial<IParticleSettings>) => void;
  panelOpen: boolean;
  resetToDefault: () => void;
  saveAsDefault: () => void;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  settings: IParticleSettings;
}

type TSectionKey = "particles" | "swarm" | "modelSkin";

function Section(
  props: Readonly<{
    children: ReactNode;
    expanded: boolean;
    onToggle: () => void;
    title: string;
  }>,
) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <section className={styles.section}>
      <button
        className={styles.sectionHeader}
        type="button"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
      >
        <span className={styles.sectionTitle}>{props.title}</span>
        <span
          className={`${styles.chevron} ${props.expanded ? styles.chevronOpen : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      <div
        className={`${styles.sectionContent} ${props.expanded ? styles.sectionContentOpen : ""}`}
        ref={contentRef}
      >
        <div className={styles.sectionInner}>{props.children}</div>
      </div>
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
    suffix?: string;
    value: number;
  }>,
) {
  const {
    disabled = false,
    label,
    max,
    min,
    onChange,
    roundDisplay,
    step,
    suffix,
    value,
  } = props;
  const textValue = roundDisplay
    ? String(Math.round(value))
    : value.toPrecision(5).replace(/\.?0+$/, "");

  return (
    <label className={`${styles.row} ${disabled ? styles.rowDisabled : ""}`}>
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
          {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
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

function ColorPicker(
  props: Readonly<{
    disabled?: boolean;
    label: string;
    onChange: (next: string) => void;
    value: string;
  }>,
) {
  const { disabled = false, label, onChange, value } = props;

  return (
    <label
      className={`${styles.colorRow} ${disabled ? styles.rowDisabled : ""}`}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.colorControl}>
        <input
          className={styles.colorSwatch}
          type="color"
          value={value}
          aria-label={label}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
          }}
        />
        <input
          className={styles.colorHex}
          type="text"
          disabled={disabled}
          value={value}
          maxLength={7}
          aria-label={`${label} hex`}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const hex = event.target.value;

            if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
              onChange(hex);
            }
          }}
        />
      </span>
    </label>
  );
}

function Checkbox(
  props: Readonly<{
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  }>,
) {
  const { checked, disabled = false, label, onChange } = props;

  return (
    <label
      className={`${styles.checkRow} ${disabled ? styles.rowDisabled : ""}`}
    >
      <span
        className={`${styles.checkBox} ${checked ? styles.checkBoxChecked : ""}`}
      >
        {checked ? (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
            <path
              d="M1 3.5L3.5 6.5L9 1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <input
          className={styles.checkInput}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.checked);
          }}
        />
      </span>
      <span className={styles.checkLabel}>{label}</span>
    </label>
  );
}

function ToggleGlyph(props: Readonly<{ open: boolean }>): ReactElement {
  return (
    <FontAwesomeIcon
      icon={props.open ? faXmark : faSliders}
      className={styles.gearChar}
    />
  );
}

export default function SettingsChrome(props: Readonly<IProps>): ReactElement {
  const {
    onPatch,
    panelOpen: open,
    resetToDefault,
    saveAsDefault,
    setPanelOpen: setOpen,
    settings,
  } = props;

  const saveFlashTimerRef = useRef<number | undefined>(undefined);
  const [savePrimaryLabel, setSavePrimaryLabel] = useState("Save as default");

  const [expanded, setExpanded] = useState<Record<TSectionKey, boolean>>({
    particles: true,
    swarm: true,
    modelSkin: true,
  });

  const toggle = useCallback((key: TSectionKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

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
    setSavePrimaryLabel("Saved!");
    if (saveFlashTimerRef.current !== undefined) {
      window.clearTimeout(saveFlashTimerRef.current);
    }
    saveFlashTimerRef.current = window.setTimeout(() => {
      saveFlashTimerRef.current = undefined;
      setSavePrimaryLabel("Save as default");
    }, 1500);
  }

  return (
    <>
      <button
        aria-controls="particle-sidebar"
        aria-expanded={open}
        className={`${styles.toggleFab} ${open ? styles.toggleFabActive : ""}`}
        title="Settings"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
      >
        <ToggleGlyph open={open} />
        <span className={styles.sr}>
          {open ? "Close" : "Open"} settings sidebar
        </span>
      </button>

      <button
        aria-hidden={!open ? true : undefined}
        className={`${styles.dim} ${open ? styles.dimShow : styles.dimHide}`}
        tabIndex={open ? 0 : -1}
        type="button"
        onClick={() => setOpen(false)}
      />

      <aside
        className={`${styles.sheet} ${open ? styles.sheetOpen : ""}`}
        aria-hidden={!open}
        id="particle-sidebar"
      >
        <header className={styles.sheetHeading}>
          <div>
            <p className={styles.sheetKicker}>3D Particle Renderer</p>
            <p className={styles.sheetTitle}>Parameters</p>
          </div>
        </header>

        <div className={styles.sheetBody}>
          <Section
            title="Particles"
            expanded={expanded.particles}
            onToggle={() => toggle("particles")}
          >
            <Slider
              label="Density"
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
              label="Dot size"
              max={0.12}
              min={0.001}
              step={0.0005}
              value={settings.particleSize}
              onChange={(next: number) => {
                onPatch({ particleSize: next });
              }}
            />

            <Slider
              label="Float distance"
              max={0.85}
              min={-0.35}
              step={0.001}
              value={settings.surfaceNormalOffset}
              onChange={(next: number) => {
                onPatch({ surfaceNormalOffset: next });
              }}
            />

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

            <ColorPicker
              label="Color"
              value={settings.color}
              onChange={(next: string) => {
                onPatch({ color: next });
              }}
            />

            <Slider
              label="Flow speed"
              max={4}
              min={0.1}
              step={0.01}
              value={settings.movementSpeed}
              onChange={(next: number) => {
                onPatch({ movementSpeed: next });
              }}
            />

            <Slider
              label="Flow intensity"
              max={1.35}
              min={0}
              step={0.01}
              value={settings.movementAmplitude}
              onChange={(next: number) => {
                onPatch({ movementAmplitude: next });
              }}
            />
          </Section>

          <Section
            title="Swarm"
            expanded={expanded.swarm}
            onToggle={() => toggle("swarm")}
          >
            <Slider
              label="Max speed"
              max={0.1}
              min={0.005}
              step={0.001}
              value={settings.boidSpeedLimit}
              onChange={(next: number) => {
                onPatch({ boidSpeedLimit: next });
              }}
            />

            <Slider
              label="Orbit speed"
              max={5}
              min={0.1}
              step={0.05}
              value={settings.swarmOrbitSpeed}
              onChange={(next: number) => {
                onPatch({ swarmOrbitSpeed: next });
              }}
            />

            <Slider
              label="Orbit radius"
              max={6}
              min={0.5}
              step={0.1}
              value={settings.swarmOrbitRadius}
              onChange={(next: number) => {
                onPatch({ swarmOrbitRadius: next });
              }}
            />

            <Slider
              label="Split intensity"
              max={1}
              min={0}
              step={0.01}
              value={settings.swarmSplitIntensity}
              onChange={(next: number) => {
                onPatch({ swarmSplitIntensity: next });
              }}
            />

            <Slider
              label="Split speed"
              max={5}
              min={0.1}
              step={0.05}
              value={settings.swarmSplitSpeed}
              onChange={(next: number) => {
                onPatch({ swarmSplitSpeed: next });
              }}
            />

            <Slider
              label="Surface gravity"
              max={0.003}
              min={0}
              step={0.0001}
              value={settings.boidHomeSpring}
              onChange={(next: number) => {
                onPatch({ boidHomeSpring: next });
              }}
            />
          </Section>

          <Section
            title="Model Skin"
            expanded={expanded.modelSkin}
            onToggle={() => toggle("modelSkin")}
          >
            <Checkbox
              label="Enable skin"
              checked={settings.skinEnabled}
              onChange={(checked: boolean) => {
                onPatch({ skinEnabled: checked });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Skin density"
              max={SKIN_PARTICLE_CAPACITY}
              min={5000}
              roundDisplay
              step={256}
              value={settings.skinParticleCount}
              onChange={(next: number) => {
                onPatch({
                  skinParticleCount: snapSkinParticleCountForUi(next),
                });
              }}
            />

            <Slider
              disabled={!settings.skinEnabled}
              label="Skin dot size"
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
              label="Lighting"
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
              label="Depth fade"
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
              label="Edge emphasis"
              max={1}
              min={0}
              step={0.01}
              value={settings.skinContourDensity}
              onChange={(next: number) => {
                onPatch({ skinContourDensity: next });
              }}
            />

            <ColorPicker
              disabled={!settings.skinEnabled}
              label="Skin color"
              value={settings.skinColor}
              onChange={(next: string) => {
                onPatch({ skinColor: next });
              }}
            />

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
