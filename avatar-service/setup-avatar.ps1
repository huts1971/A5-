param(
  [switch]$SkipModels
)

$ErrorActionPreference = "Stop"

$ServiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OpenAvatarRoot = Join-Path $ServiceDir "vendor\OpenAvatarChat"
$OpenAvatarCommit = "dcfba11e5bb582084a163359bb3ad996415977cf"
$ConfigSource = Join-Path $ServiceDir "openavatar\a5_liteavatar.yaml"
$ConfigTarget = Join-Path $OpenAvatarRoot "config\a5_liteavatar.yaml"
$BridgeHandlerSource = Join-Path $ServiceDir "openavatar\a5_bridge_handler.py"
$BridgeHandlerDir = Join-Path $OpenAvatarRoot "src\handlers\a5_bridge"
$QwenTtsHandlerSource = Join-Path $ServiceDir "openavatar\qwen_tts_realtime"
$QwenTtsHandlerDir = Join-Path $OpenAvatarRoot "src\handlers\tts\qwen_tts_realtime"
$OpenAvatarPython = Join-Path $OpenAvatarRoot ".venv\Scripts\python.exe"
$BridgeVenv = Join-Path $ServiceDir ".venv"
$BridgePython = Join-Path $BridgeVenv "Scripts\python.exe"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Find-Uv {
  $command = Get-Command "uv" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($version in @("3.12", "3.11", "3")) {
    try {
      $scripts = & py "-$version" -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
      $candidate = Join-Path $scripts "uv.exe"
      if (Test-Path $candidate) { return $candidate }
    } catch {
      continue
    }
  }
  throw "uv was not found. Install it with: py -3.12 -m pip install uv"
}

Require-Command "git"
$Uv = Find-Uv
$env:PATH = "$(Split-Path -Parent $Uv);$env:PATH"
$env:UV_LINK_MODE = "copy"

if (-not (Test-Path $OpenAvatarRoot)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OpenAvatarRoot) | Out-Null
  git clone https://github.com/HumanAIGC-Engineering/OpenAvatarChat.git $OpenAvatarRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not clone OpenAvatarChat." }
}

Push-Location $OpenAvatarRoot
try {
  git fetch origin $OpenAvatarCommit
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch the pinned OpenAvatarChat commit." }
  git checkout $OpenAvatarCommit
  if ($LASTEXITCODE -ne 0) { throw "Could not check out the pinned OpenAvatarChat commit." }
  git submodule update --init --depth 1 `
    src/handlers/avatar/liteavatar/algo/liteavatar `
    src/handlers/vad/silerovad/silero_vad
  if ($LASTEXITCODE -ne 0) { throw "Could not initialize LiteAvatar and Silero VAD submodules." }
  Copy-Item -LiteralPath $ConfigSource -Destination $ConfigTarget -Force
  New-Item -ItemType Directory -Force -Path $BridgeHandlerDir | Out-Null
  Copy-Item -LiteralPath $BridgeHandlerSource -Destination (Join-Path $BridgeHandlerDir "a5_bridge_handler.py") -Force
  New-Item -ItemType Directory -Force -Path $QwenTtsHandlerDir | Out-Null
  Copy-Item -Path (Join-Path $QwenTtsHandlerSource "*") -Destination $QwenTtsHandlerDir -Recurse -Force
  if (-not (Test-Path (Join-Path $BridgeHandlerDir "__init__.py"))) {
    New-Item -ItemType File -Path (Join-Path $BridgeHandlerDir "__init__.py") | Out-Null
  }

  if (-not (Test-Path $OpenAvatarPython)) {
    & $Uv venv --python 3.11
    if ($LASTEXITCODE -ne 0) { throw "Could not create the OpenAvatarChat virtual environment." }
  }
  & $Uv run install.py --config $ConfigTarget
  if ($LASTEXITCODE -ne 0) { throw "Could not install OpenAvatarChat handler dependencies." }
  if (-not $SkipModels) {
    & $Uv run scripts/download_models.py --handler liteavatar
    if ($LASTEXITCODE -ne 0) { throw "Could not download LiteAvatar weights." }
    & $Uv run scripts/download_avatar_model.py --model "20250408/sample_data"
    if ($LASTEXITCODE -ne 0) { throw "Could not download the default LiteAvatar character." }
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $BridgePython)) {
  & $Uv venv $BridgeVenv --python 3.11
  if ($LASTEXITCODE -ne 0) { throw "Could not create the avatar bridge virtual environment." }
}
& $Uv pip install --python $BridgePython -r (Join-Path $ServiceDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install avatar bridge dependencies." }

$EnvFile = Join-Path $ServiceDir ".env"
if (-not (Test-Path $EnvFile)) {
  Copy-Item -LiteralPath (Join-Path $ServiceDir ".env.example") -Destination $EnvFile
}

Write-Host "Avatar environments are ready." -ForegroundColor Green
Write-Host "Set DASHSCOPE_API_KEY in avatar-service\.env before starting."
