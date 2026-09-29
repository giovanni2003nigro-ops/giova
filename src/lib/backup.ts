import { db } from '../db';
import type { Food } from '../types';
import { base64ToBlob, blobToBase64 } from './image';

interface BackupFile {
  app: 'giova-fit';
  version: 1;
  exportedAt: string;
  data: {
    exercises: unknown[];
    sets: unknown[];
    foods: (Omit<Food, 'photo'> & { photo?: { type: string; base64: string } })[];
    meals: unknown[];
    sleep: unknown[];
    weights: unknown[];
    chats: unknown[];
    kv: { key: string; value: unknown }[];
  };
}

/** Exportiert alle Daten (inkl. Fotos) als JSON-Datei. Der API-Schlüssel wird nicht exportiert. */
export async function exportBackup(): Promise<Blob> {
  const foods = await db.foods.toArray();
  const backup: BackupFile = {
    app: 'giova-fit',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      exercises: await db.exercises.toArray(),
      sets: await db.sets.toArray(),
      foods: await Promise.all(
        foods.map(async ({ photo, ...f }) => ({
          ...f,
          ...(photo ? { photo: { type: photo.type || 'image/jpeg', base64: await blobToBase64(photo) } } : {}),
        })),
      ),
      meals: await db.meals.toArray(),
      sleep: await db.sleep.toArray(),
      weights: await db.weights.toArray(),
      chats: await db.chats.toArray(),
      kv: (await db.kv.toArray()).filter((r) => r.key !== 'apiKey'),
    },
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Ersetzt alle Daten durch den Inhalt einer Sicherung (der API-Schlüssel bleibt erhalten). */
export async function importBackup(file: Blob): Promise<void> {
  const parsed = JSON.parse(await file.text()) as BackupFile;
  if (parsed?.app !== 'giova-fit' || !parsed.data) throw new Error('Das ist keine gültige Giova-Fit-Sicherung.');
  const d = parsed.data;
  const foods: Food[] = (d.foods ?? []).map(({ photo, ...f }) => ({
    ...f,
    ...(photo ? { photo: base64ToBlob(photo.base64, photo.type) } : {}),
  }));
  await db.transaction('rw', [db.exercises, db.sets, db.foods, db.meals, db.sleep, db.weights, db.chats, db.kv], async () => {
    await Promise.all([db.exercises.clear(), db.sets.clear(), db.foods.clear(), db.meals.clear(), db.sleep.clear(), db.weights.clear(), db.chats.clear()]);
    const apiKey = await db.kv.get('apiKey');
    await db.kv.clear();
    if (apiKey) await db.kv.put(apiKey);
    await db.exercises.bulkAdd(d.exercises as never[]);
    await db.sets.bulkAdd(d.sets as never[]);
    await db.foods.bulkAdd(foods);
    await db.meals.bulkAdd(d.meals as never[]);
    await db.sleep.bulkAdd(d.sleep as never[]);
    await db.weights.bulkAdd(d.weights as never[]);
    await db.chats.bulkAdd(d.chats as never[]);
    await db.kv.bulkPut(d.kv.filter((r) => r.key !== 'apiKey'));
  });
}

/** Löscht alle Daten und legt die Standard-Übungen neu an. */
export async function deleteAllData(): Promise<void> {
  await db.delete();
  await db.open();
}
