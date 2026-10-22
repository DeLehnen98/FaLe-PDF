# Release-Checkliste – FaLe PDF für Android

> iPhone/iPad: eigene Schritte in [IOS-SETUP.md](IOS-SETUP.md) (die iOS-App wird bereits automatisch gebaut und im Simulator getestet).

## 0. Nur du kannst das eintragen (Stand Oktober 2026)

Alles andere ist vorbereitet. Diese Angaben dürfen nicht erfunden werden:

| Was | Wo | Platzhalter |
|---|---|---|
| Name bzw. Firma, Anschrift, Land | `impressum.html`, `datenschutz.html`, `network/impressum/`, `network/en/imprint/`, `network/datenschutz/` | `[VOR- UND NACHNAME …]`, `[STRASSE UND HAUSNUMMER]`, `[PLZ ORT]`, `[LAND]` |
| Kontakt-E-Mail (wird im Store öffentlich angezeigt) | dieselben Seiten + `store/listing-de.md`, `store/data-safety.md` | `[E-MAIL-ADRESSE]` |
| AdMob-App-ID + Rewarded-Anzeigenblock + **Banner-Anzeigenblock** | `js/ai/config.js` (`ADMOB_APP_ID`, `ADMOB_REWARDED_ID`, `ADMOB_BANNER_ID`), Vercel `ADMOB_REWARDED_AD_UNITS` | Test-IDs bis dahin |
| Play-Dienstkonto (Kaufprüfung) | Vercel `GOOGLE_PLAY_SA_JSON` | – (Secret, selbst eintragen) |
| Store-Link nach der Freigabe | `network/tools/apps.json` → `pdf.android` (und `testers` für den Opt-in-Link des geschlossenen Tests) | leer = „bald im Play Store“ |

Die Domain ist eingetragen: Datenschutz-URL **`https://pdf.fale.network/datenschutz.html`**,
Kontolöschung **`https://pdf.fale.network/app/#/konto`**.

**Produkte in der Play Console** (IDs müssen genau so heißen – die App fragt sie unter diesen Namen ab):

| Produkt-ID | Art | Name im Store | Preisvorschlag |
|---|---|---|---|
| `fale_plus_monthly` | Abo, Basis-Abo `monthly`, 1 Monat | FaLe Plus (monatlich) | 2,99 € |
| `fale_plus_yearly` | Abo, Basis-Abo `yearly`, 1 Jahr | FaLe Plus (jährlich) | 24,99 € |
| `fale_plus_lifetime` | In-App-Produkt (einmalig) | FaLe Plus für immer | 39,99 € |
| `fale_tip_small` | In-App-Produkt (verbrauchbar) | Kleiner Dank | 1,99 € |
| `fale_tip_medium` | In-App-Produkt (verbrauchbar) | Großer Dank | 4,99 € |
| `fale_tip_large` | In-App-Produkt (verbrauchbar) | Riesiger Dank | 9,99 € |

Beschreibungstext (für alle Plus-Produkte): „Deutlich mehr KI-Anfragen pro Tag und Unterstützung der
Entwicklung. Alle Werkzeuge sind auch ohne Plus voll nutzbar.“ Danke-Beiträge: „Unterstützt die Weiterentwicklung. Schaltet nichts frei.“

## 0b. Webseite pdf.fale.network

- `/` ist die eigene Startseite (Ordner `site/`, Englisch unter `/en/`), die Browser-App liegt unter **`/app/`**.
- Alte Links (`/#/s/…`, `/#/konto`, Anmelde-Rückleitungen `?code=…`) leitet die Startseite automatisch nach `/app/` weiter.
- Store-Schaltflächen auf der Startseite zeigen „bald verfügbar“, bis in `network/tools/apps.json` ein Link steht
  (der Build schreibt daraus `site/stores.json`). Danach `python3 network/tools/build_pages.py` und neu deployen.

## A. Einmalig: Grundlagen

- [ ] **GitHub-Repo** anlegen (privat empfohlen), Projekt pushen. `android/`, `dist/`, `node_modules/` und
      Schlüsseldateien sind per `.gitignore` ausgeschlossen – `vendor/` gehört ins Repo.
- [ ] **Upload-Schlüssel** erzeugen und die 4 Secrets eintragen → siehe [KEYSTORE.md](KEYSTORE.md).
- [ ] **App-ID prüfen**: `appId` in `capacitor.config.json` (aktuell `dev.fale.pdf`). Nach der ersten
      Veröffentlichung bei Google Play ist sie **für immer festgelegt**.
- [ ] **Datenschutzerklärung** `datenschutz.html` und **Impressum** `impressum.html`: alle gelb markierten
      Platzhalter `[…]` ausfüllen, Web-Version deployen, URL `https://pdf.fale.network/datenschutz.html` testen.
- [ ] Link in der App unter **Ich → Rechtliches** auf Datenschutz und Impressum vorhanden.

## A2. Cloud-KI, Werbebanner und Werbevideos, FaLe Plus (einmalig) → Schritt für Schritt in [AI-SETUP.md](AI-SETUP.md)

- [ ] **Supabase-Migration** `supabase/migrations/20261014120100_fale_ai_retention.sql` ausführen (Löschfrist 30 Tage,
      Plus-Speicherung). Die Basis-Migration ist bereits eingespielt.
- [ ] **KI-Anbieter-Schlüssel** (`ANTHROPIC_API_KEY`) in Vercel eintragen **und beim Anbieter ein Ausgabenlimit setzen**.
- [ ] Echte **Preise** (`AI_PRICE_IN_USD_PER_MTOK`, `AI_PRICE_OUT_USD_PER_MTOK`) und `USD_EUR` in Vercel eintragen.
- [ ] Monatsbudget `AI_MONTHLY_BUDGET_EUR` (Standard 10) prüfen.
- [ ] Datenschutzerklärung Abschnitte 7–9: KI-Anbieter, Hosting, Supabase-Region, AdMob – Platzhalter ausfüllen.
- [ ] **AdMob**: echte App-ID + Rewarded-Anzeigenblock + **Banner-Anzeigenblock (adaptiv)** in `js/ai/config.js` eintragen, `ADMOB_TESTING: false`,
      SSV-Callback-URL `https://fale-pdf.vercel.app/api/admob-ssv` im Anzeigenblock hinterlegen,
      `ADMOB_REWARDED_AD_UNITS` in Vercel setzen. **Niemals echte Anzeigen selbst anklicken** (Kontosperre).
- [ ] **Google UMP**: im AdMob-Konto unter „Datenschutz und Messaging“ eine **DSGVO-Einwilligungsnachricht** veröffentlichen
      (sonst erscheint in der EU kein Einwilligungsdialog und es werden keine Anzeigen geladen).
- [ ] **Play Console**: Abos `fale_plus_monthly` (Basis-Abo `monthly`) und `fale_plus_yearly` (Basis-Abo `yearly`) anlegen,
      Dienstkonto verknüpfen, `GOOGLE_PLAY_SA_JSON` in Vercel eintragen. Ohne diese Variable zeigt die App „bald verfügbar“.
- [ ] **Play Console → In-App-Produkte**: `fale_plus_lifetime` (Einmalkauf „für immer“) und die Danke-Beiträge
      `fale_tip_small`, `fale_tip_medium`, `fale_tip_large` anlegen und aktivieren (Details: AI-SETUP.md, Schritt 5, 3b).
- [ ] Nach dem Eintragen von Vercel-Variablen **neu deployen** (Variablen gelten erst für neue Deployments).

## A3. Teilen, Unterschrift anfordern, Geräte verbinden (einmalig)

- [ ] **Supabase-Migration** `supabase/migrations/20261014150000_fale_share.sql` einspielen (Tabellen + RPCs für
      verschlüsselte Freigaben, Unterschriftsanfragen und Transfer-Räume; nutzt `private.fale_check` aus der KI-Migration).
      Bis dahin antworten `/api/share`, `/api/sign`, `/api/transfer` mit 503 „Teilen ist noch nicht eingerichtet“.
- [ ] **Aufräum-Job**: `supabase/migrations/20261014150100_fale_share_cron.sql` (pg_cron, alle 15 Min.). Ohne ihn wird
      trotzdem beim Zugriff und gelegentlich beim Hochladen aufgeräumt – mit ihm sind abgelaufene Daten garantiert weg.
- [ ] Keine neuen Secrets nötig (nutzt `FALE_TOKEN_SECRET`, `FALE_IP_SALT`, `FALE_RPC_SECRET`, `SUPABASE_*`).
      Optional in Vercel: `SHARE_MAX_MB` (50), `SHARE_TOTAL_MB` (300 – Supabase Free hat 500 MB Datenbank),
      `SHARE_CHUNK_KB` (1024), Tageslimits `SHARE_DEVICE_DAILY`, `SHARE_IP_DAILY`, `TRANSFER_JOIN_IP_DAILY`.
- [ ] Datenschutzerklärung Abschnitt 10 (Teilen, STUN-Server von Google) prüfen, Platzhalter ausfüllen.
- [ ] Nach dem Deployment: Link teilen → in privatem Browserfenster öffnen → herunterladen; Unterschrift anfordern →
      im zweiten Browser unterschreiben → Status „Unterschrieben“ → PDF mit Protokollseite in Dateien speichern;
      Geräte verbinden Handy ↔ PC (QR-Code) und eine Datei übertragen.

## B. Google-Play-Entwicklerkonto

- [ ] Konto unter <https://play.google.com/console> anlegen: einmalig **25 USD**, Identitätsprüfung
      (Ausweis), bei Privatkonten Verifizierung eines Android-Geräts und der Telefonnummer.
- [ ] Kontotyp: **Privatperson** oder **Organisation** (Organisation braucht D-U-N-S-Nummer).
      Wer mit der App Geld verdient (auch später), gilt als „Händler“ – dann werden Name, Adresse,
      E-Mail und Telefon **öffentlich** im Store angezeigt (EU-Recht/DSA).
- [ ] **Neue private Konten (seit Nov. 2023):** vor der Freigabe für „Produktion“ ist ein
      **geschlossener Test mit mindestens 12 Testern, die 14 Tage am Stück dabei sind**, Pflicht.
      Danach Antrag auf Produktionszugang (Fragen zum Test beantworten).
      → Tester früh sammeln (Familie, Freunde, Communities), deren Google-Mail-Adressen in eine
        Testerliste eintragen, Opt-in-Link schicken, Tester sollen die App installiert lassen.

## C. Technische Anforderungen (Stand Oktober 2026)

- [ ] **Ziel-API-Level:** Seit **31.08.2026** müssen neue Apps und Updates **Android 16 (API 36)**
      als `targetSdkVersion` haben (Verlängerung auf Antrag bis 01.11.2026). Capacitor 8 liefert 36;
      `scripts/cap-patch-android.mjs` erzwingt mindestens 36 (`ANDROID_TARGET_SDK`).
      Jedes Jahr im August steigt die Anforderung – dann Capacitor aktualisieren.
- [ ] Upload als **Android App Bundle (.aab)**, signiert mit dem Upload-Schlüssel (CI macht das,
      sobald die Secrets gesetzt sind). **Play App Signing** aktiviert lassen (Standard).
- [ ] **versionCode** steigt bei jedem Upload: in `package.json` die `version` erhöhen
      (`2.0.1` → versionCode `20001`). Gleicher versionCode wird von Play abgelehnt.
- [ ] Keine heiklen Berechtigungen außer `AD_ID` (Werbebanner/Werbevideos) und `BILLING` (FaLe Plus) – siehe [data-safety.md](data-safety.md).
- [ ] 16-KB-Seitengröße: die App enthält keinen eigenen nativen Code (nur Java/WebView) → erfüllt.

## D. Store-Eintrag

- [ ] Texte aus [listing-de.md](listing-de.md) (Standardsprache Deutsch) und ggf. [listing-en.md](listing-en.md).
- [ ] Weitere Sprachen: in der Play Console unter „Store-Eintrag › Übersetzungen verwalten“ je Sprache Name, Kurz- und
      Vollbeschreibung aus [listings/](listings/) einfügen (fr, es, it, pt-BR, nl, pl, tr, uk, ru, zh-CN, ja, ko, hi, id –
      alle bereits innerhalb der Zeichengrenzen, geprüft mit `python3 store/check_listing.py`). Die App selbst folgt
      automatisch der Gerätesprache.
- [ ] **App-Symbol** 512 × 512 PNG: `store/graphics/play-icon-512.png` (vollflächig – Google rundet die Ecken selbst
      ab). Alle Symbole entstehen aus einer Vorlage: `python3 scripts/make_icons.py`.
- [ ] **Vorstellungsgrafik** (Feature Graphic) 1024 × 500: `store/graphics/feature-graphic-de.png` / `-en.png`.
      Fertige Screenshots aller Größen: `store/graphics/` (Übersicht in [graphics/README.md](graphics/README.md)).
- [ ] **Screenshots Telefon**: mindestens 2, besser 4–8, Hochformat 9:16, z. B. 1080 × 1920 px.
      Vorschlag (hell, mit Beispieldateien – keine echten persönlichen Daten!):
  1. Startseite mit zuletzt verwendeten Dateien
  2. PDF-Ansicht mit Suche/Markierung
  3. Ausfüllen & Unterschreiben (Unterschrift platziert)
  4. Scanner (zugeschnittene Seite)
  5. Werkzeug-Übersicht
  6. Textdokument-/Tabellen-Editor
  7. Konvertieren (PDF → DOCX-Ergebnis)
  8. Dunkelmodus
- [ ] Optional: Tablet-Screenshots 7" und 10" (verbessert die Sichtbarkeit auf Tablets).
- [ ] Kategorie **Produktivität**, Kontakt-E-Mail, Datenschutz-URL.

## E. App-Inhalte (Play Console → „App-Inhalte“)

- [ ] Datenschutzerklärung (URL)
- [ ] Werbung: **Ja** („Enthält Werbung“ – AdMob-Banner auf den Hauptseiten der Android-App + freiwillige Rewarded-Videos)
- [ ] Werbe-ID: **Ja**, Zweck Werbung
- [ ] In-App-Käufe: Abo „FaLe Plus“ (2,99 €/Monat, 24,99 €/Jahr), Einmalkauf „für immer“ (39,99 €) und Danke-Beiträge (1,99/4,99/9,99 €) – Tabelle in Abschnitt 0
- [ ] App-Zugriff: keine Anmeldung nötig
- [ ] Content-Rating-Fragebogen (IARC) – Antworten in [data-safety.md](data-safety.md)
- [ ] Zielgruppe: 18+
- [ ] Datensicherheit: neue Angaben (Cloud-KI-Text, pseudonyme ID, **AdMob-Daten jetzt „Erforderlich“ wegen Banner**, Kaufverlauf, verschlüsselt geteilte Dateien) – siehe Abschnitt „ACHTUNG“ in [data-safety.md](data-safety.md)
- [ ] Regierungs-App / Finanz / Gesundheit / Nachrichten: Nein

## F. Jeder Release

1. [ ] `version` in `package.json` erhöhen (`x.y.z`, minor/patch ≤ 99).
2. [ ] Web-Tests laufen lassen (100 % grün).
3. [ ] Commit + Tag: `git tag v2.0.1 && git push --tags` → GitHub Actions baut APK + AAB und hängt
       sie an ein GitHub-Release (Seite „Releases“ im Repo – dort lässt sich die APK auch direkt am
       Handy herunterladen).
4. [ ] APK auf einem echten Gerät testen (siehe Test-Liste unten).
5. [ ] AAB in der Play Console hochladen: erst **interner Test**, dann geschlossener Test, dann Produktion.
6. [ ] Versionshinweise (DE) eintragen, Release prüfen, zur Überprüfung senden (dauert 1–7 Tage).

## G. Gerätetest vor dem Upload (Android-Handy)

- [ ] Installation, Start, App-Symbol (rund/eckig, Themed Icon in Android 13+), Splash-Farbe
- [ ] PDF über Dateimanager **„Öffnen mit → FaLe PDF“** (kalter Start und bei laufender App)
- [ ] Aus WhatsApp/Gmail **„Teilen → FaLe PDF“** (1 Datei, mehrere Dateien, Bild, DOCX)
- [ ] Werkzeug ausführen → **Herunterladen** → Datei liegt in **Dokumente/FaLe PDF**
- [ ] **Teilen** aus der App (Teilen-Dialog öffnet sich, Ziel-App erhält die Datei)
- [ ] **Scanner**: Kamera-Berechtigung wird gefragt, Vorschau läuft, Foto wird übernommen
- [ ] **Zurück-Taste**: schließt Dialoge/Menüs, geht in der App zurück, beendet auf der Startseite
- [ ] Erinnerung setzen → Benachrichtigungs-Erlaubnis → Benachrichtigung kommt → Tippen öffnet die App
- [ ] Hell/Dunkel umschalten: Statusleiste passt sich an, nichts liegt unter der Statusleiste
- [ ] Tastatur verdeckt keine Eingabefelder (Editor, Formulare)
- [ ] Flugmodus: alles funktioniert offline (KI-Assistent zeigt „Du bist offline“, nichts blockiert)
- [ ] **KI**: Einwilligungsdialog beim ersten Mal, Chat mit Dokument (Seitenangabe antippen → richtige Seite), Zusammenfassen,
      Übersetzen, Schreibhilfe (Text markieren → ⋮ → KI-Schreibhilfe), Formel-Assistent, Folien per KI, Lernkarten
- [ ] **Werbebanner** (mit Test-IDs!): unten auf Start, Dateien, Werkzeuge und Ich ein Streifen „Anzeige“ + Banner; **nicht** in Dokument, Werkzeug, Editor, Dialogen, Einführung; mit aktivem FaLe Plus kein Banner
- [ ] **Werbevideo** (mit Test-IDs!): UMP-Dialog erscheint (in der EU), Video läuft, danach „+3“ im Kontingent
      (kommt über die Server-Bestätigung, kann einige Sekunden dauern)
- [ ] **FaLe Plus** (mit Lizenz-Testkonto in der Play Console): Abo-Kauf, „für immer“-Kauf, Danke-Beitrag zweimal,
      „Käufe wiederherstellen“, „Abo verwalten oder kündigen“, Erinnerung vor der Verlängerung (Mitteilung kommt 3 Tage vorher)
- [ ] **Absturzschutz**: Dokument bearbeiten, App über „Zuletzt verwendet“ wegwischen → neu starten → „Wiederherstellen“
- [ ] **Im Original speichern**: PDF im Dateimanager → „Bearbeiten mit“ → FaLe PDF → z. B. unterschreiben → „Original ersetzen“ → Datei im Dateimanager geändert (mit „Öffnen mit“ wird nur gelesen – dann kein Knopf)
- [ ] **KI ausblenden**: KI-Einstellungen → „KI komplett ausblenden“ → Startseite, Werkzeuge und Editor-Menüs ohne KI
- [ ] **Teilen & Übertragen** (online): „Sicher teilen“ → Link per WhatsApp senden → auf anderem Gerät im Browser öffnen;
      „Unterschrift anfordern“ → Link öffnen, unterschreiben → in der App Status „Unterschrieben“ + PDF speichern;
      „Geräte verbinden“: QR-Code mit der Handy-Kamera scannen (öffnet die Web-App) bzw. in der App „QR-Code scannen“
      (Kamera-Berechtigung), Datei Handy → PC und PC → Handy; im Flugmodus erscheint der Offline-Hinweis
- [ ] Update über die vorherige Version installieren: Dateien bleiben erhalten

## Hinweise

- **Sideloading vs. Play:** Eine selbst installierte APK (mit dem Upload-Schlüssel signiert) und die
  Play-Version (von Google neu signiert) haben unterschiedliche Signaturen. Für den Wechsel muss die App
  einmal deinstalliert werden → vorher Dateien sichern (Herunterladen/Teilen).
- Debug-APKs aus verschiedenen CI-Läufen haben jeweils einen anderen Debug-Schlüssel und lassen sich
  **nicht** übereinander installieren. Für Updates ohne Datenverlust die signierte `FaLe-PDF-x.y.z.apk` nutzen.
- Google führt schrittweise eine Entwickler-Verifizierung auch für Apps außerhalb von Google Play ein.
  Mit einem verifizierten Play-Konto ist die eigene APK davon abgedeckt.
