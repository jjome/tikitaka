$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) { throw 'Run .\scripts\setup.ps1 first.' }
& $venvPython -X utf8 -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw 'Python tests failed.' }
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$testNode = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
& $testNode --test tests/voice-core.test.mjs tests/voice-lifecycle.test.mjs tests/outbox.test.mjs tests/simple-flow.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Voice client tests failed.' }
foreach ($file in @('apps/pc/simple.mjs', 'apps/pc/lab.mjs', 'apps/pc/voice.mjs', 'apps/pc/voice-core.mjs', 'apps/pc/outbox.mjs')) {
    & $testNode --check $file
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $file" }
}

