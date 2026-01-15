import type { MappedPlayer, MappedScan, RawScanPlayer } from '../../lib/sfscan/types'
import { toOtherPlayer } from '../../lib/sfscan/toOther'
import type { NormalizedGuild, NormalizedMember, NormalizedSnapshot } from '../types'

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

const normalizeClassId = (value: unknown): number | undefined => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return Math.trunc(num)
}

const buildPlayerKey = (server: string, playerId?: string, name?: string) => {
  if (playerId) {
    return `${server}_${playerId}`
  }
  return `${name ?? 'unknown'}|${server}`
}

const OTHER_SAVE_LENGTH = 261
const INDEX_LEVEL = 2
const INDEX_EXP = 3
const INDEX_EXP_NEXT = 4
const INDEX_BASE_START = 21
const INDEX_BASE_END = 25
const INDEX_MINE = 212
const INDEX_TREASURY = 217

const getSaveValue = (save: unknown[], index: number): number => {
  const value = save[index]
  if (typeof value === 'number') {
    return value
  }
  const num = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(num) ? num : 0
}

const sumSaveRange = (save: unknown[], start: number, end: number): number => {
  let sum = 0
  for (let index = start; index <= end; index += 1) {
    sum += getSaveValue(save, index)
  }
  return sum
}

const getSaveArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : []

const getSave261 = (player: MappedPlayer, raw: RawScanPlayer): unknown[] => {
  const models = player.models as Record<string, unknown> | undefined
  const other = models?.other as Record<string, unknown> | undefined
  const otherSave = getSaveArray(other?.save)
  if (otherSave.length === OTHER_SAVE_LENGTH) {
    return otherSave
  }

  const rawSave = getSaveArray((raw as Record<string, unknown>).save)
  if (rawSave.length === OTHER_SAVE_LENGTH) {
    return rawSave
  }

  if (rawSave.length) {
    const converted = toOtherPlayer(raw)
    const convertedSave = getSaveArray((converted as Record<string, unknown>).save)
    if (convertedSave.length === OTHER_SAVE_LENGTH) {
      return convertedSave
    }
  }

  return []
}

const resolveTimestampSec = (scan: MappedScan): number | undefined => {
  if (typeof scan.meta.timestampSecHint === 'number') {
    return scan.meta.timestampSecHint
  }
  const playerSec = scan.players.find((player) => typeof player.timestampSec === 'number')
  if (playerSec?.timestampSec) {
    return playerSec.timestampSec
  }
  const groupSec = scan.groups.find((group) => typeof group.timestampSec === 'number')
  if (groupSec?.timestampSec) {
    return groupSec.timestampSec
  }
  const playerMs = scan.players.find((player) => typeof player.timestampMs === 'number')
  if (playerMs?.timestampMs) {
    return Math.floor(playerMs.timestampMs / 1000)
  }
  const groupMs = scan.groups.find((group) => typeof group.timestampMs === 'number')
  if (groupMs?.timestampMs) {
    return Math.floor(groupMs.timestampMs / 1000)
  }
  return undefined
}

export function mappedScanToNormalized(scan: MappedScan): NormalizedSnapshot {
  const scannedSec = resolveTimestampSec(scan)
  const scannedAt = scannedSec
    ? new Date(scannedSec * 1000).toISOString()
    : new Date().toISOString()

  const guildNameMap = new Map<string, string>()
  scan.groups.forEach((group) => {
    const raw = group.raw as Record<string, unknown>
    const identifier = typeof raw.identifier === 'string' ? raw.identifier : group.guildIdentifier
    if (identifier) {
      const name = typeof raw.name === 'string' ? raw.name : identifier
      guildNameMap.set(identifier, name)
    }
  })

  const guildMembers = new Map<string, NormalizedMember[]>()

  scan.players.forEach((player) => {
    const raw = player.raw as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : `Player ${player.index + 1}`
    const server = normalizeServer(player.server) ?? normalizeServer(raw.prefix) ?? 'unknown'
    const playerId = player.playerId?.toString()
    const playerKey = buildPlayerKey(server, playerId, name)
    const guildIdentifier = typeof raw.group === 'string' ? raw.group : player.guildIdentifier
    const guildId = guildIdentifier ? parseGuildId(guildIdentifier) : player.guildId
    const fallbackGuildKey =
      guildId !== undefined ? `${server}_g${guildId}` : `${server}_g_unknown`
    const guildKey = guildIdentifier ?? fallbackGuildKey
    const classId = normalizeClassId(raw.class)

    const save261 = getSave261(player, player.raw)

    const member: NormalizedMember = {
      playerKey,
      name,
      server,
      playerId: playerId,
      classId,
      baseStats: sumSaveRange(save261, INDEX_BASE_START, INDEX_BASE_END),
      level: getSaveValue(save261, INDEX_LEVEL),
      exp: getSaveValue(save261, INDEX_EXP),
      expNext: getSaveValue(save261, INDEX_EXP_NEXT),
      mine: getSaveValue(save261, INDEX_MINE),
      treasury: getSaveValue(save261, INDEX_TREASURY),
    }

    const list = guildMembers.get(guildKey) ?? []
    list.push(member)
    guildMembers.set(guildKey, list)
    if (!guildNameMap.has(guildKey)) {
      guildNameMap.set(guildKey, guildKey)
    }
  })

  const guilds: NormalizedGuild[] = Array.from(guildMembers.entries()).map(([guildKey, members]) => ({
    guildKey,
    guildName: guildNameMap.get(guildKey) ?? guildKey,
    members,
  }))

  return {
    scannedAt,
    guilds,
  }
}
