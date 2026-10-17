"""annotate-pdf: highlight by dragging across text (snaps to the text, real /Highlight with QuadPoints and the
comment as /Contents), underline, sticky note with text, freehand ink, rectangle, arrow, undo/redo, page 2,
summary file (Markdown), scanned page hint, phone "View" default, DE/EN; checked with pypdf + qpdf."""
import pypdf
from wtlib import Suite

PATHS = {'de': '/werkzeuge/pdf-kommentieren/', 'en': '/en/tools/annotate-pdf/'}


def drag(page, a, b, steps=8):
    page.mouse.move(*a); page.mouse.down()
    for k in range(1, steps + 1): page.mouse.move(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)
    page.mouse.up()


def at(page, fx, fy):
    # bring that point of the page into the middle of the screen first (phones: the page is taller than the view)
    page.evaluate("""fy => { const r = document.querySelector('.an-overlay').getBoundingClientRect();
      window.scrollBy(0, r.top + r.height * fy - innerHeight / 2); }""", fy)
    b = page.locator('.an-overlay').bounding_box()
    return (b['x'] + b['width'] * fx, b['y'] + b['height'] * fy)


def tool(page, t):
    page.locator(f'.an-tool[data-tool="{t}"]').click()


def annots(path):
    r = pypdf.PdfReader(str(path))
    out = []
    for i, p in enumerate(r.pages):
        for a in p.get('/Annots') or []:
            a = a.get_object()
            out.append((i + 1, a.get('/Subtype'), a.get('/Contents'), a))
    return out


with Suite('annotate-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.an-overlay', timeout=20000)
        default = page.locator('.an-tool[aria-pressed="true"]').get_attribute('data-tool')
        s.expect(default == ('view' if v.device == 'phone' else 'highlight'), f'{v}: default tool {default}')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to save yet')
        tool(page, 'highlight')
        # first text line "Alpha Seite 1" sits near the top of text3.pdf
        drag(page, at(page, 0.125, 0.088), at(page, 0.4, 0.088))
        page.wait_for_selector('.an-item')
        quote = page.locator('.an-quote').first.inner_text()
        s.expect('Alpha' in quote, f'{v}: highlight snapped to text ({quote!r})')
        page.locator('.an-item textarea').first.fill('Wichtig' if v.lang == 'de' else 'Important')
        tool(page, 'note')
        page.mouse.click(*at(page, 0.8, 0.3))
        page.locator('.an-item textarea').nth(1).fill('Bitte prüfen')
        tool(page, 'ink')
        drag(page, at(page, 0.2, 0.6), at(page, 0.5, 0.7), steps=12)
        tool(page, 'rect')
        drag(page, at(page, 0.55, 0.55), at(page, 0.8, 0.65))
        tool(page, 'arrow')
        drag(page, at(page, 0.3, 0.8), at(page, 0.6, 0.75))
        s.expect(page.locator('.an-item').count() == 5, f'{v}: 5 comments listed')
        page.locator('.an-row button', has_text='Rückgängig' if v.lang == 'de' else 'Undo').click()
        s.expect(page.locator('.an-item').count() == 4, f'{v}: undo')
        page.locator('.an-row button', has_text='Wiederholen' if v.lang == 'de' else 'Redo').click()
        s.expect(page.locator('.an-item').count() == 5, f'{v}: redo')
        # page 2: underline
        page.locator('.sec-nav-btn').last.click()
        page.wait_for_timeout(500)
        tool(page, 'underline')
        drag(page, at(page, 0.125, 0.088), at(page, 0.4, 0.088))
        s.check_page(page)
        if s.run(page):
            out = s.download(page, 0)
            md = s.download(page, 1)
            got = annots(out)
            types = sorted(str(t) for _, t, _, _ in got if t != '/Link')   # the fixture has a link already
            s.expect(types == sorted(['/Highlight', '/Text', '/Ink', '/Square', '/Line', '/Underline']), f'{v}: annotation types {types}')
            hl = [a for p, t, c, a in got if t == '/Highlight'][0]
            s.expect(len(hl['/QuadPoints']) % 8 == 0 and '/AP' in hl, f'{v}: highlight quads + appearance')
            s.expect([c for p, t, c, a in got if t == '/Highlight'][0] in ('Wichtig', 'Important'), f'{v}: comment as /Contents')
            s.expect([p for p, t, c, a in got if t == '/Underline'] == [2], f'{v}: underline on page 2')
            s.expect([c for p, t, c, a in got if t == '/Text'] == ['Bitte prüfen'], f'{v}: note text')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            txt = md.read_text('utf-8')
            s.expect('Alpha' in txt and 'Bitte prüfen' in txt and ('Seite 1' in txt or 'Page 1' in txt), f'{v}: summary {txt[:200]}')
        page.close()

    # scanned page: text tools explain, drawing works
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'new_scan_1p.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.an-overlay', timeout=20000)
    tool(page, 'highlight')
    s.expect('Texterkennung' in page.locator('.an .sec-status').inner_text(), 'scan: OCR hint for text marking')
    tool(page, 'rect')
    drag(page, at(page, 0.2, 0.2), at(page, 0.5, 0.4))
    s.expect(page.locator('.an-item').count() == 1, 'scan: rectangle works')
    page.close()
