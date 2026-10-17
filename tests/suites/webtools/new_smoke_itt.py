import os, time
os.environ.setdefault('WT_PORT', '8790')
from wtlib import Suite
with Suite('new-smoke-itt') as s:
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/bild-in-text/')
    s.pick(page, 'new_note.jpg', 'new_screen.png')
    s.wait_ready(page, 2)
    page.wait_for_timeout(500)
    s.shot(page, 'image-to-text_dbg1', full=True)
    out = s.run(page, timeout=180000)
    print(page.locator('#new-text-out').input_value()[:1200])
    s.check_page(page)
    s.shot(page, 'image-to-text_dbg2', full=True)
