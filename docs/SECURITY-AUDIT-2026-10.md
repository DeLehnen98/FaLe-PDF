# Sicherheits-Audit FaLe PDF – Oktober 2026

Umfang: Web-App (alle Module unter `js/`), Service Worker, Serverfunktionen `api/**`, Supabase-Migrationen,
Android-Patch-Skript (`scripts/cap-patch-android.mjs`), GitHub-Workflows, Drittanbieter-Code `vendor/`.
Methode: Code-Review aller HTML-Senken und Parser, Bedrohungsmodell ([`SECURITY.md`](SECURITY.md)),
präparierte Angriffsdateien, Fuzzing der API, RLS-Penetrationstest auf PostgreSQL 16, alle bestehenden
End-to-End-Suiten erneut unter der neuen CSP. Jede behobene Schwachstelle wurde vor der Korrektur
nachgestellt und ist durch einen Test abgesichert.

## Zusammenfassung

| Schweregrad | gefunden | behoben | dokumentiert / akzeptiert |
|---|---|---|---|
| Kritisch | 0 | – | – |
| Hoch | 1 | 1 | 0 |
| Mittel | 12 | 11 | 1 (gemildert) |
| Niedrig | 16 | 12 | 4 |
| Info | 6 | 3 | 3 (Empfehlungen) |

Alle Befunde der Stufen Hoch und Mittel sind behoben; F-12 (Vermittlerangriff beim Code-Pairing durch
einen kompromittierten Server) ist prinzipbedingt und durch Prüfnummer, QR-Pairing und ehrliche Hinweise gemildert.

## Befunde

### Hoch

| ID | Befund | Behebung | Test |
|---|---|---|---|
| F-01 | **Skript-Ausführung über präparierte Office-Dateien.** Theme-Farben und Schriftnamen aus `.xlsx`, der Platzhaltertyp in `.pptx` und Diagrammfarben wurden ungeprüft in `style`-/`data-`-Attribute geschrieben. Eine Datei mit `"><img src=x onerror=…>` im Farbwert führte beim Öffnen JavaScript im App-Ursprung aus (Zugriff auf alle lokalen Dokumente, Share-Tokens). Vor der Korrektur nachgestellt (3 Payloads ausgeführt). | Nur Hex-Farben (`xlsx-read.js`, `chart-xml.js`), Schriftnamen auf Buchstaben/Ziffern/Leerzeichen begrenzt (`fonts.js`), Platzhaltertyp escaped (`slide-render.js`); zusätzlich CSP ohne Inline-Skripte + Trusted Types (F-02) | `test_xss.py`: XSS-Korpus in DOCX/XLSX/PPTX/MD/CSV/PDF, `window.__pwned` bleibt undefiniert |

### Mittel

| ID | Befund | Behebung | Test |
|---|---|---|---|
| F-02 | Keine Content-Security-Policy / Trusted Types – jede künftige Escape-Lücke wäre direkt ausnutzbar. | Strikte CSP (Header + `<meta>` für Android), Inline-Boot-Skript nach `js/boot.js`, Inline-Skripte der Rechtstexte nach `js/legal-lang.js`, Präsentations-Publikumsfenster ohne `document.write`/`onclick`; Trusted-Types-Default-Policy; Build prüft Gleichheit von Header und `<meta>` | alle E2E-Suiten unter CSP; `test_xss.py` prüft Durchsetzung (Inline-Skript, `eval`, `javascript:`-URL, fremde Script-URL werden blockiert) |
| F-03 | **API-Hänger (DoS/Kosten):** JSON-Bodys `null`, `1`, `true` oder Arrays führten dazu, dass die Funktion auf einen bereits gelesenen Stream wartete – bis zum Timeout (60 s) pro Anfrage. | `readJson`/`readRaw`: vorab geparste Nicht-Objekte → 400, `readableEnded`-Schutz, Größenprüfung vorab geparster Bodys, Fehler im `req.body`-Getter → 400 | `test_api_fuzz.mjs` (Fuzz aller Endpunkte, jede Antwort < 5 s) |
| F-04 | **Rate-Limit-Umgehung über IPv6:** Limits pro IP; ein IPv6-Anschluss hat 2^64 Adressen. | Schlüssel = /64-Präfix (IPv4-mapped → IPv4) | `test_api_fuzz.mjs` |
| F-05 | **Anonyme Supabase-Identitäten** (falls „Anonymous sign-ins“ aktiviert wird) hätten FaLe Sync (Speicher) und den Familien-Ordner nutzen können; `anon` hatte USAGE auf einer Identitäts-Sequenz. | Migration `20261014235900_fale_security_hardening.sql`: `fale_uid()`/`fam_uid()` und alle Sync-Policies lehnen `is_anonymous` ab, Grants auf `private`/Sequenzen entzogen, EXECUTE-Grants zentral neu gesetzt | `test_rls_pentest.mjs` (700 Prüfungen), `test_sql.mjs` |
| F-06 | **Zip-Bomben** in DOCX/XLSX/PPTX (z. B. 1 GB aus 1 MB, oder gelogene Größenangaben) konnten den Tab zum Absturz bringen. | `office/vendor.js`: Grenzen für Einträge (20 000), Einzel- (512 MiB) und Gesamtgröße (1 GiB), Kompressionsrate (1000:1), Entpacken mit Deckel auf deklarierte Größe | `test_xss.py` (`bomb_big.docx`, `bomb_lie.docx`) |
| F-07 | **Bild-Bomben** (z. B. PNG 60 000 × 60 000) – Dekodieren/Canvas verbraucht Gigabytes. | `js/security.js`: Kopfzeilen-Prüfung (PNG/JPEG/GIF/BMP/WebP) vor jedem Dekodieren (Scan, OCR, Bildwerkzeuge, Vorschaubilder), Pixel-Obergrenze 100 MP, Canvas-Obergrenze 40 MP beim PDF-Rendern, `maxImageSize` in pdf.js | `test_xss.py` (`huge.png`, `hugepage.pdf`) |
| F-08 | **Tresor-KDF zu schwach:** PBKDF2 mit 400 000 Iterationen. | 600 000 Iterationen; bestehende Tresore werden beim Entsperren automatisch hochgestuft | `test_extras.py` (Tresor), `test_xss.py` |
| F-09 | **Sync: KDF-Parameter vom Server ungeprüft** – ein bösartiger Server hätte z. B. `iter: 1` liefern können. | `sync/crypto.js`: nur ganzzahlige Iterationen 600 000 … 10 000 000 und gültiges Salt, sonst Formatfehler | `test_account.py`, `test_sql.mjs` |
| F-10 | **Service-Worker-Cache-Vergiftung:** jede Navigation (auch Fehlerseiten oder andere HTML-Seiten) konnte als App-Shell im Cache landen. | `sw.js`: `/api/` und Test-Pfade nie cachen, fremde Navigationen network-first ohne Shell-Ersatz, Share-Target auf 20 Dateien / 200 MB begrenzt | `test_full.py` (Offline-Start), `test_share.py` |
| F-11 | **Android: Backups und eingehende Intents.** Standard-Manifest erlaubte Auto-/ADB-Backup aller App-Daten; das Share-Ziel nahm auch `content://`-URIs des eigenen FileProviders bzw. `file://` aus dem App-Verzeichnis an (Confused Deputy). | `cap-patch-android.mjs`: `allowBackup=false`, Data-Extraction-Rules, Network-Security-Config (kein Klartext, nur System-CAs in Release), Provider `exported=false`, Prüfung eingehender URIs (eigene Authorities/App-Pfade → „blocked“, max. 50), WebView ohne Datei-/Content-Zugriff, Debugging nur in Debug-Builds, `FLAG_SECURE`-Methode | `test_native.py` (Patch- und Java-Kompilier-Prüfungen) |
| F-12 | **Code-Pairing gegen kompromittierten Server** (Übertragung per 6-stelligem Code): der Server könnte als Vermittler auftreten. | Gemildert: Prüfnummer (SAS) wird angezeigt und zum Vergleich aufgefordert, QR-Pairing (Schlüssel im QR) empfohlen, Texte ehrlich formuliert; prinzipbedingt nicht vollständig behebbar | `test_share.py` |
| F-13 | **GitHub Actions** über verschiebbare Tags (`@v5`) eingebunden, Workflow-weites `contents: write`, persistierte Checkout-Token. | Alle Actions auf Commit-SHA gepinnt, `permissions` minimal je Workflow/Job, `persist-credentials: false`, Dependabot für Actions | `test_native.py` (Workflow-Struktur), YAML-Validierung |

### Niedrig

| ID | Befund | Status |
|---|---|---|
| F-14 | Externe Links in PDFs/Dokumenten öffneten ohne Rückfrage (Phishing). | Behoben: `openExternal()` mit Bestätigung und Zielanzeige, `noopener,noreferrer`, nur http(s)/mailto/tel; Steuer- und Leerzeichen entfernt |
| F-15 | Importiertes DOCX-HTML und eingefügtes HTML nur mit eigenem Sanitizer. | Behoben: DOMPurify 3.4.14 (lokal, nur bei Bedarf geladen) mit Editor-Profil |
| F-16 | AdMob-SSV: unsignierte, angehängte Parameter wurden mitgelesen. | Behoben: Parameter nur aus dem signierten Teil, Duplikate abgelehnt, Längenlimit, gedrosseltes Schlüssel-Nachladen |
| F-17 | JWT/JWKS: `kid` ohne Längenprüfung, Nachladen der JWKS bei unbekanntem `kid` ungedrosselt, `nbf` nicht geprüft. | Behoben (`supa-auth.js`) |
| F-18 | Schema-Normalisierung übernahm `__proto__`/`constructor`-Schlüssel. | Behoben (`schema.js`) |
| F-19 | KI-Mock-Anbieter und `localhost`-CORS auch in Production möglich; KI-Basis-URL ohne HTTPS-Pflicht. | Behoben (`config.js`, `http.js`) |
| F-20 | Prompt-Injection: Dokumenttext konnte die Trennmarken `</dokument>` imitieren. | Behoben (Marken im Text neutralisiert); Rest-Risiko dokumentiert |
| F-21 | Wiederherstellungsschlüssel / WLAN-Passwort blieben in der Zwischenablage. | Behoben: Löschen nach 60 s (wenn unverändert) |
| F-22 | Kein `FLAG_SECURE` bei Tresor und Wiederherstellungsschlüssel (Screenshots, App-Übersicht). | Behoben |
| F-23 | Organizer-Tags: Farben aus gespeicherten Daten ungeprüft in `style`. | Behoben (`cssColor`) |
| F-24 | Familien-Ordner: Cache der Unterschlüssel nicht an den Gruppenschlüssel gebunden (bei künftiger Schlüsselrotation hätten neue Einträge mit dem alten Schlüssel verschlüsselt werden können). | Behoben (`famcrypto.js`) |
| F-25 | CSV-Export der Steuer-Belege: Texte aus gescannten Belegen konnten als Excel-Formel starten (CSV-Injection). | Behoben (`tax.js`, Präfix `'`) |
| F-26 | Share-/Geräte-Tokens in `localStorage`. | Akzeptiert: gleiche Angreiferklasse wie IndexedDB, kein Backup; dokumentiert |
| F-27 | Rollback/Löschen durch bösartigen Server bei Sync/Shares; Metadaten sichtbar. | Akzeptiert, dokumentiert |
| F-28 | `style-src 'unsafe-inline'` (≈ 235 dynamische Inline-Styles). | Akzeptiert (keine Skriptausführung möglich), dokumentiert |
| F-29 | 6-stellige Tresor-PIN auf gerootetem, gestohlenem Gerät offline angreifbar. | Akzeptiert, Hinweis zu Passwort; dokumentiert |

### Info

| ID | Befund | Status |
|---|---|---|
| F-30 | Keine Integritätsprüfung für `vendor/`. | Behoben: `vendor/MANIFEST.json` (Versionen + SHA-256), Prüfung bei jedem Build und in CI |
| F-31 | Kein `SECURITY.md`, kein `security.txt`, kein Secret-Scan, kein CodeQL. | Behoben (`SECURITY.md`, `.well-known/security.txt`, `scripts/check-secrets.mjs`, `.github/workflows/security.yml`, `codeql.yml`, `dependabot.yml`) |
| F-32 | pdf.js 6.2.108: nicht von CVE-2024-4367 betroffen; zusätzlich `isEvalSupported:false`, `enableScripting:false`. | Bestätigt, gehärtet |
| F-33 | Repository ist öffentlich. | Empfehlung: privat stellen (kein Geheimnis im Code oder in der Git-Historie gefunden) |
| F-34 | HSTS `preload` gesetzt, Aufnahme in die Preload-Liste nur für eine eigene Domain möglich (`*.vercel.app` ist bereits preloaded). | Dokumentiert |
| F-35 | FileProvider-Pfade werden für „Teilen“ benötigt und bleiben (nicht exportiert, nur per Grant). | Dokumentiert |

## Geprüft ohne Befund
PDF-Metadaten, Gliederung, Anmerkungen, Formularfelder, JavaScript-/Launch-Aktionen und FontMatrix-Injektion
(CVE-2024-4367) in pdf.js; XSS über Dateinamen, Markdown, CSV; IDOR bei Share/Unterschrift/Übertragung/Konto;
SQL-Injektion (dynamisches SQL nur mit `format(%I/%L)`); `SECURITY DEFINER` ohne `search_path`; zeitkonstante
Vergleiche; Zufallsquellen für Schlüssel/IVs; Geheimnisse in Code und Git-Historie (keine gefunden).

## Testergebnisse (unter der neuen CSP, 14.10.2026)
| Suite | Ergebnis |
|---|---|
| `test_xss.py` (Angriffsdateien, CSP-/Trusted-Types-Durchsetzung) | 90/90 |
| `test_api_fuzz.mjs` (Fuzzing, CORS, Header, IDOR, JWT, SSV) | 85/85 |
| `test_rls_pentest.mjs` (RLS, Storage, alle RPCs, inkl. Familien-Ordner) | 700/700 |
| `test_sql.mjs` (Migrationen, idempotent) | 73/73 |
| API: `test_api.mjs` / `test_share_api.mjs` / `test_account_api.mjs` | 107/107 · 99/99 · 48/48 |
| E2E: full / office / extras / protools / pdfplus / ocr / ai / share / account | 100/100 · 159/160¹ · 179/179 · 107/107 · 105/105 · 91/91 · 84/84 · 76/76² · 59/59 |
| `test_native.py` (Android-Patch, Java-Kompilierung, Workflows) | 141/143¹ |
| Secret-Scan (Dateien + Git-Historie), Vendor-Manifest, Web-/Native-Build | ok |

¹ Erwartungsänderungen durch parallele Arbeiten, nicht sicherheitsbezogen: `HEUTE()` wird jetzt wie in Excel als Datum
angezeigt; neue Theme-Farben für die Android-Systemleisten. ² Der Offline-Test wartet jetzt auf den aktiven Service Worker.

## Empfehlungen an den Betreiber
1. Repository auf **privat** stellen (CodeQL braucht dann GitHub Advanced Security, sonst `codeql.yml` deaktivieren).
2. Unter Settings → Code security: **Dependabot alerts + security updates**, **Secret scanning + Push protection** und **Private vulnerability reporting** einschalten.
3. Secrets setzen/prüfen: `FALE_RPC_SECRET` (≥ 32 Zeichen, auch in `private.fale_secrets` als SHA-256), KI-Schlüssel nur in Vercel; nach jedem Verdacht rotieren.
4. AdMob-Test-IDs vor Veröffentlichung durch echte IDs ersetzen; Supabase „Anonymous sign-ins“ ausgeschaltet lassen.
5. In `.well-known/security.txt` eine überwachte Kontakt-E-Mail ergänzen, `Expires` jährlich erneuern.
6. Bei eigener Domain: HSTS-Preload beantragen (hstspreload.org).
