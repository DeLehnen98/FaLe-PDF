# Datensicherheit („Data safety“) – Antworten für die Play Console

Gilt für FaLe PDF **mit** optionaler Cloud-KI, **Werbebanner auf den Hauptseiten** und freiwilligen Werbevideos
(Google AdMob: Banner + Rewarded Ads), dem Kauf „FaLe Plus“ (Abo oder einmalig, Google Play Billing; entfernt die
Werbebanner) und den Online-Funktionen „Sicher teilen“, „Unterschrift anfordern“
und „Geräte verbinden“ (Ende-zu-Ende-verschlüsselt) sowie dem **freiwilligen FaLe-Konto** (E-Mail + Code,
Supabase Auth) mit **FaLe Sync** (Ende-zu-Ende-verschlüsselt). Kein eigenes Analyse- oder Crash-SDK – das
**Google Mobile Ads SDK** sammelt aber Geräte-/Diagnose-/Interaktionsdaten für Werbung (siehe unten).

## ACHTUNG – was der Owner in der Play Console ändern muss (neu: Werbebanner)

Die Android-App zeigt jetzt ein Google-AdMob-**Banner** am unteren Rand der Hauptseiten (Start, Dateien, Werkzeuge,
Ich; nie in Dokumenten/Werkzeugen/Editoren). Das Google Mobile Ads SDK wird beim App-Start initialisiert (nach dem
Einwilligungsdialog „UMP“, `js/banner.js` → `initAds()`), **sobald** Banner angezeigt werden sollen – also bei
allen Nutzern ohne aktives FaLe Plus. Dadurch gilt in der **Play Console** (Richtlinie › App-Inhalte und
Datensicherheit) Folgendes – bitte Formular für Formular durchgehen:

1. **App-Inhalte › Werbung**: „Enthält Werbung“ = **Ja** (war schon Ja wegen Rewarded-Videos; jetzt zusätzlich Banner).
2. **Datensicherheit** – die AdMob-Zeilen unten sind jetzt **nicht mehr „Optional“**, sondern **„Erforderlich“**
   (alle Nutzer ohne FaLe Plus lösen die Datenerhebung automatisch aus; nur ein Kauf von FaLe Plus verhindert sie) [prüfen:
   ob das SDK bei aktivem FaLe Plus wirklich gar nicht startet, dann ist „Optional“ vertretbar – im Zweifel „Erforderlich“].
   Für alle diese Typen: **Erhoben = Ja, Weitergegeben = Ja** (an Google als SDK-Anbieter), Zwecke **Werbung oder Marketing**,
   **Betrugsprävention/Sicherheit/Compliance**, **Analysen** (laut Googles AdMob-Angaben):
   - Geräte- oder andere IDs (Werbe-ID),
   - App-Aktivitäten › App-Interaktionen,
   - App-Info und Leistung › Diagnose [prüfen: zusätzlich „Absturzprotokolle“ / „Sonstige App-Leistungsdaten“ –
     Googles aktuelle Hilfeseite „Datenoffenlegung für das Google Mobile Ads SDK“ abgleichen],
   - Standort › Ungefährer Standort (aus der IP-Adresse).
3. **Werbe-ID (AD_ID)**: weiterhin „Ja“, Zweck **Werbung oder Marketing** (+ Betrugsprävention). Die Berechtigung
   `AD_ID` ist durch das SDK im Manifest.
4. **Zielgruppe**: weiter 18+ (keine Kinder-/Familienrichtlinie), siehe unten.
5. **Datenschutzerklärung** (`datenschutz.html`, Abschnitt AdMob) muss Banner, Einwilligungsdialog und Weitergabe an
   Google nennen – wird separat gepflegt, bitte gegenprüfen.
6. Die EU-Einwilligungsnachricht (Google UMP) im AdMob-Konto muss veröffentlicht sein (siehe `RELEASE-CHECKLIST.md`).
**Wenn sich etwas ändert (neues SDK, anderer Login, anderer KI-Anbieter), müssen diese Antworten
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
| Können Nutzer das Löschen ihrer Daten anfordern? | **Ja** – in der App: „KI-Assistent → KI-Einstellungen → Einwilligung widerrufen“ löscht die Gerätekennung; Zähler werden ohnehin nach 30 Tagen gelöscht. Geteilte Dateien/Anfragen: „Teilen & Übertragen → Link löschen / Anfrage löschen“, sonst automatisch nach Ablauf (max. 7 Tage). FaLe-Konto: „Ich → FaLe-Konto → Konto löschen“ (löscht sofort alle Cloud-Daten, Konto vollständig innerhalb von 30 Tagen) bzw. „Alle Cloud-Daten löschen“. Außerdem per E-Mail an `[E-MAIL-ADRESSE]`. |
| Konto-Erstellung | **Ja, optional** (E-Mail + 6-stelliger Code; die App ist ohne Konto voll nutzbar). **Link zur Kontolöschung** (Pflichtangabe): `https://pdf.fale.network/app/#/konto` – dort „Konto löschen“; Anleitung auch in der Datenschutzerklärung Abschnitt 11. Löschen ist auch in der App möglich (Pflicht seit 2024 erfüllt). |

## Datentypen

| Datentyp (Play-Kategorie) | Erhoben? | Geteilt? | Kurzzeitig verarbeitet? | Pflicht/optional | Zwecke |
|---|---|---|---|---|---|
| **App-Aktivitäten → Andere nutzergenerierte Inhalte** (Text, den die Nutzerin an die Cloud-KI schickt: Fragen, Dokumentausschnitte, markierter Text, Anliegen für Briefe, per OCR erkannter Text) | Ja | Nein (KI-Anbieter = Dienstleister) | **Ja** (nicht gespeichert) | **Optional** (nur nach Einwilligung) | App-Funktionalität |
| **Geräte- oder andere IDs** – pseudonyme Gerätekennung (zufällig, in der App erzeugt; Cloud-KI und Tageslimits für Teilen/Übertragen) | Ja | Nein | Nein (Zähler 30 Tage) | Optional | App-Funktionalität, Betrugsprävention/Sicherheit |
| **Geräte- oder andere IDs** – **Werbe-ID** (durch Google AdMob: Banner auf den Hauptseiten und Werbevideos) | Ja | **Ja** (Google AdMob) | Nein | **Erforderlich** [prüfen, s. o.] | Werbung oder Marketing, Betrugsprävention |
| **App-Info und Leistung → Diagnosedaten** und **App-Aktivitäten → App-Interaktionen** (durch das AdMob-SDK bei Banner und Werbevideo) | Ja | **Ja** (Google AdMob) | Nein | **Erforderlich** [prüfen, s. o.] | Werbung, Analysen (Google), Betrugsprävention |
| **Standort → Ungefährer Standort** (AdMob leitet ihn aus der IP-Adresse ab) | Ja | **Ja** (Google AdMob) | Nein | **Erforderlich** [prüfen, s. o.] | Werbung, Betrugsprävention |
| **Finanzinformationen → Kaufverlauf** (nur Prüfung von „FaLe Plus“: Produkt, Ablaufdatum, Hash des Kauf-Tokens) | Ja | Nein | Nein | Optional | App-Funktionalität |
| **Dateien und Dokumente → Dateien und Dokumente** („Sicher teilen“, „Unterschrift anfordern“, Relais von „Geräte verbinden“: nur **Ende-zu-Ende-verschlüsselt**, für uns unlesbar; Dateiname, Nachricht und Namen der Unterzeichnenden ebenfalls verschlüsselt) | Ja (konservativ angegeben, s. u.) | Nein | Nein (bis zum Ablauf, max. 7 Tage; Relais max. 1 Std.) | Optional | App-Funktionalität |
| **Persönliche Daten → E-Mail-Adresse** (nur mit freiwilligem FaLe-Konto; Anmeldung per Code) | Ja | Nein (Supabase/E-Mail-Dienst = Dienstleister) | Nein (bis zur Kontolöschung) | **Optional** | App-Funktionalität, Kontoverwaltung |
| **Persönliche Daten → Nutzer-IDs** (zufällige Konto-ID von Supabase Auth; nur mit FaLe-Konto) | Ja | Nein | Nein | Optional | App-Funktionalität, Kontoverwaltung, Betrugsprävention/Sicherheit |
| **Dateien und Dokumente** sowie **App-Aktivitäten → Andere nutzergenerierte Inhalte** über **FaLe Sync** (Dateien, Dateinamen, Ordner, Tags, Unterschriften, Fristen, „Meine Daten“ – alles **Ende-zu-Ende-verschlüsselt**, für uns unlesbar) | Ja (konservativ angegeben) | Nein | Nein (bis die Nutzerin löscht; Löschmarker 30 Tage) | Optional | App-Funktionalität |
| **Geräte- oder andere IDs** – zufällige Gerätekennung + selbst gewählter Gerätename für die Geräteliste (nur mit FaLe-Konto) | Ja | Nein | Nein | Optional | App-Funktionalität, Kontoverwaltung |

**Nicht** erhoben (ohne FaLe-Konto auch keine E-Mail): Name, Adresse (im Klartext), Kontakte, Fotos/Videos (Fotos werden nur lokal per OCR gelesen,
gesendet wird höchstens der erkannte Text), Dateien/Dokumente als Ganzes, Audio, Gesundheit, Nachrichten,
Web-Verlauf, genauer Standort. Die Absenderdaten aus „Meine Daten“ werden bei „Brief per KI“ **nicht** gesendet.
Die IP-Adresse speichert unser Server nur als gesalzenen Tages-Hash (Missbrauchsschutz).

**Teilen / Unterschrift anfordern / Geräte verbinden** (`api/share`, `api/sign`, `api/transfer`): Inhalte werden auf dem
Gerät mit AES-256-GCM verschlüsselt; der Schlüssel steht nur im Link-Fragment (`#k=…`) und erreicht nie den Server.
Google nimmt Ende-zu-Ende-verschlüsselte Daten unter Umständen von der Offenlegungspflicht aus – wir geben sie
**trotzdem konservativ** als „Dateien und Dokumente“ an (bitte beim Ausfüllen mit der aktuellen Play-Hilfe abgleichen).
Gespeichert werden Chiffretext, Größe, Zeitstempel, Ablauf, Download-Zähler, Hashes der Zugangs-Tokens und Tageszähler
(pseudonyme Geräte-ID + gesalzener IP-Hash, 30 Tage). Löschen: „Link löschen“/„Anfrage löschen“ in der App, sonst
automatisch nach Ablauf (max. 7 Tage). Für den Verbindungsaufbau fragt die App Googles öffentliche **STUN-Server**
(`stun.l.google.com`) – sie sehen die IP-Adresse, keine Inhalte (kein SDK, keine Datenweitergabe im Play-Sinn; in der
Datenschutzerklärung Abschnitt 10 genannt).

Ergebnis im Store (erwartet): „Daten werden an Drittanbieter weitergegeben: Geräte-IDs, App-Aktivitäten,
App-Info, ungefährer Standort“, „Erhobene Daten“ wie oben, „Daten werden verschlüsselt übertragen“,
„Du kannst das Löschen von Daten anfordern“.

> Wer **keine Werbung mehr** möchte: `ADS_ENABLED=false` (Vercel) setzen (Werbevideos), den Banner abschalten
> (`ADMOB_BANNER_ID` leer lassen) und das AdMob-Plugin aus `package.json` entfernen – dann entfallen alle AdMob-Zeilen
> und die Kennzeichnung „Enthält Werbung“.

## Weitere Erklärungen in der Play Console („App-Inhalte“)

| Bereich | Antwort |
|---|---|
| Datenschutzerklärung | `https://pdf.fale.network/datenschutz.html` (Platzhalter vorher ausfüllen – inkl. KI-Anbieter, Abschnitte 7–10) |
| Werbung | **Ja, die App enthält Werbung** (Google AdMob: Banner am unteren Rand der Hauptseiten der Android-App, mit FaLe Plus ausgeblendet; dazu freiwillige Rewarded-Videos für zusätzliche KI-Anfragen). Die Web-/Windows-Version zeigt keine Werbung. |
| App-Zugriff | Alle Funktionen ohne Anmeldung verfügbar (Cloud-KI braucht nur eine Einwilligung in der App; Teilen/Unterschrift anfordern/Geräte verbinden brauchen nur Internet). Das FaLe-Konto ist optional; für die Prüfung kann der Reviewer sich mit einer eigenen E-Mail per Code anmelden (oder ein Test-Konto hinterlegen, Code-Mails gehen an dieses Postfach). |
| Zielgruppe | **18 und älter** (vermeidet die Familien-Richtlinie; für Kinder wäre AdMob anders zu konfigurieren) |
| Content-Rating (IARC) | Kategorie „Dienstprogramm, Produktivität …“; Gewalt/Sexualität/Glücksspiel: **Nein**; Nutzer interagieren miteinander: **Nein** (Dateien werden nur per privatem Link geteilt, keine öffentlichen Inhalte, kein Chat); digitale Käufe: **Ja**; KI-generierte Inhalte: **Ja** (falls gefragt) |
| Werbe-ID (AD_ID) | **Ja**, wird verwendet – Zweck: **Werbung oder Marketing** (das Google Mobile Ads SDK fügt `com.google.android.gms.permission.AD_ID` hinzu) |
| KI-generierte Inhalte (Richtlinie) | Die App erzeugt Text mit KI. Meldungen problematischer KI-Inhalte über die Kontakt-E-Mail `[E-MAIL-ADRESSE]` (bei Bedarf später eine „Melden“-Schaltfläche ergänzen). |
| Finanzfunktionen | Keine (nur In-App-Käufe über Google Play: FaLe Plus als Abo oder einmalig, Danke-Beiträge) |
| Gesundheit / Nachrichten / Behörden | Nein |

## Berechtigungen (zur Kontrolle vor dem Upload)

| Berechtigung | Zweck | Besondere Play-Erklärung nötig? |
|---|---|---|
| `CAMERA` | Dokumente/QR-Codes scannen (auch QR-Code bei „Geräte verbinden“), Foto für „Bild übersetzen“ | Nein |
| `POST_NOTIFICATIONS` | selbst gesetzte Erinnerungen | Nein |
| `VIBRATE` | haptisches Feedback | Nein |
| `WRITE_EXTERNAL_STORAGE` (nur bis Android 10, `maxSdkVersion=29`) | Speichern in „Dokumente/FaLe PDF“ | Nein |
| `READ_EXTERNAL_STORAGE` (nur bis Android 12, `maxSdkVersion=32`) | Öffnen von Dateien alter Dateimanager | Nein |
| `INTERNET` | Cloud-KI, Werbebanner und Werbevideos, Google Play, Teilen/Unterschrift anfordern/Geräte verbinden (WebRTC) | Nein |
| `ACCESS_NETWORK_STATE` (durch AdMob/Billing) | Netzwerkstatus | Nein |
| `com.google.android.gms.permission.AD_ID` (durch AdMob) | Werbe-ID für Werbebanner und Werbevideos | Ja → Formular „Werbe-ID“ (siehe oben) |
| `com.android.vending.BILLING` (durch die Billing-Bibliothek) | FaLe Plus | Nein |

**Nicht** verwendet (und bitte nicht hinzufügen): `MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`,
`SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `ACCESS_FINE_LOCATION`, `QUERY_ALL_PACKAGES`.

Prüfen nach jedem Build: `aapt2 dump permissions app-release.apk` bzw. Play Console „App-Bundle-Explorer → Berechtigungen“.

## FaLe-Konto & FaLe Sync (Kurzfassung für Prüfer/Formulare)

- **Erhoben, optional:** E-Mail-Adresse, Konto-ID, Gerätenamen/-kennungen, Ende-zu-Ende-verschlüsselte Sync-Daten.
- **Nicht lesbar für uns:** alle Sync-Inhalte inkl. Dateinamen (AES-256-GCM auf dem Gerät; Schlüssel nur verschlüsselt
  mit Sync-Passwort bzw. Wiederherstellungsschlüssel gespeichert).
- **Speicherort:** Supabase, Region Frankfurt (eu-central-1). Kein Teilen mit Dritten im Play-Sinn (nur Dienstleister).
- **Löschung:** in der App („Konto löschen“, „Alle Cloud-Daten löschen“) und über den Web-Link
  `https://pdf.fale.network/app/#/konto` (Anmelden → „Konto löschen“).
