#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$ROOT/.tools/node/bin"
PYTHON="$ROOT/backend/.venv/bin/python"
BACKEND_LOG="$ROOT/backend/backend-dev-server-8001.log"
BACKEND_ERR="$ROOT/backend/backend-dev-server-8001.err.log"
FRONTEND_LOG="$ROOT/frontend/frontend-dev-server-5173.log"
FRONTEND_ERR="$ROOT/frontend/frontend-dev-server-5173.err.log"
BACKEND_PID="$ROOT/backend/backend-dev-server-8001.pid"
FRONTEND_PID="$ROOT/frontend/frontend-dev-server-5173.pid"
BACKEND_SCREEN="a5-backend-8001"
FRONTEND_SCREEN="a5-frontend-5173"

if [[ ! -x "$PYTHON" || ! -x "$NODE/npm" ]]; then
  echo "Missing local tools or dependencies."
  echo "Run: ./scripts/bootstrap-macos.sh"
  exit 1
fi

if [[ ! -f "$ROOT/backend/.env" && -f "$ROOT/backend/.env.example" ]]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
fi

cat > "$ROOT/frontend/.env.local" <<'EOF'
VITE_API_BASE_URL=http://127.0.0.1:8001
VITE_USE_MOCK_API=false
EOF

"$ROOT/scripts/stop-dev-macos.sh" >/dev/null 2>&1 || true

echo "Starting backend on http://127.0.0.1:8001"
: > "$BACKEND_LOG"
: > "$BACKEND_ERR"
if command -v screen >/dev/null 2>&1; then
  screen -S "$BACKEND_SCREEN" -X quit >/dev/null 2>&1 || true
  screen -dmS "$BACKEND_SCREEN" bash -lc "cd '$ROOT/backend' && exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8001 >>'$BACKEND_LOG' 2>>'$BACKEND_ERR'"
  echo "screen:$BACKEND_SCREEN" > "$BACKEND_PID"
else
  nohup bash -c "cd '$ROOT/backend' && exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8001" \
    >>"$BACKEND_LOG" 2>>"$BACKEND_ERR" &
  echo $! > "$BACKEND_PID"
fi

echo "Starting frontend on http://127.0.0.1:5173"
: > "$FRONTEND_LOG"
: > "$FRONTEND_ERR"
if command -v screen >/dev/null 2>&1; then
  screen -S "$FRONTEND_SCREEN" -X quit >/dev/null 2>&1 || true
  screen -dmS "$FRONTEND_SCREEN" bash -lc "cd '$ROOT/frontend' && PATH='$NODE':\"\$PATH\" exec '$NODE/npm' run dev >>'$FRONTEND_LOG' 2>>'$FRONTEND_ERR'"
  echo "screen:$FRONTEND_SCREEN" > "$FRONTEND_PID"
else
  nohup bash -c "cd '$ROOT/frontend' && PATH='$NODE':\"\$PATH\" exec '$NODE/npm' run dev" \
    >>"$FRONTEND_LOG" 2>>"$FRONTEND_ERR" &
  echo $! > "$FRONTEND_PID"
fi

wait_url() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready: $url"
      return 0
    fi
    sleep 0.5
  done
  echo "$name may still be starting: $url"
  return 1
}

wait_url "http://127.0.0.1:8001/health" "Backend" || true
wait_url "http://127.0.0.1:5173/" "Visitor frontend" || true
wait_url "http://127.0.0.1:5174/" "Admin frontend" || true

echo ""
echo "Visitor: http://127.0.0.1:5173/"
echo "AI Guide: http://127.0.0.1:5173/guide"
echo "Admin: http://127.0.0.1:5174/"
echo "Backend docs: http://127.0.0.1:8001/docs"
echo ""
echo "Logs:"
echo "  $BACKEND_LOG"
echo "  $BACKEND_ERR"
echo "  $FRONTEND_LOG"
echo "  $FRONTEND_ERR"
echo ""
echo "Stop with: ./scripts/stop-dev-macos.sh"
