package ru.csharpbook.reader;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoHTTPD.Response.Status;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

final class BookServer extends NanoHTTPD {
    private final AssetManager assets;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Box> readers = new HashMap<>(), writers = new HashMap<>();

    private static BookServer shared;
    private static int clients;
    static synchronized BookServer acquire(android.content.Context context) throws IOException {
        if (shared == null) {
            android.content.SharedPreferences prefs = context.getSharedPreferences("book",android.content.Context.MODE_PRIVATE);
            BookServer candidate = new BookServer(context.getAssets(),prefs.getInt("port",0));
            try { candidate.start(15000,true); }
            catch (IOException e) { candidate.stop(); throw e; }
            prefs.edit().putInt("port",candidate.getListeningPort()).apply();
            shared = candidate;
        }
        clients++;
        return shared;
    }
    static synchronized void release(BookServer instance) {
        if (shared == instance && --clients == 0) {
            shared.stop();
            shared = null;
        }
    }
    private BookServer(AssetManager assets, int port) {
        super("127.0.0.1", port);
        this.assets = assets;
    }
    String origin() { return "http://127.0.0.1:" + getListeningPort(); }

    @Override public Response serve(IHTTPSession session) {
        Response response;
        String path = session.getUri();
        try {
            if (!("127.0.0.1:" + getListeningPort()).equals(session.getHeaders().get("host"))) {
                response = empty(Status.FORBIDDEN);
            } else if (path.startsWith("/api/book-input")) {
                response = mailbox(session, path);
            } else if (session.getMethod() != Method.GET && session.getMethod() != Method.HEAD) {
                response = empty(Status.METHOD_NOT_ALLOWED);
            } else {
                String asset = path.equals("/") ? "index.html" : path.substring(1);
                if (!asset.matches("[a-zA-Z0-9_.@/-]+") || asset.contains("..") || asset.startsWith("/")) response = empty(Status.NOT_FOUND);
                else {
                    AssetFileDescriptor fd = assets.openFd("www/" + asset);
                    long size = fd.getLength();
                    InputStream in = fd.createInputStream();
                    response = newFixedLengthResponse(Status.OK, mime(asset), in, size);
                }
            }
        } catch (IOException | IllegalArgumentException e) { response = empty(Status.NOT_FOUND); }
        response.addHeader("X-Content-Type-Options","nosniff");
        response.addHeader("Cross-Origin-Opener-Policy","same-origin");
        response.addHeader("Cross-Origin-Embedder-Policy","require-corp");
        if (path.startsWith("/api/book-input/read/")) {
            response.addHeader("Access-Control-Allow-Origin","*");
            response.addHeader("Cross-Origin-Resource-Policy","cross-origin");
        } else response.addHeader("Cross-Origin-Resource-Policy","same-origin");
        response.addHeader("Cache-Control","no-store");
        return response;
    }
    private String mime(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "html": return "text/html; charset=utf-8";
            case "js": case "mjs": return "text/javascript; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "json": return "application/json; charset=utf-8";
            case "webmanifest": return "application/manifest+json";
            case "png": return "image/png";
            case "svg": return "image/svg+xml";
            case "zip": return "application/zip";
            case "txt": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }
    private Response empty(Status status) { return newFixedLengthResponse(status,"text/plain",""); }
    private String key() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        StringBuilder result = new StringBuilder(48);
        final char[] hex = "0123456789ABCDEF".toCharArray();
        for (byte b : bytes) result.append(hex[(b >> 4) & 15]).append(hex[b & 15]);
        return result.toString();
    }
    private static final class Box {
        final String read, write;
        final ArrayBlockingQueue<String> lines = new ArrayBlockingQueue<>(16);
        boolean closed;
        long used = android.os.SystemClock.elapsedRealtime();
        Box(String read, String write) { this.read=read; this.write=write; }
    }
    private void forget(Box b) { b.closed = true; readers.remove(b.read); writers.remove(b.write); }

    private Response mailbox(IHTTPSession request, String path) throws IOException {
        Method method = request.getMethod();
        boolean read = path.startsWith("/api/book-input/read/") && method == Method.GET;
        Map<String,String> headers = request.getHeaders();
        if (!read && (!"1".equals(headers.get("x-book-input")) ||
                (headers.containsKey("origin") && !origin().equals(headers.get("origin"))))) return empty(Status.FORBIDDEN);
        if (method == Method.POST && path.equals("/api/book-input")) {
            synchronized (readers) {
                long cutoff = android.os.SystemClock.elapsedRealtime() - 600_000;
                for (Box b : readers.values().toArray(new Box[0])) if (b.used < cutoff) forget(b);
                if (readers.size() >= 64) return empty(Status.TOO_MANY_REQUESTS);
                Box b = new Box(key(),key()); readers.put(b.read,b); writers.put(b.write,b);
                return newFixedLengthResponse(Status.OK, "application/json", "{\"read\":\"" + b.read + "\",\"write\":\"" + b.write + "\"}");
            }
        }
        boolean write = path.startsWith("/api/book-input/write/") && (method == Method.DELETE || method == Method.POST);
        if (!read && !write) return empty(Status.NOT_FOUND);
        Box b;
        synchronized (readers) {
            b = (read ? readers : writers).get(path.substring(path.lastIndexOf('/') + 1));
            if (b == null) return empty(Status.NOT_FOUND);
            b.used = android.os.SystemClock.elapsedRealtime();
            if (method == Method.DELETE) { forget(b); return empty(Status.NO_CONTENT); }
        }
        if (read) {
            try {
                String line = b.lines.poll(2,TimeUnit.SECONDS);
                if (line != null) return newFixedLengthResponse(Status.OK,"text/plain; charset=utf-8",line);
                synchronized (readers) { return empty(b.closed ? Status.GONE : Status.NO_CONTENT); }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); return empty(Status.GONE); }
        }
        int len = Integer.parseInt(headers.getOrDefault("content-length","-1"));
        if (len < 0 || len > 65536) return empty(Status.PAYLOAD_TOO_LARGE);
        byte[] bytes = new byte[len]; new DataInputStream(request.getInputStream()).readFully(bytes);
        return empty(b.lines.offer(new String(bytes,StandardCharsets.UTF_8)) ? Status.NO_CONTENT : Status.TOO_MANY_REQUESTS);
    }
}
