@echo off
rem Daily update: export apartments from the base, then publish to GitHub Pages.
cd /d "%~dp0.."
".venv\Scripts\python.exe" -I -X utf8 export\export.py
if errorlevel 1 exit /b %errorlevel%
git add -A site/data
git diff --cached --quiet
if not errorlevel 1 (echo %date% %time% no changes>> export\log.txt & exit /b 0)
git commit -m "Update apartments %date%" >nul
git push >> export\log.txt 2>&1
