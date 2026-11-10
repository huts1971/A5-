param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ReleaseRoot = Join-Path $Root ".release"
$PackageName = "lingshiyin-agentic-guide"
$StageDir = Join-Path $ReleaseRoot $PackageName
$ZipPath = Join-Path $ReleaseRoot "$PackageName.zip"

function Write-Step([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Cyan
}

try {
  Write-Host "Creating portable package for team deployment" -ForegroundColor Green
  Write-Host "Project root: $Root"

  Write-Step "[1/3] Preparing release folder"
  $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $resolvedStage = [IO.Path]::GetFullPath($StageDir)
  if (-not $resolvedStage.StartsWith($resolvedRoot + '.release\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Release directory must stay inside this project."
  }
  if (Test-Path $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null

  Write-Step "[2/3] Copying source files"
  $excludeDirs = @(
    ".git",
    (Join-Path $Root "backend\data"),
    (Join-Path $Root "artifacts"),
    (Join-Path $Root "models"),
    (Join-Path $Root "data"),
    ".release",
    ".cache",
    ".render-temp",
    ".scratch",
    ".codex-logs",
    "node_modules",
    ".vite-cache",
    "test-results",
    ".venv",
    ".venv312",
    ".python-packages",
    ".pytest_cache",
    ".pytest_tmp",
    "__pycache__",
    "tts"
  )
  $excludeFiles = @(
    "*.log",
    "*.err",
    "*.err.log",
    "*.pyc",
    "*.db",
    "*.db-*",
    "*.sqlite*",
    "*.local.toml",
    "*.safetensors",
    "*.xlsx",
    "*.xls",
    "*.zip",
    "*.partial",
    "structured_qa_eval_report*.json",
    ".env*"
  )

  $robocopyArgs = @(
    $Root,
    $StageDir,
    "/E",
    "/R:1",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NP",
    "/XD"
  ) + $excludeDirs + @("/XF") + $excludeFiles

  & robocopy @robocopyArgs | Out-Host
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
  }
  foreach ($area in @("backend", "frontend")) {
    Copy-Item -LiteralPath (Join-Path $Root "$area\.env.example") -Destination (Join-Path $StageDir "$area\.env.example")
  }

  Write-Step "[3/3] Creating zip"
  if (Test-Path $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -LiteralPath $StageDir -DestinationPath $ZipPath -Force

  Write-Host ""
  Write-Host "Portable package created:" -ForegroundColor Green
  Write-Host $ZipPath
  Write-Host ""
  Write-Host "Follow README.md for configuration, model services and index initialization."
  Write-Host "System prerequisites: Python 3.11/3.12, Node.js 20+, Docker and configured models."
} catch {
  Write-Host ""
  Write-Host "Packaging failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $NoPause) {
    Read-Host "Press Enter to exit" | Out-Null
  }
}
