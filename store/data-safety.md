# Datensicherheit („Data safety“) – Antworten für die Play Console

Gilt für FaLe PDF in der aktuellen Form: keine Analyse-/Werbe-/Crash-SDKs, kein Server, kein Konto.
**Wenn sich das ändert (z. B. ein Analyse- oder Crash-SDK, Cloud-Sync, Login), müssen diese
Antworten UND datenschutz.html angepasst werden.**

Hintergrund: Daten, die nur auf dem Gerät verarbeitet werden und das Gerät nicht verlassen,
gelten bei Google Play **nicht** als „erhoben“ („collected“). Dateien, die die Nutzerin selbst
über das Android-Teilen-Menü an eine andere App gibt, gelten nicht als „geteilt“ durch die App.

## Abschnitt „Datenerhebung und Sicherheit“

| Frage | Antwort |
|---|---|
| Erhebt oder teilt deine App erforderliche Nutzerdatentypen? (Does your app collect or share any of the required user data types?) | **Nein** |
| → Damit entfallen die Fragen zu Verschlüsselung bei der Übertragung und zu Datentypen. | – |
| Können Nutzer das Löschen ihrer Daten anfordern? | entfällt (keine Daten erhoben). Falls gefragt: Daten liegen nur lokal; Löschen in der App oder durch Deinstallation. |
| Konto-Erstellung | Die App bietet **keine** Kontoerstellung → kein Link zur Kontolöschung nötig. |

Ergebnis im Store: „Keine Daten erhoben“ und „Keine Daten mit Drittanbietern geteilt“.

## Weitere Erklärungen in der Play Console („App-Inhalte“)

| Bereich | Antwort |
|---|---|
| Datenschutzerklärung | `https://[DOMAIN]/datenschutz.html` (Seite liegt im Repo als `datenschutz.html`, Platzhalter vorher ausfüllen!) |
| Werbung | **Nein**, die App enthält keine Werbung |
| App-Zugriff | **Alle Funktionen ohne besondere Zugriffsrechte verfügbar** (kein Login) |
| Zielgruppe | **18 und älter** empfohlen (vermeidet die Zusatzpflichten der Familien-Richtlinie) |
| Content-Rating (IARC) | Kategorie „Dienstprogramm, Produktivität, Kommunikation oder Sonstiges“; alle Fragen zu Gewalt, Sexualität, Sprache, Glücksspiel usw. mit **Nein**; Nutzerinteraktion/Teilen von Inhalten mit anderen Nutzern: **Nein**; Standort-Weitergabe: **Nein** → Ergebnis voraussichtlich USK 0 / PEGI 3 / „Everyone“ |
| Nachrichten-App | Nein |
| Gesundheits-App | Nein |
| Finanzfunktionen | Keine |
| Behörden-App | Nein |
| Werbe-ID (AD_ID) | **Nein**, wird nicht verwendet (die App deklariert die Berechtigung nicht) |

## Berechtigungen (zur Kontrolle vor dem Upload)

| Berechtigung | Zweck | Besondere Play-Erklärung nötig? |
|---|---|---|
| `CAMERA` | Dokumente/QR-Codes scannen | Nein |
| `POST_NOTIFICATIONS` | selbst gesetzte Erinnerungen | Nein |
| `VIBRATE` | haptisches Feedback | Nein |
| `WRITE_EXTERNAL_STORAGE` (nur bis Android 10, `maxSdkVersion=29`) | Speichern in „Dokumente/FaLe PDF“ | Nein |
| `READ_EXTERNAL_STORAGE` (nur bis Android 12, `maxSdkVersion=32`) | Öffnen von Dateien alter Dateimanager | Nein |
| `INTERNET` | Teil des Capacitor-Gerüsts, wird nicht genutzt | Nein |

**Nicht** verwendet (und bitte nicht hinzufügen, das löst Erklärungs-/Prüfpflichten aus):
`MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (Bilder kommen über die
System-Dateiauswahl), `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` (Erinnerungen dürfen ein paar
Minuten später kommen), `ACCESS_FINE_LOCATION`, `QUERY_ALL_PACKAGES`.

Prüfen nach jedem Build: `aapt2 dump permissions app-release.apk` bzw. im Play-Console-Bericht
„App-Bundle-Explorer → Berechtigungen“.
