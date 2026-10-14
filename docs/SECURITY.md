# FaLe PDF – Sicherheitsmodell (Threat Model)

Stand: Oktober 2026 · gilt für Web-App (`fale-pdf.vercel.app`), Android-App (Capacitor), Serverfunktionen
(`api/`, Vercel) und Datenbank (Supabase, `supabase/migrations/`). Ergebnisse und Tests des Audits:
[`SECURITY-AUDIT-2026-10.md`](SECURITY-AUDIT-2026-10.md). Meldungen: [`../SECURITY.md`](../SECURITY.md).

> **Ehrlich vorweg:** „Unhackbar“ gibt es nicht. Ziel ist, dass jeder realistische Angriff an mehreren
> unabhängigen Schutzschichten scheitert (Defense in Depth), dass ein kompromittierter Server keine
> Inhalte lesen kann (Ende-zu-Ende-Verschlüsselung) und dass Fehler durch Tests und CI früh auffallen.

---

## 1. Schützenswerte Werte (Assets)

| Wert | Wo | Schutzziel |
|---|---|---|
| Dokumente der Nutzer (PDF, Office, Scans, Tresor) | nur auf dem Gerät (IndexedDB / App-Speicher) | Vertraulichkeit, Integrität |
| Tresor-Inhalte | IndexedDB, AES-256-GCM, Schlüssel aus Passwort/PIN (PBKDF2-SHA-256, 600 000 Iterationen) | Vertraulichkeit auch bei Gerätezugriff |
| Geteilte Dateien („Sicher teilen“, Unterschrift anfordern, Übertragung) | Server speichert nur Chiffretext; Schlüssel nur im Link-Fragment `#k=…` | Server kann nicht mitlesen |
| FaLe Sync / Familien-Ordner | Supabase Storage + Tabellen, nur Chiffretext; Hauptschlüssel durch Passwort bzw. Wiederherstellungsschlüssel verpackt, Familien-Gruppenschlüssel per ECIES (P-256) | Zero-Knowledge gegenüber Server/DB |
| Konto (Supabase Auth), Geräte, FaLe Plus | Supabase (RLS) | Isolation zwischen Konten |
| Server-Geheimnisse (`FALE_RPC_SECRET`, KI-Anbieter-Schlüssel, Play-Service-Account, Signier-Keystore) | Vercel-/GitHub-Secrets | dürfen nie in Code, Logs, Antworten |
| KI-Kontingent / Kosten | API `api/ai` | Schutz vor Missbrauch |
| Integrität der App selbst | Git-Repository, `vendor/`, CI | keine untergeschobenen Skripte |

## 2. Angreifer und Vertrauensgrenzen

```
 [bösartige Datei] ─▶ ┌──────────── Gerät (vertrauenswürdig, solange entsperrt) ─────────────┐
 [bösartiger Link] ─▶ │  App (PWA / WebView)  ──  IndexedDB, Tresor, Schlüssel               │
 [andere Android-App]▶│  CSP + Trusted Types, Sanitizer, Limits, Intent-Prüfung              │
                      └───────────────┬────────────────────────────────────────────────────────┘
                                      │ HTTPS (HSTS), nur Chiffretext bzw. KI-Text
                      ┌───────────────▼──────────┐      ┌────────────────────────────┐
 [Netzwerk-Angreifer] │ Vercel API (api/**)      │──────▶ Supabase (RLS, RPCs mit     │
 [API-Missbrauch]  ─▶ │ Validierung, Rate-Limits │      │ Server-Geheimnis)           │
                      └──────────────────────────┘      └────────────────────────────┘
                         [kompromittierter Server / DB-Betreiber] sieht nur Chiffretext
```

| Akteur | Was er kann | Wichtigste Schutzmaßnahmen |
|---|---|---|
| **Bösartige Dokumente** (PDF, DOCX, XLSX, PPTX, CSV, Bilder, Markdown) | Skripte/HTML einschleusen, Parser überlasten (Zip-/Bild-Bomben), auf externe Seiten locken | pdf.js ohne Scripting/`eval` (`enableScripting:false`, `isEvalSupported:false`), App-HTML nur über `esc()`/`textContent`, DOMPurify für importiertes DOCX-HTML und KI-Markdown, Trusted-Types-Default-Policy als Netz, CSP ohne Inline-Skripte, nur Hex-Farben/geprüfte Schriftnamen aus Office-XML, Zip-Grenzen (Einträge, Größe, Kompressionsrate, gedeckeltes Entpacken), Bildgrößen-Prüfung vor dem Dekodieren, Canvas-Obergrenze, externe Links nur nach Bestätigung mit `noopener,noreferrer` |
| **Bösartige Share-Links** | manipulierte IDs/Schlüssel, Phishing über Dateinamen, XSS im Empfänger | IDs/Schlüssel streng validiert, Inhalte nur entschlüsselt + escaped angezeigt, AES-GCM (Manipulation = Entschlüsselungsfehler), keine Weiterleitungen |
| **Kompromittierter Server / DB** | Daten lesen, verändern, zurückspielen, falsche Schlüssel liefern | Ende-zu-Ende-Verschlüsselung (AES-256-GCM, HKDF, PBKDF2 ≥ 600 000), Schlüssel nie beim Server, KDF-Parameter vom Server werden geprüft (Mindest-/Höchstwerte), AAD bindet Chiffretexte an IDs. **Grenzen:** ein bösartiger Server kann Daten löschen oder alte Stände zurückspielen (Rollback), Metadaten (Größen, Zeiten, Anzahl) sehen und beim Code-Pairing der Übertragung als Vermittler auftreten – deshalb Prüfnummer (SAS) vergleichen bzw. QR-Pairing nutzen; die App sagt das offen. Eine kompromittierte *Web-Auslieferung* (Vercel/Repo) könnte geänderten JS-Code ausliefern – die Android-App ist davon nicht betroffen (Code im APK). |
| **Netzwerk-Angreifer** | mitlesen, verändern | nur HTTPS, HSTS (2 Jahre, `preload`), `upgrade-insecure-requests`, Android: kein Klartext-Verkehr, nur System-CAs in Release |
| **Andere Android-Apps** | Intents/Dateien unterschieben, Backups/Screenshots abgreifen | Komponenten `exported=false` außer Launcher/Share-Ziel, eingehende URIs geprüft (keine eigenen Provider/App-Dateien, max. 50 Dateien), `allowBackup=false` + Data-Extraction-Rules, `FLAG_SECURE` beim Tresor und beim Wiederherstellungsschlüssel, WebView ohne Datei-/Content-Zugriff, kein Debugging in Release |
| **Gestohlenes Telefon** | App öffnen, Speicher auslesen (gerootet) | Tresor verschlüsselt + Auto-Sperre, Tresor-PIN nur zusammen mit dem Gerät nutzbar; Geheimnisse in der Zwischenablage werden nach 60 s entfernt. **Grenze:** nicht-Tresor-Dokumente liegen unverschlüsselt im App-Speicher (Schutz durch Android-Gerätesperre/Verschlüsselung); eine 6-stellige PIN ist auf einem gerooteten Gerät offline knackbar → für hohen Schutz ein Passwort wählen. |
| **Missbräuchliche API-Clients** | Kosten verursachen, fremde Daten abfragen (IDOR), Server überlasten | strenge CORS-Allow-List, Rate-Limits pro Gerät/IP (IPv6 je /64), Größenlimits, Schema-Validierung, Besitzer-Token für jede Share-Operation, signierte Belohnungs-Callbacks (AdMob SSV, ECDSA, nur signierte Parameter), JWT-Prüfung mit festen Algorithmen (ES256/RS256), `iss`/`aud`/`exp`/`nbf`, JWKS-Cache mit `kid`-Rotation und gedrosseltem Nachladen, Fehlermeldungen ohne Interna |

## 3. Schutzmaßnahmen im Einzelnen

### 3.1 Browser / WebView
* **Content-Security-Policy** (Header in `vercel.json`, gleichlautendes `<meta>` in `index.html` für die Android-WebView; der Build bricht ab, wenn beide auseinanderlaufen):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://fale-pdf.vercel.app https://*.supabase.co wss://*.supabase.co data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; manifest-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types default fale-internal dompurify`
  – `'wasm-unsafe-eval'` nur für WebAssembly (pdf.js-Decoder, OCR); kein `'unsafe-eval'`, keine Inline-Skripte.
  – `style-src 'unsafe-inline'` bleibt (≈ 235 Inline-Styles, u. a. dynamische Positionen im PDF-Editor); Risiko gering, da Skripte ausgeschlossen sind.
* **Trusted Types** (`js/boot.js`): Default-Policy entfernt aktive Inhalte aus jedem HTML-String, Script-URLs nur same-origin/`blob:`, String-zu-Code verboten.
* Weitere Header: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` (Kamera/Mikrofon nur `self`, alles andere aus), HSTS. **COEP** ist bewusst nicht gesetzt: keine Funktion braucht Cross-Origin-Isolation, und `require-corp` würde Worker/Blob-Flüsse riskieren.
* **Service Worker**: speichert nie `/api/`-Antworten, nur die App-Shell; fremde Navigationen landen nicht im Shell-Cache.

### 3.2 Kryptografie
* AES-256-GCM mit zufälligem 96-Bit-IV pro Verschlüsselung (`crypto.getRandomValues`), Schlüssel über HKDF-SHA-256 getrennt nach Zweck; PBKDF2-SHA-256 mit 600 000 Iterationen (OWASP 2023) für Passwörter, ältere Tresore werden beim Entsperren hochgestuft.
* Schlüssel als nicht exportierbare `CryptoKey`-Objekte, wo möglich; Rohbytes werden nach Gebrauch überschrieben. `Math.random` nur für nicht-geheime IDs/Animationen.
* Tresor: Auto-Sperre (Standard 3 Minuten, sofort beim Verlassen); Geheimnisse (Wiederherstellungsschlüssel, WLAN-Passwort) verlassen die Zwischenablage nach 60 s.
* `localStorage` enthält keine Benutzer-Geheimnisse außer Share-Besitzer-Tokens und Geräte-Tokens; diese sind wie IndexedDB nur für die App lesbar und vom Backup ausgeschlossen (Android). Schlüssel für Sync/Tresor liegen nur in IndexedDB bzw. im Arbeitsspeicher.

### 3.3 Server (`api/**`)
Eingaben werden per Schema geprüft (`api/_lib/schema.js`, Prototype-Pollution-sicher), Body-Größen begrenzt, CORS nur für die eigenen Origins (localhost nur außerhalb von Production), Sicherheits-Header auf jeder Antwort, Geheimnisvergleiche mit `timingSafeEqual`, Fehlermeldungen ohne Stacktraces/Interna, keine Geheimnisse in Logs, KI-Anbieter nur über HTTPS, keine vom Client steuerbaren URLs (kein SSRF).

### 3.4 Datenbank (Supabase)
RLS auf allen Tabellen, nur SELECT-Policies auf eigene Zeilen, Schreiben ausschließlich über `SECURITY DEFINER`-Funktionen mit `search_path = ''`, Eingabeprüfung in jeder Funktion, Server-Funktionen per Geheimnis (`FALE_RPC_SECRET`, SHA-256-Vergleich) abgesichert, Schema `private` für API-Rollen geschlossen, anonyme Supabase-Identitäten ausgeschlossen, private Storage-Buckets mit pfadbasierten Policies. Geprüft durch einen RLS-Penetrationstest (zwei Konten, anonym, Publishable-Key) auf jeder Tabelle, jedem Bucket und jeder Funktion.

### 3.5 Android
`allowBackup=false`, Data-Extraction-Rules, `usesCleartextTraffic=false` + Network-Security-Config (nur System-CAs; Benutzer-CAs nur in Debug-Builds), `exported=false` für Provider/Komponenten ohne Intent-Filter, minimale FileProvider-Pfade, WebView ohne Datei-/Content-Zugriff und ohne Mixed Content, Debugging nur in Debug-Builds, keine `allowNavigation`, Prüfung eingehender Share-Intents, `FLAG_SECURE` per Plugin-Methode `FaleIncoming.setSecure`.

### 3.6 Lieferkette und Repository
Drittanbieter-Code liegt geprüft in `vendor/`; jede Datei ist mit SHA-256 in `vendor/MANIFEST.json` erfasst und wird bei jedem Build verifiziert (`scripts/vendor-manifest.mjs`). pdf.js 6.2.108 ist nicht von CVE-2024-4367 betroffen (behoben in 4.2.67). GitHub Actions sind auf Commit-SHAs festgelegt, jede Workflow-Datei hat minimale `permissions`, Dependabot (npm + Actions), CodeQL, Secret-Scan über Dateien und Git-Historie (`scripts/check-secrets.mjs`).

## 4. Restrisiken (bewusst akzeptiert)
* Rollback/Löschen durch einen bösartigen Server bei Sync und Shares (Integrität einzelner Objekte ist geschützt, Vollständigkeit nicht).
* Metadaten (Dateigrößen, Zeitpunkte, Anzahl, IP-Adressen beim Hoster).
* Ausgelieferter Web-Code muss dem Hoster vertrauen (gilt für jede Web-App); wer das nicht will, nutzt die Android-App.
* `style-src 'unsafe-inline'`.
* Lokal unverschlüsselte Nicht-Tresor-Dokumente auf entsperrten oder gerooteten Geräten.
* Prompt-Injection in KI-Funktionen: Dokumenttext wird klar abgegrenzt und kann nur Text erzeugen, keine Aktionen auslösen.

---

## English summary

FaLe PDF keeps documents on the device; anything that leaves it (share links, sync, family folder,
transfers) is end-to-end encrypted with AES-256-GCM and keys that never reach the server (link fragment,
password-/recovery-key-wrapped master key, ECIES-wrapped group keys). Nothing is "unhackable"; the design
aims for defence in depth:

* **Malicious files** – pdf.js without scripting/eval, strict output escaping, DOMPurify for imported HTML,
  a Trusted Types default policy as a safety net, a strict CSP without inline script, zip/image bomb limits,
  canvas caps, confirmation before opening external links.
* **Compromised server/DB** – sees only ciphertext and metadata; can delete or roll back data and could
  act as a relay in code pairing (users compare a short authentication string; QR pairing avoids it).
* **Network attacker** – HTTPS only, HSTS preload-ready, no cleartext on Android, system CAs only.
* **Other Android apps / stolen phone** – no backups, non-exported components, validated intents,
  FLAG_SECURE on secret screens, vault auto-lock, clipboard wiping after 60 s.
* **Abusive API clients** – CORS allow-list, rate limits (IPv6 per /64), body limits, schema validation,
  owner tokens, signed callbacks, pinned-algorithm JWT verification with JWKS rotation, generic errors.
* **Database** – RLS everywhere, writes only through `SECURITY DEFINER` functions with empty
  `search_path` and input validation, secret-gated server RPCs, anonymous identities rejected.
* **Supply chain** – vendored libraries pinned and hash-verified on every build, SHA-pinned GitHub
  Actions with least-privilege permissions, Dependabot, CodeQL and a secret scanner in CI.

Residual risks: rollback/deletion by a malicious server, metadata, trust in the web host for delivered
code (use the Android app to avoid it), `style-src 'unsafe-inline'`, unencrypted non-vault files on an
unlocked/rooted device.
