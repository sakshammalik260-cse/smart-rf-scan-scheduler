import { runtimeConfig } from '../config/runtime'
import { createModelApi } from './modelApi'
import { createSimulationApi } from './simulationApi'
import type { ApiClient } from '../types/api'

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = options?.body instanceof FormData ? options?.headers : { 'Content-Type': 'application/json', ...options?.headers }
  let response: Response
  try {
    response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
      ...options,
      headers,
    })
  } catch (error) {
    throw new Error(error instanceof TypeError ? 'Backend unavailable. Start the FastAPI service.' : 'Network request failed.')
  }
  if (!response.ok) {
    let detail = `API request failed: ${response.status}`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // Keep the HTTP status fallback when the backend returns a non-JSON error.
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const api: ApiClient = runtimeConfig.useMockApi
  ? { ...createModelApi(true), ...createSimulationApi(true) }
  : { ...createModelApi(false), ...createSimulationApi(false) }
