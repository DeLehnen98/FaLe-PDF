# FaleNetwork – brand & design tokens

FaleNetwork is the umbrella brand for all apps by FaLe.dev. It uses FaLe PDF's look
(deep ink indigo + teal) so every app feels like part of one family.

## Logo

| File | Use |
|---|---|
| `assets/logo/fale-network-mark.svg` | App-icon style mark (rounded square). Header, favicons, social images. Also copied to `/favicon.svg`. |
| `assets/logo/fale-network-mark-square.svg` | Full-bleed variant without rounded corners – source for `apple-touch-icon.png` and the maskable icon (the glyph sits well inside the 80 % safe zone). |
| `assets/logo/fale-network-wordmark.svg` | Mark + "FaleNetwork" lockup for documents and press. Uses system fonts, so convert the text to outlines before print. |

**The mark:** a white "F" on the FaLe ink gradient. The F's middle stroke uses the periwinkle of
FaLe PDF's text lines, and the teal bookmark ribbon from the FaLe PDF icon hangs from its top
arm – the same ribbon that marks a page in a document marks the network.

**Wordmark:** "Fale" in text colour, "Network" in primary indigo (`--primary`), weight 800,
letter-spacing −0.02em. Same pattern as the "FaLe **PDF**" lockup in the app. In HTML,
wrap both parts in one element (`<span>Fale<b>Network</b></span>`) so flex gaps don't split it.

**Spelling:** the network is "FaleNetwork" (one word). Products keep their names:
"FaLe PDF", "FaLe Clean", "FaLe-Konto" (de) / "FaLe Account" (en), "FaLe Plus".

**Don'ts:** no recolouring of the mark, no outlines/drop shadows on the mark, no stretching,
minimum size 16 px (favicon) – below 24 px use `favicon-32.png`.

## App icons

Every FaLe app icon is a rounded square (`rx = 22.5 %` of the edge, see `--radius-icon`)
with a single bold glyph:

| App | Background | Glyph |
|---|---|---|
| FaleNetwork | ink gradient `#312E81 → #171542` | white F + teal ribbon |
| FaLe PDF | ink gradient `#312E81 → #171542` | white page, lilac fold, teal ribbon, periwinkle lines |
| FaLe Clean | mint `#34D399` | near-black sweep `#111318` |

Sources: `assets/icons/app-pdf.svg`, `assets/icons/app-clean.svg`. A new app gets its own
background colour and one glyph; keep the corner radius and the 20 px inset of the 512 grid.

## Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--fale-ink-top` / `--fale-ink-bottom` | `#312E81` / `#171542` | same | brand gradient (icons, hero panels) |
| `--primary` | `#3B37A0` | `#ABA8FF` | links, primary buttons, wordmark |
| `--accent` | `#0B7A6E` | `#2DD4BF` | positive status, check marks |
| `--fale-teal` | `#2DD4BF` | same | ribbon, accents on ink backgrounds |
| `--bg` / `--surface` | `#F5F6FB` / `#FFFFFF` | `#0E0F22` / `#171932` | page / cards |
| `--text` / `--text-2` / `--text-3` | `#15172F` / `#4F5475` / `#636988` | `#ECEDF8` / `#A9ACCC` / `#8A8FB4` | text hierarchy |
| `--warn` / `--warn-soft` | `#8A5A00` / `#FDF1D6` | `#F5C04A` / `#3A2E10` | "kommt bald", placeholders |

All text/background pairs above meet WCAG AA (4.5:1) for body text.

## Type

System fonts only (`--font-sans`) – nothing is downloaded, which keeps pages fast and avoids
third-party requests. Headlines: weight 800, tight tracking (−0.03em display, −0.02em h2).
Body 17 px / 1.6. Scale tokens `--step--1 … --step-4`.

## Design tokens for apps

`assets/fale-tokens.css` contains only CSS custom properties (no element styles), so any FaLe
app can include it without side effects:

```html
<link rel="stylesheet" href="https://fale.network/assets/fale-tokens.css"> <!-- or a local copy -->
```

Theme switching follows the FaLe PDF convention: system preference by default, forced with
`<html data-theme="light">` or `data-theme="dark"`. Prefer a local copy inside each app
(apps must work offline); bump the version comment at the top when tokens change.

## Voice

Plain, honest, second person ("du" in German). Say what an app does and what it does *not*
do. Never announce products that don't exist yet; mark unreleased things as
"bald verfügbar" / "coming soon". No scare tactics, no fake urgency, no ratings we didn't get.

## Regenerating assets

```
python3 network/tools/build_pages.py   # all HTML pages + sitemap.xml (texts live in this script)
python3 network/tools/make_assets.py   # PNG icons, favicon.ico, Open Graph images (Playwright + Pillow)
```
`tools/`, `BRAND.md` and `DOMAINS.md` are excluded from deployment via `.vercelignore`.
