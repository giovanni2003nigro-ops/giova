import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { bounds } from '../lib/geo';

/**
 * Kartenstil: dunkle bzw. helle Vektor-Optik von CARTO (OpenStreetMap-Daten) passend zum Design.
 * Eigener Anbieter über VITE_MAP_TILES / VITE_MAP_ATTRIBUTION (dann im Dunkeln invertiert).
 */
const CUSTOM_TILES = import.meta.env.VITE_MAP_TILES as string | undefined;
const CUSTOM_ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined;
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light') return false;
  if (t === 'system') return !matchMedia('(prefers-color-scheme: light)').matches;
  return true;
}

function tileLayer(dark: boolean): L.TileLayer {
  if (CUSTOM_TILES)
    return L.tileLayer(CUSTOM_TILES, { maxZoom: 19, attribution: CUSTOM_ATTRIBUTION ?? OSM, className: dark ? 'map-tiles invert' : 'map-tiles' });
  const style = dark ? 'dark_all' : 'rastertiles/voyager';
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: `${OSM} © <a href="https://carto.com/attributions">CARTO</a>`,
    className: 'map-tiles',
  });
}

/** Interaktive Karte mit leuchtender Strecke (Leaflet). */
export function RouteMap({
  points,
  live = false,
  height = 260,
  highlight,
  className = '',
}: {
  points: [number, number][];
  /** Folgt dem letzten Punkt (Live-Aufzeichnung) */
  live?: boolean;
  height?: number | string;
  /** Markierter Punkt, z. B. beim Überfahren der Splits */
  highlight?: [number, number] | null;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const halo = useRef<L.Polyline | null>(null);
  const line = useRef<L.Polyline | null>(null);
  const start = useRef<L.CircleMarker | null>(null);
  const end = useRef<L.Marker | null>(null);
  const mark = useRef<L.CircleMarker | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const dark = isDarkTheme();
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    tileLayer(dark).addTo(m);
    if (!live) L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.setView([51.16, 10.45], 5);
    map.current = m;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#ff2d3a';
    // Weicher Schein unter der Linie, darüber die eigentliche Strecke
    halo.current = L.polyline([], { color, weight: 14, opacity: dark ? 0.28 : 0.18, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m);
    line.current = L.polyline([], { color, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m);
    start.current = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 });
    end.current = L.marker([0, 0], {
      icon: L.divIcon({ className: live ? 'map-pos live' : 'map-pos', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
    });
    mark.current = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#0b0b0b', fillOpacity: 1 });
    // Größe erst nach dem Layout bekannt (z. B. in Sheets)
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, [live]);

  useEffect(() => {
    const m = map.current;
    if (!m || !line.current) return;
    line.current.setLatLngs(points);
    halo.current?.setLatLngs(points);
    if (!points.length) return;
    start.current!.setLatLng(points[0]).addTo(m);
    end.current!.setLatLng(points[points.length - 1]).addTo(m);
    if (live) {
      m.setView(points[points.length - 1], fitted.current ? m.getZoom() : 16, { animate: fitted.current });
      fitted.current = true;
      return;
    }
    const b = bounds(points);
    if (b) m.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [28, 28], maxZoom: 16 });
  }, [points, live]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mark.current) return;
    if (highlight) mark.current.setLatLng(highlight).addTo(m);
    else mark.current.remove();
  }, [highlight]);

  return <div ref={el} className={`route-map ${className}`} style={{ height }} role="img" aria-label="Karte der Strecke" />;
}
