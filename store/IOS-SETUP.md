# FaLe PDF für iPhone und iPad

Stand: Die iOS-App wird bei jedem Push automatisch gebaut und im iOS-Simulator getestet
(`.github/workflows/ios.yml`, macOS-Runner von GitHub – für öffentliche Repos kostenlos). Dafür ist **kein**
Apple-Konto nötig. Für den App Store braucht es die Schritte unten.

## Was die iOS-App kann

- Alles, was die Web-App kann (PDF, Dokumente, Tabellen, Präsentationen, Scannen, OCR, Tresor, Teilen …)
- **„Öffnen in“ / Dateien-App**: PDF, Word, Excel, PowerPoint, CSV, Text, Markdown und Bilder lassen sich mit
  FaLe PDF öffnen (Dokumenttypen in der Info.plist, Rang „Alternate“ – FaLe PDF drängt sich nie als Standard auf).
- **Im Original speichern**: Dateien aus der Dateien-App werden „an Ort und Stelle“ geöffnet
  (`LSSupportsOpeningDocumentsInPlace`); „Original ersetzen“ schreibt die neue Fassung koordiniert
  (`NSFileCoordinator`) zurück – auch in iCloud Drive. Kopien aus Mail/Safari (Inbox) bleiben unverändert.
- **Gespeicherte Dateien** liegen in der Dateien-App unter „Auf meinem iPhone › FaLe PDF“ (`UIFileSharingEnabled`).
- **Drucken** über den iOS-Druckdialog (AirPrint, „Als PDF sichern“).
- **Erinnerungen** (Fristen) als Mitteilungen, **Haptik**, **Teilen** über das iOS-Teilen-Menü.

Vorerst **aus** auf iOS: Werbevideos und FaLe Plus / Danke-Beiträge (Käufe bräuchten eine eigene Prüfung
über die App Store Server API – siehe unten). Die App ist auf iOS also komplett kostenlos.

## Was du für den App Store brauchst

1. **Apple Developer Program** (99 USD pro Jahr) – erst abschließen, wenn du veröffentlichen willst.
   Anmeldung und Bezahlung machst du selbst unter developer.apple.com.
2. **App Store Connect → Meine Apps → +**: neue App, Bundle-ID **`dev.fale.pdf`** (darf sich nie ändern),
   Name „FaLe PDF“, Primärsprache Deutsch.
3. **Signieren im CI** (danach kann der Workflow eine Testflight-Version hochladen): in App Store Connect unter
   *Benutzer und Zugriff → Integrationen → App Store Connect API* einen Schlüssel (Rolle „App Manager“) anlegen
   und die drei Werte selbst als GitHub-Secrets eintragen: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`
   (Inhalt der .p8-Datei). Niemals ins Repo oder in Chats kopieren. Sag Bescheid, dann baue ich den
   Upload-Schritt (Archiv + TestFlight) in den Workflow ein.
4. **App-Datenschutz** („Datenschutz-Etiketten“): wie bei Google Play (`store/data-safety.md`) – ohne
   Werbung/Käufe auf iOS: keine Daten zum Tracking; optional Cloud-KI (Inhalte nur auf Anfrage, nicht gespeichert),
   FaLe-Konto (E-Mail) und Absturz-/Diagnose: keine.
5. **Exportkontrolle**: Die App verschlüsselt (PDF-Passwörter AES-256, Ende-zu-Ende-Teilen, Tresor) mit
   Standardverfahren. In App Store Connect die Fragen zur Verschlüsselung beantworten (in der Regel „Ausnahme:
   Standardverschlüsselung“); bei Unsicherheit Apple-Hilfe lesen.
6. **Screenshots**: iPhone 6,9" (1320 × 2868) und iPad 13" (2064 × 2752) – können aus dem Simulator erzeugt werden.
7. **Prüfung durch Apple**: Hinweis an die Prüfer, dass die App ohne Konto funktioniert; Testdatei beilegen.
   Apple lehnt reine „Webseiten in einer App“ ab (Richtlinie 4.2) – FaLe PDF bringt native Funktionen mit
   (Dateien-App, Öffnen an Ort und Stelle, Drucken, Mitteilungen, Offline-Betrieb), das in der Beschreibung nennen.

## Später: Geld verdienen auf iOS

- **FaLe Plus / „für immer“ / Danke-Beiträge** über In-App-Käufe (StoreKit, das Plugin
  `@capgo/native-purchases` kann iOS). Nötig: Produkte in App Store Connect anlegen und auf dem Server die
  Prüfung über die App Store Server API (eigener Schlüssel, `APPLE_IAP_*` – trägst du selbst ein).
  Bis dahin zeigt die iOS-App keine Bezahlangebote.
- **Werbevideos**: eigener AdMob-App-Eintrag für iOS + `ADMOB_IOS_APP_ID` (sonst Googles Test-ID) und die
  App-Tracking-Abfrage (ATT). Vorerst bewusst aus.

## Lokal bauen (mit einem Mac)

```
npm install
npm run ios:add      # einmal: Web-Build, iOS-Projekt, Patch, Pods
npm run ios:sync     # nach Änderungen
npm run ios:open     # Xcode öffnen → Simulator/iPhone wählen → Start
```
