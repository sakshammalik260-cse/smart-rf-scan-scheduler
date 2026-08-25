import type { ModelResult, SpectrumBand } from '../types/dashboard'

export const HOLDOUT_LABEL = 'Final HOLDOUT - 5 unseen TSRD Stare scenarios'

export const holdoutResults = {
  hitRate: 71.76,
  missRate: 28.24,
  coverage: 95.67,
  delay: 0.257,
  entropy: 0.828,
}

export const baselineResults = {
  hitRate: 27.24,
  coverage: 93.63,
  delay: 0.439,
}

export const modelResults: ModelResult[] = [
  { name: 'Sequential', shortName: 'Sequential', hitRate: 27.24, coverage: 93.63, delay: 0.439, entropy: 1 },
  { name: 'Adaptive V1', shortName: 'Adaptive V1', hitRate: 84.74, coverage: 72.28, delay: 0.992, entropy: 0.314 },
  { name: 'RF V2', shortName: 'RF V2', hitRate: 85.02, coverage: 73.01, delay: 0.837, entropy: 0.669 },
  { name: 'Smart V3', shortName: 'Smart V3', hitRate: 71.76, coverage: 95.67, delay: 0.257, entropy: 0.828 },
]

export const spectrumBands: SpectrumBand[] = Array.from({ length: 36 }, (_, index) => {
  const activity = Math.round((0.18 + ((index * 31) % 71) / 100) * 100) / 100
  return {
    id: index + 1,
    startGHz: 0.5 + index * 0.5,
    endGHz: 1 + index * 0.5,
    activity,
    priority: Math.round((activity * 0.72 + ((index * 17) % 23) / 100) * 100) / 100,
    visitedAt: (index * 7) % 31,
  }
})

export const schedulerPipeline = ['Receiver History', '30 Features', 'Random Forest', 'Activity Probability', 'V3 Multi-objective Scheduler', 'Next Band']
