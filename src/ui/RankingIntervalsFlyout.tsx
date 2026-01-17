import { useEffect, useMemo } from 'react'
import type { PlayerComputed, SnapshotSummary, WindowKey } from '../data/types'
import { formatDate } from './format'

type FlyoutSource = 'baseStats' | 'statsPlus' | 'level'

type IntervalRow = {
  startDate: string
  endDate: string
  days: number
  delta?: number | null
  perDay?: number | null
  endValue?: number | null
  endSource?: string | null
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

const formatPlainInt = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return Math.round(value).toLocaleString('en-US')
}

const buildIntervalRows = (
  player: PlayerComputed | null,
  snapshots: SnapshotSummary[],
  valueKey: 'baseStats' | 'level',
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
    const startValue = valueKey === 'level' ? startPoint.level : startPoint.baseStats
    const endValue = valueKey === 'level' ? endPoint.level : endPoint.baseStats
    const delta = endValue - startValue
    rows.push({
      startDate,
      endDate,
      days,
      delta,
      perDay: delta / days,
      endValue: valueKey === 'level' ? endValue : null,
      endSource: valueKey === 'level' ? endPoint.levelSource ?? null : null,
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

  const valueKey = source === 'level' ? 'level' : 'baseStats'
  const rows = useMemo(
    () => buildIntervalRows(player, snapshots, valueKey),
    [player, snapshots, valueKey],
  )
  const windowMetric =
    source === 'level'
      ? player?.windowMetrics.level[windowKey] ?? null
      : player?.windowMetrics.baseStats[windowKey] ?? null
  const sourceLabel =
    source === 'statsPlus' ? 'Stats +' : source === 'level' ? 'Level' : 'BaseStats/Day'
  const showLevel = source === 'level'
  const tableCols = showLevel ? 6 : 4

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
                  {showLevel ? <th>Level</th> : null}
                  {showLevel ? <th>Source</th> : null}
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
                    {showLevel ? <td>{formatPlainInt(row.endValue)}</td> : null}
                    {showLevel ? <td>{row.endSource ?? '--'}</td> : null}
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={tableCols} className="empty">
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
