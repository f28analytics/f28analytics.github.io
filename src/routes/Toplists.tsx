import { useEffect, useState } from 'react'
import { useData } from '../data/store'
import type { MetricKey, WindowKey } from '../data/types'
import { buildToplistCsv } from '../data/compute/csv'
import { formatNumber } from '../ui/format'

const WINDOW_KEYS: WindowKey[] = ['1', '3', '6', '12']
const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'baseStats', label: 'BaseStats/Day' },
  { key: 'level', label: 'Level Delta' },
  { key: 'mine', label: 'Mine Delta' },
  { key: 'treasury', label: 'Treasury Delta' },
]

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function Toplists() {
  const { result, defaultWindowKey, updateDefaultWindowKey } = useData()
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindowKey)
  const [metricKey, setMetricKey] = useState<MetricKey>('baseStats')

  useEffect(() => setWindowKey(defaultWindowKey), [defaultWindowKey])

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Toplists</h1>
        <div className="card">Load a dataset to see toplists.</div>
      </div>
    )
  }

  const entries = result.topMoversByMetric?.[metricKey]?.[windowKey] ?? []
  const metricLabel = METRICS.find((metric) => metric.key === metricKey)?.label ?? metricKey

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Toplists</h1>
          <p className="page-subtitle">Top performers by window and metric.</p>
        </div>
        <button
          className="btn"
          onClick={() =>
            downloadCsv(
              `toplist-${metricKey}-${windowKey}m-${result.datasetId}.csv`,
              buildToplistCsv(entries, metricLabel, windowKey),
            )
          }
        >
          Export Toplist CSV
        </button>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">{metricLabel}</h2>
          <div className="tabs">
            {WINDOW_KEYS.map((key) => (
              <button
                key={key}
                className={`tab ${windowKey === key ? 'active' : ''}`}
                onClick={() => {
                  setWindowKey(key)
                  updateDefaultWindowKey(key)
                }}
              >
                {key} mo
              </button>
            ))}
          </div>
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
        <div className="list">
          {entries.length === 0 && <div className="muted">No toplist data available.</div>}
          {entries.map((entry) => (
            <div key={`${metricKey}-${entry.playerKey}`} className="list-item">
              <div>
                <div className="list-title">{entry.name}</div>
                <div className="list-sub">{entry.guildKey ?? '-'}</div>
              </div>
              <div className="metric-inline">
                {metricKey === 'level'
                  ? `${formatNumber(entry.delta, 0)} delta`
                  : `${formatNumber(entry.perDay, 2)} / day`}
                <span className="muted">{formatNumber(entry.delta, 0)} total</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
