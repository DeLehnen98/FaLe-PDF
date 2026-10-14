# Datensicherheit („Data safety“) – Antworten für die Play Console

Gilt für FaLe PDF **mit** optionaler Cloud-KI, freiwilligen Werbevideos (Google AdMob, Rewarded Ads)
und dem Abo „FaLe Plus“ (Google Play Billing). Kein Analyse- oder Crash-SDK, kein Benutzerkonto.
**Wenn sich etwas ändert (neues SDK, Cloud-Sync, Login, anderer KI-Anbieter), müssen diese Antworten
UND `datenschutz.html` angepasst werden.**

Hintergrund (Google-Definitionen):
- Daten, die nur auf dem Gerät verarbeitet werden, gelten **nicht** als „erhoben“.
- Daten, die die App an einen Server sendet, gelten als **erhoben** – auch wenn sie nur kurz
  („ephemeral“) verarbeitet werden. Kurzzeitige Verarbeitung kann aber angegeben werden.
- Die Weitergabe an einen **Dienstleister**, der in unserem Auftrag verarbeitet (KI-Anbieter, Hosting),
  gilt **nicht** als „Teilen“. Daten, die ein **SDK eines Dritten** (AdMob) für eigene Zwecke erhebt,
  gelten als **geteilt**.
- Dateien, die die Nutzerin selbst über das Android-Teilen-Menü weitergibt, zählen nicht.

## Abschnitt „Datenerhebung und Sicherheit“

| Frage | Antwort |
|---|---|
| Erhebt oder teilt deine App erforderliche Nutzerdatentypen? | **Ja** |
| Werden alle erhobenen Daten bei der Übertragung verschlüsselt? | **Ja** (HTTPS/TLS) |
| Können Nutzer das Löschen ihrer Daten anfordern? | **Ja** – in der App: „KI-Assistent → KI-Einstellungen → Einwilligung widerrufen“ löscht die Gerätekennung; Zähler werden ohnehin nach 30 Tagen gelöscht. Außerdem per E-Mail an `[E-MAIL-ADRESSE]`. |
| Konto-Erstellung | **Keine** Kontoerstellung → kein Link zur Kontolöschung nötig. |

## Datentypen

| Datentyp (Play-Kategorie) | Erhoben? | Geteilt? | Kurzzeitig verarbeitet? | Pflicht/optional | Zwecke |
|---|---|---|---|---|---|
| **App-Aktivitäten → Andere nutzergenerierte Inhalte** (Text, den die Nutzerin an die Cloud-KI schickt: Fragen, Dokumentausschnitte, markierter Text, Anliegen für Briefe, per OCR erkannter Text) | Ja | Nein (KI-Anbieter = Dienstleister) | **Ja** (nicht gespeichert) | **Optional** (nur nach Einwilligung) | App-Funktionalität |
| **Geräte- oder andere IDs** – pseudonyme Gerätekennung (zufällig, in der App erzeugt) | Ja | Nein | Nein (Zähler 30 Tage) | Optional | App-Funktionalität, Betrugsprävention/Sicherheit |
| **Geräte- oder andere IDs** – **Werbe-ID** (durch Google AdMob, nur bei Werbevideos) | Ja | **Ja** (Google AdMob) | Nein | Optional | Werbung oder Marketing, Analysen (durch Google), Betrugsprävention |
| **App-Info und Leistung → Diagnosedaten** und **App-Aktivitäten → App-Interaktionen** (durch das AdMob-SDK beim Werbevideo) | Ja | **Ja** (Google AdMob) | Nein | Optional | Werbung, Analysen (Google), Betrugsprävention |
| **Standort → Ungefährer Standort** (AdMob leitet ihn aus der IP-Adresse ab) | Ja | **Ja** (Google AdMob) | Nein | Optional | Werbung, Betrugsprävention |
| **Finanzinformationen → Kaufverlauf** (nur Prüfung von „FaLe Plus“: Produkt, Ablaufdatum, Hash des Kauf-Tokens) | Ja | Nein | Nein | Optional | App-Funktionalität |

**Nicht** erhoben: Name, E-Mail, Adresse, Kontakte, Fotos/Videos (Fotos werden nur lokal per OCR gelesen,
gesendet wird höchstens der erkannte Text), Dateien/Dokumente als Ganzes, Audio, Gesundheit, Nachrichten,
Web-Verlauf, genauer Standort. Die Absenderdaten aus „Meine Daten“ werden bei „Brief per KI“ **nicht** gesendet.
Die IP-Adresse speichert unser Server nur als gesalzenen Tages-Hash (Missbrauchsschutz).

Ergebnis im Store (erwartet): „Daten werden an Drittanbieter weitergegeben: Geräte-IDs, App-Aktivitäten,
App-Info, ungefährer Standort“, „Erhobene Daten“ wie oben, „Daten werden verschlüsselt übertragen“,
„Du kannst das Löschen von Daten anfordern“.

> Wer **keine** Werbevideos möchte: `ADS_ENABLED=false` (Vercel) setzen und das AdMob-Plugin aus
> `package.json` entfernen – dann entfallen alle AdMob-Zeilen und die Kennzeichnung „Enthält Werbung“.

## Weitere Erklärungen in der Play Console („App-Inhalte“)

| Bereich | Antwort |
|---|---|
| Datenschutzerklärung | `https://[DOMAIN]/datenschutz.html` (Platzhalter vorher ausfüllen – inkl. KI-Anbieter, Abschnitte 7–9) |
| Werbung | **Ja, die App enthält Werbung** (nur freiwillige Rewarded-Videos über Google AdMob) |
| App-Zugriff | Alle Funktionen ohne Anmeldung verfügbar (Cloud-KI braucht nur eine Einwilligung in der App). |
| Zielgruppe | **18 und älter** (vermeidet die Familien-Richtlinie; für Kinder wäre AdMob anders zu konfigurieren) |
| Content-Rating (IARC) | Kategorie „Dienstprogramm, Produktivität …“; Gewalt/Sexualität/Glücksspiel: **Nein**; Nutzer interagieren nicht miteinander: **Nein**; digitale Käufe: **Ja**; KI-generierte Inhalte: **Ja** (falls gefragt) |
| Werbe-ID (AD_ID) | **Ja**, wird verwendet – Zweck: **Werbung oder Marketing** (das Google Mobile Ads SDK fügt `com.google.android.gms.permission.AD_ID` hinzu) |
| KI-generierte Inhalte (Richtlinie) | Die App erzeugt Text mit KI. Meldungen problematischer KI-Inhalte über die Kontakt-E-Mail `[E-MAIL-ADRESSE]` (bei Bedarf später eine „Melden“-Schaltfläche ergänzen). |
| Finanzfunktionen | Keine (nur In-App-Abo über Google Play) |
| Gesundheit / Nachrichten / Behörden | Nein |

## Berechtigungen (zur Kontrolle vor dem Upload)

| Berechtigung | Zweck | Besondere Play-Erklärung nötig? |
|---|---|---|
| `CAMERA` | Dokumente/QR-Codes scannen, Foto für „Bild übersetzen“ | Nein |
| `POST_NOTIFICATIONS` | selbst gesetzte Erinnerungen | Nein |
| `VIBRATE` | haptisches Feedback | Nein |
| `WRITE_EXTERNAL_STORAGE` (nur bis Android 10, `maxSdkVersion=29`) | Speichern in „Dokumente/FaLe PDF“ | Nein |
| `READ_EXTERNAL_STORAGE` (nur bis Android 12, `maxSdkVersion=32`) | Öffnen von Dateien alter Dateimanager | Nein |
| `INTERNET` | Cloud-KI, Werbevideos, Google Play | Nein |
| `ACCESS_NETWORK_STATE` (durch AdMob/Billing) | Netzwerkstatus | Nein |
| `com.google.android.gms.permission.AD_ID` (durch AdMob) | Werbe-ID für Werbevideos | Ja → Formular „Werbe-ID“ (siehe oben) |
| `com.android.vending.BILLING` (durch die Billing-Bibliothek) | FaLe Plus | Nein |

**Nicht** verwendet (und bitte nicht hinzufügen): `MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`,
`SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `ACCESS_FINE_LOCATION`, `QUERY_ALL_PACKAGES`.

Prüfen nach jedem Build: `aapt2 dump permissions app-release.apk` bzw. Play Console „App-Bundle-Explorer → Berechtigungen“.
