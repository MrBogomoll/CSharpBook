package ru.csharpbook.reader;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONObject;

/** Interactive steps always run in the Android account selector or the external browser. */
final class CloudLogin {
    static final String YANDEX_REDIRECT = BuildConfig.APPLICATION_ID + "://oauth/yandex";
    private static final String GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private static final int ACCOUNT = 751, GOOGLE_GRANT = 752, YANDEX = 753, FOLDER = 754, IMPORT = 755, EXPORT = 756, PEER_FILE = 757, OWN_FILE = 758, CHOOSE_OWN_MODE = 759;
    private final BookActivity activity;
    private final String yandexClientId;
    private final SecureRandom random = new SecureRandom();
    private Wait pending;
    private long connectDeadline;
    void beginConnect() { connectDeadline = android.os.SystemClock.elapsedRealtime() + 300000; }
    void endOperation() { connectDeadline = 0; }

    CloudLogin(BookActivity activity, String yandexClientId) {
        this.activity = activity;
        this.yandexClientId = yandexClientId;
    }
    static final class UserError extends IOException {
        UserError(String message) { super(message); }
    }
    private interface Launch { void run() throws Exception; }
    private static final class Wait {
        final int kind;
        final String state;
        final CompletableFuture<Intent> result = new CompletableFuture<>();
        boolean leftForBrowser;
        Wait(int kind, String state) { this.kind = kind; this.state = state; }
    }
    private Intent prompt(int kind, String state, Launch launch) throws Exception {
        Wait wait = new Wait(kind, state);
        synchronized (this) {
            if (pending != null) throw new UserError("Уже открыто окно входа.");
            pending = wait;
        }
        try {
            activity.runOnUiThread(() -> {
                synchronized (CloudLogin.this) { if (pending != wait) return; }
                try { launch.run(); }
                catch (Exception e) { wait.result.completeExceptionally(new UserError("Не удалось открыть окно входа.")); }
            });
            long time = connectDeadline == 0 ? 300000 : connectDeadline - android.os.SystemClock.elapsedRealtime();
            try { return wait.result.get(Math.max(time, 0), TimeUnit.MILLISECONDS); }
            catch (TimeoutException e) { throw new UserError("Время входа истекло. Подключи диск ещё раз."); }
            catch (ExecutionException e) { throw (Exception) e.getCause(); }
        } finally {
            synchronized (this) { if (pending == wait) pending = null; }
        }
    }
    synchronized boolean result(int kind, int code, Intent data) {
        if (kind != ACCOUNT && kind != GOOGLE_GRANT && kind != FOLDER && kind != IMPORT && kind != EXPORT &&
            kind != PEER_FILE && kind != OWN_FILE && kind != CHOOSE_OWN_MODE) return false;
        if (pending != null && pending.kind == kind) {
            if (code == Activity.RESULT_OK && data != null) pending.result.complete(data);
            else if (kind == IMPORT || kind == EXPORT) pending.result.complete(null);
            else pending.result.completeExceptionally(new UserError(kind == FOLDER ? "Выбор папки отменён." : kind >= PEER_FILE ? "Выбор файлов отменён." : "Вход отменён."));
        }
        return true;
    }
    synchronized void redirect(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (pending == null || pending.kind != YANDEX || uri == null ||
            !YANDEX_REDIRECT.equals(uri.buildUpon().clearQuery().fragment(null).build().toString()) ||
            !pending.state.equals(uri.getQueryParameter("state"))) return;
        pending.result.complete(intent);
    }
    synchronized void pause() {
        if (pending != null && pending.kind == YANDEX) pending.leftForBrowser = true;
    }
    synchronized void resume() {
        Wait wait = pending;
        if (wait == null || !wait.leftForBrowser) return;
        // A valid redirect is delivered in onNewIntent before the activity resumes.
        // Back from the browser should close the sign-in UI immediately.
        if (!wait.result.isDone()) wait.result.completeExceptionally(new UserError("Вход в Яндекс отменён."));
    }
    synchronized void close() {
        if (pending != null) pending.result.completeExceptionally(new UserError("Окно входа закрыто."));
    }
    Uri chooseProgressFile(boolean export) throws Exception {
        Intent picker = new Intent(export ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE);
        if (export) picker.setType("application/json").putExtra(Intent.EXTRA_TITLE, "CSharpBook-progress.json");
        else picker.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,
            new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"});
        int kind = export ? EXPORT : IMPORT;
        Intent result = prompt(kind, null, () -> activity.startActivityForResult(picker, kind));
        if (result == null) return null;
        Uri document = result.getData();
        if (document == null || !"content".equals(document.getScheme())) throw new UserError("Не удалось открыть выбранный файл.");
        return document;
    }
    boolean createPhoneDocument() throws Exception {
        Intent decision = prompt(CHOOSE_OWN_MODE, null, () -> new android.app.AlertDialog.Builder(activity)
            .setTitle("Файл телефона")
            .setMessage("Выбери ту же папку облачного диска, где лежит файл ПК. Если подключаешь телефон впервые, создай файл с предложенным именем.")
            .setPositiveButton("Создать файл", (d,b) -> result(CHOOSE_OWN_MODE, Activity.RESULT_OK, new Intent().putExtra("create", true)))
            .setNegativeButton("Файл уже есть", (d,b) -> result(CHOOSE_OWN_MODE, Activity.RESULT_OK, new Intent()))
            .setNeutralButton("Отмена", (d,b) -> result(CHOOSE_OWN_MODE, Activity.RESULT_CANCELED, null))
            .setOnCancelListener(d -> result(CHOOSE_OWN_MODE, Activity.RESULT_CANCELED, null)).show());
        return decision.getBooleanExtra("create", false);
    }
    Uri chooseReplica(String name, boolean create, Uri initialUri) throws Exception {
        boolean incoming = name == null;
        int kind = incoming ? PEER_FILE : OWN_FILE;
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | (incoming ? 0 : Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Intent picker = new Intent(create ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).addFlags(flags | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        if (create) picker.setType("application/json").putExtra(Intent.EXTRA_TITLE, name);
        else picker.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,
            new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"});
        if (initialUri != null) picker.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, initialUri);
        Intent selected = prompt(kind, null, () -> activity.startActivityForResult(picker, kind));
        Uri uri = selected.getData();
        if (uri == null || !"content".equals(uri.getScheme()) || (selected.getFlags() & flags) != flags)
            throw new UserError(incoming ? "Выбери доступный для чтения файл ПК." : "Выбери файл телефона, доступный для чтения и записи.");
        try { activity.getContentResolver().takePersistableUriPermission(uri, flags); }
        catch (SecurityException e) { throw new UserError("Провайдер не разрешил постоянный доступ к файлу. Попробуй экспорт и импорт."); }
        return uri;
    }
    Uri chooseFolder() throws Exception {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(flags |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        Intent selected = prompt(FOLDER, null, () -> activity.startActivityForResult(picker, FOLDER));
        Uri tree = selected.getData();
        if (tree == null || !"content".equals(tree.getScheme()) || !android.provider.DocumentsContract.isTreeUri(tree) ||
                (selected.getFlags() & flags) != flags)
            throw new UserError("Выбери папку, для которой разрешены чтение и запись.");
        try { activity.getContentResolver().takePersistableUriPermission(tree, flags); }
        catch (SecurityException e) { throw new UserError("Провайдер папки не разрешил сохранять доступ. Выбери другую папку."); }
        return tree;
    }
    String chooseGoogleAccount() throws Exception {
        Intent chooser = AccountManager.newChooseAccountIntent(null, null, new String[]{"com.google"}, null, null, null, null);
        Intent selected = prompt(ACCOUNT, null, () -> activity.startActivityForResult(chooser, ACCOUNT));
        String name = selected.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
        if (name == null || name.isEmpty() || !"com.google".equals(selected.getStringExtra(AccountManager.KEY_ACCOUNT_TYPE)))
            throw new UserError("Не удалось выбрать аккаунт Google.");
        return name;
    }
    String googleToken(String accountName, boolean interactive) throws Exception {
        AuthorizationClient google = Identity.getAuthorizationClient(activity);
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setAccount(new Account(accountName, "com.google"))
            .setRequestedScopes(Collections.singletonList(new Scope(GOOGLE_SCOPE))).build();
        AuthorizationResult result;
        try { result = Tasks.await(google.authorize(request), 1, TimeUnit.MINUTES); }
        catch (ExecutionException e) { throw new UserError("Не удалось получить доступ к Google Диску. Проверь подключение, сервисы Google Play и регистрацию приложения."); }
        if (result.hasResolution()) {
            if (!interactive) throw new UserError("Google запрашивает подтверждение. Подключи Google Диск ещё раз.");
            final android.app.PendingIntent resolution = result.getPendingIntent();
            if (resolution == null) throw new UserError("Google не предоставил окно входа.");
            Intent data = prompt(GOOGLE_GRANT, null, () -> activity.startIntentSenderForResult(
                resolution.getIntentSender(), GOOGLE_GRANT, null, 0, 0, 0));
            result = google.getAuthorizationResultFromIntent(data);
        }
        String token = result.getAccessToken();
        if (token == null || token.isEmpty() || !result.getGrantedScopes().contains(GOOGLE_SCOPE))
            throw new UserError("Нет разрешения на папку учебника в Google Диске.");
        return token;
    }
    void clearGoogleToken(String token) throws Exception {
        Tasks.await(Identity.getAuthorizationClient(activity).clearToken(
            ClearTokenRequest.builder().setToken(token).build()), 30, TimeUnit.SECONDS);
    }
    private static String base64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }
    private String randomValue() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes); return base64(bytes);
    }
    String authorizeYandex() throws Exception {
        String verifier = randomValue(), state = randomValue();
        String challenge = base64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        Uri uri = Uri.parse("https://oauth.yandex.ru/authorize").buildUpon()
            .appendQueryParameter("response_type", "code").appendQueryParameter("client_id", yandexClientId)
            .appendQueryParameter("redirect_uri", YANDEX_REDIRECT).appendQueryParameter("scope", "cloud_api:disk.app_folder")
            .appendQueryParameter("state", state).appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256").build();
        Intent redirect = prompt(YANDEX, state, () -> activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)));
        String code = redirect.getData().getQueryParameter("code");
        if (code == null || code.isEmpty()) throw new UserError("Яндекс не подтвердил доступ к папке учебника.");
        String form = "grant_type=authorization_code&client_id=" + URLEncoder.encode(yandexClientId, "UTF-8") +
            "&code=" + URLEncoder.encode(code, "UTF-8") + "&code_verifier=" + verifier;
        HttpURLConnection conn = (HttpURLConnection) new URL("https://oauth.yandex.ru/token").openConnection();
        try {
            conn.setInstanceFollowRedirects(false); conn.setRequestMethod("POST"); conn.setDoOutput(true);
            conn.setConnectTimeout(15000); conn.setReadTimeout(30000);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] bytes = form.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = conn.getOutputStream()) { output.write(bytes); }
            if (conn.getResponseCode() != 200) throw new UserError("Яндекс отклонил код входа. Подключи диск ещё раз.");
            JSONObject response;
            try (InputStream in = conn.getInputStream()) { response = new JSONObject(readSmall(in)); }
            String token = response.optString("access_token", "");
            if (token.isEmpty()) throw new UserError("Яндекс не выдал доступ к диску.");
            return token;
        } finally { conn.disconnect(); }
    }
    static String readSmall(InputStream in) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        int count;
        while ((count = in.read(buffer)) != -1) {
            if (bytes.size() + count > 65536) throw new IOException("Слишком большой ответ.");
            bytes.write(buffer, 0, count);
        }
        return bytes.toString("UTF-8");
    }
}
