import { computeDataset } from '../data/compute'
import { mappedScanToNormalized } from '../data/bridge/mappedScanToNormalized'
import { getAdapter } from '../data/normalization'
import { mapSfScanJson } from '../lib/sfscan/mapSfScanJson'
import type {
  GuildRosterEntry,
  LatestPlayerEntry,
  ManifestSnapshot,
  NormalizedSnapshot,
  ScanLoadError,
  SaveIndexResult,
  SaveIndexGuildSeries,
  SaveIndexPlayerSeries,
  ScanSource,
} from '../data/types'
import type { WorkerRequest, WorkerResponse } from './types'

const ctx = self as unknown as {
  postMessage: (message: WorkerResponse) => void
  onmessage: (event: MessageEvent<WorkerRequest>) => void
}

type RepoCachePlayer = {
  playerKey: string
  name: string
  guildKey: string
  guildName: string
  save: unknown[]
}

type RepoCacheSnapshot = {
  scannedAt: string
  players: RepoCachePlayer[]
  guilds: GuildRosterEntry[]
}

let repoCache: RepoCacheSnapshot[] = []

const postProgress = (message: string) => {
  ctx.postMessage({ type: 'progress', message } satisfies WorkerResponse)
}

const PREVIEW_LIMIT = 300

type FetchMeta = {
  id: string
  label: string
  path: string
}

const truncatePreview = (value: string) =>
  value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}...` : value

const isJsonContentType = (value: string | null) =>
  typeof value === 'string' && value.toLowerCase().includes('json')

const buildScanLoadError = (
  meta: FetchMeta,
  url: string,
  status: number,
  contentType: string | null,
  reason: string,
  preview?: string,
): ScanLoadError => ({
  id: meta.id,
  label: meta.label,
  path: meta.path,
  url,
  status,
  contentType,
  reason,
  preview: preview ? truncatePreview(preview) : undefined,
})

const isScanLoadError = (error: unknown): error is ScanLoadError =>
  typeof error === 'object' &&
  error !== null &&
  'id' in error &&
  'label' in error &&
  'url' in error &&
  'reason' in error

const fetchJson = async (url: string, meta: FetchMeta): Promise<unknown> => {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Network error'
    throw buildScanLoadError(meta, url, 0, null, reason)
  }

  const contentType = response.headers.get('content-type')
  let cachedText: string | null = null
  const readText = async () => {
    if (cachedText === null) {
      try {
        cachedText = await response.text()
      } catch {
        cachedText = ''
      }
    }
    return cachedText
  }

  if (!response.ok) {
    const preview = await readText()
    throw buildScanLoadError(
      meta,
      url,
      response.status,
      contentType,
      'Request failed',
      preview,
    )
  }

  if (!isJsonContentType(contentType)) {
    const preview = await readText()
    throw buildScanLoadError(
      meta,
      url,
      response.status,
      contentType,
      'Non-JSON response',
      preview,
    )
  }

  const text = await readText()
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invalid JSON'
    throw buildScanLoadError(meta, url, response.status, contentType, reason, text)
  }
}

const toScanLoadError = (error: unknown, fallback: FetchMeta & { url: string }): ScanLoadError => {
  if (isScanLoadError(error)) {
    return error
  }
  const reason = error instanceof Error ? error.message : 'Unknown error'
  return buildScanLoadError(fallback, fallback.url, 0, null, reason)
}

const formatScanLoadError = (error: ScanLoadError) => {
  const status = error.status ? `HTTP ${error.status}` : 'Request failed'
  const contentType = error.contentType ?? 'unknown'
  return `${error.label} (${error.id}) failed: ${error.reason}. ${status}, content-type ${contentType}. URL: ${error.url}`
}

const toDate = (value: string) => new Date(value)

const getLatestSnapshot = (
  snapshots: NormalizedSnapshot[],
): NormalizedSnapshot | undefined => {
  if (!snapshots.length) return undefined
  let latest = snapshots[0]
  let latestTime = toDate(latest.scannedAt).getTime()
  for (let i = 1; i < snapshots.length; i += 1) {
    const snapshot = snapshots[i]
    const time = toDate(snapshot.scannedAt).getTime()
    if (Number.isNaN(time)) {
      continue
    }
    if (Number.isNaN(latestTime) || time > latestTime) {
      latest = snapshot
      latestTime = time
    }
  }
  return latest
}

const buildGuildRoster = (snapshot?: NormalizedSnapshot): GuildRosterEntry[] => {
  if (!snapshot) return []
  return snapshot.guilds.map((guild) => ({
    guildKey: guild.guildKey,
    guildName: guild.guildName,
    memberCount: guild.members.length,
  }))
}

const buildLatestPlayers = (snapshot?: NormalizedSnapshot): LatestPlayerEntry[] => {
  if (!snapshot) return []
  return snapshot.guilds.flatMap((guild) =>
    guild.members.map((member) => ({
      playerKey: member.playerKey,
      name: member.name,
      server: member.server,
      playerId: member.playerId,
      guildKey: guild.guildKey,
      guildName: guild.guildName,
    })),
  )
}

const resolveDefaultGuilds = (roster: GuildRosterEntry[]) =>
  [...roster]
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 2)
    .map((entry) => entry.guildKey)

const parseIdFromIdentifier = (identifier: unknown, pattern: RegExp): number | undefined => {
  if (typeof identifier !== 'string') return undefined
  const match = pattern.exec(identifier)
  if (!match?.[1]) return undefined
  const num = Number.parseInt(match[1], 10)
  return Number.isFinite(num) ? num : undefined
}

const parseGuildId = (identifier: unknown): number | undefined =>
  parseIdFromIdentifier(identifier, /_g(\d+)/)

const normalizeServer = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

const buildPlayerKey = (server: string, playerId?: string, name?: string) => {
  if (playerId) {
    return `${server}_${playerId}`
  }
  return `${name ?? 'unknown'}|${server}`
}

const buildRepoCache = (scan: ReturnType<typeof mapSfScanJson>): RepoCacheSnapshot => {
  const normalized = mappedScanToNormalized(scan)
  const guildNameMap = new Map<string, string>()
  scan.groups.forEach((group) => {
    const raw = group.raw as Record<string, unknown>
    const identifier = typeof raw.identifier === 'string' ? raw.identifier : group.guildIdentifier
    if (!identifier) return
    const name = typeof raw.name === 'string' ? raw.name : identifier
    guildNameMap.set(identifier, name)
  })

  const players: RepoCachePlayer[] = scan.players.map((player) => {
    const raw = player.raw as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : `Player ${player.index + 1}`
    const server = normalizeServer(player.server) ?? normalizeServer(raw.prefix) ?? 'unknown'
    const playerKey = buildPlayerKey(server, player.playerId?.toString(), name)
    const guildIdentifier = typeof raw.group === 'string' ? raw.group : player.guildIdentifier
    const guildId = guildIdentifier ? parseGuildId(guildIdentifier) : player.guildId
    const fallbackGuildKey =
      guildId !== undefined ? `${server}_g${guildId}` : `${server}_g_unknown`
    const guildKey = guildIdentifier ?? fallbackGuildKey
    const guildName = guildNameMap.get(guildKey) ?? guildKey
    const save = Array.isArray(raw.save) ? (raw.save as unknown[]) : []
    return {
      playerKey,
      name,
      guildKey,
      guildName,
      save,
    }
  })

  return {
    scannedAt: normalized.scannedAt,
    players,
    guilds: buildGuildRoster(normalized),
  }
}

const manifestFromRepoScans = (
  sources: ScanSource[],
  normalized: NormalizedSnapshot[],
  datasetId: string,
): ManifestSnapshot[] =>
  normalized.map((snapshot, index) => {
    const source = sources[index]
    return {
      id: source?.id ?? `scan-${index + 1}`,
      label: source?.label ?? `Scan ${index + 1}`,
      date: snapshot.scannedAt.slice(0, 10),
      format: 'repo-scan',
      path: source?.path ?? '',
      scope: 'repo',
      datasetId,
      notes: source?.notes,
    }
  })

const getSaveIndexValue = (save: unknown[], index: number) => {
  const value = save[index]
  if (typeof value === 'number') return value
  const num = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(num) ? num : 0
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

const computeSaveIndexResult = (index: number, guildFilterKeys?: string[]): SaveIndexResult => {
  const filter = guildFilterKeys?.length ? new Set(guildFilterKeys) : null
  const snapshotsSorted = [...repoCache].sort(
    (a, b) => toDate(a.scannedAt).getTime() - toDate(b.scannedAt).getTime(),
  )
  const playerSeriesMap = new Map<string, SaveIndexPlayerSeries>()
  const guildSeriesMap = new Map<string, SaveIndexGuildSeries>()

  snapshotsSorted.forEach((snapshot) => {
    const guildValues = new Map<string, number[]>()
    snapshot.players.forEach((player) => {
      if (filter && !filter.has(player.guildKey)) {
        return
      }
      const value = getSaveIndexValue(player.save, index)
      const entry = playerSeriesMap.get(player.playerKey) ?? {
        playerKey: player.playerKey,
        name: player.name,
        guildKey: player.guildKey,
        points: [],
      }
      entry.points.push({ date: snapshot.scannedAt, value })
      playerSeriesMap.set(player.playerKey, entry)

      const list = guildValues.get(player.guildKey) ?? []
      list.push(value)
      guildValues.set(player.guildKey, list)
    })

    snapshot.guilds.forEach((guild) => {
      if (filter && !filter.has(guild.guildKey)) {
        return
      }
      const values = guildValues.get(guild.guildKey) ?? []
      const entry = guildSeriesMap.get(guild.guildKey) ?? {
        guildKey: guild.guildKey,
        guildName: guild.guildName,
        points: [],
      }
      entry.points.push({ date: snapshot.scannedAt, value: median(values) })
      guildSeriesMap.set(guild.guildKey, entry)
    })
  })

  const rangeStart = snapshotsSorted[0]?.scannedAt ?? ''
  const latestDate = snapshotsSorted[snapshotsSorted.length - 1]?.scannedAt ?? ''
  return {
    index,
    rangeStart,
    latestDate,
    players: Array.from(playerSeriesMap.values()),
    guilds: Array.from(guildSeriesMap.values()),
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'compute-save-index') {
    if (!repoCache.length) {
      ctx.postMessage({ type: 'error', error: 'Save index cache missing.' } satisfies WorkerResponse)
      return
    }
    const result = computeSaveIndexResult(event.data.index, event.data.guildFilterKeys)
    ctx.postMessage({ type: 'save-index-result', payload: result } satisfies WorkerResponse)
    return
  }

  try {
    if (event.data.type === 'process-manifest') {
      repoCache = []
      const { snapshots, format, baseUrl, datasetId, guildFilterKeys, memberlistColumns } =
        event.data
      const adapter = getAdapter(format)
      if (!adapter) {
        throw new Error(`No adapter found for format ${format}`)
      }

      postProgress('Loading snapshots...')
      const normalized: NormalizedSnapshot[] = []
      for (const snapshot of snapshots) {
        postProgress(`Fetching ${snapshot.label}`)
        const url = new URL(snapshot.path, baseUrl).toString()
        const raw = await fetchJson(url, {
          id: snapshot.id,
          label: snapshot.label,
          path: snapshot.path,
        })
        const parsed = adapter.normalize(raw, snapshot)
        normalized.push(parsed)
      }

      const latestSnapshot = getLatestSnapshot(normalized)
      const roster = buildGuildRoster(latestSnapshot)
      const latestPlayers = buildLatestPlayers(latestSnapshot)
      const defaultGuildKeys = resolveDefaultGuilds(roster)

      postProgress('Computing metrics...')
      const result = computeDataset(normalized, snapshots, datasetId, {
        guildFilterKeys,
        memberlistColumns,
      })
      result.guildRoster = roster
      result.defaultGuildKeys = defaultGuildKeys
      result.latestPlayers = latestPlayers
      ctx.postMessage({ type: 'result', datasetId, payload: result } satisfies WorkerResponse)
      return
    }

    if (event.data.type === 'process-repo-scans') {
      const {
        baseUrl,
        datasetId,
        scanSources,
        selectedScanIds,
        guildFilterKeys,
        memberlistColumns,
      } = event.data
      const selectedSources = scanSources.filter((source) => selectedScanIds.includes(source.id))
      if (!selectedSources.length) {
        throw new Error('No scan sources selected.')
      }

      postProgress('Loading repo scans...')
      const normalized: NormalizedSnapshot[] = []
      repoCache = []
      const loadedSources: ScanSource[] = []
      const errors: ScanLoadError[] = []
      for (const source of selectedSources) {
        postProgress(`Fetching ${source.label}`)
        const url = new URL(source.path, baseUrl).toString()
        try {
          const raw = await fetchJson(url, {
            id: source.id,
            label: source.label,
            path: source.path,
          })
          const mapped = mapSfScanJson(raw as Record<string, unknown>)
          const snapshot = mappedScanToNormalized(mapped)
          normalized.push(snapshot)
          repoCache.push(buildRepoCache(mapped))
          loadedSources.push(source)
        } catch (error) {
          errors.push(
            toScanLoadError(error, {
              id: source.id,
              label: source.label,
              path: source.path,
              url,
            }),
          )
        }
      }

      if (!normalized.length) {
        const message = errors.length
          ? `All selected scans failed to load. ${formatScanLoadError(errors[0])}`
          : 'All selected scans failed to load.'
        ctx.postMessage({
          type: 'error',
          error: message,
          errors: errors.length ? errors : undefined,
        } satisfies WorkerResponse)
        return
      }

      const latestSnapshot = getLatestSnapshot(normalized)
      const roster = buildGuildRoster(latestSnapshot)
      const latestPlayers = buildLatestPlayers(latestSnapshot)
      const defaultGuildKeys = resolveDefaultGuilds(roster)
      const manifestSnapshots = manifestFromRepoScans(loadedSources, normalized, datasetId)

      postProgress('Computing metrics...')
      const result = computeDataset(normalized, manifestSnapshots, datasetId, {
        guildFilterKeys,
        memberlistColumns,
      })
      result.guildRoster = roster
      result.defaultGuildKeys = defaultGuildKeys
      result.latestPlayers = latestPlayers
      ctx.postMessage({
        type: 'result',
        datasetId,
        payload: result,
        errors: errors.length ? errors : undefined,
      } satisfies WorkerResponse)
      return
    }
  } catch (error) {
    const message = isScanLoadError(error)
      ? formatScanLoadError(error)
      : error instanceof Error
        ? error.message
        : 'Unknown worker error'
    ctx.postMessage({
      type: 'error',
      error: message,
      errors: isScanLoadError(error) ? [error] : undefined,
    } satisfies WorkerResponse)
  }
}
