import type { SVGProps } from 'react';
import type { Sport } from '../types';

/**
 * Linien-Icons statt Emojis – gleiche Strichstärke wie die übrigen Icons.
 * Nur Pfade (keine Kreise), damit sie auch auf der Canvas (Story-Bild) mit Path2D gezeichnet werden können.
 */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const SPORT_PATHS: Record<Sport, string[]> = {
  laufen: [circle(15, 4.5, 2), 'M13 7.5 10.5 12.5', 'M10.5 12.5 7.5 16H4.5', 'M10.5 12.5 13.5 15 12.5 20.5', 'M7.5 9.5 10.5 7.2 13.5 7.6 15.8 10.5 19 11'],
  radfahren: [circle(5.5, 16.5, 3.5), circle(18.5, 16.5, 3.5), 'M5.5 16.5 9.5 9.5H15.5L18.5 16.5', 'M9.5 9.5 12 16.5H5.5', 'M15.5 9.5 14.3 6.5H12.5'],
  schwimmen: [circle(17, 6.5, 2), 'M3.5 11.5 8.5 8.5 12 11 15.5 9', 'M2 16c1.7 0 1.7 1.5 3.3 1.5S7 16 8.7 16s1.6 1.5 3.3 1.5S13.6 16 15.3 16s1.7 1.5 3.4 1.5S20.3 16 22 16', 'M2 20.5c1.7 0 1.7 1.2 3.3 1.2S7 20.5 8.7 20.5s1.6 1.2 3.3 1.2 1.6-1.2 3.3-1.2 1.7 1.2 3.4 1.2 1.6-1.2 3.3-1.2'],
  wandern: ['M2.5 20.5 9.5 8.5 13.5 15 16 11 21.5 20.5Z', 'M9.5 8.5V3.5L13 5 9.5 6.5'],
  rudern: ['M2.5 15H21.5L19 19.5H5Z', 'M5 4.5 14.5 15', 'M3.2 2.6 6.4 3.4 5.8 6.3 3 5.2Z'],
  hyrox: ['M13.5 2 4.5 13.5H11L10 22 19.5 10H13Z'],
  gym: ['M6.5 6.5v11', 'M17.5 6.5v11', 'M3.5 9v6', 'M20.5 9v6', 'M6.5 12h11'],
  powerlifting: ['M2 12H22', 'M5 8.5V15.5', 'M8 6.5V17.5', 'M16 6.5V17.5', 'M19 8.5V15.5'],
};

export function SportIcon({ sport, size = 18, ...rest }: { sport: Sport; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`sport-icon ${rest.className ?? ''}`}
      {...rest}
    >
      {SPORT_PATHS[sport].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Sportart mit Icon und Name (z. B. in Chips und Auswahllisten). */
export function SportLabel({ sport, label }: { sport: Sport; label: string }) {
  return (
    <span className="sport-label">
      <SportIcon sport={sport} size={16} />
      {label}
    </span>
  );
}
