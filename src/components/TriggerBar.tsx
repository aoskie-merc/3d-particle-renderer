import styles from "./TriggerBar.module.css";

export type TTriggerPhase = "initial" | "enter" | "peek" | "formed" | "exit";

export interface ITriggerBarProps {
  triggerPhase: TTriggerPhase;
  onTrigger: (trigger: TTriggerPhase) => void;
  animPath: "statue" | "orb";
  onPathChange: (path: "statue" | "orb") => void;
}

const STEPS: Array<{ id: TTriggerPhase; label: string }> = [
  { id: "initial", label: "Initial" },
  { id: "enter", label: "Enter" },
  { id: "peek", label: "Peek" },
  { id: "formed", label: "Formed" },
  { id: "exit", label: "Exit" },
];

export default function TriggerBar(props: ITriggerBarProps) {
  const { triggerPhase, onTrigger, animPath, onPathChange } = props;

  return (
    <nav className={styles.card} aria-label="Animation triggers">
      <p className={styles.header}>States</p>
      <div className={styles.pathToggle}>
        <button
          type="button"
          className={`${styles.pathBtn}${animPath === "statue" ? ` ${styles.pathBtnActive}` : ""}`}
          onClick={() => onPathChange("statue")}
        >
          Peek
        </button>
        <button
          type="button"
          className={`${styles.pathBtn}${animPath === "orb" ? ` ${styles.pathBtnActive}` : ""}`}
          onClick={() => onPathChange("orb")}
        >
          Orb
        </button>
      </div>
      {STEPS.map((step) => (
        <button
          key={step.id}
          type="button"
          className={`${styles.dsBtn}${triggerPhase === step.id ? ` ${styles.dsBtnActive}` : ""}`}
          onClick={() => onTrigger(step.id)}
          disabled={step.id === "peek" && animPath === "orb"}
        >
          {step.label}
        </button>
      ))}
      <hr className={styles.divider} />
      <button type="button" className={styles.dsBtn} onClick={() => {}}>
        Play full sequence
      </button>
    </nav>
  );
}
