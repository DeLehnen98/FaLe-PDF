"""aud1 explorer: run tools like a phone user with hard inputs; print a compact report per case.
usage: python3 aud1_explore.py [case-substring ...]"""
import json, os, sys, time, subprocess
from pathlib import Path
os.environ.setdefault('WT_PORT', '8780')
from wtlib import Suite, FIX, OUT

A = 'aud1/'
P40 = sorted(f'aud1/photos40/{p.name}' for p in (FIX / 'aud1/photos40').glob('*.jpg'))
LONG = 'aud1/' + (FIX / 'aud1/longname.txt').read_text()
O = 'aud1/office/'
CASES = [
    ('merge-pdf', '/werkzeuge/pdf-zusammenfuegen/', [A + 'rich.pdf', A + 'mixed_rot.pdf', A + 'portrait_exif.jpg', A + 'alpha_logo.png', LONG]),
    ('merge-pdf', '/werkzeuge/pdf-zusammenfuegen/', [A + 'long300.pdf', A + 'heavy80.pdf']),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'heavy80.pdf']),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'rich.pdf', A + 'scanned.pdf', A + 'tiny.pdf', LONG]),
    ('jpg-to-pdf', '/werkzeuge/bild-in-pdf/', P40),
    ('jpg-to-pdf', '/werkzeuge/bild-in-pdf/', [A + 'alpha_logo.png', A + 'portrait_exif.jpg']),
    ('split-pdf', '/werkzeuge/pdf-teilen/', [A + 'long300.pdf']),
    ('split-pdf', '/werkzeuge/pdf-teilen/', [A + 'rich.pdf']),
    ('delete-pages', '/werkzeuge/pdf-seiten-loeschen/', [A + 'rich.pdf']),
    ('extract-pages', '/werkzeuge/pdf-seiten-extrahieren/', [A + 'mixed_rot.pdf']),
    ('organize-pdf', '/werkzeuge/pdf-seiten-sortieren/', [A + 'long300.pdf']),
    ('organize-pdf', '/werkzeuge/pdf-seiten-sortieren/', [A + 'rich.pdf', A + 'mixed_rot.pdf']),
    ('rotate-pdf', '/werkzeuge/pdf-drehen/', [A + 'mixed_rot.pdf']),
    ('rotate-pdf', '/werkzeuge/pdf-drehen/', [A + 'rich.pdf']),
    ('remove-blank-pages', '/werkzeuge/leere-seiten-entfernen/', [A + 'scanned.pdf']),
    ('alternate-mix', '/werkzeuge/pdf-seiten-mischen/', [A + 'rich.pdf', A + 'mixed_rot.pdf']),
    ('split-halves', '/werkzeuge/doppelseiten-teilen/', [A + 'mixed_rot.pdf']),
    ('repair-pdf', '/werkzeuge/pdf-reparieren/', [A + 'truncated.pdf']),
    ('repair-pdf', '/werkzeuge/pdf-reparieren/', [A + 'rich.pdf']),
    ('grayscale-pdf', '/werkzeuge/pdf-graustufen/', [A + 'rich.pdf', 'real/huawei-cover-picture.pdf']),
    ('grayscale-pdf', '/werkzeuge/pdf-graustufen/', [A + 'heavy80.pdf']),
    ('pdf-to-jpg', '/werkzeuge/pdf-in-jpg/', [A + 'mixed_rot.pdf']),
    ('pdf-to-jpg', '/werkzeuge/pdf-in-jpg/', [A + 'long300.pdf']),
    ('pdf-to-png', '/werkzeuge/pdf-in-png/', [A + 'rich.pdf']),
    ('extract-images', '/werkzeuge/bilder-aus-pdf-extrahieren/', [A + 'heavy80.pdf']),
    ('extract-images', '/werkzeuge/bilder-aus-pdf-extrahieren/', [A + 'scanned.pdf', 'real/huawei-cover-picture.pdf']),
    ('pdf-to-text', '/werkzeuge/pdf-in-text/', [A + 'rich.pdf', A + 'mixed_rot.pdf']),
    ('pdf-to-text', '/werkzeuge/pdf-in-text/', [A + 'long300.pdf']),
    ('pdf-to-markdown', '/werkzeuge/pdf-in-markdown/', [A + 'rich.pdf', 'real/qpl-info.pdf']),
    ('pdf-to-word', '/werkzeuge/pdf-in-word/', [A + 'rich.pdf', 'real/qpl-info.pdf']),
    ('pdf-to-word', '/werkzeuge/pdf-in-word/', [A + 'long300.pdf']),
    ('pdf-to-excel', '/werkzeuge/pdf-in-excel/', ['conv_tables.pdf', A + 'rich.pdf']),
    ('pdf-to-pptx', '/werkzeuge/pdf-in-powerpoint/', ['real/ppt-pdf.pdf', A + 'mixed_rot.pdf']),
    ('word-to-pdf', '/werkzeuge/word-in-pdf/', [O + 'math_real.docx', O + 'images.docx', O + 'simpletable.docx', O + 'headerfooter.docx', O + 'twolevellist.docx']),
    ('excel-to-pdf', '/werkzeuge/excel-in-pdf/', [O + 'umsatz_real.xlsx']),
    ('pptx-to-pdf', '/werkzeuge/powerpoint-in-pdf/', [O + 'vortrag_real.pptx']),
    ('text-to-pdf', '/werkzeuge/text-in-pdf/', ['conv_text.txt', 'conv_text.md', 'conv_text.csv', 'conv_latin1.txt']),
    ('pdf-to-text', '/werkzeuge/pdf-in-text/', [A + 'scanned.pdf']),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'rich_pw.pdf', A + 'truncated.pdf', A + 'fake.pdf', A + 'zero.pdf']),
]
LT = """window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}"""

sel = sys.argv[1:]
with Suite('aud1-explore') as s:
    ctx = s.context('phone', 'de')
    ctx.add_init_script(LT)
    for i, (tool, path, files) in enumerate(CASES):
        tag = f'{i}:{tool}:{",".join(Path(f).name[:18] for f in files[:4])}{"…" if len(files) > 4 else ""}'
        if sel and not any(x in tag for x in sel):
            continue
        page = s.open(ctx, path)
        t0 = time.time()
        s.pick(page, *files)
        try:
            page.wait_for_function("""() => { const c=[...document.querySelectorAll('.wt-file')]; return c.length && c.every(x => x.querySelector('.wt-thumb.has-img') || x.classList.contains('is-error') || x.classList.contains('is-locked')); }""", timeout=180000)
        except Exception as e:
            print(tag, 'PREP TIMEOUT'); page.close(); continue
        tp = time.time() - t0
        st = page.evaluate("""() => ({cards:[...document.querySelectorAll('.wt-file')].map(c=>c.querySelector('.wt-file-meta').textContent+(c.classList.contains('is-error')?' ERR:'+c.querySelector('.wt-file-err')?.textContent:'')+(c.classList.contains('is-locked')?' LOCKED':'')), bar: document.querySelector('.wt-bar-summary').textContent, hint: document.querySelector('.wt-bar-hint').hidden?'':document.querySelector('.wt-bar-hint').textContent, dis: document.querySelector('.wt-bar .wt-btn-primary').disabled})""")
        page.evaluate("() => { window.__lt.length = 0; }")
        t1 = time.time()
        res = None
        if not st['dis']:
            page.locator('.wt-bar .wt-btn-primary').click()
            try:
                page.wait_for_function("() => !document.querySelector('.wt-result').hidden || !document.querySelector('.wt-error').hidden || (document.getElementById('wt-app').dataset.state === 'files' && !document.querySelector('.wt-bar-hint').hidden)", timeout=600000, polling=200)
                if page.evaluate("() => document.getElementById('wt-app').dataset.state") == 'files':
                    print(f'\n== {tag}  STAYED with hint:', page.locator('.wt-bar-hint').inner_text()); page.close(); continue
                res = page.evaluate("""() => ({err: document.querySelector('.wt-error:not([hidden])')?.innerText, outs:[...document.querySelectorAll('.wt-output')].map(o=>o.querySelector('.wt-file-name').textContent+' | '+o.querySelector('.wt-out-size').textContent+(o.querySelector('.wt-out-note')?' | '+o.querySelector('.wt-out-note').textContent:'')), notes:[...document.querySelectorAll('.wt-result .wt-note')].map(n=>n.textContent), next:[...document.querySelectorAll('.wt-next-chip')].map(n=>n.textContent), bar: document.querySelector('.wt-bar-summary').textContent})""")
            except Exception as e:
                res = {'err': 'RUN TIMEOUT'}
        tr = time.time() - t1
        lt = page.evaluate("() => window.__lt")
        mem = page.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1e6) : -1")
        print(f'\n== {tag}  prep {tp:.1f}s run {tr:.1f}s  longtasks n={len(lt)} max={max(lt) if lt else 0}ms sum={sum(lt)}ms heap={mem}MB')
        print('  cards:', st['cards'][:6], '| bar:', st['bar'], st['hint'], 'disabled' if st['dis'] else '')
        if res:
            if res.get('err'): print('  ERROR:', res['err'][:300])
            for o in (res.get('outs') or [])[:8]: print('  out:', o[:200])
            if res.get('outs') and len(res['outs']) > 8: print('  … outs', len(res['outs']))
            for n in res.get('notes') or []: print('  note:', n[:200])
            print('  next:', res.get('next'), '| bar:', res.get('bar'))
            if res.get('outs'):
                try:
                    p = s.download(page, 0)
                    print('  dl:', p.name, p.stat().st_size)
                except Exception as e:
                    print('  dl fail', e)
        page.close()
    s.fails = [f for f in s.fails]
