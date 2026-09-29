import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db';
import { useObjectUrl } from '../hooks';
import { fmt } from '../lib/stats';
import type { Food } from '../types';
import { FoodThumb, macroText } from './AddFoodSheet';
import { draftToFood, FoodForm, foodToDraft, type FoodDraft } from './FoodForm';
import { IconCamera, IconEdit, IconPlus, IconTrash } from './icons';
import { Sheet, toast } from './ui';

/** Bibliothek aller gespeicherten Lebensmittel inkl. fotografierter Nährwerttabellen. */
export function FoodLibrarySheet({ onClose, onAdd, onScan }: { onClose: () => void; onAdd: (f: Food) => void; onScan: () => void }) {
  const foods = useLiveQuery(() => db.foods.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [onlyPhotos, setOnlyPhotos] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = foods.filter(
    (f) => (!onlyPhotos || f.photo) && (!needle || `${f.brand ?? ''} ${f.name}`.toLowerCase().includes(needle)),
  );

  if (selected) {
    const fresh = foods.find((f) => f.id === selected.id) ?? selected;
    return <FoodDetail food={fresh} onBack={() => setSelected(null)} onClose={onClose} onAdd={onAdd} />;
  }

  return (
    <Sheet title={`Lebensmittel-Bibliothek (${foods.length})`} onClose={onClose}>
      <button className="btn primary block" onClick={onScan}>
        <IconCamera /> Nährwerte fotografieren
      </button>
      <input className="input" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Bibliothek durchsuchen" />
      <label className="row small">
        <input type="checkbox" checked={onlyPhotos} onChange={(e) => setOnlyPhotos(e.target.checked)} />
        Nur Einträge mit Foto
      </label>
      <div className="list">
        {list.map((f) => (
          <button
            key={f.id}
            className="list-item"
            style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setSelected(f)}
          >
            <FoodThumb food={f} />
            <div className="main">
              <div className="title">{f.name}</div>
              <div className="meta tnum">
                {f.brand ? `${f.brand} · ` : ''}pro 100 {f.unit}: {macroText(f.per100)}
              </div>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="empty">{foods.length ? 'Nichts gefunden.' : 'Noch keine Lebensmittel gespeichert.'}</div>}
      </div>
    </Sheet>
  );
}

function FoodDetail({ food, onBack, onClose, onAdd }: { food: Food; onBack: () => void; onClose: () => void; onAdd: (f: Food) => void }) {
  const url = useObjectUrl(food.photo);
  const [editing, setEditing] = useState<FoodDraft | null>(null);

  const save = async () => {
    if (!editing || food.id == null) return;
    const updated = draftToFood(editing, food.source);
    if (typeof updated === 'string') return toast(updated);
    await db.foods.update(food.id, { ...updated, createdAt: food.createdAt });
    setEditing(null);
    toast('Gespeichert');
  };
  const remove = async () => {
    if (food.id == null || !confirm(`„${food.name}“ wirklich löschen?`)) return;
    await db.foods.delete(food.id);
    toast('Gelöscht');
    onBack();
  };

  const n = food.per100;
  const rows: [string, number | undefined, string][] = [
    ['Kalorien', n.kcal, 'kcal'],
    ['Protein', n.protein, 'g'],
    ['Kohlenhydrate', n.carbs, 'g'],
    ['davon Zucker', n.sugar, 'g'],
    ['Fett', n.fat, 'g'],
    ['gesättigte Fettsäuren', n.satFat, 'g'],
    ['Ballaststoffe', n.fiber, 'g'],
    ['Salz', n.salt, 'g'],
  ];

  return (
    <Sheet title={food.name} onClose={onClose}>
      <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Zurück zur Bibliothek
      </button>
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`Nährwerttabelle ${food.name}`} className="photo-full" />
        </a>
      )}
      {editing ? (
        <>
          <FoodForm draft={editing} onChange={setEditing} />
          <div className="grid-2">
            <button className="btn" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="btn primary" onClick={save}>
              Speichern
            </button>
          </div>
        </>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nährwert</th>
                <th>pro 100 {food.unit}</th>
                {food.servingSize ? <th>pro Portion ({fmt(food.servingSize)} {food.unit})</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows
                .filter(([, v]) => v != null)
                .map(([label, v, unit]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>
                      {fmt(v!, 1)} {unit}
                    </td>
                    {food.servingSize ? (
                      <td>
                        {fmt((v! * food.servingSize) / 100, 1)} {unit}
                      </td>
                    ) : null}
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="tiny muted">
            {food.brand ? `${food.brand} · ` : ''}Quelle: {food.source === 'foto' ? 'Foto' : food.source === 'chat' ? 'Coach-Chat' : 'manuell'} ·{' '}
            {new Date(food.createdAt).toLocaleDateString('de-DE')}
          </p>
          <button className="btn primary block" onClick={() => onAdd(food)}>
            <IconPlus /> Zum Tagebuch hinzufügen
          </button>
          <div className="grid-2">
            <button className="btn" onClick={() => setEditing(foodToDraft(food))}>
              <IconEdit /> Bearbeiten
            </button>
            <button className="btn danger" onClick={remove}>
              <IconTrash /> Löschen
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
