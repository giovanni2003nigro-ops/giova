import type { ActivityCardData } from '../components/activity';
import { activityStats } from '../components/activity';
import { ACCENTS, FONTS_LARGE, readAppearance } from './appearance';
import { SPORT_DEFS } from './sports';

/**
 * Story-Bild (1080 × 1920) einer Aktivität – für Instagram & Co.
 * `background`: 'dark' (schwarz mit Glow), 'photo' (eigenes Foto) oder 'transparent' (Sticker zum Auflegen).
 */
export type StoryBackground = 'dark' | 'photo' | 'transparent';

const W = 1080;
const H = 1920;
// Akzentfarbe und Schrift wie in der App gewählt
let GRAD = ACCENTS.rot.grad;
let RGB = ACCENTS.rot.rgb;
let DISPLAY = FONTS_LARGE.poppins.display;
let BODY = FONTS_LARGE.poppins.body;

function gradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, GRAD[0]);
  g.addColorStop(0.55, GRAD[1]);
  g.addColorStop(1, GRAD[2]);
  return g;
}

async function loadImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function drawRoute(ctx: CanvasRenderingContext2D, route: [number, number][], box: { x: number; y: number; w: number; h: number }, sticker: boolean) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [la, lo] of route) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLon = Math.min(minLon, lo);
    maxLon = Math.max(maxLon, lo);
  }
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const w = Math.max((maxLon - minLon) * k, 1e-6);
  const h = Math.max(maxLat - minLat, 1e-6);
  const s = Math.min(box.w / w, box.h / h);
  const ox = box.x + (box.w - w * s) / 2;
  const oy = box.y + (box.h - h * s) / 2;
  const pt = ([la, lo]: [number, number]) => [ox + (lo - minLon) * k * s, oy + (maxLat - la) * s] as const;
  const step = Math.max(1, Math.floor(route.length / 1500));
  const pts = route.filter((_, i) => i % step === 0 || i === route.length - 1).map(pt);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = gradient(ctx, box.x, box.y, box.x + box.w, box.y + box.h);
  // Auf Schwarz leuchtet die Linie; als Sticker bekommt sie einen dezenten dunklen Schatten für jeden Untergrund
  ctx.shadowColor = sticker ? 'rgba(0, 0, 0, 0.45)' : `rgba(${RGB}, 0.75)`;
  ctx.shadowBlur = sticker ? 14 : 40;
  ctx.lineWidth = 16;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.shadowBlur = 0;
  const dot = ([x, y]: readonly [number, number], fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };
  dot(pts[0], '#22c07a');
  dot(pts[pts.length - 1], '#ff453a');
  ctx.restore();
}

export async function renderStory(a: ActivityCardData, background: StoryBackground, photo?: Blob): Promise<Blob> {
  const look = readAppearance();
  GRAD = ACCENTS[look.accent].grad;
  RGB = ACCENTS[look.accent].rgb;
  DISPLAY = FONTS_LARGE[look.fontLarge].display;
  BODY = FONTS_LARGE[look.fontLarge].body;
  // Schmale Schriften (Barlow) vertragen größere Zahlen
  const numScale = look.fontLarge === 'barlow' ? 1 : 0.8;
  // Schriften müssen geladen sein, bevor auf die Canvas gezeichnet wird
  await Promise.all([
    document.fonts.load(`italic 800 100px ${DISPLAY}`),
    document.fonts.load(`700 100px ${DISPLAY}`),
    document.fonts.load(`800 60px ${BODY}`),
    document.fonts.load(`600 40px ${BODY}`),
  ]).catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas wird nicht unterstützt');
  const transparent = background === 'transparent';

  // ---------- Hintergrund
  if (background === 'photo' && photo) {
    drawCover(ctx, await loadImage(photo));
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.35, 'rgba(0,0,0,0.1)');
    shade.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    shade.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  } else if (!transparent) {
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, W);
    glow.addColorStop(0, `rgba(${RGB}, 0.38)`);
    glow.addColorStop(1, `rgba(${RGB}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const glow2 = ctx.createRadialGradient(W * 0.1, H * 0.95, 0, W * 0.1, H * 0.95, W * 0.9);
    glow2.addColorStop(0, `rgba(${RGB}, 0.2)`);
    glow2.addColorStop(1, `rgba(${RGB}, 0)`);
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);
  }
  // Auf transparentem Sticker bleibt Text durch einen weichen Schatten lesbar
  const textShadow = () => {
    ctx.shadowColor = transparent || background === 'photo' ? 'rgba(0,0,0,0.55)' : 'transparent';
    ctx.shadowBlur = transparent || background === 'photo' ? 18 : 0;
  };

  const pad = 90;
  const def = SPORT_DEFS[a.sport];

  // ---------- Kopf: Marke, Sportart, Datum
  textShadow();
  ctx.font = `italic 800 64px ${DISPLAY}`;
  ctx.fillStyle = gradient(ctx, pad, 120, pad + 260, 190);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('GIOVA', pad, 190);
  ctx.font = `600 38px ${BODY}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const when = new Date(a.startTime).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  ctx.fillText(`${def.emoji} ${def.label} · ${when}`, pad, 250);

  // ---------- Strecke
  const hasRoute = !!a.route && a.route.length > 1;
  if (hasRoute) drawRoute(ctx, a.route!, { x: pad + 20, y: 360, w: W - 2 * pad - 40, h: 760 }, transparent);
  else if (background !== 'photo') {
    // Ohne Strecke: großes Sport-Emoji als Blickfang
    ctx.font = `360px ${BODY}`;
    ctx.textAlign = 'center';
    ctx.fillText(def.emoji, W / 2, 900);
    ctx.textAlign = 'left';
  }

  // ---------- Titel
  textShadow();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 70px ${BODY}`;
  const titleLines = wrap(ctx, a.title, W - 2 * pad, 2);
  let y = 1290;
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += 84;
  }

  // ---------- Kennzahlen
  const stats = activityStats(a).slice(0, 3);
  y = Math.max(y + 40, 1480);
  const colW = (W - 2 * pad) / Math.max(1, stats.length);
  stats.forEach((s, i) => {
    const x = pad + i * colW;
    ctx.font = `700 34px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(s.label.toUpperCase(), x, y);
    // Zahl groß, Einheit klein dahinter – bei Bedarf verkleinern, damit alles in die Spalte passt
    const [num, ...rest] = s.value.split(' ');
    const unit = rest.join(' ');
    let size = Math.round((stats.length > 2 ? 112 : 128) * numScale);
    const measure = () => {
      ctx.font = `italic 800 ${size}px ${DISPLAY}`;
      const nw = ctx.measureText(num).width;
      ctx.font = `italic 700 ${Math.round(size * 0.42)}px ${DISPLAY}`;
      return nw + (unit ? 10 + ctx.measureText(unit).width : 0);
    };
    while (measure() > colW - 24 && size > 50) size -= 4;
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 800 ${size}px ${DISPLAY}`;
    ctx.fillText(num, x, y + 112);
    if (unit) {
      const nw = ctx.measureText(num).width;
      ctx.font = `italic 700 ${Math.round(size * 0.42)}px ${DISPLAY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(unit, x + nw + 10, y + 112);
    }
  });

  // ---------- Punkte
  ctx.shadowBlur = 0;
  const label = `+${a.points} PUNKTE`;
  ctx.font = `italic 800 52px ${DISPLAY}`;
  const lw = ctx.measureText(label).width + 64;
  const px = pad;
  const py = H - 190;
  ctx.fillStyle = gradient(ctx, px, py, px + lw, py + 84);
  ctx.beginPath();
  ctx.roundRect(px, py, lw, 84, 42);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, px + 32, py + 60);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erstellt werden'))), 'image/png'));
}

/** Teilt das Bild über das Teilen-Menü des Handys (Instagram, WhatsApp …) oder lädt es herunter. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
