@echo off
rem  Register a weekday 08:30 popup that opens the math-check screen in a small window,
rem  with a tray icon (right side of the taskbar) to show/hide it, keep it on top, lock its place, and more.
rem  (File contents are plain English on purpose: Korean text breaks old cmd windows.)
setlocal
cd /d "%~dp0"
echo.
echo  === Math check popup: setup ===
echo.
echo  Type the address of your class site, then press Enter.
echo  Example: https://myclass.vercel.app
echo.
set /p SITE=Site address:
if "%SITE%"=="" (
  echo No address typed. Nothing was changed.
  pause
  exit /b 1
)

rem keep only the site address: drop anything after # or ? (for example /#check), add https:// if missing
for /f "tokens=1 delims=#?" %%a in ("%SITE%") do set SITE=%%a
echo %SITE%| findstr /i /b "http" >nul || set SITE=https://%SITE%
if "%SITE:~-1%"=="/" set SITE=%SITE:~0,-1%

echo.
echo  Where should the popup always appear on the screen?
echo    1 = top right (default)
echo    2 = bottom right
echo    3 = top left
echo    4 = bottom left
echo    5 = center
set /p CH=Number 1-5: 
set POS=tr
if "%CH%"=="2" set POS=br
if "%CH%"=="3" set POS=tl
if "%CH%"=="4" set POS=bl
if "%CH%"=="5" set POS=c

if not exist "%~dp0math_popup_tray.ps1" (
  echo.
  echo math_popup_tray.ps1 is missing from this folder. Download the whole school-pc folder again.
  pause
  exit /b 1
)

rem stop a popup that is already running and forget its old place, so the corner chosen above is used
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0math_popup_tray.ps1" -Quit
timeout /t 2 /nobreak >nul
if exist "%APPDATA%\ClassroomMathPopup\settings.json" del "%APPDATA%\ClassroomMathPopup\settings.json"

rem the launcher: starts the tray program, which opens the small Edge window (Edge is on every Windows 10/11 PC)
> "%~dp0open_math_popup.bat" echo @echo off
>> "%~dp0open_math_popup.bat" echo start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%%~dp0math_popup_tray.ps1" -Site "%SITE%" -Pos %POS% -W 560 -H 620

schtasks /create /tn "ClassroomMathPopup" /tr "\"%~dp0open_math_popup.bat\"" /sc weekly /d MON,TUE,WED,THU,FRI /st 08:30 /f
if errorlevel 1 (
  echo.
  echo Could not create the scheduled task. Take a screenshot of this window.
  pause
  exit /b 1
)

echo.
set /p LOGON=Also open the popup every time you log in to Windows? (y/n):
schtasks /delete /tn "ClassroomMathPopupLogon" /f >nul 2>&1
if /i "%LOGON%"=="y" reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ClassroomMathPopup /t REG_SZ /d "\"%~dp0open_math_popup.bat\"" /f >nul
if /i not "%LOGON%"=="y" reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ClassroomMathPopup /f >nul 2>&1

echo.
echo  Done. The popup opens every weekday at 08:30 (the PC must be on and logged in).
echo  Address used: %SITE%
echo  Position: %POS%  (tr=top right, br=bottom right, tl=top left, bl=bottom left, c=center)
echo  Keep this folder where it is. If you move it, run this file again.
echo.
echo  Look for the round icon next to the clock (it may be behind the little arrow).
echo  Click it to show/hide the popup. Right-click it for: always on top, lock place, move, size, run at login, quit.
echo.
set /p NOW=Open the popup now to check it? (y/n): 
if /i "%NOW%"=="y" start "" "%~dp0open_math_popup.bat"
echo.
pause
