# Render Deployment

The Docker image serves the built React frontend, FastAPI API, and frozen
Random Forest from one HTTPS origin. The frontend is compiled with
`VITE_USE_MOCK_API=false` and `VITE_API_BASE_URL=/api`; no separate frontend
deployment or production CORS configuration is needed.

## Service Configuration

Use the repository's `smart-v4-sdr` branch and `render.yaml` Blueprint, or
create a Docker web service with `Dockerfile` at the repository root.
Use `/api/ready` as the health check. The Blueprint selects the Free plan
and disables automatic deployments so new commits do not publish implicitly.

The image checks the frozen model checksum and loads it during its build.
The runtime readiness endpoint also requires a verified, loaded model.
The model artifact and Python source are not served as website assets.

## Verify a Release

- `/`: the 3D dashboard with the live backend badge.
- `/api/ready`: HTTP 200 with `model_loaded: true`.
- `/api/model/status`: `verification_status: verified`, 30 features,
  Candidate 17, and model SHA-256
  `2814ab16b74707f297c874003d2455afb02820452e035fb67648021b6fc8fbd3`.
- Upload a valid TSRD H5 file, start a simulation, and verify real decisions.

## Runtime Boundaries

Run one instance and one Uvicorn worker: uploaded scenario IDs and simulation
sessions are stored in process memory and are reset when the service restarts.
Uploads are temporary; this deployment does not add persistent storage.
The SDR simulator has shared process state. This is a demonstration service,
not a multi-tenant application with separate accounts.

Cloud deployment runs H5 inference and Mock SDR. It cannot access a USB SDR
attached to a visitor's computer. Live SDR requires an appropriately connected
receiver host and driver integration.

## Local Container

```sh
docker build -t smart-rf-scan-scheduler .
docker run --rm -p 10000:10000 smart-rf-scan-scheduler
```

Open `http://localhost:10000`.
