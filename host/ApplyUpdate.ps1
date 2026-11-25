param([int]$ParentId, [switch]$RecoverOnly)
$ErrorActionPreference = 'Stop'
$stage = [IO.Path]::GetFullPath($PSScriptRoot)
if ([IO.Path]::GetFileName($stage) -notmatch '^\.csharpbook-update-[a-f0-9]{32}$') { exit 2 }
$install = [IO.Directory]::GetParent($stage).FullName
$incoming = Join-Path $stage 'new'
$backup = Join-Path $stage 'backup'
$journal = Join-Path $stage 'transaction.json'
$committed = Join-Path $stage 'committed'
$names = @('wwwroot','licenses','Начало работы.txt','CSharpBook.exe')
$exe = Join-Path $install 'CSharpBook.exe'

function Move-BookItem($from, $to) {
    if ([IO.Directory]::Exists($from)) { [IO.Directory]::Move($from,$to) } else { [IO.File]::Move($from,$to) }
}

function Restore-Previous {
    if (!(Test-Path -LiteralPath $journal) -or (Test-Path -LiteralPath $committed)) { return }
    $previous = @(Get-Content -LiteralPath $journal -Encoding UTF8 -Raw | ConvertFrom-Json)
    foreach ($name in $names) {
        $saved = Join-Path $backup $name
        $target = Join-Path $install $name
        $new = Join-Path $incoming $name
        if (Test-Path -LiteralPath $saved) {
            if (($name -eq 'CSharpBook.exe') -and (Test-Path -LiteralPath $target)) {
                [IO.File]::Replace($saved,$target,(Join-Path $stage 'failed.exe'))
            } else {
                if (Test-Path -LiteralPath $target) { Move-BookItem $target $new }
                Move-BookItem $saved $target
            }
        } elseif (($name -notin $previous) -and !(Test-Path -LiteralPath $new) -and (Test-Path -LiteralPath $target)) {
            Move-BookItem $target $new
        }
    }
    [IO.File]::Delete($journal)
}
function Clean-Stage {
    # Only remove the staging directory created next to this installation.
    if ([IO.Directory]::GetParent($stage).FullName -ne $install -or
        ([IO.File]::GetAttributes($stage) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid stage' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
if ($RecoverOnly) {
    try { Restore-Previous; Clean-Stage; exit 0 } catch { exit 1 }
}
if ($ParentId -le 0) { exit 2 }
$parent = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
if ($parent -and !$parent.WaitForExit(120000)) { exit 3 }
$sha = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($install.ToUpperInvariant()))).Replace('-','') }
finally { $sha.Dispose() }
$lock = [Threading.Mutex]::new($false,'Local\CSharpBook.Install.' + $fingerprint)
try { $owned = $lock.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $owned = $true }
if (!$owned) { $lock.Dispose(); exit 4 }
function Start-Reader([string]$arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.WorkingDirectory = $install
    $start.UseShellExecute = $false
    $start.Arguments = $arguments
    [Diagnostics.Process]::Start($start) | Out-Null
}
try {
    [IO.Directory]::CreateDirectory($backup) | Out-Null
    $present = @($names | Where-Object { Test-Path -LiteralPath (Join-Path $install $_) })
    $json = ConvertTo-Json -InputObject $present -Compress
    [IO.File]::WriteAllText((Join-Path $stage 'journal.tmp'),$json)
    [IO.File]::Move((Join-Path $stage 'journal.tmp'),$journal)
    foreach ($name in $names) {
        $target = Join-Path $install $name
        $saved = Join-Path $backup $name
        $new = Join-Path $incoming $name
        if ($name -eq 'CSharpBook.exe') {
            [IO.File]::Replace($new,$target,$saved)
        } else {
            if (Test-Path -LiteralPath $target) { Move-BookItem $target $saved }
            Move-BookItem $new $target
        }
    }
    # The new reader waits on this installation's mutex before opening wwwroot.
    Start-Reader ''
    [IO.File]::WriteAllText($committed,'ok')
    try { Clean-Stage } catch { }
} catch {
    try { Restore-Previous } catch { exit 5 }
    Start-Reader '--update-failed'
    try { Clean-Stage } catch { }
} finally {
    $lock.ReleaseMutex()
    $lock.Dispose()
}
