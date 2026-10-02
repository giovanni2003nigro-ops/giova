/**
 * Darstellung: Akzentfarbe und Schriften – individuell wählbar, gespeichert im Browser.
 * Standard: Rot, große Schrift Poppins (weiß), kleine Schrift Courier New (grau).
 */
export type Accent = 'rot' | 'matcha' | 'viola';
export type FontLarge = 'poppins' | 'barlow' | 'jakarta' | 'system';
export type FontSmall = 'courier' | 'poppins' | 'jakarta' | 'system';

export interface AccentDef {
  label: string;
  /** Verlauf hell → dunkel (Marke, Buttons, Strecke im Story-Bild) */
  grad: [string, string, string];
  /** Für Leuchteffekte als „r, g, b“ */
  rgb: string;
}

export const ACCENTS: Record<Accent, AccentDef> = {
  rot: { label: 'Rot', grad: ['#ff5a5f', '#ff2d3a', '#d9142b'], rgb: '255, 45, 58' },
  matcha: { label: 'Matcha', grad: ['#c2df8f', '#97c25c', '#6f9c3a'], rgb: '151, 194, 92' },
  viola: { label: 'Viola', grad: ['#c7a4ff', '#9d6bff', '#7442ec'], rgb: '157, 107, 255' },
};

export const FONTS_LARGE: Record<FontLarge, { label: string; display: string; body: string }> = {
  poppins: { label: 'Poppins', display: '"Poppins", system-ui, sans-serif', body: '"Poppins", system-ui, sans-serif' },
  barlow: { label: 'Sport (Barlow)', display: '"Barlow Condensed", "Plus Jakarta Sans Variable", sans-serif', body: '"Plus Jakarta Sans Variable", system-ui, sans-serif' },
  jakarta: { label: 'Jakarta', display: '"Plus Jakarta Sans Variable", system-ui, sans-serif', body: '"Plus Jakarta Sans Variable", system-ui, sans-serif' },
  system: { label: 'System', display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

export const FONTS_SMALL: Record<FontSmall, { label: string; css: string }> = {
  courier: { label: 'Courier New', css: '"Courier New", "Courier Prime", Courier, monospace' },
  poppins: { label: 'Poppins', css: '"Poppins", system-ui, sans-serif' },
  jakarta: { label: 'Jakarta', css: '"Plus Jakarta Sans Variable", system-ui, sans-serif' },
  system: { label: 'System', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

export interface Appearance {
  accent: Accent;
  fontLarge: FontLarge;
  fontSmall: FontSmall;
}

export const DEFAULT_APPEARANCE: Appearance = { accent: 'rot', fontLarge: 'poppins', fontSmall: 'courier' };

export function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem('appearance') ?? '{}') as Partial<Appearance>;
    return {
      accent: raw.accent && raw.accent in ACCENTS ? raw.accent : DEFAULT_APPEARANCE.accent,
      fontLarge: raw.fontLarge && raw.fontLarge in FONTS_LARGE ? raw.fontLarge : DEFAULT_APPEARANCE.fontLarge,
      fontSmall: raw.fontSmall && raw.fontSmall in FONTS_SMALL ? raw.fontSmall : DEFAULT_APPEARANCE.fontSmall,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  root.setAttribute('data-accent', a.accent);
  root.setAttribute('data-font-large', a.fontLarge);
  root.setAttribute('data-font-small', a.fontSmall);
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem('appearance', JSON.stringify(a));
  } catch {
    /* privates Fenster */
  }
  applyAppearance(a);
  window.dispatchEvent(new Event('appearance'));
}
