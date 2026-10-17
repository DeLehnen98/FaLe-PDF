import os, json, base64
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
truth = json.load(open(os.path.join(SP, 'testdata/scan_truth.json')))
real = {'scan_1_wood.jpg': 210/297, 'scan_2_dark.jpg': 210/297, 'scan_3_gray.jpg': 210/297, 'scan_4_green.jpg': 85.6/54}
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page()
    page.goto('http://127.0.0.1:8792/'); page.wait_for_selector('#view-start .hero')
    for name, q in truth.items():
        W, H = 1200, 1600
        r = page.evaluate("""async ([q, W, H]) => { const m = await import('./js/tools/scanproc.js');
          const px = q.map(([x, y]) => [x * W, y * H]);
          const [w, h] = m.warpSize(px, 4000, null, [W / 2, H / 2]); const [w0, h0] = m.warpSize(px, 4000, null, null);
          return [w / h, w0 / h0]; }""", [q, W, H])
        print(name, 'real %.3f  estimated %.3f  naive %.3f' % (real[name], r[0], r[1]))
    b.close()
