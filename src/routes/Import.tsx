import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/store'
import type { GuildRosterEntry, ScanLoadError } from '../data/types'

const toggleSelection = (list: string[], key: string, limit?: number) => {
  if (list.includes(key)) {
    return list.filter((item) => item !== key)
  }
  if (limit && list.length >= limit) {
    return list
  }
  return [...list, key]
}

const buildRoster = (guilds?: GuildRosterEntry[]) =>
  (guilds ?? []).map((guild) => ({
    key: guild.guildKey,
    name: guild.guildName,
    members: guild.memberCount,
  }))

type ServerGroupData = {
  region: string
  numbers: number[]
}

const DATE_PATTERN = /date_(\d{1,2})_(\d{1,2})_(\d{2})/
const SERVER_PATTERN = /_([a-z]+)_((?:\d+_)*\d+)_date/i

const parseDateFromPath = (path: string): Date | null => {
  const match = DATE_PATTERN.exec(path)
  if (!match) {
    return null
  }
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null
  }
  const result = new Date(Date.UTC(2000 + year, month - 1, day))
  return Number.isNaN(result.getTime()) ? null : result
}

const formatDateRange = (dates: Date[]): string | null => {
  if (!dates.length) {
    return null
  }
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const format = (value: Date) => value.toISOString().slice(0, 10)
  return `${format(sorted[0])} -> ${format(sorted[sorted.length - 1])}`
}

const parseServerGroupFromPath = (path: string): ServerGroupData | null => {
  const match = SERVER_PATTERN.exec(path.toLowerCase())
  if (!match) {
    return null
  }
  const region = match[1].toUpperCase()
  const numbers = match[2]
    .split('_')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (!numbers.length) {
    return null
  }
  return { region, numbers }
}

const formatServerGroupDisplay = ({ region, numbers }: ServerGroupData): string => {
  const unique = Array.from(new Set(numbers)).sort((a, b) => a - b)
  if (!unique.length) {
    return ''
  }
  const isContiguous = unique.every(
    (value, index) => index === 0 || value === unique[index - 1] + 1,
  )
  if (isContiguous) {
    if (unique.length === 1) {
      return `${region}${unique[0]}`
    }
    return `${region}${unique[0]}-${unique[unique.length - 1]}`
  }
  return unique.map((value) => `${region}${value}`).join(', ')
}

const buildServerSummary = (groups: ServerGroupData[]): string | null => {
  if (!groups.length) {
    return null
  }
  const merged = new Map<string, Set<number>>()
  groups.forEach((group) => {
    const existing = merged.get(group.region) ?? new Set<number>()
    group.numbers.forEach((value) => existing.add(value))
    merged.set(group.region, existing)
  })
  const entries = Array.from(merged.entries())
    .map(([region, values]) => {
      const numbers = Array.from(values)
      if (!numbers.length) {
        return null
      }
      return formatServerGroupDisplay({ region, numbers })
    })
    .filter((value): value is string => Boolean(value))
  return entries.length ? entries.join(', ') : null
}

const formatScanErrorMeta = (error: ScanLoadError) => {
  const status = error.status ? `HTTP ${error.status}` : 'Request failed'
  const contentType = error.contentType ?? 'unknown'
  return `${status}, content-type ${contentType}`
}

export default function ImportPage() {
  const {
    manifest,
    activeDataset,
    status,
    statusMessage,
    error,
    scanLoadErrors,
    result,
    scanSources,
    selectedScanIds,
    updateScanSelection,
    selectedGuildKeys,
    updateGuildSelection,
    datasets,
    selectDataset,
    loadSelectedDataset,
  } = useData()
  const [draftScanIds, setDraftScanIds] = useState<string[]>(selectedScanIds)
  const [draftGuildKeys, setDraftGuildKeys] = useState<string[]>(selectedGuildKeys)

  useEffect(() => setDraftScanIds(selectedScanIds), [selectedScanIds])
  useEffect(() => setDraftGuildKeys(selectedGuildKeys), [selectedGuildKeys, activeDataset?.id])

  const roster = useMemo(() => buildRoster(result?.guildRoster), [result?.guildRoster])
  const rosterKeys = useMemo(() => new Set(roster.map((guild) => guild.key)), [roster])
  const headerDisabled = draftScanIds.length === 0

  const repoDatasetId = useMemo(
    () => datasets.find((dataset) => dataset.format === 'repo-scan')?.id ?? null,
    [datasets],
  )

  useEffect(() => {
    if (!repoDatasetId) {
      return
    }
    if (activeDataset?.id === repoDatasetId) {
      return
    }
    selectDataset(repoDatasetId)
  }, [activeDataset?.id, repoDatasetId, selectDataset])

  useEffect(() => {
    if (!roster.length) {
      return
    }
    const filtered = selectedGuildKeys.filter((key) => rosterKeys.has(key))
    setDraftGuildKeys(filtered)
  }, [selectedGuildKeys, rosterKeys, roster.length])

  const selectionSummary = useMemo(() => {
    const selectedSources = scanSources.filter((source) => draftScanIds.includes(source.id))
    const parsedDates = selectedSources
      .map((source) => parseDateFromPath(source.path))
      .filter((value): value is Date => value !== null)
    const serverGroups = selectedSources
      .map((source) => parseServerGroupFromPath(source.path))
      .filter((value): value is ServerGroupData => Boolean(value))
    return {
      selectedCount: selectedSources.length,
      totalCount: scanSources.length,
      dateRange: formatDateRange(parsedDates),
      serverSummary: buildServerSummary(serverGroups),
    }
  }, [draftScanIds, scanSources])

  const { selectedCount, totalCount, dateRange, serverSummary } = selectionSummary

  if (!manifest) {
    return (
      <div className="page">
        <h1 className="page-title">Import & Datasets</h1>
        <div className="card">Loading manifest...</div>
      </div>
    )
  }

  const handleApplyScans = () => {
    updateScanSelection(draftScanIds)
    loadSelectedDataset({ scanIds: draftScanIds })
  }

  const handleApplyGuilds = () => {
    updateGuildSelection(draftGuildKeys)
    loadSelectedDataset({ guildKeys: draftGuildKeys })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Repo Scans Import</h1>
          <p className="page-subtitle">
            Repo scans load from public/scans for analysis.
          </p>
        </div>
        <button className="btn" onClick={handleApplyScans} disabled={headerDisabled}>
          Load Selected Scans
        </button>
      </div>

      {scanLoadErrors.length > 0 && (
        <div className="card warning">
          <div className="list">
            <div className="list-item">
              <div>
                <div className="list-title">Some scans failed to load</div>
                <div className="list-sub">The remaining scans were still processed.</div>
              </div>
            </div>
            {scanLoadErrors.map((scanError) => (
              <div key={scanError.id} className="list-item">
                <div>
                  <div className="list-title">{scanError.label}</div>
                  <div className="list-sub">{scanError.path}</div>
                  <div className="list-sub">URL: {scanError.url}</div>
                  <div className="list-sub">
                    {scanError.reason} ({formatScanErrorMeta(scanError)})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === 'error' && error && <div className="card warning">{error}</div>}
      {status === 'loading' && <div className="card">Worker: {statusMessage}</div>}

      <div className="grid two-col">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Repo Scan Selection</h2>
          </div>
          <div className="list">
            {scanSources.map((source) => (
              <label key={source.id} className="list-item checkbox-row">
                <input
                  type="checkbox"
                  checked={draftScanIds.includes(source.id)}
                  onChange={() => setDraftScanIds(toggleSelection(draftScanIds, source.id))}
                />
                <div>
                  <div className="list-title">{source.label}</div>
                  <div className="list-sub">{source.path}</div>
                  {source.notes && <div className="list-sub">{source.notes}</div>}
                </div>
              </label>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="card-title">Selection Summary</h2>
          {selectedCount === 0 ? (
            <div className="empty">Select one or more scans to see a summary.</div>
          ) : (
            <div className="list">
              <div className="list-item">
                <div>
                  <div className="list-title">
                    {selectedCount} {selectedCount === 1 ? 'scan' : 'scans'} selected
                  </div>
                  <div className="list-sub">{totalCount} scan sources available</div>
                </div>
              </div>
              {dateRange && (
                <div className="list-item">
                  <div>
                    <div className="list-title">Date range</div>
                    <div className="list-sub">{dateRange}</div>
                  </div>
                </div>
              )}
              {serverSummary && (
                <div className="list-item">
                  <div>
                    <div className="list-title">Servers / scope</div>
                    <div className="list-sub">{serverSummary}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Guild Selection</h2>
          <button className="btn" onClick={handleApplyGuilds} disabled={!draftGuildKeys.length}>
            Apply Guild Selection
          </button>
        </div>
        {roster.length === 0 ? (
          <div className="muted">Load a dataset to populate guild options.</div>
        ) : (
          <div className="list">
            {roster.map((guild) => (
              <label key={guild.key} className="list-item checkbox-row">
                <input
                  type="checkbox"
                  checked={draftGuildKeys.includes(guild.key)}
                  onChange={() =>
                    setDraftGuildKeys((current) => toggleSelection(current, guild.key, 2))
                  }
                />
                <div>
                  <div className="list-title">{guild.name}</div>
                  <div className="list-sub">{guild.members} members</div>
                </div>
                {draftGuildKeys.includes(guild.key) && <span className="badge">Selected</span>}
              </label>
            ))}
          </div>
        )}
        <div className="muted">Select up to two guilds to focus analytics.</div>
      </section>
    </div>
  )
}
