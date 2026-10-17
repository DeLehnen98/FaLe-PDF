"""Probe of lib/bg-worker.js (agent bg): runs the worker on fixtures in Chromium and measures mask IoU
against the ground truth, plus timings (optionally with CPU throttling via CDP)."""
import base64, io, json, sys, os
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get('WT_PORT', '8830'))
FX = Path(__file__).parent / 'fixtures' / 'bg'
THROTTLE = float(os.environ.get('THROTTLE', '1'))
MODEL = os.environ.get('MODEL', 'object')
names = sys.argv[1:] or ['bg_mug', 'bg_ball', 'bg_bottle']

JS = """async ({b64, model, maxSide}) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes]));
  const f = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * f), h = Math.round(bmp.height * f);
  const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data.buffer;
  window.__bgw ||= new Worker('/assets/wt/lib/bg-worker.js', { type: 'module' });
  const wk = window.__bgw;
  const t0 = performance.now();
  const res = await new Promise((resolve, reject) => {
    wk.onmessage = e => { const m = e.data; if (m.type === 'mask') resolve(m); else if (m.type === 'error') reject(new Error(m.code + ': ' + m.message)); };
    wk.postMessage({ type: 'segment', id: 1, model, w, h, rgba }, [rgba]);
  });
  const total = performance.now() - t0;
  let s = ''; const u = new Uint8Array(res.mask); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return { w, h, mask: btoa(s), ms: res.ms, inferMs: res.inferMs, total };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(m.text))
    pg.goto(f'http://127.0.0.1:{PORT}/werkzeuge/')
    if THROTTLE > 1:
        cdp = pg.context.new_cdp_session(pg)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
    for n in names:
        src = FX / (n + '.jpg')
        r = pg.evaluate(JS, {'b64': base64.b64encode(src.read_bytes()).decode(), 'model': MODEL, 'maxSide': 1280})
        m = np.frombuffer(base64.b64decode(r['mask']), np.uint8).reshape(r['h'], r['w'])
        Image.fromarray(m).save(Path(__file__).parent / 'out' / f'probe_{n}_{MODEL}.png')
        gt_p = FX / (n + '_gt.png')
        iou = None
        if gt_p.exists():
            gt = np.asarray(Image.open(gt_p).resize((r['w'], r['h']), Image.BILINEAR)) >= 128
            pr = m >= 128
            iou = (gt & pr).sum() / max(1, (gt | pr).sum())
        print(json.dumps({'img': n, 'model': MODEL, 'throttle': THROTTLE, 'size': [r['w'], r['h']], 'iou': None if iou is None else round(float(iou), 4),
                          'fg_frac': round(float((m >= 128).mean()), 3), 'worker_ms': round(r['ms']), 'infer_ms': round(r['inferMs']), 'total_ms': round(r['total'])}))
    print('console:', [x for x in msgs][:5])
    b.close()
