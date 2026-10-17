import os, sys, base64, json
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8796/'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE', accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL); pg.wait_for_selector('#view-start .hero')
    pg.evaluate("location.hash='#/neu/tabelle'")
    pg.wait_for_selector('.sheet-app')
    api = "document.querySelector('.sheet-app')._sheetApi"
    data = [['Monat','Umsatz','Kosten'],['Jan','1200','800'],['Feb','1500','900'],['Mär','900','950'],['Apr','1800','1000']]
    for r,row in enumerate(data):
        for c,v in enumerate(row):
            pg.evaluate(f"{api}.input('{chr(65+c)}{r+1}', {v!r})")
    pg.evaluate(f"{api}.select('A1:C5')")
    pg.locator('[data-a="chart"]').click()
    pg.wait_for_selector('.chart-dlg')
    pg.fill('[name=title]', 'Umsatz 2026')
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, 'chart_dlg.png'))
    pg.locator('dialog button[value=ok]').click()
    pg.wait_for_timeout(500)
    # cf
    pg.evaluate(f"{api}.select('B2:B5')")
    pg.locator('[data-a="cf"]').click(); pg.wait_for_selector('.cf-dlg')
    pg.fill('[name=v1]', '1000'); pg.locator('dialog button[value=ok]').click(); pg.wait_for_timeout(300)
    pg.evaluate(f"{api}.select('A1:C5')")
    pg.locator('[data-a="border"]').click(); pg.locator('.menu-item', has_text='Alle Rahmenlinien').click()
    pg.evaluate(f"{api}.select('A1')")
    pg.locator('[data-a="filter"]').click(); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, 'sheet_extras.png'))
    pg.locator('[data-af="0"]').click(); pg.wait_for_selector('.af-dlg')
    pg.locator('.af-item', has_text='Feb').locator('input').uncheck()
    pg.locator('dialog button[value=ok]').click(); pg.wait_for_timeout(400)
    print('hidden', pg.evaluate(f"{api}.hiddenRows()"))
    pg.screenshot(path=os.path.join(OUT, 'sheet_filtered.png'))
    pg.locator('[data-office-save]').click(); pg.wait_for_timeout(1500)
    blob = pg.evaluate('''async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
      const docs = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result); });
      const d = docs.find(x => x.kind === 'xlsx'); const f = await new Promise(r => { const g = db.transaction('files').objectStore('files').get(d.id); g.onsuccess = () => r(g.result); });
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r([d.id, fr.result.split(',')[1]]); fr.readAsDataURL(f.blob); }); }''')
    open(os.path.join(OUT, 'test.xlsx'), 'wb').write(base64.b64decode(blob[1]))
    pg.evaluate("location.hash='#/start'"); pg.wait_for_timeout(500)
    pg.evaluate(f"location.hash='#/bearbeiten/{blob[0]}'"); pg.wait_for_selector('.sh-chart', timeout=8000)
    pg.wait_for_timeout(500)
    print('reopened charts', pg.evaluate(f"JSON.stringify({api}.charts())")[:400])
    print('hidden after reopen', pg.evaluate(f"{api}.hiddenRows()"))
    pg.screenshot(path=os.path.join(OUT, 'sheet_reopen.png'))
    print('\n'.join(errs) or 'no console errors')
    b.close()
