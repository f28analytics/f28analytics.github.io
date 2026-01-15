import { useId, useMemo } from 'react'

type AnchoredLineChartProps = {
  points: number[]
  avgValue?: number | null
  showAvg?: boolean
  showFill?: boolean
  showDots?: boolean
  showXLabels?: boolean
  className?: string
}

const VIEWBOX_WIDTH = 600
const VIEWBOX_HEIGHT = 240

const GRID_V = [80, 160, 240, 320, 400, 480, 560]
const GRID_H = [40, 80, 120, 160, 200]

const PLOT_LEFT = 40
const PLOT_RIGHT = 560
const PLOT_TOP = 40
const PLOT_BOTTOM = 200
const BASELINE_Y = VIEWBOX_HEIGHT

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export default function AnchoredLineChart({
  points,
  avgValue = null,
  showAvg = true,
  showFill = true,
  showDots = true,
  showXLabels = true,
  className,
}: AnchoredLineChartProps) {
  const gradientId = useId()
  const plotWidth = PLOT_RIGHT - PLOT_LEFT
  const plotHeight = PLOT_BOTTOM - PLOT_TOP

  const { linePath, areaPath, dots, avgY, labels } = useMemo(() => {
    if (!points.length) {
      return {
        linePath: '',
        areaPath: '',
        dots: [] as { x: number; y: number }[],
        avgY: null as number | null,
        labels: [] as { x: number; text: string }[],
      }
    }

    let min = Math.min(...points)
    let max = Math.max(...points)
    const span = Math.max(1, max - min)
    const pad = span * 0.1
    min -= pad
    max += pad
    const range = Math.max(1, max - min)

    const scaleX = (index: number) =>
      points.length > 1 ? PLOT_LEFT + (index / (points.length - 1)) * plotWidth : PLOT_LEFT
    const scaleY = (value: number) =>
      clamp(PLOT_TOP + (1 - (value - min) / range) * plotHeight, PLOT_TOP, PLOT_BOTTOM)

    if (points.length === 1) {
      const x0 = PLOT_LEFT
      const x1 = PLOT_LEFT + plotWidth * 0.1
      const y = scaleY(points[0])
      const area = `${[`M${x0},${y}`, `L${x1},${y}`, `L${x1},${BASELINE_Y}`, `L${x0},${BASELINE_Y}`, 'Z'].join(' ')}`
      return {
        linePath: `M${x0},${y} L${x1},${y}`,
        areaPath: area,
        dots: showDots ? [{ x: (x0 + x1) / 2, y }] : [],
        avgY: showAvg && avgValue != null ? scaleY(avgValue) : null,
        labels: [{ x: PLOT_LEFT, text: 't0' }],
      }
    }

    const coords = points.map((point, index) => ({ x: scaleX(index), y: scaleY(point) }))
    const linePath = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x},${coord.y}`).join(' ')
    const areaPath = `${linePath} L${coords[coords.length - 1].x},${BASELINE_Y} L${coords[0].x},${BASELINE_Y} Z`
    const dots = showDots ? coords : []
    const avgY = showAvg && avgValue != null ? scaleY(avgValue) : null
    const labels = points.map((_, index) => ({ x: scaleX(index), text: `t${index}` }))

    return { linePath, areaPath, dots, avgY, labels }
  }, [points, avgValue, showAvg, showDots, plotWidth, plotHeight])

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      className={`player-profile__trend-chart ${className ?? ''}`.trim()}
      role="img"
      aria-label="Anchored trend"
    >
      <g
        className="player-profile__trend-grid"
        opacity="0.55"
        stroke="rgba(43,76,115,0.55)"
        strokeWidth={1}
      >
        {GRID_V.map((x, index) => (
          <line key={`gv-${index}`} x1={x} x2={x} y1={0} y2={VIEWBOX_HEIGHT} />
        ))}
        {GRID_H.map((y, index) => (
          <line key={`gh-${index}`} x1={0} x2={VIEWBOX_WIDTH} y1={y} y2={y} />
        ))}
      </g>

      {showAvg && avgY != null && (
        <g className="player-profile__trend-avg">
          <text x={12} y={20} className="player-profile__trend-avg-label">
            Avg
          </text>
          <line x1={0} x2={VIEWBOX_WIDTH} y1={avgY} y2={avgY} />
        </g>
      )}

      {showFill && areaPath && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(92, 139, 198, 0.28)" />
            <stop offset="100%" stopColor="rgba(92, 139, 198, 0)" />
          </linearGradient>
        </defs>
      )}
      {showFill && areaPath && (
        <path d={areaPath} className="player-profile__trend-area" fill={`url(#${gradientId})`} />
      )}

      {linePath && <path d={linePath} className="player-profile__trend-line" fill="none" />}

      {dots.map((dot, index) => (
        <circle key={`dot-${index}`} cx={dot.x} cy={dot.y} r={4} className="player-profile__trend-dot" />
      ))}

      {showXLabels && (
        <g className="player-profile__trend-xlabels">
          {labels.map((label, index) => (
            <text key={`lbl-${index}`} x={label.x} y={VIEWBOX_HEIGHT - 8} textAnchor="middle">
              {label.text}
            </text>
          ))}
        </g>
      )}
    </svg>
  )
}
