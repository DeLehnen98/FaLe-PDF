package dev.fale.one;

// DEBUG BUILDS ONLY: FaleDebug.cryptoSelfTest({vectors}) → CryptoSelfTest.run (Java opens JS-sealed vectors and
// seals its own for the JS side). Called by the emulator smoke test over the WebView (scripts/android-one-e2e).
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

@CapacitorPlugin(name = "FaleDebug")
public class FaleDebugPlugin extends Plugin {
    @PluginMethod
    public void cryptoSelfTest(final PluginCall call) {
        final JSObject v = call.getObject("vectors", new JSObject());
        new Thread(() -> {
            try {
                Map<String, String> in = new HashMap<>();
                for (Iterator<String> it = v.keys(); it.hasNext(); ) { String k = it.next(); in.put(k, String.valueOf(v.get(k))); }
                Map<String, String> out = CryptoSelfTest.run(in);
                JSObject r = new JSObject();
                for (Map.Entry<String, String> e : out.entrySet()) r.put(e.getKey(), e.getValue());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("self test failed: " + e.getMessage(), "FAILED");
            }
        }).start();
    }
}
