import { useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { MetricKey, PlayerComputed } from '../data/types'
import { formatDate, formatNumber } from '../ui/format'

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

type GroupPoint = {
  date: string
  baseStatsMedian: number
  levelMedian: number
  mineMedian: number
  treasuryMedian: number
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

const buildGroupIntervals = (points: GroupPoint[]) => {
  const intervals = []
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

const buildGroupMetricIntervals = (points: GroupPoint[], selector: (point: GroupPoint) => number) => {
  const intervals = []
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

export default function Months() {
  const { result } = useData()
  const [metricKey, setMetricKey] = useState<MetricKey>('baseStats')

  const intervalRows = useMemo(() => {
    if (!result) return []
    const allPlayers = result.globalPlayers ?? result.players ?? []
    const cardColumns = buildCardColumns(allPlayers)
    const cardNames = readStoredCardNames()
    const cardLabels = {
      'col-2': cardNames['col-2'].trim() || 'Guild Card 1',
      'col-3': cardNames['col-3'].trim() || 'Guild Card 2',
    }
    const playerByKey = new Map(allPlayers.map((player) => [player.playerKey, player]))

    const buildGroupPoints = (playerKeys: string[]) => {
      const pointsByDate = new Map<
        string,
        { baseStats: number[]; level: number[]; mine: number[]; treasury: number[] }
      >()
      playerKeys.forEach((playerKey) => {
        const player = playerByKey.get(playerKey)
        if (!player) {
          return
        }
        player.points.forEach((point) => {
          const entry = pointsByDate.get(point.date) ?? {
            baseStats: [],
            level: [],
            mine: [],
            treasury: [],
          }
          entry.baseStats.push(point.baseStats)
          entry.level.push(point.level)
          entry.mine.push(point.mine)
          entry.treasury.push(point.treasury)
          pointsByDate.set(point.date, entry)
        })
      })

      return Array.from(pointsByDate.entries())
        .sort((a, b) => toDate(a[0]).getTime() - toDate(b[0]).getTime())
        .map(([date, entry]) => ({
          date,
          baseStatsMedian: median(entry.baseStats),
          levelMedian: median(entry.level),
          mineMedian: median(entry.mine),
          treasuryMedian: median(entry.treasury),
        }))
    }

    return GUILD_CARD_COLUMNS.map((columnKey) => ({
      guildKey: `custom:${columnKey}`,
      guildName: cardLabels[columnKey],
      playerKeys: cardColumns[columnKey] ?? [],
    }))
      .filter((card) => card.guildName.trim().length > 0 || card.playerKeys.length > 0)
      .map((card) => {
        const groupPoints = buildGroupPoints(card.playerKeys)
        const intervals = buildGroupIntervals(groupPoints)
        const intervalsByMetric = {
          baseStats: intervals,
          level: buildGroupMetricIntervals(groupPoints, (point) => point.levelMedian),
          mine: buildGroupMetricIntervals(groupPoints, (point) => point.mineMedian),
          treasury: buildGroupMetricIntervals(groupPoints, (point) => point.treasuryMedian),
        }
        const rows = (intervalsByMetric[metricKey] ?? intervals).map((interval) => {
          const candidates = card.playerKeys
            .map((playerKey) => {
              const player = playerByKey.get(playerKey)
              if (!player) {
                return null
              }
              const match = player.intervals[metricKey].find(
                (entry) => entry.endDate === interval.endDate,
              )
              if (!match) {
                return null
              }
              const endPoint = player.points.find((point) => point.date === interval.endDate)
              if (!endPoint) {
                return null
              }
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
          guildKey: card.guildKey,
          guildName: card.guildName,
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
