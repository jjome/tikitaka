$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\windows-key-store.ps1')
$testFolder = Join-Path (Split-Path -Parent $PSScriptRoot) ('.runtime\credential-test-' + [guid]::NewGuid().ToString('N'))
$testPath = Join-Path $testFolder 'openai-key.dpapi'
$previousKey = $env:OPENAI_API_KEY
$dummy = 'tikitaka-test-only-' + [guid]::NewGuid().ToString('N')
function Assert-KeyEquals($secure, $expected) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -cne $expected) { throw 'Credential round trip failed.' }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}
function Read-Host { throw 'Unexpected key prompt.' }
try {
    $env:OPENAI_API_KEY = $dummy
    Assert-KeyEquals (Resolve-TikitakaApiKey -Path $testPath) $dummy
    if ([IO.File]::ReadAllText($testPath).Contains($dummy)) { throw 'Plaintext credential found on disk.' }
    if (-not (Get-Acl -LiteralPath $testFolder).AreAccessRulesProtected) { throw 'Credential ACL inherits broader access.' }
    $env:OPENAI_API_KEY = $null
    Assert-KeyEquals (Resolve-TikitakaApiKey -Path $testPath) $dummy
    function Read-Host { ConvertTo-SecureString 'replacement-test-only' -AsPlainText -Force }
    Assert-KeyEquals (Resolve-TikitakaApiKey -Path $testPath -ReplaceKey) 'replacement-test-only'
    function Read-Host { throw 'Unexpected key prompt.' }
    Assert-KeyEquals (Resolve-TikitakaApiKey -Path $testPath) 'replacement-test-only'
    [IO.File]::WriteAllText($testPath, 'invalid encrypted data')
    $rejected = $false
    try { $unexpected = Resolve-TikitakaApiKey -Path $testPath } catch { $rejected = $_.Exception.Message.Contains('Cannot decrypt') }
    if (-not $rejected) { throw 'Corrupt credentials must be rejected with a recovery instruction.' }
    Write-Output 'Credential checks passed: encryption, private ACL, prompt-free reload, replacement, corrupt-file recovery.'
} finally {
    $env:OPENAI_API_KEY = $previousKey
    if (Test-Path -LiteralPath $testPath) { Remove-Item -LiteralPath $testPath -Force }
    if (Test-Path -LiteralPath $testFolder) { Remove-Item -LiteralPath $testFolder }
}
