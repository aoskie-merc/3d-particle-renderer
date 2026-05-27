import styles from "./TriggerBar.module.css";

export type TTriggerPhase = "idle" | "sweep-up";

export interface ITriggerBarProps {
  phase: TTriggerPhase;
  onTrigger: (trigger: TTriggerPhase) => void;
}

export default function TriggerBar(props: ITriggerBarProps) {
  const { phase, onTrigger } = props;
  const busy = phase !== "idle";

  return (
    <nav className={styles.card} aria-label="Animation triggers">
      <p className={styles.header}>States</p>
      <button
        type="button"
        className={`${styles.dsBtn}${busy ? ` ${styles.dsBtnActive}` : ""}`}
        disabled={busy}
        onClick={() => onTrigger("sweep-up")}
      >
        Sweep up
      </button>
    </nav>
  );
}
