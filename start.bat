@echo off
title 小黄鸭漂流记 - 启动中...
echo.
echo   🦆 小黄鸭漂流记
echo   ==================
echo.
echo   正在启动服务器...
start "DuckGame Server" cmd /c "npm start"
timeout /t 3 /nobreak >nul
echo.
echo   正在打开浏览器...
start http://localhost:8123
echo.
echo   ✅ 已启动！
echo   访问: http://localhost:8123
echo   按任意键退出...
pause >nul
