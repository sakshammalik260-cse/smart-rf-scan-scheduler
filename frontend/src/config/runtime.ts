const mockFlag = import.meta.env.VITE_USE_MOCK_API

export const runtimeConfig = {
  useMockApi: mockFlag !== 'false',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api',
}