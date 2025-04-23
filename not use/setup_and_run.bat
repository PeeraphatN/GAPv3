@echo off
setlocal enabledelayedexpansion

:: ========================
:: 1. Check if Python is installed
:: ========================
echo Checking for Python...

:: Check if python is actually usable (not just a Microsoft Store redirect)
python --version >nul 2>nul
if %errorlevel% NEQ 0 (
    echo Python was not found
    echo Please install Python from https://www.python.org/downloads/windows/ or type python in cmd and press enter
    pause
    exit /b
)

echo Python found and working.
python --version

:: ========================
:: 2. Ensure pip is installed
:: ========================
echo Checking for pip...
python -m ensurepip --upgrade

:: ========================
:: 3. Create Virtual Environment
:: ========================
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate

:: ========================
:: 4. Install dependencies
:: ========================
echo Installing required Python packages: requests, flask, apscheduler, pymysql...
python -m pip install --upgrade pip
pip install requests flask apscheduler pymysql

:: ========================
:: 5. Run the project
:: ========================
:MENU
cls
echo ========================================
echo        TTN Auto Pump Scheduler
echo ========================================
echo.
echo 1. Start TTN Auto Pump
echo 2. Stop TTN Auto Pump
echo 3. Restart TTN Auto Pump
echo 4. Exit
echo.
set /p choice=Enter your choice [1-4]: 

if "%choice%"=="1" goto START
if "%choice%"=="2" goto STOP
if "%choice%"=="3" goto RESTART
if "%choice%"=="4" exit
goto MENU

:START
echo.
echo Activating virtual environment...
call venv\Scripts\activate

echo Starting TTN Auto Pump...
start cmd /k python ttn_auto_pump.py
pause
goto MENU

:STOP
echo.
echo Searching for ttn_auto_pump.py process...

setlocal ENABLEDELAYEDEXPANSION
set found=0

for /f "tokens=2,9 delims=," %%a in ('tasklist /v /fo csv ^| findstr "ttn_auto_pump.py"') do (
    echo Terminating PID %%a - %%b
    taskkill /PID %%a /F >nul 2>nul
    set found=1
)

if "!found!"=="0" (
    echo No ttn_auto_pump.py process found.
) else (
    echo Done.
)

endlocal
pause
goto MENU


:RESTART
echo.
echo Restarting TTN Auto Pump...
taskkill /F /IM python.exe >nul 2>nul
timeout /t 2 >nul
call venv\Scripts\activate
start cmd /k python ttn_auto_pump.py
pause
goto MENU