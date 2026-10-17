import os, base64
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8796/'
IDB = '''async (kind) => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const docs = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result); });
  const d = docs.filter(x => (x.kind||'pdf') === kind).sort((a,b)=>b.createdAt-a.createdAt)[0]; const f = await new Promise(r => { const g = db.transaction('files').objectStore('files').get(d.id); g.onsuccess = () => r(g.result); });
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r([d.id, fr.result.split(',')[1]]); fr.readAsDataURL(f.blob); }); }'''
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE', accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL); pg.wait_for_selector('#view-start .hero')
    pg.evaluate("location.hash='#/gliederung'")
    pg.wait_for_selector('.ol-text')
    pg.locator('[data-example]').click(); pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, 'outline.png'))
    pg.locator('[data-ol-create]').click()
    pg.wait_for_selector('.slides-app'); pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(OUT, 'slides_notes.png'))
    pg.locator('[data-a="transition"]').click(); pg.locator('.menu-item', has_text='Überblenden').click()
    pg.locator('[data-a="presenter"]').click(); pg.wait_for_selector('.presenter'); pg.wait_for_timeout(400)
    pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, 'presenter.png'))
    pg.keyboard.press('Escape')
    pg.locator('[data-office-save]').click(); pg.wait_for_timeout(3000)
    did, b64 = pg.evaluate(IDB, 'pptx')
    open(os.path.join(OUT, 's.pptx'), 'wb').write(base64.b64decode(b64))
    pg.locator('[data-office-more]').click(); pg.locator('.menu-item', has_text='Handzettel').click()
    pg.locator('dialog button[value=ok]').click()
    pg.wait_for_selector('dialog .result-mini', timeout=40000)
    pg.locator('dialog .dlg-head .icon-btn').first.click()
    _, b64 = pg.evaluate(IDB, 'pdf')
    open(os.path.join(OUT, 'handout.pdf'), 'wb').write(base64.b64decode(b64))
    pg.evaluate("location.hash='#/start'"); pg.wait_for_timeout(300)
    pg.evaluate(f"location.hash='#/bearbeiten/{did}'"); pg.wait_for_selector('.slides-app'); pg.wait_for_timeout(1500)
    print('reopen notes', pg.evaluate("JSON.stringify(document.querySelector('.slides-app')._slidesApi.pres().slides.map(s=>[s.transition||'', (s.notes||'').slice(0,20)]))"))
    print('\n'.join(errs) or 'no console errors')
    b.close()
