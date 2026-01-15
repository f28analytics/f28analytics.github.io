import { useMemo } from 'react'
import { formatDate, formatNumber } from '../format'

type LinePoint = {
  date: string
  value: number
}

type LineChartProps = {
  points: LinePoint[]
  height?: number
  color?: string
}

const CHART_SIZE = 1000
const CHART_PADDING = {
  top: 24,
  right: 24,
  bottom: 70,
  left: 70,
}

const getTime = (value: string) => new Date(value).getTime()

export default function LineChart({ points, height = 160, color = '#61d8ba' }: LineChartProps) {
  const { path, minValue, maxValue, positions, xLabels, yTicks, axisY, axisX } = useMemo(() => {
    if (points.length < 2) {
      return {
        path: '',
        minValue: 0,
        maxValue: 0,
        positions: [] as Array<LinePoint & { x: number; y: number }>,
        xLabels: [] as Array<LinePoint & { x: number; y: number; showLabel: boolean; label: string }>,
        yTicks: [] as Array<{ value: number; y: number }>,
        axisY: CHART_SIZE - CHART_PADDING.bottom,
        axisX: CHART_PADDING.left,
      }
    }
    const sortedPoints = [...points].sort((a, b) => getTime(a.date) - getTime(b.date))
    const values = sortedPoints.map((point) => point.value)
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const valueSpan = maxValue - minValue || 1
    const valuePadding =
      valueSpan > 0 ? valueSpan * 0.12 : Math.max(1, Math.abs(maxValue) * 0.05)
    const paddedMinValue = minValue - valuePadding
    const paddedMaxValue = maxValue + valuePadding
    const paddedValueSpan = paddedMaxValue - paddedMinValue || 1
    const times = sortedPoints.map((point) => getTime(point.date))
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const timeSpan = maxTime - minTime || 1
    const timePadding = timeSpan > 0 ? timeSpan * 0.03 : 0
    const paddedMinTime = minTime - timePadding
    const paddedMaxTime = maxTime + timePadding
    const paddedTimeSpan = paddedMaxTime - paddedMinTime || 1
    const plotWidth = CHART_SIZE - CHART_PADDING.left - CHART_PADDING.right
    const plotHeight = CHART_SIZE - CHART_PADDING.top - CHART_PADDING.bottom
    const axisY = CHART_PADDING.top + plotHeight
    const axisX = CHART_PADDING.left
    const positions = sortedPoints.map((point) => {
      const time = getTime(point.date)
      const x = CHART_PADDING.left + ((time - paddedMinTime) / paddedTimeSpan) * plotWidth
      const y =
        CHART_PADDING.top +
        (1 - (point.value - paddedMinValue) / paddedValueSpan) * plotHeight
      return { ...point, x, y }
    })
    const segments = positions.map((point, index) => {
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    })
    const labelEvery = positions.length <= 8 ? 1 : Math.ceil(positions.length / 6)
    const xLabels = positions.map((point, index) => ({
      ...point,
      showLabel: index === 0 || index === positions.length - 1 || index % labelEvery === 0,
      label: formatDate(point.date),
    }))
    const yTicks = [paddedMaxValue, (paddedMaxValue + paddedMinValue) / 2, paddedMinValue].map(
      (value) => ({
        value,
        y: CHART_PADDING.top + ((paddedMaxValue - value) / paddedValueSpan) * plotHeight,
      }),
    )
    return { path: segments.join(' '), minValue, maxValue, positions, xLabels, yTicks, axisY, axisX }
  }, [points])

  if (points.length < 2) {
    return <div className="chart-empty">Not enough data points.</div>
  }

  return (
    <div className="chart-wrapper">
      <div className="chart-canvas" style={{ height }}>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <g className="chart-axis">
            <line
              className="chart-axis-line"
              x1={axisX}
              y1={CHART_PADDING.top}
              x2={axisX}
              y2={axisY}
            />
            <line
              className="chart-axis-line"
              x1={axisX}
              y1={axisY}
              x2={CHART_SIZE - CHART_PADDING.right}
              y2={axisY}
            />
            {yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line
                  className="chart-tick"
                  x1={axisX - 10}
                  y1={tick.y}
                  x2={axisX}
                  y2={tick.y}
                />
                <text
                  className="chart-axis-text"
                  x={axisX - 14}
                  y={tick.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {formatNumber(tick.value, 0)}
                </text>
              </g>
            ))}
            {xLabels.map((point, index) => (
              <g key={`x-${point.date}-${index}`}>
                <line
                  className="chart-tick"
                  x1={point.x}
                  y1={axisY}
                  x2={point.x}
                  y2={axisY + 12}
                />
                {point.showLabel && (
                  <text
                    className="chart-axis-text"
                    x={point.x}
                    y={axisY + 26}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            ))}
          </g>
          <path d={path} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" />
          {positions.map((point, index) => (
            <circle key={`p-${point.date}-${index}`} cx={point.x} cy={point.y} r="10" fill={color} />
          ))}
        </svg>
      </div>
      <div className="chart-range">
        <span>{minValue.toFixed(0)}</span>
        <span>{maxValue.toFixed(0)}</span>
      </div>
    </div>
  )
}
