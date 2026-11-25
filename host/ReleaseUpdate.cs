using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record ReleaseAsset(string Version, Uri Url, long Size, string Digest);

internal static class ReleaseUpdate
{
    internal const string Repository = "https://github.com/MrBogomoll/Sharpwise";
    internal const string Endpoint = "https://api.github.com/repos/MrBogomoll/Sharpwise/releases/latest";
    internal static readonly string DisplayVersion = typeof(ReleaseUpdate).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion;
    internal static readonly bool IsPreview = typeof(ReleaseUpdate).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
        .Any(attribute => attribute.Key == "SharpwiseChannel" && attribute.Value == "Preview");
    private const long MaxBytes = 512L * 1024 * 1024;
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromMinutes(10) };

    internal static ReleaseAsset? Select(JsonElement release, string current, bool switchToStable = false)
    {
        if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean())
            throw new InvalidDataException("GitHub вернул предварительный выпуск.");
        string tag = release.GetProperty("tag_name").GetString() ?? "";
        if (!Regex.IsMatch(tag, @"\Av?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\z", RegexOptions.CultureInvariant))
            throw new InvalidDataException("Неизвестный формат версии выпуска.");
        string version = tag.TrimStart('v');
        if (release.GetProperty("html_url").GetString() != $"{Repository}/releases/tag/{tag}")
            throw new InvalidDataException("Не удалось подтвердить источник выпуска.");
        if (!switchToStable && Version.Parse(version) <= Version.Parse(current.Split('_')[0])) return null;

        var assets = release.GetProperty("assets").EnumerateArray().Where(a => {
            string? file = a.GetProperty("name").GetString();
            return file == $"Sharpwise-{version}-Windows-x64.zip" || file == $"CSharpBook-{version}-Windows-x64.zip";
        }).ToArray();
        if (assets.Length != 1) throw new InvalidDataException("В выпуске нет однозначного архива для Windows x64.");
        var asset = assets[0];
        string name = asset.GetProperty("name").GetString()!;
        var expectedUrl = $"{Repository}/releases/download/{tag}/{name}";
        long size = asset.GetProperty("size").GetInt64();
        string digest = asset.GetProperty("digest").GetString() ?? "";
        if (asset.GetProperty("browser_download_url").GetString() != expectedUrl ||
            !Regex.IsMatch(digest, @"\Asha256:[0-9a-f]{64}\z") || size is <= 0 or > MaxBytes)
            throw new InvalidDataException("Не удалось подтвердить файл выпуска.");
        return new(version, new Uri(expectedUrl), size, digest[7..]);
    }

    private static async Task<HttpResponseMessage> Request(Uri url, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.UserAgent.ParseAdd("CSharpBook/1.0");
        return await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
    }

    internal static async Task<ReleaseAsset?> Latest(CancellationToken cancel)
    {
        using var response = await Request(new Uri(Endpoint), cancel);
        response.EnsureSuccessStatusCode();
        await response.Content.LoadIntoBufferAsync(512 * 1024, cancel);
        using var json = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(cancel));
        return Select(json.RootElement, DisplayVersion, IsPreview);
    }

    internal static async Task Download(ReleaseAsset asset, string path, Action<int> progress, CancellationToken cancel)
    {
        Uri url = asset.Url;
        for (int i = 0; i < 4; i++)
        {
            using var response = await Request(url, cancel);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is Uri location)
            {
                url = new Uri(url, location);
                if (url.Scheme != Uri.UriSchemeHttps || !url.IsDefaultPort || url.UserInfo.Length != 0 ||
                    url.Host is not ("release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
                    throw new InvalidDataException("GitHub вернул неожиданный адрес загрузки.");
                continue;
            }
            response.EnsureSuccessStatusCode();
            using var stream = await response.Content.ReadAsStreamAsync(cancel);
            using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            byte[] buffer = new byte[131072];
            long total = 0;
            int length, previous = -1;
            while ((length = await stream.ReadAsync(buffer, cancel)) > 0)
            {
                total += length;
                if (total > asset.Size) throw new InvalidDataException("Размер загрузки превышает размер выпуска.");
                await output.WriteAsync(buffer.AsMemory(0, length), cancel);
                sha.AppendData(buffer, 0, length);
                int percent = (int)(100 * total / asset.Size);
                if (percent / 5 != previous / 5 || percent == 100) { progress(percent); previous = percent; }
            }
            if (total != asset.Size || !Convert.ToHexString(sha.GetHashAndReset()).Equals(asset.Digest, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Контрольная сумма загрузки не совпала. Повтори попытку.");
            return;
        }
        throw new InvalidDataException("GitHub вернул слишком много перенаправлений.");
    }

    internal static readonly string[] Items = ["wwwroot", "licenses", "Начало работы.txt", "CSharpBook.exe"];

    internal static void Extract(string zip, string destination, string version)
    {
        using var archive = ZipFile.OpenRead(zip);
        long expanded = 0;
        if (archive.Entries.Count > 8192) throw new InvalidDataException("В архиве слишком много файлов.");
        foreach (var entry in archive.Entries)
        {
            string[] parts = entry.FullName.Split('/');
            if (parts.Length < 2 || parts[0] != "CSharpBook" || !Items.Contains(parts[1]) ||
                (parts.Length > 2 && parts[1] is not ("wwwroot" or "licenses")) ||
                parts.Any(p => p.Length == 0 || p is "." or ".." || p.EndsWith('.') || p.EndsWith(' ') || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
                throw new InvalidDataException("В архиве есть неожиданный путь.");
            expanded = checked(expanded + entry.Length);
            if (expanded > 2 * MaxBytes) throw new InvalidDataException("Архив превышает допустимый размер.");
            string file = Path.Combine(destination, Path.Combine(parts[1..]));
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            entry.ExtractToFile(file, overwrite: false);
        }
        string exe = Path.Combine(destination, "CSharpBook.exe");
        if (!File.Exists(Path.Combine(destination, "wwwroot", "index.html")) || !Directory.Exists(Path.Combine(destination, "licenses")) ||
            !File.Exists(Path.Combine(destination, "Начало работы.txt")) || !File.Exists(exe) ||
            FileVersionInfo.GetVersionInfo(exe).ProductVersion?.Split('+')[0] != version)
            throw new InvalidDataException("Содержимое архива не соответствует версии выпуска.");
    }

    internal static string CreateStage(string install)
    {
        string stage = Path.Combine(install, ".csharpbook-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        return stage;
    }

    internal static void WriteHelper(string stage)
    {
        using var resource = typeof(ReleaseUpdate).Assembly.GetManifestResourceStream("CSharpBook.ApplyUpdate.ps1")!;
        using var output = File.Create(Path.Combine(stage, "ApplyUpdate.ps1"));
        output.Write(System.Text.Encoding.UTF8.GetPreamble());
        resource.CopyTo(output);
    }

    internal static Process LaunchHelper(string stage, bool recover)
    {
        string powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        var command = new ProcessStartInfo(powershell) { UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(stage, "ApplyUpdate.ps1") })
            command.ArgumentList.Add(arg);
        if (recover) command.ArgumentList.Add("-RecoverOnly");
        else { command.ArgumentList.Add("-ParentId"); command.ArgumentList.Add(Environment.ProcessId.ToString()); }
        return Process.Start(command) ?? throw new IOException("Не удалось запустить установку.");
    }

    internal static void Recover(string install)
    {
        foreach (var stage in Directory.EnumerateDirectories(install, ".csharpbook-update-*"))
        {
            if (!Regex.IsMatch(Path.GetFileName(stage), @"\A\.csharpbook-update-[a-f0-9]{32}\z") || (File.GetAttributes(stage) & FileAttributes.ReparsePoint) != 0 ||
                !File.Exists(Path.Combine(stage, "transaction.json"))) continue;
            WriteHelper(stage);
            using var process = LaunchHelper(stage, recover: true);
            process.WaitForExit();
            if (process.ExitCode != 0) throw new IOException("Не удалось восстановить предыдущую установку. Файлы сохранены в " + stage);
        }
    }
}
