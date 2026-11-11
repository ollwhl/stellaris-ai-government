#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
export PATH="$PWD/runtime/node/node-v24.22.2-linux-x64/bin:$PATH"
export HOST=0.0.0.0 PORT=8001 PUBLIC_PREVIEW=1 PUBLIC_PREVIEW_HTTP=1
unset TLS_CERT_FILE TLS_KEY_FILE
exec node --import tsx app/server.ts
