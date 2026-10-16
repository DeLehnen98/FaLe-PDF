package dev.fale.one;

// Release builds: no test hooks. (The debug variant in native/debug/java can point the background backup at a
// local mock API for the emulator test and registers the FaleDebug plugin; none of that exists in release builds.)
import android.content.Context;
import com.getcapacitor.BridgeActivity;

final class DebugHooks {
    private DebugHooks() {}
    static String apiOverride(Context c) { return null; }
    static void registerPlugins(BridgeActivity a) { }
}
