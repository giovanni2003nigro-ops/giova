import { useEffect, useRef, useState, type FormEvent } from 'react';
import { shareAllPending } from '../activities';
import {
  deleteMyData,
  invalidateProfile,
  mediaUrl,
  saveProfile,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  updatePassword,
  uploadMedia,
  useMyProfile,
  type CloudProfile,
} from '../cloud/api';
import { clearPasswordRecovery, cloudEnabled, cloudError, passwordRecovery, readCloudConfig, saveCloudConfig, useSession } from '../cloud/client';
import { IconCamera, IconPin } from '../components/icons';
import { Avatar } from '../components/people';
import { Card, ErrorBox, Seg, toast } from '../components/ui';
import { setKV, useKV } from '../db';
import { geohash } from '../lib/geo';
import { compressImage } from '../lib/image';
import { SPORT_DEFS } from '../lib/sports';
import type { Profile, Sport, Visibility } from '../types';
import { SPORTS, VISIBILITY_LABELS } from '../types';

export function AccountView() {
  const session = useSession();
  const { profile } = useMyProfile();
  if (!cloudEnabled) return <NoServer />;
  if (session === undefined) return <div className="content empty">Lade …</div>;
  if (!session) return <AuthForm />;
  if (passwordRecovery) return <NewPassword />;
  if (profile === undefined) return <div className="content empty">Lade Profil …</div>;
  return <ProfileForm existing={profile} email={session.user.email ?? ''} />;
}

function NoServer() {
  const cfg = readCloudConfig();
  const [url, setUrl] = useState(cfg?.url ?? '');
  const [key, setKey] = useState(cfg?.anonKey ?? '');
  return (
    <div className="content">
      <Card title="Community-Server einrichten">
        <p className="small text-2">
          Konten, Feed und Ligen laufen über <a href="https://supabase.com" target="_blank" rel="noreferrer">Supabase</a> (kostenloser Tarif reicht).
          Normalerweise trägt die Betreiberin bzw. der Betreiber der App Adresse und öffentlichen Schlüssel beim Veröffentlichen ein (siehe README). Zum
          Ausprobieren kannst du sie hier eintragen.
        </p>
        <label className="field">
          <span>Projekt-URL</span>
          <input className="input" placeholder="https://xyz.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Öffentlicher Schlüssel (anon / publishable)</span>
          <input className="input" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <button className="btn primary" disabled={!url.trim() || !key.trim()} onClick={() => saveCloudConfig({ url: url.trim(), anonKey: key.trim() })}>
          Verbinden
        </button>
      </Card>
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else if (mode === 'register') {
        const res = await signUp(email.trim(), password);
        if (!res.session) setInfo('Fast geschafft: Wir haben dir eine E-Mail geschickt. Bestätige den Link und melde dich dann an.');
      } else {
        await sendPasswordReset(email.trim());
        setInfo('Wenn es ein Konto gibt, ist ein Link zum Zurücksetzen unterwegs.');
      }
    } catch (err) {
      setError(cloudError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <Card title="Giova Community">
        <p className="small text-2">
          Mit einem Konto teilst du Aktivitäten, folgst Freunden, sammelst Kudos und trittst in Ligen gegen Leute mit ähnlichem Niveau aus deiner
          Umgebung an. Ernährung, Schlaf und Gewicht bleiben nur auf deinem Gerät.
        </p>
        <Seg
          label="Modus"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'login', label: 'Anmelden' },
            { value: 'register', label: 'Registrieren' },
            { value: 'reset', label: 'Passwort vergessen' },
          ]}
        />
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>E-Mail</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              <span>Passwort</span>
              <input
                className="input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          {info && <div className="hint-box">{info}</div>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Bitte warten …' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Link senden'}
          </button>
        </form>
      </Card>
    </div>
  );
}

function NewPassword() {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="content">
      <Card title="Neues Passwort">
        <input className="input" type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Neues Passwort" />
        {error && <ErrorBox>{error}</ErrorBox>}
        <button
          className="btn primary"
          disabled={pw.length < 8}
          onClick={async () => {
            try {
              await updatePassword(pw);
              clearPasswordRecovery();
              toast('Passwort geändert');
              invalidateProfile();
            } catch (err) {
              setError(cloudError(err));
            }
          }}
        >
          Speichern
        </button>
      </Card>
    </div>
  );
}

function suggestUsername(email: string) {
  return (email.split('@')[0] ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 24);
}

function ProfileForm({ existing, email }: { existing: CloudProfile | null; email: string }) {
  const local = useKV<Profile | null>('profile', null);
  const session = useSession();
  const uid = session!.user.id;
  const [username, setUsername] = useState(existing?.username ?? suggestUsername(email));
  const [name, setName] = useState(existing?.display_name ?? '');
  const [bio, setBio] = useState(existing?.bio ?? '');
  const [sex, setSex] = useState<'m' | 'w'>(existing?.sex ?? local?.sex ?? 'm');
  const [region, setRegion] = useState(existing?.region_name ?? '');
  const [geo, setGeo] = useState(existing?.home_geohash ?? '');
  const [sports, setSports] = useState<Sport[]>(existing?.sports ?? []);
  const [avatar, setAvatar] = useState(existing?.avatar_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const autoShare = useKV<boolean>('autoShare', true);
  const shareDefault = useKV<Visibility>('shareDefault', 'public');

  useEffect(() => {
    if (!existing && local?.sex) setSex(local.sex);
  }, [existing, local?.sex]);

  const locate = () => {
    if (!navigator.geolocation) return toast('Standort wird nicht unterstützt.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo(geohash(pos.coords.latitude, pos.coords.longitude, 4));
        toast('Umgebung gespeichert (auf ca. 20 km gerundet)');
      },
      () => toast('Kein Zugriff auf den Standort.'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600_000 },
    );
  };

  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await compressImage(file, 320, 0.85);
      const path = await uploadMedia(`${uid}/avatar.jpg`, img);
      setAvatar(`${mediaUrl(path)}?v=${Date.now()}`);
    } catch (err) {
      toast(cloudError(err));
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await saveProfile({
        id: uid,
        username: username.trim().toLowerCase(),
        display_name: name.trim() || username.trim(),
        bio: bio.trim() || null,
        avatar_url: avatar || null,
        sex,
        home_geohash: geo || null,
        region_name: region.trim() || null,
        sports,
      });
      invalidateProfile(p);
      toast(existing ? 'Profil gespeichert' : 'Willkommen in der Community! 🎉');
      if (!existing) {
        const n = await shareAllPending().catch(() => 0);
        if (n) toast(`${n} Aktivitäten hochgeladen – sie zählen jetzt für deine Ligen`);
      }
    } catch (err) {
      setError(cloudError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <Card title={existing ? 'Dein Community-Profil' : 'Profil anlegen'}>
        <div className="row">
          <Avatar name={name || username || '?'} url={avatar} size={56} />
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            <IconCamera /> Profilbild
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onAvatar(e.target.files?.[0])} />
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Nutzername</span>
            <input className="input" value={username} maxLength={24} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="z. B. giova_runs" />
          </label>
          <label className="field">
            <span>Anzeigename</span>
            <input className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="Vorname" />
          </label>
        </div>
        <label className="field">
          <span>Über dich</span>
          <textarea className="input" rows={2} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="z. B. Hyrox Pro · Marathon unter 3:30 als Ziel" />
        </label>
        <div className="stack">
          <span className="small text-2" style={{ fontWeight: 550 }}>
            Geschlecht <span className="muted">(für faire Kraftwertung per DOTS)</span>
          </span>
          <Seg
            label="Geschlecht"
            value={sex}
            onChange={setSex}
            options={[
              { value: 'm', label: 'Männlich' },
              { value: 'w', label: 'Weiblich' },
            ]}
          />
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Ort / Region</span>
            <input className="input" value={region} maxLength={60} onChange={(e) => setRegion(e.target.value)} placeholder="z. B. Köln" />
          </label>
          <div className="field">
            <span>Umgebung für Ligen</span>
            <button type="button" className="btn" onClick={locate}>
              <IconPin /> {geo ? 'Festgelegt ✓' : 'Standort nutzen'}
            </button>
          </div>
        </div>
        <p className="tiny muted">Gespeichert wird nur ein grobes Raster (≈ 40 × 20 km), nie deine genaue Adresse.</p>
        <div className="stack">
          <span className="small text-2" style={{ fontWeight: 550 }}>
            Deine Sportarten
          </span>
          <div className="chips wrap">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={sports.includes(s)}
                onClick={() => setSports((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))}
              >
                {SPORT_DEFS[s].emoji} {SPORT_DEFS[s].label}
              </button>
            ))}
          </div>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn primary" onClick={save} disabled={busy || username.trim().length < 3}>
          {busy ? 'Speichere …' : existing ? 'Speichern' : 'Profil anlegen'}
        </button>
      </Card>

      {existing && (
        <>
          <Card title="Teilen">
            <label className="check">
              <input type="checkbox" checked={autoShare ?? true} onChange={(e) => setKV('autoShare', e.target.checked)} />
              Neue Aktivitäten automatisch hochladen
            </label>
            <div className="stack">
              <span className="small text-2">Standard-Sichtbarkeit</span>
              <Seg
                label="Standard-Sichtbarkeit"
                value={shareDefault ?? 'public'}
                onChange={(v) => setKV('shareDefault', v)}
                options={(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))}
              />
            </div>
            <p className="tiny muted">Auch „Nur ich“ wird hochgeladen, damit die Punkte in deiner Liga zählen – sehen kann die Aktivität dann aber niemand sonst.</p>
            <button
              className="btn"
              onClick={async () => {
                try {
                  const n = await shareAllPending();
                  toast(n ? `${n} Aktivitäten hochgeladen` : 'Alles ist schon hochgeladen');
                } catch (err) {
                  toast(cloudError(err));
                }
              }}
            >
              Bisherige Aktivitäten hochladen
            </button>
          </Card>
          <Card title="Konto">
            <p className="small text-2">Angemeldet als {email}</p>
            <button className="btn" onClick={() => signOut().then(() => invalidateProfile(null))}>
              Abmelden
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('Profil, geteilte Aktivitäten, Kommentare, Kudos und Ligen auf dem Server löschen? Deine Daten auf diesem Gerät bleiben erhalten.')) return;
                try {
                  await deleteMyData();
                  invalidateProfile(null);
                  toast('Community-Daten gelöscht');
                } catch (err) {
                  toast(cloudError(err));
                }
              }}
            >
              Community-Daten löschen
            </button>
          </Card>
        </>
      )}
    </div>
  );
}
