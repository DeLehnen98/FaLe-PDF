"""All org tools at 360 px (phone, DE + EN): no horizontal scroll with the page grid / preview shown, a11y, dark mode."""
from wtlib import Suite
TOOLS = [
    ('/werkzeuge/pdf-teilen/', '/en/tools/split-pdf/', ['org/org_mixed.pdf']),
    ('/werkzeuge/pdf-seiten-loeschen/', '/en/tools/delete-pdf-pages/', ['org/org_mixed.pdf']),
    ('/werkzeuge/pdf-seiten-extrahieren/', '/en/tools/extract-pdf-pages/', ['org/org_mixed.pdf']),
    ('/werkzeuge/pdf-seiten-sortieren/', '/en/tools/organize-pdf/', ['org/org_mixed.pdf', 'text3.pdf']),
    ('/werkzeuge/pdf-drehen/', '/en/tools/rotate-pdf/', ['org/org_mixed.pdf']),
    ('/werkzeuge/leere-seiten-entfernen/', '/en/tools/remove-blank-pages/', ['org/org_blank.pdf']),
    ('/werkzeuge/pdf-seiten-mischen/', '/en/tools/alternate-mix-pdf/', ['org/org_fronts.pdf', 'org/org_backs.pdf']),
    ('/werkzeuge/doppelseiten-teilen/', '/en/tools/split-pdf-pages-in-half/', ['org/org_book.pdf']),
    ('/werkzeuge/pdf-graustufen/', '/en/tools/grayscale-pdf/', ['org/org_color.pdf']),
    ('/werkzeuge/pdf-reparieren/', '/en/tools/repair-pdf/', ['org/org_trunc.pdf']),
]
with Suite('org-narrow') as s:
    for lang, dark in (('de', False), ('en', True)):
        ctx = s.context('phone', lang, dark=dark, viewport={'width': 360, 'height': 740})
        for de, en, files in TOOLS:
            page = s.open(ctx, de if lang == 'de' else en)
            s.check_page(page)
            s.pick(page, *files)
            s.wait_ready(page, len(files))
            page.wait_for_timeout(1200)
            # select a page so the selection toolbar is in its widest state
            if page.locator('.pg-mode-organize .pg-hit, .pg-mode-select .pg-hit').count():
                page.locator('.pg-mode-organize .pg-hit, .pg-mode-select .pg-hit').first.tap()
            s.check_page(page)
            page.close()
