import os, json, base64
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
truth = json.load(open(os.path.join(SP, 'testdata/scan_truth.json')))
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page()
    page.goto('http://127.0.0.1:8792/'); page.wait_for_selector('#view-start .hero')
    for name, q in truth.items():
        b64 = base64.b64encode(open(os.path.join(SP, 'testdata', name), 'rb').read()).decode()
        r = page.evaluate("""async (b64) => {
          const m = await import('./js/tools/scanproc.js');
          const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
          const bmp = await createImageBitmap(blob);
          const t0 = performance.now();
          const id = m.smallImageData(bmp, 360);
          const r = m.detectDocument(id);
          return { quad: r.quad, score: r.score, ms: performance.now() - t0 };
        }""", b64)
        if r['quad']:
            err = max(max(abs(a[0]-b2[0]), abs(a[1]-b2[1])) for a, b2 in zip(r['quad'], q))
        else: err = None
        print(name, 'err', None if err is None else round(err, 4), 'score', round(r['score'], 3), 'ms', round(r['ms']))
    b.close()
