import type {
  ManifestSnapshot,
  SaveIndexResult,
  ScanSource,
  WorkerResult,
} from '../data/types'

export type WorkerRequest =
  | {
      type: 'process-manifest'
      datasetId: string
      format: string
      baseUrl: string
      snapshots: ManifestSnapshot[]
      guildFilterKeys?: string[]
      memberlistColumns?: Record<string, string[]>
    }
  | {
      type: 'process-repo-scans'
      datasetId: string
      baseUrl: string
      scanSources: ScanSource[]
      selectedScanIds: string[]
      guildFilterKeys?: string[]
      memberlistColumns?: Record<string, string[]>
    }
  | {
      type: 'compute-save-index'
      index: number
      guildFilterKeys?: string[]
    }

export type WorkerProgress = {
  type: 'progress'
  message: string
}

export type WorkerResultMessage = {
  type: 'result'
  datasetId: string
  payload: WorkerResult
}

export type WorkerSaveIndexMessage = {
  type: 'save-index-result'
  payload: SaveIndexResult
}

export type WorkerError = {
  type: 'error'
  error: string
}

export type WorkerResponse = WorkerProgress | WorkerResultMessage | WorkerSaveIndexMessage | WorkerError
