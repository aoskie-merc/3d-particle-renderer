import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import styles from './ThemeToggle.module.css';

import type { Dispatch, SetStateAction } from 'react';

import type { TMercuryAppearance } from '../theme';

interface IThemeToggleProps {
  appearance: TMercuryAppearance;
  setAppearance: Dispatch<SetStateAction<TMercuryAppearance>>;
}

/** Moon while dark canvas (switch to light); sun while light canvas (switch to dark). */
export default function ThemeToggle(props: Readonly<IThemeToggleProps>) {
  const { appearance, setAppearance } = props;

  const flip = (): void =>
    setAppearance((prior) => (prior === 'dark' ? 'light' : 'dark'));

  const isDarkShell = appearance === 'dark';

  const label = isDarkShell
    ? 'Dark theme — activate for Mercury light canvas'
    : 'Light theme — activate for Mercury dark canvas';

  const icon = isDarkShell ? faMoon : faSun;

  return (
    <button
      aria-label={label}
      className={styles.hit}
      title={label}
      type="button"
      onClick={flip}
    >
      <FontAwesomeIcon aria-hidden icon={icon} size={isDarkShell ? undefined : 'lg'} />

      <span className={styles.sr}>{label}</span>
    </button>
  );
}
