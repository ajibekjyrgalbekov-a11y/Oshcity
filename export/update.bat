@echo off
rem Ежедневное обновление сайта: выгрузка из базы -> публикация на GitHub Pages.
chcp 65001 >nul
cd /d "%~dp0.."
".venv\Scripts\python.exe" -I -X utf8 export\export.py
if errorlevel 1 exit /b %errorlevel%
git add site/data/apartments.json
git diff --cached --quiet && (echo %date% %time% нет изменений>> export\log.txt & exit /b 0)
git commit -m "Обновление наличия квартир %date%" >nul
git push >> export\log.txt 2>&1
