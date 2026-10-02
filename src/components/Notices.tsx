import { useMemo, useState } from 'react';
import { useAnalysis, useAppData, type RouteName } from '../hooks';
import type { Area, Recommendation } from '../lib/analysis';
import { checkRules, limits, type Rule } from '../lib/guardrails';
import { RecommendationItem, Sheet } from './ui';

/** Welche Hinweise gehören zu welcher Seite (Übersicht zeigt alle). */
const PAGE_AREAS: Partial<Record<RouteName, Area[] | 'all'>> = {
  heute: 'all',
  essen: ['ernaehrung', 'gewicht'],
  training: ['training'],
  aufzeichnen: ['training'],
  schlaf: ['schlaf'],
  ziele: ['gewicht', 'ernaehrung'],
  plan: ['ernaehrung', 'training'],
  profil: 'all',
  coach: 'all',
};

export interface PageNotices {
  recs: Recommendation[];
  good: Recommendation[];
  insights: { id: string; title: string; detail: string; conclusion: string }[];
  rules: Rule[];
  count: number;
}

export function usePageNotices(page: RouteName): PageNotices | null {
  const data = useAppData();
  const analysis = useAnalysis(data);
  return useMemo(() => {
    const areas = PAGE_AREAS[page];
    if (!areas || !data || !analysis) return null;
    const match = (r: Recommendation) => areas === 'all' || areas.includes(r.area);
    const recs = analysis.recommendations.filter((r) => r.severity !== 'ok' && match(r));
    const good = analysis.recommendations.filter((r) => r.severity === 'ok' && match(r));
    const insights = areas === 'all' || areas.includes('schlaf') || areas.includes('training') ? analysis.insights : [];
    const weight = analysis.weight?.avg7 ?? null;
    const showRules = areas === 'all' || page === 'ziele' || page === 'plan';
    const rules = showRules ? checkRules(data.goals, data.plan, limits(data.profile, weight)).filter((r) => !r.ok) : [];
    return { recs, good, insights, rules, count: recs.length + insights.length + rules.length };
  }, [page, data, analysis]);
}

/** (!) in der Kopfzeile – nur sichtbar, wenn es für diese Seite Hinweise gibt. */
export function NoticesButton({ page }: { page: RouteName }) {
  // Seiten ohne Hinweise (Tracker, Feed, Ligen …) laden gar keine Auswertung
  return PAGE_AREAS[page] ? <PageNotices page={page} /> : null;
}

function PageNotices({ page }: { page: RouteName }) {
  const n = usePageNotices(page);
  const [open, setOpen] = useState(false);
  const [showOk, setShowOk] = useState(false);
  if (!n || n.count === 0) return null;
  const urgent = n.rules.length > 0 || n.recs.some((r) => r.severity === 'alert' || r.severity === 'warn');
  return (
    <>
      <button
        className={`bang bang-top ${urgent ? 'bang-warn' : 'bang-info'}`}
        onClick={() => setOpen(true)}
        aria-label={`${n.count} Hinweis${n.count > 1 ? 'e' : ''} anzeigen`}
        aria-haspopup="dialog"
      >
        !{n.count > 1 && <span className="bang-count">{n.count}</span>}
      </button>
      {open && (
        <Sheet title="Hinweise & Vorschläge" onClose={() => setOpen(false)}>
          <div className="bang-body">
            {n.rules.length > 0 && (
              <div className="rec alert">
                <div className="grow">
                  <h3>Rahmenbedingungen verletzt</h3>
                  <ul>
                    {n.rules.map((r) => (
                      <li key={r.id}>
                        <strong>{r.label}</strong> ({r.current}, Pflicht: {r.requirement}): {r.fix}
                      </li>
                    ))}
                  </ul>
                  <a className="small" href="#/ziele" onClick={() => setOpen(false)}>
                    Ziele anpassen
                  </a>
                </div>
              </div>
            )}
            {n.recs.map((r) => (
              <RecommendationItem key={r.id} rec={r} />
            ))}
            {n.insights.map((i) => (
              <div key={i.id} className="hint-box">
                <strong>{i.title}</strong>
                <div>{i.detail}</div>
                <div style={{ marginTop: 4 }}>→ {i.conclusion}</div>
              </div>
            ))}
            {n.good.length > 0 && (
              <>
                <button className="btn ghost small" onClick={() => setShowOk((v) => !v)} style={{ alignSelf: 'flex-start' }}>
                  {showOk ? 'Ausblenden' : `Was gut läuft (${n.good.length})`}
                </button>
                {showOk && n.good.map((r) => <RecommendationItem key={r.id} rec={r} />)}
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
