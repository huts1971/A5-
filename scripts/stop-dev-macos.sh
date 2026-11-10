#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for session in a5-backend-8001 a5-frontend-5173; do
  if command -v screen >/dev/null 2>&1; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
  fi
done

PIDS=(
  "$ROOT/backend/backend-dev-server-8001.pid"
  "$ROOT/frontend/frontend-dev-server-5173.pid"
)

for pid_file in "${PIDS[@]}"; do
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" || true)"
    if [[ "$pid" == screen:* ]]; then
      :
    elif [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      echo "Stopped PID $pid"
    fi
    rm -f "$pid_file"
  fi
done

for port in 5173 5174 8001; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill >/dev/null 2>&1 || true
    echo "Stopped process on port $port"
  fi
done
