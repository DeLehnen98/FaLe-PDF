# FaLe PDF für Windows (Microsoft Store) und Mac – Schritt für Schritt

Ziel: FaLe PDF lässt sich „wie Adobe“ auf den PC holen – mit eigenem Symbol im Startmenü, eigenem Fenster
und PDFs per Doppelklick. Dafür braucht es **keine .exe und kein Code-Signing-Zertifikat**:

* **Sofort (schon eingebaut):** Auf pdf.fale.network unter „Für Windows und Mac“ auf **Herunterladen** klicken →
  die App öffnet sich unter `/app/?install=1` und bietet direkt **„Jetzt installieren“** an (Edge, Chrome).
  Für Safari, Firefox und Handys zeigt sie die Schritte in den Worten des jeweiligen Browsers.
  In der App gibt es dasselbe unter **Ich › „Auf diesem PC installieren“**.
* **Microsoft Store (diese Anleitung):** Dieselbe Web-App als Store-Paket. Vorteil: Leute finden sie im Store,
  Installation mit einem Klick, Microsoft signiert das Paket → **keine SmartScreen-Warnung**. Updates der Web-App
  (JS/CSS/Service Worker) kommen automatisch an – ein neues Paket ist nur nötig, wenn sich `manifest.webmanifest`
  ändert (Name, Symbol, Dateitypen, Verknüpfungen …).

> Konten, Ausweis-Prüfung und Uploads machst du selbst. In dieses Repository gehören **keine** Passwörter,
> Schlüssel oder Partner-Center-Zugangsdaten. Die drei Kennungen aus Schritt 2 sind nicht geheim, müssen aber
> auch nicht ins Repository.

---

## 1. Kostenlos als Entwickler registrieren (einmalig, ca. 15 Minuten)

Seit September 2025 ist die Registrierung für **Einzelpersonen kostenlos** (vorher einmalig ca. 19 $).
Quelle: https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/

1. Ein **privates Microsoft-Konto** verwenden (kein Arbeits-/Schulkonto) – am besten ein eigenes für FaLe.dev.
2. https://storedeveloper.microsoft.com öffnen → **Loslegen / Get started** → **Einzelperson (Individual)** wählen.
3. Name, Adresse, Land (Deutschland) eingeben. Der **Herausgeber-Anzeigename** (Publisher display name) ist der
   Name, der im Store unter der App steht – Vorschlag: `FaLe.dev`. Er lässt sich später nur mühsam ändern.
4. **Identitätsprüfung**: Personalausweis oder Reisepass fotografieren und ein **Selfie** aufnehmen
   (läuft über einen Partner von Microsoft, meist per Handy-Link). Die Prüfung dauert Minuten bis wenige Tage.
5. Danach landest du im **Partner Center** (https://partner.microsoft.com/dashboard).

## 2. App-Namen reservieren und die drei Kennungen notieren

1. Partner Center → **Apps und Spiele** → **Neues Produkt** → **MSIX- oder PWA-App**.
2. Namen eingeben und **Produktnamen reservieren**. Vorschlag: `FaLe PDF` (kurz und eindeutig; genau dieser Name
   muss später in PWABuilder als App-Name stehen).
3. In der App: **Produktverwaltung › Produktidentität** öffnen und diese drei Werte in einen Notizzettel kopieren:
   * **Package/Identity/Name** (Paket-ID, z. B. `12345FaLedev.FaLePDF`)
   * **Package/Identity/Publisher** (Herausgeber-ID, beginnt mit `CN=`)
   * **Package/Properties/PublisherDisplayName** (Herausgeber-Anzeigename, z. B. `FaLe.dev`)

Quelle (Microsoft-Anleitung für PWAs im Store):
https://learn.microsoft.com/microsoft-edge/progressive-web-apps-chromium/how-to/microsoft-store

## 3. Paket bauen mit PWABuilder (kostenlos, im Browser)

1. https://www.pwabuilder.com öffnen, als Adresse **`https://pdf.fale.network/app/`** eingeben → **Start**.
   (Wichtig: mit `/app/` – die Startseite `pdf.fale.network/` selbst ist keine App.)
2. Die Auswertung („Report Card“) abwarten. Manifest, Service Worker und Symbole sind vorbereitet
   (Screenshots „wide“/„narrow“, Verknüpfungen, Dateitypen, `launch_handler`, `edge_side_panel`).
   Steht dort trotzdem ein roter Punkt unter **Action Items**: Text kopieren und mir geben.
3. **Package For Stores** → bei **Windows** auf **Generate Package**.
4. Im Fenster **Windows Package Options** eintragen:
   * **Package ID**, **Publisher display name**, **Publisher ID** – die drei Werte aus Schritt 2
     (genau so, ohne Leerzeichen davor/dahinter),
   * **App name**: `FaLe PDF` (= reservierter Name),
   * **App version**: `1.0.0` beim ersten Mal; **jedes neue Paket braucht eine höhere Nummer** (1.0.1, 1.1.0 …),
   * unter **All Settings / Advanced** (falls vorhanden) **Language** `de-DE`.
5. **Download Package** → du bekommst eine ZIP-Datei. Darin u. a.:
   * `*.msixbundle` und `*.classic.appxbundle` → **beide** werden hochgeladen (Schritt 4),
   * ein Test-Paket mit Anleitung – optional zum Ausprobieren auf dem eigenen PC vor dem Hochladen.

Symbole: PWABuilder erzeugt alle Kachel- und Store-Größen aus `icons/icon-512.png` (512 × 512, quadratisch).
Quelle: https://blog.pwabuilder.com/docs/image-recommendations-for-windows-pwa-packages/

## 4. Einreichung im Partner Center

Partner Center → App → **Einreichung starten**. Die Abschnitte der Reihe nach:

### Preise und Verfügbarkeit
* Märkte: alle (Standard) · Sichtbarkeit: öffentlich · Preis: **Kostenlos**.

### Eigenschaften
* Kategorie: **Produktivität** (Unterkategorie leer lassen).
* **Datenschutzrichtlinie (URL)**: `https://pdf.fale.network/datenschutz.html`
  (Pflicht, weil die App optional Daten senden kann: Cloud-KI, Teilen-Link, FaLe-Konto).
* Website: `https://pdf.fale.network/` · Support-Kontakt: deine Support-E-Mail-Adresse.
* Produkt-Deklarationen: nichts ankreuzen, was nicht zutrifft. Systemanforderungen: keine besonderen.

### Altersfreigaben (Fragebogen)
Ehrlich beantworten. Hinweise für die Antworten:
* keine Gewalt, kein Glücksspiel, keine Drogen/Alkohol, **keine Werbung und keine digitalen Käufe in dieser Windows-/Web-Version**
  (Werbebanner, Werbevideos und FaLe Plus gibt es nur in der Android-App – für den Fragebogen zählt nur die Windows-Version),
* **Nutzer können Inhalte austauschen: ja** (sicher teilen per Link, Unterschrift anfordern, Geräte verbinden),
* **KI**: Die optionale Cloud-KI erzeugt Text auf Anfrage – falls der Fragebogen nach generativer KI fragt: ja,
  optional, nur nach Zustimmung; Meldeweg = Support-E-Mail,
* Standort wird nicht geteilt.
Ergebnis ist meist eine niedrige Freigabe (z. B. USK 0 / PEGI 3, ggf. mit Hinweis „Nutzer interagieren“).

### Pakete
* Die **beiden** Dateien aus der ZIP hochladen (`.msixbundle` und `.classic.appxbundle`).
* Gerätefamilien: **Windows 10/11 Desktop** angehakt lassen. Xbox/HoloLens abwählen, falls angeboten.

### Store-Einträge (Deutsch und Englisch)
Für jede Sprache: Beschreibung, mindestens 1 Screenshot (4 oder mehr empfohlen), optional Kurzbeschreibung,
Features, Suchbegriffe. Englisch über **Weitere Sprachen verwalten** hinzufügen, falls es nicht automatisch
angeboten wird. Texte siehe unten – sie halten die Store-Grenzen ein (siehe Tabelle).

| Feld | Grenze (Microsoft Store) | unten |
|---|---|---|
| Beschreibung | ≤ 10 000 Zeichen | ca. 2 400 (DE) / 2 100 (EN) |
| Kurzbeschreibung | ≤ 1 000 Zeichen | ca. 250 / 250 |
| Produkt-Features | ≤ 20 Stück, je ≤ 200 Zeichen | 10 Stück |
| Suchbegriffe | ≤ 7 Stück, je ≤ 30 Zeichen | 7 Stück |
| Screenshots (Desktop) | PNG, mind. 1366 × 768, ≤ 50 MB, bis 10 | 5 × 1920 × 1080 |

> Grenzen nach Microsoft-Dokumentation (Store listing / Screenshots), Stand Oktober 2026 – das Partner Center
> zeigt beim Eintippen die aktuelle Grenze an. Keine Namen anderer Apps oder Marken verwenden; Dateiformate
> (PDF, DOCX, XLSX, PPTX) nennen ist in Ordnung.

**Screenshots (Desktop)** – echte App, fiktive Demo-Inhalte, in dieser Reihenfolge hochladen:

| Datei (Deutsch: `store/graphics/desktop/de/`, Englisch: `…/en/`) | zeigt |
|---|---|
| `01_home.png` | Startseite |
| `02_files.png` | Dateien |
| `03_viewer.png` | PDF lesen |
| `04_doc.png` | Dokument bearbeiten |
| `05_sheet.png` | Tabelle mit Formel und Diagramm |

Neu erzeugen: `store/graphics/tools/run.sh` (alle Grafiken) bzw. nur `capture.py <de|en> desktop home files viewer doc sheet`
und danach `desktop.py` – siehe `store/graphics/README.md`.

**Store-Logo**: Falls verlangt, `store/graphics/play-icon-512.png` (quadratisch, 512 × 512) hochladen.

#### Deutsch – Kurzbeschreibung

```
PDFs lesen, ausfüllen, unterschreiben und bearbeiten – dazu Dokumente, Tabellen und Präsentationen. Alle Funktionen an Bord, ohne Konto und ohne Upload: Deine Dateien werden auf deinem PC verarbeitet. PDFs öffnest du direkt per Doppelklick.
```

#### Deutsch – Beschreibung

```
FaLe PDF ist dein privates Büro für den PC: PDFs lesen, ausfüllen, unterschreiben und bearbeiten – dazu Dokumente, Tabellen und Präsentationen. Alle Funktionen sind dabei – ohne Konto und ohne Wasserzeichen. Deine Dateien werden auf deinem Gerät verarbeitet, nicht auf einem Server.

PDF LESEN
• Schneller PDF-Viewer mit Suche, Lesezeichen und Inhaltsverzeichnis
• PDFs per Doppelklick aus dem Explorer öffnen
• Lesemodus und Vorlesen

AUSFÜLLEN & UNTERSCHREIBEN
• PDF-Formulare ausfüllen
• Unterschrift zeichnen, speichern und mit einem Klick einsetzen
• Datum, Text, Initialen und eigene Stempel

BEARBEITEN
• Markieren, Notizen, Freihand und Formen
• Text und Bilder ergänzen oder ersetzen
• Schwärzen: vertrauliche Stellen dauerhaft entfernen
• Wasserzeichen, Seitenzahlen, Kopf- und Fußzeilen

SEITEN & DATEIEN
• Zusammenfügen, sortieren, drehen, extrahieren, zuschneiden
• PDFs komprimieren, Stapelverarbeitung, PDF/A für Behörden
• Passwortschutz (AES-256) festlegen und entfernen
• PDFs vergleichen

UMWANDELN & TEXTERKENNUNG
• PDF in DOCX, XLSX und PPTX – und zurück in PDF
• Texterkennung (OCR) direkt auf dem PC – auch offline: Scans werden durchsuchbar
• Bilder in PDF, Seiten als Bild oder Text exportieren

DOKUMENTE, TABELLEN, PRÄSENTATIONEN
• DOCX, XLSX und PPTX öffnen, bearbeiten und erstellen
• Tabellen mit Formeln und Diagrammen
• Rund 100 Vorlagen: Lebenslauf, Rechnung, Kalender, Folien-Designs
• Kündigung, Widerruf, Widerspruch & Co. in einer Minute

ALLTAG
• Fristen & Erinnerungen
• Privater Tresor mit eigener PIN
• Sicher teilen: Ende-zu-Ende-verschlüsselter Link, läuft automatisch ab
• Unterschrift anfordern – unterschrieben wird im Browser, ohne Konto
• Handy und PC verbinden: Dateien per QR-Code übertragen

KI-ASSISTENT (OPTIONAL)
• Fragen an deine Dokumente, Zusammenfassen, Übersetzen, Schreibhilfe
• Täglich einige Anfragen inklusive, nur nach deiner Zustimmung – gesendet wird nur der Text, den du auswählst
• Keine KI gewünscht? Ein Schalter blendet sie komplett aus
• KI-Antworten können Fehler enthalten – problematische Antworten kannst du uns per E-Mail melden

PRIVAT AUS PRINZIP
Kein Konto nötig, keine Analyse-Tools. Die Windows-Version zeigt keine Werbung. Alles außer Cloud-KI, Teilen und Übertragen funktioniert offline. Optional: FaLe-Konto mit FaLe Sync – Ende-zu-Ende-verschlüsselt zwischen deinen Geräten.

Oberfläche auf Deutsch und Englisch.
```

#### Deutsch – Produkt-Features (je eine Zeile ins Partner Center)

```
Alle Funktionen an Bord – kein Konto, keine Wasserzeichen
PDFs per Doppelklick öffnen, eigenes Fenster, funktioniert offline
PDF-Formulare ausfüllen und unterschreiben
Texterkennung (OCR) direkt auf dem PC
PDF in DOCX, XLSX und PPTX umwandeln – und zurück
Seiten zusammenfügen, sortieren, drehen und komprimieren
Schwärzen, Passwortschutz und PDF/A für Behörden
Dokumente, Tabellen und Präsentationen bearbeiten
Sicher teilen und Unterschrift anfordern – Ende-zu-Ende-verschlüsselt
Deine Dateien bleiben auf deinem Gerät
```

#### Deutsch – Suchbegriffe

```
PDF
PDF bearbeiten
PDF unterschreiben
PDF ausfüllen
Texterkennung
Scanner
DOCX
```

#### Englisch – Short description

```
Read, fill in, sign and edit PDFs – plus documents, spreadsheets and presentations. Every feature is on board, with no account and no upload: your files are processed on your PC. Open PDFs straight from File Explorer with a double-click.
```

#### Englisch – Description

```
FaLe PDF is your private office for the PC: read, fill in, sign and edit PDFs – plus documents, spreadsheets and presentations. Every feature is included – no account and no watermarks. Your files are processed on your device, not on a server.

READ PDFS
• Fast PDF viewer with search, bookmarks and outline
• Open PDFs from File Explorer with a double-click
• Reading mode and read aloud

FILL & SIGN
• Fill in PDF forms
• Draw and save your signature, place it with one click
• Dates, text, initials and your own stamps

EDIT
• Highlights, notes, freehand drawing and shapes
• Add or replace text and images
• Redact: permanently remove confidential content
• Watermarks, page numbers, headers and footers

PAGES & FILES
• Merge, reorder, rotate, extract and crop pages
• Compress PDFs, batch processing, PDF/A for archiving
• Add and remove password protection (AES-256)
• Compare PDFs

CONVERT & TEXT RECOGNITION
• PDF to DOCX, XLSX and PPTX – and back to PDF
• Text recognition (OCR) on your PC – even offline: scans become searchable
• Images to PDF, export pages as images or text

DOCUMENTS, SPREADSHEETS, PRESENTATIONS
• Open, edit and create DOCX, XLSX and PPTX
• Spreadsheets with formulas and charts
• Around 100 templates: CV, invoice, calendar, slide designs

EVERYDAY
• Deadlines & reminders
• Private vault with its own PIN
• Share securely: end-to-end encrypted link that expires automatically
• Request a signature – people sign in their browser, no account needed
• Connect phone and PC: transfer files via QR code

AI ASSISTANT (OPTIONAL)
• Ask your documents, summarise, translate, writing help
• A few requests included every day, only with your consent – only the text you select is sent
• Don't want AI? One switch hides it completely
• AI answers can contain mistakes – you can report problematic answers to us by email

PRIVATE BY DESIGN
No account needed, no analytics. The Windows version shows no ads. Everything except cloud AI, sharing and transfer works offline. Optional: FaLe account with FaLe Sync – end-to-end encrypted between your devices.

Interface in English and German.
```

#### Englisch – Product features

```
Every feature on board – no account, no watermarks
Open PDFs with a double-click, own window, works offline
Fill in and sign PDF forms
Text recognition (OCR) right on your PC
Convert PDF to DOCX, XLSX and PPTX – and back
Merge, reorder, rotate and compress pages
Redaction, password protection and PDF/A
Edit documents, spreadsheets and presentations
Share securely and request signatures – end-to-end encrypted
Your files stay on your device
```

#### Englisch – Search terms

```
PDF
PDF editor
sign PDF
fill PDF
OCR
scanner
office
```

### Einreichen
**An den Store senden**. Die Prüfung dauert meist **1–3 Tage** (Microsoft nennt 24–48 Stunden). Kommt eine
Ablehnung, steht der Grund im Partner Center – Text kopieren und mir geben.

## 5. Nach der Freigabe

1. Im Partner Center unter **Produktverwaltung › Produktidentität** den **Store-Link** kopieren
   (Form: `https://apps.microsoft.com/detail/<Store-ID>`).
2. In `network/tools/apps.json` bei `pdf` → `windows` eintragen:
   ```json
   "pdf": { "android": "", "ios": "", "windows": "https://apps.microsoft.com/detail/9XXXXXXXXXXX", "testers": "" }
   ```
3. Commit + Deploy. `scripts/vercel-build.mjs` schreibt den Link nach `dist/site/stores.json`; auf der Startseite
   wird aus „Bald im Microsoft Store“ automatisch der Knopf **„Im Microsoft Store laden“** (DE) bzw.
   „Get it from the Microsoft Store“ (EN).
4. Optional später: Die IARC-Freigabe-ID aus dem Partner Center als `"iarc_rating_id"` ins Manifest – dann
   neues Paket bauen (Schritt 3, höhere Versionsnummer) und hochladen.

**Wann ein neues Paket nötig ist:** nur bei Änderungen an `manifest.webmanifest` (Name, Symbole, Dateitypen,
Verknüpfungen, Farben). Alles andere kommt über die Website automatisch in die Store-App.

## 6. FaLe PDF als Standard-App für PDFs (Windows)

Windows erlaubt Apps nicht, sich selbst als Standard festzulegen – das macht die Nutzerin einmal selbst.
Die App zeigt diese Anleitung unter **Ich › „PDFs per Doppelklick öffnen“** (wenn sie als App läuft):

1. Im Explorer mit der **rechten Maustaste** auf eine PDF-Datei klicken.
2. **Öffnen mit** → **Andere App auswählen**.
3. **FaLe PDF** anklicken → **Immer**.

Alternativ: **Einstellungen › Apps › Standard-Apps** → oben `.pdf` eingeben → FaLe PDF wählen.
Das klappt sowohl mit der Store-Version als auch nach „Installieren“ in Edge oder Chrome (beide melden die
Dateitypen aus dem Manifest bei Windows an: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD).

## 7. Mac

Einen Mac-App-Store-Eintrag gibt es vorerst **nicht** (bräuchte ein Apple-Entwicklerkonto für 99 $/Jahr und
einen eigenen Mac-Build). Der Weg für Mac-Nutzer ist die Installation aus dem Browser – die Startseite und die
App erklären ihn:

* **Safari (macOS 14 Sonoma oder neuer):** Menüleiste **Ablage › Zum Dock hinzufügen …** → **Hinzufügen**.
  FaLe PDF liegt dann im Dock und im Programme-Ordner. (Safari-Web-Apps können sich nicht als Programm für
  PDF-Dateien eintragen – dafür Chrome oder Edge nehmen.)
* **Chrome oder Edge:** in der Adressleiste auf **Installieren** klicken bzw. in der App auf „Jetzt installieren“.
  Danach geht auch **Rechtsklick auf eine PDF › Öffnen mit › FaLe PDF**.

## 8. Warum (noch) keine eigene .exe?

Eine selbst verteilte `.exe`/`.msi` braucht ein Code-Signing-Zertifikat (OV ca. 150–300 $/Jahr; Microsofts
günstiger Signierdienst ist für Einzelpersonen in der EU nicht verfügbar) und zeigt trotzdem anfangs
SmartScreen-Warnungen, bis genug Leute sie installiert haben. Über den Store signiert Microsoft das Paket
kostenlos. Quelle: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
