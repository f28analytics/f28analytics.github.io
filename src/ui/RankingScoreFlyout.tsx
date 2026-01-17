import { useEffect, useMemo } from 'react'
import type { PlayerComputed, WindowKey } from '../data/types'
import { formatDate, formatNumber } from './format'

type RankingScoreFlyoutProps = {
  open: boolean
  onClose: () => void
  player: PlayerComputed | null
  windowKey: WindowKey | string
}

const WINDOW_ORDER: WindowKey[] = ['1', '3', '6', '12']

const formatScoreValue = (value?: number) => (typeof value === 'number' ? formatNumber(value, 3) : '--')
const formatMaybe = (value?: number | null, digits = 3) =>
  typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, digits) : '--'
const formatBool = (value?: boolean) => (value === undefined ? '--' : value ? 'Yes' : 'No')
const normalizeWindowKey = (value: WindowKey | string | null | undefined): WindowKey | null => {
  if (!value) {
    return null
  }
  const match = `${value}`.match(/\d+/)
  if (!match) {
    return null
  }
  const key = match[0]
  if (key === '1' || key === '3' || key === '6' || key === '12') {
    return key
  }
  return null
}

export default function RankingScoreFlyout({
  open,
  onClose,
  player,
  windowKey,
}: RankingScoreFlyoutProps) {
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

  const timeline = useMemo(() => player?.scoreTimeline ?? [], [player])
  const normalizedWindowKey = normalizeWindowKey(windowKey)
  const breakdownMap =
    player?.scoreBreakdownByWindow ?? player?.scoreDebugByWindow
  const breakdown = normalizedWindowKey ? breakdownMap?.[normalizedWindowKey] : undefined
  const breakdownKeys = breakdownMap ? Object.keys(breakdownMap).sort() : []
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard)

  if (!open) {
    return null
  }

  return (
    <div className="flyout-backdrop" onClick={onClose}>
      <div className="flyout-panel" onClick={(event) => event.stopPropagation()}>
        <div className="flyout-header">
          <div>
            <div className="flyout-title">Score</div>
            <div className="flyout-subtitle">
              {player ? `${player.name} - ${player.server}` : 'Select a player row to view Score history'}
            </div>
          </div>
          <button type="button" className="btn ghost flyout-close" onClick={onClose}>
            Close
          </button>
        </div>

        {!player ? (
          <div className="empty">Select a player row to view Score history.</div>
        ) : (
          <>
            <div className="stat-grid flyout-summary">
              {WINDOW_ORDER.map((windowKey) => (
                <div key={`score-${windowKey}`}>
                  <div className="stat-label">{`${windowKey} mo`}</div>
                  <div className="stat-value">{formatScoreValue(player.scoreByWindow?.[windowKey])}</div>
                </div>
              ))}
            </div>
            <section className="card">
              <div className="card-header">
                <div className="card-title">Score Breakdown</div>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!breakdown || !canCopy}
                  onClick={() => {
                    if (!breakdown || !canCopy) return
                    navigator.clipboard.writeText(JSON.stringify(breakdown, null, 2))
                  }}
                >
                  Copy breakdown JSON
                </button>
              </div>
              {!breakdown ? (
                <div className="empty">
                  No breakdown available.
                  {breakdownKeys.length ? ` Available breakdown keys: ${breakdownKeys.join(', ')}` : ''}
                </div>
              ) : (
                <>
                  <div className="stat-grid">
                    <div>
                      <div className="stat-label">Window</div>
                      <div className="stat-value">
                        {normalizedWindowKey ? `${normalizedWindowKey} mo` : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">Score Final</div>
                      <div className="stat-value">{formatMaybe(breakdown.final.scoreFinal)}</div>
                    </div>
                  </div>
                  <table className="table flyout-table">
                    <thead>
                      <tr>
                        <th>Final</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>scoreRaw</td>
                        <td>{formatMaybe(breakdown.final.scoreRaw)}</td>
                      </tr>
                      <tr>
                        <td>coverageFactor</td>
                        <td>{formatMaybe(breakdown.final.coverageFactor)}</td>
                      </tr>
                      <tr>
                        <td>levelPenalty</td>
                        <td>{formatMaybe(breakdown.final.levelPenalty)}</td>
                      </tr>
                      <tr>
                        <td>scoreAfterLevelPenalty</td>
                        <td>{formatMaybe(breakdown.final.scoreAfterLevelPenalty)}</td>
                      </tr>
                      <tr>
                        <td>scoreFinal</td>
                        <td>{formatMaybe(breakdown.final.scoreFinal)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table className="table flyout-table">
                    <thead>
                      <tr>
                        <th>Weights</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>wGrowth</td>
                        <td>{formatMaybe(breakdown.weights.wGrowth)}</td>
                      </tr>
                      <tr>
                        <td>wConsistency</td>
                        <td>{formatMaybe(breakdown.weights.wConsistency)}</td>
                      </tr>
                      <tr>
                        <td>levelPenaltyMax</td>
                        <td>{formatMaybe(breakdown.weights.levelPenaltyMax)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table className="table flyout-table">
                    <thead>
                      <tr>
                        <th>Growth (Ref: ServerAvg)</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>absPerDay</td>
                        <td>{formatMaybe(breakdown.growth.absPerDay)}</td>
                      </tr>
                      <tr>
                        <td>serverAvgAbsPerDay (ref)</td>
                        <td>{formatMaybe(breakdown.growth.serverAvgAbsPerDay)}</td>
                      </tr>
                      <tr>
                        <td>absVsServerAvg (ref)</td>
                        <td>{formatMaybe(breakdown.growth.absVsServerAvg)}</td>
                      </tr>
                      <tr>
                        <td>top100AvgAbsPerDay (info)</td>
                        <td>{formatMaybe(breakdown.growth.top100AvgAbsPerDay)}</td>
                      </tr>
                      <tr>
                        <td>absVsTop100 (info)</td>
                        <td>{formatMaybe(breakdown.growth.absVsTop100)}</td>
                      </tr>
                      <tr>
                        <td>guildRefType (info)</td>
                        <td>{breakdown.growth.guildRefType}</td>
                      </tr>
                      <tr>
                        <td>guildRefKey (info)</td>
                        <td>{breakdown.growth.guildRefKey ?? '--'}</td>
                      </tr>
                      <tr>
                        <td>guildAvgAbsPerDay (info)</td>
                        <td>{formatMaybe(breakdown.growth.guildAvgAbsPerDay)}</td>
                      </tr>
                      <tr>
                        <td>absVsGuild (info)</td>
                        <td>{formatMaybe(breakdown.growth.absVsGuild)}</td>
                      </tr>
                      <tr>
                        <td>absN_server</td>
                        <td>{formatMaybe(breakdown.growth.absN_server)}</td>
                      </tr>
                      <tr>
                        <td>absN_guild (info)</td>
                        <td>{formatMaybe(breakdown.growth.absN_guild)}</td>
                      </tr>
                      <tr>
                        <td>absN</td>
                        <td>{formatMaybe(breakdown.growth.absN)}</td>
                      </tr>
                      <tr>
                        <td>growth</td>
                        <td>{formatMaybe(breakdown.growth.growth)}</td>
                      </tr>
                      <tr>
                        <td>relPerDay</td>
                        <td>{formatMaybe(breakdown.growth.relPerDay)}</td>
                      </tr>
                      <tr>
                        <td>relVsGuild (info)</td>
                        <td>{formatMaybe(breakdown.growth.relVsGuild ?? null)}</td>
                      </tr>
                      <tr>
                        <td>relN</td>
                        <td>{formatMaybe(breakdown.growth.relN)}</td>
                      </tr>
                      <tr>
                        <td>momRatio</td>
                        <td>{formatMaybe(breakdown.growth.momRatio)}</td>
                      </tr>
                      <tr>
                        <td>momN</td>
                        <td>{formatMaybe(breakdown.growth.momN)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table className="table flyout-table">
                    <thead>
                      <tr>
                        <th>Consistency (Ref: ServerAvg)</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>aboveShare</td>
                        <td>{formatMaybe(breakdown.consistency.aboveShare)}</td>
                      </tr>
                      <tr>
                        <td>gap</td>
                        <td>{formatMaybe(breakdown.consistency.gap)}</td>
                      </tr>
                      <tr>
                        <td>closeness</td>
                        <td>{formatMaybe(breakdown.consistency.closeness)}</td>
                      </tr>
                      <tr>
                        <td>mad</td>
                        <td>{formatMaybe(breakdown.consistency.mad ?? null)}</td>
                      </tr>
                      <tr>
                        <td>stability</td>
                        <td>{formatMaybe(breakdown.consistency.stability)}</td>
                      </tr>
                      <tr>
                        <td>consBase</td>
                        <td>{formatMaybe(breakdown.consistency.consBase)}</td>
                      </tr>
                      <tr>
                        <td>consistency</td>
                        <td>{formatMaybe(breakdown.consistency.consistency)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table className="table flyout-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>levelDelta</td>
                        <td>{formatMaybe(breakdown.level.levelDelta)}</td>
                      </tr>
                      <tr>
                        <td>windowDays</td>
                        <td>{formatMaybe(breakdown.level.windowDays)}</td>
                      </tr>
                      <tr>
                        <td>levelPer30</td>
                        <td>{formatMaybe(breakdown.level.levelPer30)}</td>
                      </tr>
                      <tr>
                        <td>lowLeveling</td>
                        <td>{formatBool(breakdown.level.lowLeveling)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </section>
            <table className="table flyout-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {timeline.length ? (
                  timeline.map((entry) => (
                    <tr key={`score-${entry.date}`}>
                      <td>{formatDate(entry.date)}</td>
                      <td>{formatScoreValue(entry.score)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="empty">
                      Not enough data to build a Score timeline.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
