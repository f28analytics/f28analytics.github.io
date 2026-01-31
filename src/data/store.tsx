import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { loadManifest } from './manifest'
import { scanSources } from './scanSources'
import type {
  DatasetConfig,
  DatasetKind,
  Manifest,
  ManifestSnapshot,
  SaveIndexResult,
  ScanSource,
  ScanLoadError,
  WindowKey,
  WorkerResult,
} from './types'
import type { WorkerRequest, WorkerResponse } from '../workers/types'

type DataStatus = 'idle' | 'loading' | 'ready' | 'error' | 'custom'

type DataContextValue = {
  manifest: Manifest | null
  datasets: DatasetConfig[]
  snapshots: ManifestSnapshot[]
  activeDataset: DatasetConfig | null
  selectedDatasetId: string | null
  selectDataset: (id: string) => void
  status: DataStatus
  statusMessage: string
  error: string | null
  scanLoadErrors: ScanLoadError[]
  result: WorkerResult | null
  saveIndexResult: SaveIndexResult | null
  scanSources: ScanSource[]
  selectedScanIds: string[]
  updateScanSelection: (ids: string[]) => void
  selectedGuildKeys: string[]
  updateGuildSelection: (ids: string[]) => void
  memberlistPoolKeys: string[]
  updateMemberlistPoolKeys: (ids: string[]) => void
  defaultWindowKey: WindowKey
  updateDefaultWindowKey: (key: WindowKey) => void
  loadSelectedDataset: (options?: { guildKeys?: string[]; scanIds?: string[] }) => void
  loadSaveIndex: (index: number) => void
}

const SELECTED_DATASET_KEY = 'ga:selectedDatasetId'
const SELECTED_SCANS_KEY = 'ga:selectedScanIds'
const SELECTED_GUILDS_KEY = 'ga:selectedGuildKeys'
const MEMBERLIST_COLUMNS_KEY = 'ga:memberlistColumns'
const MEMBERLIST_POOL_KEY = 'ga:memberlistPoolKeys'
const DEFAULT_WINDOW_KEY = 'ga:defaultWindowKey'

const getBaseUrl = () => new URL(import.meta.env.BASE_URL, document.baseURI).toString()

const repoDataset: DatasetConfig = {
  id: 'repo-scans',
  label: 'Repo Scans (Bot export JSON)',
  format: 'repo-scan',
  scope: 'allGuilds',
  notes: 'Loads JSON scans from public/scans via scanSources.',
  kind: 'repo',
}

const DataContext = createContext<DataContextValue | undefined>(undefined)

const readStoredArray = (key: string, fallback: string[]) => {
  if (typeof window === 'undefined') {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed
    }
    return fallback
  } catch {
    return fallback
  }
}

const writeStoredArray = (key: string, value: string[]) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

const readStoredValue = (key: string) => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

const writeStoredValue = (key: string, value: string) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
}

const readStoredMemberlistColumns = (): Record<string, string[]> => {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(MEMBERLIST_COLUMNS_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, string[]> = {}
    Object.entries(parsed).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        next[key] = value.filter((entry): entry is string => typeof entry === 'string')
      }
    })
    return next
  } catch {
    return {}
  }
}

type PoolKeySource = {
  playerKey: string
  playerId?: string
  name: string
  server: string
}

const buildLegacyKeyMap = (source: PoolKeySource[]) => {
  const keyMap = new Map<string, string>()
  const conflicts = new Set<string>()
  source.forEach((player) => {
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

const migratePoolKeys = (keys: string[], source: PoolKeySource[]) => {
  const { keyMap, conflicts } = buildLegacyKeyMap(source)
  return keys.map((key) => {
    if (conflicts.has(key)) {
      return key
    }
    return keyMap.get(key) ?? key
  })
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null)
  const [status, setStatus] = useState<DataStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanLoadErrors, setScanLoadErrors] = useState<ScanLoadError[]>([])
  const [result, setResult] = useState<WorkerResult | null>(null)
  const [saveIndexResult, setSaveIndexResult] = useState<SaveIndexResult | null>(null)
  const [selectedScanIds, setSelectedScanIds] = useState<string[]>(
    readStoredArray(
      SELECTED_SCANS_KEY,
      scanSources.map((source) => source.id),
    ),
  )
  const [selectedGuildKeys, setSelectedGuildKeys] = useState<string[]>(
    readStoredArray(SELECTED_GUILDS_KEY, []),
  )
  const [memberlistPoolKeys, setMemberlistPoolKeys] = useState<string[]>(
    readStoredArray(MEMBERLIST_POOL_KEY, []),
  )
  const [defaultWindowKey, setDefaultWindowKey] = useState<WindowKey>(() => {
    const stored = readStoredValue(DEFAULT_WINDOW_KEY)
    if (stored === '1' || stored === '3' || stored === '6' || stored === '12') {
      return stored
    }
    return '3'
  })
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    const baseUrl = getBaseUrl()
    loadManifest(baseUrl)
      .then((data) => {
        setManifest(data)
        const storedDataset = readStoredValue(SELECTED_DATASET_KEY)
        setSelectedDatasetId(storedDataset ?? data.datasets[0]?.id ?? repoDataset.id)
      })
      .catch((err: Error) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  const datasets = useMemo<DatasetConfig[]>(() => {
    const manifestDatasets = (manifest?.datasets ?? []).map((dataset) => ({
      ...dataset,
      kind: 'manifest' as DatasetKind,
    }))
    const hasRepo = manifestDatasets.some((dataset) => dataset.id === repoDataset.id)
    return hasRepo ? manifestDatasets : [...manifestDatasets, repoDataset]
  }, [manifest])

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  )

  const snapshots = useMemo(
    () =>
      manifest?.snapshots.filter((snapshot) => snapshot.datasetId === selectedDatasetId) ?? [],
    [manifest, selectedDatasetId],
  )

  const selectDataset = (id: string) => {
    setSelectedDatasetId(id)
    writeStoredValue(SELECTED_DATASET_KEY, id)
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setScanLoadErrors([])
    setResult(null)
    setSaveIndexResult(null)
  }

  const updateScanSelection = (ids: string[]) => {
    setSelectedScanIds(ids)
    writeStoredArray(SELECTED_SCANS_KEY, ids)
  }

  const updateGuildSelection = (ids: string[]) => {
    setSelectedGuildKeys(ids)
    writeStoredArray(SELECTED_GUILDS_KEY, ids)
  }

  const updateMemberlistPoolKeys = (ids: string[]) => {
    setMemberlistPoolKeys(ids)
    writeStoredArray(MEMBERLIST_POOL_KEY, ids)
  }

  const updateDefaultWindowKey = (key: WindowKey) => {
    setDefaultWindowKey(key)
    writeStoredValue(DEFAULT_WINDOW_KEY, key)
  }

  const startWorker = () => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../workers/scanWorker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        setStatusMessage(message.message)
        return
      }
      if (message.type === 'result') {
        setScanLoadErrors(message.errors ?? [])
        setResult(message.payload)
        setStatus('ready')
        setStatusMessage('Ready')
        const rosterKeys = new Set(
          message.payload.guildRoster?.map((entry) => entry.guildKey) ?? [],
        )
        const filteredGuildKeys = selectedGuildKeys.filter((key) => rosterKeys.has(key))
        if (
          activeDataset?.format === 'repo-scan' &&
          rosterKeys.size > 0 &&
          filteredGuildKeys.length !== selectedGuildKeys.length
        ) {
          updateGuildSelection(filteredGuildKeys)
        }
        const poolSource =
          message.payload.latestPlayers ??
          message.payload.globalPlayers ??
          message.payload.players
        const playerKeySet = new Set(poolSource.map((player) => player.playerKey))
        const migratedPool = migratePoolKeys(
          memberlistPoolKeys,
          poolSource as PoolKeySource[],
        )
        const validPool = migratedPool.filter((key) => playerKeySet.has(key))
        const poolChanged =
          validPool.length !== memberlistPoolKeys.length ||
          validPool.some((key, index) => key !== memberlistPoolKeys[index])
        if (poolChanged) {
          updateMemberlistPoolKeys(validPool)
        }
        if (
          activeDataset?.format === 'repo-scan' &&
          filteredGuildKeys.length === 0 &&
          message.payload.defaultGuildKeys?.length
        ) {
          const defaults = message.payload.defaultGuildKeys
          updateGuildSelection(defaults)
          setStatus('loading')
          setStatusMessage('Applying default guild selection...')
          setTimeout(() => loadSelectedDataset({ guildKeys: defaults }), 0)
        }
        return
      }
      if (message.type === 'save-index-result') {
        setSaveIndexResult(message.payload)
        return
      }
      if (message.type === 'error') {
        setError(message.error)
        setScanLoadErrors(message.errors ?? [])
        setStatus('error')
        setStatusMessage('Error')
      }
    }

    worker.onerror = (event) => {
      setError(event.message)
      setStatus('error')
    }

    return worker
  }

  const loadSelectedDataset = (options?: { guildKeys?: string[]; scanIds?: string[] }) => {
    if (!activeDataset) {
      return
    }
    if (activeDataset.format === 'custom-raw') {
      setStatus('custom')
      setStatusMessage('Custom parsing not configured.')
      setError(null)
      setScanLoadErrors([])
      setResult(null)
      return
    }

    const baseUrl = getBaseUrl()
    const guildFilterKeys = options?.guildKeys ?? selectedGuildKeys

    const memberlistColumns = readStoredMemberlistColumns()

    if (activeDataset.format === 'repo-scan') {
      const scanIds = options?.scanIds ?? selectedScanIds
      if (!scanIds.length) {
        setStatus('error')
        setError('Select at least one scan source.')
        setScanLoadErrors([])
        setResult(null)
        return
      }
      setStatus('loading')
      setStatusMessage('Starting worker...')
      setError(null)
      setScanLoadErrors([])
      setSaveIndexResult(null)

      const worker = startWorker()
      const request: WorkerRequest = {
        type: 'process-repo-scans',
        datasetId: activeDataset.id,
        baseUrl,
        scanSources,
        selectedScanIds: scanIds,
        guildFilterKeys: guildFilterKeys.length ? guildFilterKeys : undefined,
        memberlistColumns,
      }
      worker.postMessage(request)
      return
    }

    if (!snapshots.length) {
      setStatus('error')
      setError('No snapshots found for this dataset.')
      setResult(null)
      return
    }

    setStatus('loading')
    setStatusMessage('Starting worker...')
    setError(null)
    setScanLoadErrors([])
    setSaveIndexResult(null)

    const worker = startWorker()
    const request: WorkerRequest = {
      type: 'process-manifest',
      datasetId: activeDataset.id,
      format: activeDataset.format,
      baseUrl,
      snapshots,
      guildFilterKeys: guildFilterKeys.length ? guildFilterKeys : undefined,
      memberlistColumns,
    }
    worker.postMessage(request)
  }

  const loadSaveIndex = (index: number) => {
    if (!workerRef.current) {
      return
    }
    setSaveIndexResult(null)
    const request: WorkerRequest = {
      type: 'compute-save-index',
      index,
      guildFilterKeys: selectedGuildKeys.length ? selectedGuildKeys : undefined,
    }
    workerRef.current.postMessage(request)
  }

  const value: DataContextValue = {
    manifest,
    datasets,
    snapshots,
    activeDataset,
    selectedDatasetId,
    selectDataset,
    status,
    statusMessage,
    error,
    scanLoadErrors,
    result,
    saveIndexResult,
    scanSources,
    selectedScanIds,
    updateScanSelection,
    selectedGuildKeys,
    updateGuildSelection,
    memberlistPoolKeys,
    updateMemberlistPoolKeys,
    defaultWindowKey,
    updateDefaultWindowKey,
    loadSelectedDataset,
    loadSaveIndex,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData must be used within DataProvider')
  }
  return context
}
