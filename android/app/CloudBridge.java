package ru.csharpbook.reader;

import android.content.Intent;
import android.net.Uri;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import java.io.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/** One trusted top-level reader gets an operation-only port. No network or token API is exposed. */
final class CloudBridge {
    private static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private final BookActivity activity;
    private final Uri origin;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final CloudCredentials credentials;
    private final CloudLogin login;
    private final SyncDocuments documents;
    private final boolean googleConfigured, yandexConfigured;
    private WebMessagePort port;

    CloudBridge(BookActivity activity, String origin) {
        this.activity = activity;
        this.origin = Uri.parse(origin);
        JSONObject config;
        try (InputStream in = activity.getAssets().open("cloud-sync.json")) {
            config = new JSONObject(CloudLogin.readSmall(in));
        } catch (IOException | JSONException e) { config = new JSONObject(); }
        String yandexClient = config.optString("yandexClientId", "").trim();
        googleConfigured = config.optBoolean("googleAndroidConfigured", false);
        yandexConfigured = yandexClient.matches("[a-fA-F0-9]{32}");
        credentials = new CloudCredentials(activity);
        login = new CloudLogin(activity, yandexClient);
        documents = new SyncDocuments(activity, credentials, login);
    }
    void unbind() {
        if (port != null) { port.close(); port = null; }
    }
    void bind(WebView web, String url) {
        Uri page = Uri.parse(url);
        if (!origin.getScheme().equals(page.getScheme()) || !origin.getEncodedAuthority().equals(page.getEncodedAuthority()) ||
            !("/".equals(page.getPath()) || "/index.html".equals(page.getPath()))) return;
        unbind();
        WebMessagePort[] channel = web.createWebMessageChannel();
        port = channel[0];
        port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort sender, WebMessage message) {
                String data = message.getData();
                if (sender != port || data == null || data.length() > 17 * 1024 * 1024) return;
                worker.execute(() -> handle(sender, data));
            }
        });
        web.postWebMessage(new WebMessage("book-sync-port", new WebMessagePort[]{channel[1]}), origin);
    }
    private void handle(WebMessagePort sender, String data) {
        JSONObject reply = new JSONObject();
        try {
            JSONObject request = new JSONObject(data);
            String id = request.optString("id", "");
            if (!UUID.matcher(id).matches() || !"book-sync".equals(request.optString("type"))) return;
            reply.put("id", id).put("type", "book-sync");
            try { reply.put("result", perform(request)).put("ok", true); }
            catch (Exception e) {
                String error = (e instanceof CloudLogin.UserError || e instanceof DriveFiles.UserError || e instanceof DriveFiles.Unauthorized || e instanceof FolderFiles.UserError || e instanceof DocumentPair.UserError) ? e.getMessage() :
                    "Не удалось синхронизировать данные. Проверь подключение к сети и повтори попытку.";
                reply.put("ok", false).put("error", error);
            } finally { login.endOperation(); }
        } catch (JSONException e) { return; }
        activity.runOnUiThread(() -> {
            if (port == sender && !activity.isDestroyed()) sender.postMessage(new WebMessage(reply.toString()));
        });
    }
    private Object perform(JSONObject request) throws Exception {
        String op = request.getString("op");
        if ("connect".equals(op)) login.beginConnect();
        if ("export".equals(op) || "import".equals(op)) return documents.progressFile(request, "export".equals(op));
        if ("disconnect".equals(op)) {
            documents.disconnect();
            return JSONObject.NULL;
        }
        if ("status".equals(op)) {
            Object provider;
            try { provider = credentials.read().opt("provider"); }
            catch (Exception e) { provider = null; }
            return new JSONObject().put("provider", provider == null ? JSONObject.NULL : provider)
                .put("configured", new JSONObject().put("google", googleConfigured).put("yandex", yandexConfigured).put("folder", true).put("documents", true));
        }
        String provider = request.getString("provider");
        if ("folder".equals(provider) || "documents".equals(provider)) return documents.sync(request, op, provider);
        boolean google = provider.equals("google");
        if (!(google ? googleConfigured : provider.equals("yandex") && yandexConfigured))
            throw new CloudLogin.UserError("Этот диск не настроен в данной сборке учебника.");
        if ("connect".equals(op)) {
            JSONObject data = new JSONObject().put("provider", provider);
            String token;
            if (google) {
                String name = login.chooseGoogleAccount();
                token = login.googleToken(name, true);
                data.put("account", name);
            } else {
                token = login.authorizeYandex();
                data.put("token", token);
            }
            DriveFiles.list(provider, token);
            documents.saveConnection(data);
            return JSONObject.NULL;
        }
        JSONObject current = credentials.read();
        if (!provider.equals(current.optString("provider"))) throw new CloudLogin.UserError("Сначала подключи выбранный диск.");
        String token = google ? login.googleToken(current.getString("account"), false) : current.getString("token");
        try { return files(op, provider, token, request); }
        catch (DriveFiles.Unauthorized denied) {
            if (!google) throw new CloudLogin.UserError("Яндекс отозвал доступ или срок входа истёк. Подключи Яндекс Диск ещё раз.");
            login.clearGoogleToken(token);
            return files(op, provider, login.googleToken(current.getString("account"), false), request);
        }
    }
    private Object files(String op, String provider, String token, JSONObject request) throws Exception {
        if ("list".equals(op)) return DriveFiles.list(provider, token);
        String device = request.getString("deviceId");
        if (!UUID.matcher(device).matches()) throw new CloudLogin.UserError("Некорректный идентификатор устройства.");
        if ("read".equals(op)) {
            Object data = DriveFiles.read(provider, token, device);
            return data == null ? JSONObject.NULL : data;
        }
        if ("write".equals(op)) {
            DriveFiles.write(provider, token, device, request.getJSONObject("snapshot"));
            return JSONObject.NULL;
        }
        throw new CloudLogin.UserError("Неизвестная операция синхронизации.");
    }
    boolean activityResult(int request, int result, Intent data) { return login.result(request, result, data); }
    void redirect(Intent data) { login.redirect(data); }
    void pause() { login.pause(); }
    void resume() { login.resume(); }
    void close() { unbind(); login.close(); worker.shutdownNow(); }
}
