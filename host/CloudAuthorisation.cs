using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record CloudClients(string GoogleDesktopClientId = "", string GoogleDesktopClientSecret = "", string YandexClientId = "")
{
    internal static readonly string DirectoryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CSharpBook");

    internal static CloudClients Load()
    {
        string path = Path.Combine(DirectoryPath, "cloud-sync.json");
        using var embedded = typeof(CloudClients).Assembly.GetManifestResourceStream("CSharpBook.CloudSync.json");
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var defaults = embedded is null ? new CloudClients() : JsonSerializer.Deserialize<CloudClients>(embedded, options) ?? new();
        if (!File.Exists(path)) return defaults;
        using var local = File.OpenRead(path);
        var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(local);
        if (fields is null) return defaults;
        var settings = new Dictionary<string, JsonElement>(fields, StringComparer.OrdinalIgnoreCase);
        string Read(string key, string fallback) => settings.TryGetValue(key, out var value) ? value.GetString() ?? "" : fallback;
        string id = Read("googleDesktopClientId", defaults.GoogleDesktopClientId);
        string secret = Read("googleDesktopClientSecret", id == defaults.GoogleDesktopClientId ? defaults.GoogleDesktopClientSecret : "");
        return new(id, secret, Read("yandexClientId", defaults.YandexClientId));
    }

    internal string ClientId(string provider) =>
        (provider == "google" ? GoogleDesktopClientId : YandexClientId) ?? "";
}

internal sealed record CloudSession(string Provider, string ClientId, string AccessToken, string? RefreshToken, DateTimeOffset Expires, string? FolderPath = null)
{
    private const string Vault = "cloud-session.dat";
    internal static CloudSession? Load() => CloudVault.Read<CloudSession>(Vault);
    internal void Save() => CloudVault.Write(Vault, this);
    internal static void Forget() => CloudVault.Delete(Vault);
}

internal sealed record GoogleDesktopRegistration(string ClientId, string ClientSecret)
{
    private const string Vault = "google-desktop.dat";
    internal static GoogleDesktopRegistration? Saved(string clientId) =>
        CloudVault.Read<GoogleDesktopRegistration>(Vault) is { } saved && saved.ClientId == clientId ? saved : null;
    internal void Save() => CloudVault.Write(Vault, this);
    internal static void Forget() => CloudVault.Delete(Vault);

    internal static GoogleDesktopRegistration Import(Stream source, string expectedId)
    {
        const string required = "Выбери JSON клиента Sharpwise Windows из Google Cloud. В нём должны быть client_id и полный client_secret.";
        if (source.Length is 0 or > 65536) throw new InvalidDataException(required);
        try
        {
            using var json = JsonDocument.Parse(source, new JsonDocumentOptions { MaxDepth = 8 });
            if (json.RootElement.ValueKind != JsonValueKind.Object ||
                !json.RootElement.TryGetProperty("installed", out var installed) || installed.ValueKind != JsonValueKind.Object ||
                !installed.TryGetProperty("client_id", out var id) || id.ValueKind != JsonValueKind.String ||
                !installed.TryGetProperty("client_secret", out var key) || key.ValueKind != JsonValueKind.String)
                throw new InvalidDataException(required);
            if (id.GetString() != expectedId)
                throw new InvalidDataException("Этот файл относится к другому клиенту Google. Выбери JSON клиента Sharpwise Windows.");
            return FromSecret(expectedId, key.GetString()!);
        }
        catch (JsonException) { throw new InvalidDataException(required); }
    }

    internal static GoogleDesktopRegistration FromSecret(string id, string input)
    {
        string secret = input.Trim();
        if (secret.Length is < 8 or > 4096 || secret.Any(char.IsWhiteSpace) || secret.Contains('*') || secret.Contains('•'))
            throw new InvalidDataException("Нужен полный Client secret из окна создания в Google Cloud.");
        return new(id, secret);
    }
}

internal static class CloudVault
{
    internal static T? Read<T>(string name) where T : class
    {
        string path = Path.Combine(CloudClients.DirectoryPath, name);
        if (!File.Exists(path)) return null;
        byte[] data = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<T>(data); }
        finally { CryptographicOperations.ZeroMemory(data); }
    }

    internal static void Write<T>(string name, T value)
    {
        Directory.CreateDirectory(CloudClients.DirectoryPath);
        byte[] data = JsonSerializer.SerializeToUtf8Bytes(value);
        string temp = Path.Combine(CloudClients.DirectoryPath, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllBytes(temp, ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser));
            File.Move(temp, Path.Combine(CloudClients.DirectoryPath, name), overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(data);
            File.Delete(temp);
        }
    }

    internal static void Delete(string name)
    {
        string path = Path.Combine(CloudClients.DirectoryPath, name);
        if (File.Exists(path)) File.Delete(path);
    }
}

internal static class CloudAuthorisation
{
    private const string YandexRedirectPath = "/callback";
    private static readonly TimeSpan LoginTimeout = TimeSpan.FromMinutes(5);

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static async Task<CloudSession> Connect(string provider, CloudClients clients, CancellationToken cancel)
    {
        var google = provider == "google";
        string id = clients.ClientId(provider);
        if (string.IsNullOrWhiteSpace(id))
            throw new InvalidOperationException("Для этого облака ещё не настроен вход в Windows-версии учебника.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(LoginTimeout);
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders(); // The callback URL includes a temporary authorization code.
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, google ? 0 : 53823));
        await using var listener = builder.Build();
        var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        string state = Base64Url(RandomNumberGenerator.GetBytes(32));
        string verifier = Base64Url(RandomNumberGenerator.GetBytes(48));
        string path = google ? "/" : YandexRedirectPath;
        listener.MapGet(path, async (HttpContext context) =>
        {
            var q = context.Request.Query;
            if (!string.Equals(q["state"], state, StringComparison.Ordinal))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            string code = q["code"].ToString();
            bool granted = !string.IsNullOrEmpty(code) && code.Length <= 4096 && !q.ContainsKey("error");
            context.Response.ContentType = "text/plain; charset=utf-8";
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsync(granted ? "Вход подтверждён. Вернись в Sharpwise." : "Вход отменён. Можно вернуться в Sharpwise.");
            if (granted) result.TrySetResult(code);
            else result.TrySetException(new InvalidOperationException("Вход отменён. Локальный прогресс сохранён."));
        });
        await listener.StartAsync(timeout.Token);
        try
        {
            string redirect = new Uri(new Uri(listener.Urls.Single()), path).AbsoluteUri;
            var parameters = new Dictionary<string, string?>
            {
                ["response_type"] = "code", ["client_id"] = id, ["redirect_uri"] = redirect,
                ["scope"] = google ? "https://www.googleapis.com/auth/drive.appdata" : "cloud_api:disk.app_folder",
                ["state"] = state, ["code_challenge_method"] = "S256",
                ["code_challenge"] = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))
            };
            if (google)
            {
                parameters["access_type"] = "offline";
                parameters["prompt"] = "select_account consent";
            }
            else parameters["force_confirm"] = "yes";
            var endpoint = google ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://oauth.yandex.ru/authorize";
            using var browser = Process.Start(new ProcessStartInfo(endpoint + QueryString.Create(parameters)) { UseShellExecute = true });
            string code = await result.Task.WaitAsync(timeout.Token);
            var form = new Dictionary<string, string>
            {
                ["code"] = code, ["code_verifier"] = verifier, ["grant_type"] = "authorization_code",
                ["client_id"] = id, ["redirect_uri"] = redirect
            };
            return await Exchange(provider, clients, form, null, timeout.Token);
        }
        finally { await listener.StopAsync(CancellationToken.None); }
    }

    internal static Task<CloudSession> Refresh(CloudSession session, CloudClients clients, CancellationToken cancel)
    {
        // Yandex requires its client secret for refresh. A distributed native client has no confidential secret.
        if (session.Provider != "google" || string.IsNullOrEmpty(session.RefreshToken))
            throw new CloudReauthoriseException();
        return Exchange(session.Provider, clients, new()
        {
            ["client_id"] = session.ClientId, ["grant_type"] = "refresh_token", ["refresh_token"] = session.RefreshToken
        }, session.RefreshToken, cancel);
    }

    private static async Task<CloudSession> Exchange(string provider, CloudClients clients,
        Dictionary<string, string> fields, string? previousRefresh, CancellationToken cancel)
    {
        bool google = provider == "google";
        if (google && !string.IsNullOrWhiteSpace(clients.GoogleDesktopClientSecret))
            fields["client_secret"] = clients.GoogleDesktopClientSecret;
        var endpoint = google ? "https://oauth2.googleapis.com/token" : "https://oauth.yandex.ru/token";
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new FormUrlEncodedContent(fields) };
        using var response = await CloudFiles.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
        if (!response.IsSuccessStatusCode)
        {
            if (google && response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized)
            {
                var failure = await CloudFiles.Parse(response, 65536, cancel);
                string? reason = failure.TryGetProperty("error", out var error) ? error.GetString() : null;
                if (reason == "invalid_grant" && previousRefresh != null) throw new CloudReauthoriseException();
                if (reason == "invalid_client")
                {
                    GoogleDesktopRegistration.Forget();
                    throw new InvalidOperationException("Google отклонил ключ Sharpwise Windows. Подключи Google Диск ещё раз и укажи действующий Client secret.");
                }
            }
            throw new InvalidOperationException($"Сервис отклонил вход (HTTP {(int)response.StatusCode}). Проверь настройки авторизации учебника.");
        }
        var token = await CloudFiles.Parse(response, 65536, cancel);
        string access = token.GetProperty("access_token").GetString() ?? "";
        if (access.Length == 0) throw new InvalidDataException("Сервис не прислал токен доступа.");
        string? refresh = google && token.TryGetProperty("refresh_token", out var newRefresh) ? newRefresh.GetString() : previousRefresh;
        var expires = token.TryGetProperty("expires_in", out var duration)
            ? DateTimeOffset.UtcNow.AddSeconds(duration.GetInt64()) : DateTimeOffset.MaxValue;
        return new(provider, clients.ClientId(provider), access, refresh, expires);
    }
}

internal sealed class CloudReauthoriseException() : Exception("Срок подключения истёк. Подключи диск заново. Локальный прогресс сохранён.") { }
