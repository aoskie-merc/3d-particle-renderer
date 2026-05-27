import styles from "./TriggerBar.module.css";

export type TTriggerPhase = "idle" | "sweep-up" | "enter" | "exit" | "hidden";

export interface ITriggerBarProps {
  phase: TTriggerPhase;
  onTrigger: (trigger: TTriggerPhase) => void;
}

export default function TriggerBar(props: ITriggerBarProps) {
  const { phase, onTrigger } = props;
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
    </nav>
  );
}
