param(
    [ValidateSet('Check','Debug','Release')][string]$Task = 'Check',
    [string]$ServerUrl = '',
    [ValidateSet('en','ko')][string]$Language = 'en'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'apps\android'
$previousJava = $env:JAVA_HOME
$previousGradle = $env:GRADLE_USER_HOME
try {
    if (-not $env:JAVA_HOME) {
        $localJdk = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.runtime\toolchains\jdk17') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($localJdk) { $env:JAVA_HOME = $localJdk.FullName }
    }
    if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'Install JDK 17 and set JAVA_HOME first.' }
    $env:GRADLE_USER_HOME = Join-Path $projectRoot '.runtime\gradle'
    $arguments = @('--no-daemon', '-p', $androidRoot)
    if ($Task -eq 'Check') {
        $arguments = @('--no-daemon', '-p', (Join-Path $androidRoot 'checks'), 'test')
    } else {
        if ($Task -eq 'Release' -and -not $ServerUrl) { throw 'Release requires -ServerUrl with your HTTPS server origin.' }
        $arguments += if ($Task -eq 'Debug') { @('testDebugUnitTest','assembleDebug') } else { @('testReleaseUnitTest','bundleRelease') }
        if ($ServerUrl) { $arguments += "-PtikitakaServerUrl=$ServerUrl" }
        $arguments += "-PtikitakaLanguage=$Language"
    }
    & (Join-Path $androidRoot 'gradlew.bat') @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Android check or build failed. See the Gradle output.' }
} finally { $env:JAVA_HOME = $previousJava; $env:GRADLE_USER_HOME = $previousGradle }
