package dev.fale.one;

// JVM entry point of the Java ↔ JS crypto cross-test (CI build job, scripts/android-one-e2e/crypto-cross.mjs):
//   java dev.fale.one.CryptoCrossTest <js-vectors.properties> <java-out.properties>
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

public final class CryptoCrossTest {
    public static void main(String[] args) throws Exception {
        Properties in = new Properties();
        try (InputStreamReader r = new InputStreamReader(new FileInputStream(args[0]), StandardCharsets.UTF_8)) { in.load(r); }
        Map<String, String> m = new HashMap<>();
        for (String k : in.stringPropertyNames()) m.put(k, in.getProperty(k));
        Map<String, String> out = CryptoSelfTest.run(m);
        Properties p = new Properties();
        p.putAll(out);
        try (OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8)) { p.store(w, null); }
        System.out.println("CryptoSelfTest ok=" + out.get("ok"));
    }
}
