import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getKV, setKV } from '../db';
import { addDays, today } from '../lib/dates';
import type { Goals, TrainingPlan, WeekSchedule } from '../types';
import { DEFAULT_GOALS } from '../types';
import { executeAction } from './actions';
import { runTool } from './tools';

const t = today();

beforeEach(async () => {
  await Promise.all(db.tables.map((x) => x.clear()));
  await setKV('profile', { sex: 'm', age: 25, height: 180, activity: 1.5 });
  await db.weights.add({ date: t, weight: 80 });
});

describe('Coach-Werkzeuge', () => {
  it('ändert Ziele und setzt die Rahmenbedingungen durch', async () => {
    const out = await executeAction('ziele_aendern', { zieltyp: 'defizit', wochenrate_kg: -2 });
    const g = await getKV<Goals>('goals', DEFAULT_GOALS);
    expect(g.type).toBe('defizit');
    expect(g.weeklyRate).toBe(-0.8);
    expect(out).toContain('Rahmenbedingungen');
    // Automatik: Rate −0,8 kg → Kalorien deutlich unter dem Erhalt, aber nie unter dem Grundumsatz
    expect(out).toContain('automatisch');
  });

  it('manuelle Kalorien schalten auf manuell und werden auf den Grundumsatz angehoben', async () => {
    const out = await executeAction('ziele_aendern', { kcal: 1000 });
    const g = await getKV<Goals>('goals', DEFAULT_GOALS);
    expect(g.auto).toBe(false);
    expect(g.kcal).toBe(1810);
    expect(out).toContain('angehoben');
  });

  it('lehnt einen Plan ohne Ruhetag ab und speichert gültige Pläne', async () => {
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => ({ wochentag: d, sport: 'laufen', titel: 'Lauf', dauer_min: 40, intensitaet: 'locker' }));
    const res = await runTool({ type: 'tool_use', id: 'x', name: 'trainingsplan_aendern', input: { hinzufuegen: days } } as never);
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toContain('NICHT gespeichert');
    expect(await getKV<TrainingPlan | null>('trainingPlan', null)).toBeNull();

    await executeAction('trainingsplan_aendern', { name: 'Test', hinzufuegen: days.slice(0, 3) });
    const plan = (await getKV<TrainingPlan | null>('trainingPlan', null))!;
    expect(plan.sessions).toHaveLength(3);
    await executeAction('trainingsplan_aendern', { entfernen: [plan.sessions[0].id] });
    expect((await getKV<TrainingPlan | null>('trainingPlan', null))!.sessions).toHaveLength(2);

    const hard = ['Mo', 'Di', 'Mi', 'Do'].map((d) => ({ wochentag: d, sport: 'hyrox', titel: 'Hart', dauer_min: 60, intensitaet: 'hart' }));
    const res2 = await runTool({ type: 'tool_use', id: 'y', name: 'trainingsplan_aendern', input: { alles_ersetzen: true, hinzufuegen: hard } } as never);
    expect(res2.is_error).toBe(true);
    expect(String(res2.content)).toContain('Harte Einheiten');
  });

  it('ändert den Alltag einzelner Tage', async () => {
    await executeAction('alltag_aendern', { tage: [{ wochentag: 'Mo', art: 'uni', beginn: '08:00', ende: '16:00', kochen_moeglich: false }] });
    const week = (await getKV<WeekSchedule | null>('schedule', null))!;
    expect(week[0]).toMatchObject({ kind: 'uni', start: '08:00', end: '16:00', canCook: false });
    const res = await runTool({ type: 'tool_use', id: 'z', name: 'alltag_aendern', input: { tage: [{ wochentag: 'Di', art: 'buero', beginn: '8 Uhr' }] } } as never);
    expect(res.is_error).toBe(true);
  });

  it('trägt Aktivitäten mit Punkten ein und erkennt Doppelte', async () => {
    const out = await executeAction('aktivitaet_eintragen', { sport: 'laufen', dauer_min: 50, distanz_km: 10, uhrzeit: '07:30' });
    expect(out).toMatch(/\+\d+ Punkte/);
    const [a] = await db.activities.toArray();
    expect(a.distanceM).toBe(10000);
    expect(a.points).toBeGreaterThan(0);
    expect(await executeAction('aktivitaet_eintragen', { sport: 'laufen', dauer_min: 50, distanz_km: 10, uhrzeit: '07:30' })).toContain('Nicht eingetragen');
    await expect(executeAction('aktivitaet_eintragen', { sport: 'laufen', dauer_min: 30, datum: addDays(t, 2) })).rejects.toThrow('Zukunft');
  });

  it('trägt Kraftsätze, Schlaf und Gewicht ein', async () => {
    await executeAction('kraftsaetze_eintragen', { saetze: [{ uebung: 'Kniebeuge', gewicht_kg: 120, wiederholungen: 5, anzahl: 3 }] });
    expect(await db.sets.where('exercise').equals('Kniebeuge').count()).toBe(3);

    await executeAction('schlaf_eintragen', { ins_bett: '23:30', aufgestanden: '07:00', qualitaet: 4 });
    await executeAction('schlaf_eintragen', { ins_bett: '23:00', aufgestanden: '07:00', qualitaet: 5 });
    const sleep = await db.sleep.toArray();
    expect(sleep).toHaveLength(1);
    expect(sleep[0].durationMin).toBe(480);

    await executeAction('gewicht_eintragen', { gewicht_kg: 79.4 });
    expect((await db.weights.where('date').equals(t).first())!.weight).toBe(79.4);
  });

  it('ändert Ernährungsvorlieben', async () => {
    await executeAction('vorlieben_aendern', { ernaehrungsform: 'vegetarisch', mahlzeiten_pro_tag: 5 });
    expect(await getKV('nutritionPrefs', null)).toMatchObject({ diet: 'vegetarisch', mealsPerDay: 5 });
  });

  it('liefert die Rahmenbedingungen auf Abruf', async () => {
    const res = await runTool({ type: 'tool_use', id: 'r', name: 'daten_abrufen', input: { bereich: 'rahmenbedingungen' } } as never);
    expect(res.is_error).toBeFalsy();
    expect(String(res.content)).toContain('Ruhetag');
  });
});
