param([switch]$SaveEnvironmentKey)

# Use the security module matching the host (Windows PowerShell 5 or PowerShell 7).
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop

function Get-TikitakaKeyPath {
    Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime\credentials\openai-key.dpapi'
}

function Save-TikitakaApiKey {
    param([Parameter(Mandatory)][Security.SecureString]$Key, [string]$Path = (Get-TikitakaKeyPath))
    if ($Key.Length -eq 0) { throw 'API key cannot be empty.' }
    $folder = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($folder) | Out-Null
    # Only this Windows account and SYSTEM can read the encrypted credential.
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    & "$env:SystemRoot\System32\icacls.exe" $folder '/inheritance:r' '/grant:r' "*$($owner.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credential directory access.' }
    $encrypted = ConvertFrom-SecureString -SecureString $Key -ErrorAction Stop
    $temporary = Join-Path $folder ([guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temporary, $encrypted, [Text.Encoding]::ASCII)
        Move-Item -LiteralPath $temporary -Destination $Path -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Resolve-TikitakaApiKey {
    param([switch]$ReplaceKey, [string]$Path = (Get-TikitakaKeyPath))
    if (-not $ReplaceKey -and $env:OPENAI_API_KEY) {
        $key = ConvertTo-SecureString $env:OPENAI_API_KEY -AsPlainText -Force
        try { Save-TikitakaApiKey -Key $key -Path $Path; return $key }
        catch { $key.Dispose(); throw 'Could not save the API key securely.' }
    }
    if (-not $ReplaceKey -and (Test-Path -LiteralPath $Path)) {
        try { return (ConvertTo-SecureString ([IO.File]::ReadAllText($Path)) -ErrorAction Stop) }
        catch { throw 'Cannot decrypt the saved key for this Windows account. Run start-openai.ps1 -ReplaceKey to replace it.' }
    }
    $key = Read-Host 'OpenAI API key (saved encrypted for this Windows account)' -AsSecureString
    try { Save-TikitakaApiKey -Key $key -Path $Path; return $key }
    catch { $key.Dispose(); throw 'Could not save the API key securely.' }
}

if ($SaveEnvironmentKey) {
    $ErrorActionPreference = 'Stop'
    if (-not $env:OPENAI_API_KEY) { throw 'No API key is available in this process.' }
    $storedKey = ConvertTo-SecureString $env:OPENAI_API_KEY -AsPlainText -Force
    try { Save-TikitakaApiKey -Key $storedKey }
    catch {
        $diagnostic = Join-Path (Split-Path -Parent (Get-TikitakaKeyPath)) 'save.detail'
        [IO.File]::WriteAllText($diagnostic, ($_.Exception.GetType().Name + ':' + $_.InvocationInfo.ScriptLineNumber), [Text.Encoding]::ASCII)
        throw 'Encrypted key save failed; see the local status.'
    }
    finally { $storedKey.Dispose() }
}
