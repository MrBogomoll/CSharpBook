package ru.csharpbook.reader;

import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

public final class UpdateFile extends ContentProvider {
    static final Uri URI = Uri.parse("content://" + BuildConfig.APPLICATION_ID + ".updates/CSharpBook.apk");
    static final String MIME = "application/vnd.android.package-archive";
    static File file(Context context) { return new File(context.getCacheDir(), "CSharpBook-update.apk"); }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return URI.equals(uri) ? MIME : null; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!URI.equals(uri) || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] columns, String where, String[] args, String order) {
        if (!URI.equals(uri)) throw new IllegalArgumentException();
        if (columns == null) columns = new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add("CSharpBook.apk");
            else if (OpenableColumns.SIZE.equals(column)) row.add(file(getContext()).length());
            else row.add(null);
        }
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues value) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String w, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String w, String[] a) { throw new UnsupportedOperationException(); }
}
