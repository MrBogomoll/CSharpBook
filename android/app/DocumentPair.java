package ru.csharpbook.reader;

import android.content.ContentResolver;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.AtomicFile;
import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A SAF open-document grant grants access to just one file. The peer's document is never written. */
final class DocumentPair {
    private static final String UUID_PATTERN = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    private static final Pattern NAME = Pattern.compile("csharpbook-v1-(" + UUID_PATTERN + ")\\.json");
    private static final int LIMIT = 8 * 1024 * 1024;
    private static final int MAGIC = 0x43535031; // CSP1, local journal for a single pending document write.

    static final class UserError extends IOException {
        UserError(String message) { super(message); }
    }

    static String verifyIncoming(ContentResolver r, Uri uri, String mine) throws Exception {
        requireId(mine);
        String peer = document(r, uri, false);
        if (mine.equals(peer)) throw new UserError("Выбери входящий файл другого устройства.");
        parse(bytes(r, uri), peer);
        return peer;
    }

    static boolean verifyOutgoing(ContentResolver r, Uri uri, String mine, boolean allowNewEmpty) throws Exception {
        checkOwner(r, uri, mine, true);
        byte[] data = bytes(r, uri);
        if (data.length == 0 && allowNewEmpty) return true;
        parse(data, mine);
        return false;
    }

    static JSONObject read(ContentResolver r, Uri uri, String device, boolean allowEmpty) throws Exception {
        checkOwner(r, uri, device, false);
        byte[] data = bytes(r, uri);
        if (allowEmpty && data.length == 0) return null;
        return parse(data, device);
    }

    static synchronized void write(ContentResolver r, Uri uri, String mine, JSONObject snapshot, File privateDir, boolean allowEmpty) throws Exception {
        checkOwner(r, uri, mine, true);
        byte[] next = snapshot.toString().getBytes(StandardCharsets.UTF_8);
        if (next.length > LIMIT) throw tooLarge();
        parse(next, mine);
        AtomicFile file = journalFile(uri, mine, privateDir);
        recoverPending(r, uri, mine, file);
        byte[] old = bytes(r, uri);
        if (old.length != 0 || !allowEmpty) parse(old, mine);
        if (Arrays.equals(next, old)) return;
        Pending pending = new Pending(old, next);
        save(file, uri, mine, pending);
        // Verify the recoverable copy before opening a provider stream in truncation mode.
        Pending saved = load(file, uri, mine);
        if (saved == null || !Arrays.equals(old, saved.before) || !Arrays.equals(next, saved.after)) throw journalError();
        complete(r, uri, mine, file, saved);
    }

    static synchronized void recover(ContentResolver r, Uri uri, String mine, File privateDir) throws Exception {
        checkOwner(r, uri, mine, true);
        recoverPending(r, uri, mine, journalFile(uri, mine, privateDir));
    }

    private static void recoverPending(ContentResolver r, Uri uri, String mine, AtomicFile file) throws Exception {
        Pending pending = load(file, uri, mine);
        if (pending != null) complete(r, uri, mine, file, pending);
    }

    private static void complete(ContentResolver r, Uri uri, String mine, AtomicFile file, Pending pending) throws Exception {
        byte[] actual = bytes(r, uri);
        if (!Arrays.equals(actual, pending.after)) {
            // Only replay over the original bytes or a strict prefix left by our interrupted "wt" write.
            if (!Arrays.equals(actual, pending.before) && !isPrefix(actual, pending.after)) {
                throw new UserError("Исходящий файл изменился во время записи. Исходный файл и локальная копия сохранены.");
            }
            try (OutputStream out = r.openOutputStream(uri, "wt")) {
                if (out == null) throw new UserError("Не удалось открыть исходящий файл для записи.");
                out.write(pending.after);
            }
            checkOwner(r, uri, mine, true);
            if (!Arrays.equals(bytes(r, uri), pending.after)) throw new UserError("Диск не подтвердил запись. Локальная копия сохранена для повторной попытки.");
        }
        file.delete();
    }

    private static boolean isPrefix(byte[] part, byte[] whole) {
        if (part.length >= whole.length) return false;
        for (int i = 0; i < part.length; i++) if (part[i] != whole[i]) return false;
        return true;
    }

    private static void requireId(String id) throws UserError {
        if (id == null || !id.matches(UUID_PATTERN)) throw new UserError("Недопустимый идентификатор устройства.");
    }

    private static void checkOwner(ContentResolver r, Uri uri, String expected, boolean write) throws Exception {
        requireId(expected);
        if (!expected.equals(document(r, uri, write))) throw new UserError("Имя файла не соответствует выбранному устройству.");
    }

    private static String document(ContentResolver r, Uri uri, boolean write) throws Exception {
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null) throw grantError();
        boolean granted = false;
        for (UriPermission grant : r.getPersistedUriPermissions()) {
            if (uri.equals(grant.getUri()) && grant.isReadPermission() && (!write || grant.isWritePermission())) { granted = true; break; }
        }
        if (!granted) throw grantError();
        String id;
        try { id = DocumentsContract.getDocumentId(uri); }
        catch (IllegalArgumentException e) { throw grantError(); }
        String[] fields = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS};
        try (Cursor row = r.query(uri, fields, null, null, null)) {
            if (row == null || !row.moveToFirst() || !id.equals(row.getString(0)) ||
                Document.MIME_TYPE_DIR.equals(row.getString(2)) || row.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING)) throw grantError();
            if (write && (row.getInt(3) & Document.FLAG_SUPPORTS_WRITE) == 0) throw new UserError("Сервис хранения разрешает только чтение этого файла.");
            String name = row.getString(1);
            Matcher match = NAME.matcher(name == null ? "" : name);
            if (!match.matches()) throw new UserError("Нужно исходное имя файла учебника с полным идентификатором устройства.");
            return match.group(1);
        }
    }

    private static JSONObject parse(byte[] data, String expected) throws UserError {
        try {
            String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(data)).toString();
            try (JsonReader reader = new JsonReader(new StringReader(text))) {
                if (reader.peek() != JsonToken.BEGIN_OBJECT) throw new IOException();
                reader.skipValue();
                if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException();
            }
            JSONObject doc = new JSONObject(text);
            if (Integer.valueOf(1).equals(doc.opt("format")) && expected.equals(doc.opt("deviceId")) &&
                    doc.opt("records") instanceof JSONObject) return doc;
        } catch (Exception ignored) { }
        throw new UserError("Файл повреждён или его содержимое относится к другому устройству.");
    }

    private static byte[] bytes(ContentResolver r, Uri uri) throws IOException {
        try (InputStream in = r.openInputStream(uri)) {
            if (in == null) throw grantError();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (n > LIMIT - out.size()) throw tooLarge();
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static AtomicFile journalFile(Uri uri, String mine, File privateDir) throws Exception {
        String identity = uri.toString() + "\n" + mine;
        byte[] hash = digest(identity.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte b : hash) key.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
        return new AtomicFile(new File(privateDir, "csharpbook-pair-" + key + ".pending"));
    }

    private static final class Pending {
        final byte[] before, after;
        Pending(byte[] before, byte[] after) { this.before = before; this.after = after; }
    }

    private static void save(AtomicFile file, Uri uri, String mine, Pending pending) throws Exception {
        FileOutputStream stream = file.startWrite();
        try {
            DataOutputStream out = new DataOutputStream(stream);
            out.writeInt(MAGIC);
            out.writeUTF(uri.toString());
            out.writeUTF(mine);
            for (byte[] value : new byte[][]{pending.before, pending.after}) {
                out.writeInt(value.length);
                out.write(digest(value));
                out.write(value);
            }
            out.flush();
            file.finishWrite(stream);
        } catch (Exception e) {
            file.failWrite(stream);
            throw e;
        }
    }

    private static Pending load(AtomicFile file, Uri uri, String mine) throws Exception {
        FileInputStream stream;
        try { stream = file.openRead(); } catch (FileNotFoundException e) {
            if (file.getBaseFile().exists()) throw journalError();
            return null;
        }
        try (DataInputStream in = new DataInputStream(stream)) {
            if (in.readInt() != MAGIC || !uri.toString().equals(in.readUTF()) || !mine.equals(in.readUTF())) throw journalError();
            byte[] before = journalBytes(in);
            byte[] after = journalBytes(in);
            if (in.read() != -1) throw journalError();
            if (before.length != 0) parse(before, mine);
            parse(after, mine);
            return new Pending(before, after);
        }
    }

    private static byte[] journalBytes(DataInputStream in) throws Exception {
        int n = in.readInt();
        if (n < 0 || n > LIMIT) throw journalError();
        byte[] expected = new byte[32];
        in.readFully(expected);
        byte[] data = new byte[n];
        in.readFully(data);
        if (!MessageDigest.isEqual(expected, digest(data))) throw journalError();
        return data;
    }

    private static byte[] digest(byte[] bytes) throws Exception { return MessageDigest.getInstance("SHA-256").digest(bytes); }
    private static UserError tooLarge() { return new UserError("Файл устройства превышает 8 МБ."); }
    private static UserError grantError() { return new UserError("Не удалось открыть документ. Выбери файл заново в системном окне."); }
    private static UserError journalError() { return new UserError("Не удалось проверить локальную копию. Облачный файл сохранён без изменений."); }
}
