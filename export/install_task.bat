@echo off
rem Creates a Windows task: update the site every day at 09:00.
schtasks /Create /F /SC DAILY /ST 09:00 /TN "OshCity - update" /TR "\"%~dp0update.bat\""
