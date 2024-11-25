#!/bin/bash

# 创建必要的目录和文件
mkdir -p public
if [ ! -f "public/index.html" ]; then
    echo "正在创建前端文件..."
    # 这里需要确保index.html已经存在
    if [ ! -f "index.html" ]; then
        echo "错误：找不到index.html文件"
        exit 1
    fi
    cp index.html public/index.html
fi

# 检查 node 是否安装
if ! command -v node &> /dev/null; then
    echo "未安装 Node.js，正在安装..."
    if [ "$(uname)" == "Darwin" ]; then
        # macOS
        brew install node
    elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
        # Linux
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "请先安装 Node.js: https://nodejs.org/"
        exit 1
    fi
fi

# 安装依赖
echo "正在安装依赖..."
npm install

# 启动服务器
echo "启动服务器..."
node server.js
