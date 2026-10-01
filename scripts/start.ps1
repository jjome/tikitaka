param(
    [ValidateSet('demo', 'openai')][string]$Provider = 'demo',
    [string]$Model = '',
    [ValidateRange(1024, 65535)][int]$Port = 8100
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) { throw 'Run .\scripts\setup.ps1 first.' }
$env:TIKITAKA_PROVIDER = $Provider
if ($Model) { $env:TIKITAKA_MODEL = $Model }
if ($Provider -eq 'openai' -and (-not $env:OPENAI_API_KEY -or -not $env:TIKITAKA_MODEL)) {
    throw 'Set OPENAI_API_KEY in your shell and specify -Model. Do not put your key in a file or chat.'
}
Write-Output "Tikitaka: http://127.0.0.1:$Port  ($Provider)"
& $venvPython -X utf8 -m uvicorn backend.app.main:app --host 127.0.0.1 --port $Port --ws-max-size 8192

