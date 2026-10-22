# FaLe PDF für Windows (Setup.exe)

Ein kleines Windows-Programm (Tauri 2, WebView2 von Windows) um die Web-App `https://pdf.fale.network/app/`:
eigenes Fenster und Startmenü-Eintrag, „Öffnen mit FaLe PDF“ für PDF, Word, Excel und PowerPoint, offline nach
dem ersten Start (Service Worker). Updates der App kommen automatisch – die Setup.exe muss nur neu gebaut werden,
wenn sich dieses Programm selbst ändert.

* Gebaut wird **nur in GitHub Actions** (`.github/workflows/windows.yml`, Windows-Runner) – lokal ist nichts nötig.
* Ergebnis: `FaLe-PDF-Setup.exe` (NSIS, Installation **ohne Administratorrechte** in den Benutzerordner) auf der
  Vorab-Veröffentlichung `windows-latest`:
  https://github.com/DeLehnen98/FaLe-PDF/releases/download/windows-latest/FaLe-PDF-Setup.exe
* Seiten, die nicht zur App gehören (Datenschutz-Links, andere Webseiten), öffnet das Programm im Standardbrowser.

## Sicherheit und „Cracks“

Das Programm enthält **keine Geheimnisse und keine Freischaltungen**: FaLe Pro und die KI-Freischaltungen prüft
immer der Server (Kauf bei Google bestätigt, Werbevideos per Google-Bestätigung). Ein verändertes Programm bekommt
dadurch weder Pro noch KI geschenkt. Es lädt nur die App von `pdf.fale.network` (HTTPS).

## Code-Signatur (deine Entscheidung)

Ohne Code-Signatur zeigt Windows beim ersten Start „Der Computer wurde durch Windows geschützt“ (SmartScreen) –
man klickt auf „Weitere Informationen“ → „Trotzdem ausführen“. Das verschwindet mit einer Signatur:

* **Microsoft Store** (siehe `store/MS-STORE.md`): Microsoft signiert, keine Warnung, kostenlos.
* **Azure Trusted Signing** (ca. 10 $/Monat) oder ein Code-Signing-Zertifikat. Dann in GitHub die Secrets
  setzen und im Workflow die Signier-Schritte einschalten – das Zertifikat trägst du selbst ein, nie ins Repository.
