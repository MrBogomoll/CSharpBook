package ru.csharpbook.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Account binding and Yandex access token. Google owns its token cache. */
final class CloudCredentials {
    private static final String KEY = "csharpbook-cloud-v1";
    private final SharedPreferences prefs;
    CloudCredentials(Context context) { prefs = context.getSharedPreferences(KEY, Context.MODE_PRIVATE); }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY, null);
        if (existing != null) return existing;
        if (!create) throw new GeneralSecurityException("Ключ доступа недоступен. Подключи диск заново.");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    synchronized JSONObject read() throws Exception {
        String data = prefs.getString("data", null);
        if (data == null) return new JSONObject();
        byte[] iv = Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
    }
    synchronized void save(JSONObject data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] encrypted = cipher.doFinal(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (!prefs.edit().putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
            throw new IOException("Не удалось сохранить подключение на телефоне.");
    }
    synchronized void clear() throws IOException {
        if (!prefs.edit().clear().commit()) throw new IOException("Не удалось отключить облако.");
    }
}
