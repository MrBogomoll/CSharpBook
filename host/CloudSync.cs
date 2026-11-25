using System.Security.Cryptography;
using System.Text.Json;

internal sealed class CloudSync(IWin32Window owner)
{
    private readonly SemaphoreSlim serial = new(1, 1);
    private SyncFolder? activeFolder;
    internal static readonly JsonSerializerOptions Json = new() { MaxDepth = 72 };

    internal async Task<string?> Handle(string command, CancellationToken cancel)
    {
        if (!command.StartsWith('{')) return null;
        Guid id = default;
        try
        {
            using var message = JsonDocument.Parse(command, new JsonDocumentOptions { MaxDepth = 72 });
            var request = message.RootElement;
            if (request.ValueKind != JsonValueKind.Object ||
                !request.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "book-sync" ||
                !request.TryGetProperty("id", out var identity) || identity.ValueKind != JsonValueKind.String || !Guid.TryParseExact(identity.GetString(), "D", out id))
                return null;
            await serial.WaitAsync(cancel);
            try
            {
                object? result = await Execute(request, cancel);
                return JsonSerializer.Serialize(new { type = "book-sync", id, ok = true, result }, Json);
            }
            finally { serial.Release(); }
        }
        catch (Exception error) when (id != default)
        {
            // Do not expose provider response bodies, callback codes, or URLs carrying transfer signatures.
            string description = error switch
            {
                OperationCanceledException => "Не удалось дождаться ответа. Попробуй ещё раз.",
                HttpRequestException => "Нет соединения с диском. Проверь интернет и повтори синхронизацию.",
                CryptographicException => "Не удалось прочитать сохранённое подключение. Отключи диск и войди снова.",
                JsonException or KeyNotFoundException => "Не удалось прочитать настройки или данные синхронизации.",
                IOException or UnauthorizedAccessException => "Нет доступа к папке синхронизации, хранилищу подключения или порту для входа.",
                CloudReauthoriseException or InvalidOperationException or InvalidDataException => error.Message,
                _ => "Синхронизация не завершена. Локальный прогресс сохранён."
            };
            return JsonSerializer.Serialize(new { type = "book-sync", id, ok = false, error = description });
        }
        catch (JsonException) { return null; }
    }

    private async Task<object?> Execute(JsonElement request, CancellationToken cancel)
    {
        var op = request.GetProperty("op").GetString();
        if (op == "import")
        {
            using var picker = new OpenFileDialog { Title = "Открыть файл прогресса", Filter = "Прогресс учебника (*.json)|*.json|Все файлы (*.*)|*.*" };
            if (picker.ShowDialog(owner) != DialogResult.OK) return null;
            return await SyncFolder.ReadFile(picker.FileName, cancel);
        }
        if (op == "export")
        {
            using var picker = new SaveFileDialog { Title = "Сохранить прогресс", FileName = "CSharpBook-progress.json",
                Filter = "Прогресс учебника (*.json)|*.json", DefaultExt = "json", AddExtension = true };
            if (picker.ShowDialog(owner) != DialogResult.OK) return false;
            await SyncFolder.WriteFile(picker.FileName, request.GetProperty("snapshot"), cancel);
            return true;
        }
        if (op == "disconnect") { CloudSession.Forget(); activeFolder = null; return null; }
        var config = CloudClients.Load();
        if (op == "status")
        {
            var active = CloudSession.Load();
            return new
            {
                provider = active != null && (active.Provider == "folder" || active.ClientId == config.ClientId(active.Provider)) ? active.Provider : null,
                configured = new { folder = true, google = !string.IsNullOrWhiteSpace(config.GoogleDesktopClientId), yandex = !string.IsNullOrWhiteSpace(config.YandexClientId) }
            };
        }
        var provider = request.GetProperty("provider").GetString();
        if (provider is not ("google" or "yandex" or "folder")) throw new InvalidOperationException("Выбери поддерживаемый диск.");
        if (op == "connect")
        {
            if (provider == "folder")
            {
                using var picker = new FolderBrowserDialog
                {
                    Description = "Выбери папку Google Диска или Яндекс Диска, общую с телефоном",
                    UseDescriptionForTitle = true, ShowNewFolderButton = true
                };
                if (picker.ShowDialog(owner) != DialogResult.OK)
                    throw new InvalidOperationException("Выбор папки отменён.");
                var folder = new SyncFolder(picker.SelectedPath);
                _ = folder.List();
                new CloudSession("folder", "", "", null, DateTimeOffset.MaxValue, picker.SelectedPath).Save();
                activeFolder = folder;
                return null;
            }
            // Keep the old connection intact if the user cancels a switch or if the new login fails.
            GoogleDesktopRegistration? imported = null;
            if (provider == "google" && string.IsNullOrWhiteSpace(config.GoogleDesktopClientSecret))
            {
                var registration = GoogleDesktopRegistration.Saved(config.GoogleDesktopClientId)
                    ?? (imported = GoogleClientDialog.Ask(owner, config.GoogleDesktopClientId));
                config = config with { GoogleDesktopClientSecret = registration.ClientSecret };
            }
            var replacement = await CloudAuthorisation.Connect(provider, config, cancel);
            await new CloudFiles(replacement).List(cancel);
            imported?.Save();
            replacement.Save();
            return null;
        }
        var session = CloudSession.Load();
        if (session?.Provider != provider || (provider != "folder" && session.ClientId != config.ClientId(provider)))
            throw new InvalidOperationException("Сначала подключи выбранный диск.");

        string device = op is "read" or "write" ? request.GetProperty("deviceId").GetString() ?? "" : "";
        if (op is "read" or "write" && !CloudFiles.IsDeviceId(device))
            throw new InvalidOperationException("Неверный идентификатор устройства.");
        if (provider == "folder")
        {
            if (string.IsNullOrWhiteSpace(session.FolderPath)) throw new InvalidOperationException("Выбери папку синхронизации заново.");
            if (activeFolder?.DirectoryPath != session.FolderPath) activeFolder = new SyncFolder(session.FolderPath);
            var folder = activeFolder;
            switch (op)
            {
                case "list": return folder.List();
                case "read": return await folder.Read(device, cancel);
                case "write": await folder.Write(device, request.GetProperty("snapshot"), cancel); return null;
                default: throw new InvalidOperationException("Неизвестная команда синхронизации.");
            }
        }
        async Task<object?> Run(CloudSession current)
        {
            var files = new CloudFiles(current);
            switch (op)
            {
                case "list": return await files.List(cancel);
                case "read": return await files.Read(device, cancel);
                case "write": await files.Write(device, request.GetProperty("snapshot"), cancel); return null;
                default: throw new InvalidOperationException("Неизвестная команда синхронизации.");
            }
        }
        try
        {
            if (session.Expires > DateTimeOffset.UtcNow.AddSeconds(60))
            {
                try { return await Run(session); }
                catch (CloudReauthoriseException) { /* Provider revoked the access token before its expiry. */ }
            }
            if (provider == "google" && string.IsNullOrWhiteSpace(config.GoogleDesktopClientSecret))
                config = config with { GoogleDesktopClientSecret = GoogleDesktopRegistration.Saved(session.ClientId)?.ClientSecret ?? "" };
            session = await CloudAuthorisation.Refresh(session, config, cancel);
            session.Save();
            return await Run(session);
        }
        catch (CloudReauthoriseException)
        {
            CloudSession.Forget();
            throw;
        }
    }
}
