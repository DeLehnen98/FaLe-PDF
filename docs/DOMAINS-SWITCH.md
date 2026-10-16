# Domain-Umstellung: fale.network · pdf.fale.network · faleone.com

Stand: 16.10.2026. Die Domains sind in Vercel eingetragen, DNS propagiert noch. **Phase 1 (erledigt, dieses
Dokument)**: alles, was neue Domains *zusätzlich* erlauben muss, ist live-sicher eingebaut. Die primären URLs
zeigen weiterhin auf `*.vercel.app`. **Phase 2 (Flip)** erst, wenn die neuen Hosts per HTTPS antworten.

| Host | Vercel-Projekt | Rolle |
|---|---|---|
| `fale.network` | `fale-network` | Netzwerk-Seite (Canonical war schon immer `https://fale.network`) |
| `www.fale.network` | `fale-network` | 308 → `fale.network` |
| `pdf.fale.network` | `fale-pdf` | FaLe PDF Web-App **und** `/api/*` |
| `faleone.com` | `fale-one` | FaLe One |
| `www.faleone.com`, `one.fale.network` | `fale-one` | 308 → `faleone.com` |

Die alten Adressen `fale-pdf.vercel.app`, `fale-network.vercel.app`, `fale-one.vercel.app` bleiben dauerhaft
gültig (installierte Android-Apps, geteilte Links, Signatur-Links, Lesezeichen).

## Phase 1 – was jetzt schon beide Welten kann

| Bereich | Datei | Änderung |
|---|---|---|
| API-CORS | `api/_lib/config.js` | `DEFAULT_ORIGINS` + `https://pdf.fale.network`, `https://fale.network`; `DEFAULT_ONE_ORIGINS` + `https://faleone.com` (alte bleiben). `www.*` leiten nur um und brauchen keinen Eintrag. |
| CSP FaLe PDF | `index.html` (Meta) + `vercel.json` (`/` und `/(.*)\.html`) | `connect-src` + `https://pdf.fale.network` (für die Android-App nach dem Flip; Web nutzt `'self'`). |
| CSP FaLe One | `one/vercel.json` | `connect-src` + `https://pdf.fale.network`. |
| security.txt | `.well-known/security.txt` | zweite `Canonical:`-Zeile für `pdf.fale.network` (RFC 9116 erlaubt mehrere). |
| Build-Wächter | `scripts/vercel-build.mjs` | bricht ab, wenn `info.html`, `info-en.html`, `sitemap.xml`, `robots.txt` nicht (nur) auf `PDF_ORIGIN` aus `js/domains.js` zeigen oder die CSP eine der beiden API-Domains nicht erlaubt. |
| Live-Smoke | `scripts/live-smoke.mjs` | prüft CORS-Preflight zusätzlich für `https://faleone.com` und `https://pdf.fale.network` (geht schon vor DNS, `Origin` ist nur ein Header). |
| Android | – | keine `allowNavigation`, keine App Links, keine host-spezifische Network-Security-Config → nichts zu ergänzen. |
| Manifeste | `manifest.webmanifest`, `one/manifest.webmanifest`, `network/site.webmanifest` | nur relative `id`/`scope`/`start_url`/`share_target` → nichts zu tun. |

## Die zentralen Schalter (je Oberfläche genau einer)

| Oberfläche | Datei | Konstante(n) | heute | nach dem Flip |
|---|---|---|---|---|
| FaLe PDF App (Web + Android) | `js/domains.js` | `PDF_ORIGIN` | `https://fale-pdf.vercel.app` | `https://pdf.fale.network` |
| | | `NETWORK_ORIGIN` | `https://fale-network.vercel.app` | `https://fale.network` |
| | | `ONE_ORIGIN` | `https://fale-one.vercel.app` | `https://faleone.com` |
| FaLe One | `one/js/config.js` | `PDF_ORIGIN` (= `API_BASE`, `PDF_APP`) | `https://fale-pdf.vercel.app` | `https://pdf.fale.network` |
| | | `ONE_ORIGIN` (Notfall-Einladungstext) | `https://fale-one.vercel.app` | `https://faleone.com` |
| | | `NETWORK_ORIGIN` (Datenschutz/Impressum) | `https://fale-network.vercel.app` | `https://fale.network` |
| FaleNetwork | `network/tools/build_pages.py` | `PDF_ORIGIN` (alle App-Links, Vorlagen-Links, `assets/site.js` → `kontoUrl`) | `https://fale-pdf.vercel.app` | `https://pdf.fale.network` |
| | | `BASE` | `https://fale.network` | unverändert |
| API | `api/_lib/config.js` | `PRIMARY_APP_URL` / `PRIMARY_ONE_URL` (oder Vercel-Env `PUBLIC_APP_URL` / `FALE_ONE_URL`, ohne Code) | `…vercel.app` | `https://pdf.fale.network` / `https://faleone.com` |

`js/domains.js` speist: `API_BASE_NATIVE` (`js/ai/config.js`), `PUBLIC_ORIGIN`/`linkBase()` für Teilen-,
Unterschrifts- und Übertragungs-Links der Android-App (`js/share/api.js`), den Fallback für Familien-Einladungen
(`js/smart/family.js`), die Fußzeile der Signatur-Protokollseite (`js/share/signer.js`, `PDF_HOST`) und die
„Mehr von FaLe“-Karte (`js/views.js`). Die Web-App selbst nutzt für API und Links immer `location.origin` –
sie funktioniert also unter beiden Hosts ohne Änderung.

## Phase 2 – Flip-Checkliste

Vorher prüfen: `curl -sI https://pdf.fale.network/ https://fale.network/ https://faleone.com/` → 200 mit
gültigem Zertifikat, `curl -s -X OPTIONS -H 'Origin: https://faleone.com' -H 'Access-Control-Request-Method: POST' -i https://pdf.fale.network/api/drive?a=quota` → `access-control-allow-origin: https://faleone.com`.

### 1. Code (ein Commit)

1. `js/domains.js`: `PDF_ORIGIN = 'https://pdf.fale.network'`, `NETWORK_ORIGIN = 'https://fale.network'`,
   `ONE_ORIGIN = 'https://faleone.com'`.
2. Statische SEO-Dateien von FaLe PDF (der Build-Wächter erzwingt das):
   `sed -i 's#https://fale-pdf.vercel.app#https://pdf.fale.network#g' info.html info-en.html sitemap.xml robots.txt`
3. `.well-known/security.txt`: Kopfkommentar anpassen; beide `Canonical:`-Zeilen bleiben.
4. `one/js/config.js`: `PDF_ORIGIN = 'https://pdf.fale.network'`, `ONE_ORIGIN = 'https://faleone.com'`,
   `NETWORK_ORIGIN = 'https://fale.network'` → danach `node scripts/sync-one-shared.mjs` (sw.js-Liste).
5. `network/tools/build_pages.py`: `PDF_ORIGIN = 'https://pdf.fale.network'` →
   `python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py` (schreibt alle Seiten,
   `assets/site.js` `kontoUrl` und `network/sw.js` neu).
6. `api/_lib/config.js`: `PRIMARY_APP_URL = 'https://pdf.fale.network'`, `PRIMARY_ONE_URL = 'https://faleone.com'`
   (alternativ nur Vercel-Env `PUBLIC_APP_URL` / `FALE_ONE_URL` im Projekt `fale-pdf` setzen).
   **CORS-Listen nicht kürzen** – alte Origins bleiben erlaubt.
7. Optional, nur Kosmetik: Default-`BASE`/`ORIGIN` in `scripts/live-smoke.mjs`, `.github/workflows/live-smoke.yml`,
   `.github/workflows/ai-smoke.yml` auf `https://pdf.fale.network`; Doku-Beispiele in `docs/FALE-ONE-API.md`
   (§2 Base URL, §7.9 Link-Format), `docs/SECURITY.md`, `SECURITY.md`, `store/AI-SETUP.md`,
   `store/RELEASE-CHECKLIST.md`, `store/data-safety.md` (Löschlink), `one/README.md`.
8. Tests mitziehen: `test_network.py` erwartet `https://fale-pdf.vercel.app/#/konto` als Konto-Link →
   `https://pdf.fale.network/#/konto`. Die API-Tests (Preflight von `fale-pdf.vercel.app` / `fale-one.vercel.app`)
   bleiben gültig, weil die alten Origins erlaubt bleiben.
9. Android: neuen Build ausliefern (API-Basis und ausgegebene Links ändern sich erst mit dem App-Update; alte
   Installationen sprechen weiter `fale-pdf.vercel.app` an – darum diese Domain **nie** abschalten).

### 2. Dashboards (nicht im Repo)

- **Supabase → Authentication → URL Configuration**: Redirect-URL `https://pdf.fale.network/**` **jetzt schon**
  ergänzen (additiv, Google-Login nutzt `location.origin`); nach dem Flip Site URL auf `https://pdf.fale.network`.
  `https://fale-pdf.vercel.app/**` und `https://localhost/**` bleiben.
- **Google OAuth** (falls aktiv): autorisierte JavaScript-Ursprünge um `https://pdf.fale.network` ergänzen;
  Redirect-URI bleibt die Supabase-Callback-URL.
- **Google Play**: Website, Datenschutz-URL (`https://pdf.fale.network/datenschutz.html`) und Löschlink
  (`https://pdf.fale.network/#/konto`). AdMob-SSV-Callback darf auf `fale-pdf.vercel.app` bleiben.
- **Search Console / Bing**: `https://pdf.fale.network/` als Property, Sitemap einreichen;
  `https://fale.network/sitemap.xml` für die Netzwerk-Seite.
- **Umleitung alt → neu** (optional, frühestens Wochen nach dem Flip): in `fale-pdf` nur HTML-Seiten umleiten,
  **niemals `/api/*`** (Preflights folgen keinen Redirects; alte Android-Apps brächen) und nicht `/#/s/…`-Links
  ohne Test (Fragment bleibt bei 308 erhalten, aber prüfen).
- **HSTS-Preload**: erst nach stabilem Betrieb `fale.network` und `faleone.com` auf hstspreload.org eintragen
  (die Header setzen bereits `max-age=63072000; includeSubDomains`; `preload` nur in FaLe PDF).

## E-Mail-DNS (später, für Transaktionsmails)

Wer sendet was: Supabase-Auth-Codes (`konto@fale.network`, Custom SMTP über Resend, siehe
`store/ACCOUNT-SETUP.md` §4) und Notfallzugang-Mails von FaLe One (`NOTIFY_FROM="FaLe One <notfall@fale.network>"`,
`api/_lib/notify.js`). Empfangen müssen `hallo@fale.network` (Support, `one/js/config.js`) und
`postmaster@fale.network` (DMARC-Berichte).

DNS-Einträge im Vercel-Dashboard → Domains → `fale.network` → DNS Records. Die exakten DKIM-Werte zeigt Resend an.

| Zweck | Typ | Name | Wert |
|---|---|---|---|
| DKIM (Resend) | TXT | `resend._domainkey` | `p=MIGfMA0…` (aus Resend kopieren) |
| Bounce/Return-Path (Resend) | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (Prio 10) |
| SPF für den Return-Path | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@fale.network; adkim=r; aspf=r` → nach 2–4 Wochen sauberer Berichte `p=quarantine`, später `p=reject` |
| Empfang (Apex) | MX | `@` | Mailanbieter für Postfächer/Weiterleitung (z. B. Migadu, ImprovMX, Forward Email) laut dessen Anleitung |
| SPF Apex | TXT | `@` | nur **ein** SPF-Record: `v=spf1 include:<Mailanbieter> ~all` (Resend sendet über `send.`, braucht hier keinen Eintrag) |

Hinweise:
- Vercel-Domains haben keine voreingestellten MX-Records; ohne Apex-MX kommen `hallo@`/`postmaster@` nicht an.
- Danach in Vercel (`fale-pdf`): `NOTIFY_PROVIDER=resend`, `RESEND_API_KEY` (sensitive), `NOTIFY_FROM`;
  in Supabase: Custom SMTP (`smtp.resend.com:465`, User `resend`).
- **`faleone.com` verschickt keine Mails** → Spoofing sperren: TXT `@` `v=spf1 -all`, TXT `_dmarc`
  `v=DMARC1; p=reject; rua=mailto:postmaster@fale.network`, optional Null-MX `MX @ .` (Prio 0). Wer später von
  `faleone.com` senden will, ersetzt diese Einträge durch das Resend-Schema oben.
- Prüfen: `dig +short TXT resend._domainkey.fale.network`, `dig +short TXT _dmarc.fale.network`,
  Testmail an mail-tester.com.
