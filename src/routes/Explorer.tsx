import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { SaveIndexResult } from '../data/types'
import LineChart from '../ui/charts/LineChart'
import { formatDate, formatNumber } from '../ui/format'

const LABEL_KEY = 'ga:saveIndexLabels'

const readLabels = () => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LABEL_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const writeLabels = (labels: Record<string, string>) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LABEL_KEY, JSON.stringify(labels))
}

const getLatestValue = (points: { date: string; value: number }[]) =>
  points.length ? points[points.length - 1].value : 0

export default function Explorer() {
  const { result, saveIndexResult, loadSaveIndex, activeDataset } = useData()
  const [indexInput, setIndexInput] = useState('528')
  const [mode, setMode] = useState<'save' | 'baseStats'>('save')
  const [label, setLabel] = useState('')
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string>('')

  const baseStatsResult: SaveIndexResult | null = useMemo(() => {
    if (!result) return null
    return {
      index: -1,
      rangeStart: result.rangeStart,
      latestDate: result.latestDate,
      players: result.players.map((player) => ({
        playerKey: player.playerKey,
        name: player.name,
        guildKey: player.latestGuildKey,
        points: player.points.map((point) => ({ date: point.date, value: point.baseStats })),
      })),
      guilds: result.guilds.map((guild) => ({
        guildKey: guild.guildKey,
        guildName: guild.guildName,
        points: guild.points.map((point) => ({ date: point.date, value: point.baseStatsMedian })),
      })),
    }
  }, [result])

  const activeResult = mode === 'baseStats' ? baseStatsResult : saveIndexResult

  useEffect(() => {
    if (!activeResult?.players.length) {
      setSelectedPlayerKey('')
      return
    }
    setSelectedPlayerKey(activeResult.players[0].playerKey)
  }, [activeResult])

  useEffect(() => {
    const labels = readLabels()
    setLabel(labels[indexInput] ?? '')
  }, [indexInput])

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Explorer</h1>
        <div className="card">Load a dataset to use the explorer.</div>
      </div>
    )
  }

  const canLoadIndex = activeDataset?.format === 'repo-scan'

  const handleLoad = (override?: number) => {
    if (!canLoadIndex) {
      return
    }
    const parsed = typeof override === 'number' ? override : Number(indexInput)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return
    }
    setMode('save')
    loadSaveIndex(parsed)
  }

  const handleSaveLabel = () => {
    const labels = readLabels()
    if (label.trim().length) {
      labels[indexInput] = label.trim()
    } else {
      delete labels[indexInput]
    }
    writeLabels(labels)
  }

  const topPlayers = activeResult
    ? [...activeResult.players]
        .sort((a, b) => getLatestValue(b.points) - getLatestValue(a.points))
        .slice(0, 10)
    : []

  const selectedPlayer = activeResult?.players.find(
    (player) => player.playerKey === selectedPlayerKey,
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Explorer</h1>
          <p className="page-subtitle">Save index explorer with quick presets.</p>
        </div>
      </div>

      <section className="card">
        <div className="filters">
          <label className="filter">
            <span>Save Index</span>
            <input
              className="select"
              type="number"
              min={0}
              value={indexInput}
              onChange={(event) => setIndexInput(event.target.value)}
            />
          </label>
          <label className="filter">
            <span>Label</span>
            <input
              className="select"
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button className="btn" onClick={() => handleLoad()}>
            Load Index
          </button>
          <button className="btn ghost" onClick={handleSaveLabel}>
            Save Label
          </button>
        </div>
        <div className="tabs">
          <button className={`tab ${mode === 'baseStats' ? 'active' : ''}`} onClick={() => setMode('baseStats')}>
            BaseStats (30-34 sum)
          </button>
          <button className="tab" onClick={() => { setIndexInput('7'); handleLoad(7) }}>
            Level (7)
          </button>
          <button className="tab" onClick={() => { setIndexInput('528'); handleLoad(528) }}>
            GemMine (528)
          </button>
          <button className="tab" onClick={() => { setIndexInput('533'); handleLoad(533) }}>
            Treasury (533)
          </button>
        </div>
        <div className="muted">
          Range {formatDate(activeResult?.rangeStart)} to {formatDate(activeResult?.latestDate)}
        </div>
        {!canLoadIndex && (
          <div className="muted">Save index explorer requires Repo Scans dataset.</div>
        )}
      </section>

      {!activeResult && (
        <section className="card">
          <div className="muted">Load a save index to view time series data.</div>
        </section>
      )}

      {activeResult && (
        <section className="grid two-col">
          <div className="card">
            <h2 className="card-title">Guild Median Series</h2>
            {activeResult.guilds.map((guild) => (
              <div key={guild.guildKey} className="chart-stack">
                <div className="list-title">{guild.guildName}</div>
                <LineChart points={guild.points.map((point) => ({ date: point.date, value: point.value }))} />
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Player Series</h2>
              <select
                className="select"
                value={selectedPlayerKey}
                onChange={(event) => setSelectedPlayerKey(event.target.value)}
              >
                {activeResult.players.map((player) => (
                  <option key={player.playerKey} value={player.playerKey}>
                    {player.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedPlayer ? (
              <>
                <LineChart
                  points={selectedPlayer.points.map((point) => ({
                    date: point.date,
                    value: point.value,
                  }))}
                />
                <div className="muted">
                  Latest {formatNumber(getLatestValue(selectedPlayer.points), 2)}
                </div>
              </>
            ) : (
              <div className="muted">Select a player to view details.</div>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Top Players (Latest Value)</h2>
        <div className="list">
          {topPlayers.map((player) => (
            <div key={`top-${player.playerKey}`} className="list-item">
              <div>
                <div className="list-title">{player.name}</div>
                <div className="list-sub">{player.guildKey ?? '-'}</div>
              </div>
              <div className="metric-inline">
                {formatNumber(getLatestValue(player.points), 2)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
