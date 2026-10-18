"""Fixture: a minimal Android project as `npx cap add android` (Capacitor 8 template) generates it
for appId dev.fale.pdf, plus compile stubs for the Android/Capacitor classes our Java uses."""
import os, struct, zlib

MANIFEST = '''<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
'''

# Capacitor 7 variant (no density in configChanges) is produced by replacing the string below.
MANIFEST_CAP7 = MANIFEST.replace('|navigation|density"', '|navigation"')

BUILD_GRADLE = '''apply plugin: 'com.android.application'

android {
    namespace "dev.fale.pdf"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "dev.fale.pdf"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
             // Files and dirs to omit from the packaged assets dir, modified to accommodate modern web apps.
             // Default: https://android.googlesource.com/platform/frameworks/base/+/282e181b58cf72b6ca770dc7ca5f91f135444502/tools/aapt/AaptAssets.cpp#61
            ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

repositories {
    flatDir{
        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
    implementation project(':capacitor-android')
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
    implementation project(':capacitor-cordova-android-plugins')
}

apply from: 'capacitor.build.gradle'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
'''

VARIABLES = '''ext {
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.11.0'
    androidxAppCompatVersion = '1.7.1'
    androidxCoordinatorLayoutVersion = '1.3.0'
    androidxCoreVersion = '1.17.0'
    androidxFragmentVersion = '1.8.9'
    coreSplashScreenVersion = '1.2.0'
    androidxWebkitVersion = '1.14.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.3.0'
    androidxEspressoCoreVersion = '3.7.0'
    cordovaAndroidVersion = '14.0.1'
}
'''
VARIABLES_CAP7 = VARIABLES.replace('minSdkVersion = 24', 'minSdkVersion = 23').replace('compileSdkVersion = 36', 'compileSdkVersion = 35').replace('targetSdkVersion = 36', 'targetSdkVersion = 35')

MAIN_ACTIVITY = '''package dev.fale.pdf;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
'''

STRINGS = '''<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">FaLe PDF</string>
    <string name="title_activity_main">FaLe PDF</string>
    <string name="package_name">dev.fale.pdf</string>
    <string name="custom_url_scheme">dev.fale.pdf</string>
</resources>
'''

STYLES = '''<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <!-- Customize your theme here. -->
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
    </style>


    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>
</resources>
'''

ADAPTIVE = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''

FILE_PATHS = '''<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
</paths>
'''


def tiny_png(w=4, h=4):
    raw = b''.join(b'\x00' + b'\x10\x20\x30\xff' * w for _ in range(h))
    def ch(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')


def make_android(root, cap7=False):
    def w(rel, content):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb' if isinstance(content, bytes) else 'w', **({} if isinstance(content, bytes) else {'encoding': 'utf-8'})) as f:
            f.write(content)
    w('variables.gradle', VARIABLES_CAP7 if cap7 else VARIABLES)
    w('build.gradle', '// top-level\n')
    w('app/build.gradle', BUILD_GRADLE)
    w('app/src/main/AndroidManifest.xml', MANIFEST_CAP7 if cap7 else MANIFEST)
    w('app/src/main/java/dev/fale/pdf/MainActivity.java', MAIN_ACTIVITY)
    w('app/src/main/res/values/strings.xml', STRINGS)
    w('app/src/main/res/values/styles.xml', STYLES)
    w('app/src/main/res/values/ic_launcher_background.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')
    w('app/src/main/res/xml/file_paths.xml', FILE_PATHS)
    w('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', ADAPTIVE)
    w('app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', ADAPTIVE)
    w('app/src/main/res/drawable/splash.png', tiny_png())
    for d in ['drawable-land-hdpi', 'drawable-port-xxhdpi', 'drawable-port-mdpi']:
        w(f'app/src/main/res/{d}/splash.png', tiny_png())
    for d in ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']:
        for n in ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']:
            w(f'app/src/main/res/mipmap-{d}/{n}', tiny_png())


# ---- Java compile stubs: real signatures of the Android / AndroidX / Capacitor APIs we use ----
STUBS = {
    'android/os/Parcelable.java': 'package android.os; public interface Parcelable {}',
    'android/os/Bundle.java': 'package android.os; public class Bundle {}',
    'android/os/Build.java': 'package android.os; public class Build { public static class VERSION { public static final int SDK_INT = 36; } }',
    'android/net/Uri.java': 'package android.net; public abstract class Uri implements android.os.Parcelable { public abstract String getLastPathSegment(); public abstract String getScheme(); public abstract String getAuthority(); public abstract String getPath(); public static Uri parse(String s) { return null; } }',
    'android/content/pm/ApplicationInfo.java': 'package android.content.pm; public class ApplicationInfo { public static final int FLAG_DEBUGGABLE = 1 << 1; public int flags; public String dataDir; }',
    'android/view/WindowManager.java': 'package android.view; public interface WindowManager { public static class LayoutParams { public static final int FLAG_SECURE = 0x00002000; } }',
    'android/webkit/WebSettings.java': 'package android.webkit; public abstract class WebSettings { public static final int MIXED_CONTENT_NEVER_ALLOW = 1; public abstract void setAllowFileAccess(boolean a); public abstract void setAllowContentAccess(boolean a); @Deprecated public abstract void setAllowFileAccessFromFileURLs(boolean f); @Deprecated public abstract void setAllowUniversalAccessFromFileURLs(boolean f); public abstract void setGeolocationEnabled(boolean f); public abstract void setMixedContentMode(int m); }',
    'android/webkit/WebView.java': 'package android.webkit; public class WebView { public WebSettings getSettings() { return null; } public static void setWebContentsDebuggingEnabled(boolean e) {} }',
    'com/getcapacitor/Bridge.java': 'package com.getcapacitor; public class Bridge { public android.webkit.WebView getWebView() { return null; } }',
    'android/content/ClipData.java': 'package android.content; public class ClipData { public int getItemCount() { return 0; } public Item getItemAt(int i) { return null; } public static class Item { public android.net.Uri getUri() { return null; } } }',
    'android/content/Context.java': 'package android.content; public abstract class Context { public static final String PRINT_SERVICE = "print"; public Object getSystemService(String n) { return null; } public abstract ContentResolver getContentResolver(); public abstract java.io.File getCacheDir(); public abstract String getPackageName(); public abstract android.content.pm.ApplicationInfo getApplicationInfo(); }',
    'android/content/ContentResolver.java': 'package android.content; public abstract class ContentResolver { public final android.database.Cursor query(android.net.Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) { return null; } public final String getType(android.net.Uri uri) { return null; } public final java.io.InputStream openInputStream(android.net.Uri uri) throws java.io.FileNotFoundException { return null; } public final java.io.OutputStream openOutputStream(android.net.Uri uri, String mode) throws java.io.FileNotFoundException { return null; } public final android.os.ParcelFileDescriptor openFileDescriptor(android.net.Uri uri, String mode) throws java.io.FileNotFoundException { return null; } }',
    'android/content/Intent.java': '''package android.content;
public class Intent implements android.os.Parcelable {
  public static final String ACTION_VIEW = "android.intent.action.VIEW";
  public static final String ACTION_EDIT = "android.intent.action.EDIT";
  public static final String ACTION_SEND = "android.intent.action.SEND";
  public static final String ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE";
  public static final String EXTRA_STREAM = "android.intent.extra.STREAM";
  public static final String EXTRA_TEXT = "android.intent.extra.TEXT";
  public static final String EXTRA_SUBJECT = "android.intent.extra.SUBJECT";
  public static final int FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY = 0x00100000;
  public String getAction() { return null; }
  public android.net.Uri getData() { return null; }
  public String getType() { return null; }
  public int getFlags() { return 0; }
  public ClipData getClipData() { return null; }
  public boolean getBooleanExtra(String n, boolean d) { return d; }
  public String getStringExtra(String n) { return null; }
  @Deprecated public <T extends android.os.Parcelable> T getParcelableExtra(String n) { return null; }
  @Deprecated public <T extends android.os.Parcelable> java.util.ArrayList<T> getParcelableArrayListExtra(String n) { return null; }
  public Intent putExtra(String n, boolean v) { return this; }
}''',
    'android/database/Cursor.java': 'package android.database; public interface Cursor extends java.io.Closeable { boolean moveToFirst(); int getColumnIndex(String c); boolean isNull(int i); String getString(int i); long getLong(int i); void close(); }',
    'android/provider/OpenableColumns.java': 'package android.provider; public interface OpenableColumns { String DISPLAY_NAME = "_display_name"; String SIZE = "_size"; }',
    'android/graphics/Color.java': 'package android.graphics; public class Color { public static int parseColor(String s) { return 0; } }',
    'android/util/Base64.java': 'package android.util; public class Base64 { public static final int NO_WRAP = 2; public static String encodeToString(byte[] b, int f) { return ""; } }',
    'android/os/CancellationSignal.java': 'package android.os; public final class CancellationSignal { public boolean isCanceled() { return false; } }',
    'android/os/ParcelFileDescriptor.java': 'package android.os; public class ParcelFileDescriptor implements java.io.Closeable { public void close() throws java.io.IOException {} public java.io.FileDescriptor getFileDescriptor() { return null; } }',
    'android/print/PageRange.java': 'package android.print; public final class PageRange { public static final PageRange ALL_PAGES = new PageRange(); }',
    'android/print/PrintAttributes.java': 'package android.print; public final class PrintAttributes { public static final class MediaSize { public static final MediaSize ISO_A4 = new MediaSize(); } public static final class Builder { public Builder setMediaSize(MediaSize m) { return this; } public PrintAttributes build() { return new PrintAttributes(); } } }',
    'android/print/PrintDocumentInfo.java': 'package android.print; public final class PrintDocumentInfo { public static final int CONTENT_TYPE_DOCUMENT = 0; public static final int PAGE_COUNT_UNKNOWN = -1; public static final class Builder { public Builder(String n) {} public Builder setContentType(int t) { return this; } public Builder setPageCount(int c) { return this; } public PrintDocumentInfo build() { return new PrintDocumentInfo(); } } }',
    'android/print/PrintDocumentAdapter.java': 'package android.print; public abstract class PrintDocumentAdapter { public static abstract class LayoutResultCallback { public void onLayoutFinished(PrintDocumentInfo i, boolean c) {} public void onLayoutCancelled() {} public void onLayoutFailed(CharSequence e) {} } public static abstract class WriteResultCallback { public void onWriteFinished(PageRange[] p) {} public void onWriteCancelled() {} public void onWriteFailed(CharSequence e) {} } public void onStart() {} public abstract void onLayout(PrintAttributes o, PrintAttributes n, android.os.CancellationSignal c, LayoutResultCallback cb, android.os.Bundle e); public abstract void onWrite(PageRange[] p, android.os.ParcelFileDescriptor d, android.os.CancellationSignal c, WriteResultCallback cb); public void onFinish() {} }',
    'android/print/PrintJobId.java': 'package android.print; public final class PrintJobId {}',
    'android/print/PrintJob.java': 'package android.print; public final class PrintJob { public PrintJobId getId() { return null; } }',
    'android/print/PrintManager.java': 'package android.print; public final class PrintManager { public PrintJob print(String n, PrintDocumentAdapter a, PrintAttributes at) { return null; } }',
    'android/util/Log.java': 'package android.util; public final class Log { public static int w(String t, String m, Throwable e) { return 0; } public static int w(String t, String m) { return 0; } }',
    'android/view/View.java': 'package android.view; public class View { public void setBackgroundColor(int c) {} }',
    'android/view/Window.java': 'package android.view; public abstract class Window { public abstract View getDecorView(); @Deprecated public abstract void setStatusBarColor(int c); @Deprecated public abstract void setNavigationBarColor(int c); public void addFlags(int flags) {} public void clearFlags(int flags) {} }',
    'android/app/Activity.java': 'package android.app; public class Activity extends android.content.ContextWrapper { public android.content.Intent getIntent() { return null; } public android.view.Window getWindow() { return null; } public final void runOnUiThread(Runnable r) {} protected void onCreate(android.os.Bundle b) {} protected void onNewIntent(android.content.Intent i) {} }',
    'android/content/ContextWrapper.java': 'package android.content; public class ContextWrapper extends Context { public ContentResolver getContentResolver() { return null; } public java.io.File getCacheDir() { return null; } public String getPackageName() { return null; } public android.content.pm.ApplicationInfo getApplicationInfo() { return null; } }',
    'androidx/appcompat/app/AppCompatActivity.java': 'package androidx.appcompat.app; public class AppCompatActivity extends android.app.Activity {}',
    'androidx/core/view/WindowInsetsControllerCompat.java': 'package androidx.core.view; public final class WindowInsetsControllerCompat { public void setAppearanceLightStatusBars(boolean b) {} public void setAppearanceLightNavigationBars(boolean b) {} }',
    'androidx/core/view/WindowCompat.java': 'package androidx.core.view; public final class WindowCompat { public static WindowInsetsControllerCompat getInsetsController(android.view.Window w, android.view.View v) { return null; } }',
    'com/getcapacitor/JSObject.java': 'package com.getcapacitor; public class JSObject { public JSObject put(String k, String v) { return this; } public JSObject put(String k, int v) { return this; } public JSObject put(String k, long v) { return this; } public JSObject put(String k, boolean v) { return this; } public JSObject put(String k, Object v) { return this; } }',
    'com/getcapacitor/JSArray.java': 'package com.getcapacitor; public class JSArray { public JSArray put(Object o) { return this; } public int length() { return 0; } public String getString(int i) throws Exception { return null; } }',
    'com/getcapacitor/PluginCall.java': 'package com.getcapacitor; public class PluginCall { public String getString(String k) { return null; } public String getString(String k, String d) { return d; } public Boolean getBoolean(String k, Boolean d) { return d; } public JSArray getArray(String k) { return null; } public void resolve() {} public void resolve(JSObject o) {} public void reject(String m) {} public void reject(String m, String code) {} }',
    'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) public @interface PluginMethod { String returnType() default "promise"; }',
    'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) public @interface CapacitorPlugin { String name() default ""; }',
    'com/getcapacitor/Plugin.java': 'package com.getcapacitor; public class Plugin { public void load() {} protected void handleOnNewIntent(android.content.Intent i) {} public androidx.appcompat.app.AppCompatActivity getActivity() { return null; } public android.content.Context getContext() { return null; } protected void notifyListeners(String e, JSObject d) {} }',
    'com/getcapacitor/BridgeActivity.java': 'package com.getcapacitor; public class BridgeActivity extends androidx.appcompat.app.AppCompatActivity { public void registerPlugin(Class<? extends Plugin> p) {} public Bridge getBridge() { return null; } @Override protected void onCreate(android.os.Bundle b) {} @Override protected void onNewIntent(android.content.Intent i) {} }',
}


def make_stubs(root):
    for rel, src in STUBS.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f:
            f.write(src + '\n')
    return [os.path.join(root, r) for r in STUBS]
