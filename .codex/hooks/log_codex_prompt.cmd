@echo off
setlocal

for /f "delims=" %%R in ('git rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%R"
set "REPO_ROOT=%REPO_ROOT:/=\%"
if not defined REPO_ROOT exit /b 0
set "AI_LOG_DIR=%REPO_ROOT%\.ai-log"

set "SCRIPT=%REPO_ROOT%\scripts\log_hook.py"
if not exist "%SCRIPT%" exit /b 0

if exist "%REPO_ROOT%\.venv\Scripts\python.exe" (
  "%REPO_ROOT%\.venv\Scripts\python.exe" "%SCRIPT%" --tool=codex
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%SCRIPT%" --tool=codex
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python "%SCRIPT%" --tool=codex
  exit /b %ERRORLEVEL%
)

where python3 >nul 2>nul
if %ERRORLEVEL%==0 (
  python3 "%SCRIPT%" --tool=codex
  exit /b %ERRORLEVEL%
)

exit /b 0
