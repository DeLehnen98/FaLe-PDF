"""ocr-pdf offline: tesseract is not precached; after the first OCR the service worker keeps it (incl. both
languages), so OCR works with the server gone. Own server on port 8791, stopped mid-test."""
import os, subprocess, json
os.environ['WT_PORT'] = '8791'
from wtlib import Suite

with Suite('new-ocr-offline') as s:
    sw = open('/home/claude/FalePDF/network/sw.js').read()
    s.expect('tesseract' not in sw, 'tesseract is not in the service-worker precache')
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-texterkennung/')
    page.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=60000)
    # before the first OCR nothing of tesseract is loaded or cached
    n0 = page.evaluate("async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('tesseract')) n++; return n; }")
    s.expect(n0 == 0, f'nothing of tesseract cached before use ({n0})')
    s.pick(page, 'new_scan_1p.pdf'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-lang"][value="deu"]').check()
    s.expect(bool(s.run_and_download(page)), 'first OCR online')
    page.wait_for_function("async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('tesseract')) n++; return n >= 5; }", timeout=60000, polling=1000)
    page.wait_for_timeout(2000)
    assert s.proc, 'needs its own server'
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    page.reload()
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.pick(page, 'new_scan_1p.pdf'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-lang"][value="eng"]').check()   # the other language, warmed after the first run
    out = s.download(page, 0) if s.run(page, timeout=200000) else None
    if out:
        t = subprocess.run(['pdftotext', str(out), '-'], capture_output=True, text=True).stdout
        s.expect('Lieferung' in t, 'offline OCR result')
    s.check_page(page)
