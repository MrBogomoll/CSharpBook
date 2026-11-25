package ru.csharpbook.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import java.io.*;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** SAF connections are scoped to explicitly chosen documents. A failed pairing leaves the prior connection intact. */
final class SyncDocuments {
    private static final int READ = Intent.FLAG_GRANT_READ_URI_PERMISSION;
    private static final int WRITE = READ | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final Pattern DEVICE = Pattern.compile("[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}");
    private final ContentResolver resolver;
    private final File journal;
    private final CloudCredentials credentials;
    private final CloudLogin login;

    SyncDocuments(BookActivity activity, CloudCredentials credentials, CloudLogin login) {
        this.resolver = activity.getContentResolver();
        this.journal = activity.getNoBackupFilesDir();
        this.credentials = credentials;
        this.login = login;
    }

    private static Map<Uri, Integer> grants(JSONObject connection) {
        Map<Uri, Integer> result = new HashMap<>();
        if ("folder".equals(connection.optString("provider"))) result.put(Uri.parse(connection.optString("tree")), WRITE);
        if ("documents".equals(connection.optString("provider"))) {
            result.put(Uri.parse(connection.optString("incoming")), READ);
            result.put(Uri.parse(connection.optString("outgoing")), WRITE);
        }
        return result;
    }
    private Map<Uri, Integer> currentGrants() {
        try { return grants(credentials.read()); }
        catch (Exception e) { return new HashMap<>(); }
    }
    private void releaseUnused(Map<Uri,Integer> old, Map<Uri,Integer> keep) {
        for (Map.Entry<Uri,Integer> grant : old.entrySet()) {
            int flags = grant.getValue() & ~keep.getOrDefault(grant.getKey(), 0);
            if (flags != 0) {
                try { resolver.releasePersistableUriPermission(grant.getKey(), flags); }
                catch (SecurityException ignored) { /* Already revoked. */ }
            }
        }
    }
    void saveConnection(JSONObject data) throws Exception {
        Map<Uri,Integer> previous = currentGrants();
        credentials.save(data);
        releaseUnused(previous, grants(data));
    }
    void disconnect() throws Exception {
        Map<Uri,Integer> previous = currentGrants();
        credentials.clear();
        releaseUnused(previous, new HashMap<>());
    }
    private static String device(JSONObject request) throws Exception {
        String id = request.getString("deviceId");
        if (!DEVICE.matcher(id).matches()) throw new CloudLogin.UserError("Некорректный идентификатор устройства.");
        return id;
    }
    Object sync(JSONObject request, String op, String provider) throws Exception {
        try {
            if ("connect".equals(op)) {
                connect(request, provider);
                return JSONObject.NULL;
            }
            JSONObject binding = credentials.read();
            if (!provider.equals(binding.optString("provider"))) throw new CloudLogin.UserError("Сначала подключи папку или файлы диска.");
            if ("folder".equals(provider)) return folder(request, op, Uri.parse(binding.getString("tree")));
            return pair(request, op, binding);
        } catch (SecurityException e) { throw new CloudLogin.UserError("Доступ к файлам отозван. Подключи их ещё раз."); }
        catch (FileNotFoundException e) { throw new CloudLogin.UserError("Файл или папка недоступны. Проверь подключение к диску и выбранные файлы."); }
    }
    private void connect(JSONObject request, String provider) throws Exception {
        Map<Uri,Integer> acquired = new HashMap<>();
        try {
            JSONObject binding = new JSONObject().put("provider", provider);
            if ("folder".equals(provider)) {
                Uri folder = login.chooseFolder();
                acquired.put(folder, WRITE);
                FolderFiles.list(resolver, folder);
                binding.put("tree", folder.toString());
            } else {
                String owner = device(request);
                Uri incoming = login.chooseReplica(null, false, null);
                acquired.put(incoming, READ);
                String peer = DocumentPair.verifyIncoming(resolver, incoming, owner);
                boolean create = login.createPhoneDocument();
                Uri outgoing = login.chooseReplica("csharpbook-v1-" + owner + ".json", create, incoming);
                acquired.put(outgoing, WRITE);
                if (incoming.equals(outgoing)) throw new CloudLogin.UserError("Выбери отдельный файл для телефона.");
                JSONObject current = credentials.read();
                if ("documents".equals(current.optString("provider")) && owner.equals(current.optString("owner")) &&
                    outgoing.toString().equals(current.optString("outgoing")))
                    DocumentPair.recover(resolver, outgoing, owner, journal);
                boolean empty = DocumentPair.verifyOutgoing(resolver, outgoing, owner, create);
                binding.put("incoming", incoming.toString()).put("peer", peer)
                    .put("outgoing", outgoing.toString()).put("owner", owner).put("newEmpty", empty);
            }
            saveConnection(binding);
        } catch (Exception e) {
            releaseUnused(acquired, currentGrants());
            throw e;
        }
    }
    private Object folder(JSONObject request, String op, Uri directory) throws Exception {
        if ("list".equals(op)) return FolderFiles.list(resolver, directory);
        String id = device(request);
        if ("read".equals(op)) {
            Object data = FolderFiles.read(resolver, directory, id);
            return data == null ? JSONObject.NULL : data;
        }
        if ("write".equals(op)) {
            FolderFiles.write(resolver, directory, id, request.getJSONObject("snapshot"));
            return JSONObject.NULL;
        }
        throw new CloudLogin.UserError("Неизвестная операция синхронизации.");
    }
    private Object pair(JSONObject request, String op, JSONObject binding) throws Exception {
        String owner = binding.getString("owner"), peer = binding.getString("peer");
        Uri outgoing = Uri.parse(binding.getString("outgoing"));
        boolean empty = binding.optBoolean("newEmpty");
        if ("list".equals(op)) {
            DocumentPair.recover(resolver, outgoing, owner, journal);
            JSONArray ids = new JSONArray().put(peer);
            if (empty) {
                if (DocumentPair.read(resolver, outgoing, owner, true) == null) return ids;
                credentials.save(binding.put("newEmpty", false));
            }
            return ids.put(owner);
        }
        String id = device(request);
        if ("read".equals(op)) {
            if (peer.equals(id)) return DocumentPair.read(resolver, Uri.parse(binding.getString("incoming")), peer, false);
            if (!owner.equals(id)) return JSONObject.NULL;
            DocumentPair.recover(resolver, outgoing, owner, journal);
            JSONObject data = DocumentPair.read(resolver, outgoing, owner, empty);
            if (empty && data != null) credentials.save(binding.put("newEmpty", false));
            return data == null ? JSONObject.NULL : data;
        }
        if ("write".equals(op)) {
            if (!owner.equals(id)) throw new CloudLogin.UserError("Этот файл закреплён за другим устройством. Подключи файлы телефона ещё раз.");
            DocumentPair.write(resolver, outgoing, owner, request.getJSONObject("snapshot"), journal, empty);
            if (empty) credentials.save(binding.put("newEmpty", false));
            return JSONObject.NULL;
        }
        throw new CloudLogin.UserError("Неизвестная операция синхронизации.");
    }
    Object progressFile(JSONObject request, boolean export) throws Exception {
        final int limit = 8 * 1024 * 1024;
        byte[] content = export ? request.getJSONObject("snapshot").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8) : null;
        if (content != null && content.length > limit) throw new CloudLogin.UserError("Файл прогресса превышает 8 МБ.");
        Uri document = login.chooseProgressFile(export);
        if (document == null) return export ? Boolean.FALSE : JSONObject.NULL;
        if (export) {
            try (OutputStream out = resolver.openOutputStream(document, "wt")) {
                if (out == null) throw new IOException();
                out.write(content);
            } catch (IOException | SecurityException e) { throw new CloudLogin.UserError("Не удалось записать файл прогресса."); }
            return JSONObject.NULL;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream in = resolver.openInputStream(document)) {
            if (in == null) throw new IOException();
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (bytes.size() + n > limit) throw new CloudLogin.UserError("Файл прогресса превышает 8 МБ.");
                bytes.write(buffer, 0, n);
            }
        } catch (CloudLogin.UserError e) { throw e; }
        catch (IOException | SecurityException e) { throw new CloudLogin.UserError("Не удалось прочитать файл прогресса."); }
        try {
            org.json.JSONTokener json = new org.json.JSONTokener(bytes.toString("UTF-8"));
            Object value = json.nextValue();
            if (!(value instanceof JSONObject) || json.nextClean() != 0) throw new JSONException("object");
            return value;
        } catch (JSONException e) { throw new CloudLogin.UserError("Выбери JSON-файл прогресса учебника."); }
    }
}
