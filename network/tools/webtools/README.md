# FaLe Werkzeuge – contract for web tools

Free, mobile-first PDF/image tools on the FaleNetwork site. Every tool has its own SEO page in German
(`/werkzeuge/<slug>/`) and English (`/en/tools/<slug>/`) and processes files **only in the browser**.

**Adding a tool = adding new files.** Do not edit shared files (`build.py`, `shell.js`, `lib/*`,
`wt.css`, `vercel.json`, other tools' specs). If you really need a shared change, keep it backwards
compatible and mention it in your report.

```
network/tools/webtools/
  build.py              generator (pages, hubs, manifests, sw.js, sitemap) – imports ../build_pages.py
  specs/<id>.json       one spec per tool (DE + EN content)            ← you add one
  sw.template.js        service worker source (build.py writes network/sw.js)
  make_og.py            Open Graph images og-tools-{de,en}.png (Playwright + Pillow, run by hand)
network/assets/wt/
  shell.js              runtime of every tool page (intake, cards, options, progress, result …)
  hub.js                hub search / category filter / share-target chooser
  wt.css                all styles (mobile first, tokens from ../fale-tokens.css)
  lib/                  shared helpers (see below)
  lib/shared/           GENERATED copies of app modules (scripts/sync-webtools-vendor.mjs)
  vendor/               GENERATED copies of pdf.js, pdf-lib, JSZip, font (+ LICENSE files, MANIFEST.json)
  tools/<id>.js         one module per tool                                ← you add one
```

Regenerate everything (deterministic, run twice → no diff):

```
python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py
node scripts/sync-webtools-vendor.mjs            # only when vendor/ or a synced js/ module changed
```

## 1. Spec – `specs/<id>.json`

File name = `id`. Texts are **plain text** (they are HTML-escaped; no markup, no links).

| Field | Required | Meaning |
|---|---|---|
| `id` | ✓ | kebab-case, e.g. `split-pdf`; also the module name |
| `category` | ✓ | `organize` · `optimize` · `convert-to-pdf` · `convert-from-pdf` · `edit` · `security` · `images` · `everyday` |
| `icon` | ✓* | name from `ICONS` in build.py (merge, split, compress, image-pdf, pdf-image, pages, rotate, extract, delete, lock, unlock, sign, edit, text, watermark, numbers, crop, camera, scan, ocr, doc, sheet, slides, resize, photo, qr, stamp, form, compare, redact, repair, info, zip, grayscale, flatten, calendar, receipt, tool) |
| `iconSvg` | * | instead of `icon`: inner SVG for a 24×24 stroke icon, e.g. `"<path d=\"M4 4h16\"/>"` |
| `module` | ✓ | `tools/<id>.js` (must exist) |
| `accepts` | ✓ | MIME types and extensions: `["application/pdf", ".pdf"]`, `["image/*", ".jpg", …]` (the real format is sniffed from the bytes) |
| `multiple` | | `true` = several files (default `false`: a new pick replaces the file) |
| `minFiles` / `maxFiles` | | defaults 1 / no limit. Avoid `maxFiles` – the pages promise "Ohne Limits" |
| `popular` + `order` | | shown in the hub's "Beliebt" row and on the home page; lower `order` first |
| `related` | | ids for "Passende Werkzeuge" (2–4) |
| `next` | | ids offered as "Weiter mit …" after a run (only if the outputs match their `accepts`) |
| `needs` | | `pdfjs`, `pdflib`, `jszip`, `office`, `unicodefont` (tools that draw text into PDFs) – cached for offline use after the first visit |
| `trademarkNote` | | `true` adds the trademark sentence (for "Word (DOCX)", "Excel (XLSX)" as format names) |
| `de` / `en` | ✓ | per language, see below |

Per language (`de`, `en`):

| Field | Notes |
|---|---|
| `slug` | URL segment, a–z 0–9 and dashes (`pdf-teilen` / `split-pdf`). `teilen`/`share` are reserved |
| `name` | short tool name (cards, breadcrumb, "Weiter mit") |
| `short` | one line for cards (≈ 60 chars) |
| `title` | `<title>`, ≤ 65 chars, ends with `\| FaleNetwork` |
| `h1`, `lede` | short – the pick zone must stay above the fold on a 390 × 844 phone |
| `metaDescription` | 110–160 chars, natural sentence(s) |
| `pickLabel` | optional, default "PDF auswählen" / "Bilder auswählen" / "Dateien auswählen" from `accepts` |
| `primaryButton` | verb: "Zusammenfügen", "Compress" |
| `keywords` | optional synonyms for the hub search (not shown) |
| `steps` | exactly 3 `{title, text}` (also HowTo JSON-LD) |
| `why` | 3–4 `{title, text}` – only things this tool really does |
| `faq` | 4–6 `{q, a}` (also FAQPage JSON-LD) |

Writing rules: German in du-form like the rest of the site, natural English; **no third-party brand or
competitor names** (build.py refuses Adobe/Acrobat, WPS, iLovePDF, Smallpdf, PDF24, Sejda, Microsoft …);
only claims the tool really fulfils (test them); no ratings, user counts or invented numbers. Format
names (PDF, JPG, PNG) are fine; Office formats only as "Word (DOCX)" etc. with `trademarkNote: true`.

## 2. Tool module – `assets/wt/tools/<id>.js`

An ES module whose default export is mostly declarative. The shell does intake, file cards, reorder,
passwords, option controls, progress, cancel, errors, download/share/ZIP and "Weiter mit".

```js
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
export default {
  options: [ /* schema, see below */ ],
  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i / inputs.length, { de: `Datei ${i + 1} von ${inputs.length}`, en: `File ${i + 1} of ${inputs.length}` });
      const doc = await input.pdfDoc();                 // decrypted pdf-lib document
      // … work, and call `await ctx.tick()` between pages/objects (keeps the UI alive, honours Cancel)
      outputs.push({ name: ctx.fileName(input.name, ' (gedreht)', 'pdf'), blob: new Blob([await saveDoc(doc)], { type: 'application/pdf' }) });
    }
    return { outputs };
  },
};
```

**`run(inputs, opts, ctx)` → `{ outputs, notes? }`** (or just the outputs array)
- `outputs`: `[{ name, blob, before?, pages?, note?, unchanged? }]` – `before` (bytes) shows
  "3,9 MB → 203 KB · 95 % kleiner"; `note` is a line under that output; several outputs get "Alle als ZIP".
- Throw to fail: `Object.assign(new Error(), { userMessage: { de: '…', en: '…' } })` shows that text;
  anything else shows a generic message (console.warn, never console.error for expected problems).
- Never return a result that is worse than the input without saying so (see compress-pdf).
- Input problems the user fixes on the same screen ("nothing selected yet") → throw with `stay: true`
  (`inputHint(de, en)` in lib/org-common.js): the shell keeps the files view and shows the text in the sticky bar
  instead of the error card.
- Output names are made unique by the shell ("a.pdf", "a (2).pdf"); `ctx.fileName` shortens very long names
  before the suffix, so " (komprimiert)" is never cut off.
- Shell behaviour: showing a result adds a history entry (the phone back button returns to the files);
  more than 14 outputs show 10 rows plus "show all"; output thumbnails render lazily; `next` targets that take
  one file are only offered for a single result.

**`inputs`** – only usable files (errors are skipped by the shell, locked PDFs are unlocked first), in the
user's order. Each is an `InputFile` (lib/files.js): `name`, `size`, `kind` (`pdf`/`image`/`other`),
`format` (`pdf`, `jpeg`, `png`, `webp`, `gif`, `bmp`, `avif`, `heic`…), `type`, `opts` (per-file option
values), `password`, and lazy cached helpers `bytes()`, `pdfjs()`, `pageCount()`, `pdfDoc()` (fresh,
decrypted pdf-lib doc each call), `imageInfo()` (size + EXIF orientation, header only), `bitmap()`
(decoded, EXIF applied), `thumbnail(width)`.

**`opts`** – values of the global options (copy). **`ctx`**:
`lang`, `t({de, en})`, `signal` (AbortSignal), `progress(fraction|null, text|{de,en})`, `tick()` (yield
+ throw on cancel), `throwIfAborted()`, `parsePages(text, count)` (0-based indices, throws
PageRangeError), `fileName(name, suffix, ext)`, `safeFileName(name)`, `note(text|{de,en})` (shown under
the result), `announce(text)` (screen readers).

**Option schema** (lib/options.js) – texts are strings or `{de, en}`:

| type | extra fields | control |
|---|---|---|
| `radio` | `choices: [{value, label, hint?}]` | radio cards |
| `toggle` | | switch |
| `range` | `min, max, step, unit?, format?(v, lang)` | slider with live value |
| `select` | `choices: [{value, label}]` | select |
| `text`, `number` | `placeholder?, maxLength?, min?, max?, step?, unit?, validate?(v, lang) → message` | input |
| `pages` | `placeholder?` | page range ("1-3, 5, 8-"), validated against the page count |
| `color` | | colour input |

Common fields: `id`, `label`, `hint`, `default`, `when(values, inputs) → bool` (show/hide),
`perFile: true` (rendered on each file card, value in `input.opts[id]`; add `kinds: ['pdf']` to limit),
`live: true` (also shown on the result card – changing it re-runs immediately; results are cached per
option set, so switching back is instant).

Optional hooks: `onInputs(inputs, ctx)` (after add/remove/reorder/unlock), `onOptionsChange(values, inputs, ctx)`,
`mountStage(el, state, ctx)` for interactive tools (page grid, signature placement, crop box, forms): called
once when the first files are shown; `el` sits between the file list and the options. Build your own touch
UI there (pointer events, 48 px targets, keyboard alternative), keep data in `state.values.<id>` or
`input.opts.<id>` so `run()` receives it, and refresh on `onInputs`. Use `lib/dom.js` `el()`/`icon()` – **never
`innerHTML`** (Trusted Types will throw), no inline styles (CSP); `element.style.x = …` is allowed.

**Reusable libs** (`assets/wt/lib/`): `pdf.js` (loadPdfjs/openPdfjs with the hardened settings, renderPage,
canvasToBlob, loadPdfLib, loadPdfDoc, saveDoc, saveEncrypted (AES-256), loadJSZip), `files.js`
(InputFile, sniff, jpegInfo/EXIF), `imgembed.js` (embed images with JPEG passthrough + EXIF rotation,
page sizes), `outline.js` (bookmarks), `pdfopt.js` (lossless optimisation, ref remapping, garbage
collection), `pdfimages.js` (content-stream scanner, image usage/dpi, image recompression), `ranges.js`,
`format.js`, `dom.js`, `strings.js`, `download.js`, `handoff.js`, `privacy.js`, `sw.js`.
`lib/shared/`: `pdfcrypt.js` (decrypt RC4/AES, encrypt AES-256), `zip.js` (createZip), `imgproc.js`,
`scanproc.js` (edge detection, warp, filters), `limits.js` (LIMITS, probeImageSize, canvasScaleCap),
`passphoto-templates.js` (TEMPLATES, sheetLayout). Import with relative paths (`../lib/…`).
Load heavy things lazily (`await import(…)` inside `run`) – a tool page must stay small before a file is picked.

## 3. What the platform already gives every tool

SEO page with title/description/canonical/hreflang/OG/Twitter, JSON-LD (WebApplication, HowTo, FAQPage,
BreadcrumbList), steps, why + comparison table, FAQ, related tools, app CTA; hub card + search; sitemap
entry; offline support (service worker); share target (Android share sheet → hub chooser by `accepts`);
"Weiter mit" hand-off via IndexedDB; privacy counter; dark mode; CSP + Trusted Types headers
(`/werkzeuge/(.*)`, `/en/tools/(.*)`, `/assets/wt/(.*)` in network/vercel.json – no external hosts ever).

Text drawn into PDFs: use `lib/unifont.js` (`prepareText(doc, text, {family, bold, italic})` → `{font, text,
missing}`; `getFont(doc, …)` for the Unicode face; `missingWarning(missing)`), never a bare standard font: the
standard font is used when it can show the text, otherwise Liberation Sans as an embedded subset (Latin incl.
Polish/Turkish/…, Greek, Cyrillic stay real, searchable text). Only scripts that font lacks (CJK, Arabic,
Hebrew, emoji) are replaced by "?" and must be reported. Add `unicodefont` to `needs`.

## 4. Add-a-tool checklist

1. `specs/<id>.json` – all required fields, both languages, honest texts (see rules above).
2. `assets/wt/tools/<id>.js` – default export `{ options, run }` (+ hooks if needed); `ctx.tick()` in loops;
   errors with `userMessage`; output names via `ctx.fileName`.
3. `python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py` – fix every spec
   error/warning it prints. Commit the generated HTML (tool pages, hubs, sitemap.xml, sw.js).
4. Fixtures: add new ones to the harness `make_fixtures.py` / `make_fixtures.mjs` (never commit user files).
5. Test: `test_<id>.py` in the harness folder (template below), then `./run_all.sh` – everything must pass
   (console errors, CSP violations, foreign requests, horizontal scroll and basic a11y fail a test).
6. Check the phone screenshots (light + dark): pick zone above the fold, no cut-off text.

Test harness (Playwright, Vercel-like server applying network/vercel.json):
`tests/suites/webtools/` (im Repo)
(`wtlib.py`, `server.mjs`, `run_all.sh`, `fixtures/`, `shots/`). Template:

```python
from wtlib import Suite
PATHS = {'de': '/werkzeuge/pdf-drehen/', 'en': '/en/tools/rotate-pdf/'}
with Suite('rotate-pdf') as s:
    for v in s.variants():                      # DE/EN × phone (390×844, touch, DPR 3) / desktop
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        page.locator('input[name="wt-opt-angle"][value="90"]').check()
        s.check_page(page)                       # CSP, horizontal scroll, a11y
        out = s.run_and_download(page)
        s.check_page(page)
        if out:
            s.expect(s.pdf_pages(out) == 3, f'{v}: page count')
            w, h = s.page_sizes(out)[0]
            s.expect(w > h, f'{v}: page should be landscape')
```

Note: `page.evaluate` / `wait_for_function` must get a function string (`"() => …"`); bare expressions use
`eval`, which the CSP blocks.

## 5. The same tools in the FaLe PDF app

`build.py` also writes the app versions: `wt-app/<de|en>/<id>.html` (only the tool – no site header, SEO
texts or links) and `js/webtools/catalog.js` (list for the app's tool screen). The app opens them in a
same-origin frame (`js/webtools/host.js`, route `#/web/<id>`); `js/webtools/frame.js` connects the page to the
app: results go into the app's file library (`lib/download.js` checks `globalThis.faleWtHost`), files can be
picked from the library („Aus meinen Dateien“, event `fale-wt-files`), links to other tools stay in the app.
Rules for tools so this keeps working:
- results only through the shell (`outputs`) – never your own `<a download>`;
- no service-worker or `location` tricks; links to other tools as `/werkzeuge/<slug>/` (mapped by the app);
- vendor files only via relative `../vendor/…` paths from `lib/` (the app build re-bases them onto `/vendor/`).
Tools the app has natively are hidden in its list (`NATIVE_TWINS` in `js/webtools/list.js`); a tool that cannot
work in a mobile web view goes into `APP_ONLY_EXCLUDED` in `build.py`. App test: `tests/suites/test_webtools_app.py`.
