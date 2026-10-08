param(
    [string]$ApkPath = '',
    [string]$DeviceSerial = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$adbPath = if ($adbCommand) { $adbCommand.Source } elseif ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' } else { '' }
if (-not $adbPath -or -not (Test-Path -LiteralPath $adbPath)) {
    throw 'Android platform-tools is required. Install the official SDK and add adb to PATH or set ANDROID_HOME.'
}
if (-not $ApkPath) {
    $ApkPath = Join-Path $projectRoot 'apps\android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $ApkPath)) {
        $artifactRoot = Join-Path $projectRoot '.runtime\artifacts'
        $latest = Get-ChildItem -LiteralPath $artifactRoot -Filter app-debug.apk -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) { $ApkPath = $latest.FullName }
    }
}
if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) { throw 'Build or download the debug APK first, or provide -ApkPath.' }
$ApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
try { $health = Invoke-RestMethod 'http://127.0.0.1:8103/api/health' -TimeoutSec 5 }
catch { throw 'Start the API server on port 8103 before connecting the app.' }
if ($health.mode -ne 'openai' -or $health.voice_transport -ne 'api') { throw 'Port 8103 must run the real OpenAI voice server.' }
$deviceLines = & $adbPath devices
if ($LASTEXITCODE -ne 0) { throw 'Could not read Android devices.' }
$available = @($deviceLines | ForEach-Object { if ($_ -match '^([^\s]+)\s+device$') { $Matches[1] } })
if ($DeviceSerial) {
    if ($DeviceSerial -notin $available) { throw 'Requested device is not ready. Unlock it and approve USB debugging on the phone.' }
} elseif ($available.Count -eq 1) { $DeviceSerial = $available[0] }
elseif ($available.Count -eq 0) { throw 'Connect and unlock a phone with USB debugging enabled; approve the PC connection on the phone.' }
else { throw 'Multiple devices are connected. Specify -DeviceSerial from adb devices.' }
& $adbPath -s $DeviceSerial install -r $ApkPath
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. Existing data was not removed; check the device and signing certificate.' }
& $adbPath -s $DeviceSerial reverse tcp:8103 tcp:8103
if ($LASTEXITCODE -ne 0) { throw 'Could not connect the device to the PC server.' }
& $adbPath -s $DeviceSerial shell am start -n com.jjome.tikitaka.dev/com.jjome.tikitaka.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'App launch failed.' }
Write-Host 'Tikitaka is open. Tap Start and approve microphone access on the phone. Keep the PC API server and USB connection active.'
