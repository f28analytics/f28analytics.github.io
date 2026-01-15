export type JsonRecord = Record<string, unknown>

export type RawScanJson = {
  players?: unknown
  groups?: unknown
  [key: string]: unknown
}

export type RawScanPlayer = JsonRecord
export type RawScanGroup = JsonRecord

export type PlayerModelViews = {
  other?: unknown
}

export type GroupModelViews = {
  other?: unknown
}

export type MappedPlayer = {
  server?: string
  playerId?: number
  guildIdentifier?: string
  guildId?: number
  timestampMs?: number
  timestampSec?: number
  raw: RawScanPlayer
  index: number
  models?: PlayerModelViews
}

export type MappedGroup = {
  server?: string
  guildIdentifier?: string
  guildId?: number
  timestampMs?: number
  timestampSec?: number
  raw: RawScanGroup
  index: number
  models?: GroupModelViews
}

export type MappedScan = {
  players: MappedPlayer[]
  groups: MappedGroup[]
  meta: {
    playersTotal: number
    groupsTotal: number
    servers: string[]
    timestampSecHint?: number
  }
  raw: RawScanJson
}
