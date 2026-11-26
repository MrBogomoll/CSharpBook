using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;

static void Assert(bool ok, string label)
{
    if (!ok) throw new Exception(label);
    Console.WriteLine(label);
}

static Process Start(string exe, params string[] args)
{
    var command = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true };
    foreach (string arg in args) command.ArgumentList.Add(arg);
    return Process.Start(command)!;
}

static string Fixture(string dir, string version)
{
    string folder = Path.Combine(dir, version);
    Directory.CreateDirectory(Path.Combine(folder, "wwwroot"));
    Directory.CreateDirectory(Path.Combine(folder, "licenses"));
    File.WriteAllText(Path.Combine(folder, "wwwroot", "index.html"), version);
    File.WriteAllText(Path.Combine(folder, "licenses", "license.txt"), version);
    File.WriteAllText(Path.Combine(folder, "Начало работы.txt"), version);
    string source = Path.Combine(dir, "stub.cs");
    File.WriteAllText(source, $$"""
        using System.IO;
        using System.Reflection;
        [assembly: AssemblyInformationalVersion("{{version}}")]
        static class Stub {
            static void Main(string[] args) { File.WriteAllText("started.txt","{{version}} " + string.Join(" ", args)); }
        }
        """);
    string csc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\Framework64\v4.0.30319\csc.exe");
    using var compile = Start(csc, "/nologo", "/target:winexe", "/out:" + Path.Combine(folder, ReleaseUpdate.ExeName), source);
    compile.WaitForExit();
    if (compile.ExitCode != 0) throw new Exception("Fixture build failed");
    return folder;
}

static void Apply(string stage)
{
    ReleaseUpdate.WriteHelper(stage);
    string powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
    using var exited = Start(powershell, "-NoProfile", "-Command", "exit 0");
    exited.WaitForExit();
    using var helper = Start(powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(stage, "ApplyUpdate.ps1"),
        "-ParentId", exited.Id.ToString());
    if (!helper.WaitForExit(30000) || helper.ExitCode != 0) throw new Exception("Helper failed");
}

static void Started(string root, string expected)
{
    string marker = Path.Combine(root, "started.txt");
    bool OK() { try { return File.ReadAllText(marker) == expected; } catch (IOException) { return false; } }
    Assert(SpinWait.SpinUntil(OK, TimeSpan.FromSeconds(5)), "Process restarted: " + expected);
}

static async Task HttpDownload(byte[] zip, ReleaseAsset asset, string target)
{
    using var tcp = new TcpListener(IPAddress.Loopback, 0);
    tcp.Start();
    async Task Serve()
    {
        using var client = await tcp.AcceptTcpClientAsync();
        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, leaveOpen: true);
        while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }
        byte[] head = System.Text.Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Length: {zip.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(head); await stream.WriteAsync(zip);
    }
    var serve = Serve();
    int port = ((IPEndPoint)tcp.LocalEndpoint).Port;
    try { await ReleaseUpdate.Download(asset with { Url = new Uri($"http://127.0.0.1:{port}/fixture") }, target, _ => {}, CancellationToken.None); }
    finally { await serve; }
}

if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
string dir = Directory.CreateTempSubdirectory("CSharpBook-test-").FullName;
try
{
    string install = Fixture(dir, "0.1.0");
    string next = Fixture(dir, "0.1.1");
    string zip = Path.Combine(dir, "next.zip");
    using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
        foreach (string file in Directory.GetFiles(next, "*", SearchOption.AllDirectories))
            archive.CreateEntryFromFile(file, "Sharpwise/" + Path.GetRelativePath(next, file).Replace('\\','/'));
    byte[] bytes = await File.ReadAllBytesAsync(zip);
    string digest = Convert.ToHexStringLower(SHA256.HashData(bytes));
    string repo = ReleaseUpdate.Repository;
    JsonElement Metadata(string version) {
        string tag = "v" + version;
        string[] names = [$"Sharpwise-{version}-Windows-x64.zip", $"Sharpwise-{version}-Windows-x64-Portable.zip"];
        return JsonSerializer.SerializeToElement(new {
            tag_name = tag, html_url = $"{repo}/releases/tag/{tag}", draft = false, prerelease = false,
            assets = names.Select(name => new { name, size = bytes.Length, digest = "sha256:" + digest, browser_download_url = $"{repo}/releases/download/{tag}/{name}" })
        });
    }
    Assert(ReleaseUpdate.Select(Metadata("0.1.0"), ReleaseUpdate.DisplayVersion) == null, "Stable base never downgrades beta");
    Assert(ReleaseUpdate.Select(Metadata("0.1.0"), "0.3.5", true)?.Version == "0.1.0", "Explicit preview switch can install an older stable release");
    Assert(ReleaseUpdate.Select(Metadata("0.1.0"), "0.1.0", true)?.Version == "0.1.0", "A stable release can replace a preview of the same version");
    var asset = ReleaseUpdate.Select(Metadata("0.1.1"), ReleaseUpdate.DisplayVersion)!;
    Assert(asset.Url.AbsolutePath.EndsWith("-Windows-x64-Portable.zip", StringComparison.Ordinal), "Selects the portable archive when both are available");
    string stage = ReleaseUpdate.CreateStage(install);
    string archivePath = Path.Combine(stage, "received.zip");
    await HttpDownload(bytes, asset, archivePath);
    bool mismatch = false;
    try { await HttpDownload(bytes, asset with { Digest = new string('0', 64) }, Path.Combine(stage, "damaged.zip")); }
    catch (InvalidDataException) { mismatch = true; }
    Assert(mismatch, "Rejected mismatched SHA-256");
    string staged = Path.Combine(stage, "new");
    ReleaseUpdate.Extract(archivePath, staged, asset.Version);
    File.WriteAllText(Path.Combine(install, "my-notes.txt"), "keep");
    Apply(stage);
    Started(install, "0.1.1 ");
    Assert(File.ReadAllText(Path.Combine(install, "wwwroot", "index.html")) == "0.1.1" &&
           File.ReadAllText(Path.Combine(install, "my-notes.txt")) == "keep" && !Directory.Exists(stage), "New lessons, preserved personal files and cleaned staging");
    string failed = ReleaseUpdate.CreateStage(install);
    var failedNew = Path.Combine(failed, "new");
    ReleaseUpdate.Extract(zip, failedNew, "0.1.1");
    File.Delete(Path.Combine(failedNew, "Начало работы.txt"));
    File.Delete(Path.Combine(install,"started.txt"));
    Apply(failed);
    Started(install, "0.1.1 --update-failed");
    Assert(File.ReadAllText(Path.Combine(install, "Начало работы.txt")) == "0.1.1" && !Directory.Exists(failed), "Restored after an interrupted replacement");

    string interrupted = ReleaseUpdate.CreateStage(install);
    string backup = Path.Combine(interrupted,"backup");
    string incoming = Path.Combine(interrupted,"new");
    Directory.CreateDirectory(backup); Directory.CreateDirectory(incoming);
    File.WriteAllText(Path.Combine(interrupted,"transaction.json"), JsonSerializer.Serialize(ReleaseUpdate.Items));
    Directory.Move(Path.Combine(install,"wwwroot"),Path.Combine(backup,"wwwroot"));
    Directory.CreateDirectory(Path.Combine(install,"wwwroot"));
    File.WriteAllText(Path.Combine(install,"wwwroot","index.html"), "incomplete");
    ReleaseUpdate.Recover(install);
    Assert(File.ReadAllText(Path.Combine(install, "wwwroot", "index.html")) == "0.1.1" && !Directory.Exists(interrupted), "Recovered on next start after process termination");

    if (args.Contains("--live"))
    {
        var published = await ReleaseUpdate.Latest(CancellationToken.None);
        Console.WriteLine("Official release check: " + (published?.Version ?? "up to date"));
    }
}
finally { Directory.Delete(dir, recursive:true); }
