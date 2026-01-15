import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/store'
import type {
  MetricKey,
  IntervalMetric,
  WindowKey,
  GuildSeriesPoint,
  PlayerComputed,
  PlayerWindowEntry,
} from '../data/types'
import { formatDate, formatNumber } from '../ui/format'

const WINDOW_KEYS: WindowKey[] = ['1', '3', '6', '12']
const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'baseStats', label: 'BaseStats/Day' },
  { key: 'level', label: 'Level Delta' },
  { key: 'mine', label: 'Mine Delta' },
  { key: 'treasury', label: 'Treasury Delta' },
]

const MEMBERLIST_COLUMNS_KEY = 'ga:memberlistColumns'
const MEMBERLIST_CARD_NAMES_KEY = 'ga:memberlistCardNames'
const MEMBERLIST_COLUMNS = ['col-1', 'col-2', 'col-3'] as const
const GUILD_CARD_COLUMNS = ['col-2', 'col-3'] as const
type MemberlistColumn = (typeof MEMBERLIST_COLUMNS)[number]
type GuildCardColumn = (typeof GUILD_CARD_COLUMNS)[number]

type DashboardGuild = {
  guildKey: string
  guildName: string
  points: GuildSeriesPoint[]
  intervals: IntervalMetric[]
  intervalsByMetric: Record<MetricKey, IntervalMetric[]>
  baseStatsPerDayYear: number
  minePerDayYear: number
  treasuryPerDayYear: number
  levelMedianLatest: number
  baseStatsMedianLatest: number
  mineMedianLatest: number
  treasuryMedianLatest: number
}

const emptyColumns = (): Record<MemberlistColumn, string[]> => ({
  'col-1': [],
  'col-2': [],
  'col-3': [],
})

const emptyCardNames = (): Record<GuildCardColumn, string> => ({
  'col-2': '',
  'col-3': '',
})

const readStoredColumns = (): Record<MemberlistColumn, string[]> => {
  if (typeof window === 'undefined') {
    return emptyColumns()
  }
  try {
    const raw = window.localStorage.getItem(MEMBERLIST_COLUMNS_KEY)
    if (!raw) {
      return emptyColumns()
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next = emptyColumns()
    MEMBERLIST_COLUMNS.forEach((key) => {
      const value = parsed[key]
      if (Array.isArray(value)) {
        next[key] = value.filter((entry): entry is string => typeof entry === 'string')
      }
    })
    return next
  } catch {
    return emptyColumns()
  }
}

const readStoredCardNames = (): Record<GuildCardColumn, string> => {
  if (typeof window === 'undefined') {
    return emptyCardNames()
  }
  try {
    const raw = window.localStorage.getItem(MEMBERLIST_CARD_NAMES_KEY)
    if (!raw) {
      return emptyCardNames()
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next = emptyCardNames()
    GUILD_CARD_COLUMNS.forEach((key) => {
      const value = parsed[key]
      if (typeof value === 'string') {
        next[key] = value
      }
    })
    return next
  } catch {
    return emptyCardNames()
  }
}

const buildLegacyKeyMap = (players: PlayerComputed[]) => {
  const keyMap = new Map<string, string>()
  const conflicts = new Set<string>()
  players.forEach((player) => {
    const legacyKeys: string[] = []
    if (player.playerId) {
      legacyKeys.push(player.playerId.toString())
    }
    if (player.name && player.server) {
      legacyKeys.push(`${player.name}|${player.server}`)
    }
    legacyKeys.forEach((legacyKey) => {
      const existing = keyMap.get(legacyKey)
      if (existing && existing !== player.playerKey) {
        conflicts.add(legacyKey)
      } else {
        keyMap.set(legacyKey, player.playerKey)
      }
    })
  })
  return { keyMap, conflicts }
}

const migrateKeys = (keys: string[], keyMap: Map<string, string>, conflicts: Set<string>) =>
  keys.map((key) => {
    if (conflicts.has(key)) {
      return key
    }
    return keyMap.get(key) ?? key
  })

const buildCardColumns = (players: PlayerComputed[]) => {
  const columns = readStoredColumns()
  if (!players.length) {
    return columns
  }
  const { keyMap, conflicts } = buildLegacyKeyMap(players)
  return {
    'col-1': migrateKeys(columns['col-1'], keyMap, conflicts),
    'col-2': migrateKeys(columns['col-2'], keyMap, conflicts),
    'col-3': migrateKeys(columns['col-3'], keyMap, conflicts),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

const toDate = (value: string) => new Date(value)

const diffDays = (start: string, end: string) => {
  const days = Math.round((toDate(end).getTime() - toDate(start).getTime()) / DAY_MS)
  return Math.max(1, days)
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const median = (values: number[]) => {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

const weightedPerDay = (intervals: IntervalMetric[]) => {
  const totalDays = intervals.reduce((sum, interval) => sum + interval.days, 0)
  const totalDelta = intervals.reduce((sum, interval) => sum + interval.delta, 0)
  return totalDays > 0 ? totalDelta / totalDays : 0
}

const buildGuildIntervals = (points: GuildSeriesPoint[]): IntervalMetric[] => {
  const intervals: IntervalMetric[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const delta = end.baseStatsMedian - start.baseStatsMedian
    const days = diffDays(start.date, end.date)
    intervals.push({
      startDate: start.date,
      endDate: end.date,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return intervals
}

const buildGuildMetricIntervals = (
  points: GuildSeriesPoint[],
  selector: (point: GuildSeriesPoint) => number,
): IntervalMetric[] => {
  const intervals: IntervalMetric[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const delta = selector(end) - selector(start)
    const days = diffDays(start.date, end.date)
    intervals.push({
      startDate: start.date,
      endDate: end.date,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return intervals
}

const buildCardGuild = (
  cardKey: string,
  cardName: string,
  playerKeys: string[],
  players: PlayerComputed[],
): DashboardGuild => {
  const keySet = new Set(playerKeys)
  const dateBuckets = new Map<
    string,
    { baseStats: number[]; level: number[]; mine: number[]; treasury: number[] }
  >()

  players.forEach((player) => {
    if (!keySet.has(player.playerKey)) {
      return
    }
    player.points.forEach((point) => {
      const entry =
        dateBuckets.get(point.date) ?? {
          baseStats: [],
          level: [],
          mine: [],
          treasury: [],
        }
      entry.baseStats.push(point.baseStats)
      entry.level.push(point.level)
      entry.mine.push(point.mine)
      entry.treasury.push(point.treasury)
      dateBuckets.set(point.date, entry)
    })
  })

  const points = Array.from(dateBuckets.entries())
    .map(([date, stats]) => ({
      date,
      memberCount: stats.baseStats.length,
      baseStatsMedian: median(stats.baseStats),
      baseStatsAvg: average(stats.baseStats),
      levelMedian: median(stats.level),
      levelAvg: average(stats.level),
      mineMedian: median(stats.mine),
      mineAvg: average(stats.mine),
      treasuryMedian: median(stats.treasury),
      treasuryAvg: average(stats.treasury),
    }))
    .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())

  const intervals = buildGuildIntervals(points)
  const levelIntervals = buildGuildMetricIntervals(points, (point) => point.levelMedian)
  const mineIntervals = buildGuildMetricIntervals(points, (point) => point.mineMedian)
  const treasuryIntervals = buildGuildMetricIntervals(points, (point) => point.treasuryMedian)

  const baseStatsPerDayYear = weightedPerDay(intervals)
  const minePerDayYear = weightedPerDay(mineIntervals)
  const treasuryPerDayYear = weightedPerDay(treasuryIntervals)
  const lastPoint = points[points.length - 1]

  return {
    guildKey: cardKey,
    guildName: cardName,
    points,
    intervals,
    intervalsByMetric: {
      baseStats: intervals,
      level: levelIntervals,
      mine: mineIntervals,
      treasury: treasuryIntervals,
    },
    baseStatsPerDayYear,
    minePerDayYear,
    treasuryPerDayYear,
    levelMedianLatest: lastPoint?.levelMedian ?? 0,
    baseStatsMedianLatest: lastPoint?.baseStatsMedian ?? 0,
    mineMedianLatest: lastPoint?.mineMedian ?? 0,
    treasuryMedianLatest: lastPoint?.treasuryMedian ?? 0,
  }
}

const buildRecommendationMap = (players: PlayerComputed[]) => {
  const recommendations = new Map<string, PlayerComputed['recommendation']>()
  if (!players.length) {
    return recommendations
  }
  const sortedByScore = [...players].sort((a, b) => b.score - a.score)
  const mainSet = new Set(sortedByScore.slice(0, 50).map((player) => player.playerKey))
  const wingSet = new Set(sortedByScore.slice(50, 100).map((player) => player.playerKey))
  players.forEach((player) => {
    if (mainSet.has(player.playerKey)) {
      recommendations.set(player.playerKey, 'Main')
    } else if (wingSet.has(player.playerKey)) {
      recommendations.set(player.playerKey, 'Wing')
    } else {
      recommendations.set(player.playerKey, 'None')
    }
  })
  return recommendations
}

const emptyTopMoversByMetric = () =>
  METRICS.reduce<Record<MetricKey, Record<WindowKey, PlayerWindowEntry[]>>>(
    (acc, metric) => {
      acc[metric.key] = { '1': [], '3': [], '6': [], '12': [] }
      return acc
    },
    {
      baseStats: { '1': [], '3': [], '6': [], '12': [] },
      level: { '1': [], '3': [], '6': [], '12': [] },
      mine: { '1': [], '3': [], '6': [], '12': [] },
      treasury: { '1': [], '3': [], '6': [], '12': [] },
    },
  )

const buildTopMoversByMetric = (players: PlayerComputed[]) => {
  const topMoversByMetric = emptyTopMoversByMetric()
  if (!players.length) {
    return topMoversByMetric
  }
  const metricValueForSort = (metric: MetricKey, entry: { perDay: number; delta: number }) =>
    metric === 'level' ? entry.delta : entry.perDay

  METRICS.forEach((metric) => {
    WINDOW_KEYS.forEach((windowKey) => {
      const entries = players
        .map((player): PlayerWindowEntry | null => {
          const metricWindow = player.windowMetrics[metric.key][windowKey]
          if (!metricWindow) {
            return null
          }
          return {
            playerKey: player.playerKey,
            name: player.name,
            guildKey: player.latestGuildKey ?? undefined,
            metric: metric.key,
            perDay: metricWindow.perDay,
            delta: metricWindow.delta,
          }
        })
        .filter((entry): entry is PlayerWindowEntry => entry !== null)
        .sort(
          (a, b) =>
            metricValueForSort(metric.key, b) - metricValueForSort(metric.key, a),
        )
        .slice(0, 5)
      topMoversByMetric[metric.key][windowKey] = entries
    })
  })
  return topMoversByMetric
}

const getIntervalSummary = (intervals: IntervalMetric[]) => {
  const sorted = [...intervals].sort((a, b) => b.perDay - a.perDay)
  return {
    good: sorted.slice(0, 3),
    bad: [...sorted].reverse().slice(0, 3),
  }
}

export default function Dashboard() {
  const { result, defaultWindowKey, updateDefaultWindowKey } = useData()
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindowKey)
  const [metricKey, setMetricKey] = useState<MetricKey>('baseStats')

  useEffect(() => setWindowKey(defaultWindowKey), [defaultWindowKey])

  const allPlayers = useMemo(
    () => result?.globalPlayers ?? result?.players ?? [],
    [result],
  )
  const cardColumns = useMemo(() => buildCardColumns(allPlayers), [allPlayers])
  const cardNames = useMemo(() => readStoredCardNames(), [result])
  const cardLabels = useMemo(
    () => ({
      'col-2': cardNames['col-2'].trim() || 'Guild Card 1',
      'col-3': cardNames['col-3'].trim() || 'Guild Card 2',
    }),
    [cardNames],
  )
  const cardPlayerKeySet = useMemo(
    () => new Set([...cardColumns['col-2'], ...cardColumns['col-3']]),
    [cardColumns],
  )
  const cardPlayers = useMemo(
    () => allPlayers.filter((player) => cardPlayerKeySet.has(player.playerKey)),
    [allPlayers, cardPlayerKeySet],
  )
  const cardGuilds = useMemo(() => {
    if (!allPlayers.length) {
      return []
    }
    return GUILD_CARD_COLUMNS.map((columnKey) => ({
      key: columnKey,
      label: cardLabels[columnKey],
      playerKeys: cardColumns[columnKey] ?? [],
    }))
      .filter((card) => card.label.trim().length > 0 || card.playerKeys.length > 0)
      .map((card) => buildCardGuild(card.key, card.label, card.playerKeys, allPlayers))
  }, [allPlayers, cardColumns, cardLabels])

  const cardPlayerCount = useMemo(() => {
    if (!cardPlayers.length) {
      return 0
    }
    return cardPlayers.length
  }, [cardPlayers])
  const cardRecommendations = useMemo(
    () => buildRecommendationMap(cardPlayers),
    [cardPlayers],
  )
  const topMoversByMetric = useMemo(
    () => buildTopMoversByMetric(cardPlayers),
    [cardPlayers],
  )

  const rangeSummary = useMemo(() => {
    if (!result) {
      return 'No dataset loaded.'
    }
    return `${formatDate(result.rangeStart)} -> ${formatDate(result.latestDate)} - ${
      result.snapshots.length
    } snapshots`
  }, [result])

  const selectedGuildLabel = useMemo(() => {
    if (!result) return '-'
    const names = cardGuilds.map((guild) => guild.guildName)
    return names.length ? names.join(', ') : 'No guild cards'
  }, [result, cardGuilds])

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Dashboard</h1>
        <div className="card">
          Load a dataset in the Import tab to unlock analytics and rankings.
        </div>
      </div>
    )
  }

  const hasIntervals = result.snapshots.length > 1
  const compareGuilds = cardGuilds.slice(0, 2)
  const topMoversMetric = topMoversByMetric?.[metricKey]?.[windowKey] ?? []
  const mainCount = Array.from(cardRecommendations.values()).filter(
    (value) => value === 'Main',
  ).length
  const wingCount = Array.from(cardRecommendations.values()).filter(
    (value) => value === 'Wing',
  ).length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{rangeSummary}</p>
        </div>
      </div>

      <section className="grid three-col">
        <div className="card">
          <h2 className="card-title">Scan Health</h2>
          <div className="metric">{formatDate(result.latestDate)}</div>
          <div className="muted">
            {result.snapshots.length} scans - {selectedGuildLabel}
          </div>
        </div>
        <div className="card">
          <h2 className="card-title">Coverage</h2>
          <div className="metric">{cardPlayerCount} players</div>
          <div className="muted">{cardGuilds.length} guild cards selected</div>
        </div>
        <div className="card">
          <h2 className="card-title">Main / Wing Split</h2>
          <div className="metric">{mainCount} Main</div>
          <div className="muted">{wingCount} Wing</div>
        </div>
      </section>

      <section className="grid two-col">
        {cardGuilds.map((guild) => {
          const baseIntervals = guild.intervalsByMetric?.baseStats ?? []
          const levelIntervals = guild.intervalsByMetric?.level ?? []
          const lastBaseInterval = baseIntervals[baseIntervals.length - 1]
          const lastLevelInterval = levelIntervals[levelIntervals.length - 1]
          return (
            <div key={guild.guildKey} className="card">
              <h2 className="card-title">{guild.guildName}</h2>
              <div className="stat-grid">
                <div>
                  <div className="stat-label">BaseStats/Day Median</div>
                  <div className="stat-value">{formatNumber(guild.baseStatsPerDayYear, 1)}</div>
                  <div className="muted">
                    Last interval {formatNumber(lastBaseInterval?.perDay ?? 0, 1)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Level Median</div>
                  <div className="stat-value">{formatNumber(guild.levelMedianLatest, 0)}</div>
                  <div className="muted">
                    Delta {formatNumber(lastLevelInterval?.delta ?? 0, 0)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Mine Pace</div>
                  <div className="stat-value">{formatNumber(guild.minePerDayYear, 2)}</div>
                </div>
                <div>
                  <div className="stat-label">Treasury Pace</div>
                  <div className="stat-value">{formatNumber(guild.treasuryPerDayYear, 2)}</div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {compareGuilds.length === 2 && (
        <section className="card">
          <h2 className="card-title">Guild Compare</h2>
          <div className="compare-grid">
            {compareGuilds.map((guild) => (
              <div key={guild.guildKey} className="compare-card">
                <div className="compare-title">{guild.guildName}</div>
                <div className="compare-row">
                  <span>BaseStats/Day</span>
                  <span>{formatNumber(guild.baseStatsPerDayYear, 1)}</span>
                </div>
                <div className="compare-row">
                  <span>Level Median</span>
                  <span>{formatNumber(guild.levelMedianLatest, 0)}</span>
                </div>
                <div className="compare-row">
                  <span>Mine Pace</span>
                  <span>{formatNumber(guild.minePerDayYear, 2)}</span>
                </div>
                <div className="compare-row">
                  <span>Treasury Pace</span>
                  <span>{formatNumber(guild.treasuryPerDayYear, 2)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid two-col">
        {cardGuilds.map((guild) => {
          const intervals = guild.intervalsByMetric?.[metricKey] ?? guild.intervals
          const summary = getIntervalSummary(intervals)
          return (
            <div key={`${guild.guildKey}-${metricKey}`} className="card">
              <div className="card-header">
                <h2 className="card-title">Good / Bad Months - {guild.guildName}</h2>
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
              {!hasIntervals && (
                <div className="muted">Need at least 2 snapshots for interval analysis.</div>
              )}
              {hasIntervals && (
                <div className="interval-grid">
                  <div>
                    <div className="interval-title">Top 3</div>
                    {summary.good.map((interval) => (
                      <div key={`${interval.startDate}-${interval.endDate}`} className="interval-item">
                        <span>{formatDate(interval.endDate)}</span>
                        <span>{formatNumber(interval.perDay, 2)} / day</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="interval-title">Bottom 3</div>
                    {summary.bad.map((interval) => (
                      <div key={`${interval.startDate}-${interval.endDate}`} className="interval-item">
                        <span>{formatDate(interval.endDate)}</span>
                        <span>{formatNumber(interval.perDay, 2)} / day</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Top Movers</h2>
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
          {topMoversMetric.length === 0 && <div className="muted">No top movers available.</div>}
          {topMoversMetric.map((entry) => (
            <div key={`${entry.metric}-${entry.playerKey}`} className="list-item">
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

      <section className="card">
        <h2 className="card-title">Insights</h2>
        <div className="grid two-col">
          <div>
            <div className="interval-title">Biggest Risers (BaseStats/Day)</div>
            <div className="list">
              {cardPlayers
                .filter((player) => player.windowMetrics.baseStats[windowKey])
                .sort(
                  (a, b) =>
                    (b.windowMetrics.baseStats[windowKey]?.perDay ?? 0) -
                    (a.windowMetrics.baseStats[windowKey]?.perDay ?? 0),
                )
                .slice(0, 5)
                .map((player) => (
                  <div key={`riser-${player.playerKey}`} className="list-item">
                    <div className="list-title">{player.name}</div>
                    <div className="metric-inline">
                      {formatNumber(player.windowMetrics.baseStats[windowKey]?.perDay ?? 0, 2)} / day
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <div className="interval-title">Biggest Droppers (BaseStats/Day)</div>
            <div className="list">
              {cardPlayers
                .filter((player) => player.windowMetrics.baseStats[windowKey])
                .sort(
                  (a, b) =>
                    (a.windowMetrics.baseStats[windowKey]?.perDay ?? 0) -
                    (b.windowMetrics.baseStats[windowKey]?.perDay ?? 0),
                )
                .slice(0, 5)
                .map((player) => (
                  <div key={`dropper-${player.playerKey}`} className="list-item">
                    <div className="list-title">{player.name}</div>
                    <div className="metric-inline">
                      {formatNumber(player.windowMetrics.baseStats[windowKey]?.perDay ?? 0, 2)} / day
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <div className="interval-title">Resource Specialists (Mine)</div>
            <div className="list">
              {cardPlayers
                .sort((a, b) => b.minePerDayYear - a.minePerDayYear)
                .slice(0, 5)
                .map((player) => (
                  <div key={`mine-${player.playerKey}`} className="list-item">
                    <div className="list-title">{player.name}</div>
                    <div className="metric-inline">
                      {formatNumber(player.minePerDayYear, 2)} / day
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <div className="interval-title">Resource Specialists (Treasury)</div>
            <div className="list">
              {cardPlayers
                .sort((a, b) => b.treasuryPerDayYear - a.treasuryPerDayYear)
                .slice(0, 5)
                .map((player) => (
                  <div key={`treasury-${player.playerKey}`} className="list-item">
                    <div className="list-title">{player.name}</div>
                    <div className="metric-inline">
                      {formatNumber(player.treasuryPerDayYear, 2)} / day
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <div className="interval-title">Level Pushers</div>
            <div className="list">
              {cardPlayers
                .sort(
                  (a, b) =>
                    (b.windowMetrics.level[windowKey]?.delta ?? 0) -
                    (a.windowMetrics.level[windowKey]?.delta ?? 0),
                )
                .slice(0, 5)
                .map((player) => (
                  <div key={`level-${player.playerKey}`} className="list-item">
                    <div className="list-title">{player.name}</div>
                    <div className="metric-inline">
                      {formatNumber(player.windowMetrics.level[windowKey]?.delta ?? 0, 0)} delta
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
