@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND_URL=http://127.0.0.1:8000"
set "BACKEND_HEALTH=http://127.0.0.1:8000/api/health"
set "FRONTEND_URL=http://localhost:5173"
set "RUNTIME_DIR=%ROOT%\.demo_runtime"
set "BACKEND_RUNNER=%RUNTIME_DIR%\backend_demo.cmd"
set "FRONTEND_RUNNER=%RUNTIME_DIR%\frontend_demo.cmd"
set "BACKEND_PID_FILE=%RUNTIME_DIR%\backend.pid"
set "FRONTEND_PID_FILE=%RUNTIME_DIR%\frontend.pid"
set "BACKEND_LAUNCHER_PID_FILE=%RUNTIME_DIR%\backend_launcher.pid"
set "FRONTEND_LAUNCHER_PID_FILE=%RUNTIME_DIR%\frontend_launcher.pid"
set "BACKEND_PID="
set "FRONTEND_PID="
set "BACKEND_LAUNCHER_PID="
set "FRONTEND_LAUNCHER_PID="

echo ========================================
echo SMART SCAN SCHEDULER V3
echo SIH DEMO STARTUP
echo ========================================
echo.

echo [1/4] Checking environment...

if not exist "%ROOT%\.venv\Scripts\activate.bat" (
    call :Fail ".venv is missing. Create it first, then install backend dependencies with: .venv\Scripts\python.exe -m pip install -r backend\requirements.txt"
    exit /b 1
)

call "%ROOT%\.venv\Scripts\activate.bat"
if errorlevel 1 (
    call :Fail "Could not activate .venv. Check that .venv\Scripts\activate.bat is valid."
    exit /b 1
)

python --version >nul 2>nul
if errorlevel 1 (
    call :Fail "Python is not available inside .venv. Recreate the virtual environment and try again."
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    call :Fail "npm was not found on PATH. Install Node.js LTS, close this terminal, and try again."
    exit /b 1
)

if not exist "%ROOT%\backend\requirements.txt" (
    call :Fail "backend\requirements.txt is missing."
    exit /b 1
)

python -c "import fastapi, uvicorn, pydantic, multipart, joblib, h5py, sklearn, pandas, PIL, pytest, httpx" >nul 2>nul
if errorlevel 1 (
    call :Fail "A backend Python dependency is missing. Run: .venv\Scripts\python.exe -m pip install -r backend\requirements.txt"
    exit /b 1
)

if not exist "%ROOT%\frontend\package.json" (
    call :Fail "frontend\package.json is missing."
    exit /b 1
)

if not exist "%ROOT%\frontend\node_modules\" (
    call :Fail "frontend\node_modules is missing. Run: cd frontend && npm install"
    exit /b 1
)

if not exist "%ROOT%\frontend\node_modules\.bin\vite.cmd" (
    call :Fail "Vite is missing from frontend\node_modules. Run: cd frontend && npm install"
    exit /b 1
)

call :EnsurePortFree 8000 "FastAPI backend"
if errorlevel 1 exit /b 1

call :EnsurePortFree 5173 "React frontend"
if errorlevel 1 exit /b 1

if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>nul
del "%BACKEND_PID_FILE%" >nul 2>nul
del "%FRONTEND_PID_FILE%" >nul 2>nul
del "%BACKEND_LAUNCHER_PID_FILE%" >nul 2>nul
del "%FRONTEND_LAUNCHER_PID_FILE%" >nul 2>nul

call :WriteBackendRunner
call :WriteFrontendRunner

echo Environment OK.
echo.
echo [2/4] Starting FastAPI backend...
set "SMART_DEMO_BACKEND_RUNNER=%BACKEND_RUNNER%"
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', ('"' + $env:SMART_DEMO_BACKEND_RUNNER + '"')) -PassThru; $p.Id"') do set "BACKEND_LAUNCHER_PID=%%P"
if not defined BACKEND_LAUNCHER_PID (
    call :Fail "Could not start the backend terminal window."
    exit /b 1
)
> "%BACKEND_LAUNCHER_PID_FILE%" echo %BACKEND_LAUNCHER_PID%

call :WaitForUrl "%BACKEND_HEALTH%" "FastAPI backend" 60
if errorlevel 1 (
    call "%ROOT%\stop_demo.bat"
    echo Backend did not become healthy in time. Check the SMART V3 Backend window for details.
    exit /b 1
)
call :SaveListenerPid 8000 "%BACKEND_PID_FILE%" "FastAPI backend" "%BACKEND_LAUNCHER_PID%" backend
if errorlevel 1 (
    call "%ROOT%\stop_demo.bat"
    exit /b 1
)

echo.
echo [3/4] Starting React frontend...
set "SMART_DEMO_FRONTEND_RUNNER=%FRONTEND_RUNNER%"
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', ('"' + $env:SMART_DEMO_FRONTEND_RUNNER + '"')) -PassThru; $p.Id"') do set "FRONTEND_LAUNCHER_PID=%%P"
if not defined FRONTEND_LAUNCHER_PID (
    call "%ROOT%\stop_demo.bat"
    call :Fail "Could not start the frontend terminal window."
    exit /b 1
)
> "%FRONTEND_LAUNCHER_PID_FILE%" echo %FRONTEND_LAUNCHER_PID%

call :WaitForUrl "%FRONTEND_URL%" "React frontend" 60
if errorlevel 1 (
    call "%ROOT%\stop_demo.bat"
    echo Frontend did not become ready in time. Check the SMART V3 Frontend window for details.
    exit /b 1
)
call :SaveListenerPid 5173 "%FRONTEND_PID_FILE%" "React frontend" "%FRONTEND_LAUNCHER_PID%" frontend
if errorlevel 1 (
    call "%ROOT%\stop_demo.bat"
    exit /b 1
)

echo.
echo [4/4] Opening dashboard...
set "SMART_DEMO_FRONTEND_URL=%FRONTEND_URL%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process $env:SMART_DEMO_FRONTEND_URL" >nul 2>nul
if errorlevel 1 (
    echo Warning: could not open the browser automatically. Open %FRONTEND_URL% manually.
)

echo.
echo Demo ready:
echo Frontend: %FRONTEND_URL%
echo Backend:  %BACKEND_URL%
echo.
echo Use stop_demo.bat to stop both services.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5" >nul 2>nul
exit /b 0

:EnsurePortFree
set "PORT_PIDS="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do set "PORT_PIDS=%%P"
if defined PORT_PIDS (
    echo Port %~1 is already occupied by PIDs: %PORT_PIDS%
    echo ERROR: %~2 cannot start because port %~1 is already occupied.
    echo Close the process using that port, or run stop_demo.bat if it is an old demo session.
    exit /b 1
)
exit /b 0

:SaveListenerPid
set "LISTENER_PID="
set "SMART_DEMO_PORT=%~1"
set "SMART_DEMO_ROOT=%ROOT%"
set "SMART_DEMO_LAUNCHER_PID=%~4"
set "SMART_DEMO_KIND=%~5"
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = [int]$env:SMART_DEMO_PORT; $launcherPid = [int]$env:SMART_DEMO_LAUNCHER_PID; $root = [IO.Path]::GetFullPath($env:SMART_DEMO_ROOT); $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue); if ($connections.Count -eq 0) { exit 1 }; $ownerPid = [int]$connections[0].OwningProcess; $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerPid) -ErrorAction SilentlyContinue; if (-not $process) { exit 1 }; $command = [string]$process.CommandLine; $expectedPath = Join-Path $root '.venv\Scripts\python.exe'; if ($env:SMART_DEMO_KIND -eq 'backend') { $expected = ([string]$process.Name -ieq 'python.exe') -and ($command -match '(?i)uvicorn\s+app\.main:app') -and ($command -match '(?i)--app-dir\s+backend') -and ($command -match '(?i)--port\s+8000') } else { $frontendRoot = Join-Path $root 'frontend'; $expected = ([string]$process.Name -ieq 'node.exe') -and ($command.IndexOf($frontendRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) -and ($command -match '(?i)vite') -and ($command -match '(?i)--port\s+5173') }; $descendant = $false; $venvAncestor = $env:SMART_DEMO_KIND -ne 'backend'; $current = $process; for ($i = 0; $i -lt 12 -and $current; $i++) { if ([string]$current.ExecutablePath -ieq $expectedPath) { $venvAncestor = $true }; if ([int]$current.ProcessId -eq $launcherPid) { $descendant = $true; break }; if ([int]$current.ParentProcessId -le 0) { break }; $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$current.ParentProcessId) -ErrorAction SilentlyContinue }; if ($expected -and $descendant -and $venvAncestor) { $ownerPid } else { exit 1 }"') do set "LISTENER_PID=%%P"
if not defined LISTENER_PID (
    echo ERROR: Could not validate the %~3 listener on port %~1 as a child of launcher PID %~4.
    exit /b 1
)
> "%~2" echo %LISTENER_PID%
if /i "%~5"=="backend" set "BACKEND_PID=%LISTENER_PID%"
if /i "%~5"=="frontend" set "FRONTEND_PID=%LISTENER_PID%"
echo Tracking %~3 listener PID %LISTENER_PID%.
exit /b 0

:WaitForUrl
set "SMART_DEMO_WAIT_URL=%~1"
set "SMART_DEMO_WAIT_NAME=%~2"
set "SMART_DEMO_WAIT_SECONDS=%~3"
echo Waiting for %~2...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url = $env:SMART_DEMO_WAIT_URL; $name = $env:SMART_DEMO_WAIT_NAME; $deadline = (Get-Date).AddSeconds([int]$env:SMART_DEMO_WAIT_SECONDS); do { try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Write-Host ($name + ' is responding.'); exit 0 } } catch { }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"
exit /b %ERRORLEVEL%

:WriteBackendRunner
(
    echo @echo off
    echo title SMART V3 Backend
    echo cd /d "%ROOT%"
    echo call ".venv\Scripts\activate.bat"
    echo echo ========================================
    echo echo SMART SCAN SCHEDULER V3 - BACKEND
    echo echo ========================================
    echo echo Backend: %BACKEND_URL%
    echo echo Health:  %BACKEND_HEALTH%
    echo echo.
    echo python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
) > "%BACKEND_RUNNER%"
exit /b 0

:WriteFrontendRunner
(
    echo @echo off
    echo title SMART V3 Frontend
    echo cd /d "%ROOT%\frontend"
    echo echo ========================================
    echo echo SMART SCAN SCHEDULER V3 - FRONTEND
    echo echo ========================================
    echo echo Frontend: %FRONTEND_URL%
    echo echo.
    echo npm run dev -- --host localhost --port 5173 --strictPort
) > "%FRONTEND_RUNNER%"
exit /b 0

:Fail
echo.
echo ERROR: %~1
echo.
echo Startup stopped. Fix the issue above and run start_demo.bat again.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 20" >nul 2>nul
exit /b 1
