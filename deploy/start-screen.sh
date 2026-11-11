#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if screen -list | grep -q '[.]stellaris-government[[:space:]]'; then
  echo 'stellaris-government screen 会话已存在。'
  exit 1
fi
screen -dmS stellaris-government bash deploy/run.sh
echo '已启动。查看：screen -r stellaris-government；退出查看：Ctrl+A 然后 D。'
