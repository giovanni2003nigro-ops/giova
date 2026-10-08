import type { Sport } from '../types';

/**
 * Regeln für Sport-Beiträge – gleich in App, KI-Prüfung und Server (CHECKs in der Migration).
 * Erlaubt ist nur, was mit Sport zu tun hat.
 */
export const POST_CATEGORIES = ['rekord', 'technik', 'training', 'wettkampf', 'outfit', 'motivation', 'ernaehrung'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export const CATEGORY_DEFS: Record<PostCategory, { label: string; hint: string }> = {
  rekord: { label: 'Rekord', hint: 'Bestzeit, neues Max, Uhr/Anzeige mit dem Ergebnis' },
  technik: { label: 'Technik', hint: 'So geht’s: Laufstil, Kniebeuge, Kraulzug …' },
  training: { label: 'Training', hint: 'Einheit, Workout, Trainingsort' },
  wettkampf: { label: 'Wettkampf', hint: 'Rennen, Hyrox, Meet, Startnummer, Ziel' },
  outfit: { label: 'Sportoutfit', hint: 'Laufschuhe, Trikot, Ausrüstung' },
  motivation: { label: 'Motivation', hint: 'Fortschritt, Vorher/Nachher im Sport' },
  ernaehrung: { label: 'Sporternährung', hint: 'Meal-Prep, Verpflegung im Wettkampf' },
};

export type PostStatus = 'pruefung' | 'sichtbar' | 'abgelehnt' | 'gesperrt';
export const STATUS_LABELS: Record<PostStatus, string> = {
  pruefung: 'In Prüfung',
  sichtbar: 'Veröffentlicht',
  abgelehnt: 'Abgelehnt',
  gesperrt: 'Ausgeblendet (gemeldet)',
};

export const REPORT_REASONS = {
  kein_sport: 'Hat nichts mit Sport zu tun',
  unangemessen: 'Unangemessen / anstößig',
  spam: 'Spam oder Werbung',
  belaestigung: 'Belästigung oder Hass',
  sonstiges: 'Sonstiges',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_MB = 50;
export const MAX_CAPTION = 500;

/** Prüfungen, die schon vor dem Hochladen in der App laufen (der Server prüft dasselbe). */
export function validatePost(input: { category?: PostCategory | ''; caption: string; mediaType?: string; durationSec?: number; sizeBytes?: number }): string | null {
  if (!input.mediaType) return 'Bitte ein Foto oder Video auswählen.';
  if (!IMAGE_TYPES.includes(input.mediaType) && !VIDEO_TYPES.includes(input.mediaType)) return 'Nur Fotos (JPEG, PNG, WebP) oder Videos (MP4, WebM, MOV).';
  if (!input.category) return 'Bitte eine Kategorie wählen – erlaubt sind nur Sport-Themen.';
  if (input.caption.length > MAX_CAPTION) return `Text zu lang (max. ${MAX_CAPTION} Zeichen).`;
  if (/(https?:\/\/|www\.)/i.test(input.caption)) return 'Links sind in Beiträgen nicht erlaubt.';
  if (VIDEO_TYPES.includes(input.mediaType)) {
    if (!input.durationSec) return 'Die Videolänge konnte nicht gelesen werden.';
    if (input.durationSec > MAX_VIDEO_SECONDS) return `Videos dürfen höchstens ${MAX_VIDEO_SECONDS} Sekunden lang sein.`;
    if ((input.sizeBytes ?? 0) > MAX_VIDEO_MB * 1024 * 1024) return `Videos dürfen höchstens ${MAX_VIDEO_MB} MB groß sein.`;
  }
  return null;
}

export const sportOrNull = (s: string): Sport | null => (s ? (s as Sport) : null);
