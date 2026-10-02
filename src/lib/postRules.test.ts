import { describe, expect, it } from 'vitest';
import { validatePost } from './postRules';

describe('Regeln für Sport-Beiträge', () => {
  const ok = { category: 'rekord' as const, caption: 'Neue Bestzeit 🔥', mediaType: 'image/jpeg' };
  it('verlangt Medium und Sport-Kategorie', () => {
    expect(validatePost(ok)).toBeNull();
    expect(validatePost({ ...ok, mediaType: undefined })).toMatch(/Foto oder Video/);
    expect(validatePost({ ...ok, category: '' })).toMatch(/Kategorie/);
    expect(validatePost({ ...ok, mediaType: 'application/pdf' })).toMatch(/Nur Fotos/);
  });
  it('blockt Links und zu lange Texte', () => {
    expect(validatePost({ ...ok, caption: 'Rabatt auf www.shop.de' })).toMatch(/Links/);
    expect(validatePost({ ...ok, caption: 'https://x.y' })).toMatch(/Links/);
    expect(validatePost({ ...ok, caption: 'x'.repeat(501) })).toMatch(/zu lang/);
  });
  it('begrenzt Videos auf 60 s und 50 MB', () => {
    const v = { ...ok, mediaType: 'video/mp4' };
    expect(validatePost({ ...v, durationSec: 30, sizeBytes: 10e6 })).toBeNull();
    expect(validatePost({ ...v, durationSec: 75, sizeBytes: 10e6 })).toMatch(/60 Sekunden/);
    expect(validatePost({ ...v, durationSec: 30, sizeBytes: 80e6 })).toMatch(/50 MB/);
    expect(validatePost({ ...v })).toMatch(/Videolänge/);
  });
});
