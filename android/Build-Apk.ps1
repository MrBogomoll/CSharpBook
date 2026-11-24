[CmdletBinding()]
param(
    [string]$WebRoot = (Join-Path $PSScriptRoot '../wwwroot'),
    [string]$WorkDir = (Join-Path $PSScriptRoot '../../qa/android-build'),
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$OutputApk
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
    $OutputApk = Join-Path $WorkDir "CSharpBook-$version-Android.apk"
}
$OutputApk = [IO.Path]::GetFullPath($OutputApk)
$job = (New-Item -Type Directory -Path (Join-Path $WorkDir ('package-' + [guid]::NewGuid().ToString('N')))).FullName
function Run([string]$program,[string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($program)) завершился с кодом $LASTEXITCODE" }
}
function SdkPart([string]$leaf,[string]$probe,[string]$name,[string]$sha) {
    $dir = Join-Path $WorkDir $leaf
    if (!(Test-Path -LiteralPath (Join-Path $dir $probe))) {
        $zip = Join-Path $WorkDir $name
        if (!(Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA1).Hash -ne $sha) {
            Run 'curl.exe' @('-fsSL','--retry','2',"https://dl.google.com/android/repository/$name",'-o',$zip)
        }
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA1).Hash -ne $sha) { throw "Не совпала контрольная сумма $name." }
        Run 'tar.exe' @('-xf',$zip,'-C',$WorkDir)
    }
    return $dir
}
$build = SdkPart 'android-16' 'aapt2.exe' 'build-tools_r36_windows.zip' 'f16ccffd34de8790dede813a6c7d8e2c11a27b50'
$platform = SdkPart 'android-36' 'android.jar' 'platform-36_r02.zip' '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576'
$androidJar = Join-Path $platform 'android.jar'
$library = Join-Path $WorkDir 'nanohttpd.jar'
if (!(Test-Path -LiteralPath $library)) {
    Run 'curl.exe' @('-fsSL','--retry','2','https://repo.maven.apache.org/maven2/org/nanohttpd/nanohttpd/2.3.1/nanohttpd-2.3.1.jar','-o',$library)
}
if ((Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash -ne 'DE864C47818157141A24C9ACB36DF0C47D7BF15B7FF48C90610F3EB4E5DF0E58') {throw 'Не совпала контрольная сумма NanoHTTPD.'}
$classes=(New-Item -Type Directory -Path (Join-Path $job 'classes')).FullName
$dex=(New-Item -Type Directory -Path (Join-Path $job 'dex')).FullName
$sources=@(Get-ChildItem -File -Filter '*.java' -LiteralPath (Join-Path $PSScriptRoot 'app') | ForEach-Object FullName)
Run "$JavaHome/bin/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',"$androidJar;$build/core-lambda-stubs.jar",'-classpath',$library,'-d',$classes) + $sources)
Run "$JavaHome/bin/jar.exe" @('cf',"$job/classes.jar",'-C',$classes,'.')
Run "$JavaHome/bin/java.exe" @('-cp',"$build/lib/d8.jar",'com.android.tools.r8.D8','--min-api','28','--lib',$androidJar,'--output',$dex,"$job/classes.jar",$library)
Run "$build/aapt2.exe" @('compile','--dir',"$PSScriptRoot/res",'-o',"$job/compiled.zip")
Run "$build/aapt2.exe" @('link','-I',$androidJar,'--manifest',"$PSScriptRoot/AndroidManifest.xml",'-o',"$job/unsigned.apk","$job/compiled.zip")
Run 'python' @('-X','utf8',"$PSScriptRoot/pack.py","$job/unsigned.apk",$WebRoot,$dex,$PSScriptRoot)
Run "$build/zipalign.exe" @('-f','4',"$job/unsigned.apk","$job/aligned.apk")
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
    Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'sign','--ks',$key,'--ks-pass','env:CSHARPBOOK_ANDROID_PASS','--key-pass','env:CSHARPBOOK_ANDROID_PASS','--ks-key-alias','csharpbook','--v4-signing-enabled','false','--out',"$job/signed.apk","$job/aligned.apk")
} finally {Remove-Item Env:CSHARPBOOK_ANDROID_PASS -ErrorAction SilentlyContinue}
Run "$JavaHome/bin/java.exe" @('-jar',"$build/lib/apksigner.jar",'verify','--verbose','--print-certs',"$job/signed.apk")
Run "$build/zipalign.exe" @('-c','4',"$job/signed.apk")
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputApk)) | Out-Null
[IO.File]::Copy("$job/signed.apk",$OutputApk,$true)
Write-Host "APK: $OutputApk"
