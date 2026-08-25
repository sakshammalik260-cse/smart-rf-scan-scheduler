# Smart Scheduler V3 Backend

Backend milestone for the frozen Smart V3 model. This service verifies and loads the approved Random Forest, validates uploaded TSRD Stare H5 files, converts scenarios into lightweight receiver summaries, and generates historical 30-feature matrices for one decision time. Simulation, V3 band selection, and HOLDOUT evaluation are intentionally not implemented.

## Setup

From the repository root:

```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r backend/requirements.txt
```

## Run

```bash
uvicorn app.main:app --app-dir backend --reload
```

The API is available at `http://127.0.0.1:8000`. CORS permits the Vite frontend at `http://localhost:5173`.

`POST /api/scenarios/upload` accepts a multipart `.h5` file, validates `/data`, `/labels`, `/metadata`, and `/metadata/feature_names`, and enforces a 100 MB upload limit. Valid files are copied to a temporary UUID-named path for the lifetime of the backend process; invalid uploads are removed immediately.

Successful uploads receive a process-local `scenario_id`. `GET /api/scenarios/{scenario_id}/summary` streams the stored H5 data in chunks, converts ToA microseconds to seconds, assigns pulses to the 36 contiguous 500 MHz receiver bands, and returns band activity counts and 0.05-second time bins. The scenario store is temporary and is cleared when the backend process exits.

`POST /api/scheduler/predict` accepts `scenario_id` and `decision_time_seconds`. It replays only completed sequential receiver observations before that time, delegates the exact 30-feature construction to the frozen source, and returns Random Forest probabilities for all 36 candidate bands. It does not select a V3 band.

`POST /api/scheduler/decision` applies the frozen Candidate 17 policy to those probabilities and historical states, returning one selected band plus the top five policy scores. `rf_probability` is the learned activity prediction; `v3_score` is the scheduling priority and is not a probability.

The live simulation endpoints create a process-local session per uploaded scenario. `POST /api/simulation/start` creates a session, `POST /api/simulation/{id}/step` performs exactly one select-observe-update-advance decision, and the pause, reset, and state endpoints manage or inspect that session. There is no automatic execution loop or benchmark calculation.

## Checks

```bash
pytest backend/tests -q
```