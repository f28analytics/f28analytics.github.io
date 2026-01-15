import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { MetricKey } from '../data/types'
import { formatDate, formatNumber } from '../ui/format'

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'baseStats', label: 'BaseStats/Day' },
  { key: 'level', label: 'Level Delta' },
  { key: 'mine', label: 'Mine Delta' },
  { key: 'treasury', label: 'Treasury Delta' },
]

export default function Months() {
  const { result } = useData()
  const [metricKey, setMetricKey] = useState<MetricKey>('baseStats')

  const intervalRows = useMemo(() => {
    if (!result) return []
    return result.guilds.map((guild) => {
      const intervals = guild.intervalsByMetric?.[metricKey] ?? guild.intervals
      const rows = intervals.map((interval) => {
        const candidates = result.players
          .map((player) => {
            const match = player.intervals[metricKey].find(
              (entry) => entry.endDate === interval.endDate,
            )
            if (!match) return null
            const endPoint = player.points.find((point) => point.date === interval.endDate)
            if (endPoint?.guildKey !== guild.guildKey) return null
            return {
              playerKey: player.playerKey,
              name: player.name,
              perDay: match.perDay,
              delta: match.delta,
            }
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        const sorted = candidates.sort((a, b) =>
          metricKey === 'level' ? b.delta - a.delta : b.perDay - a.perDay,
        )
        return {
          interval,
          top: sorted[0],
          bottom: sorted[sorted.length - 1],
        }
      })
      return {
        guildKey: guild.guildKey,
        guildName: guild.guildName,
        rows,
      }
    })
  }, [result, metricKey])

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Months</h1>
        <div className="card">Load a dataset to view monthly intervals.</div>
      </div>
    )
  }

  if (result.snapshots.length < 2) {
    return (
      <div className="page">
        <h1 className="page-title">Months</h1>
        <div className="card">Need at least 2 snapshots for interval analysis.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Months</h1>
          <p className="page-subtitle">Interval analytics per guild and metric.</p>
        </div>
        <div className="tabs">
          {METRICS.map((metric) => (
            <button
              key={metric.key}
              className={`tab ${metricKey === metric.key ? 'active' : ''}`}
              onClick={() => setMetricKey(metric.key)}
            >
              {metric.label}
            </button>
          ))}
        </div>
      </div>

      {intervalRows.map((guild) => (
        <section key={guild.guildKey} className="card">
          <h2 className="card-title">{guild.guildName}</h2>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Interval</th>
                  <th>Guild Median</th>
                  <th>Top Player</th>
                  <th>Bottom Player</th>
                </tr>
              </thead>
              <tbody>
                {guild.rows.map((row) => (
                  <tr key={`${guild.guildKey}-${row.interval.endDate}`}>
                    <td>
                      {formatDate(row.interval.startDate)} - {formatDate(row.interval.endDate)}
                    </td>
                    <td>
                      {metricKey === 'level'
                        ? formatNumber(row.interval.delta, 0)
                        : `${formatNumber(row.interval.perDay, 2)} / day`}
                    </td>
                    <td>
                      {row.top
                        ? `${row.top.name} (${formatNumber(
                            metricKey === 'level' ? row.top.delta : row.top.perDay,
                            metricKey === 'level' ? 0 : 2,
                          )})`
                        : '-'}
                    </td>
                    <td>
                      {row.bottom
                        ? `${row.bottom.name} (${formatNumber(
                            metricKey === 'level' ? row.bottom.delta : row.bottom.perDay,
                            metricKey === 'level' ? 0 : 2,
                          )})`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
