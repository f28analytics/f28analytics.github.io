import type {
  GuildComputed,
  GuildSeries,
  GuildSeriesPoint,
  GrowthDebug,
  LevelSource,
  ScoreDebug,
  IntervalMetric,
  ManifestSnapshot,
  MetricKey,
  NormalizedSnapshot,
  PlayerComputed,
  PlayerScoreSnapshot,
  PlayerSeries,
  PlayerSeriesPoint,
  PlayerWindowMetrics,
  SnapshotSummary,
  WindowKey,
  WorkerResult,
} from '../types'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_KEYS: WindowKey[] = ['1', '3', '6', '12']
const METRIC_KEYS: MetricKey[] = ['baseStats', 'level', 'mine', 'treasury']
const EXP_LEVEL_THRESHOLD = 393
const EXP_PER_LEVEL_HIGH = 1_500_000_000
const DEFAULT_SCORE_WINDOW: WindowKey = '3'
const MINE_CAP = 100
const TREASURY_CAP = 45
const SCORE_WEIGHTS = {
  growth: 0.75,
  consistency: 0.25,
}
const GROWTH_BASELINE = 1_000_000
const GROWTH_MIN_GUILD_COUNT = 2
const SERVER_AVG_TOP_LIMIT = 150
const CONSISTENCY_EPS = 1e-6
const CONSISTENCY_RATIO_MIN = 0.5
const CONSISTENCY_RATIO_MAX = 1.5
const CONSISTENCY_GAP_K = 3
const CONSISTENCY_MAD_K = 6

type ScoreWindowMeta = {
  score: number
  growthScore: number
  growthDebug?: GrowthDebug
  scoreDebug?: ScoreDebug
  percentileTop500: number
  consistencyScore: number
  levelPer30: number | null
  lowLeveling: boolean
  coverage: number
  mineCapped: boolean
  treasuryCapped: boolean
}

type GrowthWindowInputs = {
  windowDays: number
  windowDelta: number
  baseStart: number
  baseEnd: number
  absPerDay: number
  relPerDay: number
  realGuildKey?: string
}

type GrowthGroupStats = {
  sumAbs: number
  sumRel: number
  count: number
}

type GrowthGroupAverages = {
  abs: number
  rel: number
  count: number
}

type IntervalStats = {
  sum: number
  count: number
}

type ScoreContext = {
  windowKey: WindowKey
  playerKey: string
  server: string
  points: PlayerSeriesPoint[]
  intervals: IntervalMetric[]
  levelIntervals: IntervalMetric[]
  windowMetrics: PlayerWindowMetrics
  windowMeta: Record<WindowKey, { startDate: string; endDate: string; possibleIntervals: number }>
  growthInputsByWindow?: Record<WindowKey, GrowthWindowInputs>
}

const toDate = (value: string) => new Date(value)

const diffDays = (start: string, end: string) => {
  const days = Math.round((toDate(end).getTime() - toDate(start).getTime()) / DAY_MS)
  return Math.max(1, days)
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const median = (values: number[]) => {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const mapRatio = (ratio: number) => {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0
  }
  const x = Math.log(ratio)
  return clamp(1 / (1 + Math.exp(-x)), 0, 1)
}

const medianAbsoluteDeviation = (values: number[]) => {
  if (!values.length) {
    return 0
  }
  const med = median(values)
  const deviations = values.map((value) => Math.abs(value - med))
  return median(deviations)
}

const percentileFromSorted = (sorted: number[], value: number) => {
  if (!sorted.length) {
    return 0
  }
  if (sorted.length === 1) {
    return 1
  }
  let low = 0
  let high = sorted.length - 1
  let index = -1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (sorted[mid] <= value) {
      index = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (index < 0) {
    return 0
  }
  return index / (sorted.length - 1)
}

const weightedPerDay = (intervals: IntervalMetric[]) => {
  const totalDays = intervals.reduce((sum, interval) => sum + interval.days, 0)
  const totalDelta = intervals.reduce((sum, interval) => sum + interval.delta, 0)
  return totalDays > 0 ? totalDelta / totalDays : 0
}

const resolveExpPerLevel = (level: number, expNext: number) => {
  if (expNext > 0) return expNext
  return level >= EXP_LEVEL_THRESHOLD ? EXP_PER_LEVEL_HIGH : 0
}

const computeExpDelta = (prev: PlayerSeriesPoint, curr: PlayerSeriesPoint) => {
  const prevLevel = prev.level ?? 0
  const currLevel = curr.level ?? 0
  const prevExp = prev.exp ?? 0
  const currExp = curr.exp ?? 0
  const prevPerLevel = resolveExpPerLevel(prevLevel, prev.expNext ?? 0)
  const currPerLevel = resolveExpPerLevel(currLevel, curr.expNext ?? 0)

  if (currLevel <= prevLevel) {
    return Math.max(0, currExp - prevExp)
  }

  const levelsGained = currLevel - prevLevel
  const fallbackPerLevel = prevPerLevel || currPerLevel || EXP_PER_LEVEL_HIGH

  if (prevLevel < EXP_LEVEL_THRESHOLD && currLevel >= EXP_LEVEL_THRESHOLD) {
    const levelsBelow = Math.max(0, EXP_LEVEL_THRESHOLD - prevLevel)
    const levelsAbove = currLevel - Math.max(prevLevel, EXP_LEVEL_THRESHOLD)
    let delta = Math.max(0, fallbackPerLevel - prevExp)
    if (levelsBelow > 1) {
      delta += (levelsBelow - 1) * fallbackPerLevel
    }
    if (levelsAbove > 0) {
      delta += levelsAbove * EXP_PER_LEVEL_HIGH
    }
    delta += Math.max(0, currExp)
    return delta
  }

  const perLevel = prevLevel >= EXP_LEVEL_THRESHOLD ? EXP_PER_LEVEL_HIGH : fallbackPerLevel
  let delta = Math.max(0, perLevel - prevExp)
  if (levelsGained > 1) {
    delta += (levelsGained - 1) * perLevel
  }
  delta += Math.max(0, currExp)
  return delta
}

const applyExpTotals = (points: PlayerSeriesPoint[]) => {
  if (!points.length) return
  let total = Math.max(0, points[0].exp ?? 0)
  points[0].expTotal = total
  for (let index = 1; index < points.length; index += 1) {
    total += computeExpDelta(points[index - 1], points[index])
    points[index].expTotal = total
  }
}

const buildIntervals = (
  points: PlayerSeriesPoint[],
  selector: (point: PlayerSeriesPoint) => number,
): IntervalMetric[] => {
  const intervals: IntervalMetric[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const delta = selector(end) - selector(start)
    const days = diffDays(start.date, end.date)
    intervals.push({
      startDate: start.date,
      endDate: end.date,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return intervals
}

const buildGuildIntervals = (points: GuildSeriesPoint[]): IntervalMetric[] => {
  const intervals: IntervalMetric[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const delta = end.baseStatsMedian - start.baseStatsMedian
    const days = diffDays(start.date, end.date)
    intervals.push({
      startDate: start.date,
      endDate: end.date,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return intervals
}

const buildGuildMetricIntervals = (
  points: GuildSeriesPoint[],
  selector: (point: GuildSeriesPoint) => number,
): IntervalMetric[] => {
  const intervals: IntervalMetric[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const delta = selector(end) - selector(start)
    const days = diffDays(start.date, end.date)
    intervals.push({
      startDate: start.date,
      endDate: end.date,
      days,
      delta,
      perDay: delta / days,
    })
  }
  return intervals
}

const getMonthKey = (value: string) => {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 7)
  }
  const parsed = toDate(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  const year = parsed.getUTCFullYear()
  const month = parsed.getUTCMonth() + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

const buildMonthBuckets = <T>(items: T[], getDate: (item: T) => string) => {
  const months: string[] = []
  const monthMap = new Map<string, T[]>()
  items.forEach((item) => {
    const key = getMonthKey(getDate(item))
    if (!key) {
      return
    }
    const existing = monthMap.get(key)
    if (existing) {
      existing.push(item)
      return
    }
    monthMap.set(key, [item])
    months.push(key)
  })
  return { months, monthMap }
}

const resolveWindowRange = (monthKeys: string[], windowMonths: number) => {
  if (!monthKeys.length) {
    return { startIndex: -1, endIndex: -1 }
  }
  const endIndex = monthKeys.length > 1 ? monthKeys.length - 2 : 0
  const windowSize = Math.max(1, Math.trunc(windowMonths))
  const startIndex = Math.max(0, endIndex - (windowSize - 1))
  return { startIndex, endIndex }
}

const resolveWindowPoints = (points: PlayerSeriesPoint[], months: number) => {
  if (!points.length) {
    return { start: null, end: null }
  }
  const { months: monthKeys, monthMap } = buildMonthBuckets(points, (point) => point.date)
  const { startIndex, endIndex } = resolveWindowRange(monthKeys, months)
  if (startIndex < 0 || endIndex < 0) {
    return { start: null, end: null }
  }
  const startKey = monthKeys[startIndex]
  const endKey = monthKeys[endIndex]
  const startPoints = monthMap.get(startKey) ?? []
  const endPoints = monthMap.get(endKey) ?? []
  const start = startPoints[0] ?? null
  let end: PlayerSeriesPoint | null = null
  if (endPoints.length > 1) {
    end = endPoints[endPoints.length - 1] ?? null
  } else {
    const nextKey = monthKeys[endIndex + 1]
    const nextPoints = nextKey ? monthMap.get(nextKey) ?? [] : []
    end = nextPoints[0] ?? endPoints[endPoints.length - 1] ?? null
  }
  return { start, end }
}

const resolveWindowMeta = (dates: string[], months: number) => {
  if (!dates.length) {
    return { startDate: '', endDate: '', possibleIntervals: 0 }
  }
  const { months: monthKeys, monthMap } = buildMonthBuckets(dates, (date) => date)
  const { startIndex, endIndex } = resolveWindowRange(monthKeys, months)
  if (startIndex < 0 || endIndex < 0) {
    return { startDate: '', endDate: '', possibleIntervals: 0 }
  }
  const startKey = monthKeys[startIndex]
  const endKey = monthKeys[endIndex]
  const startDates = monthMap.get(startKey) ?? []
  const endDates = monthMap.get(endKey) ?? []
  const startDate = startDates[0] ?? ''
  let endDate = ''
  if (endDates.length > 1) {
    endDate = endDates[endDates.length - 1] ?? ''
  } else {
    const nextKey = monthKeys[endIndex + 1]
    const nextDates = nextKey ? monthMap.get(nextKey) ?? [] : []
    endDate = nextDates[0] ?? endDates[endDates.length - 1] ?? ''
  }
  const windowDates = dates.filter(
    (date) => (!startDate || date >= startDate) && (!endDate || date <= endDate),
  )
  const possibleIntervals = Math.max(0, windowDates.length - 1)
  return { startDate, endDate, possibleIntervals }
}

const buildWindowMeta = (dates: string[]) =>
  WINDOW_KEYS.reduce<Record<WindowKey, { startDate: string; endDate: string; possibleIntervals: number }>>(
    (acc, key) => {
      acc[key] = resolveWindowMeta(dates, Number(key))
      return acc
    },
    { '1': { startDate: '', endDate: '', possibleIntervals: 0 }, '3': { startDate: '', endDate: '', possibleIntervals: 0 }, '6': { startDate: '', endDate: '', possibleIntervals: 0 }, '12': { startDate: '', endDate: '', possibleIntervals: 0 } },
  )

const buildWindowMetric = (
  start: PlayerSeriesPoint,
  end: PlayerSeriesPoint,
  selector: (point: PlayerSeriesPoint) => number,
) => {
  const delta = selector(end) - selector(start)
  const days = diffDays(start.date, end.date)
  return {
    startDate: start.date,
    endDate: end.date,
    days,
    delta,
    perDay: delta / days,
  }
}

const initializeWindowMetrics = (): PlayerWindowMetrics => ({
  baseStats: { '1': null, '3': null, '6': null, '12': null },
  level: { '1': null, '3': null, '6': null, '12': null },
  mine: { '1': null, '3': null, '6': null, '12': null },
  treasury: { '1': null, '3': null, '6': null, '12': null },
})

const isWithinWindow = (
  date: string,
  windowMeta: { startDate: string; endDate: string },
) => {
  if (windowMeta.startDate && date < windowMeta.startDate) {
    return false
  }
  if (windowMeta.endDate && date > windowMeta.endDate) {
    return false
  }
  return true
}

const buildGrowthInputsForPoints = (
  points: PlayerSeriesPoint[],
  intervals: IntervalMetric[],
  windowMetaByKey: Record<WindowKey, { startDate: string; endDate: string; possibleIntervals: number }>,
): Record<WindowKey, GrowthWindowInputs> => {
  const empty: GrowthWindowInputs = {
    windowDays: 0,
    windowDelta: 0,
    baseStart: 0,
    baseEnd: 0,
    absPerDay: 0,
    relPerDay: 0,
    realGuildKey: undefined,
  }
  const result: Record<WindowKey, GrowthWindowInputs> = {
    '1': { ...empty },
    '3': { ...empty },
    '6': { ...empty },
    '12': { ...empty },
  }

  WINDOW_KEYS.forEach((windowKey) => {
    const windowMeta = windowMetaByKey[windowKey]
    const windowPoints = points.filter((point) => isWithinWindow(point.date, windowMeta))
    const baseStart = windowPoints[0]?.baseStats ?? 0
    const baseEndPoint = windowPoints[windowPoints.length - 1]
    const baseEnd = baseEndPoint?.baseStats ?? 0
    const realGuildKey = baseEndPoint?.guildKey

    const windowIntervals = intervals.filter(
      (interval) =>
        isWithinWindow(interval.startDate, windowMeta) &&
        isWithinWindow(interval.endDate, windowMeta),
    )
    const windowDays = windowIntervals.reduce((sum, interval) => sum + interval.days, 0)
    const intervalDelta = windowIntervals.reduce((sum, interval) => sum + interval.delta, 0)
    const windowDelta =
      windowIntervals.length > 0 ? intervalDelta : baseEnd - baseStart

    const clampedDelta = windowDelta > 0 ? windowDelta : 0
    const absPerDay = windowDays > 0 ? clampedDelta / windowDays : 0
    const relPerDay =
      absPerDay > 0 ? absPerDay / Math.max(baseStart, GROWTH_BASELINE) : 0

    result[windowKey] = {
      windowDays,
      windowDelta: clampedDelta,
      baseStart,
      baseEnd,
      absPerDay,
      relPerDay,
      realGuildKey,
    }
  })

  return result
}

const buildCustomGuildMap = (memberlistColumns?: Record<string, string[]>) => {
  const map = new Map<string, string>()
  if (!memberlistColumns) {
    return map
  }
  Object.entries(memberlistColumns).forEach(([columnKey, playerKeys]) => {
    if (columnKey === 'col-1' || !Array.isArray(playerKeys)) {
      return
    }
    const customKey = `custom:${columnKey}`
    playerKeys.forEach((playerKey) => {
      map.set(playerKey, customKey)
    })
  })
  return map
}

const addGrowthGroupStats = (
  map: Map<string, GrowthGroupStats>,
  key: string,
  absPerDay: number,
  relPerDay: number,
) => {
  if (!Number.isFinite(absPerDay) || !Number.isFinite(relPerDay)) {
    return
  }
  const entry = map.get(key) ?? { sumAbs: 0, sumRel: 0, count: 0 }
  entry.sumAbs += absPerDay
  entry.sumRel += relPerDay
  entry.count += 1
  map.set(key, entry)
}

const finalizeGrowthGroupStats = (
  map: Map<string, GrowthGroupStats>,
): Map<string, GrowthGroupAverages> => {
  const next = new Map<string, GrowthGroupAverages>()
  map.forEach((stats, key) => {
    if (stats.count > 0) {
      next.set(key, {
        abs: stats.sumAbs / stats.count,
        rel: stats.sumRel / stats.count,
        count: stats.count,
      })
    }
  })
  return next
}

const buildIntervalKey = (interval: IntervalMetric) =>
  `${interval.startDate}|${interval.endDate}`

const addIntervalStat = (map: Map<string, IntervalStats>, key: string, value: number) => {
  if (!Number.isFinite(value)) {
    return
  }
  const entry = map.get(key) ?? { sum: 0, count: 0 }
  entry.sum += value
  entry.count += 1
  map.set(key, entry)
}

const finalizeIntervalStats = (map: Map<string, Map<string, IntervalStats>>) => {
  const next = new Map<string, Map<string, number>>()
  map.forEach((intervalMap, groupKey) => {
    const avgMap = new Map<string, number>()
    intervalMap.forEach((stats, intervalKey) => {
      if (stats.count > 0) {
        avgMap.set(intervalKey, stats.sum / stats.count)
      }
    })
    if (avgMap.size) {
      next.set(groupKey, avgMap)
    }
  })
  return next
}

const computePercentiles = (values: Map<string, number>) => {
  const entries = Array.from(values.entries()).sort((a, b) => a[1] - b[1])
  const percentileMap = new Map<string, number>()
  if (!entries.length) {
    return percentileMap
  }
  let index = 0
  while (index < entries.length) {
    const value = entries[index][1]
    let end = index
    while (end < entries.length && entries[end][1] === value) {
      end += 1
    }
    const rank = (index + (end - 1)) / 2
    const percentile = entries.length === 1 ? 1 : rank / (entries.length - 1)
    for (let cursor = index; cursor < end; cursor += 1) {
      percentileMap.set(entries[cursor][0], percentile)
    }
    index = end
  }
  return percentileMap
}

export function computeDataset(
  normalizedSnapshots: NormalizedSnapshot[],
  manifestSnapshots: ManifestSnapshot[],
  datasetId: string,
  options?: { guildFilterKeys?: string[]; memberlistColumns?: Record<string, string[]> },
): WorkerResult {
  const snapshots = normalizedSnapshots
    .map((snapshot, index) => ({
      snapshot,
      meta: manifestSnapshots[index],
    }))
    .sort(
      (a, b) => toDate(a.snapshot.scannedAt).getTime() - toDate(b.snapshot.scannedAt).getTime(),
    )

  type SnapshotPlayerStats = {
    playerKey: string
    name: string
    server: string
    playerId?: string
    classId?: number
    baseStats: number
    level: number
    levelSource?: LevelSource
    exp: number
    expNext: number
    mine: number
    treasury: number
    guildKey: string
    guildName: string
  }

  const indexedSnapshots = snapshots.map(({ snapshot, meta }) => {
    const playersByKey = new Map<string, SnapshotPlayerStats>()
    const guildMembersAtScan = new Map<string, string[]>()
    const guildNameMap = new Map<string, string>()

    snapshot.guilds.forEach((guild) => {
      guildNameMap.set(guild.guildKey, guild.guildName)
      const members = guildMembersAtScan.get(guild.guildKey) ?? []
      guild.members.forEach((member) => {
        members.push(member.playerKey)
          if (!playersByKey.has(member.playerKey)) {
            playersByKey.set(member.playerKey, {
              playerKey: member.playerKey,
              name: member.name,
              server: member.server,
              playerId: member.playerId,
              classId: member.classId,
              baseStats: member.baseStats,
              level: member.level,
              levelSource: member.levelSource,
              exp: member.exp ?? 0,
              expNext: member.expNext ?? 0,
              mine: member.mine,
              treasury: member.treasury,
              guildKey: guild.guildKey,
            guildName: guild.guildName,
          })
        }
      })
      guildMembersAtScan.set(guild.guildKey, members)
    })

    return { snapshot, meta, playersByKey, guildMembersAtScan, guildNameMap }
  })

  indexedSnapshots.sort(
    (a, b) => toDate(a.snapshot.scannedAt).getTime() - toDate(b.snapshot.scannedAt).getTime(),
  )

  const snapshotDates = indexedSnapshots.map(({ snapshot }) => snapshot.scannedAt)
  const windowMetaByKey = buildWindowMeta(snapshotDates)

  const latestIndex = indexedSnapshots[indexedSnapshots.length - 1]
  const latestGuildKeys = latestIndex
    ? Array.from(latestIndex.guildMembersAtScan.keys())
    : []
  const rosterGuildKeys =
    options?.guildFilterKeys && options.guildFilterKeys.length
      ? options.guildFilterKeys.filter((key) => latestGuildKeys.includes(key))
      : latestGuildKeys

  const rosterByGuild = rosterGuildKeys.reduce<Record<string, string[]>>((acc, key) => {
    acc[key] = latestIndex?.guildMembersAtScan.get(key) ?? []
    return acc
  }, {})

  const playerMap = new Map<string, PlayerSeries>()
  const globalPlayerMap = new Map<string, PlayerSeries>()
  const guildMap = new Map<string, GuildSeries>()
  const snapshotSummaries: SnapshotSummary[] = []

  indexedSnapshots.forEach(({ snapshot, meta, playersByKey, guildNameMap }) => {
    let snapshotMemberCount = 0
    rosterGuildKeys.forEach((guildKey) => {
      const rosterKeys = rosterByGuild[guildKey] ?? []
      const memberStats = {
        baseStats: [] as number[],
        level: [] as number[],
        mine: [] as number[],
        treasury: [] as number[],
      }
      const existingGuild = guildMap.get(guildKey) ?? {
        guildKey,
        guildName: guildNameMap.get(guildKey) ?? guildKey,
        points: [],
      }

      rosterKeys.forEach((playerKey) => {
        const stats = playersByKey.get(playerKey)
        if (!stats) {
          return
        }
        snapshotMemberCount += 1
        memberStats.baseStats.push(stats.baseStats)
        memberStats.level.push(stats.level)
        memberStats.mine.push(stats.mine)
        memberStats.treasury.push(stats.treasury)

        const existingPlayer = playerMap.get(playerKey) ?? {
          playerKey: stats.playerKey,
          name: stats.name,
          server: stats.server,
          playerId: stats.playerId,
          classId: stats.classId,
          points: [],
        }

        existingPlayer.name = stats.name
        existingPlayer.server = stats.server
        existingPlayer.playerId = stats.playerId
        existingPlayer.classId = stats.classId
        existingPlayer.points.push({
          date: snapshot.scannedAt,
          baseStats: stats.baseStats,
          level: stats.level,
          levelSource: stats.levelSource,
          exp: stats.exp,
          expNext: stats.expNext,
          expTotal: 0,
          mine: stats.mine,
          treasury: stats.treasury,
          guildKey: stats.guildKey,
        })

        playerMap.set(playerKey, existingPlayer)
      })

      existingGuild.points.push({
        date: snapshot.scannedAt,
        memberCount: memberStats.baseStats.length,
        baseStatsMedian: median(memberStats.baseStats),
        baseStatsAvg: average(memberStats.baseStats),
        levelMedian: median(memberStats.level),
        levelAvg: average(memberStats.level),
        mineMedian: median(memberStats.mine),
        mineAvg: average(memberStats.mine),
        treasuryMedian: median(memberStats.treasury),
        treasuryAvg: average(memberStats.treasury),
      })

      guildMap.set(guildKey, existingGuild)
    })

    playersByKey.forEach((stats) => {
      const existingPlayer = globalPlayerMap.get(stats.playerKey) ?? {
        playerKey: stats.playerKey,
        name: stats.name,
        server: stats.server,
        playerId: stats.playerId,
        classId: stats.classId,
        points: [],
      }

      existingPlayer.name = stats.name
      existingPlayer.server = stats.server
      existingPlayer.playerId = stats.playerId
      existingPlayer.classId = stats.classId
      existingPlayer.points.push({
        date: snapshot.scannedAt,
        baseStats: stats.baseStats,
        level: stats.level,
        levelSource: stats.levelSource,
        exp: stats.exp,
        expNext: stats.expNext,
        expTotal: 0,
        mine: stats.mine,
        treasury: stats.treasury,
        guildKey: stats.guildKey,
      })

      globalPlayerMap.set(stats.playerKey, existingPlayer)
    })

    snapshotSummaries.push({
      id: meta?.id ?? snapshot.scannedAt,
      label: meta?.label ?? snapshot.scannedAt,
      date: meta?.date ?? snapshot.scannedAt,
      guildCount: rosterGuildKeys.length,
      memberCount: snapshotMemberCount,
    })
  })

  const players: PlayerComputed[] = []
  const baseStatsValues = new Map<string, number>()
  const levelValues = new Map<string, number>()
  const mineValues = new Map<string, number>()
  const treasuryValues = new Map<string, number>()

  Array.from(playerMap.values()).forEach((player) => {
    player.points.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    applyExpTotals(player.points)
    const baseStatsIntervals = buildIntervals(player.points, (point) => point.baseStats)
    const levelIntervals = buildIntervals(player.points, (point) => point.level)
    const mineIntervals = buildIntervals(player.points, (point) => point.mine)
    const treasuryIntervals = buildIntervals(player.points, (point) => point.treasury)

    const lastPoint = player.points[player.points.length - 1]
    const windowMetrics = initializeWindowMetrics()

    WINDOW_KEYS.forEach((windowKey) => {
      const windowMonths = Number(windowKey)
      const { start, end } = resolveWindowPoints(player.points, windowMonths)
      if (!start || !end) {
        return
      }
      windowMetrics.baseStats[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.baseStats,
      )
      windowMetrics.level[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.level,
      )
      windowMetrics.mine[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.mine,
      )
      windowMetrics.treasury[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.treasury,
      )
    })

    const baseStatsPerDayYear = weightedPerDay(baseStatsIntervals)
    const levelPerDayYear = weightedPerDay(levelIntervals)
    const minePerDayYear = weightedPerDay(mineIntervals)
    const treasuryPerDayYear = weightedPerDay(treasuryIntervals)

    baseStatsValues.set(player.playerKey, baseStatsPerDayYear)
    levelValues.set(player.playerKey, levelPerDayYear)
    mineValues.set(player.playerKey, minePerDayYear)
    treasuryValues.set(player.playerKey, treasuryPerDayYear)

    const coverageDays =
      player.points.length > 1
        ? diffDays(player.points[0].date, player.points[player.points.length - 1].date)
        : 0

    const bestInterval = baseStatsIntervals.length
      ? [...baseStatsIntervals].sort((a, b) => b.perDay - a.perDay)[0]
      : undefined
    const worstInterval = baseStatsIntervals.length
      ? [...baseStatsIntervals].sort((a, b) => a.perDay - b.perDay)[0]
      : undefined

    players.push({
      playerKey: player.playerKey,
      name: player.name,
      server: player.server,
      playerId: player.playerId,
      classId: player.classId,
      latestGuildKey: lastPoint?.guildKey,
      latestGuildName: undefined,
      points: player.points,
      intervals: {
        baseStats: baseStatsIntervals,
        level: levelIntervals,
        mine: mineIntervals,
        treasury: treasuryIntervals,
      },
      lastIntervals: {
        baseStats: baseStatsIntervals[baseStatsIntervals.length - 1],
        level: levelIntervals[levelIntervals.length - 1],
        mine: mineIntervals[mineIntervals.length - 1],
        treasury: treasuryIntervals[treasuryIntervals.length - 1],
      },
      baseStatsPerDayYear,
      levelPerDayYear,
      minePerDayYear,
      treasuryPerDayYear,
      coverage: {
        points: player.points.length,
        days: coverageDays,
      },
      windowMetrics,
      bestInterval,
      worstInterval,
      percentiles: {
        baseStats: 0,
        level: 0,
        mine: 0,
        treasury: 0,
        resource: 0,
      },
      score: 0,
      rank: 0,
      recommendation: 'None',
      tags: {
        strengths: [],
        weaknesses: [],
      },
    })
  })

  const guilds: GuildComputed[] = []
  Array.from(guildMap.values()).forEach((guild) => {
    guild.points.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    const intervals = buildGuildIntervals(guild.points)
    const levelIntervals = buildGuildMetricIntervals(guild.points, (point) => point.levelMedian)
    const mineIntervals = buildGuildMetricIntervals(guild.points, (point) => point.mineMedian)
    const treasuryIntervals = buildGuildMetricIntervals(guild.points, (point) => point.treasuryMedian)
    const baseStatsPerDayYear = weightedPerDay(intervals)
    const minePerDayYear = weightedPerDay(
      mineIntervals,
    )
    const treasuryPerDayYear = weightedPerDay(
      treasuryIntervals,
    )

    const lastPoint = guild.points[guild.points.length - 1]
    const sortedIntervals = [...intervals].sort((a, b) => b.perDay - a.perDay)
    const goodIntervals = sortedIntervals.slice(0, 3)
    const badIntervals = [...sortedIntervals].reverse().slice(0, 3)

    guilds.push({
      guildKey: guild.guildKey,
      guildName: guild.guildName,
      points: guild.points,
      intervals,
      intervalsByMetric: {
        baseStats: intervals,
        level: levelIntervals,
        mine: mineIntervals,
        treasury: treasuryIntervals,
      },
      baseStatsPerDayYear,
      minePerDayYear,
      treasuryPerDayYear,
      levelMedianLatest: lastPoint?.levelMedian ?? 0,
      baseStatsMedianLatest: lastPoint?.baseStatsMedian ?? 0,
      mineMedianLatest: lastPoint?.mineMedian ?? 0,
      treasuryMedianLatest: lastPoint?.treasuryMedian ?? 0,
      goodIntervals,
      badIntervals,
    })
  })

  const baseStatsPercentiles = computePercentiles(baseStatsValues)
  const levelPercentiles = computePercentiles(levelValues)
  const minePercentiles = computePercentiles(mineValues)
  const treasuryPercentiles = computePercentiles(treasuryValues)

  players.forEach((player) => {
    const baseStats = baseStatsPercentiles.get(player.playerKey) ?? 0
    const level = levelPercentiles.get(player.playerKey) ?? 0
    const mine = minePercentiles.get(player.playerKey) ?? 0
    const treasury = treasuryPercentiles.get(player.playerKey) ?? 0
    const resource = (mine + treasury) / 2
    player.percentiles = { baseStats, level, mine, treasury, resource }
  })

  const globalPlayers: PlayerComputed[] = []
  const globalBaseStatsValues = new Map<string, number>()
  const globalLevelValues = new Map<string, number>()
  const globalMineValues = new Map<string, number>()
  const globalTreasuryValues = new Map<string, number>()

  Array.from(globalPlayerMap.values()).forEach((player) => {
    player.points.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    applyExpTotals(player.points)
    const baseStatsIntervals = buildIntervals(player.points, (point) => point.baseStats)
    const levelIntervals = buildIntervals(player.points, (point) => point.level)
    const mineIntervals = buildIntervals(player.points, (point) => point.mine)
    const treasuryIntervals = buildIntervals(player.points, (point) => point.treasury)

    const lastPoint = player.points[player.points.length - 1]
    const windowMetrics = initializeWindowMetrics()

    WINDOW_KEYS.forEach((windowKey) => {
      const windowMonths = Number(windowKey)
      const { start, end } = resolveWindowPoints(player.points, windowMonths)
      if (!start || !end) {
        return
      }
      windowMetrics.baseStats[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.baseStats,
      )
      windowMetrics.level[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.level,
      )
      windowMetrics.mine[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.mine,
      )
      windowMetrics.treasury[windowKey] = buildWindowMetric(
        start,
        end,
        (point) => point.treasury,
      )
    })

    const baseStatsPerDayYear = weightedPerDay(baseStatsIntervals)
    const levelPerDayYear = weightedPerDay(levelIntervals)
    const minePerDayYear = weightedPerDay(mineIntervals)
    const treasuryPerDayYear = weightedPerDay(treasuryIntervals)

    globalBaseStatsValues.set(player.playerKey, baseStatsPerDayYear)
    globalLevelValues.set(player.playerKey, levelPerDayYear)
    globalMineValues.set(player.playerKey, minePerDayYear)
    globalTreasuryValues.set(player.playerKey, treasuryPerDayYear)

    const coverageDays =
      player.points.length > 1
        ? diffDays(player.points[0].date, player.points[player.points.length - 1].date)
        : 0

    const bestInterval = baseStatsIntervals.length
      ? [...baseStatsIntervals].sort((a, b) => b.perDay - a.perDay)[0]
      : undefined
    const worstInterval = baseStatsIntervals.length
      ? [...baseStatsIntervals].sort((a, b) => a.perDay - b.perDay)[0]
      : undefined

    globalPlayers.push({
      playerKey: player.playerKey,
      name: player.name,
      server: player.server,
      playerId: player.playerId,
      classId: player.classId,
      latestGuildKey: lastPoint?.guildKey,
      latestGuildName: undefined,
      points: player.points,
      intervals: {
        baseStats: baseStatsIntervals,
        level: levelIntervals,
        mine: mineIntervals,
        treasury: treasuryIntervals,
      },
      lastIntervals: {
        baseStats: baseStatsIntervals[baseStatsIntervals.length - 1],
        level: levelIntervals[levelIntervals.length - 1],
        mine: mineIntervals[mineIntervals.length - 1],
        treasury: treasuryIntervals[treasuryIntervals.length - 1],
      },
      baseStatsPerDayYear,
      levelPerDayYear,
      minePerDayYear,
      treasuryPerDayYear,
      coverage: {
        points: player.points.length,
        days: coverageDays,
      },
      windowMetrics,
      bestInterval,
      worstInterval,
      percentiles: {
        baseStats: 0,
        level: 0,
        mine: 0,
        treasury: 0,
        resource: 0,
      },
      score: 0,
      rank: 0,
      recommendation: 'None',
      tags: {
        strengths: [],
        weaknesses: [],
      },
    })
  })

  const globalBaseStatsPercentiles = computePercentiles(globalBaseStatsValues)
  const globalLevelPercentiles = computePercentiles(globalLevelValues)
  const globalMinePercentiles = computePercentiles(globalMineValues)
  const globalTreasuryPercentiles = computePercentiles(globalTreasuryValues)

  globalPlayers.forEach((player) => {
    const baseStats = globalBaseStatsPercentiles.get(player.playerKey) ?? 0
    const level = globalLevelPercentiles.get(player.playerKey) ?? 0
    const mine = globalMinePercentiles.get(player.playerKey) ?? 0
    const treasury = globalTreasuryPercentiles.get(player.playerKey) ?? 0
    const resource = (mine + treasury) / 2
    player.percentiles = { baseStats, level, mine, treasury, resource }
  })

  const customGuildByPlayer = buildCustomGuildMap(options?.memberlistColumns)

  const growthInputsByPlayer = new Map<string, Record<WindowKey, GrowthWindowInputs>>()
  players.forEach((player) => {
    growthInputsByPlayer.set(
      player.playerKey,
      buildGrowthInputsForPoints(player.points, player.intervals.baseStats, windowMetaByKey),
    )
  })

  const globalGrowthInputsByPlayer = new Map<string, Record<WindowKey, GrowthWindowInputs>>()
  globalPlayers.forEach((player) => {
    globalGrowthInputsByPlayer.set(
      player.playerKey,
      buildGrowthInputsForPoints(player.points, player.intervals.baseStats, windowMetaByKey),
    )
  })

  const serverTopKeysByServer = new Map<string, string[]>()
  if (latestIndex) {
    latestIndex.playersByKey.forEach((stats) => {
      const list = serverTopKeysByServer.get(stats.server) ?? []
      list.push(stats.playerKey)
      serverTopKeysByServer.set(stats.server, list)
    })
  }

  const serverTop150KeysByServer = new Map<string, Set<string>>()
  if (latestIndex) {
    serverTopKeysByServer.forEach((keys, server) => {
      const sortedByBase = [...keys]
        .map((playerKey) => ({
          playerKey,
          baseStats: latestIndex.playersByKey.get(playerKey)?.baseStats ?? 0,
        }))
        .sort((a, b) => b.baseStats - a.baseStats)
      const topKeys = sortedByBase.slice(0, SERVER_AVG_TOP_LIMIT).map((entry) => entry.playerKey)
      if (topKeys.length) {
        serverTop150KeysByServer.set(server, new Set(topKeys))
      }
    })
  }

  const globalPlayersByKey = new Map<string, PlayerComputed>()
  const globalPlayersByServer = new Map<string, PlayerComputed[]>()
  globalPlayers.forEach((player) => {
    globalPlayersByKey.set(player.playerKey, player)
    const list = globalPlayersByServer.get(player.server) ?? []
    list.push(player)
    globalPlayersByServer.set(player.server, list)
  })

  const serverTopAverageByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, number>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const serverAverageByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, number>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const customGuildAverageByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, GrowthGroupAverages>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const realGuildAverageByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, GrowthGroupAverages>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const serverStatsByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, { sum: number; count: number }>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const customGuildStatsByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, GrowthGroupStats>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  const realGuildStatsByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, GrowthGroupStats>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  globalPlayers.forEach((player) => {
    const growthInputs = globalGrowthInputsByPlayer.get(player.playerKey)
    if (!growthInputs) {
      return
    }
    const customGuildKey = customGuildByPlayer.get(player.playerKey)
    const serverTop150 = serverTop150KeysByServer.get(player.server)
    const includeInServerAvg =
      !serverTop150 || serverTop150.size === 0 || serverTop150.has(player.playerKey)
    WINDOW_KEYS.forEach((windowKey) => {
      const inputs = growthInputs[windowKey]
      const absPerDay = inputs.absPerDay
      const relPerDay = inputs.relPerDay
      if (includeInServerAvg && Number.isFinite(absPerDay)) {
        const serverEntry = serverStatsByWindow[windowKey].get(player.server) ?? {
          sum: 0,
          count: 0,
        }
        serverEntry.sum += absPerDay
        serverEntry.count += 1
        serverStatsByWindow[windowKey].set(player.server, serverEntry)
      }
      if (inputs.realGuildKey) {
        addGrowthGroupStats(
          realGuildStatsByWindow[windowKey],
          inputs.realGuildKey,
          absPerDay,
          relPerDay,
        )
      }
      if (customGuildKey) {
        addGrowthGroupStats(
          customGuildStatsByWindow[windowKey],
          customGuildKey,
          absPerDay,
          relPerDay,
        )
      }
    })
  })

  WINDOW_KEYS.forEach((windowKey) => {
    serverStatsByWindow[windowKey].forEach((stats, server) => {
      const avg = stats.count > 0 ? stats.sum / stats.count : 0
      serverAverageByWindow[windowKey].set(server, avg)
    })
    customGuildAverageByWindow[windowKey] = finalizeGrowthGroupStats(
      customGuildStatsByWindow[windowKey],
    )
    realGuildAverageByWindow[windowKey] = finalizeGrowthGroupStats(
      realGuildStatsByWindow[windowKey],
    )
  })

  const serverIntervalStatsByWindow = WINDOW_KEYS.reduce<
    Record<WindowKey, Map<string, Map<string, IntervalStats>>>
  >(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  globalPlayers.forEach((player) => {
    const serverTop150 = serverTop150KeysByServer.get(player.server)
    const includeInServerAvg =
      !serverTop150 || serverTop150.size === 0 || serverTop150.has(player.playerKey)
    WINDOW_KEYS.forEach((windowKey) => {
      const windowMeta = windowMetaByKey[windowKey]
      const intervals = player.intervals.baseStats.filter(
        (interval) =>
          isWithinWindow(interval.startDate, windowMeta) &&
          isWithinWindow(interval.endDate, windowMeta),
      )
      intervals.forEach((interval) => {
        if (interval.days <= 0) {
          return
        }
        if (!includeInServerAvg) {
          return
        }
        const intervalKey = buildIntervalKey(interval)
        const perDay = interval.perDay
        const serverMap =
          serverIntervalStatsByWindow[windowKey].get(player.server) ?? new Map()
        addIntervalStat(serverMap, intervalKey, perDay)
        serverIntervalStatsByWindow[windowKey].set(player.server, serverMap)
      })
    })
  })

  const serverIntervalAveragesByWindow = WINDOW_KEYS.reduce<
    Record<WindowKey, Map<string, Map<string, number>>>
  >(
    (acc, key) => {
      acc[key] = finalizeIntervalStats(serverIntervalStatsByWindow[key])
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  globalPlayersByServer.forEach((list, server) => {
    WINDOW_KEYS.forEach((windowKey) => {
      const entries = list
        .map((player) => {
          const inputs = globalGrowthInputsByPlayer.get(player.playerKey)?.[windowKey]
          return {
            baseEnd: inputs?.baseEnd ?? 0,
            absPerDay: inputs?.absPerDay ?? 0,
          }
        })
        .sort((a, b) => b.baseEnd - a.baseEnd)
      const topAbs = entries
        .slice(0, 100)
        .map((entry) => entry.absPerDay)
        .filter((value) => Number.isFinite(value))
      const avg = topAbs.length ? average(topAbs) : 0
      serverTopAverageByWindow[windowKey].set(server, avg)
    })
  })

  const serverTopPercentilesByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, number[]>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

  serverTopKeysByServer.forEach((keys, server) => {
    const sortedByBase = [...keys]
      .map((playerKey) => {
        const entry = latestIndex?.playersByKey.get(playerKey)
        return {
          playerKey,
          baseStats: entry?.baseStats ?? 0,
        }
      })
      .sort((a, b) => b.baseStats - a.baseStats)

    const top500Keys = sortedByBase.slice(0, 500).map((entry) => entry.playerKey)

    WINDOW_KEYS.forEach((windowKey) => {
      const percentileValues: number[] = []
      top500Keys.forEach((playerKey) => {
        const player = globalPlayersByKey.get(playerKey)
        const perDay = player?.windowMetrics.baseStats[windowKey]?.perDay
        if (Number.isFinite(perDay ?? Number.NaN)) {
          percentileValues.push(perDay as number)
        }
      })
      percentileValues.sort((a, b) => a - b)
      serverTopPercentilesByWindow[windowKey].set(server, percentileValues)
    })
  })

const resolveRatio = (value: number, primary: number, fallback: number) => {
  if (primary > 0) {
    return value / primary
  }
  if (fallback > 0) {
    return value / fallback
  }
  return 1
}

const computeScoreForWindow = (context: ScoreContext): ScoreWindowMeta => {
    const windowMetric = context.windowMetrics.baseStats[context.windowKey]
    const basePerDay = windowMetric?.perDay ?? 0

    const growthInputs = context.growthInputsByWindow?.[context.windowKey]
    const absPerDayRaw = growthInputs?.absPerDay ?? 0
    const relPerDayRaw = growthInputs?.relPerDay ?? 0
    const absPerDay = Number.isFinite(absPerDayRaw) ? absPerDayRaw : 0
    const relPerDay = Number.isFinite(relPerDayRaw) ? relPerDayRaw : 0
    const realGuildKey = growthInputs?.realGuildKey
    const customGuildKey = customGuildByPlayer.get(context.playerKey)

    const avgTop100 = serverTopAverageByWindow[context.windowKey].get(context.server) ?? 0
    const serverAvgRaw = serverAverageByWindow[context.windowKey].get(context.server) ?? 0
    const serverAvgAbsPerDay =
      serverAvgRaw > 0 ? serverAvgRaw : avgTop100 > 0 ? avgTop100 : 0

    const absVsTop100 = resolveRatio(absPerDay, avgTop100, serverAvgAbsPerDay)
    const absVsServerAvg = resolveRatio(absPerDay, serverAvgAbsPerDay, avgTop100)

    const customGuildStats = customGuildKey
      ? customGuildAverageByWindow[context.windowKey].get(customGuildKey)
      : undefined
    const realGuildStats = realGuildKey
      ? realGuildAverageByWindow[context.windowKey].get(realGuildKey)
      : undefined
    const isGuildValid = (stats?: GrowthGroupAverages) =>
      Boolean(stats && stats.count >= GROWTH_MIN_GUILD_COUNT && stats.abs > 0)

    let guildAbsAvg = 0
    let guildRelAvg = 0
    let guildRefType: 'custom' | 'real' | 'none' = 'none'
    let guildRefKey: string | null = null
    if (isGuildValid(customGuildStats)) {
      guildAbsAvg = customGuildStats?.abs ?? 0
      guildRelAvg = customGuildStats?.rel ?? 0
      guildRefType = 'custom'
      guildRefKey = customGuildKey ?? null
    } else if (isGuildValid(realGuildStats)) {
      guildAbsAvg = realGuildStats?.abs ?? 0
      guildRelAvg = realGuildStats?.rel ?? 0
      guildRefType = 'real'
      guildRefKey = realGuildKey ?? null
    } else {
      guildAbsAvg = serverAvgAbsPerDay
    }

    const absVsGuild = resolveRatio(absPerDay, guildAbsAvg, serverAvgAbsPerDay)
    const relVsGuild = guildRelAvg > 0 ? relPerDay / guildRelAvg : 1

    const absNServer = mapRatio(absVsServerAvg)
    const absNGuild = mapRatio(absVsGuild)
    const relN = 0.5
    const momRatio = 1
    const momN = 0.5
    const absN = absNServer
    const growthScore = clamp(0.7 * absN + 0.2 * relN + 0.1 * momN, 0, 1)

    const growthDebug: GrowthDebug = {
      absPerDay,
      serverAvgAbsPerDay,
      absVsServerAvg,
      absVsTop100,
      absVsGuild,
      relPerDay,
      momRatio,
    }

    const percentileValues =
      serverTopPercentilesByWindow[context.windowKey].get(context.server) ?? []
    const percentileTop500 = percentileFromSorted(percentileValues, basePerDay)

    const windowMeta = context.windowMeta[context.windowKey]
    const windowStartDate = windowMeta.startDate
    const windowEndDate = windowMeta.endDate
    const intervals = context.intervals.filter((interval) => {
      if (windowStartDate && interval.startDate < windowStartDate) {
        return false
      }
      if (windowEndDate && interval.endDate > windowEndDate) {
        return false
      }
      return true
    })

    const serverIntervalMap = serverIntervalAveragesByWindow[context.windowKey].get(context.server)

    let ratioMin = Number.POSITIVE_INFINITY
    let ratioMax = Number.NEGATIVE_INFINITY
    let ratioMinCapped = Number.POSITIVE_INFINITY
    let ratioMaxCapped = Number.NEGATIVE_INFINITY
    const ratios = intervals
      .filter((interval) => interval.days > 0)
      .map((interval) => {
        const intervalKey = buildIntervalKey(interval)
        const serverAvg = serverIntervalMap?.get(intervalKey) ?? 0
        const ratioRaw = serverAvg > 0 ? interval.perDay / serverAvg : 1
        const ratioSafe = Number.isFinite(ratioRaw) ? ratioRaw : 1
        ratioMin = Math.min(ratioMin, ratioSafe)
        ratioMax = Math.max(ratioMax, ratioSafe)
        const ratioCapped = clamp(ratioSafe, CONSISTENCY_RATIO_MIN, CONSISTENCY_RATIO_MAX)
        ratioMinCapped = Math.min(ratioMinCapped, ratioCapped)
        ratioMaxCapped = Math.max(ratioMaxCapped, ratioCapped)
        return ratioCapped
      })

    let aboveShare = 0.5
    let gap = 1
    let closeness = 0.5
    let stability = 0.5
    let mad: number | null = null
    if (ratios.length) {
      aboveShare = ratios.filter((ratio) => ratio >= 1).length / ratios.length
      const xValues = ratios.map((ratio) => Math.log(Math.max(ratio, CONSISTENCY_EPS)))
      gap = average(xValues.map((value) => Math.abs(value)))
      closeness = Math.exp(-CONSISTENCY_GAP_K * gap)
      if (xValues.length > 1) {
        mad = medianAbsoluteDeviation(xValues)
        stability = Math.exp(-CONSISTENCY_MAD_K * mad)
      }
    }

    const consBase = 0.4 * aboveShare + 0.35 * closeness + 0.25 * stability
    const consistencyScore = clamp(consBase, 0, 1)

    const levelIntervals = context.levelIntervals.filter((interval) => {
      if (windowStartDate && interval.startDate < windowStartDate) {
        return false
      }
      if (windowEndDate && interval.endDate > windowEndDate) {
        return false
      }
      return true
    })
    const levelWindowDays = levelIntervals.reduce((sum, interval) => sum + interval.days, 0)
    const windowPoints = context.points.filter((point) =>
      isWithinWindow(point.date, windowMeta),
    )
    const startPoint = windowPoints[0]
    const endPoint = windowPoints[windowPoints.length - 1]
    const levelStart = startPoint?.level ?? null
    const levelEnd = endPoint?.level ?? null
    const levelKnown = levelStart !== null && levelEnd !== null
    const levelDeltaRaw = levelKnown ? levelEnd - levelStart : null
    const levelDeltaClamped =
      levelDeltaRaw !== null ? Math.max(0, levelDeltaRaw) : null
    const levelPer30 =
      levelKnown && levelWindowDays > 0
        ? (levelDeltaClamped ?? 0) / levelWindowDays * 30
        : null
    const lowLeveling = levelPer30 !== null ? levelPer30 < 3 : false
    const levelPenalty =
      levelPer30 !== null ? clamp((3 - levelPer30) / 3, 0, 1) : 0

    const possibleIntervals = windowMeta.possibleIntervals
    const coverage = possibleIntervals > 0 ? intervals.length / possibleIntervals : 1
    const coverageFactor = clamp(coverage, 0.75, 1)

    const { start, end } = resolveWindowPoints(context.points, Number(context.windowKey))
    const mineCapped =
      (start?.mine ?? 0) >= MINE_CAP || (end?.mine ?? 0) >= MINE_CAP
    const treasuryCapped =
      (start?.treasury ?? 0) >= TREASURY_CAP || (end?.treasury ?? 0) >= TREASURY_CAP

    const scoreRaw =
      SCORE_WEIGHTS.growth * growthScore +
      SCORE_WEIGHTS.consistency * consistencyScore
    const scoreWithCoverage = scoreRaw * coverageFactor
    const scoreAfterLevelPenalty = scoreWithCoverage * (1 - 0.15 * levelPenalty)
    const score = clamp(scoreAfterLevelPenalty, 0, 1)

    const scoreDebug: ScoreDebug = {
      final: {
        scoreRaw,
        levelPenalty,
        scoreAfterLevelPenalty,
        coverageFactor,
        scoreFinal: score,
      },
      weights: {
        wGrowth: SCORE_WEIGHTS.growth,
        wConsistency: SCORE_WEIGHTS.consistency,
        levelPenaltyMax: 0.15,
      },
      growth: {
        absPerDay,
        top100AvgAbsPerDay: avgTop100,
        absVsTop100,
        serverAvgAbsPerDay,
        absVsServerAvg,
        guildRefType,
        guildRefKey,
        guildAvgAbsPerDay: guildAbsAvg,
        absVsGuild,
        absN_server: absNServer,
        absN_guild: absNGuild,
        absN,
        growth: growthScore,
        relPerDay,
        relVsGuild: guildRelAvg > 0 ? relVsGuild : null,
        relN,
        momRatio,
        momN,
      },
      consistency: {
        aboveShare,
        gap,
        closeness,
        mad,
        stability,
        consBase,
        consistency: consistencyScore,
        rMin: Number.isFinite(ratioMin) ? ratioMin : null,
        rMax: Number.isFinite(ratioMax) ? ratioMax : null,
        rMinCapped: Number.isFinite(ratioMinCapped) ? ratioMinCapped : null,
        rMaxCapped: Number.isFinite(ratioMaxCapped) ? ratioMaxCapped : null,
      },
      level: {
        levelKnown,
        levelStart,
        levelEnd,
        levelDeltaRaw,
        levelDelta: levelDeltaClamped,
        windowDays: levelWindowDays,
        levelPer30,
        lowLeveling,
      },
    }

  return {
    score,
    growthScore,
    growthDebug,
    scoreDebug,
    percentileTop500,
    consistencyScore,
    levelPer30,
    lowLeveling,
    coverage,
    mineCapped,
    treasuryCapped,
  }
}

const buildWindowMetricsForPoints = (points: PlayerSeriesPoint[]): PlayerWindowMetrics => {
  const windowMetrics = initializeWindowMetrics()
  if (!points.length) {
    return windowMetrics
  }
  WINDOW_KEYS.forEach((windowKey) => {
    const { start, end } = resolveWindowPoints(points, Number(windowKey))
    if (!start || !end) return
    windowMetrics.baseStats[windowKey] = buildWindowMetric(start, end, (point) => point.baseStats)
    windowMetrics.level[windowKey] = buildWindowMetric(start, end, (point) => point.level ?? 0)
    windowMetrics.mine[windowKey] = buildWindowMetric(start, end, (point) => point.mine ?? 0)
    windowMetrics.treasury[windowKey] = buildWindowMetric(start, end, (point) => point.treasury ?? 0)
  })
  return windowMetrics
}

const buildScoreTimelineForPlayer = (player: PlayerComputed): PlayerScoreSnapshot[] => {
  const timeline: PlayerScoreSnapshot[] = []
  const points = player.points
  if (!points.length) {
    return timeline
  }
  for (let index = 0; index < points.length; index += 1) {
    const slice = points.slice(0, index + 1)
    if (!slice.length) {
      continue
    }
    const windowMeta = buildWindowMeta(slice.map((point) => point.date))
    const intervals = buildIntervals(slice, (point) => point.baseStats)
    const levelIntervals = buildIntervals(slice, (point) => point.level ?? 0)
    const windowMetrics = buildWindowMetricsForPoints(slice)
    const growthInputsByWindow = buildGrowthInputsForPoints(slice, intervals, windowMeta)
    const context: ScoreContext = {
      windowKey: DEFAULT_SCORE_WINDOW,
      playerKey: player.playerKey,
      server: player.server,
      points: slice,
      intervals,
      levelIntervals,
      windowMetrics,
      windowMeta,
      growthInputsByWindow,
    }
    const scoreMeta = computeScoreForWindow(context)
    timeline.push({
      date: slice[slice.length - 1].date,
      score: scoreMeta.score,
    })
  }
  return timeline
}

  const applyScores = (
    list: PlayerComputed[],
    growthInputsMap: Map<string, Record<WindowKey, GrowthWindowInputs>>,
  ) => {
    list.forEach((player) => {
      const scoreByWindow: Record<WindowKey, number> = {
        '1': 0,
        '3': 0,
        '6': 0,
        '12': 0,
      }
      const growthInputsByWindow = growthInputsMap.get(player.playerKey)
      const growthDebugByWindow: Record<WindowKey, GrowthDebug> = {
        '1': {
          absPerDay: 0,
          serverAvgAbsPerDay: 0,
          absVsServerAvg: 0,
          absVsTop100: 0,
          absVsGuild: 0,
          relPerDay: 0,
          momRatio: 1,
        },
        '3': {
          absPerDay: 0,
          serverAvgAbsPerDay: 0,
          absVsServerAvg: 0,
          absVsTop100: 0,
          absVsGuild: 0,
          relPerDay: 0,
          momRatio: 1,
        },
        '6': {
          absPerDay: 0,
          serverAvgAbsPerDay: 0,
          absVsServerAvg: 0,
          absVsTop100: 0,
          absVsGuild: 0,
          relPerDay: 0,
          momRatio: 1,
        },
        '12': {
          absPerDay: 0,
          serverAvgAbsPerDay: 0,
          absVsServerAvg: 0,
          absVsTop100: 0,
          absVsGuild: 0,
          relPerDay: 0,
          momRatio: 1,
        },
      }
      const scoreDebugByWindow: Record<WindowKey, ScoreDebug> = {
        '1': {
          final: { scoreRaw: 0, levelPenalty: 0, scoreAfterLevelPenalty: 0 },
          weights: { wGrowth: SCORE_WEIGHTS.growth, wConsistency: SCORE_WEIGHTS.consistency, levelPenaltyMax: 0.15 },
          growth: {
            absPerDay: 0,
            top100AvgAbsPerDay: 0,
            absVsTop100: 0,
            serverAvgAbsPerDay: 0,
            absVsServerAvg: 0,
            guildRefType: 'none',
            guildRefKey: null,
            guildAvgAbsPerDay: 0,
            absVsGuild: 0,
            absN_server: 0,
            absN_guild: 0,
            absN: 0,
            growth: 0,
          },
          consistency: {
            aboveShare: 0,
            gap: 0,
            closeness: 0,
            stability: 0,
            consBase: 0,
            consistency: 0,
          },
          level: { levelKnown: false, levelDelta: null, windowDays: 0, levelPer30: null, lowLeveling: false },
        },
        '3': {
          final: { scoreRaw: 0, levelPenalty: 0, scoreAfterLevelPenalty: 0 },
          weights: { wGrowth: SCORE_WEIGHTS.growth, wConsistency: SCORE_WEIGHTS.consistency, levelPenaltyMax: 0.15 },
          growth: {
            absPerDay: 0,
            top100AvgAbsPerDay: 0,
            absVsTop100: 0,
            serverAvgAbsPerDay: 0,
            absVsServerAvg: 0,
            guildRefType: 'none',
            guildRefKey: null,
            guildAvgAbsPerDay: 0,
            absVsGuild: 0,
            absN_server: 0,
            absN_guild: 0,
            absN: 0,
            growth: 0,
          },
          consistency: {
            aboveShare: 0,
            gap: 0,
            closeness: 0,
            stability: 0,
            consBase: 0,
            consistency: 0,
          },
          level: { levelKnown: false, levelDelta: null, windowDays: 0, levelPer30: null, lowLeveling: false },
        },
        '6': {
          final: { scoreRaw: 0, levelPenalty: 0, scoreAfterLevelPenalty: 0 },
          weights: { wGrowth: SCORE_WEIGHTS.growth, wConsistency: SCORE_WEIGHTS.consistency, levelPenaltyMax: 0.15 },
          growth: {
            absPerDay: 0,
            top100AvgAbsPerDay: 0,
            absVsTop100: 0,
            serverAvgAbsPerDay: 0,
            absVsServerAvg: 0,
            guildRefType: 'none',
            guildRefKey: null,
            guildAvgAbsPerDay: 0,
            absVsGuild: 0,
            absN_server: 0,
            absN_guild: 0,
            absN: 0,
            growth: 0,
          },
          consistency: {
            aboveShare: 0,
            gap: 0,
            closeness: 0,
            stability: 0,
            consBase: 0,
            consistency: 0,
          },
          level: { levelKnown: false, levelDelta: null, windowDays: 0, levelPer30: null, lowLeveling: false },
        },
        '12': {
          final: { scoreRaw: 0, levelPenalty: 0, scoreAfterLevelPenalty: 0 },
          weights: { wGrowth: SCORE_WEIGHTS.growth, wConsistency: SCORE_WEIGHTS.consistency, levelPenaltyMax: 0.15 },
          growth: {
            absPerDay: 0,
            top100AvgAbsPerDay: 0,
            absVsTop100: 0,
            serverAvgAbsPerDay: 0,
            absVsServerAvg: 0,
            guildRefType: 'none',
            guildRefKey: null,
            guildAvgAbsPerDay: 0,
            absVsGuild: 0,
            absN_server: 0,
            absN_guild: 0,
            absN: 0,
            growth: 0,
          },
          consistency: {
            aboveShare: 0,
            gap: 0,
            closeness: 0,
            stability: 0,
            consBase: 0,
            consistency: 0,
          },
          level: { levelKnown: false, levelDelta: null, windowDays: 0, levelPer30: null, lowLeveling: false },
        },
      }
      const scoreBreakdownByWindow: Record<WindowKey, ScoreDebug> = {
        '1': scoreDebugByWindow['1'],
        '3': scoreDebugByWindow['3'],
        '6': scoreDebugByWindow['6'],
        '12': scoreDebugByWindow['12'],
      }
      const lowLevelingByWindow: Record<WindowKey, boolean> = {
        '1': false,
        '3': false,
        '6': false,
        '12': false,
      }
      const levelPer30ByWindow: Record<WindowKey, number | null> = {
        '1': null,
        '3': null,
        '6': null,
        '12': null,
      }
      const buildContext = (windowKey: WindowKey): ScoreContext => ({
        windowKey,
        playerKey: player.playerKey,
        server: player.server,
        points: player.points,
        intervals: player.intervals.baseStats,
        levelIntervals: player.intervals.level,
        windowMetrics: player.windowMetrics,
        windowMeta: windowMetaByKey,
        growthInputsByWindow,
      })

      const defaultMeta = computeScoreForWindow(buildContext(DEFAULT_SCORE_WINDOW))
      WINDOW_KEYS.forEach((windowKey) => {
        const meta =
          windowKey === DEFAULT_SCORE_WINDOW
            ? defaultMeta
            : computeScoreForWindow(buildContext(windowKey))
        scoreByWindow[windowKey] = meta.score
        if (meta.growthDebug) {
          growthDebugByWindow[windowKey] = meta.growthDebug
        }
        if (meta.scoreDebug) {
          scoreDebugByWindow[windowKey] = meta.scoreDebug
          scoreBreakdownByWindow[windowKey] = meta.scoreDebug
        }
        lowLevelingByWindow[windowKey] = meta.lowLeveling
        levelPer30ByWindow[windowKey] = meta.levelPer30
      })
      player.scoreByWindow = scoreByWindow
      player.scoreBreakdownByWindow = scoreBreakdownByWindow
      player.scoreDebugByWindow = scoreDebugByWindow
      player.growthDebugByWindow = growthDebugByWindow
      player.lowLevelingByWindow = lowLevelingByWindow
      player.levelPer30ByWindow = levelPer30ByWindow
      player.score = scoreByWindow[DEFAULT_SCORE_WINDOW] ?? 0

      const strengths: string[] = []
      const weaknesses: string[] = []
      if (defaultMeta.growthScore >= 0.8) strengths.push('BaseStats Pace')
      if (defaultMeta.consistencyScore >= 0.8) strengths.push('Consistent')
      if (defaultMeta.mineCapped) strengths.push('Mine Capped')
      if (defaultMeta.treasuryCapped) strengths.push('Treasury Capped')
      if (defaultMeta.lowLeveling) weaknesses.push('Low Leveling')
      const percentileLabel = `Top500 P${Math.round(defaultMeta.percentileTop500 * 100)}`
      if (defaultMeta.percentileTop500 >= 0.5) {
        strengths.push(percentileLabel)
      } else {
        weaknesses.push(percentileLabel)
      }
      if (defaultMeta.coverage < 0.8) weaknesses.push('Low Coverage')
      player.tags = { strengths, weaknesses }
      player.scoreTimeline = buildScoreTimelineForPlayer(player)
    })
  }

  applyScores(players, growthInputsByPlayer)
  applyScores(globalPlayers, globalGrowthInputsByPlayer)

  const scoreValue = (player: PlayerComputed) =>
    player.scoreByWindow?.[DEFAULT_SCORE_WINDOW] ?? player.score

  players.sort((a, b) => scoreValue(b) - scoreValue(a))
  players.forEach((player, index) => {
    player.rank = index + 1
  })

  globalPlayers.sort((a, b) => scoreValue(b) - scoreValue(a))
  globalPlayers.forEach((player, index) => {
    player.rank = index + 1
  })

  const rosterSortedByScore = [...players].sort(
    (a, b) => scoreValue(b) - scoreValue(a),
  )
  const mainList = rosterSortedByScore.slice(0, 50).map((player) => player.playerKey)
  const wingList = rosterSortedByScore.slice(50, 100).map((player) => player.playerKey)
  const mainSet = new Set(mainList)
  const wingSet = new Set(wingList)

  const assignRecommendation = (player: PlayerComputed) => {
    if (mainSet.has(player.playerKey)) {
      player.recommendation = 'Main'
    } else if (wingSet.has(player.playerKey)) {
      player.recommendation = 'Wing'
    } else {
      player.recommendation = 'None'
    }
  }

  players.forEach(assignRecommendation)
  globalPlayers.forEach(assignRecommendation)

  const guildNameMap = new Map<string, string>()
  guilds.forEach((guild) => guildNameMap.set(guild.guildKey, guild.guildName))
  players.forEach((player) => {
    if (player.latestGuildKey) {
      player.latestGuildName = guildNameMap.get(player.latestGuildKey)
    }
  })

  const latestGuildNameMap = latestIndex?.guildNameMap ?? new Map<string, string>()
  globalPlayers.forEach((player) => {
    if (player.latestGuildKey) {
      player.latestGuildName = latestGuildNameMap.get(player.latestGuildKey)
    }
  })

  const topMovers: WorkerResult['topMovers'] = {
    '1': [],
    '3': [],
    '6': [],
    '12': [],
  }
  const topMoversByMetric: WorkerResult['topMoversByMetric'] = {
    baseStats: { '1': [], '3': [], '6': [], '12': [] },
    level: { '1': [], '3': [], '6': [], '12': [] },
    mine: { '1': [], '3': [], '6': [], '12': [] },
    treasury: { '1': [], '3': [], '6': [], '12': [] },
  }

  const metricValueForSort = (metric: MetricKey, entry: { perDay: number; delta: number }) =>
    metric === 'level' ? entry.delta : entry.perDay

  WINDOW_KEYS.forEach((windowKey) => {
    const baseEntries = players
      .map((player) => {
        const metric = player.windowMetrics.baseStats[windowKey]
        if (!metric) {
          return null
        }
        return {
          playerKey: player.playerKey,
          name: player.name,
          guildKey: player.latestGuildKey,
          metric: 'baseStats' as const,
          perDay: metric.perDay,
          delta: metric.delta,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.perDay - a.perDay)
      .slice(0, 5)
    topMovers[windowKey] = baseEntries
    topMoversByMetric.baseStats[windowKey] = baseEntries
  })

  METRIC_KEYS.filter((metric) => metric !== 'baseStats').forEach((metric) => {
    WINDOW_KEYS.forEach((windowKey) => {
      const entries = players
        .map((player) => {
          const metricWindow = player.windowMetrics[metric][windowKey]
          if (!metricWindow) {
            return null
          }
          return {
            playerKey: player.playerKey,
            name: player.name,
            guildKey: player.latestGuildKey,
            metric,
            perDay: metricWindow.perDay,
            delta: metricWindow.delta,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort(
          (a, b) => metricValueForSort(metric, b) - metricValueForSort(metric, a),
        )
        .slice(0, 5)
      topMoversByMetric[metric][windowKey] = entries
    })
  })

  const rangeStart = snapshots[0]?.snapshot.scannedAt ?? ''
  const latestDate = snapshots[snapshots.length - 1]?.snapshot.scannedAt ?? ''

  return {
    datasetId,
    latestDate,
    rangeStart,
    snapshots: snapshotSummaries,
    players,
    globalPlayers,
    guilds,
    topMovers,
    topMoversByMetric,
    recommendations: {
      main: mainList,
      wing: wingList,
    },
  }
}
