import { useEffect, useRef, useState } from 'react';
import { createClient, errorMessage, MODEL } from '../ai/client';
import { Card, ErrorBox, Seg, toast } from '../components/ui';
import { setKV } from '../db';
import { useApiKey } from '../hooks';
import { deleteAllData, exportBackup, importBackup } from '../lib/backup';
import { ACCENTS, FONTS_LARGE, FONTS_SMALL, readAppearance, saveAppearance, type Accent, type Appearance, type FontLarge, type FontSmall } from '../lib/appearance';
import { today } from '../lib/dates';

type Theme = 'system' | 'light' | 'dark';

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Statusleiste/Browserleiste passend einfärben
  const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f3f3f4' : '#0a0a0b');
}

/** Standard ist das dunkle Design. */
export function readTheme(): Theme {
  try {
    return (localStorage.getItem('theme') as Theme) || 'dark';
  } catch {
    return 'dark';
  }
}

export function SettingsView() {
  const stored = useApiKey();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stored !== undefined) setKey(stored);
  }, [stored]);

  const saveKey = async () => {
    await setKV('apiKey', key.trim());
    toast(key.trim() ? 'API-Schlüssel gespeichert' : 'API-Schlüssel entfernt');
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const model = await createClient(key.trim()).models.retrieve(MODEL);
      setStatus({ ok: true, msg: `Verbindung ok – ${model.display_name} ist verfügbar.` });
      await setKV('apiKey', key.trim());
    } catch (err) {
      setStatus({ ok: false, msg: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const doExport = async () => {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `giova-fit-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    if (!confirm('Alle aktuellen Daten werden durch die Sicherung ersetzt. Fortfahren?')) return;
    try {
      await importBackup(file);
      toast('Sicherung wiederhergestellt');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const doDelete = async () => {
    if (!confirm('Wirklich ALLE Daten (Training, Ernährung, Fotos, Schlaf, Ziele, Chats) löschen?')) return;
    if (!confirm('Letzte Warnung: Das kann nicht rückgängig gemacht werden.')) return;
    await deleteAllData();
    location.reload();
  };

  return (
    <div className="content">
      <Card title="Claude API-Schlüssel">
        <p className="small text-2">
          Wird für Foto-Erkennung, Coach-Chat und KI-Analyse benötigt (Modell: <code>{MODEL}</code>). Einen Schlüssel erstellst du unter{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          .
        </p>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="API-Schlüssel"
        />
        <div className="grid-2">
          <button className="btn" onClick={test} disabled={!key.trim() || testing}>
            {testing ? 'Teste …' : 'Verbindung testen'}
          </button>
          <button className="btn primary" onClick={saveKey}>
            Speichern
          </button>
        </div>
        {status &&
          (status.ok ? <div className="hint-box">✓ {status.msg}</div> : <ErrorBox>{status.msg}</ErrorBox>)}
        <p className="tiny muted">
          Der Schlüssel wird nur lokal in diesem Browser gespeichert und direkt an die Anthropic-API gesendet. Tipp: Lege in der Anthropic-Konsole
          ein monatliches Ausgabenlimit fest. Lehnt Sonnet 5.5 eine Anfrage aus Sicherheitsgründen ab, versucht die API automatisch ein
          Ersatzmodell.
        </p>
      </Card>

      <Card title="Darstellung">
        <Seg
          value={theme}
          label="Farbschema"
          onChange={(t) => {
            setTheme(t);
            try {
              localStorage.setItem('theme', t);
            } catch {
              /* privates Fenster */
            }
            applyTheme(t);
          }}
          options={[
            { value: 'dark', label: 'Dunkel' },
            { value: 'light', label: 'Hell' },
            { value: 'system', label: 'Wie System' },
          ]}
        />
        <AppearancePicker />
      </Card>

      <Card title="Daten & Sicherung">
        <p className="small text-2">
          Alle Daten liegen nur auf diesem Gerät (im Browser). Erstelle regelmäßig eine Sicherung – z. B. um sie auf ein neues Handy zu übertragen.
        </p>
        <div className="grid-2">
          <button className="btn" onClick={doExport}>
            Sicherung exportieren
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            Sicherung laden
          </button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
        <button className="btn danger" onClick={doDelete}>
          Alle Daten löschen
        </button>
      </Card>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        Giova Fit · Kein Ersatz für ärztliche oder ernährungsmedizinische Beratung.
      </p>
    </div>
  );
}

/** Akzentfarbe und Schriften wählen – wirkt sofort. */
function AppearancePicker() {
  const [a, setA] = useState<Appearance>(readAppearance);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };
  return (
    <>
      <div className="field">
        <span>Akzentfarbe</span>
        <div className="accent-picks" role="radiogroup" aria-label="Akzentfarbe">
          {(Object.keys(ACCENTS) as Accent[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={a.accent === k}
              className="accent-pick"
              onClick={() => set({ accent: k })}
            >
              <span className="accent-dot" style={{ background: `linear-gradient(135deg, ${ACCENTS[k].grad.join(', ')})` }} />
              {ACCENTS[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Große Schrift</span>
          <select className="input" value={a.fontLarge} onChange={(e) => set({ fontLarge: e.target.value as FontLarge })}>
            {(Object.keys(FONTS_LARGE) as FontLarge[]).map((k) => (
              <option key={k} value={k}>
                {FONTS_LARGE[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kleine Schrift</span>
          <select className="input" value={a.fontSmall} onChange={(e) => set({ fontSmall: e.target.value as FontSmall })}>
            {(Object.keys(FONTS_SMALL) as FontSmall[]).map((k) => (
              <option key={k} value={k}>
                {FONTS_SMALL[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="font-preview">
        <strong>12,4 km · 4:52 /km</strong>
        <span className="small muted">Große Schrift für Werte & Titel, kleine graue für Details.</span>
      </div>
    </>
  );
}
