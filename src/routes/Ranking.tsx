import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../data/store'
import type { PlayerComputed, WindowKey } from '../data/types'
import RankingTable from '../ui/tables/RankingTable'
import RankingIntervalsFlyout from '../ui/RankingIntervalsFlyout'
import RankingScoreFlyout from '../ui/RankingScoreFlyout'
import './Ranking.css'

type SortKey = 'score' | 'baseStats' | 'statsPlus' | 'level' | 'mine' | 'treasury'
type FlyoutSource = 'baseStats' | 'statsPlus'
type TabKey = 'ranking' | 'scouting'
type StatusLabel = 'Main' | 'Wing' | 'Watchlist'

const WINDOW_KEYS: WindowKey[] = ['1', '3', '6', '12']
const MEMBERLIST_COLUMNS_KEY = 'ga:memberlistColumns'
const MEMBERLIST_COLUMNS = ['col-1', 'col-2', 'col-3'] as const
type MemberlistColumn = (typeof MEMBERLIST_COLUMNS)[number]

const emptyColumns = (): Record<MemberlistColumn, string[]> => ({
  'col-1': [],
  'col-2': [],
  'col-3': [],
})

const readStoredColumns = (): {
  columns: Record<MemberlistColumn, string[]>
  hasStored: boolean
} => {
  if (typeof window === 'undefined') {
    return { columns: emptyColumns(), hasStored: false }
  }
  try {
    const raw = window.localStorage.getItem(MEMBERLIST_COLUMNS_KEY)
    if (!raw) {
      return { columns: emptyColumns(), hasStored: false }
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next = emptyColumns()
    MEMBERLIST_COLUMNS.forEach((key) => {
      const value = parsed[key]
      if (Array.isArray(value)) {
        next[key] = value.filter((entry): entry is string => typeof entry === 'string')
      }
    })
    return { columns: next, hasStored: true }
  } catch {
    return { columns: emptyColumns(), hasStored: false }
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

const buildPoolColumns = (fallbackKeys: string[], players: PlayerComputed[]) => {
  const { columns, hasStored } = readStoredColumns()
  let base = columns
  if (!hasStored && fallbackKeys.length) {
    base = { ...columns, 'col-1': [...fallbackKeys] }
  }
  if (!players.length) {
    return base
  }
  const { keyMap, conflicts } = buildLegacyKeyMap(players)
  return {
    'col-1': migrateKeys(base['col-1'], keyMap, conflicts),
    'col-2': migrateKeys(base['col-2'], keyMap, conflicts),
    'col-3': migrateKeys(base['col-3'], keyMap, conflicts),
  }
}

const buildPoolKeySet = (columns: Record<MemberlistColumn, string[]>) => {
  const merged = [...columns['col-1'], ...columns['col-2'], ...columns['col-3']]
  return new Set(merged.filter((key) => typeof key === 'string' && key.length > 0))
}

const buildStatusByKey = (columns: Record<MemberlistColumn, string[]>) => {
  const map = new Map<string, StatusLabel[]>()
  const addStatus = (key: string, status: StatusLabel) => {
    if (!key) {
      return
    }
    const list = map.get(key) ?? []
    if (!list.includes(status)) {
      list.push(status)
      map.set(key, list)
    }
  }
  columns['col-1'].forEach((key) => addStatus(key, 'Watchlist'))
  columns['col-2'].forEach((key) => addStatus(key, 'Main'))
  columns['col-3'].forEach((key) => addStatus(key, 'Wing'))
  return map
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

export default function Ranking() {
  const { result, defaultWindowKey, updateDefaultWindowKey, memberlistPoolKeys } = useData()
  const navigate = useNavigate()
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindowKey)
  const [activeTab, setActiveTab] = useState<TabKey>('ranking')
  const [selectedGuild, setSelectedGuild] = useState<string>('all')
  const [selectedRec, setSelectedRec] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [minCoverage, setMinCoverage] = useState<number>(2)
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | null>(null)
  const [flyoutOpen, setFlyoutOpen] = useState(false)
  const [flyoutSource, setFlyoutSource] = useState<FlyoutSource>('baseStats')
  const [highlightPool, setHighlightPool] = useState(true)
  const [poolOnly, setPoolOnly] = useState(false)
  const [scoreFlyoutOpen, setScoreFlyoutOpen] = useState(false)

  useEffect(() => setWindowKey(defaultWindowKey), [defaultWindowKey])

  const scoutPlayers = result?.globalPlayers ?? result?.players ?? []
  const poolColumns = useMemo(
    () => buildPoolColumns(memberlistPoolKeys, scoutPlayers),
    [memberlistPoolKeys, scoutPlayers],
  )
  const poolKeySet = useMemo(() => buildPoolKeySet(poolColumns), [poolColumns])
  const poolStatusByKey = useMemo(() => buildStatusByKey(poolColumns), [poolColumns])
  const poolPlayers = useMemo(
    () => scoutPlayers.filter((player) => poolKeySet.has(player.playerKey)),
    [scoutPlayers, poolKeySet],
  )
  const poolRecommendationByKey = useMemo(
    () => buildRecommendationMap(poolPlayers),
    [poolPlayers],
  )
  const scoutRecommendationByKey = useMemo(
    () => buildRecommendationMap(scoutPlayers),
    [scoutPlayers],
  )

  const guildOptions = useMemo(
    () =>
      result?.guildRoster?.map((guild) => ({
        key: guild.guildKey,
        label: guild.guildName,
      })) ?? [],
    [result],
  )

  const filteredPlayers = useMemo(() => {
    if (!result) {
      return []
    }
    const isAllPlayer = activeTab === 'scouting'
    const recMap = isAllPlayer ? scoutRecommendationByKey : poolRecommendationByKey
    let players = isAllPlayer ? scoutPlayers : poolPlayers
    if (isAllPlayer && poolOnly) {
      players = players.filter((player) => poolKeySet.has(player.playerKey))
    }
    if (selectedGuild !== 'all') {
      players = players.filter((player) => player.latestGuildKey === selectedGuild)
    }
    if (selectedRec !== 'all') {
      players = players.filter(
        (player) => (recMap.get(player.playerKey) ?? 'None') === selectedRec,
      )
    }
    if (Number.isFinite(minCoverage) && minCoverage > 0) {
      players = players.filter((player) => player.coverage.points >= minCoverage)
    }
    const sorted = [...players].sort((a, b) => {
      const value = (player: PlayerComputed) => {
        switch (sortKey) {
          case 'baseStats':
            return player.baseStatsPerDayYear
          case 'score':
            return player.scoreByWindow?.[windowKey] ?? player.score
          case 'statsPlus':
            return player.windowMetrics.baseStats[windowKey]?.delta ?? Number.NEGATIVE_INFINITY
          case 'level':
            return player.windowMetrics.level[windowKey]?.delta ?? 0
          case 'mine':
            return player.windowMetrics.mine[windowKey]?.perDay ?? 0
          case 'treasury':
            return player.windowMetrics.treasury[windowKey]?.perDay ?? 0
          default:
            return player.score
        }
      }
      return value(b) - value(a)
    })
    return sorted
  }, [
    result,
    activeTab,
    poolOnly,
    scoutPlayers,
    poolPlayers,
    poolKeySet,
    selectedGuild,
    selectedRec,
    poolRecommendationByKey,
    scoutRecommendationByKey,
    sortKey,
    windowKey,
    minCoverage,
  ])

  useEffect(() => {
    if (!filteredPlayers.length) {
      if (selectedPlayerKey !== null) {
        setSelectedPlayerKey(null)
      }
      return
    }
    const stillPresent = selectedPlayerKey
      ? filteredPlayers.some((player) => player.playerKey === selectedPlayerKey)
      : false
    if (!stillPresent) {
      setSelectedPlayerKey(filteredPlayers[0].playerKey)
    }
  }, [filteredPlayers, selectedPlayerKey])

  const selectedPlayer = useMemo(
    () => filteredPlayers.find((player) => player.playerKey === selectedPlayerKey) ?? null,
    [filteredPlayers, selectedPlayerKey],
  )

  const openFlyout = (source: FlyoutSource) => {
    setFlyoutSource(source)
    setFlyoutOpen(true)
  }

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Scouting</h1>
        <div className="card">Load a dataset to see rankings and recommendations.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Scouting</h1>
          <p className="page-subtitle">Scores, recommendations, and performance windows.</p>
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'ranking' ? 'active' : ''}`}
              onClick={() => setActiveTab('ranking')}
            >
              Playerpool
            </button>
            <button
              className={`tab ${activeTab === 'scouting' ? 'active' : ''}`}
              onClick={() => setActiveTab('scouting')}
            >
              All Player
            </button>
          </div>
        </div>
        <div className="filters">
          <label className="filter">
            <span>Guild</span>
            <select
              className="select"
              value={selectedGuild}
              onChange={(event) => setSelectedGuild(event.target.value)}
            >
              <option value="all">All</option>
              {guildOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Recommendation</span>
            <select
              className="select"
              value={selectedRec}
              onChange={(event) => setSelectedRec(event.target.value)}
            >
              <option value="all">All</option>
              <option value="Main">Main</option>
              <option value="Wing">Wing</option>
              <option value="None">None</option>
            </select>
          </label>
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
          <label className="filter">
            <span>Sort</span>
            <select
              className="select"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
            >
              <option value="score">Score</option>
              <option value="baseStats">BaseStats/Day (Year)</option>
              <option value="statsPlus">Stats + (Window)</option>
              <option value="level">Level Delta (Window)</option>
              <option value="mine">Mine/Day</option>
              <option value="treasury">Treasury/Day</option>
            </select>
          </label>
          <label className="filter">
            <span>Min Points</span>
            <input
              className="select"
              type="number"
              min={0}
              value={minCoverage}
              onChange={(event) => setMinCoverage(Number(event.target.value))}
            />
          </label>
          {activeTab === 'scouting' && (
            <>
              <label className="filter">
                <span>Highlight pool members</span>
                <input
                  type="checkbox"
                  checked={highlightPool}
                  onChange={(event) => setHighlightPool(event.target.checked)}
                />
              </label>
              <label className="filter">
                <span>Pool only</span>
                <input
                  type="checkbox"
                  checked={poolOnly}
                  onChange={(event) => setPoolOnly(event.target.checked)}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <RankingTable
        players={filteredPlayers}
        windowKey={windowKey}
        recommendationByKey={
          activeTab === 'scouting' ? scoutRecommendationByKey : poolRecommendationByKey
        }
        statusByKey={poolStatusByKey}
        poolKeySet={activeTab === 'scouting' ? poolKeySet : undefined}
        showPoolMarking={activeTab === 'scouting' && highlightPool}
        selectedPlayerKey={selectedPlayerKey}
        onRowSelect={setSelectedPlayerKey}
        onRowOpen={(playerKey) => navigate(`/player/${encodeURIComponent(playerKey)}`)}
        onBaseStatsHeaderClick={() => openFlyout('baseStats')}
        onStatsPlusHeaderClick={() => openFlyout('statsPlus')}
        onScoreHeaderClick={() => setScoreFlyoutOpen(true)}
      />

      <RankingIntervalsFlyout
        open={flyoutOpen}
        onClose={() => setFlyoutOpen(false)}
        player={selectedPlayer}
        snapshots={result.snapshots}
        windowKey={windowKey}
        source={flyoutSource}
      />
      <RankingScoreFlyout
        open={scoreFlyoutOpen}
        onClose={() => setScoreFlyoutOpen(false)}
        player={selectedPlayer}
      />
    </div>
  )
}
