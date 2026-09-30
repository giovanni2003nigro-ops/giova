import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { bounds } from '../lib/geo';

const TILES = (import.meta.env.VITE_MAP_TILES as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) ?? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

/** Interaktive Karte mit Strecke (Leaflet + OpenStreetMap). */
export function RouteMap({
  points,
  live = false,
  height = 260,
  highlight,
}: {
  points: [number, number][];
  /** Folgt dem letzten Punkt (Live-Aufzeichnung) */
  live?: boolean;
  height?: number;
  /** Markierter Punkt, z. B. beim Überfahren der Splits */
  highlight?: [number, number] | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const line = useRef<L.Polyline | null>(null);
  const start = useRef<L.CircleMarker | null>(null);
  const end = useRef<L.CircleMarker | null>(null);
  const mark = useRef<L.CircleMarker | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, className: 'map-tiles' }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.setView([51.16, 10.45], 5);
    map.current = m;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#fc5200';
    line.current = L.polyline([], { color, weight: 4, opacity: 0.95 }).addTo(m);
    start.current = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#1baf7a', fillOpacity: 1 });
    end.current = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: live ? '#2a78d6' : '#d03b3b', fillOpacity: 1 });
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
    if (!points.length) return;
    start.current!.setLatLng(points[0]).addTo(m);
    end.current!.setLatLng(points[points.length - 1]).addTo(m);
    if (live) {
      m.setView(points[points.length - 1], fitted.current ? m.getZoom() : 16, { animate: fitted.current });
      fitted.current = true;
      return;
    }
    const b = bounds(points);
    if (b) m.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [24, 24], maxZoom: 16 });
  }, [points, live]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mark.current) return;
    if (highlight) mark.current.setLatLng(highlight).addTo(m);
    else mark.current.remove();
  }, [highlight]);

  return <div ref={el} className="route-map" style={{ height }} role="img" aria-label="Karte der Strecke" />;
}
