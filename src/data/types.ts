export type ManifestDataset = {
  id: string
  label: string
  format: string
  scope: string
  notes?: string
}

export type DatasetKind = 'manifest' | 'repo'

export type DatasetConfig = ManifestDataset & {
  kind?: DatasetKind
}

export type ScanSource = {
  id: string
  label: string
  path: string
  notes?: string
}

export type ScanLoadError = {
  id: string
  label: string
  path: string
  url: string
  status: number
  contentType: string | null
  reason: string
  preview?: string
}

export type ManifestSnapshot = {
  id: string
  label: string
  date: string
  format: string
  path: string
  scope: string
  datasetId: string
  notes?: string
}

export type Manifest = {
  datasets: ManifestDataset[]
  snapshots: ManifestSnapshot[]
}

export type NormalizedMember = {
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
}

export type NormalizedGuild = {
  guildKey: string
  guildName: string
  members: NormalizedMember[]
}

export type NormalizedSnapshot = {
  scannedAt: string
  guilds: NormalizedGuild[]
}

export type LevelSource = 'player' | 'guild' | 'unknown'

export type RawToNormalizedAdapter = {
  id: string
  label: string
  supportsFormat: (format: string) => boolean
  normalize: (raw: unknown, meta: ManifestSnapshot) => NormalizedSnapshot
}

export type PlayerSeriesPoint = {
  date: string
  baseStats: number
  level: number
  levelSource?: LevelSource
  exp: number
  expNext: number
  expTotal?: number
  mine: number
  treasury: number
  guildKey: string
}

export type PlayerSeries = {
  playerKey: string
  name: string
  server: string
  playerId?: string
  classId?: number
  points: PlayerSeriesPoint[]
}

export type PlayerScoreSnapshot = {
  date: string
  score: number
}

export type GrowthDebug = {
  absPerDay: number
  serverAvgAbsPerDay: number
  absVsServerAvg: number
  absVsTop100: number
  absVsGuild: number
  relPerDay: number
  momRatio: number
}

export type ScoreDebug = {
  final: {
    scoreRaw: number
    levelPenalty: number
    scoreAfterLevelPenalty: number
    coverageFactor?: number
    scoreFinal?: number
  }
  weights: {
    wGrowth: number
    wConsistency: number
    levelPenaltyMax: number
  }
  growth: {
    absPerDay: number
    top100AvgAbsPerDay: number
    absVsTop100: number
    serverAvgAbsPerDay: number
    absVsServerAvg: number
    guildRefType: 'custom' | 'real' | 'none'
    guildRefKey?: string | null
    guildAvgAbsPerDay: number
    absVsGuild: number
    absN_server: number
    absN_guild: number
    absN: number
    growth: number
    relPerDay?: number
    relVsGuild?: number | null
    relN?: number
    momRatio?: number
    momN?: number
  }
  consistency: {
    aboveShare: number
    gap: number
    closeness: number
    mad?: number | null
    stability: number
    consBase: number
    consistency: number
    rMin?: number | null
    rMax?: number | null
    rMinCapped?: number | null
    rMaxCapped?: number | null
  }
  level: {
    levelKnown: boolean
    levelStart?: number | null
    levelEnd?: number | null
    levelDeltaRaw?: number | null
    levelDelta: number | null
    windowDays: number
    levelPer30: number | null
    lowLeveling: boolean
  }
}

export type GuildSeriesPoint = {
  date: string
  memberCount: number
  baseStatsMedian: number
  baseStatsAvg: number
  levelMedian: number
  levelAvg: number
  mineMedian: number
  mineAvg: number
  treasuryMedian: number
  treasuryAvg: number
}

export type GuildSeries = {
  guildKey: string
  guildName: string
  points: GuildSeriesPoint[]
}

export type IntervalMetric = {
  startDate: string
  endDate: string
  days: number
  delta: number
  perDay: number
}

export type WindowMetric = {
  startDate: string
  endDate: string
  days: number
  delta: number
  perDay: number
}

export type WindowKey = '1' | '3' | '6' | '12'

export type PlayerWindowMetrics = {
  baseStats: Record<WindowKey, WindowMetric | null>
  level: Record<WindowKey, WindowMetric | null>
  mine: Record<WindowKey, WindowMetric | null>
  treasury: Record<WindowKey, WindowMetric | null>
}

export type MetricKey = 'baseStats' | 'level' | 'mine' | 'treasury'

export type SnapshotSummary = {
  id: string
  label: string
  date: string
  guildCount: number
  memberCount: number
}

export type PlayerComputed = {
  playerKey: string
  name: string
  server: string
  playerId?: string
  classId?: number
  latestGuildKey?: string
  latestGuildName?: string
  points: PlayerSeriesPoint[]
  intervals: {
    baseStats: IntervalMetric[]
    level: IntervalMetric[]
    mine: IntervalMetric[]
    treasury: IntervalMetric[]
  }
  lastIntervals: {
    baseStats?: IntervalMetric
    level?: IntervalMetric
    mine?: IntervalMetric
    treasury?: IntervalMetric
  }
  baseStatsPerDayYear: number
  levelPerDayYear: number
  minePerDayYear: number
  treasuryPerDayYear: number
  coverage: {
    points: number
    days: number
  }
  windowMetrics: PlayerWindowMetrics
  bestInterval?: IntervalMetric
  worstInterval?: IntervalMetric
  percentiles: {
    baseStats: number
    level: number
    mine: number
    treasury: number
    resource: number
  }
  score: number
  scoreByWindow?: Record<WindowKey, number>
  scoreBreakdownByWindow?: Record<WindowKey, ScoreDebug>
  scoreDebugByWindow?: Record<WindowKey, ScoreDebug>
  growthDebugByWindow?: Record<WindowKey, GrowthDebug>
  lowLevelingByWindow?: Record<WindowKey, boolean>
  levelPer30ByWindow?: Record<WindowKey, number | null>
  scoreTimeline?: PlayerScoreSnapshot[]
  rank: number
  recommendation: 'Main' | 'Wing' | 'None'
  tags: {
    strengths: string[]
    weaknesses: string[]
  }
}

export type LatestPlayerEntry = {
  playerKey: string
  name: string
  server: string
  playerId?: string
  guildKey?: string
  guildName?: string
}

export type GuildComputed = {
  guildKey: string
  guildName: string
  points: GuildSeriesPoint[]
  intervals: IntervalMetric[]
  intervalsByMetric?: Record<MetricKey, IntervalMetric[]>
  baseStatsPerDayYear: number
  minePerDayYear: number
  treasuryPerDayYear: number
  levelMedianLatest: number
  baseStatsMedianLatest: number
  mineMedianLatest: number
  treasuryMedianLatest: number
  goodIntervals: IntervalMetric[]
  badIntervals: IntervalMetric[]
}

export type PlayerWindowEntry = {
  playerKey: string
  name: string
  guildKey: string | undefined
  metric: MetricKey
  perDay: number
  delta: number
}

export type GuildRosterEntry = {
  guildKey: string
  guildName: string
  memberCount: number
}

export type SaveIndexPoint = {
  date: string
  value: number
}

export type SaveIndexPlayerSeries = {
  playerKey: string
  name: string
  guildKey?: string
  points: SaveIndexPoint[]
}

export type SaveIndexGuildSeries = {
  guildKey: string
  guildName: string
  points: SaveIndexPoint[]
}

export type SaveIndexResult = {
  index: number
  rangeStart: string
  latestDate: string
  players: SaveIndexPlayerSeries[]
  guilds: SaveIndexGuildSeries[]
}

export type WorkerResult = {
  datasetId: string
  latestDate: string
  rangeStart: string
  snapshots: SnapshotSummary[]
  players: PlayerComputed[]
  globalPlayers?: PlayerComputed[]
  latestPlayers?: LatestPlayerEntry[]
  guilds: GuildComputed[]
  topMovers: Record<WindowKey, PlayerWindowEntry[]>
  topMoversByMetric?: Record<MetricKey, Record<WindowKey, PlayerWindowEntry[]>>
  guildRoster?: GuildRosterEntry[]
  defaultGuildKeys?: string[]
  recommendations: {
    main: string[]
    wing: string[]
  }
}
