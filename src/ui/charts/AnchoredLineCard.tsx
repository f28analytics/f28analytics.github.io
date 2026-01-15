import { useMemo } from 'react'
import AnchoredLineChart from './AnchoredLineChart'

export type TrendSeries = {
  label: string
  unit?: string
  points: number[]
  subLabel?: string
}

type AnchoredLineCardProps = {
  title: string
  subtitle?: string
  badgeLabel?: string
  series: TrendSeries
  className?: string
  latestLabel?: string
  startLabel?: string
}

const formatNumber = (value?: number | null) =>
  value == null ? '-' : value.toLocaleString('de-DE')

export default function AnchoredLineCard({
  title,
  subtitle,
  badgeLabel = 'Line + Avg marker',
  series,
  className,
  latestLabel = 'Base Stats (latest)',
  startLabel = 'Server Ç~ marker',
}: AnchoredLineCardProps) {
  const { latest, start, delta, deltaPct, avg } = useMemo(() => {
    const pts = Array.isArray(series.points) ? series.points : []
    const latestVal = pts.length ? pts[pts.length - 1] : null
    const startVal = pts.length ? pts[0] : null
    const deltaVal = latestVal != null && startVal != null ? latestVal - startVal : null
    const deltaPctVal =
      deltaVal != null && startVal && Math.abs(startVal) > 0 ? (deltaVal / startVal) * 100 : null
    const avgVal = pts.length ? pts.reduce((sum, value) => sum + value, 0) / pts.length : null
    return { latest: latestVal, start: startVal, delta: deltaVal, deltaPct: deltaPctVal, avg: avgVal }
  }, [series.points])

  const deltaLabel =
    deltaPct != null
      ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
      : delta != null
        ? `${delta >= 0 ? '+' : ''}${delta.toLocaleString('de-DE')}`
        : '+0'
  const deltaValueLabel =
    delta != null ? `${delta >= 0 ? '+' : ''}${delta.toLocaleString('de-DE')}` : '-'

  return (
    <article className={`anchored-card ${className ?? ''}`.trim()}>
      <header className="anchored-card__header">
        <div>
          <div className="anchored-card__title">
            {title}
            {badgeLabel && <span className="anchored-card__badge">{badgeLabel}</span>}
          </div>
          {subtitle && <div className="anchored-card__subtitle">{subtitle}</div>}
        </div>
        <div className="anchored-card__delta anchored-card__delta--up" aria-label="Delta">
          {deltaLabel}
        </div>
      </header>

      <div className="anchored-card__chart">
        <AnchoredLineChart points={series.points} avgValue={avg} showAvg showDots showFill showXLabels />
      </div>

      <footer className="anchored-card__footer">
        <div className="anchored-card__kpis">
          <div className="anchored-card__kpi">
            <strong>{formatNumber(latest)}</strong>
            <span>{latestLabel}</span>
          </div>
          <div className="anchored-card__kpi">
            <strong>{formatNumber(start)}</strong>
            <span>{startLabel}</span>
          </div>
          <div className="anchored-card__pill anchored-card__pill--up">{deltaValueLabel}</div>
        </div>
        <div className="anchored-card__legend">
          <span>
            <span className="anchored-card__dot" /> Player
          </span>
          <span>
            <span className="anchored-card__dot anchored-card__dot--muted" /> Average marker
          </span>
        </div>
      </footer>
    </article>
  )
}
