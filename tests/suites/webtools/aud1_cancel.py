"""aud1: cancel long jobs mid-run – how fast does the UI come back, can it run again?"""
import os, time
os.environ.setdefault('WT_PORT', '8780')
from wtlib import Suite
A = 'aud1/'
CASES = [('/werkzeuge/pdf-in-jpg/', [A + 'long300.pdf']), ('/werkzeuge/pdf-graustufen/', [A + 'heavy80.pdf']),
         ('/werkzeuge/pdf-komprimieren/', [A + 'heavy80.pdf']), ('/werkzeuge/pdf-in-word/', [A + 'long300.pdf']),
         ('/werkzeuge/bild-in-pdf/', [f'aud1/photos40/IMG_2026{i:04d}.jpg' for i in range(1, 41)]),
         ('/werkzeuge/excel-in-pdf/', [A + 'office/umsatz_real.xlsx'])]
with Suite('aud1-cancel') as s:
    ctx = s.context('phone', 'de')
    for path, files in CASES:
        page = s.open(ctx, path)
        s.pick(page, *files); s.wait_ready(page, len(files), timeout=120000)
        s.primary(page).click()
        page.wait_for_timeout(1200)
        st = page.evaluate("() => document.getElementById('wt-app').dataset.state")
        t0 = time.time()
        if st == 'working':
            page.locator('.wt-progress button').click()
            page.wait_for_function("() => document.getElementById('wt-app').dataset.state !== 'working'", timeout=60000)
        dt = time.time() - t0
        st2 = page.evaluate("() => document.getElementById('wt-app').dataset.state")
        focus = page.evaluate("() => document.activeElement?.textContent?.trim().slice(0, 30)")
        print(f'{path}: state at 1.2s={st} cancel→{st2} in {dt:.2f}s, focus={focus!r}')
        ok = s.run(page, timeout=600000)
        print('   rerun ok' if ok else '   rerun failed')
        page.close()
