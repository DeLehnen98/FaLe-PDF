"""Offline: after the first visit (service worker warmed up) a tool works in flight mode.
Uses its own server on port 8711 and STOPS it (browser offline emulation does not cover service worker fetches)."""
import os
os.environ['WT_PORT'] = '8711'
from wtlib import Suite, ORIGIN

with Suite('offline') as s:
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
    page.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=60000)
    s.expect(page.locator('.wt-offline').count() == 1, 'offline-ready note in the privacy box')
    assert s.proc, 'offline test needs its own server'
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    page.reload()
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.pick(page, 'photos.pdf')
    s.wait_ready(page, 1)
    out = s.run_and_download(page)
    s.expect(out and out.stat().st_size < 1_200_000, 'offline compression result')
    page.locator('.wt-proof summary').click()
    proof = page.locator('[data-wt-proof]').inner_text()
    s.expect('keine einzige Anfrage' in proof, f'privacy counter: {proof}')
    s.check_page(page)
    # another tool page that was never visited: falls back to the cached hub instead of an error page
    p2 = s.open(ctx, '/werkzeuge/bild-in-pdf/', wait_shell=False)
    s.expect(p2.locator('h1').inner_text().startswith('Werkzeuge'), 'offline fallback to the hub')
    # pages outside the tools are not handled by the service worker
    p3 = ctx.new_page()
    try:
        p3.goto(ORIGIN + '/impressum/')
        s.fails.append('site pages must not be served from the tool cache')
    except Exception:
        pass
    ctx.set_offline(False)
