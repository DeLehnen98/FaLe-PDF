# FaLe PDF

Privates Büro für PDF, Dokumente, Tabellen und Präsentationen – offline, ohne Konto, ohne Uploads.
Eine einzige Codebasis (Vanilla-JS, ES-Module, kein Framework, kein Bundler) läuft als

- **Web-App / PWA** (Vercel oder jeder statische Host, Service Worker für Offline-Betrieb) und
- **Android-App** (Capacitor 8, APK zum Sideloaden und AAB für Google Play).

## Projektstruktur

| Pfad | Inhalt |
|---|---|
| `index.html`, `styles.css`, `css/`, `icons/`, `manifest.webmanifest`, `sw.js` | App-Shell und PWA |
| `js/app.js` | Routing, Navigation, Start, eingehende Dateien |
| `js/platform.js` | **Plattform-Schicht Web ↔ Android** (siehe unten) |
| `js/ui.js` | Toasts, Dialoge, Menüs, `downloadBlob`/`shareBlob` (→ platform.js) |
| `js/tools/` | PDF-Werkzeuge · `js/office/` Dokumente/Tabellen/Präsentationen · `js/extras/` |
| `vendor/`, `vendor-extra/` | eingecheckte Bibliotheken (pdf.js, pdf-lib, JSZip, docx, PptxGenJS) |
| `datenschutz.html`, `impressum.html` | Rechtstexte (Platzhalter `[…]` vor Veröffentlichung ausfüllen) |
| `capacitor.config.json` | Capacitor-Konfiguration (App-ID, Name, webDir) |
| `scripts/vercel-build.mjs` | Build nach `dist/` (`--native` für Android) |
| `scripts/cap-patch-android.mjs`, `scripts/cap-png.mjs` | patcht das generierte `android/`-Projekt |
| `.github/workflows/android.yml` | baut APK/AAB in GitHub Actions |
| `store/` | Play-Store-Texte, Datensicherheit, Release-Checkliste, Keystore-Anleitung |

## Web-Build

```bash
npm install            # nur nötig, wenn vendor/ aus npm neu befüllt werden soll
npm run build          # → dist/ (selbstständig, inkl. Service-Worker-Precache-Liste)
```

Vercel baut automatisch über `vercel.json` (`node scripts/vercel-build.mjs`, Ausgabe `dist`).
Lokal testen: `python3 -m http.server 8080` im Projektordner oder in `dist/`.

## Android

### App-ID – nur an EINER Stelle

`appId` (aktuell `dev.fale.pdf`) und `appName` stehen **nur** in `capacitor.config.json`.
`npx cap add android` und `scripts/cap-patch-android.mjs` übernehmen sie von dort.

> ⚠️ **Die App-ID ist nach der ersten Veröffentlichung bei Google Play endgültig** und kann nie
> wieder geändert werden (eine neue ID = eine neue App ohne Bewertungen/Nutzer).
>
> ⚠️ Ebenfalls nie ändern: `server.androidScheme` (`https`) und `server.hostname` (`localhost`).
> Sie bilden den Ursprung der WebView – eine Änderung macht alle in der App gespeicherten
> Dateien (IndexedDB) unerreichbar.

### Build in GitHub Actions (empfohlen)

Der Ordner `android/` wird **nicht** eingecheckt. Der Workflow `.github/workflows/android.yml`
erzeugt ihn bei jedem Lauf neu:

1. `npm ci || npm install`
2. `node scripts/vercel-build.mjs --native` → `dist/` ohne `viewport-fit=cover`, ohne `vercel.json`
3. `npx cap add android` (falls nötig) + `npx cap sync android`
4. `node scripts/cap-patch-android.mjs` (deterministisch, idempotent)
5. `./gradlew assembleDebug`, und wenn die Signatur-Secrets gesetzt sind `bundleRelease assembleRelease`
6. Artefakte hochladen; bei Tags `v*` zusätzlich an ein GitHub-Release hängen

Auslöser: Push auf `main`, Tags `v*`, manuell („Run workflow“). Signatur: siehe
[store/KEYSTORE.md](store/KEYSTORE.md) (Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).

### Lokal (mit Android Studio + SDK)

```bash
npm install
npm run android:add      # einmalig: build --native + cap add android + Patch
npm run android:sync     # nach jeder Änderung am Web-Code
npm run android:open     # Android Studio öffnen → Run
```

### Was der Patch macht (`scripts/cap-patch-android.mjs`)

- `applicationId`, **versionName** = `package.json` `version`, **versionCode** = `major*10000 + minor*100 + patch`
  (Override: `ANDROID_VERSION_CODE`, `ANDROID_VERSION_NAME`), compile/targetSdk ≥ 36 (`ANDROID_TARGET_SDK`)
- Release-Signatur aus `FALE_KEYSTORE_FILE`, `FALE_KEYSTORE_PASSWORD`, `FALE_KEY_ALIAS`, `FALE_KEY_PASSWORD`
- Manifest: Kamera (optional als Hardware), Benachrichtigungen, Vibration, Speicher bis Android 10,
  `adjustResize`, Intent-Filter **VIEW / SEND / SEND_MULTIPLE** für PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, Bilder
- `MainActivity.java` + `FaleIncomingPlugin.java` (eingehende Dateien, Statusleisten-Farben)
  + `FalePrintPlugin.java` (Drucken über das Android-Druckmenü – die WebView ignoriert `window.print()`)
- FileProvider-Pfade (`res/xml/file_paths.xml`) decken `cache/share/` für das Teilen ab
- Theme-/Splash-Farben (`#F5F6FB` hell, `#171542` dunkel), Splash ohne Capacitor-Logo
- Launcher-Icons (adaptiv + monochrom + Legacy) und Benachrichtigungs-Icon aus `icons/*.png`
  (reiner Node-PNG-Code, deterministisch)

Der Patch ist idempotent: mehrfaches Ausführen ändert nichts mehr.

### Kamera, Dateien, Zurück-Taste

- `getUserMedia` und `<input type=file capture>` funktionieren in der WebView: Capacitors
  `BridgeWebChromeClient` fragt die Laufzeit-Berechtigung CAMERA an, sobald die Seite die Kamera will
  (die Berechtigung steht im Manifest).
- `<input type=file>` öffnet die System-Dateiauswahl.
- **Zurück-Taste:** schließt erst Dialoge/Menüs, navigiert dann in der App zurück und beendet die App
  auf der Startseite. Eigene Behandlung: `window.addEventListener('fale:back', e => { … e.preventDefault(); })`.

## `js/platform.js` – API

Alle Funktionen haben einen Web-Fallback und können überall importiert werden.

| Funktion | Web | Android |
|---|---|---|
| `isNative()` | `false` | `true` |
| `saveFile(blobOrBytes, name, mime)` → `{ok, where}` | normaler Download | `Dokumente/FaLe PDF/<name>` (eindeutiger Name, Toast), Fallback Teilen-Dialog |
| `shareFile(blobOrBytes, name, mime, {title, text})` → `{ok, method, cancelled}` | Web Share API (Fallback Download) | Cache-Datei + System-Teilen (Share-Plugin; Abbrechen ≠ Fehler, Fehler-Toast mit „Herunterladen“) |
| `shareTextOrLink({title, text, url})` → `{ok, cancelled}` | Web Share API | Share-Plugin (kein `navigator.share` in der WebView) |
| `printPdf(bytes, name)` → `{ok, method}` | `{ok:false, method:'web'}` – der Viewer druckt per `window.print()` | PDF → `cache/print/` → FalePrint → System-Druckdialog (Fallback: Teilen) |
| `scheduleNotification({id, at, title, body, route})` → `boolean` | Notification-API, solange die Seite offen ist | LocalNotifications (Erlaubnis wird bei Bedarf gefragt; Tippen öffnet `route`) |
| `cancelNotification(id)` | ✓ | ✓ |
| `listReminders()`, `dueReminders({remove})` | in-App-Anzeige fälliger Erinnerungen (localStorage) | dto. |
| `onIncomingFiles(cb(files, {source}))` → `unsubscribe` | `launchQueue` (Datei-Handler) | „Öffnen mit“ / „Teilen“ (FaleIncoming) |
| `haptic(kind)` | `navigator.vibrate` (Touch-Geräte) | Haptics-Plugin |
| `setStatusBarTheme(dark)` | – (theme.js setzt `theme-color`) | Status-/Navigationsleiste (läuft automatisch bei Theme-Wechsel) |
| `openLegalPage('datenschutz.html')` | neuer Tab | Dialog in der App |

`downloadBlob`/`shareBlob` aus `js/ui.js` delegieren an `saveFile`/`shareFile` – Werkzeuge müssen nichts
Besonderes tun. Ende-zu-Ende-Test der echten App: `.github/workflows/android-e2e.yml` (Emulator API 34 + 36,
nach jedem erfolgreichen „Android“-Build; Drucken, Teilen, Herunterladen, Öffnen mit, Text bearbeiten,
Unterschreiben – Ergebnisse als Annotationen, Screenshots als Artefakt). Der Service Worker wird in der Android-App nicht registriert (Assets liegen lokal).

## Release

Siehe [store/RELEASE-CHECKLIST.md](store/RELEASE-CHECKLIST.md). Kurz: `version` in `package.json` erhöhen,
`git tag vX.Y.Z && git push --tags`, AAB aus dem GitHub-Release in die Play Console hochladen.
