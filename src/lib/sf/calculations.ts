const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

let goldCurveCache: number[] | null = null

export const goldCurve = () => {
  if (goldCurveCache) {
    return goldCurveCache
  }
  const array = [0, 25, 50, 75]
  for (let i = array.length; i < 650; i += 1) {
    array[i] = Math.min(
      Math.floor(
        (array[i - 1] +
          Math.floor(array[Math.floor(i / 2)] / 3) +
          Math.floor(array[Math.floor(i / 3)] / 4)) /
          5,
      ) * 5,
      1e9,
    )
  }
  goldCurveCache = array
  return array
}

export const gold = (level: number) => {
  const curve = goldCurve()
  const value = curve[clamp(level, 0, 640)]
  return typeof value === 'undefined' ? 1e9 : value
}
