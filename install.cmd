@echo off
setlocal
cd /d "%~dp0"
node -e "if(parseInt(process.versions.node)<24){console.error('Please install Node.js 24 LTS');process.exit(1)}"
if errorlevel 1 goto fail
call npm ci
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
echo Installation complete. Run start.cmd
pause
exit /b 0
:fail
echo Installation failed. See the error above.
pause
exit /b 1
