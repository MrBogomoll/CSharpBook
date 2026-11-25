[CmdletBinding()]
param(
    [string]$WebRoot = (Join-Path $PSScriptRoot '../wwwroot'),
    [string]$WorkDir = (Join-Path $PSScriptRoot '../../qa/android-build'),
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$OutputApk,
    [string]$CloudConfig,
    [switch]$Preview
)
$ErrorActionPreference = 'Stop'
$WorkDir = (New-Item -Type Directory -Force -Path $WorkDir).FullName
$WebRoot = (Resolve-Path -LiteralPath $WebRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $WebRoot 'runtime/net11.bin'))) { throw 'В wwwroot не найдена среда .NET 11.' }
if (!$JavaHome) { $JavaHome = 'C:/Program Files/Java/jdk-25.0.2' }
if (!(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) { throw 'Передай путь к JDK через -JavaHome.' }
if (!$OutputApk) {
    [xml]$manifest = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'AndroidManifest.xml')
    $version = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
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
    $keyDir=(New-Item -Type Directory -Path (Join-Path $WorkDir 'signing') -Force).FullName
    $key=Join-Path $keyDir 'csharp-book-beta.p12'
    $credential=Join-Path $keyDir 'password.dpapi'
    if (!(Test-Path -LiteralPath $credential)) {
        if (Test-Path -LiteralPath $key) {throw 'Для существующего ключа нужен сохранённый пароль.'}
        $rng=[security.cryptography.RandomNumberGenerator]::Create()
        $bytes=[byte[]]::new(36); $rng.GetBytes($bytes); $rng.Dispose()
        $secret=ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
        $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $credential
    }
    $secure=(Get-Content -LiteralPath $credential -Raw).Trim() | ConvertTo-SecureString
    $env:CSHARPBOOK_ANDROID_PASS=[System.Net.NetworkCredential]::new('',$secure).Password
    try {
        if (!(Test-Path -LiteralPath $key)) {
            Run "$JavaHome/bin/keytool.exe" @('-genkeypair','-storetype','PKCS12','-keystore',$key,'-alias','csharpbook','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=CSharpBook Android local beta','-storepass:env','CSHARPBOOK_ANDROID_PASS','-keypass:env','CSHARPBOOK_ANDROID_PASS')
        }
        Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'sign','--ks',$key,'--ks-pass','env:CSHARPBOOK_ANDROID_PASS','--key-pass','env:CSHARPBOOK_ANDROID_PASS','--ks-key-alias','csharpbook','--v4-signing-enabled','false','--out',"$job/signed.apk",$apk)
    } finally {Remove-Item Env:CSHARPBOOK_ANDROID_PASS -ErrorAction SilentlyContinue}
    $apk = "$job/signed.apk"
}
Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'verify','--verbose','--print-certs',$apk)
Run "$build/zipalign.exe" @('-c','4',$apk)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputApk)) | Out-Null
[IO.File]::Copy($apk,$OutputApk,$true)
Write-Host "APK: $OutputApk"
