param(
  [string]$UnityProject = $env:AVATAR151_UNITY_PROJECT,
  [string]$UnityExe = $env:UNITY_EXE
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($UnityProject)) {
  throw "Unity project is not configured. Pass -UnityProject or set AVATAR151_UNITY_PROJECT."
}

if ([string]::IsNullOrWhiteSpace($UnityExe)) {
  $hubRoot = Join-Path $env:ProgramFiles "Unity\Hub\Editor"
  if (Test-Path -LiteralPath $hubRoot) {
    $UnityExe = Get-ChildItem -LiteralPath $hubRoot -Filter "Unity.exe" -File -Recurse |
      Where-Object { $_.FullName -match '\\Editor\\Unity\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}

if ([string]::IsNullOrWhiteSpace($UnityExe)) {
  throw "Unity editor is not configured. Pass -UnityExe or set UNITY_EXE."
}

$unityProject = [System.IO.Path]::GetFullPath($UnityProject)
$unityExe = [System.IO.Path]::GetFullPath($UnityExe)
$webglSupport = Join-Path (Split-Path -Parent $unityExe) "Data\PlaybackEngines\WebGLSupport"

# Unity names WebGL files after the output folder. Use an ASCII folder whose
# basename matches frontend/src/config/avatar151Guide.ts.
$tempRoot = [System.IO.Path]::GetTempPath()
$stagedUnityProject = Join-Path $tempRoot "avatar151-unity-project"
$tempOutput = Join-Path $tempRoot "avatar151-guide"
$finalOutput = Join-Path $projectRoot "frontend\public\avatar\uketsukejou151\unity-webgl"
$log = Join-Path $projectRoot ".codex-avatar-debug\unity-avatar151-webgl-build.log"

if (-not (Test-Path -LiteralPath $unityExe)) {
  throw "Unity editor not found: $unityExe"
}

if (-not (Test-Path -LiteralPath $webglSupport)) {
  throw "Unity WebGL Build Support is missing. Install WebGL Build Support for Unity 2020.3.48f1c1 first."
}

if (-not (Test-Path -LiteralPath $unityProject)) {
  throw "Unity project not found: $unityProject"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null

$sourceController = Join-Path $projectRoot "tools\unity\Avatar151GuideWebGLController.cs"
$sourceBuilder = Join-Path $projectRoot "tools\unity\Avatar151GuideWebGLBuilder.cs"
$sourceArmCorrection = Join-Path $projectRoot "tools\unity\ArmOutwardCorrection.cs"
$targetControllerDir = Join-Path $unityProject "Assets\Avatar151Review\Review"
$targetBuilderDir = Join-Path $unityProject "Assets\Editor"
New-Item -ItemType Directory -Force -Path $targetControllerDir | Out-Null
New-Item -ItemType Directory -Force -Path $targetBuilderDir | Out-Null
Copy-Item -LiteralPath $sourceController -Destination (Join-Path $targetControllerDir "Avatar151GuideWebGLController.cs") -Force
Copy-Item -LiteralPath $sourceArmCorrection -Destination (Join-Path $targetControllerDir "ArmOutwardCorrection.cs") -Force
Copy-Item -LiteralPath $sourceBuilder -Destination (Join-Path $targetBuilderDir "Avatar151GuideWebGLBuilder.cs") -Force

# Unity 2020 WebGL uses an old Emscripten/Python toolchain that can break when
# the project path contains Chinese characters. Stage the project into an ASCII
# path before building. Only copy source project folders; Library/Temp are
# regenerated in the staged build.
if (Test-Path -LiteralPath $stagedUnityProject) {
  Remove-Item -LiteralPath $stagedUnityProject -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagedUnityProject | Out-Null

foreach ($projectFolder in @("Assets", "Packages", "ProjectSettings")) {
  $sourceFolder = Join-Path $unityProject $projectFolder
  if (Test-Path -LiteralPath $sourceFolder) {
    Copy-Item -LiteralPath $sourceFolder -Destination $stagedUnityProject -Recurse -Force
  }
}

$repoMotionSource = Join-Path $projectRoot "frontend\public\avatar\uketsukejou151\motions"
$stagedRepoMotionTarget = Join-Path $stagedUnityProject "Assets\Avatar151Review\CodexMotions"
if (Test-Path -LiteralPath $repoMotionSource) {
  New-Item -ItemType Directory -Force -Path $stagedRepoMotionTarget | Out-Null
  Get-ChildItem -LiteralPath $repoMotionSource -Filter "*.fbx" -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stagedRepoMotionTarget $_.Name) -Force
  }
}

if (Test-Path -LiteralPath $tempOutput) {
  Remove-Item -LiteralPath $tempOutput -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $tempOutput | Out-Null

$env:AVATAR151_WEBGL_OUTPUT = $tempOutput
$unityArgs = @(
  "-batchmode",
  "-quit",
  "-projectPath", $stagedUnityProject,
  "-executeMethod", "Avatar151GuideWebGLBuilder.BuildGuideWebGLPlayer",
  "-logFile", $log
)
$unityProcess = Start-Process -FilePath $unityExe -ArgumentList $unityArgs -Wait -PassThru -NoNewWindow

if ($unityProcess.ExitCode -ne 0) {
  throw "Unity WebGL build failed with exit code $($unityProcess.ExitCode). See log: $log"
}

$resolvedProjectRoot = (Resolve-Path -LiteralPath $projectRoot).Path
$resolvedFinalParent = (Resolve-Path -LiteralPath (Split-Path -Parent $finalOutput)).Path
if (-not $resolvedFinalParent.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write WebGL output outside project: $finalOutput"
}

if (Test-Path -LiteralPath $finalOutput) {
  $resolvedFinalOutput = (Resolve-Path -LiteralPath $finalOutput).Path
  if (-not $resolvedFinalOutput.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove output outside project: $resolvedFinalOutput"
  }
  Remove-Item -LiteralPath $resolvedFinalOutput -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $finalOutput | Out-Null
Get-ChildItem -LiteralPath $tempOutput -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $finalOutput -Recurse -Force
}


$loaderPath = Join-Path $finalOutput "Build\avatar151-guide.loader.js"
if (Test-Path -LiteralPath $loaderPath) {
  $loader = Get-Content -LiteralPath $loaderPath -Raw
  $loader = $loader -replace 'webglContextAttributes:\{preserveDrawingBuffer:![01]\}', 'webglContextAttributes:{alpha:!0,premultipliedAlpha:!1,preserveDrawingBuffer:!0}'
  Set-Content -LiteralPath $loaderPath -Value $loader -Encoding UTF8 -NoNewline
}

# Keep HTML form fields editable even when using an older generated player.
# New builds also disable capture through WebGLInput in the controller.
$frameworkPath = Join-Path $finalOutput "Build\avatar151-guide.framework.js"
if (Test-Path -LiteralPath $frameworkPath) {
  $framework = Get-Content -LiteralPath $frameworkPath -Raw
  $keyboardCapture = 'if(Module["dynCall_iiii"](callbackfunc,eventTypeId,keyEventData,userData))e.preventDefault()'
  $editableSafeCapture = 'var eventTarget=e.target;if(Module["dynCall_iiii"](callbackfunc,eventTypeId,keyEventData,userData)&&!(eventTarget&&(eventTarget.tagName==="INPUT"||eventTarget.tagName==="TEXTAREA"||eventTarget.isContentEditable)))e.preventDefault()'
  if (-not $framework.Contains($keyboardCapture)) {
    throw "Unity keyboard capture hook was not found: $frameworkPath"
  }
  $framework = $framework.Replace($keyboardCapture, $editableSafeCapture)
  Set-Content -LiteralPath $frameworkPath -Value $framework -Encoding UTF8 -NoNewline
}
Write-Host "Avatar151 Unity WebGL temp output: $tempOutput"
Write-Host "Avatar151 Unity WebGL copied to: $finalOutput"
Write-Host "Unity build log: $log"
