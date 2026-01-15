export const formatDate = (value?: string) => {
  if (!value) {
    return '-'
  }
  return value.slice(0, 10)
}

export const formatNumber = (value: number, digits = 1) => {
  if (!Number.isFinite(value)) {
    return '-'
  }
  return value.toFixed(digits)
}

export const formatInt = (value: number) => {
  if (!Number.isFinite(value)) {
    return '-'
  }
  return Math.round(value).toString()
}
