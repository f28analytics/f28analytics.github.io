import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { WindowKey } from '../data/types'
import {
  buildGuildSummaryCsv,
  buildMarkdownReport,
  buildRankingCsv,
  buildRecommendationCsv,
} from '../data/compute/csv'

const WINDOW_KEYS: WindowKey[] = ['1', '3', '6', '12']

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function ExportPage() {
  const { result, defaultWindowKey, updateDefaultWindowKey } = useData()
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindowKey)
  const report = useMemo(() => (result ? buildMarkdownReport(result) : ''), [result])

  useEffect(() => setWindowKey(defaultWindowKey), [defaultWindowKey])

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Export</h1>
        <div className="card">Load a dataset to export CSVs and reports.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Export</h1>
          <p className="page-subtitle">CSV exports for Main/Wing and full rankings.</p>
        </div>
      </div>

      <section className="grid two-col">
        <div className="card">
          <h2 className="card-title">Recommendation Lists</h2>
          <button
            className="btn"
            onClick={() =>
              downloadCsv(
                `main-recommendations-${result.datasetId}.csv`,
                buildRecommendationCsv(result.players, 'Main'),
              )
            }
          >
            Export Main List
          </button>
          <button
            className="btn"
            onClick={() =>
              downloadCsv(
                `wing-recommendations-${result.datasetId}.csv`,
                buildRecommendationCsv(result.players, 'Wing'),
              )
            }
          >
            Export Wing List
          </button>
        </div>
        <div className="card">
          <h2 className="card-title">Full Ranking</h2>
          <label className="filter">
            <span>Window</span>
            <select
              className="select"
              value={windowKey}
              onChange={(event) => {
                const value = event.target.value as WindowKey
                setWindowKey(value)
                updateDefaultWindowKey(value)
              }}
            >
              {WINDOW_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key} mo
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            onClick={() =>
              downloadCsv(
                `ranking-${windowKey}m-${result.datasetId}.csv`,
                buildRankingCsv(result.players, windowKey),
              )
            }
          >
            Export Ranking CSV
          </button>
        </div>
        <div className="card">
          <h2 className="card-title">Guild Summary</h2>
          <button
            className="btn"
            onClick={() =>
              downloadCsv(
                `guild-summary-${result.datasetId}.csv`,
                buildGuildSummaryCsv(result),
              )
            }
          >
            Export Guild Summary
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Markdown Report</h2>
        <textarea className="report-box" value={report} readOnly />
        <button
          className="btn ghost"
          onClick={() => navigator.clipboard?.writeText(report)}
        >
          Copy Report
        </button>
      </section>
    </div>
  )
}
