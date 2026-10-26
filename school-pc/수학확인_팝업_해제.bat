@echo off
rem  Remove the math-check popup schedule created by the setup file.
if exist "%~dp0math_popup_tray.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0math_popup_tray.ps1" -Quit
timeout /t 2 /nobreak >nul
schtasks /delete /tn "ClassroomMathPopup" /f
schtasks /delete /tn "ClassroomMathPopupLogon" /f 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ClassroomMathPopup /f >nul 2>&1
if exist "%~dp0open_math_popup.bat" del "%~dp0open_math_popup.bat"
if exist "%APPDATA%\ClassroomMathPopup\settings.json" del "%APPDATA%\ClassroomMathPopup\settings.json"
echo.
echo  Removed. The popup will no longer open automatically.
echo.
pause
