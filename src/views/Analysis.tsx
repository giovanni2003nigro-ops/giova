import { useState } from 'react';
import { Card, RecommendationItem } from '../components/ui';
import { useAnalysis, useAppData } from '../hooks';
import { AREA_LABELS, SEVERITY_LABELS, type Recommendation } from '../lib/analysis';
import { CoachReportCard } from './Dashboard';
import { TrendBadge } from './Training';

/**
 * Analyse: Zielerreichung, Abweichungen (zum Aufklappen), Zusammenhänge, Kraftentwicklung
 * und die ausführliche KI-Analyse.
 */
export function AnalysisView() {
  const data = useAppData();
  const analysis = useAnalysis(data);
  const [showOk, setShowOk] = useState(false);
  if (!data || !analysis) return null;
  const problems = analysis.recommendations.filter((r) => r.severity !== 'ok');
  const good = analysis.recommendations.filter((r) => r.severity === 'ok');
  const score = analysis.score.total;

  return (
    <div className="content">
      <Card>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div className="stat">
            <span className="label">Zielerreichung (7 Tage)</span>
            <span className="hero">{score != null ? `${Math.round(score * 100)} %` : '–'}</span>
          </div>
          <span className="small muted" style={{ textAlign: 'right' }}>
            {problems.filter((p) => p.severity === 'warn' || p.severity === 'alert').length} Abweichungen
            <br />
            {good.length} Ziele im Plan
          </span>
        </div>
        <div className="chips">
          {analysis.score.parts.map((p) => (
            <span className="badge" key={p.key}>
              {p.label} {Math.round(p.value * 100)} %
            </span>
          ))}
        </div>
      </Card>

      <Card title="Abweichungen & Vorschläge">
        {problems.length === 0 && <p className="small text-2">Keine Abweichungen – alles im Plan.</p>}
        {problems.map((r) => (
          <Finding key={r.id} rec={r} />
        ))}
        {good.length > 0 && (
          <>
            <button className="btn ghost small" onClick={() => setShowOk((v) => !v)} style={{ alignSelf: 'flex-start' }}>
              {showOk ? 'Ausblenden' : `Was gut läuft (${good.length})`}
            </button>
            {showOk && good.map((r) => <RecommendationItem key={r.id} rec={r} />)}
          </>
        )}
      </Card>

      {analysis.insights.length > 0 && (
        <Card title="Zusammenhänge">
          {analysis.insights.map((i) => (
            <details key={i.id} className="finding">
              <summary>{i.title}</summary>
              <div className="small text-2">{i.detail}</div>
              <div className="small">→ {i.conclusion}</div>
            </details>
          ))}
        </Card>
      )}

      {analysis.trends.length > 0 && (
        <Card title="Kraftentwicklung" action={<a className="small" href="#/entwicklung">Verlauf</a>}>
          <div className="list">
            {analysis.trends.slice(0, 8).map((tr) => (
              <div className="list-item" key={tr.exercise}>
                <div className="main">
                  <div className="title">{tr.exercise}</div>
                </div>
                <TrendBadge status={tr.status} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <CoachReportCard />
    </div>
  );
}

/** Eine Abweichung: Titel sofort, Details und Maßnahmen erst nach Antippen. */
function Finding({ rec }: { rec: Recommendation }) {
  return (
    <details className={`finding ${rec.severity}`}>
      <summary>
        <span className="finding-dot" aria-hidden="true" />
        <span className="grow stack tight">
          <span>{rec.title}</span>
          <span className="tiny muted">
            {AREA_LABELS[rec.area]} · {SEVERITY_LABELS[rec.severity]} · antippen für Details
          </span>
        </span>
      </summary>
      <RecommendationItem rec={rec} />
    </details>
  );
}
