import { Card } from '../components/ui';
import type { Gap, NutrientTip } from '../lib/nutrients';
import { GOAL_LABELS } from '../types';
import { useNutrients } from '../needs';

const GROUPS: { key: NutrientTip['group']; title: string; note?: string }[] = [
  { key: 'makros', title: 'Makronährstoffe' },
  { key: 'qualitaet', title: 'Ballaststoffe, Zucker, Salz & Trinken' },
  { key: 'mikro', title: 'Vitamine & Mineralstoffe', note: 'Werden nicht über das Tagebuch erfasst – darauf lohnt es sich zu achten.' },
];

const STATUS_LABEL: Record<Gap['status'], string> = { 'zu-wenig': 'zu wenig', 'zu-viel': 'zu viel', ok: 'passt', unklar: 'unklar' };

/** Nährstoffe: Check der letzten 7 Tage und was du für dein Ziel brauchst (wie viel, warum, woher). */
export function NutrientsView() {
  const data = useNutrients();
  if (!data) return null;
  const { guide, check, goals } = data;
  const problems = check.gaps.filter((g) => g.status === 'zu-wenig' || g.status === 'zu-viel');
  return (
    <div className="content">
      <Card title="Check der letzten 7 Tage">
        {check.days === 0 ? (
          <p className="small text-2">Noch keine Einträge in den letzten 7 Tagen. Trag dein Essen ein – dann sage ich dir hier, was gefehlt hat.</p>
        ) : (
          <>
            <p className="small text-2">
              {problems.length ? `${problems.length} Punkt${problems.length > 1 ? 'e' : ''} zum Verbessern` : 'Alles im grünen Bereich'} · {check.days} Tag
              {check.days > 1 ? 'e' : ''} erfasst
            </p>
            {[...check.gaps].sort((a, b) => rank(a) - rank(b)).map((g) => (
              <details key={g.key + g.label} className={`finding gap-${g.status}`} open={g.status === 'zu-wenig' || g.status === 'zu-viel'}>
                <summary>
                  <span className="finding-dot" aria-hidden="true" />
                  <span className="grow stack tight">
                    <span>
                      {g.label} <span className="gap-tag">{STATUS_LABEL[g.status]}</span>
                    </span>
                    <span className="tiny muted">{g.detail}</span>
                  </span>
                </summary>
                <p className="small">{g.fix}</p>
              </details>
            ))}
          </>
        )}
      </Card>

      <div className="section-title">Für dein Ziel: {GOAL_LABELS[goals.type]}</div>
      {GROUPS.map((grp) => {
        const tips = guide.filter((t) => t.group === grp.key);
        if (!tips.length) return null;
        return (
          <Card key={grp.key} title={grp.title}>
            {grp.note && <p className="tiny muted">{grp.note}</p>}
            <div className="nutrient-list">
              {tips.map((t) => (
                <details key={t.key} className="nutrient">
                  <summary>
                    <span className="grow stack tight">
                      <strong>{t.label}</strong>
                      <span className="small accent-text">{t.amount}</span>
                    </span>
                  </summary>
                  <p className="small">
                    <strong>Warum: </strong>
                    {t.why}
                  </p>
                  <p className="small text-2">
                    <strong>Gute Quellen: </strong>
                    {t.sources.join(', ')}
                  </p>
                </details>
              ))}
            </div>
          </Card>
        );
      })}
      <p className="tiny muted">Allgemeine Richtwerte (u. a. nach DGE) für gesunde Erwachsene – keine medizinische Beratung.</p>
    </div>
  );
}

const rank = (g: Gap) => (g.status === 'zu-wenig' ? 0 : g.status === 'zu-viel' ? 1 : g.status === 'unklar' ? 2 : 3);

/** Kompakte Vorschau für die Ernährungsseite: was zuletzt gefehlt hat. */
export function NutrientCheckCard() {
  const data = useNutrients();
  if (!data || data.check.days === 0) return null;
  const problems = data.check.gaps.filter((g) => g.status === 'zu-wenig' || g.status === 'zu-viel');
  return (
    <Card title="Nährstoffe" action={<a className="small" href="#/naehrstoffe">Alle Tipps</a>}>
      {problems.length === 0 ? (
        <p className="small text-2">In den letzten {data.check.days} Tagen hat nichts gefehlt.</p>
      ) : (
        <div className="list">
          {problems.slice(0, 3).map((g) => (
            <a key={g.key + g.label} className={`list-item gap-row gap-${g.status}`} href="#/naehrstoffe">
              <span className="finding-dot" aria-hidden="true" />
              <div className="main">
                <div className="title">
                  {g.label} <span className="gap-tag">{STATUS_LABEL[g.status]}</span>
                </div>
                <div className="meta">{g.detail}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
