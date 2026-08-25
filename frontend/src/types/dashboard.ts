export type PageId = 'overview' | 'spectrum' | 'scheduler' | 'comparison' | 'energy'

export type ModelResult = {
  name: string
  shortName: string
  hitRate: number
  coverage: number
  delay: number
  entropy: number
}

export type SpectrumBand = {
  id: number
  startGHz: number
  endGHz: number
  activity: number
  priority: number
  visitedAt: number
}