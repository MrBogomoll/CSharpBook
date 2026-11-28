package ru.csharpbook.reader;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class UpdateRelease {
    private static final String REPO = "https://github.com/MrBogomoll/Sharpwise";
    private static final String NUMBER = "(0|[1-9][0-9]{0,8})";
    private static final String BASE = NUMBER + "\\." + NUMBER + "\\." + NUMBER;
    private static final String BETA = "_b\\.([1-9][0-9]{0,8})";
    private static final Pattern STABLE_TAG = Pattern.compile("v?" + BASE);
    private static final Pattern VERSION = Pattern.compile(BASE + "(?:" + BETA + ")?");
    private static final Pattern BETA_APK = Pattern.compile("Sharpwise-(" + BASE + BETA + ")-Android\\.apk");

    final String version, url, digest;
    final long size;

    private UpdateRelease(String version, String url, String digest, long size) {
        this.version = version;
        this.url = url;
        this.digest = digest;
        this.size = size;
    }

    static int compare(String first, String second) throws IOException {
        Matcher a = VERSION.matcher(first), b = VERSION.matcher(second);
        if (!a.matches() || !b.matches()) throw new IOException("Неизвестный формат версии выпуска.");
        for (int i = 1; i <= 4; i++) {
            int difference = Integer.compare(number(a.group(i)), number(b.group(i)));
            if (difference != 0) return difference;
        }
        return 0;
    }

    private static int number(String value) {
        return value == null ? 0 : Integer.parseInt(value);
    }

    static UpdateRelease find(JSONObject release, boolean beta, String installed) throws IOException, JSONException {
        if (release == null) return null;
        String tag = release.getString("tag_name");
        if (release.getBoolean("draft") || release.getBoolean("prerelease") != beta ||
            !(beta ? "beta".equals(tag) : STABLE_TAG.matcher(tag).matches()) ||
            !(REPO + "/releases/tag/" + tag).equals(release.getString("html_url")))
            throw new IOException("Не удалось подтвердить источник или канал выпуска.");

        String stable = beta ? null : (tag.startsWith("v") ? tag.substring(1) : tag);
        if (!beta && compare(stable, installed) <= 0) return null;
        JSONArray assets = release.getJSONArray("assets");
        String selectedVersion = null;
        JSONObject selected = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String name = asset.getString("name");
            String version;
            if (beta) {
                Matcher apk = BETA_APK.matcher(name);
                if (!apk.matches()) continue;
                version = apk.group(1);
                if (compare(version, installed) <= 0) continue;
            } else {
                if (!name.equals("Sharpwise-" + stable + "-Android.apk") &&
                    !name.equals("CSharpBook-" + stable + "-Android.apk")) continue;
                version = stable;
            }
            int order = selected == null ? 1 : compare(version, selectedVersion);
            if (order == 0) throw new IOException("В выпуске несколько APK одной версии.");
            if (order > 0) {
                selectedVersion = version;
                selected = asset;
            }
        }
        if (selected == null) {
            if (beta) return null;
            throw new IOException("В выпуске пока нет APK.");
        }
        String url = REPO + "/releases/download/" + tag + "/" + selected.getString("name");
        String digest = selected.getString("digest");
        long size = selected.getLong("size");
        if (!url.equals(selected.getString("browser_download_url")) ||
            !digest.matches("sha256:[0-9a-f]{64}") || size < 1 || size > 512L * 1024 * 1024)
            throw new IOException("Не удалось подтвердить файл выпуска.");
        return new UpdateRelease(selectedVersion, url, digest.substring(7), size);
    }
}
