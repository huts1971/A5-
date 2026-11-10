$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$log = Join-Path $backend 'backend-local-server-8001.log'

if (-not (Test-Path $python)) {
  throw "Backend venv python not found: $python. Run init-env.bat from the project root first."
}

Set-Location $backend
& $python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 *> $log
