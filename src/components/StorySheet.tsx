import { useEffect, useState } from 'react';
import { renderStory, shareOrDownload, type StoryBackground } from '../lib/storyImage';
import { useObjectUrl } from '../hooks';
import type { ActivityCardData } from './activity';
import { IconShare } from './icons';
import { ErrorBox, Seg, Sheet, toast } from './ui';

/** Vorschau & Teilen des Story-Bilds einer Aktivität. */
export function StorySheet({ activity, photo, onClose }: { activity: ActivityCardData; photo?: Blob; onClose: () => void }) {
  const [bg, setBg] = useState<StoryBackground>(photo ? 'photo' : 'dark');
  const [image, setImage] = useState<Blob | undefined>();
  const [error, setError] = useState('');
  const url = useObjectUrl(image);

  useEffect(() => {
    let alive = true;
    setImage(undefined);
    setError('');
    renderStory(activity, bg, photo)
      .then((b) => alive && setImage(b))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [activity, bg, photo]);

  const share = async () => {
    if (!image) return;
    const name = `giova-${activity.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').slice(0, 40) || 'aktivitaet'}.png`;
    const res = await shareOrDownload(image, name, activity.title);
    if (res === 'downloaded') toast('Bild gespeichert – jetzt in Instagram als Story hochladen');
  };

  return (
    <Sheet title="Als Story teilen" onClose={onClose}>
      <Seg
        label="Hintergrund"
        value={bg}
        onChange={setBg}
        options={[
          { value: 'dark', label: 'Schwarz' },
          ...(photo ? [{ value: 'photo' as const, label: 'Foto' }] : []),
          { value: 'transparent', label: 'Sticker' },
        ]}
      />
      <div className={`story-preview ${bg === 'transparent' ? 'checker' : ''}`}>
        {url ? <img src={url} alt="Vorschau des Story-Bilds" /> : <div className="typing"><span /><span /><span /></div>}
      </div>
      {bg === 'transparent' && <p className="tiny muted">Transparenter Sticker: In Instagram ein eigenes Foto wählen und das Bild darüberlegen.</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn primary block" onClick={share} disabled={!image}>
        <IconShare /> Teilen / Speichern
      </button>
    </Sheet>
  );
}
