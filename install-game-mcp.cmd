@echo off
setlocal
cd /d "%~dp0vendor\stellaris-mcp\stellaris_mcp_server"
call npm ci
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
echo MCP server built. This does not install the game DLL.
pause
exit /b 0
:fail
pause
exit /b 1
