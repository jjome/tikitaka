param(
    [string]$Model = '',
    [ValidateSet('ko', 'en')][string]$Language = 'ko',
    [ValidateRange(1024, 65535)][int]$Port = 8100,
    [switch]$Check,
    [switch]$CheckAndStart,
    [switch]$CheckAudio,
    [switch]$Reload
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) { throw 'Run .\scripts\setup.ps1 first.' }
if (-not $Model) { $Model = $env:TIKITAKA_MODEL }
if (-not $Model) { $Model = Read-Host '사용 가능한 OpenAI 모델 ID' }
if (-not $Model.Trim()) { throw '모델 ID가 필요합니다.' }
$previousKey = $env:OPENAI_API_KEY
$previousModel = $env:TIKITAKA_MODEL
$previousProvider = $env:TIKITAKA_PROVIDER
$previousLanguage = $env:TIKITAKA_LANGUAGE
$keyPointer = [IntPtr]::Zero
$secureKey = $null
try {
    if (-not $env:OPENAI_API_KEY) {
        $secureKey = Read-Host 'OpenAI API 키 (화면에 표시하거나 파일에 저장하지 않습니다)' -AsSecureString
        $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    if (-not $env:OPENAI_API_KEY.Trim()) { throw 'API 키가 필요합니다.' }
    $env:TIKITAKA_PROVIDER = 'openai'
    $env:TIKITAKA_MODEL = $Model.Trim()
    $env:TIKITAKA_LANGUAGE = $Language
    if ($CheckAudio) {
        & $venvPython -X utf8 (Join-Path $PSScriptRoot 'check_audio.py')
        if ($LASTEXITCODE -ne 0) { throw 'Audio API check failed. Server was not started.' }
    }
    if ($Check -or $CheckAndStart) {
        $reportDirectory = Join-Path $projectRoot '.runtime'
        New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
        & $venvPython -X utf8 (Join-Path $PSScriptRoot 'check_openai.py') --language $Language --report (Join-Path $reportDirectory 'api-check.json') |
            Tee-Object -FilePath (Join-Path $reportDirectory 'api-check.out.log')
        if ($LASTEXITCODE -ne 0) { throw '실제 API 검사가 실패했습니다. 대본 데모로 전환하지 않습니다.' }
    }
    if (-not $Check -or $CheckAndStart) {
        & (Join-Path $PSScriptRoot 'start.ps1') -Provider openai -Model $env:TIKITAKA_MODEL -Language $Language -Port $Port -Reload:$Reload
    }
} finally {
    $env:OPENAI_API_KEY = $previousKey
    $env:TIKITAKA_MODEL = $previousModel
    $env:TIKITAKA_PROVIDER = $previousProvider
    $env:TIKITAKA_LANGUAGE = $previousLanguage
    if ($keyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
    if ($secureKey) { $secureKey.Dispose() }
}
