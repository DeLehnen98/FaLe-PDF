# Release-Checkliste – FaLe PDF für Android

## A. Einmalig: Grundlagen

- [ ] **GitHub-Repo** anlegen (privat empfohlen), Projekt pushen. `android/`, `dist/`, `node_modules/` und
      Schlüsseldateien sind per `.gitignore` ausgeschlossen – `vendor/` gehört ins Repo.
- [ ] **Upload-Schlüssel** erzeugen und die 4 Secrets eintragen → siehe [KEYSTORE.md](KEYSTORE.md).
- [ ] **App-ID prüfen**: `appId` in `capacitor.config.json` (aktuell `dev.fale.pdf`). Nach der ersten
      Veröffentlichung bei Google Play ist sie **für immer festgelegt**.
- [ ] **Datenschutzerklärung** `datenschutz.html` und **Impressum** `impressum.html`: alle gelb markierten
      Platzhalter `[…]` ausfüllen, Web-Version deployen, URL `https://[DOMAIN]/datenschutz.html` testen.
- [ ] Link in der App unter **Ich → Rechtliches** auf Datenschutz und Impressum vorhanden.

## A2. Cloud-KI, Werbevideos, FaLe Plus (einmalig) → Schritt für Schritt in [AI-SETUP.md](AI-SETUP.md)

- [ ] **Supabase-Migration** `supabase/migrations/20261014120100_fale_ai_retention.sql` ausführen (Löschfrist 30 Tage,
      Plus-Speicherung). Die Basis-Migration ist bereits eingespielt.
- [ ] **KI-Anbieter-Schlüssel** (`ANTHROPIC_API_KEY`) in Vercel eintragen **und beim Anbieter ein Ausgabenlimit setzen**.
- [ ] Echte **Preise** (`AI_PRICE_IN_USD_PER_MTOK`, `AI_PRICE_OUT_USD_PER_MTOK`) und `USD_EUR` in Vercel eintragen.
- [ ] Monatsbudget `AI_MONTHLY_BUDGET_EUR` (Standard 10) prüfen.
- [ ] Datenschutzerklärung Abschnitte 7–9: KI-Anbieter, Hosting, Supabase-Region, AdMob – Platzhalter ausfüllen.
- [ ] **AdMob**: echte App-ID + Rewarded-Anzeigenblock in `js/ai/config.js` eintragen, `ADMOB_TESTING: false`,
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
- [ ] Keine heiklen Berechtigungen außer `AD_ID` (Werbevideos) und `BILLING` (FaLe Plus) – siehe [data-safety.md](data-safety.md).
- [ ] 16-KB-Seitengröße: die App enthält keinen eigenen nativen Code (nur Java/WebView) → erfüllt.

## D. Store-Eintrag

- [ ] Texte aus [listing-de.md](listing-de.md) (Standardsprache Deutsch) und ggf. [listing-en.md](listing-en.md).
- [ ] **App-Symbol** 512 × 512 PNG (32-bit): `icons/icon-maskable-512.png` verwenden (vollflächig –
      Google rundet die Ecken selbst ab; nicht das Symbol mit transparenten Ecken).
- [ ] **Vorstellungsgrafik** (Feature Graphic) 1024 × 500 PNG/JPG, ohne Transparenz.
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
- [ ] Werbung: **Ja** (freiwillige Rewarded-Videos, AdMob)
- [ ] Werbe-ID: **Ja**, Zweck Werbung
- [ ] In-App-Käufe: Abo „FaLe Plus“ (2,99 €/Monat, 24,99 €/Jahr), Einmalkauf „für immer“ und Danke-Beiträge (Preise in der Play Console)
- [ ] App-Zugriff: keine Anmeldung nötig
- [ ] Content-Rating-Fragebogen (IARC) – Antworten in [data-safety.md](data-safety.md)
- [ ] Zielgruppe: 18+
- [ ] Datensicherheit: neue Angaben (Cloud-KI-Text, pseudonyme ID, AdMob, Kaufverlauf, verschlüsselt geteilte Dateien) – siehe [data-safety.md](data-safety.md)
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
- [ ] **Werbevideo** (mit Test-IDs!): UMP-Dialog erscheint (in der EU), Video läuft, danach „+3“ im Kontingent
      (kommt über die Server-Bestätigung, kann einige Sekunden dauern)
- [ ] **FaLe Plus** (mit Lizenz-Testkonto in der Play Console): Abo-Kauf, „für immer“-Kauf, Danke-Beitrag zweimal,
      „Käufe wiederherstellen“, „Abo verwalten oder kündigen“, Erinnerung vor der Verlängerung (Mitteilung kommt 3 Tage vorher)
- [ ] **Absturzschutz**: Dokument bearbeiten, App über „Zuletzt verwendet“ wegwischen → neu starten → „Wiederherstellen“
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
