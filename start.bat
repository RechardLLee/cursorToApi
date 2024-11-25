@echo off
chcp 65001
echo Cursor API 管理界面启动程序

:: 创建必要的目录
if not exist "public" mkdir public

:: 复制前端文件
if not exist "public\index.html" (
    echo 正在创建前端文件...
    copy /Y index.html public\index.html
)

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo 未安装 Node.js，请访问 https://nodejs.org/ 下载安装
    pause
    exit /b
)

:: 安装依赖
echo 正在安装依赖...
call npm install

:: 启动服务器
echo 正在启动服务器...
node server.js

pause