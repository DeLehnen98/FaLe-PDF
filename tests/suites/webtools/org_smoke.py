import sys, os
os.environ.setdefault('WT_PORT', '8720')
from wtlib import Suite
CASES = [
  ('delete', '/werkzeuge/pdf-seiten-loeschen/', ['org/org_mixed.pdf'], "() => { document.querySelectorAll('.pg-hit')[1].click(); document.querySelectorAll('.pg-hit')[2].click(); }"),
  ('extract', '/werkzeuge/pdf-seiten-extrahieren/', ['org/org_mixed.pdf'], "() => { document.querySelectorAll('.pg-hit')[3].click(); }"),
  ('rotate', '/werkzeuge/pdf-drehen/', ['org/org_mixed.pdf'], "() => { document.querySelectorAll('.pg-tool')[0].click(); }"),
  ('split', '/werkzeuge/pdf-teilen/', ['org/org_mixed.pdf'], "() => { document.querySelectorAll('.pg-hit')[2].click(); }"),
  ('organize', '/werkzeuge/pdf-seiten-sortieren/', ['org/org_mixed.pdf'], "() => { document.querySelectorAll('.pg-hit')[0].click(); }"),
  ('blank', '/werkzeuge/leere-seiten-entfernen/', ['org/org_blank.pdf'], None),
  ('mix', '/werkzeuge/pdf-seiten-mischen/', ['org/org_fronts.pdf', 'org/org_backs.pdf'], None),
  ('halves', '/werkzeuge/doppelseiten-teilen/', ['org/org_book.pdf'], None),
  ('halvesrot', '/werkzeuge/doppelseiten-teilen/', ['org/org_book_rot.pdf'], None),
  ('graymesh', '/werkzeuge/pdf-graustufen/', ['org/org_mesh.pdf', 'real/ppt-pdf.pdf'], None),
  ('gray', '/werkzeuge/pdf-graustufen/', ['org/org_color.pdf'], None),
  ('repair', '/werkzeuge/pdf-reparieren/', ['org/org_badxref.pdf'], None),
]
only = sys.argv[1:]
with Suite('org-smoke') as s:
    for name, path, files, act in CASES:
        if only and name not in only: continue
        ctx = s.context('phone', 'de')
        page = s.open(ctx, path)
        s.pick(page, *files)
        s.wait_ready(page)
        page.wait_for_timeout(2500)
        if act: page.evaluate(act); page.wait_for_timeout(300)
        s.shot(page, f'org_smoke_{name}', top='.wt-files-head')
        s.check_page(page)
        ok = s.run(page)
        if ok:
            outs = page.locator('.wt-output').count()
            out = s.download(page)
            print(name, 'outputs', outs, out, s.pdf_pages(out), page.locator('.wt-result').inner_text()[:300].replace('\n', ' | '))
            s.shot(page, f'org_smoke_{name}_result', top='.wt-result')
        page.close()
