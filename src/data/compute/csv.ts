import type { PlayerComputed, WindowKey, WorkerResult } from '../types'

const escapeCsv = (value: string | number) => {
  const raw = String(value ?? '')
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

const toCsv = (rows: Array<Array<string | number>>) =>
  rows.map((row) => row.map(escapeCsv).join(',')).join('\n')

export const buildRecommendationCsv = (
  players: PlayerComputed[],
  recommendation: 'Main' | 'Wing',
) => {
  const rows: Array<Array<string | number>> = [
    [
      'Rank',
      'Player',
      'Server',
      'Guild',
      'Score',
      'BaseStats/Day',
      'Level/Day',
      'Mine/Day',
      'Treasury/Day',
    ],
  ]
  players
    .filter((player) => player.recommendation === recommendation)
    .forEach((player) => {
      rows.push([
        player.rank,
        player.name,
        player.server,
        player.latestGuildName ?? player.latestGuildKey ?? '',
        player.score.toFixed(3),
        player.baseStatsPerDayYear.toFixed(2),
        player.levelPerDayYear.toFixed(2),
        player.minePerDayYear.toFixed(2),
        player.treasuryPerDayYear.toFixed(2),
      ])
    })
  return toCsv(rows)
}

export const buildRankingCsv = (players: PlayerComputed[], windowKey: WindowKey) => {
  const rows: Array<Array<string | number>> = [
    [
      'Rank',
      'Player',
      'Server',
      'Guild',
      'Score',
      'BaseStats/Day (Year)',
      'BaseStats/Day (Window)',
      'Level Delta (Window)',
      'Mine/Day (Window)',
      'Treasury/Day (Window)',
      'Coverage Points',
      'Coverage Days',
      'Recommendation',
    ],
  ]
  players.forEach((player) => {
    rows.push([
      player.rank,
      player.name,
      player.server,
      player.latestGuildName ?? player.latestGuildKey ?? '',
      (player.scoreByWindow?.[windowKey] ?? player.score).toFixed(3),
      player.baseStatsPerDayYear.toFixed(2),
      player.windowMetrics.baseStats[windowKey]?.perDay?.toFixed(2) ?? '0',
      player.windowMetrics.level[windowKey]?.delta?.toFixed(0) ?? '0',
      player.windowMetrics.mine[windowKey]?.perDay?.toFixed(2) ?? '0',
      player.windowMetrics.treasury[windowKey]?.perDay?.toFixed(2) ?? '0',
      player.coverage.points,
      player.coverage.days,
      player.recommendation,
    ])
  })
  return toCsv(rows)
}

export const buildMarkdownReport = (result: WorkerResult) => {
  const mainCount = result.recommendations.main.length
  const wingCount = result.recommendations.wing.length
  const topPlayers = result.players.slice(0, 5)
  const lines = [
    `# Guild Analytics Report`,
    ``,
    `Latest scan: ${result.latestDate}`,
    `Range: ${result.rangeStart} -> ${result.latestDate}`,
    `Players: ${result.players.length}`,
    `Main / Wing: ${mainCount} / ${wingCount}`,
    ``,
    `## Top 5 (Score)`,
    ...topPlayers.map(
      (player, index) =>
        `${index + 1}. ${player.name} (${player.latestGuildName ?? player.latestGuildKey ?? '-'})`,
    ),
  ]
  return lines.join('\n')
}

export const buildToplistCsv = (
  entries: Array<{
    playerKey: string
    name: string
    guildKey?: string
    perDay: number
    delta: number
  }>,
  metricLabel: string,
  windowKey: WindowKey,
) => {
  const rows: Array<Array<string | number>> = [
    ['Rank', 'Player', 'Guild', `Value (${metricLabel})`, 'Per Day', 'Delta', 'Window'],
  ]
  entries.forEach((entry, index) => {
    rows.push([
      index + 1,
      entry.name,
      entry.guildKey ?? '',
      metricLabel,
      entry.perDay.toFixed(2),
      entry.delta.toFixed(0),
      `${windowKey} mo`,
    ])
  })
  return toCsv(rows)
}

export const buildGuildSummaryCsv = (result: WorkerResult) => {
  const rows: Array<Array<string | number>> = [
    [
      'Guild',
      'Members (Latest)',
      'BaseStats/Day',
      'Level Median',
      'Mine Pace',
      'Treasury Pace',
    ],
  ]
  result.guilds.forEach((guild) => {
    const latest = guild.points[guild.points.length - 1]
    rows.push([
      guild.guildName,
      latest?.memberCount ?? 0,
      guild.baseStatsPerDayYear.toFixed(2),
      guild.levelMedianLatest.toFixed(0),
      guild.minePerDayYear.toFixed(2),
      guild.treasuryPerDayYear.toFixed(2),
    ])
  })
  return toCsv(rows)
}
