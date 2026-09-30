import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildSystemPrompt, runChatTurn } from '../ai/chat';
import { errorMessage, MODEL } from '../ai/client';
import { buildSnapshot, loadAppData } from '../ai/context';
import { TOOL_LABELS } from '../ai/tools';
import { IconClose, IconImage, IconPlus, IconSend, IconStop, IconTrash } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { Card, ErrorBox, Sheet } from '../components/ui';
import { db, setKV, useKV } from '../db';
import { navigate, useApiKey, useObjectUrl } from '../hooks';
import { today } from '../lib/dates';
import { blobToBase64, compressImage } from '../lib/image';
import type { ChatRecord } from '../types';

const SUGGESTIONS = [
  'Wie viele Makros haben 80 g Haferflocken, 300 ml Milch (1,5 %) und 30 g Whey zusammen?',
  'Was kann ich heute noch essen, um meine Makros zu treffen?',
  'Wie läuft mein Training? Wo stagniere ich und was soll ich ändern?',
  'Passt meine Ernährung zu meinem Ziel? Was soll ich anpassen?',
  'Trag mir 200 g Hähnchenbrust und 150 g gekochten Reis zum Mittagessen ein.',
];

export function CoachView() {
  const apiKey = useApiKey();
  const activeId = useKV<number | null>('activeChat', null);
  const chat = useLiveQuery(async () => (activeId ? await db.chats.get(activeId) : undefined), [activeId]);
  const [text, setText] = useState('');
  const [image, setImage] = useState<Blob | undefined>();
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imageUrl = useObjectUrl(image);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat?.messages.length, streaming, liveTools.length, busy]);

  if (apiKey === undefined || activeId === undefined) return null;

  if (!apiKey)
    return (
      <div className="content">
        <Card title="KI-Coach einrichten">
          <p className="small text-2">
            Dein persönlicher KI-Coach kennt deine Ziele, dein Training, deine Ernährung und deinen Schlaf, berechnet
            Nährwert-Kombinationen aus deiner Bibliothek und kann Mahlzeiten direkt eintragen.
          </p>
          <p className="small text-2">Dafür brauchst du einen API-Schlüssel von console.anthropic.com.</p>
          <button className="btn primary" onClick={() => navigate('einstellungen')}>
            API-Schlüssel hinterlegen
          </button>
        </Card>
      </div>
    );

  const run = async (record: ChatRecord) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    setStreaming('');
    setLiveTools([]);
    try {
      await runChatTurn({
        apiKey,
        system: record.system,
        messages: record.messages,
        signal: ctrl.signal,
        onText: setStreaming,
        onTool: (name) => setLiveTools((xs) => [...xs, name]),
        onPersist: async (messages) => {
          setStreaming('');
          setLiveTools([]);
          await db.chats.update(record.id!, { messages, updatedAt: Date.now() });
        },
      });
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
      setStreaming('');
      setLiveTools([]);
    }
  };

  const send = async (preset?: string) => {
    const msg = (preset ?? text).trim();
    if ((!msg && !image) || busy) return;
    let record = chat;
    if (!record) {
      const snapshot = buildSnapshot(await loadAppData(), today());
      const fresh: ChatRecord = {
        title: msg.slice(0, 60) || 'Foto',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        system: buildSystemPrompt(snapshot),
        messages: [],
      };
      const id = await db.chats.add(fresh);
      await setKV('activeChat', id);
      record = { ...fresh, id };
    }
    const prompt = msg || 'Was siehst du auf dem Foto? Schätze die Nährwerte.';
    const content: string | BetaContentBlockParam[] = image
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(image) } },
          { type: 'text', text: prompt },
        ]
      : prompt;
    const messages: BetaMessageParam[] = [...record.messages, { role: 'user', content }];
    const updated = { ...record, messages, updatedAt: Date.now() };
    await db.chats.update(record.id!, { messages, updatedAt: updated.updatedAt });
    setText('');
    setImage(undefined);
    await run(updated);
  };

  const newChat = async () => {
    abortRef.current?.abort();
    await setKV('activeChat', null);
    setError('');
  };

  const lastIsUser = chat && chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === 'user';

  return (
    <div className="coach">
      <div className="row between" style={{ padding: '12px 16px 0' }}>
        <button className="btn small" onClick={() => setShowHistory(true)}>
          Verlauf
        </button>
        <span className="tiny muted">KI-Coach</span>
        <button className="btn small" onClick={newChat} disabled={!chat}>
          <IconPlus /> Neuer Chat
        </button>
      </div>

      <div className="chat">
        {!chat && (
          <div className="stack lg" style={{ marginTop: 8 }}>
            <p className="text-2 small">
              Frag mich alles zu Training, Ernährung und Schlaf. Ich kenne deine Ziele und Daten, rechne Nährwert-Kombinationen exakt aus und kann
              Mahlzeiten für dich eintragen.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" style={{ textAlign: 'left', borderRadius: 12, padding: '10px 12px' }} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {chat && renderMessages(chat.messages)}
        {liveTools.map((name, i) => (
          <div key={`${name}-${i}`} className="tool-chip">
            {TOOL_LABELS[name] ?? name} …
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            {streaming ? (
              <Markdown text={streaming} />
            ) : (
              <span className="typing" aria-label="Coach schreibt">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        )}
        {error && (
          <ErrorBox>
            {error}
            {lastIsUser && chat && (
              <div style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => run(chat)}>
                  Erneut versuchen
                </button>
              </div>
            )}
          </ErrorBox>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {imageUrl && (
          <div className="row">
            <img src={imageUrl} alt="Anhang" className="thumb" />
            <button className="icon-btn sm" onClick={() => setImage(undefined)} aria-label="Foto entfernen">
              <IconClose />
            </button>
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setImage(await compressImage(f));
              e.target.value = '';
            }}
          />
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Foto anhängen" disabled={busy}>
            <IconImage />
          </button>
          <textarea
            className="input"
            rows={1}
            value={text}
            placeholder="Nachricht an deinen Coach …"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button className="btn primary" onClick={() => abortRef.current?.abort()} aria-label="Stoppen">
              <IconStop />
            </button>
          ) : (
            <button className="btn primary" onClick={() => send()} disabled={!text.trim() && !image} aria-label="Senden">
              <IconSend />
            </button>
          )}
        </div>
      </div>

      {showHistory && <HistorySheet activeId={activeId} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function renderMessages(messages: BetaMessageParam[]): ReactNode[] {
  const out: ReactNode[] = [];
  messages.forEach((m, i) => {
    const blocks = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
    if (m.role === 'user') {
      const texts = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);
      const images = blocks.filter((b) => b.type === 'image');
      if (!texts.length && !images.length) return; // reine Werkzeug-Ergebnisse
      out.push(
        <div key={i} className="msg user">
          {images.map((b, j) => {
            const src = (b as { source: { type: string; data?: string; media_type?: string } }).source;
            return src.type === 'base64' ? <img key={j} src={`data:${src.media_type};base64,${src.data}`} alt="Angehängtes Foto" /> : null;
          })}
          {texts.join('\n')}
        </div>,
      );
      return;
    }
    blocks.forEach((b, j) => {
      if (b.type === 'text' && b.text.trim())
        out.push(
          <div key={`${i}-${j}`} className="msg assistant">
            <Markdown text={b.text} />
          </div>,
        );
      else if (b.type === 'tool_use')
        out.push(
          <div key={`${i}-${j}`} className="tool-chip">
            {TOOL_LABELS[b.name] ?? b.name}
          </div>,
        );
    });
  });
  return out;
}

function HistorySheet({ activeId, onClose }: { activeId: number | null; onClose: () => void }) {
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  return (
    <Sheet title="Frühere Chats" onClose={onClose}>
      {chats.length === 0 && <div className="empty">Noch keine Chats.</div>}
      <div className="list">
        {chats.map((c) => (
          <div className="list-item" key={c.id}>
            <button
              className="main"
              style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }}
              onClick={async () => {
                await setKV('activeChat', c.id);
                onClose();
              }}
            >
              <div className="title">
                {c.id === activeId ? '● ' : ''}
                {c.title}
              </div>
              <div className="meta">
                {new Date(c.updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                {c.messages.filter((m) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'))).length}{' '}
                Fragen
              </div>
            </button>
            <button
              className="icon-btn sm"
              aria-label="Chat löschen"
              onClick={async () => {
                if (!c.id || !confirm('Chat löschen?')) return;
                await db.chats.delete(c.id);
                if (c.id === activeId) await setKV('activeChat', null);
              }}
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
      <p className="tiny muted">Modell: {MODEL}. Jeder Chat nutzt den Datenstand von seinem Start und kann aktuelle Daten bei Bedarf abrufen.</p>
    </Sheet>
  );
}
