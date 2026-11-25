using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class SyncFolder(string directory, string? journalDirectory = null)
{
    internal string DirectoryPath => directory;
    private readonly string journals = journalDirectory ?? Path.Combine(CloudClients.DirectoryPath, "SyncJournal");
    private readonly Dictionary<string, byte[]?> observed = new(StringComparer.Ordinal);
    private const string Previous = ".previous";

    internal string[] List() => Directory.EnumerateFiles(directory, "csharpbook-v1-*", SearchOption.TopDirectoryOnly)
        .Select(path =>
        {
            string name = Path.GetFileName(path);
            // Android document providers may need to temporarily move the old file aside when replacing it.
            return CloudFiles.DeviceId(name.EndsWith(Previous, StringComparison.Ordinal) ? name[..^Previous.Length] : name);
        }).OfType<string>().Distinct(StringComparer.Ordinal).ToArray();

    internal async Task<JsonElement?> Read(string device, CancellationToken cancel)
    {
        string path = Path.Combine(directory, CloudFiles.FileName(device));
        var journal = new ReplicaJournal(journals, path);
        if (journal.Pending)
        {
            await using var file = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            await journal.Recover(file, cancel);
        }
        try
        {
            await using var input = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            byte[] bytes = await Bytes(input, cancel);
            var result = Parse(bytes);
            observed[device] = SHA256.HashData(bytes);
            return result;
        }
        catch (FileNotFoundException) { observed[device] = null; }
        try { return await ReadFile(path + Previous, cancel); }
        catch (FileNotFoundException) { return null; }
    }

    internal async Task Write(string device, JsonElement snapshot, CancellationToken cancel)
    {
        string path = Path.Combine(directory, CloudFiles.FileName(device));
        var journal = new ReplicaJournal(journals, path);
        if (journal.Pending)
        {
            await Read(device, cancel);
            throw Changed(); // The pending revision may differ from the one used to prepare this write.
        }
        byte[] next = Encode(snapshot);
        if (!File.Exists(path))
        {
            if (observed.Remove(device, out var earlier) && earlier != null) throw Changed();
            await AtomicWrite(path, next, overwrite: false, cancel);
        }
        else
        {
            await using var file = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            byte[] current = await Bytes(file, cancel);
            if (!current.AsSpan().SequenceEqual(next))
            {
                if (!observed.TryGetValue(device, out var hash) || hash == null ||
                    !SHA256.HashData(current).AsSpan().SequenceEqual(hash)) throw Changed();
                cancel.ThrowIfCancellationRequested();
                journal.Prepare(current, next);
                // Once the journal commits, canceling cannot turn this into an untracked partial write.
                await ReplicaJournal.Overwrite(file, next, CancellationToken.None);
                journal.Finish();
            }
        }
        observed[device] = SHA256.HashData(next);
    }

    private static InvalidDataException Changed() =>
        new("Файл изменился. Повтори синхронизацию, чтобы объединить изменения.");

    internal static async Task<JsonElement> ReadFile(string path, CancellationToken cancel)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        return Parse(await Bytes(stream, cancel));
    }

    internal static async Task<byte[]> Bytes(FileStream stream, CancellationToken cancel)
    {
        stream.Position = 0;
        if (stream.Length > CloudFiles.MaxBytes) throw new InvalidDataException("Файл синхронизации превышает 8 МБ.");
        byte[] bytes = new byte[checked((int)stream.Length)];
        await stream.ReadExactlyAsync(bytes, cancel);
        if (stream.ReadByte() != -1) throw Changed();
        return bytes;
    }

    internal static JsonElement Parse(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Неверный формат файла прогресса.");
        return document.RootElement.Clone();
    }

    internal static Task WriteFile(string target, JsonElement snapshot, CancellationToken cancel) =>
        AtomicWrite(target, Encode(snapshot), overwrite: true, cancel);

    private static byte[] Encode(JsonElement snapshot)
    {
        if (snapshot.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Нет данных для сохранения.");
        byte[] bytes = Encoding.UTF8.GetBytes(snapshot.GetRawText());
        if (bytes.Length > CloudFiles.MaxBytes) throw new InvalidDataException("Файл синхронизации превышает 8 МБ.");
        return bytes;
    }

    private static async Task AtomicWrite(string target, byte[] bytes, bool overwrite, CancellationToken cancel)
    {
        string temp = Path.Combine(Path.GetDirectoryName(target)!, ".csharpbook-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await output.WriteAsync(bytes, cancel);
                output.Flush(flushToDisk: true);
            }
            cancel.ThrowIfCancellationRequested();
            File.Move(temp, target, overwrite);
        }
        finally { File.Delete(temp); }
    }
}
