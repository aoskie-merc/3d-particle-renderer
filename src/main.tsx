import './fontawesomeConfig';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './mercuryAppearance.css';
import './mercuryInspired.css';
import './index.css';
import { syncThemeDatasetFromStoredTheme } from './appPreferencesPersistence';
import App from './App.tsx';

syncThemeDatasetFromStoredTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
