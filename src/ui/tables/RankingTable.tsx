import { useState } from 'react'
import type { PlayerComputed, WindowKey } from '../../data/types'
import { getClassIconUrl, getClassMeta } from '../../data/classes'
import { formatInt, formatNumber } from '../format'

type RankingTableProps = {
  players: PlayerComputed[]
  windowKey: WindowKey
  recommendationByKey?: Map<string, PlayerComputed['recommendation']>
  statusByKey?: Map<string, Array<'Main' | 'Wing' | 'Watchlist'>>
  poolKeySet?: Set<string>
  showPoolMarking?: boolean
  selectedPlayerKey?: string | null
  onRowSelect?: (playerKey: string) => void
  onRowOpen?: (playerKey: string) => void
  onBaseStatsHeaderClick?: () => void
  onStatsPlusHeaderClick?: () => void
  onLevelHeaderClick?: () => void
  onScoreHeaderClick?: () => void
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

const formatOptional = (value?: number | null, digits = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return value.toFixed(digits)
}

const normalizeClassId = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.trunc(value)
}

const formatClass = (value?: number | null) => {
  const classId = normalizeClassId(value)
  if (classId === null) {
    return '--'
  }
  return classId.toString()
}

export default function RankingTable({
  players,
  windowKey,
  recommendationByKey,
  statusByKey,
  poolKeySet,
  showPoolMarking = false,
  selectedPlayerKey,
  onRowSelect,
  onRowOpen,
  onBaseStatsHeaderClick,
  onStatsPlusHeaderClick,
  onLevelHeaderClick,
  onScoreHeaderClick,
}: RankingTableProps) {
  const [brokenClassIds, setBrokenClassIds] = useState<Set<number>>(() => new Set())

  const markClassIdBroken = (classId: number) => {
    setBrokenClassIds((prev) => {
      if (prev.has(classId)) {
        return prev
      }
      const next = new Set(prev)
      next.add(classId)
      return next
    })
  }

  const renderClassCell = (value?: number | null) => {
    const classId = normalizeClassId(value)
    if (classId === null) {
      return formatClass(value)
    }
    const meta = getClassMeta(classId)
    const iconUrl = getClassIconUrl(classId)
    if (!iconUrl || brokenClassIds.has(classId)) {
      return formatClass(classId)
    }
    const label = meta?.label
    const alt = label ? `${label} class` : `Class ${classId}`
    const title = label ? `${label} (Class ${classId})` : `Class ${classId}`
    return (
      <span className="class-cell">
        <img
          className="class-icon"
          src={iconUrl}
          alt={alt}
          title={title}
          loading="lazy"
          onError={() => markClassIdBroken(classId)}
        />
      </span>
    )
  }

  return (
    <div className="table-wrapper ranking-table-wrapper">
      <table className="table ranking-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Class</th>
            <th>Guild</th>
            <th>
              <button
                type="button"
                className="table-header-action"
                title="Show BaseStats interval details"
                onClick={onBaseStatsHeaderClick}
              >
                BaseStats/Day
              </button>
            </th>
            <th>
              <button
                type="button"
                className="table-header-action"
                title="Total BaseStats gain over selected window"
                onClick={onStatsPlusHeaderClick}
              >
                Stats +
              </button>
            </th>
            <th>
              <button
                type="button"
                className="table-header-action"
                title="Show Level interval details"
                onClick={onLevelHeaderClick}
              >
                Level
              </button>
            </th>
            <th>Mine</th>
            <th>Treasury</th>
            <th>Coverage</th>
            <th>
              <button
                type="button"
                className="table-header-action"
                title="Show Score for each window"
                onClick={onScoreHeaderClick}
                disabled={!onScoreHeaderClick}
              >
                Score
              </button>
            </th>
            <th>Status</th>
            <th>Rec</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const latest = player.points[player.points.length - 1]
            const baseWindow = player.windowMetrics.baseStats[windowKey]
            const mineWindow = player.windowMetrics.mine[windowKey]
            const treasuryWindow = player.windowMetrics.treasury[windowKey]
            const isSelected = selectedPlayerKey === player.playerKey
            const recommendation =
              recommendationByKey?.get(player.playerKey) ?? player.recommendation
            const showPoolTag = showPoolMarking && poolKeySet
            const isPoolMember = showPoolTag ? poolKeySet?.has(player.playerKey) : false
            const statuses = statusByKey?.get(player.playerKey) ?? []
            return (
              <tr
                key={player.playerKey}
                className={`${onRowSelect ? 'row-clickable' : ''} ${isSelected ? 'row-selected' : ''}`.trim()}
                onClick={() => {
                  onRowSelect?.(player.playerKey)
                }}
              >
                <td>
                  <button
                    type="button"
                    className="table-main table-header-action"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRowOpen?.(player.playerKey)
                    }}
                  >
                    {player.name}
                  </button>
                  <div className="table-sub">{player.server}</div>
                </td>
                <td>{renderClassCell(player.classId)}</td>
                <td>{player.latestGuildName ?? player.latestGuildKey ?? '-'}</td>
                <td>
                  <div className="table-main">{formatOptional(baseWindow?.perDay, 1)}</div>
                  <div className="table-sub">{formatNumber(player.baseStatsPerDayYear, 1)}</div>
                </td>
                <td>
                  <div className="table-main">{formatDelta(baseWindow?.delta)}</div>
                  <div className="table-sub">{baseWindow ? `${baseWindow.days}d` : '--'}</div>
                </td>
                <td>
                  <div className="table-main">{formatInt(latest?.level ?? 0)}</div>
                  <div className="table-sub">
                    {(() => {
                      const breakdown =
                        player.scoreBreakdownByWindow?.[windowKey] ??
                        player.scoreDebugByWindow?.[windowKey]
                      const levelInfo = breakdown?.level
                      if (!levelInfo?.levelKnown || levelInfo.levelDelta === null) {
                        return '—'
                      }
                      const displayDelta = Math.max(0, levelInfo.levelDelta)
                      return formatInt(displayDelta)
                    })()}
                  </div>
                </td>
                <td>
                  <div className="table-main">{formatNumber(mineWindow?.perDay ?? 0, 2)}</div>
                  <div className="table-sub">{formatInt(mineWindow?.delta ?? 0)}</div>
                </td>
                <td>
                  <div className="table-main">{formatNumber(treasuryWindow?.perDay ?? 0, 2)}</div>
                  <div className="table-sub">{formatInt(treasuryWindow?.delta ?? 0)}</div>
                </td>
                <td>
                  {player.coverage.points} pts - {player.coverage.days}d
                </td>
                <td>
                  <div className="table-main">
                    {formatNumber(player.scoreByWindow?.[windowKey] ?? player.score, 3)}
                  </div>
                  <div className="table-sub">#{player.rank}</div>
                </td>
                <td>
                  <div className="tag-list">
                    {statuses.map((status) => (
                      <span
                        key={`${player.playerKey}-${status}`}
                        className={`badge badge-${status.toLowerCase()}`}
                      >
                        {status}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${recommendation.toLowerCase()}`}>
                    {recommendation}
                  </span>
                </td>
                <td>
                  <div className="tag-list">
                    {showPoolTag && (
                      <span className={`tag ${isPoolMember ? 'tag-pool' : 'tag-external'}`}>
                        {isPoolMember ? 'IN POOL' : 'EXTERNAL'}
                      </span>
                    )}
                    {player.tags.strengths.map((tag) => (
                      <span key={`s-${player.playerKey}-${tag}`} className="tag tag-strong">
                        {tag}
                      </span>
                    ))}
                    {(() => {
                      const breakdown =
                        player.scoreBreakdownByWindow?.[windowKey] ??
                        player.scoreDebugByWindow?.[windowKey]
                      const lowLeveling = breakdown?.level?.lowLeveling
                      const weaknesses = player.tags.weaknesses.filter(
                        (tag) => tag !== 'Low Leveling',
                      )
                      if (lowLeveling) {
                        weaknesses.push('Low Leveling')
                      }
                      return weaknesses.map((tag) => (
                        <span key={`w-${player.playerKey}-${tag}`} className="tag tag-weak">
                          {tag}
                        </span>
                      ))
                    })()}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
