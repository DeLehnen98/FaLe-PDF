# FaleNetwork – brand & design tokens

FaleNetwork is the umbrella brand for all apps by FaLe.dev. It uses FaLe PDF's look
(deep ink indigo + teal) so every app feels like part of one family.

## Design language 2026: "Tinte & Lesezeichen" (Ink & Ribbon)

The FaLe world is paper, ink and bookmarks. Four ideas carry the identity – spend boldness on them
and keep everything else quiet:

1. **Ink material** (`--ink-grad`): deep indigo with a violet bloom (bottom left) and a teal bloom
   (top right). Used for the one hero panel per screen, the FAB, brand icon chips and feature heroes
   (KI: violet-weighted variant, Teilen: teal-weighted variant). Ink is dark in both themes.
   Never more than one large ink panel per screen.
2. **The ribbon** (`--ribbon`, #2DD4BF): the teal bookmark from the logo marks *where you are* – the
   active sidebar item, the active bottom-nav tab, the hero illustration, onboarding art. Shape:
   rectangle with a V-notch (`clip-path: polygon(0 0,100% 0,100% 100%,50% 80%,0 100%)`). Not a
   decoration – only for "current place" or the brand mark.
3. **Paper**: documents look like sheets – hairline edge, soft lifted shadow (`--paper-shadow`),
   folded corner on create buttons and illustrations. Thumbnails are real page renders.
4. **Marker** (`--marker`, #FFE45E): a highlighter stroke for search hits and marks, with dark text in
   both themes.

Surfaces are calm: hairline borders, small ink-tinted shadows, radii by hierarchy
(chips 6–10 · controls 12–16 · cards 20 · panels/sheets 28 · pills). On desktop the main column is a
raised panel on the `--frame` colour; the sidebar sits on the frame.

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
"FaLe PDF", "FaLe Clean", "FaLe-Konto" (de) / "FaLe Account" (en), "FaLe Pro" (früher „FaLe Plus“).

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
| `--fale-ink-top` / `--fale-ink-bottom` | `#312E81` / `#171542` | same | app icon gradient |
| `--ink-grad` (`#2A2290 → #1A1458 → #0E0B2E` + blooms) | same | same | ink material: hero panels, FAB, brand chips |
| `--ribbon` | `#2DD4BF` | same | the bookmark: current place, brand mark |
| `--primary` | `#3D34B8` | `#ABA6FF` | links, primary buttons, wordmark |
| `--accent` | `#0A7468` | `#3EE0C9` | positive status, check marks, teal text |
| `--marker` / `--on-marker` | `#FFE45E` / `#13122E` | same | highlighter (search hits) |
| `--bg` / `--surface` / `--frame` | `#F2F3F9` / `#FFFFFF` / `#E8EAF4` | `#0E0D23` / `#17162F` / `#09081A` | page / cards / app frame |
| `--text` / `--text-2` / `--text-3` | `#13122E` / `#4A4E6E` / `#5E6383` | `#EEEDFB` / `#B3B1D4` / `#9896BD` | text hierarchy |
| `--warn` / `--warn-soft` | `#8A5A00` / `#FDF1D6` | `#F5C04A` / `#3A2E10` | "kommt bald", hints |
| `--danger` / `--danger-soft` | `#C2304A` / `#FCE8EC` | `#FF8397` / `#3D1726` | destructive actions (dark: dark text on the button) |

Tool categories have their own icon colours (FaLe PDF, `css/theme-2026.css`): edit indigo, convert
teal, organise amber, scan coral, security berry, read blue, AI violet.

All text/background pairs meet WCAG AA (4.5:1; icons and large text 3:1) – checked with a script
over every token pair in both themes, including text on all ink gradient stops.

## Type

- **Display:** Bricolage Grotesque Bold (SIL OFL 1.1), self-hosted – in FaLe PDF under
  `vendor/fonts/bricolage-grotesque/` (Latin subset, WOFF, 28 KB, licence next to it). Used for page
  titles, the greeting, section titles, dialog titles and big numbers – never for body text.
  Tracking −0.02em (sections) to −0.035em (display), line-height ~1.05.
- **UI & body:** the system font (`--font-sans`): Roboto on Android, SF on Apple, Segoe on Windows.
  App body 15 px / 1.5, website body 17 px / 1.6. Numbers in tables and counters use tabular figures.
- No all-caps labels, no tracked-out eyebrows. Sentence case everywhere.
- Websites without the font file fall back to the system stack via `--font-display`; to adopt the
  display face copy the WOFF + `OFL.txt` and add an `@font-face` (`font-display: swap`, preload it).

## Motion

Fast and purposeful (`--dur-1` 120 ms presses, `--dur-2` 200 ms fades, `--dur-3` 320 ms sheets/pages):
`--ease-out` for entrances, `--ease-spring` for things the user pushed (press scale 0.97, star pop,
bottom sheets, toasts). One orchestrated moment per screen at most (the home hero sheet + ribbon drop).
Everything collapses to no motion under `prefers-reduced-motion: reduce`.

## Design tokens for apps

`assets/fale-tokens.css` contains only CSS custom properties (no element styles), so any FaLe
app can include it without side effects:

```html
<link rel="stylesheet" href="https://fale.network/assets/fale-tokens.css"> <!-- or a local copy -->
```

Token names from v1 are unchanged (values evolved); v2 adds `--ink-grad`, `--ribbon`, `--marker`,
`--frame`, `--font-display`, `--radius-*`, `--paper-shadow` and the motion tokens.
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
python3 network/tools/webtools/build.py      # FaLe Werkzeuge: /werkzeuge/, /en/tools/, sw.js, sitemap (run after build_pages.py)
python3 network/tools/webtools/make_og.py    # Open Graph images of the tools (og-tools-de/en.png)
```
The web tools are documented in `tools/webtools/README.md` (spec format, module contract, checklist).
Their pages self-host Bricolage Grotesque (`assets/wt/vendor/fonts/`, declared in `assets/wt/wt.css`).
`tools/`, `BRAND.md` and `DOMAINS.md` are excluded from deployment via `.vercelignore`.
