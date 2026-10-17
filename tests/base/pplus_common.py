import os, json, time, socket, subprocess
SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'testdata')
TDP = os.path.join(SP, 'testdata_plus')
OUT = os.path.join(SP, 'out_pdfplus')
os.makedirs(OUT, exist_ok=True)
APP = '/home/claude/FalePDF'
PORT = 8795
URL = f'http://127.0.0.1:{PORT}/'
console = []

def ensure_server():
    s = socket.socket()
    try:
        s.connect(('127.0.0.1', PORT)); s.close(); return
    except OSError:
        pass
    subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)

def launch(p):
    return p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                                   '--use-file-for-fake-video-capture=' + os.path.join(TD, 'cam_doc.y4m')])

def context(browser, phone=False, dark=False, **kw):
    if phone:
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  accept_downloads=True, locale='de-DE', permissions=['camera', 'clipboard-read', 'clipboard-write'],
                                  color_scheme='dark' if dark else 'light', **kw)
    else:
        ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE',
                                  permissions=['camera', 'clipboard-read', 'clipboard-write'], color_scheme='dark' if dark else 'light', **kw)
    return ctx

def attach(page, label):
    page.on('console', lambda m: console.append(f'{label} [{m.type}] {m.text} @ {(m.location or {}).get("url", "")}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: console.append(f'{label} [pageerror] {e}'))

DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, pages: d.pages, kind: d.kind}))); });
  db.close(); return res; }"""

def docs(page):
    return page.evaluate(DOCS_JS)

def doc_id(page, name):
    for d in docs(page):
        if d['name'] == name:
            return d['id']
    return None

def goto(page, h, wait=None, timeout=20000):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    if wait:
        page.wait_for_selector(wait, timeout=timeout)
    page.wait_for_timeout(300)

def import_pdfs(page, paths):
    names = [os.path.basename(x) for x in paths]
    page.set_input_files('#pdf-input', paths)
    for _ in range(160):
        have = {d['name'] for d in docs(page)}
        if all(n in have for n in names):
            break
        page.wait_for_timeout(250)
    else:
        raise AssertionError('import timed out')
    if len(paths) == 1:
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=15000)
        page.wait_for_function("document.querySelector('[data-v=loading]') && document.querySelector('[data-v=loading]').hidden", timeout=20000)
    page.wait_for_timeout(300)

def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f'{name}.png'))

def set_theme(page, dark):
    page.evaluate("d => { localStorage.setItem('fale-theme', d ? 'dark' : 'light'); document.documentElement.dataset.theme = d ? 'dark' : 'light'; }", dark)

def download_from(page, locator, name):
    with page.expect_download() as d:
        locator.click()
    path = os.path.join(OUT, 't_' + name)
    d.value.save_as(path)
    return path
