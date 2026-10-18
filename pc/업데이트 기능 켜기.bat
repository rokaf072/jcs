@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jcs-update.ps1" -Setup
echo.
pause
