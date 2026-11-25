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
        using var stream = File.Exists(path) ? File.OpenRead(path) :
            typeof(CloudClients).Assembly.GetManifestResourceStream("CSharpBook.CloudSync.json");
        return stream is null ? new() : JsonSerializer.Deserialize<CloudClients>(stream,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    internal string ClientId(string provider) =>
        (provider == "google" ? GoogleDesktopClientId : YandexClientId) ?? "";
}

internal sealed record CloudSession(string Provider, string ClientId, string AccessToken, string? RefreshToken, DateTimeOffset Expires, string? FolderPath = null)
{
    private static string Vault => Path.Combine(CloudClients.DirectoryPath, "cloud-session.dat");

    internal static CloudSession? Load()
    {
        if (!File.Exists(Vault)) return null;
        byte[] data = ProtectedData.Unprotect(File.ReadAllBytes(Vault), null, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<CloudSession>(data); }
        finally { CryptographicOperations.ZeroMemory(data); }
    }

    internal void Save()
    {
        Directory.CreateDirectory(CloudClients.DirectoryPath);
        byte[] data = JsonSerializer.SerializeToUtf8Bytes(this);
        string temp = Path.Combine(CloudClients.DirectoryPath, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllBytes(temp, ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser));
            File.Move(temp, Vault, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(data);
            File.Delete(temp);
        }
    }

    internal static void Forget() { if (File.Exists(Vault)) File.Delete(Vault); }
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
            await context.Response.WriteAsync(granted ? "Вход подтверждён. Вернись в Учебник C#." : "Вход отменён. Можно вернуться в Учебник C#.");
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
            if (response.StatusCode == HttpStatusCode.BadRequest && previousRefresh != null &&
                (await CloudFiles.Parse(response, 65536, cancel)).TryGetProperty("error", out var error) &&
                error.GetString() == "invalid_grant") throw new CloudReauthoriseException();
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
