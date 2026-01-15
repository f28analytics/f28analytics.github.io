import type {
  GuildComputed,
  GuildSeries,
  GuildSeriesPoint,
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
  consistency: 0.15,
  mine: 0.05,
  treasury: 0.05,
}

type ScoreWindowMeta = {
  score: number
  growthScore: number
  percentileTop500: number
  consistencyScore: number
  coverage: number
  mineCapped: boolean
  treasuryCapped: boolean
}

type ScoreContext = {
  windowKey: WindowKey
  server: string
  points: PlayerSeriesPoint[]
  intervals: IntervalMetric[]
  windowMetrics: PlayerWindowMetrics
  windowMeta: Record<WindowKey, { startDate: string; endDate: string; possibleIntervals: number }>
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

const findWindowStart = (points: PlayerSeriesPoint[], months: number) => {
  if (!points.length) {
    return null
  }
  const endDate = toDate(points[points.length - 1].date)
  const target = new Date(endDate)
  target.setMonth(target.getMonth() - months)
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index]
    if (toDate(candidate.date) <= target) {
      return candidate
    }
  }
  return points[0]
}

const resolveWindowPoints = (points: PlayerSeriesPoint[], months: number) => {
  if (!points.length) {
    return { start: null, end: null }
  }
  const end = points[points.length - 1]
  const start = findWindowStart(points, months)
  return { start, end }
}

const findWindowStartIndex = (dates: string[], months: number) => {
  if (!dates.length) {
    return -1
  }
  const endDate = toDate(dates[dates.length - 1])
  const target = new Date(endDate)
  target.setMonth(target.getMonth() - months)
  for (let index = dates.length - 2; index >= 0; index -= 1) {
    if (toDate(dates[index]) <= target) {
      return index
    }
  }
  return 0
}

const buildWindowMeta = (dates: string[]) =>
  WINDOW_KEYS.reduce<Record<WindowKey, { startDate: string; endDate: string; possibleIntervals: number }>>(
    (acc, key) => {
      if (!dates.length) {
        acc[key] = { startDate: '', endDate: '', possibleIntervals: 0 }
        return acc
      }
      const startIndex = findWindowStartIndex(dates, Number(key))
      const endDate = dates[dates.length - 1]
      const startDate = startIndex >= 0 ? dates[startIndex] : endDate
      const possibleIntervals = Math.max(0, dates.length - 1 - Math.max(0, startIndex))
      acc[key] = { startDate, endDate, possibleIntervals }
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
  options?: { guildFilterKeys?: string[] },
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
      const startPoint = findWindowStart(player.points, windowMonths)
      if (!startPoint || !lastPoint) {
        return
      }
      windowMetrics.baseStats[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.baseStats,
      )
      windowMetrics.level[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.level,
      )
      windowMetrics.mine[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.mine,
      )
      windowMetrics.treasury[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
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
      const startPoint = findWindowStart(player.points, windowMonths)
      if (!startPoint || !lastPoint) {
        return
      }
      windowMetrics.baseStats[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.baseStats,
      )
      windowMetrics.level[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.level,
      )
      windowMetrics.mine[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
        (point) => point.mine,
      )
      windowMetrics.treasury[windowKey] = buildWindowMetric(
        startPoint,
        lastPoint,
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

  const serverTopKeysByServer = new Map<string, string[]>()
  if (latestIndex) {
    latestIndex.playersByKey.forEach((stats) => {
      const list = serverTopKeysByServer.get(stats.server) ?? []
      list.push(stats.playerKey)
      serverTopKeysByServer.set(stats.server, list)
    })
  }

  const globalPlayersByKey = new Map<string, PlayerComputed>()
  globalPlayers.forEach((player) => {
    globalPlayersByKey.set(player.playerKey, player)
  })

  const serverTopAverageByWindow = WINDOW_KEYS.reduce<Record<WindowKey, Map<string, number>>>(
    (acc, key) => {
      acc[key] = new Map()
      return acc
    },
    { '1': new Map(), '3': new Map(), '6': new Map(), '12': new Map() },
  )

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

    const top150Keys = sortedByBase.slice(0, 150).map((entry) => entry.playerKey)
    const top500Keys = sortedByBase.slice(0, 500).map((entry) => entry.playerKey)

    WINDOW_KEYS.forEach((windowKey) => {
      const averageValues: number[] = []
      top150Keys.forEach((playerKey) => {
        const player = globalPlayersByKey.get(playerKey)
        const perDay = player?.windowMetrics.baseStats[windowKey]?.perDay
        if (Number.isFinite(perDay ?? Number.NaN)) {
          averageValues.push(perDay as number)
        }
      })
      const avg = averageValues.length ? average(averageValues) : 0
      serverTopAverageByWindow[windowKey].set(server, avg)

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

  const rosterMineValuesByWindow = WINDOW_KEYS.reduce<Record<WindowKey, number[]>>(
    (acc, key) => {
      acc[key] = []
      return acc
    },
    { '1': [], '3': [], '6': [], '12': [] },
  )
  const rosterTreasuryValuesByWindow = WINDOW_KEYS.reduce<Record<WindowKey, number[]>>(
    (acc, key) => {
      acc[key] = []
      return acc
    },
    { '1': [], '3': [], '6': [], '12': [] },
  )

  players.forEach((player) => {
    WINDOW_KEYS.forEach((windowKey) => {
      const minePerDay = player.windowMetrics.mine[windowKey]?.perDay
      if (Number.isFinite(minePerDay ?? Number.NaN)) {
        rosterMineValuesByWindow[windowKey].push(minePerDay as number)
      }
      const treasuryPerDay = player.windowMetrics.treasury[windowKey]?.perDay
      if (Number.isFinite(treasuryPerDay ?? Number.NaN)) {
        rosterTreasuryValuesByWindow[windowKey].push(treasuryPerDay as number)
      }
    })
  })

  WINDOW_KEYS.forEach((windowKey) => {
    rosterMineValuesByWindow[windowKey].sort((a, b) => a - b)
    rosterTreasuryValuesByWindow[windowKey].sort((a, b) => a - b)
  })

const computeScoreForWindow = (context: ScoreContext): ScoreWindowMeta => {
    const windowMetric = context.windowMetrics.baseStats[context.windowKey]
    const basePerDay = windowMetric?.perDay ?? 0
    const avgTop150 = serverTopAverageByWindow[context.windowKey].get(context.server) ?? 0
    const growthScore = avgTop150 > 0 ? clamp(basePerDay / avgTop150, 0, 1) : 0
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
    const paces = intervals.map((interval) => interval.perDay)
    const activeShare = paces.length
      ? paces.filter((pace) => pace > 0).length / paces.length
      : 0
    const paceMedian = paces.length ? median(paces) : 0
    const volatility = medianAbsoluteDeviation(paces)
    const volatilityNorm = paces.length
      ? clamp(volatility / (Math.abs(paceMedian) + 1), 0, 1)
      : 1
    const consistencyScore = clamp(
      0.7 * activeShare + 0.3 * (1 - volatilityNorm),
      0,
      1,
    )

    const possibleIntervals = windowMeta.possibleIntervals
    const coverage = possibleIntervals > 0 ? intervals.length / possibleIntervals : 1
    const coverageFactor = clamp(coverage, 0.75, 1)

    const { start, end } = resolveWindowPoints(context.points, Number(context.windowKey))
    const mineCapped =
      (start?.mine ?? 0) >= MINE_CAP || (end?.mine ?? 0) >= MINE_CAP
    const treasuryCapped =
      (start?.treasury ?? 0) >= TREASURY_CAP || (end?.treasury ?? 0) >= TREASURY_CAP

    const minePerDay = context.windowMetrics.mine[context.windowKey]?.perDay ?? 0
    const treasuryPerDay =
      context.windowMetrics.treasury[context.windowKey]?.perDay ?? 0
    const mineScore = mineCapped
      ? 1
      : percentileFromSorted(rosterMineValuesByWindow[context.windowKey], minePerDay)
    const treasuryScore = treasuryCapped
      ? 1
      : percentileFromSorted(rosterTreasuryValuesByWindow[context.windowKey], treasuryPerDay)

    const scoreRaw =
      SCORE_WEIGHTS.growth * growthScore +
      SCORE_WEIGHTS.consistency * consistencyScore +
      SCORE_WEIGHTS.mine * mineScore +
      SCORE_WEIGHTS.treasury * treasuryScore

  return {
    score: scoreRaw * coverageFactor,
    growthScore,
    percentileTop500,
    consistencyScore,
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
  const end = points[points.length - 1]
  WINDOW_KEYS.forEach((windowKey) => {
    const start = findWindowStart(points, Number(windowKey))
    if (!start) return
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
    const windowMetrics = buildWindowMetricsForPoints(slice)
    const context: ScoreContext = {
      windowKey: DEFAULT_SCORE_WINDOW,
      server: player.server,
      points: slice,
      intervals,
      windowMetrics,
      windowMeta,
    }
    const scoreMeta = computeScoreForWindow(context)
    timeline.push({
      date: slice[slice.length - 1].date,
      score: scoreMeta.score,
    })
  }
  return timeline
}

  const applyScores = (list: PlayerComputed[]) => {
    list.forEach((player) => {
      const scoreByWindow: Record<WindowKey, number> = {
        '1': 0,
        '3': 0,
        '6': 0,
        '12': 0,
      }
      const buildContext = (windowKey: WindowKey): ScoreContext => ({
        windowKey,
        server: player.server,
        points: player.points,
        intervals: player.intervals.baseStats,
        windowMetrics: player.windowMetrics,
        windowMeta: windowMetaByKey,
      })

      const defaultMeta = computeScoreForWindow(buildContext(DEFAULT_SCORE_WINDOW))
      WINDOW_KEYS.forEach((windowKey) => {
        const meta =
          windowKey === DEFAULT_SCORE_WINDOW
            ? defaultMeta
            : computeScoreForWindow(buildContext(windowKey))
        scoreByWindow[windowKey] = meta.score
      })
      player.scoreByWindow = scoreByWindow
      player.score = scoreByWindow[DEFAULT_SCORE_WINDOW] ?? 0

      const strengths: string[] = []
      const weaknesses: string[] = []
      if (defaultMeta.growthScore >= 0.8) strengths.push('BaseStats Pace')
      if (defaultMeta.consistencyScore >= 0.8) strengths.push('Consistent')
      if (defaultMeta.mineCapped) strengths.push('Mine Capped')
      if (defaultMeta.treasuryCapped) strengths.push('Treasury Capped')
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

  applyScores(players)
  applyScores(globalPlayers)

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
