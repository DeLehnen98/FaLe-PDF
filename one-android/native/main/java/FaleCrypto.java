package dev.fale.one;

// FaLe One – the client crypto of js/one/crypto.js (format v1, docs/FALE-ONE-API.md §5) in plain Java
// (javax.crypto only, no Android classes) for the background photo backup. Everything this class writes must be
// byte-compatible with the web worker: the server and the other devices cannot tell the two apart.
// Cross-tested against the JS code in CI (scripts/android-one-e2e/crypto-cross.mjs on the JVM, and in the
// emulator through the debug-only FaleDebug plugin).
//
//   KEK / DK / DVK  account keys, derived from the master key by the web app (HKDF, see native.js) – the master
//                   key itself never reaches this code
//   NK  node key    32 random bytes, wrap(KEK, NK, AAD "fale-one-v1|wrap|node|<user>|<node>")
//   FK  file key    32 random bytes per revision, wrap(HKDF(NK, "fale-one-v1/filewrap"), FK, AAD "…|wrap|file|<user>|<node>|<rev>")
//   meta envelope   AES-GCM(HKDF(NK, "fale-one-v1/meta"), JSON, AAD "fale-one-v1|meta|<kind>|<user>|<id>")
//   rmeta envelope  AES-GCM(HKDF(FK, "fale-one-v1/rmeta"), JSON, AAD "fale-one-v1|rmeta|<user>|<node>|<rev>")
//   blob key        HKDF(FK, salt = blobId, "fale-one-v1/blob/<purpose>")
//   chunk           IV ‖ AES-GCM(BK, plain, AAD "fale-one-v1|chunk|<user>|<node>|<rev>|<blob>|<purpose>|<i>|<n>|<final>")
//   device meta     AES-GCM(DVK, JSON, AAD "fale-one-v1|device|<user>|<device>")
//   digest          SHA-256 over the SHA-256 of every 4 MiB plaintext segment; dedupe hash = HMAC(DK, "fale-one-v1|dedupe|" ‖ digest)
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class FaleCrypto {
    public static final String V = "fale-one-v1";
    public static final int IV_LEN = 12;
    public static final int TAG = 16;
    public static final int CHUNK_OVERHEAD = IV_LEN + TAG;
    public static final int SEGMENT = 4 * 1024 * 1024;
    private static final SecureRandom RND = new SecureRandom();
    private static final Pattern UUID_RE = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final String[] PURPOSES = { "content", "thumb", "preview" };
    private static final String[] META_KINDS = { "folder", "file", "photo", "album" };

    private FaleCrypto() {}

    public static final class CryptoException extends GeneralSecurityException {
        public final String code;
        public CryptoException(String code, String msg) { super(msg); this.code = code; }
    }

    // ---------------------------------------------------------------- encoding helpers
    // base64url without padding (own code: java.util.Base64 is missing on Android 7)
    private static final char[] B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
    public static String b64u(byte[] b) {
        StringBuilder sb = new StringBuilder((b.length * 4 + 2) / 3);
        int i = 0;
        for (; i + 2 < b.length; i += 3) {
            int v = ((b[i] & 255) << 16) | ((b[i + 1] & 255) << 8) | (b[i + 2] & 255);
            sb.append(B64[v >>> 18]).append(B64[(v >>> 12) & 63]).append(B64[(v >>> 6) & 63]).append(B64[v & 63]);
        }
        if (i < b.length) {
            int v = (b[i] & 255) << 16 | (i + 1 < b.length ? (b[i + 1] & 255) << 8 : 0);
            sb.append(B64[v >>> 18]).append(B64[(v >>> 12) & 63]);
            if (i + 1 < b.length) sb.append(B64[(v >>> 6) & 63]);
        }
        return sb.toString();
    }
    /** Accepts base64url and standard base64, with or without padding. */
    public static byte[] unb64u(String s) {
        int len = s.length();
        while (len > 0 && s.charAt(len - 1) == '=') len--;
        if (len % 4 == 1) throw new IllegalArgumentException("bad base64");
        byte[] out = new byte[len * 3 / 4];
        int acc = 0, bits = 0, o = 0;
        for (int i = 0; i < len; i++) {
            char ch = s.charAt(i);
            int v = ch >= 'A' && ch <= 'Z' ? ch - 'A' : ch >= 'a' && ch <= 'z' ? ch - 'a' + 26 : ch >= '0' && ch <= '9' ? ch - '0' + 52
                : ch == '-' || ch == '+' ? 62 : ch == '_' || ch == '/' ? 63 : -1;
            if (v < 0) throw new IllegalArgumentException("bad base64");
            acc = (acc << 6) | v;
            bits += 6;
            if (bits >= 8) { bits -= 8; out[o++] = (byte) (acc >>> bits); }
        }
        return o == out.length ? out : Arrays.copyOf(out, o);
    }
    public static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    public static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return sb.toString();
    }
    public static byte[] random(int n) { byte[] b = new byte[n]; RND.nextBytes(b); return b; }
    /** Lowercase v4 UUID, exactly like crypto.randomUUID(). */
    public static String uuid() { return UUID.randomUUID().toString().toLowerCase(java.util.Locale.ROOT); }
    public static String needId(String id, String what) throws CryptoException {
        if (id == null || !UUID_RE.matcher(id).matches()) throw new CryptoException("bad_id", "invalid " + what);
        return id;
    }
    /** "fale-one-v1|a|b|…" (AAD / info strings: UTF-8, '|' separated, numbers in decimal). */
    static byte[] aad(Object... parts) {
        StringBuilder sb = new StringBuilder(V);
        for (Object p : parts) sb.append('|').append(p);
        return utf8(sb.toString());
    }
    public static void wipe(byte[] b) { if (b != null) Arrays.fill(b, (byte) 0); }

    // ---------------------------------------------------------------- HKDF-SHA256 (RFC 5869, as WebCrypto deriveKey/deriveBits)
    private static Mac hmac(byte[] key) throws GeneralSecurityException {
        Mac m = Mac.getInstance("HmacSHA256");
        // an empty HMAC key equals 32 zero bytes (keys are zero-padded to the block size); SecretKeySpec refuses empty keys
        m.init(new SecretKeySpec(key.length == 0 ? new byte[32] : key, "HmacSHA256"));
        return m;
    }
    public static byte[] hkdf(byte[] ikm, byte[] salt, String info, int len) throws GeneralSecurityException {
        byte[] prk = hmac(salt == null ? new byte[0] : salt).doFinal(ikm);
        try {
            Mac m = hmac(prk);
            byte[] infoB = utf8(info);
            byte[] out = new byte[len];
            byte[] t = new byte[0];
            int pos = 0;
            for (int i = 1; pos < len; i++) {
                m.reset();
                m.update(t);
                m.update(infoB);
                m.update((byte) i);
                t = m.doFinal();
                int n = Math.min(t.length, len - pos);
                System.arraycopy(t, 0, out, pos, n);
                pos += n;
            }
            return out;
        } finally { wipe(prk); }
    }
    static byte[] hkdf32(byte[] ikm, byte[] salt, String info) throws GeneralSecurityException { return hkdf(ikm, salt, info, 32); }

    /** The account keys as the web worker derives them (K.deriveKeys): for tests and for checking what the app hands over. */
    public static byte[][] deriveAccountKeys(byte[] mk, String userId) throws GeneralSecurityException {
        byte[] salt = utf8(V + "|" + userId);
        return new byte[][] { hkdf32(mk, salt, V + "/kek"), hkdf32(mk, salt, V + "/dedupe"), hkdf32(mk, salt, V + "/device") };
    }

    // ---------------------------------------------------------------- AES-256-GCM
    static byte[] gcm(int mode, byte[] key, byte[] iv, byte[] ad, byte[] in, int off, int len) throws GeneralSecurityException {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG * 8, iv));
        if (ad != null) c.updateAAD(ad);
        return c.doFinal(in, off, len);
    }
    /** 0x01 ‖ IV ‖ GCM(plain) */
    static byte[] seal(byte[] key, byte[] plain, byte[] ad) throws GeneralSecurityException {
        byte[] iv = random(IV_LEN);
        byte[] ct = gcm(Cipher.ENCRYPT_MODE, key, iv, ad, plain, 0, plain.length);
        byte[] out = new byte[1 + IV_LEN + ct.length];
        out[0] = 1;
        System.arraycopy(iv, 0, out, 1, IV_LEN);
        System.arraycopy(ct, 0, out, 1 + IV_LEN, ct.length);
        return out;
    }
    static byte[] open(byte[] key, byte[] sealed, byte[] ad, String code) throws GeneralSecurityException {
        if (sealed == null || sealed.length < 1 + IV_LEN + TAG || sealed[0] != 1) throw new CryptoException("format", "unknown format");
        try {
            return gcm(Cipher.DECRYPT_MODE, key, Arrays.copyOfRange(sealed, 1, 1 + IV_LEN), ad, sealed, 1 + IV_LEN, sealed.length - 1 - IV_LEN);
        } catch (GeneralSecurityException e) {
            throw new CryptoException(code, "decryption failed");
        }
    }

    // ---------------------------------------------------------------- wrapped keys
    public static String wrap(byte[] wrappingKey, byte[] raw, byte[] ad) throws GeneralSecurityException { return b64u(seal(wrappingKey, raw, ad)); }
    public static byte[] unwrap(byte[] wrappingKey, String wrapped, byte[] ad) throws GeneralSecurityException {
        byte[] u;
        try { u = unb64u(wrapped); } catch (IllegalArgumentException e) { throw new CryptoException("format", "bad key"); }
        if (u.length != 1 + IV_LEN + 32 + TAG) throw new CryptoException("format", "bad key length");
        return open(wrappingKey, u, ad, "unwrap");
    }
    /** A new random key for an item, wrapped by the KEK. → { raw, wrapped(utf8) } */
    public static final class Wrapped {
        public final byte[] raw;
        public final String wrapped;
        Wrapped(byte[] raw, String wrapped) { this.raw = raw; this.wrapped = wrapped; }
    }
    public static Wrapped createNodeKey(byte[] kek, String userId, String nodeId) throws GeneralSecurityException {
        byte[] raw = random(32);
        return new Wrapped(raw, wrap(kek, raw, aad("wrap", "node", userId, needId(nodeId, "node id"))));
    }
    public static byte[] openNodeKey(byte[] kek, String userId, String nodeId, String wrapped) throws GeneralSecurityException {
        return unwrap(kek, wrapped, aad("wrap", "node", userId, needId(nodeId, "node id")));
    }
    private static byte[] fileWrapKey(byte[] nodeKey) throws GeneralSecurityException { return hkdf32(nodeKey, new byte[0], V + "/filewrap"); }
    public static Wrapped createFileKey(byte[] nodeKey, String userId, String nodeId, String revId) throws GeneralSecurityException {
        byte[] wk = fileWrapKey(nodeKey);
        try {
            byte[] raw = random(32);
            return new Wrapped(raw, wrap(wk, raw, aad("wrap", "file", userId, needId(nodeId, "node id"), needId(revId, "revision id"))));
        } finally { wipe(wk); }
    }
    public static byte[] openFileKey(byte[] nodeKey, String userId, String nodeId, String revId, String wrapped) throws GeneralSecurityException {
        byte[] wk = fileWrapKey(nodeKey);
        try { return unwrap(wk, wrapped, aad("wrap", "file", userId, needId(nodeId, "node id"), needId(revId, "revision id"))); }
        finally { wipe(wk); }
    }

    // ---------------------------------------------------------------- envelopes (JSON text in, base64url out)
    private static void needKind(String kind) throws CryptoException {
        for (String k : META_KINDS) if (k.equals(kind)) return;
        throw new CryptoException("bad_kind", "bad kind");
    }
    public static String sealMeta(byte[] itemKey, String kind, String userId, String id, String json) throws GeneralSecurityException {
        needKind(kind);
        byte[] k = hkdf32(itemKey, new byte[0], V + "/meta");
        try { return b64u(seal(k, utf8(json), aad("meta", kind, userId, needId(id, "id")))); } finally { wipe(k); }
    }
    public static String openMeta(byte[] itemKey, String kind, String userId, String id, String sealed) throws GeneralSecurityException {
        byte[] k = hkdf32(itemKey, new byte[0], V + "/meta");
        try { return new String(open(k, unb64u(sealed), aad("meta", kind, userId, needId(id, "id")), "decrypt"), StandardCharsets.UTF_8); } finally { wipe(k); }
    }
    public static String sealRevMeta(byte[] fileKey, String userId, String nodeId, String revId, String json) throws GeneralSecurityException {
        byte[] k = hkdf32(fileKey, new byte[0], V + "/rmeta");
        try { return b64u(seal(k, utf8(json), aad("rmeta", userId, needId(nodeId, "node id"), needId(revId, "revision id")))); } finally { wipe(k); }
    }
    public static String openRevMeta(byte[] fileKey, String userId, String nodeId, String revId, String sealed) throws GeneralSecurityException {
        byte[] k = hkdf32(fileKey, new byte[0], V + "/rmeta");
        try { return new String(open(k, unb64u(sealed), aad("rmeta", userId, needId(nodeId, "node id"), needId(revId, "revision id")), "decrypt"), StandardCharsets.UTF_8); } finally { wipe(k); }
    }
    public static String sealDeviceMeta(byte[] dvk, String userId, String deviceId, String json) throws GeneralSecurityException {
        return b64u(seal(dvk, utf8(json), aad("device", userId, deviceId)));
    }
    public static String openDeviceMeta(byte[] dvk, String userId, String deviceId, String sealed) throws GeneralSecurityException {
        return new String(open(dvk, unb64u(sealed), aad("device", userId, deviceId), "decrypt"), StandardCharsets.UTF_8);
    }

    // ---------------------------------------------------------------- blobs and chunks
    /** Chunk layout for a plaintext size and the server's ciphertext chunk size. → { chunks, plainChunk, cipherSize } */
    public static long[] layout(long plainSize, int chunkSize) {
        long plainChunk = chunkSize - CHUNK_OVERHEAD;
        long chunks = Math.max(1, (plainSize + plainChunk - 1) / plainChunk);
        return new long[] { chunks, plainChunk, plainSize + chunks * CHUNK_OVERHEAD };
    }
    public static byte[] blobKey(byte[] fileKey, String blobId, String purpose) throws GeneralSecurityException {
        boolean okPurpose = false;
        for (String p : PURPOSES) okPurpose |= p.equals(purpose);
        if (!okPurpose) throw new CryptoException("bad_kind", "bad purpose");
        return hkdf32(fileKey, utf8(needId(blobId, "blob id")), V + "/blob/" + purpose);
    }
    /** Chunk context: user, node, revision, blob, purpose. */
    public static final class Ctx {
        public final String userId, nodeId, revId, blobId, purpose;
        public Ctx(String userId, String nodeId, String revId, String blobId, String purpose) {
            this.userId = userId; this.nodeId = nodeId; this.revId = revId; this.blobId = blobId; this.purpose = purpose;
        }
    }
    private static byte[] chunkAad(Ctx c, long i, long n) { return aad("chunk", c.userId, c.nodeId, c.revId, c.blobId, c.purpose, i, n, i == n - 1 ? 1 : 0); }
    public static byte[] sealChunk(byte[] bk, Ctx c, long i, long n, byte[] plain, int off, int len) throws GeneralSecurityException {
        if (i < 0 || i >= n) throw new CryptoException("bad_index", "bad index");
        byte[] iv = random(IV_LEN);
        byte[] ct = gcm(Cipher.ENCRYPT_MODE, bk, iv, chunkAad(c, i, n), plain, off, len);
        byte[] out = new byte[IV_LEN + ct.length];
        System.arraycopy(iv, 0, out, 0, IV_LEN);
        System.arraycopy(ct, 0, out, IV_LEN, ct.length);
        return out;
    }
    public static byte[] openChunk(byte[] bk, Ctx c, long i, long n, byte[] sealed) throws GeneralSecurityException {
        if (sealed == null || sealed.length < CHUNK_OVERHEAD) throw new CryptoException("format", "short chunk");
        try { return gcm(Cipher.DECRYPT_MODE, bk, Arrays.copyOfRange(sealed, 0, IV_LEN), chunkAad(c, i, n), sealed, IV_LEN, sealed.length - IV_LEN); }
        catch (GeneralSecurityException e) { throw new CryptoException("decrypt", "chunk decryption failed"); }
    }
    /** A small object (thumbnail, preview ≤ one chunk) sealed as chunk 0 of 1. */
    public static byte[] sealSmall(byte[] fileKey, Ctx c, byte[] plain) throws GeneralSecurityException {
        byte[] bk = blobKey(fileKey, c.blobId, c.purpose);
        try { return sealChunk(bk, c, 0, 1, plain, 0, plain.length); } finally { wipe(bk); }
    }

    // ---------------------------------------------------------------- content digest + keyed dedupe hash
    /** Streaming content digest: feed the plaintext in order, then finish(). */
    public static final class Digest {
        private final MessageDigest seg, all;
        private long inSeg = 0, total = 0;
        private int segments = 0;
        public Digest() {
            try { seg = MessageDigest.getInstance("SHA-256"); all = MessageDigest.getInstance("SHA-256"); }
            catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
        }
        public void update(byte[] b, int off, int len) {
            while (len > 0) {
                int n = (int) Math.min(len, SEGMENT - inSeg);
                seg.update(b, off, n);
                inSeg += n; total += n; off += n; len -= n;
                if (inSeg == SEGMENT) { all.update(seg.digest()); segments++; inSeg = 0; }
            }
        }
        public byte[] finish() {
            // the JS version hashes max(1, ceil(size / SEGMENT)) segments: an empty file is one empty segment
            if (inSeg > 0 || segments == 0) { all.update(seg.digest()); segments++; }
            return all.digest();
        }
        public long size() { return total; }
    }
    public static byte[] contentDigest(byte[] data) {
        Digest d = new Digest();
        d.update(data, 0, data.length);
        return d.finish();
    }
    public static String dedupeHash(byte[] dk, byte[] digest) throws GeneralSecurityException {
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        byte[] p = utf8(V + "|dedupe|");
        msg.write(p, 0, p.length);
        msg.write(digest, 0, digest.length);
        return b64u(hmac(dk).doFinal(msg.toByteArray()));
    }
}
