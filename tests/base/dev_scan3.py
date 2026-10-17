import os, json
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); TD = os.path.join(SP, 'testdata')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={TD}/cam_doc.y4m'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8792/#/werkzeug/scannen')
    page.wait_for_function("document.querySelector('.sc-view video') && document.querySelector('.sc-view video').videoWidth > 0", timeout=15000)
    r = page.evaluate("""async () => { const m = await import('./js/tools/scanproc.js'); const t = document.querySelector('video').srcObject.getVideoTracks()[0];
      const b = await new ImageCapture(t).takePhoto(); const bm = await createImageBitmap(b);
      const out = {}; for (const s of [220, 360, 480]) { const d = m.detectDocument(m.smallImageData(bm, s)); out[s] = d.quad && d.quad.map(q => q.map(v => +v.toFixed(3))); }
      return out; }""")
    print(json.dumps(r))
    b.close()
print('truth', json.load(open(os.path.join(TD, 'scan_truth.json')))['scan_1_wood.jpg'])
