@echo off
:: Als Admin neu starten falls nÃ¶tig
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "C:\_Daten\mapplus-tnet"
if exist "FastAPI" (
    echo FastAPI-Link existiert bereits.
) else (
    mklink /D "FastAPI" "\\gisdaten-app-01\FastAPI"
)
pause

