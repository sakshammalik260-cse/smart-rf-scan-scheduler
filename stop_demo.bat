@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "ROOT=%CD%"
set "RUNTIME_DIR=%ROOT%\.demo_runtime"
set "BACKEND_PID_FILE=%RUNTIME_DIR%\backend.pid"
set "FRONTEND_PID_FILE=%RUNTIME_DIR%\frontend.pid"
set "ISSUES=0"

echo ========================================
echo SMART SCAN SCHEDULER V3
echo SIH DEMO SHUTDOWN
echo ========================================
echo.

echo [1/3] Stopping tracked demo processes...
call :StopPidFile "%BACKEND_PID_FILE%" "FastAPI backend"
call :StopPidFile "%FRONTEND_PID_FILE%" "React frontend"

echo.
echo [2/3] Cleaning up demo windows and listeners...
taskkill /FI "WINDOWTITLE eq SMART V3 Backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq SMART V3 Frontend*" /T /F >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2" >nul 2>nul

echo.
echo [3/3] Verifying ports are stopped...
call :CheckPortStopped 8000 "FastAPI backend"
call :CheckPortStopped 5173 "React frontend"

if "%ISSUES%"=="1" (
    echo.
    echo Shutdown finished, but one or more demo ports are still in use.
    echo If those are unrelated services, leave them alone. Otherwise close them and try stop_demo.bat again.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 10" >nul 2>nul
    exit /b 1
)

echo.
echo Demo stopped.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3" >nul 2>nul
exit /b 0

:StopPidFile
set "PID_FILE=%~1"
set "SERVICE_NAME=%~2"
set "PID="

if not exist "%PID_FILE%" (
    echo No PID file for %SERVICE_NAME%; checking fallback cleanup.
    exit /b 0
)

for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
if not defined PID (
    echo Empty PID file for %SERVICE_NAME%; removing it.
    del "%PID_FILE%" >nul 2>nul
    exit /b 0
)

echo Stopping %SERVICE_NAME% PID %PID%...
taskkill /PID %PID% /T /F >nul 2>nul
if errorlevel 1 (
    echo Warning: could not stop %SERVICE_NAME% PID %PID% from the PID file. It may already be stopped.
    echo Fallback cleanup will continue.
    exit /b 0
) else (
    echo %SERVICE_NAME% stopped from PID file.
)

del "%PID_FILE%" >nul 2>nul
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
