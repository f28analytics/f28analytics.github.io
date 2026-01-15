import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { useData } from '../data/store'
import { formatNumber } from '../ui/format'

export default function Guilds() {
  const { result } = useData()
  const [rosterOrder, setRosterOrder] = useState<string[]>([])
  const [dragOverRoster, setDragOverRoster] = useState<string | null>(null)

  const rosterRows = useMemo(() => {
    if (!result) return []
    return result.guilds.map((guild) => {
      const latest = guild.points[guild.points.length - 1]
      return {
        key: guild.guildKey,
        name: guild.guildName,
        members: latest?.memberCount ?? 0,
        baseStats: latest?.baseStatsMedian ?? 0,
        level: latest?.levelMedian ?? 0,
        mine: latest?.mineMedian ?? 0,
        treasury: latest?.treasuryMedian ?? 0,
      }
    })
  }, [result])

  useEffect(() => {
    if (!rosterRows.length) {
      setRosterOrder([])
      return
    }
    setRosterOrder((current) => {
      const keys = rosterRows.map((row) => row.key)
      const filtered = current.filter((key) => keys.includes(key))
      const missing = keys.filter((key) => !filtered.includes(key))
      return [...filtered, ...missing]
    })
  }, [rosterRows])

  const orderedRosterRows = useMemo(() => {
    if (!rosterOrder.length) {
      return rosterRows
    }
    const rowMap = new Map(rosterRows.map((row) => [row.key, row]))
    const ordered = rosterOrder.map((key) => rowMap.get(key)).filter(Boolean)
    const remaining = rosterRows.filter((row) => !rosterOrder.includes(row.key))
    return [...ordered, ...remaining]
  }, [rosterOrder, rosterRows])

  const handleRosterDragStart =
    (key: string) => (event: DragEvent<HTMLTableRowElement>) => {
      event.dataTransfer.setData('text/plain', key)
      event.dataTransfer.effectAllowed = 'move'
    }

  const handleRosterDragOver =
    (key: string) => (event: DragEvent<HTMLTableRowElement>) => {
      event.preventDefault()
      setDragOverRoster(key)
    }

  const handleRosterDragLeave = () => setDragOverRoster(null)

  const handleRosterDrop =
    (targetKey: string) => (event: DragEvent<HTMLTableRowElement>) => {
      event.preventDefault()
      const sourceKey = event.dataTransfer.getData('text/plain')
      if (!sourceKey || sourceKey === targetKey) {
        setDragOverRoster(null)
        return
      }
      setRosterOrder((current) => {
        const baseOrder = current.length ? [...current] : rosterRows.map((row) => row.key)
        const fromIndex = baseOrder.indexOf(sourceKey)
        const toIndex = baseOrder.indexOf(targetKey)
        if (fromIndex === -1 || toIndex === -1) {
          return current
        }
        baseOrder.splice(fromIndex, 1)
        baseOrder.splice(toIndex, 0, sourceKey)
        return baseOrder
      })
      setDragOverRoster(null)
    }

  if (!result) {
    return (
      <div className="page">
        <h1 className="page-title">Guilds</h1>
        <div className="card">Load a dataset to compare guilds.</div>
      </div>
    )
  }

  const compareGuilds = result.guilds.slice(0, 2)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Guilds</h1>
          <p className="page-subtitle">Guild-level comparison and roster summaries.</p>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">Roster Summary</h2>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Guild</th>
                <th>Members</th>
                <th>BaseStats Median</th>
                <th>Level Median</th>
                <th>Mine Median</th>
                <th>Treasury Median</th>
              </tr>
            </thead>
            <tbody>
              {orderedRosterRows.map((row, index) => (
                <tr
                  key={row.key}
                  className={`table-row-draggable ${
                    dragOverRoster === row.key ? 'table-row-drop' : ''
                  }`}
                  draggable
                  onDragStart={handleRosterDragStart(row.key)}
                  onDragOver={handleRosterDragOver(row.key)}
                  onDragEnter={handleRosterDragOver(row.key)}
                  onDragLeave={handleRosterDragLeave}
                  onDrop={handleRosterDrop(row.key)}
                >
                  <td>
                    <div className="table-name">
                      <span>{row.name}</span>
                      {index === 0 && <span className="badge badge-main table-chip">Main</span>}
                    </div>
                  </td>
                  <td>{row.members}</td>
                  <td>{formatNumber(row.baseStats, 0)}</td>
                  <td>{formatNumber(row.level, 0)}</td>
                  <td>{formatNumber(row.mine, 0)}</td>
                  <td>{formatNumber(row.treasury, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {compareGuilds.length === 2 && (
        <section className="card">
          <h2 className="card-title">Compare</h2>
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
    </div>
  )
}
