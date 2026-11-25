[CmdletBinding()]
param(
    [string]$WebRoot = (Join-Path $PSScriptRoot '../wwwroot'),
    [string]$WorkDir = (Join-Path $PSScriptRoot '../../qa/android-build'),
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$OutputApk,
    [string]$CloudConfig,
    [switch]$Preview,
    [ValidateRange(1, 999999999)][int]$BetaNumber,
    [ValidateRange(1, 2100000000)][int]$BetaVersionCode,
    [string]$SigningDir
)
$ErrorActionPreference = 'Stop'
$WorkDir = (New-Item -Type Directory -Force -Path $WorkDir).FullName
$WebRoot = (Resolve-Path -LiteralPath $WebRoot).Path
[xml]$manifest = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'AndroidManifest.xml')
$namespace = 'http://schemas.android.com/apk/res/android'
$version = $manifest.manifest.GetAttribute('versionName', $namespace)
if (($BetaNumber -and $Preview) -or ([bool]$BetaNumber -ne [bool]$BetaVersionCode)) {
    throw 'Для официальной беты укажи вместе -BetaNumber и -BetaVersionCode. Для отдельной тестовой копии используй -Preview.'
}
if ($BetaNumber) {
    if ($BetaVersionCode -ge [int]$manifest.manifest.GetAttribute('versionCode', $namespace)) {
        throw 'Официальной бете нужен versionCode меньше запланированного стабильного выпуска.'
    }
    $version = "${version}_b.$BetaNumber"
}
if (!$Preview) {
    if (!$SigningDir) { $SigningDir = Join-Path $WorkDir 'signing' }
    $key = Join-Path $SigningDir 'csharp-book-beta.p12'
    $credential = Join-Path $SigningDir 'password.dpapi'
    if (!(Test-Path -LiteralPath $key -PathType Leaf) -or !(Test-Path -LiteralPath $credential -PathType Leaf)) {
        throw 'Для официального APK нужна папка подписи стабильной 0.2.0 с csharp-book-beta.p12 и password.dpapi. Укажи её через -SigningDir.'
    }
}
if (!(Test-Path -LiteralPath (Join-Path $WebRoot 'runtime/net11.bin'))) { throw 'В wwwroot не найдена среда .NET 11.' }
if (!$JavaHome) { $JavaHome = 'C:/Program Files/Java/jdk-25.0.2' }
if (!(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) { throw 'Передай путь к JDK через -JavaHome.' }
if (!$OutputApk) {
    $suffix = if ($Preview) { 'preview' } else { 'Android' }
    $OutputApk = Join-Path $WorkDir "CSharpBook-$version-$suffix.apk"
}
$OutputApk = [IO.Path]::GetFullPath($OutputApk)
$job = (New-Item -Type Directory -Path (Join-Path $WorkDir ('package-' + [guid]::NewGuid().ToString('N')))).FullName
function Run([string]$program,[string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($program)) завершился с кодом $LASTEXITCODE" }
}
function Get-BuildArchive([string]$url, [string]$fileName, [string]$algorithm, [string]$digest) {
    $archive = Join-Path $WorkDir $fileName
    if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm $algorithm).Hash -ne $digest) {
        Run 'curl.exe' @('-fsSL', '--retry', '2', $url, '-o', $archive)
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm $algorithm).Hash -ne $digest) {
        throw "Не совпала контрольная сумма $fileName."
    }
    return $archive
}
function Install-SdkPart([string]$path, [string]$probe, [string]$zipName, [string]$innerName, [string]$sha) {
    if (!(Test-Path -LiteralPath (Join-Path $path $probe))) {
        $archive = Get-BuildArchive "https://dl.google.com/android/repository/$zipName" $zipName 'SHA1' $sha
        $extract = (New-Item -ItemType Directory -Path (Join-Path $job $innerName)).FullName
        Run 'tar.exe' @('-xf', $archive, '-C', $extract)
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
        [IO.Directory]::Move((Join-Path $extract $innerName), $path)
    }
}
$sdk = Join-Path $WorkDir 'sdk'
$build = Join-Path $sdk 'build-tools/36.0.0'
Install-SdkPart $build 'aapt2.exe' 'build-tools_r36_windows.zip' 'android-16' 'f16ccffd34de8790dede813a6c7d8e2c11a27b50'
Install-SdkPart (Join-Path $sdk 'platforms/android-36') 'android.jar' 'platform-36_r02.zip' 'android-36' '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576'
$gradle = Join-Path $WorkDir 'gradle-9.1.0/bin/gradle.bat'
if (!(Test-Path -LiteralPath $gradle)) {
    $zip = Get-BuildArchive 'https://services.gradle.org/distributions/gradle-9.1.0-bin.zip' 'gradle-9.1.0-bin.zip' 'SHA256' 'a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806'
    Run 'tar.exe' @('-xf', $zip, '-C', $WorkDir)
}
$oldJavaHome = $env:JAVA_HOME
$oldAndroidHome = $env:ANDROID_HOME
$oldSdkRoot = $env:ANDROID_SDK_ROOT
try {
    $env:JAVA_HOME = (Resolve-Path -LiteralPath $JavaHome).Path
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $arguments = @('--project-dir', $PSScriptRoot, "-PwebRoot=$WebRoot", "-PoutputDir=$job/build")
    if ($BetaNumber) { $arguments += @("-PofficialBetaNumber=$BetaNumber", "-PofficialBetaCode=$BetaVersionCode") }
    if ($CloudConfig) {
        $cloudPath = (Resolve-Path -LiteralPath $CloudConfig).Path
        $configProperty = if ($Preview) { 'previewCloudConfig' } else { 'cloudConfig' }
        $arguments += "-P$configProperty=$cloudPath"
    }
    $task = if ($Preview) { 'assemblePreview' } else { 'assembleRelease' }
    Run $gradle ($arguments + $task)
} finally {
    $env:JAVA_HOME = $oldJavaHome
    $env:ANDROID_HOME = $oldAndroidHome
    $env:ANDROID_SDK_ROOT = $oldSdkRoot
}
if ($Preview) {
    $apks = @(Get-ChildItem -File -Filter '*.apk' -LiteralPath "$job/build/outputs/apk/preview")
} else {
    $apks = @(Get-ChildItem -File -Filter '*-unsigned.apk' -LiteralPath "$job/build/outputs/apk/release")
}
if ($apks.Count -ne 1) { throw 'Gradle должен создать ровно один APK.' }
$apk = $apks[0].FullName
Run 'python' @('-X','utf8',"$PSScriptRoot/verify_assets.py",$apk,$WebRoot)
if (!$Preview) {
    $secure=(Get-Content -LiteralPath $credential -Raw).Trim() | ConvertTo-SecureString
    $oldPass = $env:CSHARPBOOK_ANDROID_PASS
    try {
        $env:CSHARPBOOK_ANDROID_PASS = [System.Net.NetworkCredential]::new('',$secure).Password
        $cert = Join-Path $job 'signer.der'
        Run "$JavaHome/bin/keytool.exe" @('-exportcert','-keystore',$key,'-alias','csharpbook','-storepass:env','CSHARPBOOK_ANDROID_PASS','-file',$cert)
        $expected = (Get-Content -LiteralPath "$PSScriptRoot/stable-cert.sha256" -Raw).Trim()
        if ((Get-FileHash -LiteralPath $cert -Algorithm SHA256).Hash -ne $expected) {
            throw 'Сертификат ключа отличается от подписи опубликованной стабильной 0.2.0.'
        }
        Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'sign','--ks',$key,'--ks-pass','env:CSHARPBOOK_ANDROID_PASS','--key-pass','env:CSHARPBOOK_ANDROID_PASS','--ks-key-alias','csharpbook','--v4-signing-enabled','false','--out',"$job/signed.apk",$apk)
    } finally { $env:CSHARPBOOK_ANDROID_PASS = $oldPass }
    $apk = "$job/signed.apk"
}
$verification = @(Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'verify','--verbose','--print-certs',$apk))
$verification | Write-Output
if (!$Preview) {
    $signers = @($verification | Select-String '^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$')
    if ($signers.Count -ne 1 -or $signers[0].Matches[0].Groups[1].Value -ne $expected) {
        throw 'Подпись готового APK отличается от сертификата стабильной 0.2.0.'
    }
}
Run "$build/zipalign.exe" @('-c','4',$apk)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputApk)) | Out-Null
[IO.File]::Copy($apk,$OutputApk,$true)
Write-Host "APK: $OutputApk"
