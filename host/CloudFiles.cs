using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// All provider URLs and paths originate here. The web UI can only name an individual replica by UUID.
internal sealed class CloudFiles(CloudSession session, HttpClient? transport = null)
{
    internal const int MaxBytes = 8 * 1024 * 1024;
    private const int MetadataLimit = 1024 * 1024;
    private const string GoogleFiles = "https://www.googleapis.com/drive/v3/files";
    private const string GoogleUpload = "https://www.googleapis.com/upload/drive/v3/files";
    private const string YandexFiles = "https://cloud-api.yandex.net/v1/disk/resources";
    private const string Prefix = "csharpbook-v1-";
    private const string Suffix = ".json";
    internal static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        { Timeout = TimeSpan.FromSeconds(45) };
    private readonly HttpClient http = transport ?? Client;
    private bool Google => session.Provider == "google";

    internal static bool IsDeviceId(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed.ToString("D") == value;

    internal static string? DeviceId(string name)
    {
        if (!name.StartsWith(Prefix, StringComparison.Ordinal) || !name.EndsWith(Suffix, StringComparison.Ordinal)) return null;
        string id = name[Prefix.Length..^Suffix.Length];
        return IsDeviceId(id) ? id : null;
    }

    internal static string FileName(string id) => Prefix + id + Suffix;
    private static string Enc(string value) => Uri.EscapeDataString(value);

    private async Task<HttpResponseMessage> Api(HttpMethod method, string url, HttpContent? body, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(method, url) { Content = body };
        request.Headers.Authorization = new AuthenticationHeaderValue(Google ? "Bearer" : "OAuth", session.AccessToken);
        return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
    }

    private static void Check(HttpResponseMessage response, bool authorised = true)
    {
        if (response.IsSuccessStatusCode) return;
        if (authorised && response.StatusCode == HttpStatusCode.Unauthorized) throw new CloudReauthoriseException();
        throw new InvalidOperationException(response.StatusCode switch
        {
            HttpStatusCode.Forbidden => "Диск отклонил запрос. Проверь разрешение на папку учебника и подключение к диску.",
            HttpStatusCode.TooManyRequests => "Диск временно ограничил запросы. Попробуй немного позже.",
            (HttpStatusCode)507 => "На диске закончилось свободное место.",
            _ => $"Диск вернул ошибку HTTP {(int)response.StatusCode}. Локальный прогресс сохранён."
        });
    }

    internal static async Task<JsonElement> Parse(HttpResponseMessage response, long maximum, CancellationToken cancel)
    {
        if (maximum <= 0 || response.Content.Headers.ContentLength > maximum)
            throw new InvalidDataException("Файл синхронизации слишком большой.");
        // LoadIntoBufferAsync also enforces the bound when Content-Length is omitted.
        await response.Content.LoadIntoBufferAsync(maximum, cancel);
        using var document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(cancel));
        return document.RootElement.Clone();
    }

    internal async Task<string[]> List(CancellationToken cancel)
    {
        if (Google)
            return (await GoogleEntries(null, cancel)).Select(e => e.Device).Distinct(StringComparer.Ordinal).ToArray();

        const int pageSize = 100;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        int offset = 0;
        while (true)
        {
            string url = YandexFiles + "?path=app%3A%2F&limit=" + pageSize + "&offset=" + offset
                + "&fields=_embedded.items.name,_embedded.items.type,_embedded.total";
            using var response = await Api(HttpMethod.Get, url, null, cancel);
            Check(response);
            var folder = (await Parse(response, MetadataLimit, cancel)).GetProperty("_embedded");
            var items = folder.GetProperty("items");
            foreach (var item in items.EnumerateArray())
            {
                if (item.GetProperty("type").GetString() == "file" &&
                    DeviceId(item.GetProperty("name").GetString() ?? "") is string id) ids.Add(id);
            }
            offset = checked(offset + items.GetArrayLength());
            if (items.GetArrayLength() == 0 || offset >= folder.GetProperty("total").GetInt32()) break;
        }
        return ids.ToArray();
    }

    private async Task<List<(string Device, string File)>> GoogleEntries(string? device, CancellationToken cancel)
    {
        string query = "trashed = false and " + (device == null
            ? $"name contains '{Prefix}'" : $"name = '{FileName(device)}'");
        string url = GoogleFiles + "?spaces=appDataFolder&pageSize=100&fields=nextPageToken,incompleteSearch,files(id,name)&q=" + Enc(query);
        var entries = new List<(string, string)>();
        string? page = null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        do
        {
            using var response = await Api(HttpMethod.Get, page == null ? url : url + "&pageToken=" + Enc(page), null, cancel);
            Check(response);
            var result = await Parse(response, MetadataLimit, cancel);
            if (result.TryGetProperty("incompleteSearch", out var incomplete) && incomplete.GetBoolean())
                throw new InvalidDataException("Google Диск вернул неполный список файлов. Попробуй ещё раз.");
            foreach (var file in result.GetProperty("files").EnumerateArray())
            {
                string? id = DeviceId(file.GetProperty("name").GetString() ?? "");
                string? fileId = file.GetProperty("id").GetString();
                if (id != null && (fileId == null || !Regex.IsMatch(fileId, @"\A[A-Za-z0-9_-]{1,256}\z")))
                    throw new InvalidDataException("Диск вернул неверный идентификатор файла.");
                if (id != null) entries.Add((id, fileId!));
            }
            page = result.TryGetProperty("nextPageToken", out var token) ? token.GetString() : null;
            if (!string.IsNullOrEmpty(page) && !seen.Add(page))
                throw new InvalidDataException("Диск повторил страницу списка файлов.");
        } while (!string.IsNullOrEmpty(page));
        return entries;
    }

    internal async Task<object?> Read(string device, CancellationToken cancel)
    {
        if (!Google)
        {
            string path = Enc("app:/" + FileName(device));
            using var link = await Api(HttpMethod.Get, YandexFiles + "/download?path=" + path, null, cancel);
            if (link.StatusCode == HttpStatusCode.NotFound) return null;
            Check(link);
            var result = await Transfer(HttpMethod.Get, await TransferUrl(link, cancel), null, cancel);
            using (result)
            {
                Check(result, authorised: false);
                return await Parse(result, MaxBytes, cancel);
            }
        }

        var files = await GoogleEntries(device, cancel);
        if (files.Count == 0) return null;
        if (files.Count > 32) throw new InvalidDataException("На Диске слишком много копий файла устройства.");
        var copies = new List<JsonElement>();
        int remaining = MaxBytes;
        foreach (var entry in files.OrderBy(e => e.File, StringComparer.Ordinal))
        {
            var snapshot = await ReadGoogleFile(entry.File, remaining, cancel);
            remaining -= Encoding.UTF8.GetByteCount(snapshot.GetRawText());
            copies.Add(snapshot);
        }
        return copies.Count == 1 ? copies[0] : copies;
    }

    private async Task<JsonElement> ReadGoogleFile(string fileId, int remaining, CancellationToken cancel)
    {
        var url = new Uri(GoogleFiles + "/" + fileId + "?alt=media");
        using var response = await Api(HttpMethod.Get, url.AbsoluteUri, null, cancel);
        if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308 && response.Headers.Location is Uri location)
        {
            using var download = await Transfer(HttpMethod.Get, new Uri(url, location), null, cancel);
            Check(download, authorised: false);
            return await Parse(download, remaining, cancel);
        }
        Check(response);
        return await Parse(response, remaining, cancel);
    }

    internal async Task Write(string device, JsonElement snapshot, CancellationToken cancel)
    {
        if (snapshot.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Нет данных для синхронизации.");
        byte[] content = Encoding.UTF8.GetBytes(snapshot.GetRawText());
        if (content.Length > MaxBytes) throw new InvalidDataException("Файл синхронизации превышает 8 МБ.");
        if (!Google)
        {
            string path = Enc("app:/" + FileName(device));
            using var link = await Api(HttpMethod.Get, YandexFiles + "/upload?overwrite=true&path=" + path, null, cancel);
            Check(link);
            using var response = await Transfer(HttpMethod.Put, await TransferUrl(link, cancel), content, cancel);
            Check(response, authorised: false);
            return;
        }

        var files = await GoogleEntries(device, cancel);
        if (files.Count > 0)
        {
            var id = files.Select(e => e.File).Order(StringComparer.Ordinal).First();
            using var response = await Api(HttpMethod.Patch, GoogleUpload + "/" + id + "?uploadType=media", JsonBody(content), cancel);
            Check(response);
            return;
        }

        using var multipart = new MultipartContent("related");
        multipart.Add(JsonBody(JsonSerializer.SerializeToUtf8Bytes(new { name = FileName(device), parents = new[] { "appDataFolder" } })));
        multipart.Add(JsonBody(content));
        using var created = await Api(HttpMethod.Post, GoogleUpload + "?uploadType=multipart&fields=id", multipart, cancel);
        Check(created);
    }

    private static ByteArrayContent JsonBody(byte[] bytes)
    {
        var body = new ByteArrayContent(bytes);
        body.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
        return body;
    }

    private static async Task<Uri> TransferUrl(HttpResponseMessage response, CancellationToken cancel)
    {
        var meta = await Parse(response, MetadataLimit, cancel);
        return Uri.TryCreate(meta.GetProperty("href").GetString(), UriKind.Absolute, out var url)
            ? url : throw new InvalidDataException("Яндекс Диск вернул некорректную ссылку.");
    }

    private bool IsTransferHost(string host)
    {
        if (Google)
            return host == "drive.usercontent.google.com" || host.EndsWith(".googleapis.com", StringComparison.OrdinalIgnoreCase)
                || host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase);
        return new[] { "yandex.net", "yandex.ru", "yandex.com", "yandexcloud.net" }.Any(
            suffix => host == suffix || host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<HttpResponseMessage> Transfer(HttpMethod method, Uri url, byte[]? content, CancellationToken cancel)
    {
        for (int i = 0; i < 5; i++)
        {
            if (!url.IsAbsoluteUri || url.Scheme != "https" || !url.IsDefaultPort || url.UserInfo.Length != 0 || !IsTransferHost(url.Host))
                throw new InvalidDataException("Диск вернул неизвестный адрес передачи.");
            using var request = new HttpRequestMessage(method, url) { Content = content is null ? null : JsonBody(content) };
            // These are short-lived signed URLs. Never forward the OAuth token to the file server.
            var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is Uri location &&
                (method == HttpMethod.Get || (int)response.StatusCode is 307 or 308))
            {
                response.Dispose();
                url = new Uri(url, location);
                continue;
            }
            return response;
        }
        throw new InvalidDataException("Слишком много перенаправлений при обмене с диском.");
    }
}
