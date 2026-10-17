"""remove-background offline (agent bg): runtime + models are not precached; after the first use the service
worker keeps them, so background removal works with the server gone. Own server on port 8831, stopped mid-test.
(Timings: bg_perf.py.)"""
import os, time
os.environ['WT_PORT'] = '8831'
import numpy as np
from PIL import Image
from wtlib import Suite, FIX

DONE = "() => /Motiv erkannt|Subject detected/.test(document.querySelector('.bg-status-text')?.textContent || '')"
COUNT = "async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/vendor/onnx/')) n++; return n; }"

with Suite('bg-remove-offline') as s:
    sw = open('/home/claude/FalePDF/network/sw.js').read()
    s.expect('onnx' not in sw, 'onnx runtime/models are not in the service-worker precache')
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/hintergrund-entfernen/')
    page.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=60000)
    s.expect(page.evaluate(COUNT) == 0, 'nothing of the model cached before use')
    s.pick(page, 'bg/bg_mug.jpg'); s.wait_ready(page, 1)
    page.wait_for_function(DONE, timeout=180000)
    s.expect(bool(s.run_and_download(page)), 'first run online')
    page.wait_for_function(COUNT.replace('return n; }', 'return n >= 4; }'), timeout=60000, polling=1000)
    page.wait_for_timeout(1000)
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    page.reload()
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.pick(page, 'bg/bg_bottle.jpg'); s.wait_ready(page, 1)
    page.wait_for_function(DONE, timeout=180000)
    out = s.download(page, 0) if s.run(page, timeout=200000) else None
    if out:
        a = np.asarray(Image.open(out).convert('RGBA'))[..., 3] >= 128
        g = np.asarray(Image.open(FIX / 'bg' / 'bg_bottle_gt.png').convert('L')) >= 128
        j = (a & g).sum() / (a | g).sum()
        print('offline bottle IoU', round(j, 4))
        s.expect(j > 0.9, f'offline result IoU {j:.3f}')
    s.check_page(page)
print('ok')
