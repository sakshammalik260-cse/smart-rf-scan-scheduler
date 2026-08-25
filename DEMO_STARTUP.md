# SMART Scan Scheduler V3 Demo Startup

## First-Time Setup

Install backend dependencies only if needed:

```bat
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Install frontend dependencies only if `frontend\node_modules` is missing:

```bat
cd frontend
npm install
```

## Start

Double-click `start_demo.bat`, or run:

```bat
start_demo.bat
```

## Stop

Double-click `stop_demo.bat`, or run:

```bat
stop_demo.bat
```

## URLs

Frontend: http://localhost:5173  
Backend: http://127.0.0.1:8000  
Health: http://127.0.0.1:8000/api/health

## Troubleshooting

If startup reports missing `.venv`, Python packages, npm, or `node_modules`, run the first-time setup commands above. If port `8000` or `5173` is occupied, run `stop_demo.bat`; if the port is still occupied, close the unrelated app using that port.
