"""Timings for remove-background (agent bg): first load (download + init), detection and full-resolution
export of a 12 MP photo; desktop vs phone with 4× CPU throttling. Not part of run_all (slow)."""
import os, time, sys
os.environ.setdefault('WT_PORT', '8830')
import numpy as np
from PIL import Image
from wtlib import Suite, FIX

DONE = "() => /Motiv erkannt|Subject detected/.test(document.querySelector('.bg-status-text')?.textContent || '')"
with Suite('bg-perf') as s:
    for dev, rate, model in [('desktop', 1, 'object'), ('phone', 4, 'object'), ('desktop', 1, 'person'), ('phone', 4, 'person')]:
        ctx = s.context(dev, 'de')
        page = s.open(ctx, '/werkzeuge/hintergrund-entfernen/')
        cdp = ctx.new_cdp_session(page)
        if rate > 1:
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': rate})
        if model == 'person':
            s.pick(page, 'bg/bg_real_astronaut.jpg'); s.wait_ready(page, 1); page.wait_for_function(DONE, timeout=600000)
            page.locator('input[name="wt-opt-model"][value="person"]').check()
            t0 = time.time(); page.wait_for_function(DONE, timeout=600000); first = time.time() - t0
        else:
            t0 = time.time()
            s.pick(page, 'bg/bg_mug_12mp.jpg'); s.wait_ready(page, 1, timeout=120000)
            page.wait_for_function(DONE, timeout=600000); first = time.time() - t0
        page.wait_for_timeout(200)
        t1 = time.time()
        ok = s.run(page, timeout=600000)
        export = time.time() - t1
        cdp.send('Performance.enable')
        heap = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        print(f'{dev} x{rate} {model}: first detection incl. download+init {first:.1f}s, export {export:.1f}s, JS heap {heap.get("JSHeapUsedSize", 0)/1e6:.0f} MB, ok={ok}')
        if ok and model == 'object':
            out = s.download(page, 0)
            a = np.asarray(Image.open(out).convert('RGBA'))[..., 3] >= 128
            g = np.asarray(Image.open(FIX / 'bg' / 'bg_mug_12mp_gt.png').convert('L')) >= 128
            print('   12 MP size', a.shape, 'IoU', round((a & g).sum() / (a | g).sum(), 4))
        page.close()
