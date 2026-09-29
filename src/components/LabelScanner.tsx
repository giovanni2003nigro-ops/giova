import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../ai/client';
import { scanNutritionLabel } from '../ai/labelScan';
import { db } from '../db';
import { navigate, useApiKey, useObjectUrl } from '../hooks';
import { compressImage } from '../lib/image';
import type { Food } from '../types';
import { draftToFood, EMPTY_DRAFT, FoodForm, scanToDraft, type FoodDraft } from './FoodForm';
import { IconCamera, IconImage, IconSparkle } from './icons';
import { ErrorBox, toast } from './ui';

type Status = 'idle' | 'scanning' | 'done' | 'error';

/**
 * Nährwerttabelle fotografieren → Claude liest die Werte aus → prüfen → mit Foto speichern.
 */
export function LabelScanner({ onSaved }: { onSaved: (food: Food) => void }) {
  const apiKey = useApiKey();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<FoodDraft>(EMPTY_DRAFT);
  const url = useObjectUrl(photo);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const scan = async (image: Blob) => {
    if (!apiKey) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus('scanning');
    setError('');
    try {
      const result = await scanNutritionLabel(apiKey, image, ctrl.signal);
      if (!result.lesbar) {
        setStatus('error');
        setError('Auf dem Foto ist keine Nährwerttabelle erkennbar. Bitte näher ran und scharf stellen.');
        return;
      }
      setDraft((d) => ({ ...scanToDraft(result), name: d.name || result.name }));
      setNote(result.hinweis);
      setStatus('done');
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus('error');
      setError(errorMessage(err));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed);
      void scan(compressed);
    } catch (err) {
      setError(errorMessage(err));
      setStatus('error');
    }
  };

  const save = async () => {
    const food = draftToFood(draft, 'foto');
    if (typeof food === 'string') return toast(food);
    const withPhoto: Food = { ...food, ...(photo ? { photo } : {}) };
    const id = await db.foods.add(withPhoto);
    toast(`„${food.name}“ in der Bibliothek gespeichert`);
    onSaved({ ...withPhoto, id });
  };

  return (
    <div className="stack lg">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {!photo ? (
        <button className="drop" onClick={() => cameraRef.current?.click()} type="button">
          <IconCamera />
          <strong>Nährwerttabelle fotografieren</strong>
          <span className="small muted">
            {apiKey ? 'Die Werte werden automatisch mit Claude ausgelesen.' : 'Ohne API-Schlüssel trägst du die Werte selbst ein – das Foto wird trotzdem gespeichert.'}
          </span>
        </button>
      ) : (
        <img src={url} alt="Foto der Nährwerttabelle" className="photo-preview" />
      )}
      <div className="grid-2">
        <button className="btn" type="button" onClick={() => cameraRef.current?.click()}>
          <IconCamera /> {photo ? 'Neues Foto' : 'Kamera'}
        </button>
        <button className="btn" type="button" onClick={() => galleryRef.current?.click()}>
          <IconImage /> Galerie
        </button>
      </div>

      {!apiKey && (
        <div className="hint-box">
          💡 Mit einem Claude-API-Schlüssel werden die Nährwerte automatisch erkannt.{' '}
          <a href="#/einstellungen" onClick={() => navigate('einstellungen')}>
            Jetzt einrichten
          </a>
        </div>
      )}
      {status === 'scanning' && (
        <div className="hint-box row">
          <span className="typing" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          Claude liest die Nährwerte aus …
        </div>
      )}
      {status === 'error' && <ErrorBox>{error}</ErrorBox>}
      {status === 'done' && (
        <div className="hint-box">
          ✓ Werte erkannt – bitte kurz prüfen.{note ? ` Hinweis: ${note}` : ''}
        </div>
      )}
      {photo && apiKey && status !== 'scanning' && (
        <button className="btn ghost small" type="button" onClick={() => scan(photo)}>
          <IconSparkle /> Erneut auslesen
        </button>
      )}

      {(photo || status !== 'idle') && (
        <>
          <FoodForm draft={draft} onChange={setDraft} />
          <button className="btn primary block" type="button" onClick={save} disabled={status === 'scanning'}>
            In Bibliothek speichern
          </button>
        </>
      )}
    </div>
  );
}
