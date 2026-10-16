package dev.fale.one;

// EXIF (JPEG APP1, HEIC/HEIF/AVIF Exif item, TIFF-based RAW) and MP4/MOV metadata – a 1:1 port of one/js/media.js
// (parseExif, readTiff, exifToMeta, mp4Meta), so photos backed up in the background carry exactly the metadata the
// web app writes. Pure Java (no Android classes): the CI build job compares it with the JS parser on the test photos
// (scripts/android-one-e2e/crypto-cross.mjs). Numbers follow JS semantics (doubles; integers where JS has them).
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class BackupExif {
    private BackupExif() {}

    private static final Map<Integer, String> TAGS0 = new HashMap<>(), TAGSX = new HashMap<>(), TAGSG = new HashMap<>();
    static {
        TAGS0.put(0x010f, "make"); TAGS0.put(0x0110, "model"); TAGS0.put(0x0112, "orientation"); TAGS0.put(0x0132, "dateTime");
        TAGS0.put(0x8769, "exifIfd"); TAGS0.put(0x8825, "gpsIfd");
        TAGSX.put(0x9003, "dateTimeOriginal"); TAGSX.put(0x9004, "dateTimeDigitized"); TAGSX.put(0x9011, "offsetTimeOriginal"); TAGSX.put(0x9010, "offsetTime");
        TAGSX.put(0x829a, "exposureTime"); TAGSX.put(0x829d, "fNumber"); TAGSX.put(0x8827, "iso"); TAGSX.put(0x920a, "focalLength"); TAGSX.put(0xa405, "focalLength35");
        TAGSX.put(0xa434, "lensModel"); TAGSX.put(0xa002, "pixelX"); TAGSX.put(0xa003, "pixelY"); TAGSX.put(0x9209, "flash");
        TAGSG.put(1, "latRef"); TAGSG.put(2, "lat"); TAGSG.put(3, "lonRef"); TAGSG.put(4, "lon"); TAGSG.put(5, "altRef"); TAGSG.put(6, "alt");
    }

    // ---------------------------------------------------------------- TIFF reader (media.js readTiff)
    private static final class Tiff {
        final byte[] b;
        final int start, end;
        final boolean le;
        Tiff(byte[] b, int start, int end, boolean le) { this.b = b; this.start = start; this.end = end; this.le = le; }
        int u8(int o) { return b[start + o] & 255; }
        int u16(int o) { int a = u8(o), c = u8(o + 1); return le ? a | (c << 8) : (a << 8) | c; }
        long u32(int o) { long a = u16(o), c = u16(o + 2); return le ? a | (c << 16) : (a << 16) | c; }
        int i32(int o) { return (int) u32(o); }
    }
    private static final int[] SIZE = { 1, 1, 1, 2, 4, 8, 1, 1, 1, 4, 8 }; // index = TIFF type (0 unused → 1)

    private static Object val(Tiff t, int type, long count, int off) {
        int size = type >= 1 && type <= 10 ? SIZE[type] : 1;
        long p = size * count <= 4 ? off : t.u32(off);
        if (t.start + p + size * count > t.end) return null;
        if (type == 2) {
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < count; i++) { int ch = t.u8((int) p + i); if (ch == 0) break; s.append((char) ch); }
            return s.toString().trim();
        }
        if (count == 1) return one(t, type, (int) p, 0, size);
        List<Object> list = new ArrayList<>();
        for (int i = 0; i < Math.min(count, 16); i++) list.add(one(t, type, (int) p, i, size));
        return list;
    }
    private static Object one(Tiff t, int type, int p, int i, int size) {
        int q = p + i * size;
        switch (type) {
            case 1: case 7: return (double) t.u8(q);
            case 3: return (double) t.u16(q);
            case 4: return (double) t.u32(q);
            case 9: return (double) t.i32(q);
            case 5: { long d = t.u32(q + 4); return d != 0 ? (double) t.u32(q) / d : 0.0; }
            case 10: { int d = t.i32(q + 4); return d != 0 ? (double) t.i32(q) / d : 0.0; }
            default: return null;
        }
    }
    private static void ifd(Tiff t, long off, Map<Integer, String> names, Map<String, Object> out) {
        if (off == 0 || t.start + off + 2 > t.end) return;
        int n = t.u16((int) off);
        for (int i = 0; i < n && i < 400; i++) {
            int e = (int) off + 2 + i * 12;
            if (t.start + e + 12 > t.end) break;
            String name = names.get(t.u16(e));
            if (name != null) {
                try { out.put(name, val(t, t.u16(e + 2), t.u32(e + 4), e + 8)); } catch (RuntimeException ignored) { /* like JS: skip */ }
            }
        }
    }
    private static Map<String, Object> readTiff(byte[] b, int start, int len) {
        int end = (int) Math.min(b.length, (long) start + len);
        if (start < 0 || start + 8 > end) return null;
        int h = ((b[start] & 255) << 8) | (b[start + 1] & 255);
        boolean le = h == 0x4949;
        if (!le && h != 0x4d4d) return null;
        Tiff t = new Tiff(b, start, end, le);
        if (t.u16(2) != 42) return null;
        Map<String, Object> out = new HashMap<>();
        ifd(t, t.u32(4), TAGS0, out);
        Double exif = num(out.get("exifIfd"));
        if (exif != null && exif != 0) ifd(t, exif.longValue(), TAGSX, out);
        Map<String, Object> gps = new HashMap<>();
        Double g = num(out.get("gpsIfd"));
        if (g != null && g != 0) ifd(t, g.longValue(), TAGSG, gps);
        out.put("gps", gps);
        return out;
    }
    private static int find(byte[] u, int[] pat, int from, int to) {
        outer:
        for (int i = Math.max(0, from); i <= to - pat.length; i++) {
            for (int j = 0; j < pat.length; j++) if ((u[i + j] & 255) != pat[j]) continue outer;
            return i;
        }
        return -1;
    }
    private static final int[] EXIF_HDR = { 0x45, 0x78, 0x69, 0x66, 0, 0 };
    /** Raw EXIF fields from the first bytes of an image (null when none). */
    static Map<String, Object> parseExif(byte[] u) {
        if (u.length > 1 && (u[0] & 255) == 0xff && (u[1] & 255) == 0xd8) {
            int i = 2;
            while (i + 4 < u.length) {
                if ((u[i] & 255) != 0xff) { i++; continue; }
                int m = u[i + 1] & 255;
                if (m == 0xd9 || m == 0xda) break;
                int len = ((u[i + 2] & 255) << 8) | (u[i + 3] & 255);
                if (m == 0xe1 && find(u, EXIF_HDR, i + 4, Math.min(u.length, i + 10)) == i + 4) return readTiff(u, i + 10, len - 8);
                i += 2 + len;
            }
            return null;
        }
        if (u.length > 3 && (((u[0] & 255) == 0x49 && (u[1] & 255) == 0x49 && (u[2] & 255) == 42) || ((u[0] & 255) == 0x4d && (u[1] & 255) == 0x4d && (u[3] & 255) == 42))) return readTiff(u, 0, u.length);
        int p = find(u, EXIF_HDR, 0, u.length);
        if (p >= 0) return readTiff(u, p + 6, u.length - p - 6);
        int q = Math.max(find(u, new int[] { 0x4d, 0x4d, 0, 42, 0, 0, 0, 8 }, 0, u.length), find(u, new int[] { 0x49, 0x49, 42, 0, 8, 0, 0, 0 }, 0, u.length));
        return q >= 0 ? readTiff(u, q, u.length - q) : null;
    }

    // ---------------------------------------------------------------- exifToMeta
    static Double num(Object o) { return o instanceof Double ? (Double) o : null; }
    private static boolean isInt(Double d) { return d != null && !d.isInfinite() && d == Math.rint(d); }
    /** JS String(x) for the values readTiff produces. */
    private static String str(Object o) {
        if (o == null) return "";
        if (o instanceof Double) { Double d = (Double) o; return isInt(d) ? String.valueOf(d.longValue()) : d.toString(); }
        if (o instanceof List) { StringBuilder s = new StringBuilder(); for (Object x : (List<?>) o) { if (s.length() > 0) s.append(','); s.append(str(x)); } return s.toString(); }
        return o.toString();
    }
    private static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof String) return !((String) o).isEmpty();
        if (o instanceof Double) { double d = (Double) o; return d != 0 && !Double.isNaN(d); }
        return true;
    }
    private static final Pattern DATE = Pattern.compile("^(\\d{4}):(\\d{2}):(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})");
    private static String exifDate(Object s, Object off) {
        Matcher m = DATE.matcher(s == null ? "" : str(s));
        if (!m.find() || "0000".equals(m.group(1))) return null;
        String o = off != null && str(off).matches("^[+-]\\d{2}:\\d{2}$") ? str(off) : "";
        return m.group(1) + "-" + m.group(2) + "-" + m.group(3) + "T" + m.group(4) + ":" + m.group(5) + ":" + m.group(6) + o;
    }
    private static Double gpsDeg(Object v, Object ref) {
        if (!(v instanceof List) || ((List<?>) v).size() < 3) return null;
        List<?> l = (List<?>) v;
        Double a = num(l.get(0)), b = num(l.get(1)), c = num(l.get(2));
        if (a == null || b == null || c == null) return null;
        double d = a + b / 60 + c / 3600;
        if (Double.isNaN(d) || Double.isInfinite(d) || d == 0) return null;
        String r = ref instanceof String ? (String) ref : null;
        return jsRound(("S".equals(r) || "W".equals(r) ? -d : d) * 1e6) / 1e6;
    }
    /** Math.round of JS (half up towards +∞). */
    private static double jsRound(double v) { return Math.floor(v + 0.5); }
    private static String slice(Object o, int n) { String s = str(o); return s.length() > n ? s.substring(0, n) : s; }

    /** Node-meta fields (contract §5.4) from raw EXIF – media.js exifToMeta. */
    static Map<String, Object> exifToMeta(Map<String, Object> x) {
        Map<String, Object> meta = new LinkedHashMap<>();
        if (x == null) return meta;
        Object offOrig = truthy(x.get("offsetTimeOriginal")) ? x.get("offsetTimeOriginal") : x.get("offsetTime");
        String taken = exifDate(x.get("dateTimeOriginal"), offOrig);
        if (taken == null) taken = exifDate(x.get("dateTimeDigitized"), x.get("offsetTime"));
        if (taken == null) taken = exifDate(x.get("dateTime"), x.get("offsetTime"));
        if (taken != null) meta.put("takenAt", taken);
        Double o = num(x.get("orientation"));
        if (isInt(o) && o >= 1 && o <= 8) meta.put("orientation", o.longValue());
        Double px = num(x.get("pixelX")), py = num(x.get("pixelY"));
        if (px != null && py != null && px > 0 && py > 0) { meta.put("w", px); meta.put("h", py); }
        @SuppressWarnings("unchecked") Map<String, Object> g = x.get("gps") instanceof Map ? (Map<String, Object>) x.get("gps") : new HashMap<>();
        Double lat = gpsDeg(g.get("lat"), g.get("latRef")), lon = gpsDeg(g.get("lon"), g.get("lonRef"));
        if (lat != null && lon != null) {
            Map<String, Object> gps = new LinkedHashMap<>();
            gps.put("lat", lat);
            gps.put("lon", lon);
            Double alt = num(g.get("alt"));
            if (alt != null && !alt.isNaN() && !alt.isInfinite()) {
                Double ref = num(g.get("altRef"));
                gps.put("alt", jsRound((ref != null && ref == 1 ? -alt : alt) * 10) / 10);
            }
            meta.put("gps", gps);
        }
        Map<String, Object> ex = new LinkedHashMap<>();
        if (truthy(x.get("make"))) ex.put("make", slice(x.get("make"), 60));
        if (truthy(x.get("model"))) ex.put("model", slice(x.get("model"), 80));
        if (truthy(x.get("lensModel"))) ex.put("lens", slice(x.get("lensModel"), 80));
        Object iso = x.get("iso");
        if (iso instanceof Double) ex.put("iso", iso); else if (iso instanceof List && !((List<?>) iso).isEmpty()) ex.put("iso", ((List<?>) iso).get(0));
        Double f = num(x.get("fNumber"));
        if (f != null && f > 0) ex.put("fNumber", jsRound(f * 10) / 10);
        Double e = num(x.get("exposureTime"));
        if (e != null && e > 0) ex.put("exposure", e);
        Double fl = num(x.get("focalLength"));
        if (fl != null && fl > 0) ex.put("focal", jsRound(fl * 10) / 10);
        Double f35 = num(x.get("focalLength35"));
        if (f35 != null && f35 > 0) ex.put("focal35", f35);
        if (!ex.isEmpty()) meta.put("exif", ex);
        return meta;
    }

    // ---------------------------------------------------------------- MP4 / MOV (media.js mp4Meta)
    private static final Pattern ISO6709 = Pattern.compile("([+-]\\d+(?:\\.\\d+)?)([+-]\\d+(?:\\.\\d+)?)");
    static Map<String, Object> mp4Meta(byte[] u) {
        Map<String, Object> out = new LinkedHashMap<>();
        int mvhd = find(u, new int[] { 0x6d, 0x76, 0x68, 0x64 }, 0, u.length);
        if (mvhd >= 4) {
            try {
                Tiff t = new Tiff(u, 0, u.length, false);
                int v = u[mvhd + 4] & 255;
                double created = v == 1 ? (double) ((t.u32(mvhd + 8) << 32) | t.u32(mvhd + 12)) : t.u32(mvhd + 8);
                long scale = v == 1 ? t.u32(mvhd + 24) : t.u32(mvhd + 16);
                double dur = v == 1 ? (double) ((t.u32(mvhd + 28) << 32) | t.u32(mvhd + 32)) : t.u32(mvhd + 20);
                if (created > 0) {
                    double ms = (created - 2082844800d) * 1000;
                    if (ms > 0 && ms < System.currentTimeMillis() + 864e5) {
                        java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
                        iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                        out.put("takenAt", iso.format(new java.util.Date((long) ms)));
                    }
                }
                if (scale > 0 && dur > 0) out.put("durationMs", (double) Math.round((dur / scale) * 1000));
            } catch (RuntimeException ignored) { /* truncated box */ }
        }
        int xyz = find(u, new int[] { 0xa9, 0x78, 0x79, 0x7a }, 0, u.length);
        if (xyz >= 0) {
            String s = new String(u, xyz + 4, Math.max(0, Math.min(56, u.length - xyz - 4)), StandardCharsets.UTF_8);
            Matcher m = ISO6709.matcher(s);
            if (m.find()) {
                double lat = Double.parseDouble(m.group(1)), lon = Double.parseDouble(m.group(2));
                if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat != 0 || lon != 0)) {
                    Map<String, Object> gps = new LinkedHashMap<>();
                    gps.put("lat", lat);
                    gps.put("lon", lon);
                    out.put("gps", gps);
                }
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- tiny JSON writer (no org.json on the JVM test)
    static String json(Object o) {
        if (o == null) return "null";
        if (o instanceof String) {
            StringBuilder s = new StringBuilder("\"");
            for (char ch : ((String) o).toCharArray()) {
                if (ch == '"' || ch == '\\') s.append('\\').append(ch);
                else if (ch < 0x20) s.append(String.format(Locale.ROOT, "\\u%04x", (int) ch));
                else s.append(ch);
            }
            return s.append('"').toString();
        }
        if (o instanceof Double) { Double d = (Double) o; return isInt(d) && Math.abs(d) < 1e15 ? String.valueOf(d.longValue()) : d.toString(); }
        if (o instanceof Number || o instanceof Boolean) return o.toString();
        if (o instanceof Map) {
            StringBuilder s = new StringBuilder("{");
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) { if (s.length() > 1) s.append(','); s.append(json(String.valueOf(e.getKey()))).append(':').append(json(e.getValue())); }
            return s.append('}').toString();
        }
        if (o instanceof List) {
            StringBuilder s = new StringBuilder("[");
            for (Object x : (List<?>) o) { if (s.length() > 1) s.append(','); s.append(json(x)); }
            return s.append(']').toString();
        }
        return json(o.toString());
    }
}
