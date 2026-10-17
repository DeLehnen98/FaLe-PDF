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
    pg.evaluate("location.hash='#/neu/dokument'")
    pg.wait_for_selector('.doc-page')
    pg.evaluate("""() => { const ed = document.querySelector('.doc-page'); ed.innerHTML = '<p>Vorwort hier.</p><h1>Einleitung</h1><p>Das ist ein wichtiger Satz im Text.</p><h2>Ziele</h2><p>Wir wollen viel erreichen.</p><hr data-page-break><h1>Ergebnis</h1><p>Fertig.</p>'; ed.dispatchEvent(new Event('input', {bubbles:true})); }""")
    api = "document.querySelector('.writer')._writerApi"
    # place caret at start (after Vorwort)
    pg.evaluate("""() => { const p = document.querySelector('.doc-page p'); const r = document.createRange(); r.setStart(p.firstChild, 13); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.doc-page').focus(); }""")
    pg.evaluate(f"{api}.insertToc()")
    pg.wait_for_timeout(400)
    # select "wichtiger" and comment
    pg.evaluate("""() => { const p = [...document.querySelectorAll('.doc-page p')].find(x => x.textContent.includes('wichtiger')); const t = p.firstChild; const i = t.nodeValue.indexOf('wichtiger'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 9); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    pg.evaluate(f"{api}.addComment('Bitte belegen')")
    pg.evaluate("""() => { const p = [...document.querySelectorAll('.doc-page p')].find(x => x.textContent.includes('erreichen')); const t = p.firstChild; const r = document.createRange(); r.setStart(t, t.nodeValue.length); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    pg.evaluate(f"{api}.insertFootnote('Quelle: Jahresbericht 2026')")
    pg.evaluate(f"{api}.setHf({{ header: 'Projektbericht', headerAlign: 'left', footer: 'Vertraulich', footerAlign: 'left', pageNumbers: 'footer-right', pageFormat: 'n-of-m' }})")
    pg.wait_for_timeout(500)
    pg.locator('[data-panel="outline"]').click()
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, 'writer_extras.png'))
    pg.locator('[data-office-save]').click(); pg.wait_for_timeout(2500)
    did, b64 = pg.evaluate(IDB, 'docx')
    open(os.path.join(OUT, 'w.docx'), 'wb').write(base64.b64decode(b64))
    # PDF export
    pg.locator('[data-office-more]').click(); pg.locator('.menu-item', has_text='Als PDF exportieren').click()
    pg.wait_for_selector('dialog .result-mini', timeout=30000)
    pg.locator('dialog button[value="cancel"], dialog .dlg-head .icon-btn').first.click()
    did2, b64 = pg.evaluate(IDB, 'pdf')
    open(os.path.join(OUT, 'w.pdf'), 'wb').write(base64.b64decode(b64))
    # reopen
    pg.evaluate("location.hash='#/start'"); pg.wait_for_timeout(400)
    pg.evaluate(f"location.hash='#/bearbeiten/{did}'"); pg.wait_for_selector('.doc-page'); pg.wait_for_timeout(1500)
    print('reopen toc', pg.locator('.doc-page [data-toc] .toc-e').count(), 'cmts', pg.locator('.doc-page [data-cmt]').count(), 'fn', pg.locator('.doc-page sup.fn').count(), 'hf', pg.evaluate(f"JSON.stringify({api}.hf())"))
    pg.screenshot(path=os.path.join(OUT, 'writer_reopen.png'))
    print('\n'.join(errs) or 'no console errors')
    b.close()
