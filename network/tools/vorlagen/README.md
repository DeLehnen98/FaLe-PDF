# FaLe Vorlagen-Archiv – job application templates

Static pages under `/vorlagen/` (DE) and `/en/templates/` (EN), generated from one JSON file per job.
`python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py` regenerates everything
(webtools/build.py calls `vorlagen/build.py` at the end). Standalone and strict: `python3 network/tools/vorlagen/build.py`
(`--lax` only warns about missing `related` ids while you write new jobs).

```
vorlagen/
  build.py          pages, prefill data (/vorlagen/data/<id>.json + index.json), avatar SVGs, sitemap merge
  avatars.py        illustrated placeholder portraits (no photos of real people)
  make_assets.py    by hand, needs Playwright + Pillow: avatar PNGs + CV preview WEBPs (/assets/vorlagen/)
  data/<feld>/<id>.json   one job; <feld> = pflege, soziales, handwerk, buero, handel, logistik, gastro, it,
                          industrie, oeffentlich, marketing, finanzen, ausbildung, praktikum, minijob
  data/ratgeber/<id>.json guides
```

Runtime: `assets/wt/vl.js` + `vl.css` (search, filters, copy buttons), `assets/wt/lib/arc-vorlage.js` (prefill of
`tools/cv-builder.js` and `tools/cover-letter.js` via `?vorlage=<id>[&brief=<n>]`; EN ids are `en-<id>`).

## Add a job

1. Copy a similar file, e.g. `data/handwerk/elektriker.json`, to `data/<feld>/<new-id>.json` (`id` = file name = URL slug).
2. Fill in (all texts plain, natural German, letters in Sie-Form, everything fictional – no real companies):
   - `name`, `short` (card line), `desc` (meta description, 110–180 chars), `search` (synonyms), `intro`, `lookFor` (3–5)
   - `letters`: 2–3 × `{label, level, position, ref?, to: {org, sal: f|m|n|none, contact (surname; full name for n),
     street, city}, body: [2–4 paragraphs, first one starts lowercase after the salutation], att: [...], from?}` –
     letter 1 is written by the CV person; letters 2–3 need `from: [name, street, "PLZ Ort"]`.
     `level`: ausbildung · berufseinstieg · erfahren · quereinstieg · minijob · praktikum · initiativ
   - `cv`: `avatar` (a01–a24, see avatars.py), `design` (classic|modern|compact), `accent` (0–5), `name`, `title`,
     `street`, `city`, `exp`/`edu`/`courses` rows `[from, to, role, org, place, "- task\n- task"]` (single dates in `to`),
     `skills` `[name, 0–5]` (keep names short), `langs` `[name, native|C2…A1]`, `hobbies`
   - `do`, `dont` (3 each), `questions` (4), `pay` (optional, never a salary figure), `faq` (1–3), `related` (4 ids)
   - optional `popular: true` (hub), optional `en: {...}` with the same fields + `slug` → EN page and hreflang pair.
3. Build, then `python3 network/tools/vorlagen/make_assets.py` (renders the CV preview of new ids only).
4. Run the lint and the page test: `python3 test_arc_lint.py`, `python3 test_arc_vorlagen.py` (harness folder).
