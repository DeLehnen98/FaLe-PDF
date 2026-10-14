# Domains – what to do once fale.network is bought

Nothing here is active yet. Until then the site runs on the Vercel project URL
(`fale-network.vercel.app` after the first deployment) and FaLe PDF stays on `fale-pdf.vercel.app`.

## Target

| Host | Vercel project | Notes |
|---|---|---|
| `fale.network` (apex) | `fale-network` (prj_8foHHmZOeaDuArg0iNHFS33ugELb) | primary domain of the network site |
| `www.fale.network` | `fale-network` | redirect (308) → `fale.network` |
| `pdf.fale.network` | `fale-pdf` (prj_nP3UDETxypzdYgw3Hc2LLE0W59oC) | FaLe PDF web app + its `/api` functions |

Both projects deploy from GitHub `DeLehnen98/FaLe-PDF`, branch `main`:
`fale-network` with root directory `network/`, `fale-pdf` with the repo root.

## 1. Add the domains in Vercel

1. Vercel → project **fale-network** → Settings → Domains → **Add** `fale.network`.
   Accept the suggestion to also add `www.fale.network` and choose
   "Redirect www.fale.network to fale.network".
2. Vercel → project **fale-pdf** → Settings → Domains → **Add** `pdf.fale.network`.
   Keep `fale-pdf.vercel.app` (existing links, the Android app and shared links keep working).

## 2. DNS – pick ONE of the two options

**Option A – Vercel nameservers (simplest, Vercel manages all records)**
At the registrar, set the nameservers to the ones Vercel shows under Domains, normally
`ns1.vercel-dns.com` and `ns2.vercel-dns.com`. Vercel then creates the records itself.
If you need mail on the domain later, add MX/TXT records in Vercel → Domains → fale.network → DNS records.

**Option B – keep the registrar's DNS**

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `pdf` | `cname.vercel-dns.com` |

Vercel may show project-specific values (e.g. a `…vercel-dns-0xx.com` CNAME or a different
A record) on the Domains page – if so, use exactly what Vercel shows. Remove any existing
AAAA/parking records for `@` and `www`. Certificates are issued automatically once DNS resolves.

Check: `dig +short fale.network`, `dig +short pdf.fale.network CNAME`, then open both in a browser.

## 3. After the domain works – network site (this folder)

- `assets/site.js` → `FALE_CONFIG.kontoUrl`: `https://pdf.fale.network/#/konto`
  (and `kontoAvailable: true` once the FaLe-Konto is live – reveals the sign-in buttons).
- `tools/build_pages.py` → `PDF_APP`, `PDF_INFO`, `PDF_PRIVACY` (and the two hard-coded
  `fale-pdf.vercel.app` links in the PDF page texts) → `https://pdf.fale.network/…`; then
  re-run `python3 network/tools/build_pages.py`.
- Canonical URLs, hreflang, Open Graph, `sitemap.xml`, `robots.txt`, `security.txt` already
  use `https://fale.network` – nothing to change.
- Fill in `.well-known/security.txt` and the placeholders in `/impressum/` + `/datenschutz/`
  (also `/en/imprint/`, `/en/privacy/`) via `tools/build_pages.py`.
- Optional, once you're sure the domain will stay on HTTPS: add `; preload` to the HSTS header in
  `vercel.json` and submit at hstspreload.org.
- Submit `https://fale.network/sitemap.xml` in Google Search Console / Bing Webmaster Tools.

## 4. After the domain works – FaLe PDF (do NOT change before DNS is live)

| File | What to change |
|---|---|
| `api/_lib/config.js` | `DEFAULT_ORIGINS`: add `'https://pdf.fale.network'` (keep `https://fale-pdf.vercel.app` so old installs keep working). Or set env `AI_ALLOWED_ORIGINS=https://pdf.fale.network` in Vercel. |
| `js/share/api.js` | `PUBLIC_ORIGIN` → `'https://pdf.fale.network'` (base for share / sign-request / device links handed out by the native app; the web app uses `location.origin`). |
| `js/ai/config.js` | `API_BASE_NATIVE` → `'https://pdf.fale.network'` (Android app's API base). Ship a new app build. |
| `js/share/signer.js` | footer text "Erstellt mit FaLe PDF – fale-pdf.vercel.app" → `pdf.fale.network` (+ the same string in `scripts/i18n-ignore.txt`). |
| `js/views.js` | "Mehr von FaLe" card: `https://fale-network.vercel.app/` → `https://fale.network/`. |
| `sitemap.xml`, `robots.txt` | all `https://fale-pdf.vercel.app/…` → `https://pdf.fale.network/…` |
| `info.html`, `info-en.html` | canonical, hreflang, `og:url`, `og:image`, `twitter:image`, JSON-LD `url`/`image` (9 occurrences each). |
| `datenschutz.html`, `impressum.html` | replace the `[DOMAIN]` placeholders with `pdf.fale.network`. |
| `capacitor.config.json` | nothing to change today (`server.hostname` is `localhost`); only if you later add `allowNavigation`, use the new host. |
| Supabase / other backends | if any auth redirect URLs or CORS lists contain `fale-pdf.vercel.app`, add `https://pdf.fale.network`. |
| Google Play listing | website + privacy-policy URL → `https://pdf.fale.network/datenschutz.html` (or `https://fale.network/datenschutz/` for the network-level policy). |

Optionally redirect `fale-pdf.vercel.app` → `pdf.fale.network` later (Vercel → fale-pdf →
Domains → edit → redirect). Do this only after the Android app with the new
`API_BASE_NATIVE` is rolled out, because redirects break CORS preflights of old app versions.

## Build settings (already configured, for reference)

- `fale-network`: framework none, no install/build command, output `.`, root `network`,
  Ignored Build Step `git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .`
  (only builds when `network/` changed).
- `fale-pdf`: Ignored Build Step
  `git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- . ':(exclude)network'`
  (skips pushes that only touch `network/`).
