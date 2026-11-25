package ru.csharpbook.reader;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Each installation writes its own snapshot. Remote device files are read-only for its peers. */
final class DriveFiles {
    private static final String GOOGLE = "google";
    private static final String YANDEX = "yandex";
    private static final String G_FILES = "https://www.googleapis.com/drive/v3/files";
    private static final String G_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    private static final String Y_FILES = "https://cloud-api.yandex.net/v1/disk/resources";
    private static final String ID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    private static final Pattern FILENAME = Pattern.compile("csharpbook-v1-(" + ID + ")\\.json");
    private static final int SNAPSHOT_LIMIT = 8 * 1024 * 1024;
    private static final int MAX_COPIES = 32;
    private static final int METADATA_LIMIT = 1024 * 1024;

    static final class UserError extends IOException {
        UserError(String message) { super(message); }
    }

    static final class Unauthorized extends IOException {
        Unauthorized() { super("Доступ к облаку истёк. Подключи аккаунт ещё раз."); }
    }

    static JSONArray list(String provider, String token) throws Exception {
        validate(provider, token);
        Set<String> ids = new TreeSet<>();
        if (GOOGLE.equals(provider)) {
            ids.addAll(googleFiles(token, null).keySet());
        } else {
            int offset = 0;
            while (true) {
                String url = Y_FILES + "?path=app%3A%2F&limit=100&offset=" + offset +
                    "&fields=_embedded.items.name,_embedded.items.type,_embedded.total";
                Reply page = api(YANDEX, token, url);
                if (page.status == 404 && offset == 0) break;
                JSONObject entries = page.json().getJSONObject("_embedded");
                JSONArray items = entries.getJSONArray("items");
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.getJSONObject(i);
                    Matcher match = FILENAME.matcher(item.getString("name"));
                    if ("file".equals(item.optString("type")) && match.matches()) ids.add(match.group(1));
                }
                offset += items.length();
                if (items.length() == 0 || offset >= entries.optInt("total", Integer.MAX_VALUE)) break;
            }
        }
        return new JSONArray(ids);
    }

    static Object read(String provider, String token, String deviceId) throws Exception {
        validate(provider, token);
        String name = filename(deviceId);
        if (GOOGLE.equals(provider)) {
            TreeSet<String> copies = googleFiles(token, name).get(deviceId);
            if (copies == null) return null;
            JSONArray result = new JSONArray();
            int remaining = SNAPSHOT_LIMIT - (copies.size() > 1 ? copies.size() + 1 : 0);
            for (String fileId : copies) {
                String url = G_FILES + "/" + encode(fileId) + "?alt=media";
                Reply file = request(GOOGLE, token, "GET", url, null, -1, remaining);
                result.put(file.json());
                remaining -= file.data.length;
            }
            return result.length() == 1 ? result.getJSONObject(0) : result;
        }
        Reply link = api(YANDEX, token, Y_FILES + "/download?path=" + encode("app:/" + name));
        if (link.status == 404) return null;
        return request(YANDEX, null, "GET", link.json().getString("href"), null, -1, SNAPSHOT_LIMIT).json();
    }

    static synchronized void write(String provider, String token, String deviceId, JSONObject snapshot) throws Exception {
        validate(provider, token);
        String name = filename(deviceId);
        byte[] data = snapshot.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > SNAPSHOT_LIMIT) throw new UserError("Данные устройства превышают 8 МБ.");
        if (GOOGLE.equals(provider)) {
            TreeSet<String> existing = googleFiles(token, name).get(deviceId);
            JSONObject meta = new JSONObject();
            String url = G_UPLOAD;
            String method = "POST";
            if (existing == null) {
                meta.put("name", name).put("parents", new JSONArray().put("appDataFolder")).put("mimeType", "application/json");
            } else {
                url += "/" + encode(existing.first());
                method = "PATCH";
            }
            Reply session = request(GOOGLE, token, method, url + "?uploadType=resumable&fields=id",
                meta.toString().getBytes(StandardCharsets.UTF_8), data.length, METADATA_LIMIT);
            session.requireSuccess();
            Reply upload = request(GOOGLE, null, "PUT", session.location, data, -1, METADATA_LIMIT);
            upload.requireCommitted();
        } else {
            String url = Y_FILES + "/upload?overwrite=true&path=" + encode("app:/" + name);
            String href = api(YANDEX, token, url).json().getString("href");
            Reply upload = request(YANDEX, null, "PUT", href, data, -1, METADATA_LIMIT);
            upload.requireCommitted();
        }
    }

    private static Map<String,TreeSet<String>> googleFiles(String token, String name) throws Exception {
        Map<String,TreeSet<String>> found = new TreeMap<>();
        String filter = "trashed = false and " + (name == null ? "name contains 'csharpbook-v1-'" : "name = '" + name + "'");
        String base = G_FILES + "?spaces=appDataFolder&pageSize=100&q=" + encode(filter) +
            "&fields=nextPageToken,incompleteSearch,files(id,name)";
        String next = "";
        Set<String> visited = new HashSet<>();
        do {
            if (!visited.add(next)) throw new UserError("Google Диск повторил страницу списка файлов.");
            JSONObject page = api(GOOGLE, token, base + (next.isEmpty() ? "" : "&pageToken=" + encode(next))).json();
            if (page.optBoolean("incompleteSearch", false)) throw new UserError("Google Диск вернул неполный список файлов.");
            JSONArray files = page.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                Matcher match = FILENAME.matcher(file.getString("name"));
                if (!match.matches()) continue;
                String device = match.group(1);
                // A retried create with a lost response can leave multiple files for a writer.
                // Return each copy so the sync engine can merge its records without losing edits.
                TreeSet<String> copies = found.get(device);
                if (copies == null) { copies = new TreeSet<>(); found.put(device, copies); }
                copies.add(file.getString("id"));
                if (copies.size() > MAX_COPIES) throw new UserError("Слишком много копий данных одного устройства.");
            }
            next = page.optString("nextPageToken", "");
        } while (!next.isEmpty());
        return found;
    }

    private static void validate(String provider, String token) throws IOException {
        if (!GOOGLE.equals(provider) && !YANDEX.equals(provider)) throw new UserError("Неизвестное облачное хранилище.");
        if (token == null || token.isEmpty() || token.indexOf('\r') >= 0 || token.indexOf('\n') >= 0) throw new Unauthorized();
    }

    private static String filename(String deviceId) throws IOException {
        if (deviceId == null || !deviceId.matches(ID)) throw new UserError("Недопустимый идентификатор устройства.");
        return "csharpbook-v1-" + deviceId + ".json";
    }

    private static String encode(String value) throws IOException { return URLEncoder.encode(value, "UTF-8"); }

    private static Reply api(String provider, String token, String url) throws Exception {
        return request(provider, token, "GET", url, null, -1, METADATA_LIMIT);
    }

    private static Reply request(String provider, String token, String method, String url, byte[] body,
                                 int uploadLength, int limit) throws Exception {
        if (url == null) throw new UserError("Облако не вернуло адрес для передачи файла.");
        URI target = URI.create(url);
        for (int redirects = 0; redirects <= 5; redirects++) {
            checkTarget(target, provider, token != null);
            HttpURLConnection conn = (HttpURLConnection)target.toURL().openConnection();
            try {
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);
                conn.setUseCaches(false);
                try { conn.setRequestMethod(method); }
                catch (ProtocolException e) {
                    if (!GOOGLE.equals(provider) || !"PATCH".equals(method)) throw e;
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
                }
                if (token != null) conn.setRequestProperty("Authorization", (GOOGLE.equals(provider) ? "Bearer " : "OAuth ") + token);
                if (uploadLength >= 0) {
                    conn.setRequestProperty("X-Upload-Content-Type", "application/json");
                    conn.setRequestProperty("X-Upload-Content-Length", Integer.toString(uploadLength));
                }
                if (body != null) {
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(body.length);
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                    try (OutputStream out = conn.getOutputStream()) { out.write(body); }
                }
                int status = conn.getResponseCode();
                if (status == 401 && token != null) throw new Unauthorized();
                String location = conn.getHeaderField("Location");
                if (location != null && (status == 307 || status == 308 ||
                        ("GET".equals(method) && (status == 301 || status == 302 || status == 303)))) {
                    target = target.resolve(location);
                    token = null;
                    continue;
                }
                byte[] response = new byte[0];
                if (status >= 200 && status < 300) {
                    if (conn.getContentLengthLong() > limit) throw new UserError("Ответ облака превышает допустимый размер.");
                    try (InputStream in = conn.getInputStream()) { response = bounded(in, limit); }
                }
                return new Reply(status, location, response);
            } finally { conn.disconnect(); }
        }
        throw new UserError("Облако вернуло слишком много перенаправлений.");
    }

    private static void checkTarget(URI uri, String provider, boolean authenticated) throws IOException {
        String host = uri.getHost();
        boolean safe = "https".equalsIgnoreCase(uri.getScheme()) && uri.getRawAuthority() != null &&
            host != null && uri.getUserInfo() == null && uri.getFragment() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        if (safe) {
            host = host.toLowerCase(java.util.Locale.ROOT);
            if (GOOGLE.equals(provider)) {
                safe = host.equals("www.googleapis.com") || (!authenticated &&
                    (host.endsWith(".googleapis.com") || host.endsWith(".googleusercontent.com") || host.equals("drive.usercontent.google.com")));
            } else {
                safe = host.equals("cloud-api.yandex.net") || (!authenticated &&
                    (host.endsWith(".disk.yandex.net") || host.endsWith(".disk.yandex.ru") ||
                     host.endsWith(".storage.yandex.net") || host.equals("disk.yandex.ru")));
            }
        }
        if (!safe) throw new UserError("Облако вернуло недопустимый адрес передачи данных.");
    }

    private static byte[] bounded(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) != -1) {
            if (n > limit - out.size()) throw new UserError("Ответ облака превышает допустимый размер.");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    private static final class Reply {
        final int status;
        final String location;
        final byte[] data;
        Reply(int status, String location, byte[] data) { this.status = status; this.location = location; this.data = data; }
        void requireSuccess() throws IOException {
            if (status < 200 || status >= 300) throw new UserError("Ошибка облачного хранилища (HTTP " + status + ").");
        }
        void requireCommitted() throws IOException {
            requireSuccess();
            if (status != 200 && status != 201 && status != 204) throw new UserError("Облако ещё не подтвердило запись. Повтори синхронизацию.");
        }
        JSONObject json() throws Exception {
            requireSuccess();
            String content = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(data)).toString();
            return new JSONObject(content);
        }
    }
}
