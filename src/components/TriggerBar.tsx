import styles from "./TriggerBar.module.css";

export type TTriggerPhase = "idle" | "sweep-up" | "enter" | "exit" | "hidden";

const DURATION_OPTIONS = [
  { label: "0.5s", value: 500 },
  { label: "1s", value: 1000 },
  { label: "1.5s", value: 1500 },
  { label: "2s", value: 2000 },
  { label: "2.5s", value: 2500 },
  { label: "3s", value: 3000 },
];

export interface ITriggerBarProps {
  duration: number;
  phase: TTriggerPhase;
  onDurationChange: (ms: number) => void;
  onTrigger: (trigger: TTriggerPhase) => void;
}

export default function TriggerBar(props: ITriggerBarProps) {
  const { duration, phase, onDurationChange, onTrigger } = props;
  const animating =
    phase === "sweep-up" || phase === "enter" || phase === "exit";

  return (
    <nav className={styles.card} aria-label="Animation triggers">
      <p className={styles.header}>States</p>
      <button
        type="button"
        className={`${styles.dsBtn}${phase === "enter" ? ` ${styles.dsBtnActive}` : ""}`}
        disabled={animating}
        onClick={() => onTrigger("enter")}
      >
        Enter
      </button>
      <button
        type="button"
        className={`${styles.dsBtn}${animating ? ` ${styles.dsBtnActive}` : ""}`}
        disabled={animating || phase === "hidden"}
        onClick={() => onTrigger("sweep-up")}
      >
        Sweep up
      </button>
      <button
        type="button"
        className={`${styles.dsBtn}${phase === "exit" ? ` ${styles.dsBtnActive}` : ""}`}
        disabled={animating || phase === "hidden"}
        onClick={() => onTrigger("exit")}
      >
        Exit
      </button>

      <label className={styles.durationLabel} htmlFor="duration-select">
        Duration
      </label>
      <select
        id="duration-select"
        className={styles.durationSelect}
        value={duration}
        onChange={(e) => onDurationChange(Number(e.target.value))}
      >
        {DURATION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </nav>
  );
}
