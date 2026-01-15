import { mapSfScanJson } from './mapSfScanJson'
import type { MappedScan, RawScanJson } from './types'

type LoadScanOptions = {
  baseUrl?: string
  includeOther?: boolean
}

export async function loadScanJson(path: string, options: LoadScanOptions = {}): Promise<MappedScan> {
  const baseUrl = options.baseUrl ?? new URL('./', document.baseURI).toString()
  const url = new URL(path, baseUrl).toString()
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`scan_fetch_failed_${response.status}`)
  }
  const raw = (await response.json()) as RawScanJson
  return mapSfScanJson(raw, { includeOther: options.includeOther })
}
