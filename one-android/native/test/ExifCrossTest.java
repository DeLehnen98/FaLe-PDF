package dev.fale.one;

// JVM: BackupExif (Java port of media.js) on files → one JSON line per file: {"exif": exifToMeta(parseExif(head 512 KB)), "mp4": mp4Meta(head 1 MB)}
//   java dev.fale.one.ExifCrossTest <file>…   (scripts/android-one-e2e/crypto-cross.mjs compares with the JS parser)
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

public final class ExifCrossTest {
    public static void main(String[] args) throws Exception {
        for (String f : args) {
            byte[] all = Files.readAllBytes(Paths.get(f));
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("exif", BackupExif.exifToMeta(BackupExif.parseExif(Arrays.copyOf(all, Math.min(all.length, 512 * 1024)))));
            o.put("mp4", BackupExif.mp4Meta(Arrays.copyOf(all, Math.min(all.length, 1024 * 1024))));
            System.out.println(BackupExif.json(o));
        }
    }
}
