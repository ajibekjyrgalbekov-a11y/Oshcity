@echo off
rem Создаёт задачу в Планировщике Windows: каждый день в 09:00 обновлять квартиры на сайте.
chcp 65001 >nul
schtasks /Create /F /SC DAILY /ST 09:00 /TN "OshCity - обновление квартир" /TR "\"%~dp0update.bat\""
echo Готово. Проверить: Планировщик заданий -> "OshCity - обновление квартир".
pause
