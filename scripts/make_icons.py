"""Generate the FaLe PDF app icons (PNG + SVG) from one SVG master.

Design "PDF + Office": deep indigo tile, three fanned pages – a white PDF page with a teal bookmark in front,
a coral (presentation) and a green (spreadsheet) page behind it. Rendered with Chromium (Playwright), so the
PNGs match the SVG exactly. Run: python3 scripts/make_icons.py

Writes
  icons/icon-192.png, icon-512.png            rounded tile, transparent corners (PWA "any")
  icons/icon-maskable-192.png, -512.png       full bleed, mark inside the 80 % safe zone (PWA "maskable", Android)
  icons/apple-touch-icon.png (180)            full bleed, no transparency
  icons/favicon-32.png, icons/favicon.svg
  icons/ios-1024.png                          App Store / iOS AppIcon (full bleed, no alpha)
  store/graphics/play-icon-512.png            Play Store listing icon (full bleed)
  network/assets/icons/app-pdf.svg            FaleNetwork site
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TOP, BOTTOM = '#3B37A0', '#141246'   # keep in sync with INK_TOP/INK_BOTTOM in scripts/cap-patch-android.mjs


def mark(scale=1.0):
    """The three pages, drawn for a 512 × 512 canvas; `scale` shrinks them around the centre."""
    w, h = 204.8, 271.4
    cx, cy = 256, 271.4
    x0, y0 = cx - w / 2, cy - h / 2
    fold, r = 53.2, 17.9

    def page(x, y, fill, fold_fill):
        x1, y1 = x + w, y + h
        body = (f'M{x + r:.1f} {y:.1f}H{x1 - fold:.1f}L{x1:.1f} {y + fold:.1f}V{y1 - r:.1f}Q{x1:.1f} {y1:.1f} {x1 - r:.1f} {y1:.1f}'
                f'H{x + r:.1f}Q{x:.1f} {y1:.1f} {x:.1f} {y1 - r:.1f}V{y + r:.1f}Q{x:.1f} {y:.1f} {x + r:.1f} {y:.1f}Z')
        corner = f'M{x1 - fold:.1f} {y:.1f}V{y + fold - 6:.1f}Q{x1 - fold:.1f} {y + fold:.1f} {x1 - fold + 6:.1f} {y + fold:.1f}H{x1:.1f}Z'
        return f'<path d="{body}" fill="{fill}"/><path d="{corner}" fill="{fold_fill}"/>'

    pivot = f'{cx} {cy + h * 0.45:.1f}'
    yf = y0 - 10.2
    rx, rw = x0 + w * 0.15, w * 0.2
    ribbon = f'M{rx:.1f} {yf:.1f}h{rw:.1f}v{h * 0.30:.1f}l{-rw / 2:.1f} {-h * 0.06:.1f}l{-rw / 2:.1f} {h * 0.06:.1f}z'
    lines = ''.join(f'<rect x="{rx:.1f}" y="{yf + h * (0.45 + i * 0.12):.1f}" width="{w * f:.1f}" height="13.3" rx="6.65"/>'
                    for i, f in enumerate((0.62, 0.70, 0.50)))
    inner = (f'<g transform="rotate(-14 {pivot})">{page(x0, y0, "#E8613C", "#FFBEAA")}</g>'
             f'<g transform="rotate(14 {pivot})">{page(x0, y0, "#15895A", "#A0E6C3")}</g>'
             f'<g filter="url(#s)">{page(x0, yf, "#FFFFFF", "#C8CEFF")}</g>'
             f'<path d="{ribbon}" fill="#2DD4BF"/><g fill="#A5ACF5">{lines}</g>')
    if scale != 1.0:
        inner = f'<g transform="translate(256 256) scale({scale}) translate(-256 -256)">{inner}</g>'
    return inner


def svg(full_bleed=False, scale=1.0, label=True):
    defs = (f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TOP}"/>'
            f'<stop offset="1" stop-color="{BOTTOM}"/></linearGradient>'
            '<filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="10" '
            'flood-color="#0A0828" flood-opacity="0.45"/></filter></defs>')
    tile = '<rect width="512" height="512" fill="url(#g)"/>' if full_bleed else '<rect x="0" y="0" width="512" height="512" rx="115" fill="url(#g)"/>'
    aria = ' role="img" aria-label="FaLe PDF"' if label else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"{aria}>{defs}{tile}{mark(scale)}</svg>'


def render(page, markup, size, path, alpha=True):
    page.set_content(f'<html><body style="margin:0;background:transparent"><div style="width:{size}px;height:{size}px">'
                     f'{markup.replace("<svg ", f"<svg width={size} height={size} ", 1)}</div></body></html>')
    page.set_viewport_size({'width': size, 'height': size})
    path.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(path), omit_background=alpha, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
    if not alpha:  # App Store / iOS icons must not have an alpha channel
        from PIL import Image
        Image.open(path).convert('RGB').save(path, optimize=True)


if __name__ == '__main__':
    icons = ROOT / 'icons'
    tile, bleed, safe = svg(), svg(full_bleed=True), svg(full_bleed=True, scale=0.92)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(device_scale_factor=1)
        for s in (192, 512):
            render(page, tile, s, icons / f'icon-{s}.png')
            render(page, safe, s, icons / f'icon-maskable-{s}.png', alpha=False)
        render(page, bleed, 180, icons / 'apple-touch-icon.png', alpha=False)
        render(page, tile, 32, icons / 'favicon-32.png')
        render(page, bleed, 1024, icons / 'ios-1024.png', alpha=False)
        render(page, bleed, 512, ROOT / 'store' / 'graphics' / 'play-icon-512.png', alpha=False)
        b.close()
    (icons / 'favicon.svg').write_text(tile + '\n', encoding='utf-8')
    (ROOT / 'network' / 'assets' / 'icons' / 'app-pdf.svg').write_text(tile + '\n', encoding='utf-8')
    print('icons written')
