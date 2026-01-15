import { useEffect, useMemo } from 'react'
import type { PlayerComputed, SnapshotSummary, WindowKey } from '../data/types'
import { formatDate } from './format'

type FlyoutSource = 'baseStats' | 'statsPlus'

type IntervalRow = {
  startDate: string
  endDate: string
  days: number
  delta?: number | null
  perDay?: number | null
  missing?: boolean
}

type RankingIntervalsFlyoutProps = {
  open: boolean
  onClose: () => void
  player: PlayerComputed | null
  snapshots: SnapshotSummary[]
  windowKey: WindowKey
  source: FlyoutSource
}

const DAY_MS = 24 * 60 * 60 * 1000

const diffDays = (start: string, end: string) => {
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS)
  return Math.max(1, days)
}

const formatDelta = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  const rounded = Math.round(value)
  const formatted = Math.abs(rounded).toLocaleString('en-US')
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  return `${sign}${formatted}`
}

const formatValue = (value?: number | null, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return value.toFixed(digits)
}

const buildIntervalRows = (
  player: PlayerComputed | null,
  snapshots: SnapshotSummary[],
): IntervalRow[] => {
  if (!player || snapshots.length < 2) {
    return []
  }
  const pointByDate = new Map<string, (typeof player.points)[number]>()
  player.points.forEach((point) => {
    pointByDate.set(point.date, point)
    if (point.date.length >= 10) {
      pointByDate.set(point.date.slice(0, 10), point)
    }
  })

  const rows: IntervalRow[] = []
  for (let index = 1; index < snapshots.length; index += 1) {
    const startSnapshot = snapshots[index - 1]
    const endSnapshot = snapshots[index]
    const startPoint = pointByDate.get(startSnapshot.date)
    const endPoint = pointByDate.get(endSnapshot.date)
    const startDate = startPoint?.date ?? startSnapshot.date
    const endDate = endPoint?.date ?? endSnapshot.date
    const days = diffDays(startDate, endDate)
    if (!startPoint || !endPoint) {
      rows.push({
        startDate,
        endDate,
        days,
        missing: true,
      })
      continue
    }
    const delta = endPoint.baseStats - startPoint.baseStats
    rows.push({
      startDate,
      endDate,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return rows
}

export default function RankingIntervalsFlyout({
  open,
  onClose,
  player,
  snapshots,
  windowKey,
  source,
}: RankingIntervalsFlyoutProps) {
  useEffect(() => {
    if (!open) return undefined
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const rows = useMemo(() => buildIntervalRows(player, snapshots), [player, snapshots])
  const windowMetric = player?.windowMetrics.baseStats[windowKey] ?? null
  const sourceLabel = source === 'statsPlus' ? 'Stats +' : 'BaseStats/Day'

  if (!open) {
    return null
  }

  return (
    <div className="flyout-backdrop" onClick={onClose}>
      <div className="flyout-panel" onClick={(event) => event.stopPropagation()}>
        <div className="flyout-header">
          <div>
            <div className="flyout-title">{sourceLabel} intervals</div>
            <div className="flyout-subtitle">
              {player ? `${player.name} - ${player.server}` : 'No player selected'}
            </div>
          </div>
          <button type="button" className="btn ghost flyout-close" onClick={onClose}>
            Close
          </button>
        </div>

        {!player ? (
          <div className="empty">Select a player row to view intervals.</div>
        ) : (
          <>
            <div className="stat-grid flyout-summary">
              <div>
                <div className="stat-label">Window Delta</div>
                <div className="stat-value">{formatDelta(windowMetric?.delta)}</div>
              </div>
              <div>
                <div className="stat-label">Window / Day</div>
                <div className="stat-value">{formatValue(windowMetric?.perDay, 2)}</div>
              </div>
            </div>

            <table className="table flyout-table">
              <thead>
                <tr>
                  <th>Interval</th>
                  <th>Days</th>
                  <th>Delta</th>
                  <th>/ Day</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.startDate}-${row.endDate}`} className={row.missing ? 'flyout-row-missing' : undefined}>
                    <td>
                      {formatDate(row.startDate)} - {formatDate(row.endDate)}
                    </td>
                    <td>{row.missing ? '--' : row.days}</td>
                    <td>{formatDelta(row.delta)}</td>
                    <td>{formatValue(row.perDay, 2)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Not enough snapshots to build intervals.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
