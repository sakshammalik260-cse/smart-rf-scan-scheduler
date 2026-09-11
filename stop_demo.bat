@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "ROOT=%CD%"
set "RUNTIME_DIR=%ROOT%\.demo_runtime"
set "BACKEND_PID_FILE=%RUNTIME_DIR%\backend.pid"
set "FRONTEND_PID_FILE=%RUNTIME_DIR%\frontend.pid"
set "BACKEND_LAUNCHER_PID_FILE=%RUNTIME_DIR%\backend_launcher.pid"
set "FRONTEND_LAUNCHER_PID_FILE=%RUNTIME_DIR%\frontend_launcher.pid"
set "ISSUES=0"

echo ========================================
echo SMART SCAN SCHEDULER V3
echo SIH DEMO SHUTDOWN
echo ========================================
echo.

echo [1/3] Stopping tracked demo processes...
call :StopService "%BACKEND_PID_FILE%" "%BACKEND_LAUNCHER_PID_FILE%" "FastAPI backend" 8000 backend "%RUNTIME_DIR%\backend_demo.cmd"
call :StopService "%FRONTEND_PID_FILE%" "%FRONTEND_LAUNCHER_PID_FILE%" "React frontend" 5173 frontend "%RUNTIME_DIR%\frontend_demo.cmd"

echo.
echo [2/3] Waiting for demo processes to exit...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2" >nul 2>nul

echo.
echo [3/3] Verifying ports are stopped...
call :CheckPortStopped 8000 "FastAPI backend"
call :CheckPortStopped 5173 "React frontend"

if "%ISSUES%"=="1" (
    echo.
    echo Shutdown finished, but one or more demo ports are still in use.
    echo Unrelated or unverified listeners were left untouched. PID files were preserved for diagnosis.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 10" >nul 2>nul
    exit /b 1
)

del "%BACKEND_PID_FILE%" >nul 2>nul
del "%FRONTEND_PID_FILE%" >nul 2>nul
del "%BACKEND_LAUNCHER_PID_FILE%" >nul 2>nul
del "%FRONTEND_LAUNCHER_PID_FILE%" >nul 2>nul

echo.
echo Demo stopped.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3" >nul 2>nul
exit /b 0

:StopService
set "PID_FILE=%~1"
set "LAUNCHER_PID_FILE=%~2"
set "SERVICE_NAME=%~3"
set "SERVICE_PORT=%~4"
set "SERVICE_KIND=%~5"
set "RUNNER_PATH=%~6"
set "STORED_PID="

if exist "%PID_FILE%" (
    for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "STORED_PID=%%P"
) else (
    echo No PID file for %SERVICE_NAME%; checking validated port-owner fallback.
)

call :FindValidatedPortOwner %SERVICE_PORT% %SERVICE_KIND%
if defined VALIDATED_PID (
    if defined STORED_PID if not "%STORED_PID%"=="%VALIDATED_PID%" echo Stored PID %STORED_PID% is stale; validated demo listener PID %VALIDATED_PID% owns port %SERVICE_PORT%.
    echo Stopping validated %SERVICE_NAME% listener PID %VALIDATED_PID%...
    taskkill /PID %VALIDATED_PID% /T /F >nul 2>nul
    if errorlevel 1 echo Warning: could not stop %SERVICE_NAME% listener PID %VALIDATED_PID%.
) else (
    if defined STORED_PID echo Stored PID %STORED_PID% does not own a validated %SERVICE_NAME% listener on port %SERVICE_PORT%; it was not killed.
)

call :StopLauncherPid "%LAUNCHER_PID_FILE%" "%RUNNER_PATH%" "%SERVICE_NAME%"
exit /b 0

:FindValidatedPortOwner
set "VALIDATED_PID="
set "SMART_DEMO_PORT=%~1"
set "SMART_DEMO_KIND=%~2"
set "SMART_DEMO_ROOT=%ROOT%"
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = [int]$env:SMART_DEMO_PORT; $root = [IO.Path]::GetFullPath($env:SMART_DEMO_ROOT); $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue); if ($connections.Count -eq 0) { exit 1 }; $ownerPid = [int]$connections[0].OwningProcess; $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerPid) -ErrorAction SilentlyContinue; if (-not $process) { exit 1 }; $command = [string]$process.CommandLine; $expectedPath = Join-Path $root '.venv\Scripts\python.exe'; if ($env:SMART_DEMO_KIND -eq 'backend') { $expected = ([string]$process.Name -ieq 'python.exe') -and ($command -match '(?i)uvicorn\s+app\.main:app') -and ($command -match '(?i)--app-dir\s+backend') -and ($command -match '(?i)--port\s+8000'); $venvAncestor = $false; $current = $process; for ($i = 0; $i -lt 12 -and $current; $i++) { if ([string]$current.ExecutablePath -ieq $expectedPath) { $venvAncestor = $true; break }; if ([int]$current.ParentProcessId -le 0) { break }; $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$current.ParentProcessId) -ErrorAction SilentlyContinue }; $expected = $expected -and $venvAncestor } else { $frontendRoot = Join-Path $root 'frontend'; $expected = ([string]$process.Name -ieq 'node.exe') -and ($command.IndexOf($frontendRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) -and ($command -match '(?i)vite') -and ($command -match '(?i)--port\s+5173') }; if ($expected) { $ownerPid } else { exit 1 }"') do set "VALIDATED_PID=%%P"
exit /b 0

:StopLauncherPid
set "LAUNCHER_PID="
set "VALIDATED_LAUNCHER_PID="
if not exist "%~1" exit /b 0
for /f "usebackq delims=" %%P in ("%~1") do set "LAUNCHER_PID=%%P"
if not defined LAUNCHER_PID exit /b 0
set "SMART_DEMO_LAUNCHER_PID=%LAUNCHER_PID%"
set "SMART_DEMO_RUNNER_PATH=%~2"
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$env:SMART_DEMO_LAUNCHER_PID) -ErrorAction SilentlyContinue; if (-not $process) { exit 1 }; $command = [string]$process.CommandLine; if (([string]$process.Name -ieq 'cmd.exe') -and ($command.IndexOf($env:SMART_DEMO_RUNNER_PATH, [StringComparison]::OrdinalIgnoreCase) -ge 0)) { $process.ProcessId } else { exit 1 }"') do set "VALIDATED_LAUNCHER_PID=%%P"
if defined VALIDATED_LAUNCHER_PID (
    echo Closing validated %~3 terminal PID %VALIDATED_LAUNCHER_PID%...
    taskkill /PID %VALIDATED_LAUNCHER_PID% /T /F >nul 2>nul
)
exit /b 0

:CheckPortStopped
set "PORT_PIDS="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do set "PORT_PIDS=%%P"
if defined PORT_PIDS (
    echo Port %~1 is still in use by PIDs: %PORT_PIDS%
    echo %~2 is not fully stopped.
    set "ISSUES=1"
) else (
    echo %~2 stopped.
)
exit /b 0
