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
* Das **X** (und Alt+F4) fragt zuerst die App: bei ungespeicherter Arbeit erscheint „Änderungen speichern?“. Antwortet
  die Seite 4 Sekunden lang nicht, schließt das Fenster trotzdem.
* Dateien lassen sich **ins Fenster ziehen**; Größe und Platz des Fensters werden gemerkt.

## Das Setup-Programm

Aussehen und Texte des Setups liegen in `src-tauri/installer/`:

* `sidebar.bmp`, `header.bmp` – die Bilder (Schreibtisch, Blatt, Register wie im Programm). Gezeichnet von
  `python3 scripts/windows-installer-art.py`; die Dateien sind eingecheckt, der Build braucht das Skript nicht.
* `German.nsh`, `English.nsh` – alle Texte, eine Sprache je Datei. Das Setup nimmt die Sprache von Windows.
* `hooks.nsh` – setzt die eigenen Texte auf die erste und die letzte Seite.

Im Setup steckt **keine Fremdwerbung und kein mitinstalliertes Programm** – so etwas stuft Windows als
„unerwünschte App“ ein. Die letzte Seite hat genau einen eigenen Link: „Erste Schritte, Handy-App, Unterstützen“
→ https://fale.network/apps/pdf/willkommen/ (dort stehen der Hinweis auf die Handy-App und die freiwillige
Unterstützung; die Store-Adresse kommt aus `network/tools/apps.json`).

Die Texte hängen an der Installer-Vorlage von Tauri. Deshalb ist die Version des Build-Werkzeugs im Workflow
festgelegt (`@tauri-apps/cli@2.12.4`). Vor einem Wechsel: Vorlage und Sprachdateien der neuen Version vergleichen.
Der Windows-Build startet das Setup einmal mit Fenster und legt Bilder der Seiten in den Entwurf `windows-screens`.

## Firmen-Einstellungen (für die IT)

Firmen können abschalten, was Daten ins Internet sendet. Die IT legt dazu **eine Datei** auf den PC
(GPO-Dateiverteilung, Intune, Softwareverteilung oder von Hand):

    C:\ProgramData\FaLe PDF\policy.json

    { "internet": false }

Das schaltet alle vier Funktionen ab. Einzeln geht es mit `cloudAi` (Cloud-KI), `post` (Brief per Post und Fax),
`cloudShare` (Sicher teilen, Übertragen) und `account` (FaLe-Konto) – jeweils `false`.

* Nur `false` schaltet etwas ab. Einschalten kann die Datei nichts; unbekannte Schlüssel werden verworfen.
* Ist die Datei da, aber **fehlerhaft** (kein gültiges JSON, nicht lesbar, größer als 64 KB), schaltet das Programm
  vorsichtshalber **alles** ab und zeigt das unter „Ich“ an.
* Gelesen wird beim Start (UTF-8 oder UTF-16 mit BOM). Im Programm steht unter „Ich“ → „Für Firmen & IT“, was gilt;
  unten im Fenster erscheint „Firmen-Einstellungen aktiv“.
* Installation ohne Nachfragen: `FaLe-PDF-Setup.exe /S`
* Die Datei ist eine **Voreinstellung der Firma im Programm** – keine Sperre für die Web-Version im Browser. Wer die
  auch sperren will, nutzt die Browser-Richtlinien (siehe https://fale.network/apps/pdf/unternehmen/) oder die Firewall.
* Code: `src-tauri/src/policy.rs` (liest und säubert die Datei), `js/policy.js` (die App hält sich daran).
  Prüfen, auf jedem System: `cargo test --manifest-path windows/policy-test/Cargo.toml`

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
