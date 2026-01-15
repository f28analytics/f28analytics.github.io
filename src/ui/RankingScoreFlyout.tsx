import { useEffect, useMemo } from 'react'
import type { PlayerComputed, WindowKey } from '../data/types'
import { formatDate, formatNumber } from './format'

type RankingScoreFlyoutProps = {
  open: boolean
  onClose: () => void
  player: PlayerComputed | null
}

const WINDOW_ORDER: WindowKey[] = ['1', '3', '6', '12']

const formatScoreValue = (value?: number) => (typeof value === 'number' ? formatNumber(value, 3) : '--')

export default function RankingScoreFlyout({ open, onClose, player }: RankingScoreFlyoutProps) {
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
