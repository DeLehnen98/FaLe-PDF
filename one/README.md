# FaLe One – web app (FaLe Drive + FaLe Fotos)

A phone-first PWA for the end-to-end encrypted FaLe One backend. The API contract is in `docs/FALE-ONE-API.md`.
This folder is a static site with no build step. It is deployed as its own Vercel project.

## Deploy (Vercel project `fale-one`)

| Setting | Value |
|---|---|
| Root directory | `one` |
| Framework preset | Other. No install command, no build command, output directory `.` (already set in `one/vercel.json`) |
| Ignored Build Step | `git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .` |
| Domain | `fale-one.vercel.app`; custom domain `faleone.com` (`www.faleone.com` and `one.fale.network` redirect to it) – switch: `docs/DOMAINS-SWITCH.md` |
| Env | none (the app has no secrets) |

The FaLe PDF project serves the API at `https://fale-pdf.vercel.app`. It needs:

- `ONE_ENABLED=1`, which requires the FaLe-Konto settings described in contract §1.
- Its CORS default list, which already allows `https://fale-one.vercel.app`, `https://faleone.com` and `https://one.fale.network`.

So that pushes which only touch `one/` do not rebuild FaLe PDF, change its Ignored Build Step to:

```
git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- . ':(exclude)network' ':(exclude)one'
```

FaLe PDF's build skips `one/` either way (see `APP_SKIP` in `scripts/vercel-build.mjs`).

If Supabase gets a custom domain, or S3 direct up- and downloads are switched on, add those origins to `connect-src` in `one/vercel.json`.

## Shared code (never edit the copies)

`node scripts/sync-one-shared.mjs` copies the following into `one/`:

- the normative crypto and client: `js/one/{crypto,api}.js`, `js/sync/crypto.js` (master key) and `js/share/crypto.js` (links)
- pdf.js, DOMPurify, the Bricolage font and `network/assets/fale-tokens.css`

The same script regenerates the `sw.js` precache list. CI runs it with `--check`.

## Architecture

| Part | Where |
|---|---|
| UI (DOM nodes only, no HTML strings) | `js/app.js`, `js/views/*` |
| Account, sign-in with an e-mail code | `js/auth.js` |
| Master key: set up, unlock, change password, new recovery key (contract §5.1) | `js/keys.js` |
| Engine in a module worker: change feed, decryption, thumbnails, resumable uploads, downloads with digest check, offline copies, backup reports, albums, Takeout import, export listing, share links | `js/worker.js` |
| Page side of the engine: state, batched thumbnails, video poster frames / HEIC decode the worker cannot do | `js/engine.js` |
| EXIF / MP4 metadata, thumbnails (256 px) and previews (1600 px) | `js/media.js` |
| Google Takeout (streamed ZIP reader, JSON sidecars, album folders) | `js/takeout.js`, `js/unzip.js` |
| Export everything (folder via File System Access, or ZIP parts) | `js/export.js` |
| Notfallzugang: setup wizard, safety code, request / veto / revoke, log, "Für andere da", read-only browser (contract §12) | `js/views/notfall.js` (UI), `js/worker.js` (crypto, key sync after every sync) |

## Android app (`one-android/`, sideload APK)

The same web app runs in a Capacitor shell (`dev.fale.one`). Nothing in `one/` changes for the browser: native code paths check `isNativeApp()` (`js/config.js`), and `js/native.js` is imported only inside the app (it is not in the web precache list).

| Part | Where |
|---|---|
| Capacitor project (config, minimal `package.json`; deps come from the repo's `node_modules`) | `one-android/` |
| Web files: a copy of `one/` without `sw.js`, `vercel.json`, `README.md` (gitignored) | `one-android/www/` ← `node scripts/cap-patch-one-android.mjs --web` |
| Native project, generated on every CI run (gitignored) | `one-android/android/` ← `cap add/sync android` + `node scripts/cap-patch-one-android.mjs` |
| Plugins `FaleMedia` (MediaStore listing, photo permissions) and `FaleSystem` (bar colours, network type, app settings, resume event), MainActivity (back button) | written by `scripts/cap-patch-one-android.mjs` |
| Build → pre-release `one-android-latest` (`FaLe-One-<version>-debug.apk`), smoke test on emulators API 34 + 36 | `.github/workflows/android-one.yml`, `scripts/android-one-e2e/` |

The version is `VERSION` in `js/config.js`. The app has no service worker and no ads, purchases or paid features.

**Automatic backup (first version).** Off until the user switches it on in Fotos or Einstellungen (a short explanation comes first, then Android's photo permission). Options: „Auch Videos sichern“ (off), „Nur im WLAN“ (on; if the device cannot tell the network type, it backs up anyway and says so). A run pages through MediaStore after a per-account checkpoint (`date_added`, `_id`), reads each original through Capacitor's local server (`ACCESS_MEDIA_LOCATION` + `setRequireOriginal`, so EXIF GPS stays and is encrypted like everything else), and hands 12 files / 160 MB at a time to the normal backup path (keyed hash, already stored photos are skipped). The checkpoint moves only after a batch is stored; network or quota problems stop the run and the next one continues from there. Runs start after unlock, when the app returns to the foreground and every 10 minutes while it is visible; never two at once.

What it does **not** do yet: back up while the app is closed or in the background (needs a WorkManager job), free up space on the phone, or let you choose folders. Android 14 partial access backs up only the photos the user picked.

## Data on the device (decision)

- **Master key:** a non-extractable `CryptoKey` in IndexedDB.
- **Local index:** the decrypted names and metadata plus the server's encrypted records. It is persisted as one IndexedDB record, sealed with a local key `HKDF(MK, "fale-one-local-v1")` (AES-256-GCM). Index and feed cursor are written together.
- **Thumbnails:** sealed with the same local key.
- **Offline files:** the server's ciphertext chunks, unchanged. They are decrypted only when opened.
- **Decrypted file contents:** only in memory, as Blobs and object URLs revoked on close. Never in Cache Storage. The service worker caches the app shell only and never touches API traffic.
- **Resumable Drive uploads across a reload:** the file (≤ 512 MB) is kept in IndexedDB until the upload finishes or is cancelled. The job description is sealed.
- **Photo backups** are not copied. After an app restart, picking the same photos again is cheap because already stored content is skipped by its keyed hash.
- **Share target:** shared files wait in a local inbox until the app picks them up.

## Known limitations

- **"In FaLe PDF öffnen":** both apps are cross-origin and isolated (COOP), so a page cannot hand a file to the other directly.
  - On phones the app uses the system share sheet, where FaLe PDF is a share target.
  - Elsewhere the decrypted file is downloaded and FaLe PDF opens in a new tab.
- **Video and audio** are decrypted completely into memory before playback. There is no chunked streaming through the service worker yet.
- **HEIC/RAW:** the original is always stored. A thumbnail exists only if the device's browser can decode the format (Safari can, Chrome on Android/desktop usually cannot).
- **Free up space on the phone** ("Nur vom Gerät entfernen") and **background backup** are not built yet, also not in the Android app (its automatic backup runs while the app is open). On the web, backup happens when you pick photos, and deleting means "Überall löschen" with a 30-day trash.
- **Sharing** is per file, via a link (contract §7.9: max 50 MB, 7 days). Sharing folders or albums natively comes later.

Live (Beta): https://fale-one.vercel.app – Vercel-Projekt `fale-one`, Root `one`.
