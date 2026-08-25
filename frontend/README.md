# Smart Scan Scheduler Frontend

React + TypeScript + Vite dashboard for Smart V3. The service layer currently defaults to frontend-only mock data.

## Run locally

```bash
npm install
npm run dev
```

## API mode

Copy `.env.example` to `.env.local` and set `VITE_USE_MOCK_API=true` for mock mode. Set it to `false` to use the real service methods, and set `VITE_API_BASE_URL` to the FastAPI base URL.

The expected endpoint paths are defined in `src/services/modelApi.ts` and `src/services/simulationApi.ts`.

## Checks

```bash
npm run lint
npm run build
```
