@echo off
title Material Review Agent
cd /d "%~dp0"

echo ============================================
echo   Material Review Agent - Starting up...
echo ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python 3.11+
    pause & exit /b 1
)

if not exist "venv" (
    echo [1/3] Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo [2/3] Installing / updating dependencies...
pip install -r requirements.txt --quiet
pip install "Pillow>=11.0.0" --pre --quiet
pip install "pydantic>=2.0.0" --pre --quiet

if not exist "uploads\specs"      mkdir uploads\specs
if not exist "uploads\mill_certs" mkdir uploads\mill_certs

echo [3/3] Starting server...
echo.
echo  App ready at:  http://localhost:8000
echo  Press Ctrl+C to stop
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000

pause
