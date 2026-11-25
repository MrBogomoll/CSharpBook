using System.Security.Cryptography;
using System.Text;

// Folder clients can map each local file to a durable cloud document ID. Updating the same
// file handle preserves that identity. The private journal makes a partial in-place write recoverable.
internal sealed class ReplicaJournal(string directory, string target)
{
    private const int Format = 1;
    private const byte InProgress = 0; // A leading NUL can never begin valid JSON.
    private readonly string path = Path.Combine(directory, Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(Path.GetFullPath(target).ToUpperInvariant()))) + ".pending");
    internal bool Pending => File.Exists(path);

    internal void Prepare(byte[] before, byte[] after)
    {
        Directory.CreateDirectory(directory);
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var writer = new BinaryWriter(file))
            {
                writer.Write(Format);
                foreach (var data in new[] { before, after })
                {
                    writer.Write(data.Length);
                    writer.Write(SHA256.HashData(data));
                    writer.Write(data);
                }
                file.Flush(flushToDisk: true);
            }
            File.Move(temp, path); // Never discard an earlier unfinished write.
        }
        finally { File.Delete(temp); }
    }

    internal void Finish() => File.Delete(path);

    internal async Task Recover(FileStream file, CancellationToken cancel)
    {
        byte[] before, after;
        using (var journal = File.OpenRead(path))
        using (var reader = new BinaryReader(journal))
        {
            if (reader.ReadInt32() != Format) throw Corrupt();
            before = Entry(reader);
            after = Entry(reader);
            if (journal.Position != journal.Length) throw Corrupt();
        }
        byte[] current = await SyncFolder.Bytes(file, cancel);
        if (!current.AsSpan().SequenceEqual(after))
        {
            if (!IsInterruptedWrite(before, after, current))
            {
                // An unrelated, valid cloud edit wins here. The engine reads and merges it
                // against its own durable replica before deciding what to publish next.
                SyncFolder.Parse(current);
                Finish();
                return;
            }
            await Overwrite(file, after, cancel);
        }
        Finish();
    }

    private static byte[] Entry(BinaryReader reader)
    {
        int length = reader.ReadInt32();
        if (length < 0 || length > CloudFiles.MaxBytes) throw Corrupt();
        byte[] digest = reader.ReadBytes(32);
        byte[] bytes = reader.ReadBytes(length);
        if (bytes.Length != length || !SHA256.HashData(bytes).AsSpan().SequenceEqual(digest)) throw Corrupt();
        return bytes;
    }

    private static InvalidDataException Corrupt() => new("Не удалось проверить журнал записи. Файл на диске сохранён.");

    private static bool IsInterruptedWrite(byte[] before, byte[] after, byte[] current)
    {
        if (current.AsSpan().SequenceEqual(before)) return true; // Intent persisted before writing began.
        if (current.Length == 0 || current[0] != InProgress) return false;
        if (current.Length == after.Length && current.AsSpan(1).SequenceEqual(after.AsSpan(1))) return true;
        // While the marker is present the body is a prefix of 'after' on top of 'before'.
        if (current.Length < before.Length || current.Length > Math.Max(before.Length, after.Length)) return false;
        int prefix = 1;
        while (prefix < current.Length && prefix < after.Length && current[prefix] == after[prefix]) prefix++;
        return prefix == current.Length ||
            (current.Length == before.Length && current.AsSpan(prefix).SequenceEqual(before.AsSpan(prefix)));
    }

    internal static async Task Overwrite(FileStream file, byte[] bytes, CancellationToken cancel)
    {
        cancel.ThrowIfCancellationRequested();
        file.Position = 0;
        // A persisted marker prevents a half-written but syntactically valid JSON document from
        // leaking to readers or being confused with an independent edit during recovery.
        file.WriteByte(InProgress);
        file.Flush(flushToDisk: true);
        await file.WriteAsync(bytes.AsMemory(1), CancellationToken.None);
        file.SetLength(bytes.Length);
        file.Flush(flushToDisk: true);
        file.Position = 0;
        file.WriteByte(bytes[0]);
        file.Flush(flushToDisk: true);
        byte[] verified = await SyncFolder.Bytes(file, CancellationToken.None);
        if (!verified.AsSpan().SequenceEqual(bytes)) throw new IOException("Файл на диске не совпал с записанным.");
    }
}
