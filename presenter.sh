#!/bin/bash
# Presenter launcher (Linux)
set -e
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

PORT="${PORT:-8787}"
URL="http://localhost:${PORT}/"
LOG_FILE="$APP_DIR/.presenter-server.log"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it (e.g. 'sudo apt install nodejs') and try again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if [ ! -f "$APP_DIR/server.js" ]; then
  echo "server.js wasn't found in this folder. Keep presenter.sh next to server.js, presenter.html and remote.html."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if ! curl -s -o /dev/null -m 1 "$URL"; then
  nohup node "$APP_DIR/server.js" > "$LOG_FILE" 2>&1 &
  disown || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    if curl -s -o /dev/null -m 1 "$URL"; then break; fi
  done
fi

xdg-open "$URL" >/dev/null 2>&1 \
  || sensible-browser "$URL" >/dev/null 2>&1 \
  || echo "Open $URL in your browser."
