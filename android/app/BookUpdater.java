package ru.csharpbook.reader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.provider.Settings;
import android.text.format.Formatter;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class BookUpdater {
    static final int PERMISSION = 723, INSTALL = 724;
    static final String PREFS = "updater", INSTALL_TASK = "installTask";
    private static final String LATEST = "https://api.github.com/repos/MrBogomoll/Sharpwise/releases/latest";
    private static final String BETA = "https://api.github.com/repos/MrBogomoll/Sharpwise/releases/tags/beta";
    private final BookActivity activity;
    private final SharedPreferences prefs;
    private boolean busy;
    private String message = "";

    BookUpdater(BookActivity activity) {
        this.activity = activity;
        prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            PackageInfo installed = installed();
            if (installed.versionName.equals(prefs.getString("version", ""))) {
                String version = installed.versionName;
                message = "Версия " + version + " установлена.";
                prefs.edit().clear().apply(); UpdateFile.file(activity).delete();
            }
        } catch (Exception ignored) { }
    }
    void status() { activity.showUpdate(message, busy); }
    private void state(String text, boolean working) {
        message = text; busy = working; status();
    }
    private boolean alive() { return !activity.isFinishing() && !activity.isDestroyed(); }
    private void post(String text, boolean working) {
        activity.runOnUiThread(() -> { if (alive()) state(text, working); });
    }

    private static HttpURLConnection connection(String address, boolean asset, boolean optional) throws IOException {
        URL url = new URL(address);
        for (int i = 0; i < 4; i++) {
            HttpURLConnection conn = (HttpURLConnection)url.openConnection();
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000); conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "CSharpBook-Android/1.0");
            int code;
            try { code = conn.getResponseCode(); } catch (IOException failure) { conn.disconnect(); throw failure; }
            if (code == 200) return conn;
            String location = conn.getHeaderField("Location");
            conn.disconnect();
            if (optional && code == 404) return null;
            if (!asset || code < 300 || code >= 400 || location == null) {
                if (code == 403 || code == 429) throw new IOException("GitHub временно ограничил запросы. Попробуй позже.");
                throw new IOException("GitHub вернул код " + code + ".");
            }
            url = new URL(url, location);
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null ||
                (url.getPort() != -1 && url.getPort() != 443) ||
                !("release-assets.githubusercontent.com".equals(url.getHost()) || "objects.githubusercontent.com".equals(url.getHost())))
                throw new IOException("GitHub вернул неожиданный адрес загрузки.");
        }
        throw new IOException("Слишком много перенаправлений при загрузке.");
    }
    private static JSONObject release(String address, boolean optional) throws Exception {
        HttpURLConnection conn = connection(address, false, optional);
        if (conn == null) return null;
        try (InputStream in = conn.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (output.size() + n > 512 * 1024) throw new IOException("Описание выпуска слишком большое.");
                output.write(buffer, 0, n);
            }
            return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        } finally { conn.disconnect(); }
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    private void download(String url, String version, long size, String digest) throws Exception {
        File target = UpdateFile.file(activity);
        File temp = File.createTempFile("book-update-", ".part", activity.getCacheDir());
        try {
            HttpURLConnection conn = connection(url, true, false);
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (InputStream input = conn.getInputStream(); OutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[65536];
                long total = 0; int n, previous = -1;
                while ((n = input.read(buffer)) != -1) {
                    total += n;
                    if (total > size) throw new IOException("Размер загрузки превышает размер выпуска.");
                    output.write(buffer, 0, n); sha.update(buffer, 0, n);
                    int step = (int)(20 * total / size);
                    if (step != previous) { previous = step; post("Скачиваем версию " + version + " · " + step * 5 + "%", true); }
                }
                if (total != size || !hex(sha.digest()).equals(digest)) throw new IOException("Контрольная сумма загрузки не совпала.");
            } finally { conn.disconnect(); }
            validate(temp, version);
            java.nio.file.Files.move(temp.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            if (!prefs.edit().remove(INSTALL_TASK).putString("version", version).putString("digest", digest).putLong("size", size).commit())
                throw new IOException("Не удалось сохранить сведения об обновлении.");
        } finally { temp.delete(); }
    }
    private boolean officialSigner(PackageInfo info) throws Exception {
        if (info.signingInfo == null || info.signingInfo.hasMultipleSigners()) return false;
        for (Signature signature : info.signingInfo.getSigningCertificateHistory())
            if (BuildConfig.STABLE_CERT_SHA256.equals(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())))) return true;
        return false;
    }
    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
    }
    private void validate(File apk, String version) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo installed = installed();
        PackageInfo next = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (next == null || !installed.packageName.equals(next.packageName) || !version.equals(next.versionName) ||
            next.getLongVersionCode() <= installed.getLongVersionCode())
            throw new IOException("Имя приложения, подпись или номер версии APK не совпали с выпуском.");
        if (!officialSigner(installed) || !officialSigner(next) ||
                !new HashSet<>(Arrays.asList(installed.signingInfo.getApkContentsSigners())).equals(
                 new HashSet<>(Arrays.asList(next.signingInfo.getApkContentsSigners()))))
            throw new IOException("Подпись APK не совпадает с установленной версией.");
    }
    void start(boolean receiveBetas) {
        if (busy) return;
        state("Проверяем обновления…", true);
        new Thread(() -> {
            try {
                String current = installed().versionName;
                UpdateRelease candidate = UpdateRelease.find(release(LATEST, false), false, current);
                if (receiveBetas) {
                    try {
                        UpdateRelease beta = UpdateRelease.find(release(BETA, true), true, current);
                        if (beta != null && (candidate == null || UpdateRelease.compare(beta.version, candidate.version) > 0))
                            candidate = beta;
                    } catch (Exception unavailable) {
                        if (candidate == null) throw unavailable;
                    }
                }
                if (candidate == null) {
                    post(!receiveBetas && current.contains("_b.")
                        ? "Пока нет стабильной версии новее установленной беты." : "У тебя последняя доступная версия.", false);
                    return;
                }
                UpdateRelease next = candidate;
                activity.runOnUiThread(() -> offerDownload(next.url, next.version, next.size, next.digest));
            } catch (Exception error) { post("Обновление не завершено. " + reason(error), false); }
        }, "book-update-check").start();
    }
    private void offerDownload(String url, String version, long size, String digest) {
        if (!alive()) return;
        state("Доступна версия " + version + ".", true);
        String details = "Sharpwise " + version + " · " + Formatter.formatShortFileSize(activity, size);
        if (version.contains("_b.")) details += "\nЭто тестовая сборка.";
        else if (BuildConfig.VERSION_NAME.contains("_b.")) details += "\nСтабильный выпуск заменит тестовую сборку.";
        new AlertDialog.Builder(activity)
            .setTitle("Скачать обновление?")
            .setMessage(details)
            .setNegativeButton("Отмена", (dialog, which) -> dialog.cancel())
            .setOnCancelListener(dialog -> state("Загрузка отменена.", false))
            .setPositiveButton("Скачать", (dialog, which) -> {
                state("Скачиваем версию " + version + "…", true);
                new Thread(() -> {
                    try {
                        download(url, version, size, digest);
                        activity.runOnUiThread(() -> { if (alive()) requestInstall(); });
                    } catch (Exception error) { post("Обновление не завершено. " + reason(error), false); }
                }, "book-update-download").start();
            })
            .show();
    }
    private static String reason(Exception error) {
        if (error instanceof UnknownHostException || error instanceof SocketTimeoutException || error instanceof ConnectException)
            return "Проверь подключение к интернету и попробуй ещё раз.";
        return error.getMessage() != null ? error.getMessage() : "Повтори попытку.";
    }
    private void requestInstall() {
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                state("Разреши учебнику устанавливать обновления и вернись в приложение.", true);
                activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())), PERMISSION);
            } else launchInstaller();
        } catch (RuntimeException error) { state("Системные настройки установки недоступны.", false); }
    }
    private void launchInstaller() {
        try {
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(UpdateFile.URI)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("CSharpBook.apk", UpdateFile.URI));
            // Keep the installer's "Open" action available if Android closes our task.
            if (!prefs.edit().putInt(INSTALL_TASK, activity.getTaskId()).commit()) {
                state("Не удалось сохранить состояние установки. Попробуй ещё раз.", false);
                return;
            }
            state("Подтверди обновление в окне Android.", true);
            activity.startActivityForResult(intent, INSTALL);
        } catch (RuntimeException error) {
            prefs.edit().remove(INSTALL_TASK).apply();
            state("Не удалось открыть установщик Android.", false);
        }
    }
    void result(int request, int result) {
        if (request == INSTALL) {
            String version = prefs.getString("version", "");
            activity.revokeUriPermission(UpdateFile.URI, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // onCreate may already have recognized the new version and cleared the receipt.
            if (version.isEmpty()) return;
            state(BuildConfig.VERSION_NAME.equals(version) ? "Версия " + version + " установлена." : "Установка не завершена. Можно попробовать ещё раз.", false);
            prefs.edit().clear().apply(); UpdateFile.file(activity).delete();
        } else if (request == PERMISSION) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) { state("Разрешение на установку не получено.", false); return; }
            state("Проверяем APK перед установкой…", true);
            new Thread(() -> {
                try {
                    File apk = UpdateFile.file(activity);
                    String version = prefs.getString("version", "");
                    if (apk.length() != prefs.getLong("size", -1)) throw new IOException("Скачай файл повторно.");
                    MessageDigest sha = MessageDigest.getInstance("SHA-256");
                    try (InputStream input = new FileInputStream(apk)) {
                        byte[] buffer = new byte[65536]; int n;
                        while ((n = input.read(buffer)) != -1) sha.update(buffer, 0, n);
                    }
                    if (!hex(sha.digest()).equals(prefs.getString("digest", ""))) throw new IOException("Контрольная сумма загрузки не совпала.");
                    validate(apk, version);
                    activity.runOnUiThread(() -> { if (alive()) launchInstaller(); });
                } catch (Exception e) { post("Обновление не завершено. " + reason(e), false); }
            }, "book-confirm-update").start();
        }
    }
}
