import type {
  JsonRecord,
  MappedGroup,
  MappedPlayer,
  MappedScan,
  RawScanGroup,
  RawScanJson,
  RawScanPlayer,
} from './types'
import { toOtherGroup, toOtherPlayer } from './toOther'

type MapOptions = {
  includeOther?: boolean
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const ensureRecordArray = (value: unknown): JsonRecord[] => {
  if (typeof value === 'undefined') {
    return []
  }
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error('invalid_scan_json_structure')
  }
  return value
}

const parseIdFromIdentifier = (identifier: unknown, pattern: RegExp): number | undefined => {
  if (typeof identifier !== 'string') return undefined
  const match = pattern.exec(identifier)
  if (!match?.[1]) return undefined
  const num = Number.parseInt(match[1], 10)
  return Number.isFinite(num) ? num : undefined
}

const parsePlayerId = (identifier: unknown): number | undefined =>
  parseIdFromIdentifier(identifier, /_p(\d+)/)

const parseGuildId = (identifier: unknown): number | undefined =>
  parseIdFromIdentifier(identifier, /_g(\d+)/)

const normalizeServer = (prefix: unknown): string | undefined => {
  if (typeof prefix !== 'string') return undefined
  const trimmed = prefix.trim()
  return trimmed.length ? trimmed : undefined
}

const normalizeTimestamp = (value: unknown): { ms?: number; sec?: number } => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return {}
  const ms = num
  const sec = Math.floor(num / 1000)
  return { ms, sec }
}

export function mapSfScanJson(input: RawScanJson, options: MapOptions = {}): MappedScan {
  const includeOther = options.includeOther !== false
  const playersRaw = ensureRecordArray(input.players) as RawScanPlayer[]
  const groupsRaw = ensureRecordArray(input.groups) as RawScanGroup[]

  const players: MappedPlayer[] = playersRaw.map((raw, index) => {
    const record = raw as JsonRecord
    const server = normalizeServer(record.prefix)
    const playerId = parsePlayerId(record.identifier)
    const guildIdentifier = typeof record.group === 'string' ? (record.group as string) : undefined
    const guildId = guildIdentifier ? parseGuildId(guildIdentifier) : parseGuildId(record.identifier)
    const { ms: timestampMs, sec: timestampSec } = normalizeTimestamp(record.timestamp)

    return {
      server,
      playerId,
      guildIdentifier,
      guildId,
      timestampMs,
      timestampSec,
      raw,
      index,
      models: includeOther ? { other: toOtherPlayer(record) } : undefined,
    }
  })

  const groups: MappedGroup[] = groupsRaw.map((raw, index) => {
    const record = raw as JsonRecord
    const server = normalizeServer(record.prefix)
    const guildIdentifier =
      typeof record.identifier === 'string' ? (record.identifier as string) : undefined
    const guildId = parseGuildId(guildIdentifier)
    const { ms: timestampMs, sec: timestampSec } = normalizeTimestamp(record.timestamp)

    return {
      server,
      guildIdentifier,
      guildId,
      timestampMs,
      timestampSec,
      raw,
      index,
      models: includeOther ? { other: toOtherGroup(record) } : undefined,
    }
  })

  const servers = Array.from(
    new Set(
      [...players.map((player) => player.server), ...groups.map((group) => group.server)].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  )

  const timestampSecHint =
    players.find((player) => typeof player.timestampSec === 'number')?.timestampSec ??
    groups.find((group) => typeof group.timestampSec === 'number')?.timestampSec

  return {
    players,
    groups,
    meta: {
      playersTotal: players.length,
      groupsTotal: groups.length,
      servers,
      timestampSecHint,
    },
    raw: input,
  }
}

export const idParsers = {
  parsePlayerId,
  parseGuildId,
}
