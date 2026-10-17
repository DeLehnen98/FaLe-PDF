from wtlib import Suite
with Suite('dbg-letter') as s:
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/kuendigung-schreiben/')
    page.on('console', lambda m: print('console', m.type, m.text[:300]))
    page.wait_for_selector('.img-lt-sec')
    for k, val in {'rName': 'A GmbH', 'rStreet': 'X 1', 'rCity': '1 Y', 'sName': 'Me'}.items(): page.fill(f'#img-lt-{k}', val)
    s.run(page)
    page.wait_for_timeout(3000)
    print(page.locator('.wt-output .wt-thumb').evaluate('e => e.className + " " + e.innerHTML.slice(0, 80)'))
    o = s.download(page, 0)
    import subprocess; print(subprocess.run(['qpdf', '--check', str(o)], capture_output=True, text=True).stdout[-300:])
