import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useData } from '../data/store'
import type { LatestPlayerEntry } from '../data/types'
import { formatNumber } from '../ui/format'

const MAX_MEMBERLIST_SLOTS = 50
const MEMBERLIST_COLUMNS = ['col-1', 'col-2', 'col-3'] as const
type MemberlistColumn = (typeof MEMBERLIST_COLUMNS)[number]
const GUILD_CARD_COLUMNS = ['col-2', 'col-3'] as const
type GuildCardColumn = (typeof GUILD_CARD_COLUMNS)[number]

const MEMBERLIST_COLUMNS_KEY = 'ga:memberlistColumns'
const MEMBERLIST_CARD_NAMES_KEY = 'ga:memberlistCardNames'

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

const writeStoredColumns = (value: Record<MemberlistColumn, string[]>) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MEMBERLIST_COLUMNS_KEY, JSON.stringify(value))
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

const writeStoredCardNames = (value: Record<GuildCardColumn, string>) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MEMBERLIST_CARD_NAMES_KEY, JSON.stringify(value))
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

const buildLegacyKeyMap = (players: LatestPlayerEntry[]) => {
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

const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

export default function Memberlist() {
  const { result, updateMemberlistPoolKeys, memberlistPoolKeys } = useData()
  const [memberlistColumns, setMemberlistColumns] =
    useState<Record<MemberlistColumn, string[]>>(() => readStoredColumns())
  const [guildCardNames, setGuildCardNames] = useState<Record<GuildCardColumn, string>>(() =>
    readStoredCardNames(),
  )
  const [newGuildCardName, setNewGuildCardName] = useState<string>('')
  const [dragOverColumn, setDragOverColumn] = useState<MemberlistColumn | null>(null)
  const [memberlistSearch, setMemberlistSearch] = useState<string>('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHasFocus, setSearchHasFocus] = useState(false)
  const [activeSearchIndex, setActiveSearchIndex] = useState<number>(-1)
  const searchRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    writeStoredColumns(memberlistColumns)
  }, [memberlistColumns])

  useEffect(() => {
    writeStoredCardNames(guildCardNames)
  }, [guildCardNames])

  const latestPlayers = useMemo(() => {
    if (!result) {
      return []
    }
    if (result.latestPlayers?.length) {
      return result.latestPlayers
    }
    const source = result.globalPlayers ?? result.players
    return source.map((player) => ({
      playerKey: player.playerKey,
      name: player.name,
      server: player.server,
      playerId: player.playerId,
      guildKey: player.latestGuildKey,
      guildName: player.latestGuildName,
    }))
  }, [result])

  const latestGuildRoster = useMemo(
    () => result?.guildRoster ?? [],
    [result],
  )

  const playersByGuild = useMemo(() => {
    const map = new Map<string, string[]>()
    latestPlayers.forEach((player) => {
      const key = player.guildKey ?? 'unknown'
      const list = map.get(key) ?? []
      list.push(player.playerKey)
      map.set(key, list)
    })
    return map
  }, [latestPlayers])

  const searchTerm = memberlistSearch.trim().toLowerCase()
  const guildSearchResults = useMemo(() => {
    if (!searchTerm) return []
    return latestGuildRoster.filter(
      (guild) =>
        guild.guildName.toLowerCase().includes(searchTerm) ||
        guild.guildKey.toLowerCase().includes(searchTerm),
    )
  }, [latestGuildRoster, searchTerm])
  const playerSearchResults = useMemo(() => {
    if (!searchTerm) return []
    return latestPlayers.filter((player) => {
      const guildName = player.guildName ?? player.guildKey ?? ''
      return (
        player.name.toLowerCase().includes(searchTerm) ||
        player.playerKey.toLowerCase().includes(searchTerm) ||
        player.server.toLowerCase().includes(searchTerm) ||
        guildName.toLowerCase().includes(searchTerm)
      )
    })
  }, [latestPlayers, searchTerm])
  const memberPlayerMap = useMemo(
    () => new Map(latestPlayers.map((player) => [player.playerKey, player])),
    [latestPlayers],
  )
  const latestPlayerKeySet = useMemo(
    () => new Set(latestPlayers.map((player) => player.playerKey)),
    [latestPlayers],
  )

  const guildCardLabels = useMemo(
    () => ({
      'col-2': guildCardNames['col-2'].trim() || 'Guild Card 1',
      'col-3': guildCardNames['col-3'].trim() || 'Guild Card 2',
    }),
    [guildCardNames],
  )

  const playerStatsByKey = useMemo(() => {
    const source = result?.globalPlayers ?? result?.players ?? []
    return new Map(source.map((player) => [player.playerKey, player]))
  }, [result])

  const guildCardSummaries = useMemo(() => {
    return GUILD_CARD_COLUMNS.map((columnKey) => {
      const playerKeys = memberlistColumns[columnKey] ?? []
      const players = playerKeys
        .map((playerKey) => playerStatsByKey.get(playerKey))
        .filter((player): player is NonNullable<typeof player> => Boolean(player))
      const latestPoints = players
        .map((player) => player.points[player.points.length - 1])
        .filter((point): point is NonNullable<typeof point> => Boolean(point))
      const baseStatsPerDayYear = median(players.map((player) => player.baseStatsPerDayYear))
      const minePerDayYear = median(players.map((player) => player.minePerDayYear))
      const treasuryPerDayYear = median(players.map((player) => player.treasuryPerDayYear))
      const levelMedianLatest = median(latestPoints.map((point) => point.level))
      const baseStatsMedianLatest = median(latestPoints.map((point) => point.baseStats))
      const mineMedianLatest = median(latestPoints.map((point) => point.mine))
      const treasuryMedianLatest = median(latestPoints.map((point) => point.treasury))
      return {
        key: columnKey,
        members: players.length,
        baseStatsPerDayYear,
        minePerDayYear,
        treasuryPerDayYear,
        levelMedianLatest,
        baseStatsMedianLatest,
        mineMedianLatest,
        treasuryMedianLatest,
      }
    })
  }, [memberlistColumns, playerStatsByKey])

  const activeGuildCards = useMemo(
    () =>
      guildCardSummaries.filter((card) => {
        const hasName = guildCardNames[card.key].trim().length > 0
        return hasName || card.members > 0
      }),
    [guildCardNames, guildCardSummaries],
  )

  const guildHits = useMemo(() => guildSearchResults.slice(0, 10), [guildSearchResults])
  const playerHits = useMemo(() => playerSearchResults.slice(0, 20), [playerSearchResults])
  const flatHits = useMemo(
    () => [
      ...guildHits.map((guild) => ({
        type: 'guild' as const,
        key: guild.guildKey,
        label: guild.guildName,
      })),
      ...playerHits.map((player) => ({
        type: 'player' as const,
        key: player.playerKey,
        label: player.name,
      })),
    ],
    [guildHits, playerHits],
  )

  useEffect(() => {
    if (!searchOpen) {
      setActiveSearchIndex(-1)
      return
    }
    if (flatHits.length) {
      setActiveSearchIndex(0)
    } else {
      setActiveSearchIndex(-1)
    }
  }, [searchOpen, flatHits.length])

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!searchRef.current) return
      if (searchRef.current.contains(event.target as Node)) return
      setSearchOpen(false)
      setSearchHasFocus(false)
      setActiveSearchIndex(-1)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (!result || latestPlayerKeySet.size === 0) {
      return
    }
    const { keyMap, conflicts } = buildLegacyKeyMap(latestPlayers)
    const migratedPool = migrateKeys(memberlistPoolKeys, keyMap, conflicts)
    const validPool = migratedPool.filter((key) => latestPlayerKeySet.has(key))
    if (
      validPool.length !== memberlistPoolKeys.length ||
      validPool.some((key, index) => key !== memberlistPoolKeys[index])
    ) {
      updateMemberlistPoolKeys(validPool)
    }
    const validPoolSet = new Set(validPool)
    setMemberlistColumns((current) => {
      const nextCol2 = migrateKeys(current['col-2'], keyMap, conflicts).filter(
        (key) => latestPlayerKeySet.has(key) && !validPoolSet.has(key),
      )
      const nextCol3 = migrateKeys(current['col-3'], keyMap, conflicts).filter(
        (key) => latestPlayerKeySet.has(key) && !validPoolSet.has(key),
      )
      const next: Record<MemberlistColumn, string[]> = {
        'col-1': validPool,
        'col-2': nextCol2,
        'col-3': nextCol3,
      }
      if (
        arraysEqual(current['col-1'], next['col-1']) &&
        arraysEqual(current['col-2'], next['col-2']) &&
        arraysEqual(current['col-3'], next['col-3'])
      ) {
        return current
      }
      return next
    })
  }, [result, memberlistPoolKeys, latestPlayerKeySet, latestPlayers, updateMemberlistPoolKeys])

  const movePlayerToColumn = (playerKey: string, target: MemberlistColumn) => {
    setMemberlistColumns((current) => {
      const next: Record<MemberlistColumn, string[]> = {
        'col-1': current['col-1'].filter((key) => key !== playerKey),
        'col-2': current['col-2'].filter((key) => key !== playerKey),
        'col-3': current['col-3'].filter((key) => key !== playerKey),
      }
      next[target] = [...next[target], playerKey]
      updateMemberlistPoolKeys(next['col-1'])
      return next
    })
  }

  const addPlayersToPool = (keys: string[]) => {
    if (!keys.length) {
      return
    }
    setMemberlistColumns((current) => {
      const next: Record<MemberlistColumn, string[]> = {
        'col-1': current['col-1'].filter((key) => !keys.includes(key)),
        'col-2': current['col-2'].filter((key) => !keys.includes(key)),
        'col-3': current['col-3'].filter((key) => !keys.includes(key)),
      }
      const poolSet = new Set(next['col-1'])
      keys.forEach((key) => {
        if (!poolSet.has(key)) {
          next['col-1'].push(key)
          poolSet.add(key)
        }
      })
      updateMemberlistPoolKeys(next['col-1'])
      return next
    })
  }

  const addGuildToPool = (guildKey: string) => {
    const guildPlayerKeys = playersByGuild.get(guildKey) ?? []
    addPlayersToPool(guildPlayerKeys)
  }

  const updateGuildCardName = (columnKey: GuildCardColumn, value: string) => {
    setGuildCardNames((current) => ({
      ...current,
      [columnKey]: value,
    }))
  }

  const handleAddGuildCard = () => {
    const trimmed = newGuildCardName.trim()
    if (!trimmed) {
      return
    }
    const openKey = GUILD_CARD_COLUMNS.find((key) => !guildCardNames[key].trim())
    if (!openKey) {
      return
    }
    setGuildCardNames((current) => ({
      ...current,
      [openKey]: trimmed,
    }))
    setNewGuildCardName('')
  }

  const removePlayerFromPool = (playerKey: string) => {
    setMemberlistColumns((current) => {
      const nextPool = current['col-1'].filter((key) => key !== playerKey)
      if (nextPool.length === current['col-1'].length) {
        return current
      }
      const next: Record<MemberlistColumn, string[]> = {
        'col-1': nextPool,
        'col-2': current['col-2'],
        'col-3': current['col-3'],
      }
      updateMemberlistPoolKeys(nextPool)
      return next
    })
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen) {
      return
    }
    if (event.key === 'Escape') {
      setSearchOpen(false)
      setActiveSearchIndex(-1)
      return
    }
    if (!flatHits.length) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSearchIndex((index) => (index + 1) % flatHits.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSearchIndex((index) => (index - 1 + flatHits.length) % flatHits.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const hit = flatHits[activeSearchIndex]
      if (!hit) return
      if (hit.type === 'guild') {
        addGuildToPool(hit.key)
      } else {
        addPlayersToPool([hit.key])
      }
    }
  }

  const handleDrop = (column: MemberlistColumn) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const playerKey = event.dataTransfer.getData('text/plain')
    if (playerKey) {
      movePlayerToColumn(playerKey, column)
    }
    setDragOverColumn(null)
  }

  const handleDragOver = (column: MemberlistColumn) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOverColumn(column)
  }

  const handleDragLeave = () => setDragOverColumn(null)

  const canAddGuildCard =
    newGuildCardName.trim().length > 0 &&
    GUILD_CARD_COLUMNS.some((key) => !guildCardNames[key].trim())

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Memberlist</h1>
        <div className="card">Load a dataset to manage the playerpool.</div>
      </div>
    )
  }

  const compareCards = activeGuildCards

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Memberlist</h1>
          <p className="page-subtitle">Playerpool management and roster summary.</p>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Guild Cards</h2>
        </div>
        <div className="filters">
          <label className="filter">
            <span>New guild card</span>
            <input
              className="select"
              type="text"
              value={newGuildCardName}
              placeholder="Name"
              onChange={(event) => setNewGuildCardName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleAddGuildCard()
                }
              }}
            />
          </label>
          <button className="btn" onClick={handleAddGuildCard} disabled={!canAddGuildCard}>
            Add
          </button>
        </div>
        {activeGuildCards.length === 0 ? (
          <div className="empty">No guild cards yet.</div>
        ) : (
          <div className="list">
            {activeGuildCards.map((card) => (
              <div key={card.key} className="list-item">
                <div>
                  <div className="list-title">
                    <input
                      className="select"
                      type="text"
                      value={guildCardNames[card.key]}
                      placeholder={guildCardLabels[card.key]}
                      onChange={(event) => updateGuildCardName(card.key, event.target.value)}
                      aria-label={`Rename ${guildCardLabels[card.key]}`}
                    />
                  </div>
                  <div className="list-sub">{card.members} players</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Playerpool Search</h2>
        <div className="filters">
          <div className="search-wrap" ref={searchRef}>
            <label className="filter">
              <span>Search</span>
              <input
                className="select"
                type="text"
                value={memberlistSearch}
                placeholder="Search guild or player"
                onChange={(event) => setMemberlistSearch(event.target.value)}
                onFocus={() => {
                  setSearchHasFocus(true)
                  setSearchOpen(true)
                }}
                onBlur={() => setSearchHasFocus(false)}
                onKeyDown={handleSearchKeyDown}
              />
            </label>
            {searchOpen && (searchHasFocus || searchTerm.length > 0) && (
              <div className="search-dropdown">
                {!searchTerm && (
                  <div className="search-empty">Type to search latest roster.</div>
                )}
                {searchTerm && !flatHits.length && (
                  <div className="search-empty">No results.</div>
                )}
                {searchTerm && flatHits.length > 0 && (
                  <>
                    <div className="search-section-title">Guilds</div>
                    {guildHits.length === 0 && (
                      <div className="search-empty">No guild matches.</div>
                    )}
                    {guildHits.map((guild, index) => {
                      const guildPlayerKeys = playersByGuild.get(guild.guildKey) ?? []
                      const canAdd = guildPlayerKeys.length > 0
                      const rowIndex = index
                      return (
                        <div
                          key={guild.guildKey}
                          className={`search-row ${
                            activeSearchIndex === rowIndex ? 'active' : ''
                          }`}
                          onMouseEnter={() => setActiveSearchIndex(rowIndex)}
                        >
                          <div className="search-meta">
                            <div className="search-label">{guild.guildName}</div>
                            <div className="search-sub">
                              {guild.memberCount} members in latest scan
                            </div>
                          </div>
                          <button
                            className="btn ghost search-add"
                            disabled={!canAdd}
                            onClick={() => addGuildToPool(guild.guildKey)}
                          >
                            Add
                          </button>
                        </div>
                      )
                    })}
                    <div className="search-section-title">Players</div>
                    {playerHits.length === 0 && (
                      <div className="search-empty">No player matches.</div>
                    )}
                    {playerHits.map((player, index) => {
                      const rowIndex = guildHits.length + index
                      return (
                        <div
                          key={player.playerKey}
                          className={`search-row ${
                            activeSearchIndex === rowIndex ? 'active' : ''
                          }`}
                          onMouseEnter={() => setActiveSearchIndex(rowIndex)}
                        >
                          <div className="search-meta">
                            <div className="search-label">{player.name}</div>
                            <div className="search-sub">
                              {player.guildName ?? player.guildKey ?? '-'}
                            </div>
                          </div>
                          <button
                            className="btn ghost search-add"
                            onClick={() => addPlayersToPool([player.playerKey])}
                          >
                            Add
                          </button>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid three-col">
        {MEMBERLIST_COLUMNS.map((columnKey) => {
          const columnValues = memberlistColumns[columnKey] ?? []
          const slotCount = Math.max(MAX_MEMBERLIST_SLOTS, columnValues.length)
          const slots = Array.from({ length: slotCount }, (_, idx) => columnValues[idx] ?? null)
          const columnLabel =
            columnKey === 'col-1' ? 'Playerpool' : guildCardLabels[columnKey]
          return (
            <div
              key={columnKey}
              className={`card memberlist-card ${
                dragOverColumn === columnKey ? 'memberlist-drop' : ''
              }`}
              onDragOver={handleDragOver(columnKey)}
              onDragEnter={handleDragOver(columnKey)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(columnKey)}
            >
              <div className="card-header">
                <h2 className="card-title">{columnLabel}</h2>
                <span className="badge subtle">{memberlistColumns[columnKey]?.length ?? 0}</span>
              </div>
              <div className="memberlist-slots">
                {slots.map((playerKey, slotIndex) => {
                  const player = playerKey ? memberPlayerMap.get(playerKey) : null
                  return (
                    <div
                      key={`${columnKey}-${slotIndex}`}
                      className={`memberlist-slot ${player ? 'filled' : 'empty'}`}
                      draggable={Boolean(player)}
                      onDragStart={(event) => {
                        if (!playerKey) return
                        event.dataTransfer.setData('text/plain', playerKey)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      <span className="memberlist-slot-index">{slotIndex + 1}</span>
                      <span className="memberlist-slot-name">
                        {columnKey === 'col-1' && player && (
                          <button
                            type="button"
                            className="memberlist-slot-remove"
                            onClick={(event) => {
                              event.stopPropagation()
                              removePlayerFromPool(player.playerKey)
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            draggable={false}
                            aria-label={`Remove ${player.name} from playerpool`}
                          >
                            -
                          </button>
                        )}
                        {player?.name ?? 'Empty'}
                      </span>
                      <span className="memberlist-slot-meta">
                        {player?.guildName ?? player?.guildKey ?? '-'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </section>

      {compareCards.length > 0 && (
        <section className="card">
          <h2 className="card-title">Guild Cards</h2>
          <div className="compare-grid">
            {compareCards.map((card) => (
              <div key={card.key} className="compare-card">
                <div className="compare-title">{guildCardLabels[card.key]}</div>
                <div className="compare-row">
                  <span>Members</span>
                  <span>{card.members}</span>
                </div>
                <div className="compare-row">
                  <span>BaseStats/Day</span>
                  <span>{formatNumber(card.baseStatsPerDayYear, 1)}</span>
                </div>
                <div className="compare-row">
                  <span>Level Median</span>
                  <span>{formatNumber(card.levelMedianLatest, 0)}</span>
                </div>
                <div className="compare-row">
                  <span>Mine Pace</span>
                  <span>{formatNumber(card.minePerDayYear, 2)}</span>
                </div>
                <div className="compare-row">
                  <span>Treasury Pace</span>
                  <span>{formatNumber(card.treasuryPerDayYear, 2)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
