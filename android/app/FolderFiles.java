package ru.csharpbook.reader;

import android.content.ContentResolver;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The folder belongs to the user; only exact files owned by the current writer can be rotated. */
final class FolderFiles {
    private static final String UUID_PATTERN = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    private static final Pattern SNAPSHOT = Pattern.compile("csharpbook-v1-(" + UUID_PATTERN + ")\\.json(?:\\.previous)?");
    private static final int LIMIT = 8 * 1024 * 1024;
    private static final int MAX_COPIES = 32;
    private static final String[] FIELDS = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS};
    private static final String UNSUPPORTED = "В этой папке нельзя безопасно заменить файл. Выбери другую папку или используй экспорт и импорт.";

    static final class UserError extends IOException {
        UserError(String message) { super(message); }
    }

    static JSONArray list(ContentResolver r, Uri tree) throws Exception {
        Directory dir = new Directory(r, tree);
        TreeSet<String> devices = new TreeSet<>();
        for (Entry entry : dir.children()) {
            Matcher match = SNAPSHOT.matcher(entry.name);
            if (match.matches()) devices.add(match.group(1));
        }
        return new JSONArray(devices);
    }

    static Object read(ContentResolver r, Uri tree, String deviceId) throws Exception {
        String name = filename(deviceId);
        Directory dir = new Directory(r, tree);
        for (int attempt = 0; ; attempt++) {
            List<Entry> children = dir.children();
            List<Entry> files = matching(children, name);
            if (files.isEmpty()) files = matching(children, name + ".previous");
            if (files.isEmpty()) return null;
            JSONArray snapshots = new JSONArray();
            int remaining = LIMIT - (files.size() > 1 ? files.size() + 1 : 0);
            try {
                for (Entry file : files) {
                    byte[] data = dir.bytes(file.uri, remaining);
                    snapshots.put(parse(deviceId, data));
                    remaining -= data.length;
                }
                return files.size() == 1 ? snapshots.getJSONObject(0) : snapshots;
            } catch (FileNotFoundException changedDuringRead) {
                // Another instance may have replaced the file after directory enumeration.
                if (attempt != 0) throw changedDuringRead;
            }
        }
    }

    static synchronized void write(ContentResolver r, Uri tree, String deviceId, JSONObject snapshot) throws Exception {
        String name = filename(deviceId);
        if (!deviceId.equals(snapshot.optString("deviceId")) || snapshot.optInt("format") != 1 ||
                !(snapshot.opt("records") instanceof JSONObject)) throw invalidFile();
        byte[] data = snapshot.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > LIMIT) throw tooLarge();
        Directory dir = new Directory(r, tree);
        List<Entry> children = dir.children();
        List<Entry> current = matching(children, name);
        List<Entry> fallback = matching(children, name + ".previous");

        // Preserve independent copies with the same display name. The sync engine reads all of them.
        Entry original = current.isEmpty() ? null : current.get(0);
        if (original != null) {
            parse(deviceId, dir.bytes(original.uri, LIMIT));
            original.requireFlag(Document.FLAG_SUPPORTS_RENAME);
        }
        if (fallback.size() > 1) throw new UserError("В папке несколько файлов восстановления одного устройства. Сохрани их и выбери другую папку.");
        Entry previous = fallback.isEmpty() ? null : fallback.get(0);
        if (previous != null) parse(deviceId, dir.bytes(previous.uri, LIMIT));

        String stageName = "csharpbook-stage-" + UUID.randomUUID() + ".bin";
        Uri stage = DocumentsContract.createDocument(r, dir.root, "application/octet-stream", stageName);
        if (stage == null) throw new UserError(UNSUPPORTED);
        Uri rotated = null;
        Uri committed = null;
        boolean published = false;
        try {
            Entry temp = dir.document(stage);
            if (!stageName.equals(temp.name)) throw new UserError(UNSUPPORTED);
            temp.requireFlag(Document.FLAG_SUPPORTS_WRITE);
            temp.requireFlag(Document.FLAG_SUPPORTS_RENAME);
            temp.requireFlag(Document.FLAG_SUPPORTS_DELETE);
            try (OutputStream stream = r.openOutputStream(stage, "w")) {
                if (stream == null) throw new UserError(UNSUPPORTED);
                stream.write(data);
            }
            if (!Arrays.equals(data, dir.bytes(stage, LIMIT))) throw new UserError("Диск не подтвердил запись файла учебника.");
            if (original != null) {
                // A previous cleanup may have been interrupted. The verified canonical still exists.
                if (previous != null) {
                    previous.requireFlag(Document.FLAG_SUPPORTS_DELETE);
                    if (!DocumentsContract.deleteDocument(r, previous.uri)) throw new UserError(UNSUPPORTED);
                }
                rotated = dir.rename(original.uri, name + ".previous", name);
            }
            committed = dir.rename(stage, name, null);
            stage = null;
            if (!Arrays.equals(data, dir.bytes(committed, LIMIT))) throw new UserError("Диск не подтвердил содержимое сохранённого файла.");
            published = true;
        } finally {
            // The staging URI may no longer exist if a provider completed a rename before failing.
            if (stage != null) dir.discardTemporary(stage, stageName);
            if (committed != null && !published) {
                // Move our unverified output out of the canonical path before restoring the old file.
                try { dir.rename(committed, stageName, null); } catch (Exception ignored) { }
            }
            if (rotated != null && !published) dir.restoreIfMissing(rotated, name);
        }
        // A provider may sync renames asynchronously. A leftover recovery file is harmless and readable.
        Uri recovery = rotated != null ? rotated : previous != null ? previous.uri : null;
        if (recovery != null) dir.discardTemporary(recovery, name + ".previous");
    }

    private static String filename(String device) throws UserError {
        if (device == null || !device.matches(UUID_PATTERN)) throw new UserError("Недопустимый идентификатор устройства.");
        return "csharpbook-v1-" + device + ".json";
    }

    private static UserError invalidFile() { return new UserError("Файл в выбранной папке не соответствует устройству или формату учебника."); }
    private static UserError tooLarge() { return new UserError("Файлы синхронизации одного устройства превышают 8 МБ."); }

    private static JSONObject parse(String device, byte[] bytes) throws UserError {
        try {
            JSONObject data = new JSONObject(StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString());
            if (device.equals(data.optString("deviceId")) && data.optInt("format") == 1 && data.opt("records") instanceof JSONObject) return data;
        } catch (Exception ignored) { }
        throw invalidFile();
    }

    private static List<Entry> matching(List<Entry> entries, String name) throws UserError {
        List<Entry> result = new ArrayList<>();
        for (Entry file : entries) {
            if (file.name.equals(name)) result.add(file);
            if (result.size() > MAX_COPIES) throw new UserError("Слишком много копий данных одного устройства.");
        }
        result.sort((a,b) -> a.id.compareTo(b.id));
        return result;
    }

    private static final class Entry {
        final String id, name, mime;
        final int flags;
        final Uri uri;
        Entry(Uri tree, Cursor row) {
            id = row.getString(0);
            name = row.getString(1);
            mime = row.getString(2);
            flags = row.getInt(3);
            uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        }
        void requireFlag(int flag) throws UserError {
            if ((flags & flag) == 0) throw new UserError(UNSUPPORTED);
        }
    }

    private static final class Directory {
        final ContentResolver resolver;
        final Uri tree, root;
        final String rootId;
        Directory(ContentResolver r, Uri uri) throws Exception {
            resolver = r;
            if (uri == null || !"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri)) throw permissionError();
            tree = uri;
            boolean granted = false;
            for (UriPermission access : r.getPersistedUriPermissions()) {
                if (tree.equals(access.getUri()) && access.isReadPermission() && access.isWritePermission()) { granted = true; break; }
            }
            if (!granted) throw permissionError();
            rootId = DocumentsContract.getTreeDocumentId(tree);
            root = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
            Entry entry = document(root);
            if (!Document.MIME_TYPE_DIR.equals(entry.mime)) throw permissionError();
            entry.requireFlag(Document.FLAG_DIR_SUPPORTS_CREATE);
        }
        private UserError permissionError() { return new UserError("Выбери папку учебника заново и разреши чтение и запись."); }

        private Cursor query(Uri uri) throws IOException {
            Cursor rows = resolver.query(uri, FIELDS, null, null, null);
            if (rows == null) throw new UserError("Сервис хранения не смог открыть выбранную папку.");
            if (rows.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING) || rows.getExtras().getString(DocumentsContract.EXTRA_ERROR) != null) {
                rows.close();
                throw new UserError("Список файлов пока недоступен. Дождись загрузки папки и повтори синхронизацию.");
            }
            return rows;
        }

        Entry document(Uri uri) throws IOException {
            if (!tree.getAuthority().equals(uri.getAuthority()) || !DocumentsContract.isTreeUri(uri) ||
                    !rootId.equals(DocumentsContract.getTreeDocumentId(uri))) throw permissionError();
            try (Cursor row = query(uri)) {
                if (!row.moveToFirst()) throw new FileNotFoundException();
                Entry file = new Entry(tree, row);
                if (!file.id.equals(DocumentsContract.getDocumentId(uri))) throw permissionError();
                return file;
            }
        }

        List<Entry> children() throws IOException {
            List<Entry> files = new ArrayList<>();
            Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
            try (Cursor rows = query(uri)) {
                while (rows.moveToNext()) {
                    Entry entry = new Entry(tree, rows);
                    if (!Document.MIME_TYPE_DIR.equals(entry.mime) && entry.name != null && SNAPSHOT.matcher(entry.name).matches()) files.add(entry);
                }
            }
            return files;
        }

        byte[] bytes(Uri uri, int limit) throws IOException {
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) throw new FileNotFoundException();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (n > limit - out.size()) throw tooLarge();
                    out.write(buffer, 0, n);
                }
                return out.toByteArray();
            }
        }

        Uri rename(Uri uri, String target, String restoreName) throws Exception {
            Uri renamed = DocumentsContract.renameDocument(resolver, uri, target);
            if (renamed == null) throw new UserError(UNSUPPORTED);
            if (!target.equals(document(renamed).name)) {
                if (restoreName != null) restoreIfMissing(renamed, restoreName);
                throw new UserError("Сервис хранения изменил имя файла. Выбери другую папку или используй экспорт и импорт.");
            }
            return renamed;
        }

        void restoreIfMissing(Uri recovery, String name) {
            try {
                if (matching(children(), name).isEmpty()) DocumentsContract.renameDocument(resolver, recovery, name);
            } catch (Exception ignored) { } // The recovery file remains available on the next read.
        }

        void discardTemporary(Uri uri, String expected) {
            try {
                String current = document(uri).name;
                if (current.equals(expected)) {
                    DocumentsContract.deleteDocument(resolver, uri);
                }
            } catch (Exception ignored) { }
        }
    }
}
