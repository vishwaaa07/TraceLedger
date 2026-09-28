@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:4173 in your browser after the server starts.
echo Keep this window open while using TraceLedger.
py -3 -c "import sys; sys.exit(sys.version_info < (3,10))" >nul 2>&1
if not errorlevel 1 (
  py -3 serve.py
  goto end
)
python -c "import sys; sys.exit(sys.version_info < (3,10))" >nul 2>&1
if not errorlevel 1 (
  python serve.py
  goto end
)
echo Python 3.10 or newer is required. Install it, then try again.
:end
pause
