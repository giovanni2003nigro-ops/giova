import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import { App } from './App';
import './styles.css';
import { applyTheme, readTheme } from './views/Settings';

applyTheme(readTheme());

// Browser bitten, die lokalen Daten nicht automatisch zu löschen
void navigator.storage?.persist?.();

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
