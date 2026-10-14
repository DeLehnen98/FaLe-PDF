# Google Play graphics – FaLe PDF

All screenshots show the real app (built from this repository) with fictional demo content
(“Anna Berger”, invoices, a tenancy agreement, a household budget …). Captions are rendered into the
images; there are no other companies’ names or logos and no ratings or awards.

Play Console › **Grow › Store presence › Main store listing** (German = default language,
English = translation “en-GB” / “en-US”). Upload the files of the matching language to each listing.

## Files and Play Console slots

| File | Size | Play Console slot |
|---|---|---|
| `play-icon-512.png` | 512 × 512, 32-bit PNG | **App icon** (same in all languages). Full-bleed square – Google applies the rounded mask and shadow. Same mark as `icons/` (`scripts/make_icons.py`). |
| `feature-graphic-de.png` | 1024 × 500, 24-bit PNG | **Feature graphic** – German listing |
| `feature-graphic-en.png` | 1024 × 500, 24-bit PNG | **Feature graphic** – English listing |
| `phone/de/01_home.png` … `08_privacy.png` | 1080 × 1920 (9:16) | **Phone screenshots** – German listing, upload in this order |
| `phone/en/01_home.png` … `08_privacy.png` | 1080 × 1920 (9:16) | **Phone screenshots** – English listing, upload in this order |
| `tablet-7/de/01_home.png` … `03_ai.png` | 1200 × 1920 | **7-inch tablet screenshots** – German listing |
| `tablet-7/en/01_home.png` … `03_ai.png` | 1200 × 1920 | **7-inch tablet screenshots** – English listing |
| `tablet-10/de/01_home.png` … `03_doc.png` | 2560 × 1600 | **10-inch tablet screenshots** – German listing |
| `tablet-10/en/01_home.png` … `03_doc.png` | 2560 × 1600 | **10-inch tablet screenshots** – English listing |
| `og-image-de.png`, `og-image-en.png` | 1200 × 630 | Not for Play – social preview of the landing page. Optimised copies are served from the site root as `/og-image.png` (DE) and `/og-image-en.png` (EN). |

All screenshots are 24-bit PNG without alpha, well below the 8 MB limit, and within Play’s aspect-ratio
rules (longest side ≤ 2 × shortest side).

### Phone screenshots (captions)

| # | German (`phone/de`) | English (`phone/en`) | Screen |
|---|---|---|---|
| 1 | Alle Pro-Funktionen gratis | All pro features, free | Home |
| 2 | Unterschreiben in Sekunden | Sign in seconds | Fill & sign with a drawn signature |
| 3 | Scannen mit Kantenerkennung | Scan with edge detection | Camera scanner, page detected |
| 4 | Texterkennung – auch offline | Text recognition, offline | Scanned letter (OCR) – search hits highlighted |
| 5 | KI-Assistent für deine Dokumente | AI assistant for your documents | Chat with document (optional cloud AI) |
| 6 | Dokumente, Tabellen & Präsentationen | Documents, spreadsheets & slides | Spreadsheet with formula and chart |
| 7 | Kündigung in einer Minute | Never miss a deadline | DE: letters (cancellation …) · EN: deadlines & reminders |
| 8 | Deine Daten bleiben auf dem Handy | Your files stay on your phone | Privacy step of the welcome screens |

Tablet: 7" = home, sign, AI chat · 10" = home (sidebar layout), PDF viewer, document editor.

## Notes for the owner

- **AI screenshot (#5):** the AI backend was mocked during capture (answer text is fixed in
  `tools/answers.py`); the subtitle says “täglich 5 Anfragen gratis / 5 free requests every day”, which matches
  `FREE_DAILY=5` (default in `api/_lib/config.js`). If you change the free quota, regenerate.
- The screenshots do not yet show the new sharing / signature-request / transfer features – regenerate
  once they are final (add a capture step in `tools/capture.py`).
- Dates in the reminders and scan shots are relative to the day of capture.

## Regenerate

```bash
# from the repository root; needs Node, Python 3 + playwright, Pillow, numpy, opencv-python, reportlab,
# openpyxl, python-docx, python-pptx and a Chromium for Playwright
store/graphics/tools/run.sh
```

`run.sh` builds the site, copies `dist/` to a work folder (`$FALE_SHOTS_WORK`, default `/tmp/fale-store-shots`),
creates the demo files (`tools/gen_demo.py`, incl. a fake camera stream for the scanner), serves the copy on
`127.0.0.1:8802`, drives the app with Playwright (`tools/capture.py`, imports demo files through the app’s own
library API, mocks only `/api/ai*`), frames the captures (`tools/compose.py`) and renders the icon, feature
graphics, OG images and the landing-page screenshots in `info-assets/` (`tools/brand.py`).
