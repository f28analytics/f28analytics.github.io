import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../data/store'
import AnchoredLineCard from '../ui/charts/AnchoredLineCard'
import { formatDate, formatNumber } from '../ui/format'

export default function PlayerDetail() {
  const { playerKey } = useParams()
  const navigate = useNavigate()
  const { result } = useData()
  const decodedKey = playerKey ? decodeURIComponent(playerKey) : ''

  const player = useMemo(() => {
    if (!result) return null
    const source = result.globalPlayers?.length ? result.globalPlayers : result.players
    return source.find((entry) => entry.playerKey === decodedKey) ?? null
  }, [result, decodedKey])

  if (!result || !player) {
    return (
      <div className="page">
        <h1 className="page-title">Player Detail</h1>
        <div className="card">
          Player not found. Select a player from the ranking table.
          <button className="btn ghost" onClick={() => navigate('/ranking')}>
            Back to Ranking
          </button>
        </div>
      </div>
    )
  }

  const firstPoint = player.points[0]
  const lastPoint = player.points[player.points.length - 1]
  const { chartPoints, rangeLabel } = useMemo(() => {
    if (!player.points.length) {
      return { chartPoints: [], rangeLabel: 'Full history' }
    }
    const endDate = new Date(player.points[player.points.length - 1].date)
    const startDate = new Date(endDate)
    startDate.setMonth(startDate.getMonth() - 12)
    const filtered = player.points.filter((point) => new Date(point.date) >= startDate)
    const useWindow = filtered.length >= 2
    return {
      chartPoints: useWindow ? filtered : player.points,
      rangeLabel: useWindow ? 'Last 12 months' : 'Full history',
    }
  }, [player.points])
  const expSeries = useMemo(
    () => chartPoints.map((point) => point.expTotal ?? 0),
    [chartPoints],
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{player.name}</h1>
          <p className="page-subtitle">
            {player.server} - {player.latestGuildName ?? player.latestGuildKey ?? '-'}
          </p>
        </div>
        <button className="btn ghost" onClick={() => navigate('/ranking')}>
          Back to Ranking
        </button>
      </div>

      <section className="grid three-col">
        <div className="card">
          <h2 className="card-title">BaseStats/Day (Year)</h2>
          <div className="metric">{formatNumber(player.baseStatsPerDayYear, 1)}</div>
          <div className="muted">
            Best: {formatNumber(player.bestInterval?.perDay ?? 0, 1)} - Worst:{' '}
            {formatNumber(player.worstInterval?.perDay ?? 0, 1)}
          </div>
        </div>
        <div className="card">
          <h2 className="card-title">Coverage</h2>
          <div className="metric">
            {player.coverage.points} pts - {player.coverage.days}d
          </div>
          <div className="muted">
            {formatDate(firstPoint?.date)} to {formatDate(lastPoint?.date)}
          </div>
        </div>
        <div className="card">
          <h2 className="card-title">Recommendation</h2>
          <div className="metric">{player.recommendation}</div>
          <div className="muted">Score {formatNumber(player.score, 3)}</div>
        </div>
      </section>

      <section className="grid three-col">
        <AnchoredLineCard
          title="BaseStats Verlauf"
          subtitle={rangeLabel}
          series={{
            label: 'BaseStats',
            points: chartPoints.map((point) => point.baseStats),
          }}
          latestLabel="BaseStats (latest)"
          startLabel="BaseStats (start)"
        />
        <AnchoredLineCard
          title="Level Verlauf"
          subtitle={rangeLabel}
          series={{
            label: 'Level',
            points: chartPoints.map((point) => point.level),
          }}
          latestLabel="Level (latest)"
          startLabel="Level (start)"
        />
        <AnchoredLineCard
          title="Mine Verlauf"
          subtitle={rangeLabel}
          series={{
            label: 'Mine',
            points: chartPoints.map((point) => point.mine),
          }}
          latestLabel="Mine (latest)"
          startLabel="Mine (start)"
        />
        <AnchoredLineCard
          title="Treasury Verlauf"
          subtitle={rangeLabel}
          series={{
            label: 'Treasury',
            points: chartPoints.map((point) => point.treasury),
          }}
          latestLabel="Treasury (latest)"
          startLabel="Treasury (start)"
        />
        <AnchoredLineCard
          title="Exp Verlauf"
          subtitle={rangeLabel}
          series={{
            label: 'Exp',
            points: expSeries,
          }}
          latestLabel="Exp (latest)"
          startLabel="Exp (start)"
        />
      </section>
    </div>
  )
}
