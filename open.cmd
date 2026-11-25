@echo off
rem Double-click: opens the demo script. Drag a script.json onto this file to open that one.
cd /d "%~dp0"
if "%~1"=="" (
  node server.mjs "examples\demo-script.json"
) else (
  node server.mjs "%~1"
)
pause
