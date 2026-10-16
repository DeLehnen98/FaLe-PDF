package dev.fale.one;

// Photos and videos for the background backup: MediaStore listing after a checkpoint (same query and order as
// the FaleMedia plugin), metadata and thumbnails exactly in the shape the web app produces (one/js/media.js):
//
//   node meta  { v:1, name, takenAt, orientation?, w, h, gps?: {lat, lon, alt?}, exif?: {make, model, lens, iso,
//                fNumber, exposure, focal, focal35}, durationMs? (video), noPreview? }
//   thumb      JPEG, long edge 256 px, ≤ 120 KB (quality 0.72, lower if needed), EXIF orientation applied
//   preview    JPEG, long edge 1600 px (quality 0.84) – only when the original is larger than 1840 px, not a web
//              format (HEIC, RAW, video poster) or bigger than 2.5 MB
// Capture date, GPS and camera data stay on the device until they are encrypted (FaleCrypto.sealMeta).
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

final class BackupMedia {
    static final int THUMB_EDGE = 256, PREVIEW_EDGE = 1600, THUMB_MAX = 120 * 1024, PREVIEW_MAX = 7864320;

    private BackupMedia() {}

    // ---------------------------------------------------------------- permissions
    private static boolean granted(Context c, String p) { return c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }
    static boolean canRead(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            return granted(c, "android.permission.READ_MEDIA_IMAGES") || (Build.VERSION.SDK_INT >= 34 && granted(c, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"));
        }
        return granted(c, "android.permission.READ_EXTERNAL_STORAGE");
    }
    static boolean videoGranted(Context c) {
        if (Build.VERSION.SDK_INT >= 33) return granted(c, "android.permission.READ_MEDIA_VIDEO") || (Build.VERSION.SDK_INT >= 34 && granted(c, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"));
        return granted(c, "android.permission.READ_EXTERNAL_STORAGE");
    }
    static boolean locationGranted(Context c) { return Build.VERSION.SDK_INT < 29 || granted(c, "android.permission.ACCESS_MEDIA_LOCATION"); }

    // ---------------------------------------------------------------- listing
    static final class Item {
        long id, size, taken, modified, added;
        Uri uri, plainUri;
        String name, mime, kind;
    }
    static Uri collection(String kind) { return "video".equals(kind) ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI; }
    private static Cursor open(Context c, Uri uri, String[] projection, long since, long afterId, int limit) {
        ContentResolver cr = c.getContentResolver();
        String sel = "(date_added > ? OR (date_added = ? AND _id > ?))";
        String[] args = { String.valueOf(since), String.valueOf(since), String.valueOf(afterId) };
        String order = "date_added ASC, _id ASC";
        if (Build.VERSION.SDK_INT >= 26) {
            Bundle b = new Bundle();
            b.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
            b.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            b.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, order);
            if (limit > 0) b.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
            return cr.query(uri, projection, b, null);
        }
        return cr.query(uri, projection, sel, args, limit > 0 ? order + " LIMIT " + limit : order);
    }
    static int count(Context c, String kind, long since, long afterId) {
        try (Cursor cur = open(c, collection(kind), new String[] { "_id" }, since, afterId, 0)) {
            return cur == null ? 0 : cur.getCount();
        }
    }
    private static long longAt(Cursor c, int i, long fallback) { return i >= 0 && !c.isNull(i) ? c.getLong(i) : fallback; }
    static List<Item> list(Context c, String kind, long since, long afterId, int limit) {
        List<Item> out = new ArrayList<>();
        boolean original = Build.VERSION.SDK_INT >= 29 && locationGranted(c);
        Uri base = collection(kind);
        String[] projection = { "_id", "_display_name", "mime_type", "_size", "date_added", "date_modified", "datetaken" };
        try (Cursor cur = open(c, base, projection, since, afterId, limit)) {
            if (cur == null) return out;
            int iId = cur.getColumnIndex("_id"), iName = cur.getColumnIndex("_display_name"), iMime = cur.getColumnIndex("mime_type"),
                iSize = cur.getColumnIndex("_size"), iAdded = cur.getColumnIndex("date_added"), iMod = cur.getColumnIndex("date_modified"), iTaken = cur.getColumnIndex("datetaken");
            while (out.size() < limit && cur.moveToNext()) {
                Item it = new Item();
                it.id = longAt(cur, iId, -1);
                if (it.id < 0) continue;
                it.kind = kind;
                it.plainUri = ContentUris.withAppendedId(base, it.id);
                it.uri = it.plainUri;
                if (original) {
                    try { it.uri = MediaStore.setRequireOriginal(it.plainUri); } catch (Exception e) { it.uri = it.plainUri; }
                }
                it.added = longAt(cur, iAdded, 0);
                it.modified = longAt(cur, iMod, it.added);
                it.taken = longAt(cur, iTaken, 0);
                if (it.taken <= 0) it.taken = (it.modified > 0 ? it.modified : it.added) * 1000L;
                String name = iName >= 0 && !cur.isNull(iName) ? cur.getString(iName) : null;
                it.name = name == null || name.trim().isEmpty() ? ("video".equals(kind) ? "VID_" : "IMG_") + it.id : name;
                it.mime = iMime >= 0 && !cur.isNull(iMime) ? cur.getString(iMime) : "";
                it.size = longAt(cur, iSize, 0);
                out.add(it);
            }
        }
        Collections.sort(out, (a, b) -> a.added != b.added ? Long.compare(a.added, b.added) : Long.compare(a.id, b.id));
        return out;
    }

    // ---------------------------------------------------------------- MIME types (one/js/media.js EXT_MIME, media part)
    private static final String[][] EXT = {
        { "jpg", "image/jpeg" }, { "jpeg", "image/jpeg" }, { "png", "image/png" }, { "gif", "image/gif" }, { "webp", "image/webp" }, { "avif", "image/avif" },
        { "bmp", "image/bmp" }, { "heic", "image/heic" }, { "heif", "image/heif" }, { "tif", "image/tiff" }, { "tiff", "image/tiff" }, { "dng", "image/x-adobe-dng" },
        { "cr2", "image/x-canon-cr2" }, { "nef", "image/x-nikon-nef" }, { "arw", "image/x-sony-arw" }, { "mp4", "video/mp4" }, { "m4v", "video/mp4" },
        { "mov", "video/quicktime" }, { "webm", "video/webm" }, { "mkv", "video/x-matroska" }, { "3gp", "video/3gpp" }, { "avi", "video/x-msvideo" },
    };
    static String mimeOf(String name, String given) {
        if (given != null && !given.isEmpty() && !"application/octet-stream".equals(given)) return given;
        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot >= 0) {
            String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
            for (String[] e : EXT) if (e[0].equals(ext)) return e[1];
        }
        return given == null || given.isEmpty() ? "application/octet-stream" : given;
    }
    static boolean isMedia(String mime) { return mime.startsWith("image/") || mime.startsWith("video/"); }
    private static boolean browserImage(String m) { return m.matches("^image/(jpeg|png|gif|webp|avif|bmp)$"); }

    // ---------------------------------------------------------------- metadata (EXIF / MP4: BackupExif, a port of media.js)
    /** ISO time with the device's offset (media.js fallbackTakenAt). */
    static String fallbackTakenAt(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
        f.setTimeZone(TimeZone.getDefault());
        int off = TimeZone.getDefault().getOffset(ms) / 60000;
        return f.format(new Date(ms)) + (off >= 0 ? "+" : "-") + String.format(Locale.ROOT, "%02d:%02d", Math.abs(off) / 60, Math.abs(off) % 60);
    }

    // ---------------------------------------------------------------- derivatives
    static final class Image {
        byte[] bytes;
        int w, h;
    }
    static final class Derived {
        int w, h;
        long durationMs;
        Image thumb, preview;
    }
    private static byte[] jpeg(Bitmap b, int max, int quality) {
        byte[] out = null;
        for (int q = quality; q >= 35; q -= 12) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, q, buf);
            out = buf.toByteArray();
            if (max <= 0 || out.length <= max) break;
        }
        return out;
    }
    private static Image scaled(Bitmap src, int fullW, int fullH, int edge, int max, int quality) {
        double s = Math.min(1.0, edge / (double) Math.max(fullW, fullH));
        int w = Math.max(1, (int) Math.round(fullW * s)), h = Math.max(1, (int) Math.round(fullH * s));
        Bitmap b = src.getWidth() == w && src.getHeight() == h ? src : Bitmap.createScaledBitmap(src, w, h, true);
        try {
            Image img = new Image();
            img.bytes = jpeg(b, max, quality);
            img.w = w;
            img.h = h;
            return img;
        } finally {
            if (b != src) b.recycle();
        }
    }
    private static Bitmap oriented(Bitmap b, int orientation) {
        if (orientation <= 1) return b;
        Matrix m = new Matrix();
        switch (orientation) {
            case 2: m.setScale(-1, 1); break;
            case 3: m.setRotate(180); break;
            case 4: m.setScale(1, -1); break;
            case 5: m.setRotate(90); m.postScale(-1, 1); break;
            case 6: m.setRotate(90); break;
            case 7: m.setRotate(-90); m.postScale(-1, 1); break;
            case 8: m.setRotate(-90); break;
            default: return b;
        }
        Bitmap r = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        if (r != b) b.recycle();
        return r;
    }
    /** Thumbnail + preview of an image (EXIF orientation applied), or null when Android cannot decode it. */
    static Derived image(Context c, Uri uri, String mime, long size, int orientation) {
        ContentResolver cr = c.getContentResolver();
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) { BitmapFactory.decodeStream(in, null, o); } catch (Exception e) { return null; }
        int rw = o.outWidth, rh = o.outHeight;
        if (rw <= 0 || rh <= 0 || (double) rw * rh > 100e6) return null;
        boolean swap = orientation >= 5 && orientation <= 8;
        int w = swap ? rh : rw, h = swap ? rw : rh;
        boolean needPreview = Math.max(w, h) > PREVIEW_EDGE * 1.15 || !browserImage(mime) || size > 2.5 * 1024 * 1024;
        int target = needPreview ? PREVIEW_EDGE : THUMB_EDGE;
        int sample = 1;
        while (Math.max(rw, rh) / (sample * 2) >= target) sample *= 2;
        BitmapFactory.Options d = new BitmapFactory.Options();
        d.inSampleSize = sample;
        d.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bmp;
        try (InputStream in = cr.openInputStream(uri)) { bmp = BitmapFactory.decodeStream(in, null, d); } catch (Exception | OutOfMemoryError e) { return null; }
        if (bmp == null) return null;
        try {
            bmp = oriented(bmp, orientation);
            Derived r = new Derived();
            r.w = w;
            r.h = h;
            r.thumb = scaled(bmp, w, h, THUMB_EDGE, THUMB_MAX, 72);
            if (needPreview) r.preview = scaled(bmp, w, h, PREVIEW_EDGE, PREVIEW_MAX, 84);
            return r;
        } catch (OutOfMemoryError e) {
            return null;
        } finally {
            bmp.recycle();
        }
    }

    /** Video: poster frame thumbnail/preview + duration (like the web app's <video> poster), or null when no frame. */
    static Derived video(Context c, Uri uri) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(c, uri);
            long dur = 0;
            try { dur = Long.parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)); } catch (Exception ignored) { /* unknown */ }
            Bitmap frame = r.getFrameAtTime(Math.min(1000L, Math.max(0, dur / 3)) * 1000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) return null;
            try {
                Derived d = new Derived();
                d.w = frame.getWidth();
                d.h = frame.getHeight();
                d.durationMs = dur;
                d.thumb = scaled(frame, d.w, d.h, THUMB_EDGE, THUMB_MAX, 72);
                d.preview = scaled(frame, d.w, d.h, PREVIEW_EDGE, PREVIEW_MAX, 84);
                return d;
            } finally {
                frame.recycle();
            }
        } catch (Exception | OutOfMemoryError e) {
            return null;
        } finally {
            try { r.release(); } catch (Exception ignored) { /* already released */ }
        }
    }
}
