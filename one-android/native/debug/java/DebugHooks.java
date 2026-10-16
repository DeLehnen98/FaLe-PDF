package dev.fale.one;

// DEBUG BUILDS ONLY (src/debug): test hooks for the emulator smoke test (scripts/android-one-e2e).
//   apiOverride  the background backup talks to this origin instead of the real API + FaLe-Konto (a mock server on
//                the CI runner, reachable from the emulator as http://10.0.2.2:<port>); set by FaleDebugReceiver
//   FaleDebug    plugin with the Java ↔ JS crypto self-test
// Release builds compile native/release/java/DebugHooks.java instead, which has no override and no plugin.
import android.content.Context;
import com.getcapacitor.BridgeActivity;

final class DebugHooks {
    private DebugHooks() {}
    static String apiOverride(Context c) {
        String v = c.getApplicationContext().getSharedPreferences("fale_debug", Context.MODE_PRIVATE).getString("api", null);
        return v != null && v.matches("^http://(10\\.0\\.2\\.2|127\\.0\\.0\\.1|localhost)(:\\d+)?$") ? v : null;
    }
    static void registerPlugins(BridgeActivity a) { a.registerPlugin(FaleDebugPlugin.class); }
}
