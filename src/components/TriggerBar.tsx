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
    <nav className={styles.bar} aria-label="Animation triggers">
      <button
        type="button"
        className={`${styles.trigger}${busy ? ` ${styles.triggerActive}` : ""}`}
        disabled={busy}
        onClick={() => onTrigger("sweep-up")}
        title="Sweep up"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 384 512"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L176 125.3V464c0 17.7 14.3 32 32 32s32-14.3 32-32V125.3l121.4 121.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-192-160z" />
        </svg>
        <span className={styles.sr}>Sweep up</span>
      </button>
    </nav>
  );
}
