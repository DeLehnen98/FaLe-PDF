pg.evaluate("h => { const ed = document.querySelector('.doc-page'); ed.innerHTML = h; ed.dispatchEvent(new Event('input', {bubbles:true})); }", '<p>Normaler Text mit Wort fett und mehr.</p>')
sel = "t => { const ed = document.querySelector('.doc-page'); const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf(t); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); getSelection().removeAllRanges(); getSelection().addRange(r); ed.focus(); return; } } }"
pg.evaluate(sel, 'Wort fett'); pg.wait_for_timeout(100)
pg.locator('[data-font]').select_option('Courier New'); pg.wait_for_timeout(300)
print(pg.evaluate("document.querySelector('.doc-page').innerHTML"))
pg.evaluate(sel, 'Wort fett'); pg.wait_for_timeout(100)
pg.locator('[data-size]').select_option('14'); pg.wait_for_timeout(300)
print(pg.evaluate("document.querySelector('.doc-page').innerHTML"))
