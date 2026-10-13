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
- [ ] Keine heiklen Berechtigungen (siehe [data-safety.md](data-safety.md)).
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
- [ ] Werbung: Nein
- [ ] App-Zugriff: keine Anmeldung nötig
- [ ] Content-Rating-Fragebogen (IARC) – Antworten in [data-safety.md](data-safety.md)
- [ ] Zielgruppe: 18+
- [ ] Datensicherheit: „Keine Daten erhoben / geteilt“ – siehe [data-safety.md](data-safety.md)
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
- [ ] Flugmodus: alles funktioniert offline
- [ ] Update über die vorherige Version installieren: Dateien bleiben erhalten

## Hinweise

- **Sideloading vs. Play:** Eine selbst installierte APK (mit dem Upload-Schlüssel signiert) und die
  Play-Version (von Google neu signiert) haben unterschiedliche Signaturen. Für den Wechsel muss die App
  einmal deinstalliert werden → vorher Dateien sichern (Herunterladen/Teilen).
- Debug-APKs aus verschiedenen CI-Läufen haben jeweils einen anderen Debug-Schlüssel und lassen sich
  **nicht** übereinander installieren. Für Updates ohne Datenverlust die signierte `FaLe-PDF-x.y.z.apk` nutzen.
- Google führt schrittweise eine Entwickler-Verifizierung auch für Apps außerhalb von Google Play ein.
  Mit einem verifizierten Play-Konto ist die eigene APK davon abgedeckt.
