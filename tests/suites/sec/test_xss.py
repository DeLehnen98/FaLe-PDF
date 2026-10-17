"""Security e2e tests for FaLe PDF (XSS corpus, malicious documents, CSP / Trusted Types, resource limits,
link confirmation, clipboard clearing, vault/sync KDF hardening).

Servers (all apply the vercel.json headers, i.e. the real CSP):
   node csp_server.mjs 9404            static app
   node ai_harness.mjs 9409            app + /api/ai (mock provider) – AI output injection
   node share_harness.mjs 9415         app + /api/share – share metadata injection
Data: python3 make_sec_data.py && node make_sec_pdfs.mjs   (→ secdata/)

Every payload sets window.__pwned = <id> if it ever executes. Independently of execution (CSP blocks
inline handlers anyway) the DOM is scanned for injected markup: elements carrying the payload marker
attribute data-pwn, on* attributes and javascript:/data: links. Both must stay empty."""
import os, sys, json, base64, re, time, traceback
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
SD = os.path.join(SP, 'secdata')
URL = os.environ.get('SEC_URL', 'http://127.0.0.1:9404/')
AI_URL = os.environ.get('SEC_AI_URL', 'http://127.0.0.1:9409/')
SHARE_URL = os.environ.get('SEC_SHARE_URL', 'http://127.0.0.1:9415/')

results, problems, violations = [], [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if (info != '' and not cond) else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


DETECT = """() => {
  const all = Array.from(document.querySelectorAll('*'));
  return {
    pwned: window.__pwned === undefined ? null : window.__pwned,
    injected: Array.from(document.querySelectorAll('[data-pwn]')).map(e => e.tagName + ' ' + e.getAttribute('data-pwn')),
    handlers: all.filter(e => Array.from(e.attributes).some(a => /^on/i.test(a.name))).map(e => e.tagName + ':' + Array.from(e.attributes).filter(a => /^on/i.test(a.name)).map(a => a.name).join(',')),
    jsLinks: Array.from(document.querySelectorAll('a[href], area[href], [src], [action], [formaction]')).map(e => e.getAttribute('href') || e.getAttribute('src') || e.getAttribute('action') || e.getAttribute('formaction') || '')
      .filter(v => /^\\s*(javascript|vbscript|data:text)/i.test(v)).map(v => v.slice(0, 60)),
    scripts: Array.from(document.scripts).map(s => s.getAttribute('src') || 'INLINE:' + s.textContent.slice(0, 40)).filter(s => !/^(js\\/boot\\.js|js\\/app\\.js|.*vendor\\/.*|.*\\/js\\/.*)$/.test(s) && !/^https?:\\/\\/127\\.0\\.0\\.1/.test(s)),
    remoteImgs: Array.from(document.images).map(i => i.getAttribute('src') || '').filter(s => /^https?:/i.test(s) && !s.startsWith(location.origin)),
  };
}"""


def clean(page, label):
    d = page.evaluate(DETECT)
    ok = d['pwned'] is None and not d['injected'] and not d['handlers'] and not d['jsLinks'] and not d['scripts'] and not d['remoteImgs']
    check(f'{label}: no script ran, no markup/handler/js-link/remote image injected', ok, json.dumps(d)[:600])
    return d


def responsive(page, label):
    t = time.time()
    try:
        v = page.evaluate('1 + 1', timeout=8000) if False else page.evaluate('1 + 1')
        check(f'{label}: app stays responsive', v == 2 and time.time() - t < 8, f'{time.time() - t:.1f}s')
    except Exception as e:
        check(f'{label}: app stays responsive', False, str(e)[:200])


def new_ctx(browser, extra_init=''):
    ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    ctx.add_init_script("""try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-onboarding-done', '1'); localStorage.setItem('fale-lang', 'de'); } catch (e) {}
      window.__viol = []; document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '').slice(0, 60)));""" + extra_init)
    return ctx


def attach(page, label):
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.on('dialog', lambda d: (problems.append(f'{label} [native dialog] {d.message}'), d.dismiss()))


def goto(page, h, wait=900):
    page.evaluate(f'location.hash = {json.dumps(h)}')
    page.wait_for_timeout(wait)


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


IMPORT = """async ([name, type, data]) => {
  const bin = atob(data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const lib = await import('./js/library.js');
  const docs = await lib.importFiles([new File([u8], name, { type })], { source: 'Gerät', any: true });
  return docs[0] ? { id: docs[0].id, name: docs[0].name, kind: docs[0].kind } : null;
}"""


def imp(page, path, name, typ):
    return page.evaluate(IMPORT, [name, typ, b64(path)])


def toasts(page):
    return page.evaluate("Array.from(document.querySelectorAll('#toasts .toast-msg')).map(t => t.textContent).join(' | ')")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = new_ctx(browser)
        page = ctx.new_page()
        attach(page, 'main')
        resp = page.goto(URL)
        page.wait_for_timeout(1500)
        state = {}

        # ------------------------------------------------------------------ headers / CSP / Trusted Types
        def headers():
            h = resp.headers
            csp = h.get('content-security-policy', '')
            check('CSP header present on the app document', "script-src 'self' 'wasm-unsafe-eval'" in csp and "object-src 'none'" in csp and "frame-ancestors 'none'" in csp and "base-uri 'none'" in csp, csp)
            check("CSP: no 'unsafe-inline' / 'unsafe-eval' for scripts", "'unsafe-eval'" not in csp and not re.search(r"script-src[^;]*'unsafe-inline'", csp), csp)
            check('CSP: Trusted Types enforced', "require-trusted-types-for 'script'" in csp and 'trusted-types default fale-internal' in csp)
            for k, v in [('x-content-type-options', 'nosniff'), ('referrer-policy', 'no-referrer'), ('x-frame-options', 'DENY'), ('cross-origin-opener-policy', 'same-origin'), ('strict-transport-security', 'max-age=')]:
                check(f'header {k}', v in (h.get(k) or ''), h.get(k))
            check('Permissions-Policy: camera self, geolocation none', 'camera=(self)' in h.get('permissions-policy', '') and 'geolocation=()' in h.get('permissions-policy', ''))
            meta = page.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]') && document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
            check('CSP meta fallback (Android WebView) present and equivalent', bool(meta) and meta.replace(" frame-ancestors 'none';", '') == csp.replace(" frame-ancestors 'none';", ''), meta)
            check('no inline <script> in index.html', page.evaluate("Array.from(document.scripts).every(s => s.src)"))
            check('Trusted Types default policy active', page.evaluate("!!(window.trustedTypes && trustedTypes.defaultPolicy)"))
        step('headers', headers)

        def tt_net():
            # NOTE: code evaluated through DevTools (page.evaluate) is exempt from CSP – the probes therefore
            # run in a page task (setTimeout) exactly like an injected payload would.
            page.evaluate("""() => { window.__probe = null; setTimeout(() => {
              const out = {};
              const d = document.createElement('div'); document.body.appendChild(d);
              d.innerHTML = '<img src="x" data-t="1" onerror="window.__tt=1"><a href="javascript:window.__tt=2" data-t="2">x</a><iframe srcdoc="<script>parent.__tt=3</script>"></iframe><b>ok</b>';
              out.innerHTML = d.innerHTML;
              d.insertAdjacentHTML('beforeend', '<svg data-t="3"><animate attributeName="href" to="javascript:alert(1)"/></svg><div data-t="4" onclick="x">y</div>');
              out.adjacent = d.innerHTML;
              try { const s = document.createElement('script'); s.src = 'https://evil.example/x.js'; out.foreignScript = 'assigned'; } catch (e) { out.foreignScript = 'blocked:' + e.name; }
              try { eval('window.__tt = 4'); out.eval = 'ran'; } catch (e) { out.eval = 'blocked:' + e.name; }
              try { new Function('window.__tt = 5')(); out.fn = 'ran'; } catch (e) { out.fn = 'blocked:' + e.name; }
              try { setTimeout('window.__tt = 6', 0); out.timeout = 'scheduled'; } catch (e) { out.timeout = 'blocked:' + e.name; }
              try { const s = document.createElement('script'); s.textContent = 'window.__tt = 7'; document.body.appendChild(s); out.inline = 'appended'; } catch (e) { out.inline = 'blocked:' + e.name; }
              try { const a = document.createElement('a'); a.href = 'javascript:window.__tt=8'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { out.jsnav = 'blocked:' + e.name; }
              d.remove();
              window.__probe = out;
            }, 0); }""")
            page.wait_for_timeout(600)
            r = page.evaluate('window.__probe')
            tt = page.evaluate('window.__tt === undefined ? null : window.__tt')
            check('TT safety net: on* handler / javascript: URL / srcdoc iframe stripped from innerHTML', 'onerror' not in r['innerHTML'] and 'javascript:' not in r['innerHTML'] and 'iframe' not in r['innerHTML'] and '<b>ok</b>' in r['innerHTML'], r['innerHTML'])
            check('TT safety net: insertAdjacentHTML handler + SVG href animation stripped', 'onclick' not in r['adjacent'] and 'animate' not in r['adjacent'], r['adjacent'])
            check('TT: cross-origin script URL refused', r['foreignScript'].startswith('blocked'), r['foreignScript'])
            check('CSP/TT: eval refused', r['eval'].startswith('blocked'), r['eval'])
            check('CSP/TT: new Function refused', r['fn'].startswith('blocked'), r['fn'])
            check('CSP/TT: inline <script> refused', r['inline'].startswith('blocked'), r['inline'])
            check('CSP: no probe payload ran (eval / setTimeout(string) / inline script / javascript: navigation)', tt is None, tt)
        step('trusted types safety net', tt_net)

        # ------------------------------------------------------------------ file names
        def names():
            evil = os.path.join(SD, 'evil.pdf')
            n1 = '"><img src=x data-pwn="1001" onerror="window.__pwned=1001">.pdf'
            d1 = imp(page, evil, n1, 'application/pdf')
            check('import PDF with HTML file name (name sanitised for the file system)', d1 is not None and d1['id'] and '<' not in d1['name'], d1)
            state['pdf'] = d1['id'] if d1 else None
            d2 = imp(page, os.path.join(SD, 'xss.md'), "<svg data-pwn='1002' onload='window.__pwned=1002'>.md", 'text/markdown')
            state['md'] = d2 and d2['id']
            d3 = imp(page, os.path.join(SD, 'xss.docx'), '<script data-pwn="1003">window.__pwned=1003</script>.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            state['docx'] = d3 and d3['id']
            d4 = imp(page, os.path.join(SD, 'xss.xlsx'), "Tabelle '<img src=x data-pwn=1004 onerror=window.__pwned=1004>.xlsx", 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            state['xlsx'] = d4 and d4['id']
            d5 = imp(page, os.path.join(SD, 'xss.pptx'), 'Folien <b data-pwn=1005>.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
            state['pptx'] = d5 and d5['id']
            d6 = imp(page, os.path.join(SD, 'xss.csv'), 'daten.csv', 'text/csv')
            state['csv'] = d6 and d6['id']
            check('all malicious documents imported', all([d1, d2, d3, d4, d5, d6]), [d1, d2, d3, d4, d5, d6])
            for route in ['#/start', '#/dateien', '#/suche?q=' + '<img src=x data-pwn=1010 onerror=window.__pwned=1010>', '#/suche?q=img', '#/werkzeuge?q=<b data-pwn=1011>x</b>', '#/werkzeug/zusammenfuegen', '#/werkzeug/vergleichen']:
                goto(page, route, 1200)
                clean(page, f'route {route[:40]}')
        step('malicious file names', names)

        # ------------------------------------------------------------------ PDF
        def pdf():
            goto(page, f"#/ansicht/{state['pdf']}", 400)
            page.wait_for_function("() => document.querySelector('#viewer .annotationLayer section, #viewer .annotationLayer a') || document.querySelector('#viewer .textLayer span')", timeout=20000)
            page.wait_for_timeout(1500)
            clean(page, 'PDF viewer (OpenAction / AA / Names JavaScript, HTML metadata)')
            check('document title is plain text', '<' not in page.evaluate('document.title') and 'img src' in page.evaluate('document.title'), page.evaluate('document.title'))
            # panel: outline with HTML title
            page.locator('[data-v=panel]').click(); page.wait_for_timeout(300)
            page.locator('[data-ptab=outline]').click(); page.wait_for_timeout(800)
            ol = page.locator('[data-v=outline] button')
            check('outline renders the HTML title as text', ol.count() >= 2 and '<img' in ol.first.inner_text(), ol.count())
            clean(page, 'PDF outline')
            ol.first.click(); page.wait_for_timeout(600)
            check('javascript: outline link is not opened', page.evaluate('window.__pwned === undefined') and page.url.startswith(URL), page.url)
            pages_before = len(ctx.pages)
            ol.nth(1).click(); page.wait_for_timeout(500)
            dlg = page.locator('dialog[open]')
            check('external outline link asks first (shows the target)', dlg.count() == 1 and 'example.com/outline' in dlg.inner_text(), dlg.inner_text() if dlg.count() else 'no dialog')
            if dlg.count():
                dlg.locator('button[value=cancel]').click(); page.wait_for_timeout(300)
            check('cancel → nothing opened', len(ctx.pages) == pages_before)
            # annotation links
            links = page.evaluate("Array.from(document.querySelectorAll('#viewer .annotationLayer a')).map(a => a.getAttribute('href') || '')")
            check('pdf.js drops javascript: link targets', not any(l.lower().startswith('javascript') for l in links), links)
            ext = page.locator('#viewer .annotationLayer a[href^="https://example.com"]')
            if ext.count():
                ext.first.click(force=True); page.wait_for_timeout(500)
                dlg = page.locator('dialog[open]')
                check('external PDF link asks first', dlg.count() == 1 and 'example.com/fale-sec-test' in dlg.inner_text(), dlg.inner_text() if dlg.count() else 'no dialog')
                if dlg.count():
                    dlg.locator('button[value=cancel]').click(); page.wait_for_timeout(300)
                check('cancel → still in the app, no new window', page.url.startswith(URL) and len(ctx.pages) == pages_before, page.url)
            else:
                check('external PDF link rendered', False, links)
            for a in page.locator('#viewer .annotationLayer a').all():
                try:
                    a.click(force=True, timeout=2000); page.wait_for_timeout(250)
                    d = page.locator('dialog[open]')
                    if d.count():
                        d.locator('button[value=cancel]').click(); page.wait_for_timeout(200)
                except Exception:
                    pass
            page.wait_for_timeout(500)
            clean(page, 'after clicking every PDF link (JavaScript / Launch / javascript: actions)')
            check('still in the app after all PDF links', page.url.startswith(URL) and len(ctx.pages) == pages_before, page.url)
            goto(page, '#/dateien', 600)
            # form tool: field names/values from the PDF
            goto(page, f"#/werkzeug/unterschreiben?doc={state['pdf']}", 3500)
            clean(page, 'fill & sign: form field names/values from the PDF')
            goto(page, f"#/werkzeug/formular-erstellen?doc={state['pdf']}", 3000)
            clean(page, 'form creator: existing fields from the PDF')
            goto(page, '#/dateien', 600)
        step('malicious PDF', pdf)

        def fontmatrix():
            d = imp(page, os.path.join(SD, 'fontmatrix.pdf'), 'fontmatrix.pdf', 'application/pdf')
            goto(page, f"#/ansicht/{d['id']}", 3500)
            check('CVE-2024-4367-style FontMatrix PDF renders without executing code', page.evaluate('window.__pwned === undefined'))
            check('pdf.js build has no eval code path (6.2.108 ≥ 4.2.67)', page.evaluate("import('./vendor/pdfjs/pdf.min.mjs').then(m => m.version)") == '6.2.108')
            goto(page, '#/dateien', 600)
            d2 = imp(page, os.path.join(SD, 'hugepage.pdf'), 'hugepage.pdf', 'application/pdf')
            goto(page, f"#/ansicht/{d2['id']}", 4000)
            mx = page.evaluate("Math.max(0, ...Array.from(document.querySelectorAll('#viewer canvas, #viewer img')).map(c => (c.width || 0) * (c.height || 0)))")
            check('14 400 pt page: rendered canvases stay within the pixel limit', mx <= 40e6 * 1.01, mx)
            responsive(page, 'huge MediaBox')
            goto(page, '#/dateien', 600)
        step('pdf.js hardening', fontmatrix)

        # ------------------------------------------------------------------ office documents
        def office():
            goto(page, f"#/bearbeiten/{state['docx']}", 4000)
            page.wait_for_selector('.doc-page', timeout=15000)
            page.wait_for_timeout(800)
            clean(page, 'docx in the editor')
            html = page.evaluate("document.querySelector('.doc-page').innerHTML")
            check('docx text payload shown as text', '&lt;img src=x data-pwn="101"' in html or '&lt;img src=x data-pwn=&quot;101&quot;' in html or '<img src=x data-pwn' in page.evaluate("document.querySelector('.doc-page').innerText"), html[:300])
            hrefs = page.evaluate("Array.from(document.querySelectorAll('.doc-page a')).map(a => a.getAttribute('href'))")
            check('docx hyperlinks: only http(s) kept, quotes cannot break out', all(h and h.startswith('https://example.com/') for h in hrefs) and not page.evaluate("document.querySelector('.doc-page [data-pwn]')"), hrefs)
            check('docx: external image link (tracking pixel) not loaded', not page.evaluate("Array.from(document.querySelectorAll('.doc-page img')).some(i => /^https?:/.test(i.getAttribute('src')))"))
            # comments panel
            btn = page.locator('[data-comment]')
            goto(page, '#/dateien', 800)
            dlg = page.locator('dialog', has_text='Änderungen speichern?')
            if dlg.count():
                dlg.locator('button[value="discard"]').click(); page.wait_for_timeout(300)
            for key, sel, label in [('md', '.doc-page', 'markdown'), ('xlsx', '.sheet, .sh-grid, [data-cell]', 'xlsx sheet'), ('pptx', '.slide, .sl-stage, .strip', 'pptx slides'), ('csv', '[data-cell], .sheet', 'csv')]:
                goto(page, f"#/bearbeiten/{state[key]}", 3500)
                try:
                    page.wait_for_selector(sel, timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(800)
                clean(page, f'{label} in the editor')
                if key == 'md':
                    hrefs = page.evaluate("Array.from(document.querySelectorAll('.doc-page a')).map(a => a.getAttribute('href'))")
                    check('markdown: javascript:/data: links dropped', not any(re.match(r'^\s*(javascript|data):', h or '', re.I) for h in hrefs), hrefs)
                if key == 'xlsx':
                    styles = page.evaluate("Array.from(document.querySelectorAll('[data-cell]')).map(c => c.getAttribute('style') || '').join('|')")
                    check('xlsx: theme colour / font name cannot break out of style="" (no quotes, no extra attributes)', '"' not in styles and not page.evaluate("document.querySelector('[data-cell][onmouseover], [data-cell] [onmouseover]')"), styles[:300])
                goto(page, '#/dateien', 800)
                dlg = page.locator('dialog', has_text='Änderungen speichern?')
                if dlg.count():
                    dlg.locator('button[value="discard"]').click(); page.wait_for_timeout(300)
            # presenter audience window (DOM-built, no document.write / inline handler)
        step('malicious office documents', office)

        def bombs():
            before = page.evaluate("import('./js/db.js').then(db => db.listFiles()).then(l => l.length)")
            r1 = imp(page, os.path.join(SD, 'bomb_big.docx'), 'bomb_big.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            t1 = toasts(page)
            r1o = None
            if r1:
                goto(page, f"#/bearbeiten/{r1['id']}", 4000)
                r1o = page.evaluate("document.querySelector('#tool-screen') && document.querySelector('#tool-screen').innerText")
            check('zip bomb (600 MiB declared) is refused with a clear message', 'ZIP-Bombe' in (t1 + (r1o or '')), (t1 + ' / ' + (r1o or ''))[:300])
            responsive(page, 'zip bomb (declared size)')
            goto(page, '#/dateien', 600)
            r2 = imp(page, os.path.join(SD, 'bomb_lie.docx'), 'bomb_lie.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            t2 = toasts(page)
            r2o = ''
            if r2:
                goto(page, f"#/bearbeiten/{r2['id']}", 4000)
                r2o = page.evaluate("document.querySelector('#tool-screen') && document.querySelector('#tool-screen').innerText") or ''
            check('zip bomb with lying size header: inflation stops at the declared size', 'beschädigt' in (t2 + r2o) or 'größer als angegeben' in (t2 + r2o) or 'Bombe' in (t2 + r2o), (t2 + ' / ' + r2o)[:300])
            mem = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : 0")
            check('heap stays small after the bombs (< 400 MB)', mem < 400e6, mem)
            responsive(page, 'zip bomb (lying header)')
            goto(page, '#/dateien', 600)
            page.wait_for_timeout(4500)  # let earlier toasts expire
            r3 = imp(page, os.path.join(SD, 'huge.png'), 'huge.png', 'image/png')
            responsive(page, 'image dimension bomb import (thumbnail refused)')
            rr = page.evaluate("""async (data) => {
              const bin = atob(data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              const f = new File([u8], 'huge.png', { type: 'image/png' });
              const S = await import('./js/security.js');
              const out = { probe: await S.probeImageSize(f) };
              for (const [mod, fn] of [['./js/tools/imagetools.js', 'loadImageToCanvas']]) {
                try { await (await import(mod))[fn](f); out[fn] = 'decoded'; } catch (e) { out[fn] = e.userMessage || e.message; }
              }
              return out;
            }""", b64(os.path.join(SD, 'huge.png')))
            check('image header probe sees 60 000 × 60 000 without decoding', rr['probe'] == {'w': 60000, 'h': 60000}, rr)
            check('image tools refuse the dimension bomb before decoding', 'zu groß' in str(rr.get('loadImageToCanvas')), rr)
            responsive(page, 'image dimension bomb')
        step('decompression / dimension bombs', bombs)

        # ------------------------------------------------------------------ other untrusted inputs
        def misc():
            goto(page, '#/werkzeug/qr-scannen', 1500)
            page.evaluate("""async () => {
              const m = await import('./js/tools/qrscan.js');
              const host = document.createElement('div'); host.id = 'qrhost'; document.body.appendChild(host);
              m.showResultSheet(host, { rawValue: '<img src=x data-pwn=1201 onerror=window.__pwned=1201>', format: 'qr_code' }, { onClose() {} });
              m.showResultSheet(host, { rawValue: 'WIFI:S:<b data-pwn=1202>;T:WPA;P:"><img src=x data-pwn=1203>;;', format: 'qr_code' }, { onClose() {} });
              m.showResultSheet(host, { rawValue: 'BEGIN:VCARD\\nVERSION:3.0\\nFN:<img src=x data-pwn=1204 onerror=window.__pwned=1204>\\nURL:javascript:window.__pwned=1205\\nEND:VCARD', format: 'qr_code' }, { onClose() {} });
            }""")
            page.wait_for_timeout(500)
            clean(page, 'QR payloads (text / Wi-Fi / vCard)')
            page.evaluate("document.getElementById('qrhost').remove()")
            goto(page, '#/dateien', 500)
            page.evaluate("""async () => {
              const org = await import('./js/extras/organize.js');
              const db = await import('./js/db.js');
              await db.setSetting('tags', [{ id: 'tx1', name: '<img src=x data-pwn=1301 onerror=window.__pwned=1301>', color: 'red" onmouseover="window.__pwned=1302' }]);
              const d = (await db.listFiles())[0];
              await db.updateDoc(d.id, { tags: ['tx1'] });
            }""")
            goto(page, '#/start', 600); goto(page, '#/dateien', 1200)
            clean(page, 'tags from sync/backup with HTML name + style-breaking colour')
            page.evaluate("""async () => {
              const p = await import('./js/extras/profile.js');
              const pl = '<img src=x data-pwn=1401 onerror=window.__pwned=1401>';
              await p.setProfile({ vorname: pl, nachname: pl, firma: pl, strasse: pl, ort: pl, email: pl, telefon: pl });
            }""")
            for r in ['#/profil', '#/schreiben', '#/schreiben/kuendigung?art=handy', '#/einstellungen']:
                goto(page, r, 1500)
                clean(page, f'profile values in {r}')
            goto(page, '#/dateien', 400)
        step('QR, tags, profile', misc)

        def links_and_clipboard():
            r = page.evaluate("""async () => {
              const S = await import('./js/security.js');
              const out = {};
              out.safe = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\\tscript:x', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'https://user:pw@evil.example/', 'https://example.com/ok', 'mailto:a@b.de', 'tel:+4912345']
                .map(u => [u, S.safeUrl(u)]);
              out.color = ['#fff', 'rgb(1,2,3)', 'red', 'red" onclick="x', 'url(https://e/x)', 'expression(alert(1))'].map(c => [c, S.cssColor(c, 'FALLBACK')]);
              // clipboard: copied secret is cleared again
              const ok = await S.copySecret('GEHEIMER-SCHLUESSEL-123', { clearAfterMs: 1200 });
              out.copied = ok && (await navigator.clipboard.readText()) === 'GEHEIMER-SCHLUESSEL-123';
              await new Promise(r => setTimeout(r, 1800));
              out.cleared = (await navigator.clipboard.readText()) === '';
              // not cleared when the user copied something else in the meantime
              await S.copySecret('ZWEITES-GEHEIMNIS', { clearAfterMs: 1000 });
              document.dispatchEvent(new Event('copy'));
              await navigator.clipboard.writeText('etwas anderes');
              await new Promise(r => setTimeout(r, 1500));
              out.kept = (await navigator.clipboard.readText()) === 'etwas anderes';
              out.secure = [S._secureCount()];
              const rel = S.screenSecure(true); out.secure.push(S._secureCount()); rel(); rel(); out.secure.push(S._secureCount());
              return out;
            }""")
            bad = [u for u, v in r['safe'] if v is not None and not re.match(r'^(https://example\.com/ok|mailto:a@b\.de|tel:\+4912345)$', v)]
            check('safeUrl: only http(s)/mailto/tel, no credentials in URLs', not bad and dict(r['safe'])['https://example.com/ok'] == 'https://example.com/ok', r['safe'])
            check('cssColor: only colour syntax survives', [v for c, v in r['color']] == ['#fff', 'rgb(1,2,3)', 'red', 'FALLBACK', 'FALLBACK', 'FALLBACK'], r['color'])
            check('copySecret: copied …', r['copied'])
            check('… and removed from the clipboard after the timeout', r['cleared'])
            check('… but never overwrites something the user copied afterwards', r['kept'])
            check('screenSecure is ref-counted (FLAG_SECURE on/off)', r['secure'] == [0, 1, 0], r['secure'])
        step('URL / colour helpers, clipboard clearing, FLAG_SECURE refcount', links_and_clipboard)

        def kdf():
            r = page.evaluate("""async () => {
              const V = await import('./js/extras/vault.js');
              const db = await import('./js/db.js');
              const out = { iterations: V.ITERATIONS };
              await V.setupVault('123456789');
              out.newHeader = (await V.getHeader()).iter;
              // legacy vault with 400 000 rounds → upgraded on unlock
              const enc = new TextEncoder(); const rnd = n => crypto.getRandomValues(new Uint8Array(n));
              const salt = rnd(16), iv = rnd(12);
              const base = await crypto.subtle.importKey('raw', enc.encode('alt-pin-1'), 'PBKDF2', false, ['deriveKey']);
              const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 400000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
              const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
              const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
              await db.setSetting('vault', { v: 1, kdf: 'PBKDF2-SHA256', iter: 400000, salt: V.b64(salt), iv: V.b64(iv), wrapped: V.b64(new Uint8Array(wrapped)), createdAt: Date.now(), bio: null });
              await V.lock({ hard: true });
              out.unlockLegacy = await V.unlock('alt-pin-1');
              await new Promise(r => setTimeout(r, 2500));
              out.upgraded = (await V.getHeader()).iter;
              await V.lock({ hard: true });
              out.unlockAfter = await V.unlock('alt-pin-1');
              out.wrongPin = await V.unlock('falsch');
              await V.destroyVault().catch(() => {});
              // sync: a server-supplied record with too few PBKDF2 rounds is refused
              const K = await import('./js/sync/crypto.js');
              const keys = await K.createKeys('user-1', 'sync-passwort-1');
              out.syncIter = keys.record.kdf.iter;
              const weak = { ...keys.record, kdf: { ...keys.record.kdf, iter: 1000 } };
              try { await K.unwrapMaster('user-1', weak, { password: 'sync-passwort-1' }); out.weak = 'accepted'; } catch (e) { out.weak = e.code; }
              try { const mk = await K.unwrapMaster('user-1', keys.record, { password: 'sync-passwort-1' }); out.good = mk.length; mk.fill(0); } catch (e) { out.good = e.code; }
              return out;
            }""")
            check('vault: PBKDF2-SHA256 with 600 000 rounds for new vaults', r['iterations'] == 600000 and r['newHeader'] == 600000, r)
            check('vault: legacy 400 000-round vault unlocks and is upgraded to 600 000', r['unlockLegacy'] and r['upgraded'] == 600000 and r['unlockAfter'], r)
            check('vault: wrong PIN still refused', r['wrongPin'] is False, r)
            check('sync: keys created with 600 000 rounds', r['syncIter'] == 600000, r)
            check('sync: manipulated KDF record (1 000 rounds) refused', r['weak'] == 'format', r)
            check('sync: genuine record still unlocks', r['good'] == 32, r)
        step('KDF hardening (vault, sync)', kdf)

        v = page.evaluate('window.__viol')
        # the probes above trigger violations on purpose (marker __tt, evil.example, inline script / javascript: URL);
        # anything else would be the app itself doing something the policy forbids
        own = [x for x in v if not ('__tt' in x or 'evil.example' in x or x.startswith('script-src-elem inline'))]
        check('no CSP/Trusted-Types violation by the app itself during the run', not own, own)
        violations.extend(v)
        ctx.close()

        # ------------------------------------------------------------------ AI output (mock provider echoes input)
        def ai_output():
            c2 = new_ctx(browser, "try { localStorage.setItem('fale-ai-consent', JSON.stringify({ v: 1, at: Date.now(), provider: 'mock' })); } catch (e) {}")
            pg = c2.new_page(); attach(pg, 'ai')
            pg.goto(AI_URL); pg.wait_for_timeout(1200)
            pg.request.get(AI_URL + '__test/reset')
            goto(pg, '#/ki/uebersetzen', 1500)
            pg.locator('[data-src="text"]').click()
            payload = 'Hallo <img src=x data-pwn=1501 onerror=window.__pwned=1501> **<b data-pwn=1502>fett</b>** [S. 1] <script>window.__pwned=1503</script>\n\n- <a href="javascript:window.__pwned=1504">x</a>'
            pg.fill('.ai-paste textarea', payload)
            pg.locator('[data-go]').click()
            pg.wait_for_function("() => (document.querySelector('[data-out]') || {}).innerText && document.querySelector('[data-out]').innerText.includes('[EN]') && !document.querySelector('[data-go]').disabled", timeout=15000)
            out = pg.locator('[data-out]').inner_text()
            check('AI output with HTML/markdown injection is shown as text', '<img src=x data-pwn=1501' in out, out[:200])
            clean(pg, 'AI translation result')
            r = pg.evaluate("""async () => {
              const ui = await import('./js/ai/ui.js');
              const d = document.createElement('div');
              d.innerHTML = ui.richText('## <img src=x data-pwn=1505 onerror=window.__pwned=1505>\\n- **<svg data-pwn=1506 onload=window.__pwned=1506>**\\n[S. 3] <a href=javascript:alert(1)>x</a>');
              document.body.appendChild(d);
              return d.innerHTML;
            }""")
            clean(pg, 'AI markdown renderer (richText)')
            check('AI citations still become buttons', 'class="ai-cite"' in r, r[:200])
            c2.close()
        step('AI output injection', ai_output)

        # ------------------------------------------------------------------ share metadata (attacker = sender of the link)
        def share_meta():
            c3 = new_ctx(browser)
            pg = c3.new_page(); attach(pg, 'share-sender')
            pg.goto(SHARE_URL); pg.wait_for_timeout(1200)
            pg.request.get(SHARE_URL + '__test/reset')
            link = pg.evaluate("""async () => {
              const api = await import('./js/share/api.js'); const C = await import('./js/share/crypto.js');
              const L = C.newLinkKey(); const ck = await C.contentKey(L, null, '');
              const pl = '<img src=x data-pwn=1601 onerror=window.__pwned=1601>';
              const meta = { name: pl + '.pdf', type: 'text/html', size: '<b data-pwn=1602>', created: pl, message: pl, from: pl };
              const up = await api.uploadEncrypted(new Blob(['<html><script>parent.__pwned=1603</script></html>']), { ck, meta,
                announce: x => api.shareApi.create({ kind: 'file', ...x, expiresIn: 3600, maxDownloads: null }) });
              await api.shareApi.finish(up.id, up.auth);
              return '#/s/' + up.id + '#k=' + C.b64u.enc(L);
            }""")
            c3.close()
            c4 = new_ctx(browser)
            rp = c4.new_page(); attach(rp, 'share-recipient')
            rp.goto(SHARE_URL + link); rp.wait_for_timeout(3000)
            check('recipient sees the attacker-chosen name as text', '<img src=x data-pwn=1601' in rp.locator('body').inner_text(), rp.locator('body').inner_text()[:300])
            clean(rp, 'share recipient page (malicious metadata)')
            c4.close()
        step('share metadata injection', share_meta)

        browser.close()


run()
print('\n==== SUMMARY ====')
passed = sum(1 for r in results if r[1])
print(f'{passed}/{len(results)} passed')
for r in results:
    if not r[1]:
        print('FAILED:', r[0], r[2][:300] if isinstance(r[2], str) else r[2])
print('\n==== CONSOLE errors / native dialogs ====')
for x in problems[:60]:
    print(x)
print('\n==== CSP / TT violations ====')
for x in violations[:40]:
    print(x)
sys.exit(0 if passed == len(results) else 1)
