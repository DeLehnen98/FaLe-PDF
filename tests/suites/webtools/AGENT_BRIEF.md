# Common brief for all FaLe Werkzeuge tool agents

You add tools to "FaLe Werkzeuge": free, mobile-first PDF/image tool pages on the FaleNetwork site that process files 100 % locally in the browser (no upload). The owner mostly uses his PHONE — design every interaction for touch at 360–430 px first, then desktop. Goal: gather everything the big online PDF tool sites offer for your tools and do it better (no upload, no limits, no watermark, no account, works offline, faster, nicer on phones, smarter defaults, live previews, undo where it makes sense, "Weiter mit …" chaining).

## Read first
- /home/claude/FalePDF/network/tools/webtools/README.md (THE contract: spec format, module API, test template, writing rules).
- The three reference tools: network/tools/webtools/specs/{merge-pdf,compress-pdf,jpg-to-pdf}.json and network/assets/wt/tools/*.js, plus network/assets/wt/shell.js and lib/.
- Test harness: /home/claude/FalePDF/tests/suites/webtools/ (run_all.sh, library, fixtures, server emulating vercel.json headers incl. strict CSP + Trusted Types).
- Reusable app code in /home/claude/FalePDF/js/ (the FaLe PDF app): many tools exist there already in app form (js/tools/*.js, js/office/*.js, js/pdfcrypt.js, js/smart/*). Reuse their proven logic (port pure functions; app modules import app UI, so copy/adapt or sync pure ones via scripts/sync-webtools-vendor.mjs).

## Rules
- Repo /home/claude/FalePDF. Do NOT commit, push, stash, reset or checkout. Other agents work in the same tree at the same time on other tools.
- Add NEW files only: specs/<id>.json, assets/wt/tools/<id>.js, optional new helper files with names unique to you (e.g. assets/wt/lib/<yourprefix>-*.js), new icons via `iconSvg` in your spec, your own test files/fixtures in scratchpad/webtools/ (prefix with your agent name; do NOT edit run_all.sh — tell me the command to add instead).
- Shared files (shell.js, wt.css, lib/*.js written by others, build.py, scripts/sync-webtools-vendor.mjs, vercel.json): only if truly unavoidable, small, additive and backward-compatible; re-read the file right before editing (others may have changed it) and list every shared change in your report. Prefer putting tool-specific CSS in your module (constructable stylesheets / adoptedStyleSheets, or a separate CSS file loaded by your module) — no inline style attributes in HTML strings (CSP style-src 'self'; setting element.style via JS is fine), no inline scripts, no eval, no external hosts, Trusted Types enforced.
- Regenerate pages with `python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py` (deterministic; other agents run it too — that's fine, it builds from all specs present).
- Use only your assigned port range. Never `pkill -f` broad patterns; kill by PID.
- Texts: natural German (du-form, like the site) and natural English; no keyword stuffing; no competitor/third-party brand names (Adobe, Acrobat, WPS, iLovePDF, Smallpdf, PDF24, Sejda, Microsoft, Google …); Office formats only as "Word (DOCX)", "Excel (XLSX)", "PowerPoint (PPTX)" with `trademarkNote: true`. Only claims the tool really fulfils — test them. If a feature only works partly (e.g. simple layouts), say so honestly in the UI and FAQ. No invented numbers/ratings.
- Network: npm/pip and most hosts are blocked; use what's installed (node, python3, Playwright + Chromium, pdftoppm/qpdf/pypdf if present).
- Quality bar per tool: real-world inputs (use the fixtures plus generate harder ones: encrypted, rotated pages, mixed page sizes, 100+ pages, forms, non-Latin text), correct outputs verified programmatically, phone + desktop Playwright tests DE+EN, no console errors/CSP violations/foreign requests, no horizontal scroll at 360 px, accessible controls, dark mode OK, progress + cancel on long jobs, big files don't freeze the UI.
- Save phone screenshots (light; one dark) of each tool (initial / configured / result) to scratchpad/webtools/shots/<tool>_*.png.

## Report (compact)
Per tool: what it does (features vs typical competitors), test results; files added; shared files changed (exact, why); the command(s) to add to run_all.sh; known limitations.
