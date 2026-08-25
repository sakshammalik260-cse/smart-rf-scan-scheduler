import { modelResults, holdoutResults } from '../data/mockData'
import type { ApiClient, ModelComparisonResult, ModelStatus, SchedulerMetrics } from '../types/api'
import { request } from './api'

const comparison: ModelComparisonResult[] = modelResults.map((result) => ({
  model: result.shortName as ModelComparisonResult['model'],
  metrics: { hitRate: result.hitRate, missRate: 100 - result.hitRate, emitterCoverage: result.coverage, averageInterceptionDelaySeconds: result.delay, scanEntropy: result.entropy },
}))

const metrics: SchedulerMetrics = { hitRate: holdoutResults.hitRate, missRate: holdoutResults.missRate, emitterCoverage: holdoutResults.coverage, averageInterceptionDelaySeconds: holdoutResults.delay, scanEntropy: holdoutResults.entropy }

export function createModelApi(mock: boolean): Pick<ApiClient, 'getModelStatus' | 'getModelComparison' | 'getSchedulerMetrics'> {
  if (mock) return {
    getModelStatus: async () => ({ name: 'Smart V3', version: 'Candidate 17', state: 'frozen', backendMode: 'mock' }),
    getModelComparison: async () => comparison,
    getSchedulerMetrics: async () => metrics,
  }
  return {
    getModelStatus: () => request<ModelStatus>('/model/status'),
    getModelComparison: () => request<ModelComparisonResult[]>('/models/comparison'),
    getSchedulerMetrics: () => request<SchedulerMetrics>('/scheduler/metrics'),
  }
}

export { holdoutResults }