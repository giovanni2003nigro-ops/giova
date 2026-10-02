/**
 * Liest Länge und Format eines Videos und schneidet Einzelbilder heraus –
 * für Vorschaubild und KI-Prüfung (Claude sieht Bilder, keine Videos).
 */
export async function videoInfo(file: Blob, frames = 3): Promise<{ durationSec: number; width: number; height: number; frames: Blob[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video kann nicht gelesen werden (Format nicht unterstützt?).'));
    });
    const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const scale = Math.min(1, 1280 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wird nicht unterstützt');
    const out: Blob[] = [];
    for (let i = 0; i < frames; i++) {
      // Bei 10 %, 50 %, 90 % – Anfang, Mitte, Ende
      const t = durationSec * (frames === 1 ? 0.1 : 0.1 + (0.8 * i) / (frames - 1));
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = Math.min(Math.max(t, 0), Math.max(0, durationSec - 0.05));
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Einzelbild fehlgeschlagen'))), 'image/jpeg', 0.8)));
    }
    return { durationSec: Math.round(durationSec * 10) / 10, width: w, height: h, frames: out };
  } finally {
    URL.revokeObjectURL(url);
  }
}
