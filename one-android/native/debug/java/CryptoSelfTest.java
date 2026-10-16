package dev.fale.one;

// Debug builds + CI only: the Java ↔ JS crypto cross-test. Input = vectors sealed by the web worker's code
// (js/one/crypto.js), which this class must open; output = vectors sealed by FaleCrypto, which the JS side opens.
// Used by the JVM test (scripts/android-one-e2e/crypto-cross.mjs) and by FaleDebugPlugin in the emulator, so
// both run exactly the same checks. Pure Java (no Android classes). Values are strings: ids, base64url, numbers.
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

public final class CryptoSelfTest {
    private CryptoSelfTest() {}

    /** Deterministic test content on both sides (no multi-MB transfer): spans two 4 MiB digest segments. */
    public static final int DATA_LEN = 4 * 1024 * 1024 + 12345;
    public static byte[] data() {
        byte[] d = new byte[DATA_LEN];
        for (int i = 0; i < d.length; i++) d[i] = (byte) ((i * 31 + (i >>> 8) * 7 + (i >>> 16)) & 255);
        return d;
    }

    private static byte[] b(Map<String, String> m, String k) {
        String v = m.get(k);
        if (v == null) throw new IllegalArgumentException("missing " + k);
        return FaleCrypto.unb64u(v);
    }
    private static String s(Map<String, String> m, String k) {
        String v = m.get(k);
        if (v == null) throw new IllegalArgumentException("missing " + k);
        return v;
    }
    private static String utf8(byte[] b) { return new String(b, StandardCharsets.UTF_8); }

    private interface Check { String run() throws Exception; }
    private static void check(Map<String, String> out, String name, Check c) {
        try {
            String r = c.run();
            out.put("check." + name, r == null ? "ok" : r);
        } catch (Exception e) {
            out.put("check." + name, "FAIL " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
    private static String same(byte[] a, byte[] b, String what) { return Arrays.equals(a, b) ? null : "FAIL " + what + " differs"; }
    private static String same(String a, String b, String what) { return a.equals(b) ? null : "FAIL " + what + ": " + a + " != " + b; }

    /** JS vectors in → checks + Java vectors out. */
    public static Map<String, String> run(Map<String, String> in) {
        Map<String, String> out = new LinkedHashMap<>();
        final String user = s(in, "userId");
        final byte[] kek = b(in, "kek"), dk = b(in, "dk"), dvk = b(in, "dvk");
        // 1) key derivation from the master key (what native.js hands over must equal K.deriveKeys)
        if (in.containsKey("mk")) check(out, "derive", () -> {
            byte[][] k = FaleCrypto.deriveAccountKeys(b(in, "mk"), user);
            String r = same(k[0], kek, "kek");
            if (r == null) r = same(k[1], dk, "dk");
            if (r == null) r = same(k[2], dvk, "dvk");
            return r;
        });
        // 2) JS → Java: open everything the web worker sealed
        final byte[][] nk = new byte[1][], fk = new byte[1][];
        check(out, "js.nodeKey", () -> { nk[0] = FaleCrypto.openNodeKey(kek, user, s(in, "nodeId"), s(in, "nodeWrapped")); return same(nk[0], b(in, "nodeRaw"), "node key"); });
        check(out, "js.meta", () -> same(FaleCrypto.openMeta(nk[0], s(in, "metaKind"), user, s(in, "nodeId"), s(in, "metaSealed")), utf8(b(in, "metaJson")), "meta"));
        check(out, "js.fileKey", () -> { fk[0] = FaleCrypto.openFileKey(nk[0], user, s(in, "nodeId"), s(in, "revId"), s(in, "fileWrapped")); return same(fk[0], b(in, "fileRaw"), "file key"); });
        check(out, "js.rmeta", () -> same(FaleCrypto.openRevMeta(fk[0], user, s(in, "nodeId"), s(in, "revId"), s(in, "rmetaSealed")), utf8(b(in, "rmetaJson")), "rmeta"));
        check(out, "js.chunks", () -> {
            int n = Integer.parseInt(s(in, "n"));
            FaleCrypto.Ctx c = new FaleCrypto.Ctx(user, s(in, "nodeId"), s(in, "revId"), s(in, "blobId"), s(in, "purpose"));
            byte[] bk = FaleCrypto.blobKey(fk[0], c.blobId, c.purpose);
            for (int i = 0; i < n; i++) {
                String r = same(FaleCrypto.openChunk(bk, c, i, n, b(in, "chunk" + i)), b(in, "plain" + i), "chunk " + i);
                if (r != null) return r;
            }
            // reordering must fail (index is in the AAD)
            if (n > 1) {
                try { FaleCrypto.openChunk(bk, c, 0, n, b(in, "chunk1")); return "FAIL reordered chunk opened"; }
                catch (FaleCrypto.CryptoException expected) { /* good */ }
            }
            return null;
        });
        check(out, "js.device", () -> same(FaleCrypto.openDeviceMeta(dvk, user, s(in, "deviceId"), s(in, "deviceSealed")), utf8(b(in, "deviceJson")), "device meta"));
        final byte[] data = data();
        check(out, "js.digest", () -> {
            FaleCrypto.Digest d = new FaleCrypto.Digest();
            for (int off = 0; off < data.length; off += 70000) d.update(data, off, Math.min(70000, data.length - off)); // odd buffer size on purpose
            byte[] dig = d.finish();
            String r = same(FaleCrypto.hex(dig), s(in, "digest"), "digest");
            if (r == null) r = same(FaleCrypto.dedupeHash(dk, dig), s(in, "dedupe"), "dedupe hash");
            if (r == null && in.containsKey("emptyDigest")) r = same(FaleCrypto.hex(FaleCrypto.contentDigest(new byte[0])), s(in, "emptyDigest"), "empty digest");
            return r;
        });
        check(out, "js.layout", () -> {
            long[] l = FaleCrypto.layout(Long.parseLong(s(in, "layoutSize")), Integer.parseInt(s(in, "layoutChunk")));
            return same(l[0] + "/" + l[1] + "/" + l[2], s(in, "layout"), "layout");
        });

        // 3) Java → JS: seal a full set the JS side must open
        check(out, "java.seal", () -> {
            String nodeId = FaleCrypto.uuid(), revId = FaleCrypto.uuid(), blobId = FaleCrypto.uuid(), thumbId = FaleCrypto.uuid(), deviceId = s(in, "deviceId");
            FaleCrypto.Wrapped node = FaleCrypto.createNodeKey(kek, user, nodeId);
            FaleCrypto.Wrapped file = FaleCrypto.createFileKey(node.raw, user, nodeId, revId);
            String metaJson = "{\"v\":1,\"name\":\"Strandkörbe – Sankt Peter-Ording 🌊.jpg\",\"takenAt\":\"2026-05-01T10:15:00+02:00\",\"gps\":{\"lat\":54.31,\"lon\":8.6123,\"alt\":-1.5}}";
            String rmetaJson = "{\"v\":1,\"size\":3,\"mime\":\"image/jpeg\",\"mtime\":1777630500000,\"digest\":\"" + FaleCrypto.hex(FaleCrypto.contentDigest(new byte[] { 1, 2, 3 })) + "\"}";
            String deviceJson = "{\"v\":1,\"name\":\"Pixel · Android\",\"platform\":\"android\",\"app\":\"one-1.0.0\"}";
            out.put("j.nodeId", nodeId);
            out.put("j.revId", revId);
            out.put("j.blobId", blobId);
            out.put("j.thumbId", thumbId);
            out.put("j.nodeWrapped", node.wrapped);
            out.put("j.nodeRaw", FaleCrypto.b64u(node.raw));
            out.put("j.fileWrapped", file.wrapped);
            out.put("j.fileRaw", FaleCrypto.b64u(file.raw));
            out.put("j.metaJson", FaleCrypto.b64u(FaleCrypto.utf8(metaJson)));
            out.put("j.metaSealed", FaleCrypto.sealMeta(node.raw, "photo", user, nodeId, metaJson));
            out.put("j.rmetaJson", FaleCrypto.b64u(FaleCrypto.utf8(rmetaJson)));
            out.put("j.rmetaSealed", FaleCrypto.sealRevMeta(file.raw, user, nodeId, revId, rmetaJson));
            FaleCrypto.Ctx c = new FaleCrypto.Ctx(user, nodeId, revId, blobId, "content");
            byte[] bk = FaleCrypto.blobKey(file.raw, blobId, "content");
            int n = 3;
            out.put("j.n", String.valueOf(n));
            for (int i = 0; i < n; i++) {
                byte[] plain = FaleCrypto.random(i == n - 1 ? 17 : 1000);
                out.put("j.plain" + i, FaleCrypto.b64u(plain));
                out.put("j.chunk" + i, FaleCrypto.b64u(FaleCrypto.sealChunk(bk, c, i, n, plain, 0, plain.length)));
            }
            byte[] thumb = FaleCrypto.random(321);
            out.put("j.thumbPlain", FaleCrypto.b64u(thumb));
            out.put("j.thumbSealed", FaleCrypto.b64u(FaleCrypto.sealSmall(file.raw, new FaleCrypto.Ctx(user, nodeId, revId, thumbId, "thumb"), thumb)));
            out.put("j.deviceJson", FaleCrypto.b64u(FaleCrypto.utf8(deviceJson)));
            out.put("j.deviceSealed", FaleCrypto.sealDeviceMeta(dvk, user, deviceId, deviceJson));
            byte[] dig = FaleCrypto.contentDigest(data);
            out.put("j.digest", FaleCrypto.hex(dig));
            out.put("j.dedupe", FaleCrypto.dedupeHash(dk, dig));
            out.put("j.uuid", FaleCrypto.uuid());
            return null;
        });
        boolean ok = true;
        for (Map.Entry<String, String> e : out.entrySet()) if (e.getKey().startsWith("check.") && !"ok".equals(e.getValue())) ok = false;
        out.put("ok", ok ? "1" : "0");
        return out;
    }
}
