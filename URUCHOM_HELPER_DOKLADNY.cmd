@echo off
setlocal
title Premiere Karaoke - instalacja i helper
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0packages\alignment-service\start-helper.ps1"
if errorlevel 1 (
  echo.
  echo Wystapil blad. Skopiuj czerwony komunikat i wyslij go autorowi wtyczki.
  pause
)
endlocal
