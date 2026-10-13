# Upload-Schlüssel (Keystore) einrichten – einmalig

Damit GitHub Actions eine **signierte** App bauen kann (APK zum Installieren und AAB für Google Play),
brauchst du einen eigenen Schlüssel. Den erzeugst du **einmal** und bewahrst ihn **für immer** auf.

## Warum ist der Schlüssel so wichtig?

- Android installiert ein Update nur, wenn es mit **demselben Schlüssel** signiert ist wie die
  installierte Version. Ohne den Schlüssel kannst du keine Updates mehr ausliefern – die Nutzer
  müssten die App löschen (und verlieren dabei ihre Dateien in der App).
- Bei Google Play ist es der **Upload-Schlüssel**. Geht er verloren, kann man ihn bei Google zwar
  zurücksetzen lassen (Play App Signing), das dauert aber und ist mühsam.
- **Sicherung:** Die Datei `fale-upload.jks` **und** die Passwörter an mindestens zwei Orten sichern
  (z. B. Passwort-Manager + USB-Stick/verschlüsselte Cloud). **Niemals** ins Git-Repo hochladen
  (`.gitignore` schließt `*.jks` aus).

## 1. Schlüssel erzeugen (am PC)

Du brauchst Java (ist bei Android Studio dabei, oder „Temurin JDK“ von adoptium.net installieren).

**Windows (PowerShell)** – falls `keytool` nicht gefunden wird, den vollen Pfad nehmen, z. B.
`& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"`:

```powershell
keytool -genkeypair -v -keystore fale-upload.jks -storetype JKS -alias fale -keyalg RSA -keysize 4096 -validity 10000
```

**macOS / Linux:**

```bash
keytool -genkeypair -v -keystore fale-upload.jks -storetype JKS -alias fale -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` fragt nach:
- einem **Keystore-Passwort** (gut merken/notieren),
- Name, Organisation, Ort, Land (z. B. `DE`) – frei wählbar, ist nicht öffentlich sichtbar,
- am Ende ggf. nach einem **Schlüssel-Passwort** – einfach Enter drücken, dann ist es gleich dem
  Keystore-Passwort.

Der **Alias** ist `fale` (steht im Befehl oben).

## 2. Schlüssel in Text umwandeln (Base64)

GitHub-Secrets können nur Text speichern, deshalb wird die Datei als Base64-Text gespeichert.

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("fale-upload.jks")) | Set-Content -NoNewline fale-upload.b64.txt
```

**macOS:** `base64 -i fale-upload.jks | tr -d '\n' > fale-upload.b64.txt`
**Linux:** `base64 -w0 fale-upload.jks > fale-upload.b64.txt`

Den Inhalt von `fale-upload.b64.txt` brauchst du gleich (ein langer Text ohne Zeilenumbrüche).
Die `.b64.txt`-Datei danach löschen – die `.jks` ist die eigentliche Sicherung.

## 3. Die 4 Secrets bei GitHub eintragen (geht auch am Handy)

1. Im Browser **github.com** öffnen → dein Repository (z. B. `FalePDF`).
   Am Handy ggf. im Browsermenü „Desktop-Website“ wählen.
2. **Settings** → links **Secrets and variables** → **Actions**.
3. Viermal **New repository secret** und genau diese Namen verwenden:

| Name | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | der komplette Text aus `fale-upload.b64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | das Keystore-Passwort |
| `ANDROID_KEY_ALIAS` | `fale` |
| `ANDROID_KEY_PASSWORD` | das Schlüssel-Passwort (meist gleich dem Keystore-Passwort) |

Tipp Handy: Den Base64-Text am PC in eine Notiz/E-Mail an dich selbst kopieren ist bequem, aber
lösche sie danach wieder. Am einfachsten trägst du dieses eine Secret direkt am PC ein.

## 4. Testen

- Unter **Actions** → Workflow **Android** → **Run workflow** starten.
- Nach ~10 Minuten erscheint unten beim Lauf das Paket **FaLe-PDF-…-android** mit
  - `FaLe-PDF-x.y.z.apk` – signiert, zum Installieren auf dem Handy,
  - `FaLe-PDF-x.y.z.aab` – für Google Play,
  - `FaLe-PDF-x.y.z-debug.apk` – Testversion (anderer Schlüssel, nicht über die signierte installierbar).
- Für einen Download direkt am Handy einen Tag pushen (`git tag v2.0.0 && git push --tags`): dann
  hängen die Dateien an einem Eintrag unter **Releases**.

## 5. APK am Handy installieren

1. APK herunterladen (Releases-Seite), antippen.
2. Android fragt nach „Installation aus unbekannten Quellen“ für den Browser/Dateimanager → erlauben.
3. Updates: neue signierte APK genauso installieren – Dateien in der App bleiben erhalten.
