"""Formular-Lotse (js/forms/lotse.js) end to end, on a phone and on a desktop, against the local harness
   node tests/suites/ai_harness.mjs 8799   (static app + /api/* with the mock AI provider)
- start screen: facts, no sideways scrolling; one question per screen with the picture of the form drawn
- labels printed next to fields named Text1, Text2 … are found and explained; profile values pre-filled
- date typed short → the form's format; impossible date / bad e-mail / bad IBAN stop „Weiter“; empty fields may be skipped
- check boxes in a row = one question, radio group and dropdown as big buttons (no „Bitte wählen“)
- leaving and coming back: „Weitermachen“ at the same question with the answers
- overview → „Ins Formular eintragen“ → the new PDF has exactly these values in its own fields, the draft is gone
- unknown label explained by the (mock) cloud AI only after consent; only labels are sent, answers translated on request
- English UI: terms and explanations translated, the label as printed shown untouched
- viewer: „Formular erkannt“ banner + menu entry; a PDF without fields offers „Felder finden“
- every step answers quickly (no freeze), no console errors"""
import os, base64, json, time, traceback, re
from playwright.sync_api import sync_playwright

URL = os.environ.get('LOTSE_URL', 'http://127.0.0.1:8799/')
SUITES = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SUITES, 'out_lotse')
os.makedirs(OUT, exist_ok=True)
PDF = os.path.join(SUITES, 'lotse', 'wohngeld.pdf')
if not os.path.exists(PDF):  # test PDFs are not in git – generated from lotse/gen.py
    import subprocess, sys
    subprocess.run([sys.executable, os.path.join(SUITES, 'lotse', 'gen.py')], check=True)
PLAIN = os.path.join(SUITES, 'formcheck', 'antrag.pdf')
results, problems, sent = [], [], []
SLOW_MS = 2500


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn, page=None):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()
        if page:
            try: page.screenshot(path=os.path.join(OUT, 'fail_' + re.sub(r'\W+', '_', name) + '.png'))
            except Exception: pass


b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
FIELDS = """async (id) => { const lib = await import('./js/library.js'); const { loadPdfLib } = await import('./js/pdflib.js'); const PL = await loadPdfLib();
  const d = await PL.PDFDocument.load(await lib.getDocBytes(id)); const out = {};
  for (const f of d.getForm().getFields()) { const n = f.getName();
    if (f instanceof PL.PDFTextField) out[n] = f.getText() || ''; else if (f instanceof PL.PDFCheckBox) out[n] = f.isChecked();
    else if (f instanceof PL.PDFRadioGroup) out[n] = f.getSelected() || ''; else if (f instanceof PL.PDFDropdown) out[n] = (f.getSelected() || [])[0] || ''; }
  return out; }"""
LENS_INK = """() => { const c = document.querySelector('.lotse-lens canvas'); if (!c || !c.width) return 0; const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 2] > 140 && d[i] < 90 && d[i + 1] < 90) n++; return n; }"""


def ctx_page(browser, label, lang='de', **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script(f"try {{ localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-lang', '{lang}'); }} catch (e) {{}}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.on('request', lambda r: sent.append((label, r.url, r.post_data or '')) if '/api/ai' in r.url else None)
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def timed(page, action, sel, name, timeout=15000):
    t0 = time.time()
    action()
    page.wait_for_selector(sel, timeout=timeout)
    ms = (time.time() - t0) * 1000
    if ms > SLOW_MS:
        check(f'responsive: {name} ({int(ms)} ms)', False, ms)
    return ms


def term(page):
    return page.locator('.lotse-term').inner_text().strip()


def go_to(page, text, limit=20):
    for _ in range(limit):
        if term(page) == text:
            return True
        old = page.locator('.lotse-count').inner_text()
        page.click('[data-skip]')
        page.wait_for_function('o => document.querySelector(".lotse-count") && document.querySelector(".lotse-count").textContent !== o', arg=old, timeout=5000)
    return term(page) == text


def run(p):
    browser = p.chromium.launch()

    # ------------------------------------------------------------------ phone, German
    ctx, page = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 640}, is_mobile=True, has_touch=True, device_scale_factor=2)
    st = {}

    def phone():
        page.evaluate("async () => { const m = await import('./js/extras/profile.js'); await m.setProfile({ vorname: 'Edwin', nachname: 'Lehnen', ort: 'Nonnweiler' }); }")
        did = page.evaluate(IMPORT, [b64(PDF), 'Mietzuschuss.pdf'])
        st['did'] = did
        timed(page, lambda: page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={did}'"), '.lotse-start [data-go], .lotse-foot [data-go]', 'open the Lotse', 30000)
        page.wait_for_timeout(500)
        facts = page.locator('.lotse-facts').inner_text()
        check('start: question count, required fields, minutes', '16' in facts and 'Fragen' in facts and 'Pflichtfelder' in facts and 'Minuten' in facts, facts)
        check('start: no sideways scrolling on 360 px', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".lotse-scroll").scrollWidth <= document.querySelector(".lotse-scroll").clientWidth + 1'))
        check('start: a label nobody knows offers the AI', page.locator('[data-ai-card]').count() == 1 and 'nicht auswendig' in page.locator('[data-ai-card]').inner_text())
        check('start: privacy line', 'bleiben auf diesem Gerät' in page.locator('.lotse-privacy').inner_text())
        page.screenshot(path=os.path.join(OUT, 'phone_start.png'))
        timed(page, lambda: page.click('[data-go]'), '.lotse-term', 'first question')
        page.wait_for_timeout(700)
        check('q1: „Text1“ is asked as „Familienname“ (label printed next to it)', term(page) == 'Familienname', term(page))
        check('q1: required + explanation + progress', page.locator('.lotse-req').count() == 1 and 'Ausweis' in page.locator('.lotse-explain').inner_text() and 'Frage 1 von 16' in page.locator('.lotse-count').inner_text())
        check('q1: profile surname pre-filled and marked', page.input_value('.lotse-field') == 'Lehnen' and page.locator('.lotse-from').count() == 1, page.input_value('.lotse-field'))
        check('q1: the picture of the form is drawn with the field highlighted', page.evaluate(LENS_INK) > 50, page.evaluate(LENS_INK))
        page.fill('.lotse-field', 'Lehnen-Test')
        page.screenshot(path=os.path.join(OUT, 'phone_q1.png'))
        foot = page.evaluate("(() => { const f = document.querySelector('.lotse-foot').getBoundingClientRect(); return { top: f.top, bottom: f.bottom, h: innerHeight }; })()")
        check('q1: the buttons stay on screen (one row on a phone)', foot['bottom'] <= foot['h'] + 1 and foot['bottom'] - foot['top'] < 100, foot)
        timed(page, lambda: page.click('[data-next]'), 'text=Frage 2 von 16', 'next question')
        check('q2: Vorname from the profile', term(page) == 'Vorname' and page.input_value('.lotse-field') == 'Edwin')
        page.click('[data-next]'); page.wait_for_selector('text=Frage 3 von 16')
        check('q3: Geburtsdatum with example and calendar button', term(page) == 'Geburtsdatum' and page.locator('[data-cal]').count() == 1 and '12.03.1961' in page.locator('.lotse-ex').inner_text())
        page.fill('.lotse-field', '31.02.1961')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('q3: an impossible date stops „Weiter“ with a message', 'Frage 3 von 16' in page.locator('.lotse-count').inner_text() and not page.locator('[data-msg]').is_hidden(), page.locator('[data-msg]').inner_text())
        page.fill('.lotse-field', '12.3.61')
        page.locator('.lotse-field').blur(); page.wait_for_timeout(200)
        check('q3: a short date becomes the form\'s format', page.input_value('.lotse-field') == '12.03.1961', page.input_value('.lotse-field'))
        page.click('[data-next]'); page.wait_for_selector('text=Frage 4 von 16')
        check('q4: Staatsangehörigkeit', term(page) == 'Staatsangehörigkeit')
        page.fill('.lotse-field', 'deutsch')
        go_to(page, 'E-Mail-Adresse')
        page.fill('.lotse-field', 'edwin@beispiel')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('e-mail: incomplete address is stopped', term(page) == 'E-Mail-Adresse' and 'E-Mail' in page.locator('[data-msg]').inner_text(), page.locator('[data-msg]').inner_text())
        page.fill('.lotse-field', '')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('e-mail: an empty optional field may be skipped', term(page) != 'E-Mail-Adresse', term(page))
        check('IBAN: next question', term(page) == 'IBAN (Kontonummer)', term(page))
        page.fill('.lotse-field', 'DE89 3704 0044 0532 0130 01')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('IBAN: a typo (check digits) is stopped', term(page) == 'IBAN (Kontonummer)' and 'IBAN' in page.locator('[data-msg]').inner_text())
        page.fill('.lotse-field', 'DE89 3704 0044 0532 0130 00')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('unknown label: asked with the printed text and an AI button', term(page) == 'Mietstufe der Gemeinde' and page.locator('.lotse-whatis').count() == 1, term(page))
        page.click('[data-skip]'); page.wait_for_timeout(400)
        check('check boxes in a row are one question „Familienstand“ with 4 choices', term(page) == 'Familienstand' and page.locator('.lotse-opt').count() == 4, (term(page), page.locator('.lotse-opt').count()))
        before = page.evaluate(LENS_INK)
        page.locator('.lotse-opt', has_text='verheiratet').click(); page.wait_for_timeout(400)
        check('choice: pressed state + cross drawn in the picture', page.locator('.lotse-opt[aria-pressed="true"]').count() == 1 and page.evaluate(LENS_INK) != before)
        page.screenshot(path=os.path.join(OUT, 'phone_checks.png'))
        page.click('[data-next]'); page.wait_for_timeout(400)
        check('radio group „Geschlecht“ with the words from the page', term(page) == 'Geschlecht' and page.locator('.lotse-optlab', has_text='weiblich').count() == 1, term(page))
        page.locator('.lotse-opt', has_text='weiblich').click()
        page.click('[data-next]'); page.wait_for_timeout(400)
        labs = page.locator('.lotse-optlab').all_inner_texts()
        check('dropdown „Bundesland“ as buttons without „Bitte wählen“', term(page) == 'Bundesland' and 'Saarland' in labs and not any('Bitte' in x for x in labs), labs)
        page.locator('.lotse-opt', has_text='Saarland').click()
        # leave in the middle and come back
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(600)
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={did}'")
        page.wait_for_selector('[data-new]', timeout=20000)
        check('come back: „Weitermachen“ and „Neu beginnen“', page.locator('[data-go]').inner_text().strip().endswith('Weitermachen'))
        page.click('[data-go]'); page.wait_for_selector('.lotse-term')
        check('come back: same question, answer kept', term(page) == 'Bundesland' and page.locator('.lotse-opt[aria-checked="true"]', has_text='Saarland').count() == 1, term(page))
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('Kassenzeichen from the tooltip, explained', term(page) == 'Kassenzeichen' and 'Bescheid' in page.locator('.lotse-explain').inner_text())
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('multi-line field with its label above', term(page) == 'Begründung' and page.locator('textarea.lotse-field').count() == 1)
        page.fill('textarea.lotse-field', 'Die Miete ist gestiegen.\nIch bitte um Prüfung.')
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('consent sentence as yes/no', term(page) == 'Erklärung zur Richtigkeit' and page.locator('.lotse-yesno .lotse-opt').count() == 2, term(page))
        page.locator('.lotse-opt[data-v="1"]').click()
        page.click('[data-next]'); page.wait_for_timeout(300)
        check('page 2: Ort, Datum with a quick answer', term(page) == 'Ort, Datum' and page.locator('[data-placedate]').count() == 1)
        page.click('[data-placedate]')
        val = page.input_value('.lotse-field')
        check('Ort, Datum: place from the profile + today', re.match(r'^Nonnweiler, \d{2}\.\d{2}\.\d{4}$', val), val)
        timed(page, lambda: page.click('[data-next]'), '.lotse-sum', 'overview')
        page.wait_for_timeout(300)
        rows = page.locator('.lotse-sumrow').count()
        check('overview: every question listed', rows == 16, rows)
        check('overview: nothing required is missing', page.locator('.lotse-warn').count() == 0, page.locator('.lotse-warn').all_inner_texts())
        page.screenshot(path=os.path.join(OUT, 'phone_overview.png'), full_page=True)
        page.locator('.lotse-sumrow button', has_text='Staatsangehörigkeit').click()
        page.wait_for_selector('.lotse-term')
        check('overview: a tap opens that question', term(page) == 'Staatsangehörigkeit' and page.input_value('.lotse-field') == 'deutsch')
        page.click('[data-ov]'); page.wait_for_selector('.lotse-sum')
        timed(page, lambda: page.click('[data-write]'), '.lotse-done', 'write the form')
        page.wait_for_timeout(300)
        check('done: sign next (form has a signature field)', page.locator('.lotse-done a', has_text='Jetzt unterschreiben').count() == 1 and 'Unterschrift' in page.locator('.lotse-done').inner_text())
        page.screenshot(path=os.path.join(OUT, 'phone_done.png'))
        new_id = page.evaluate("(() => { const a = document.querySelector('.lotse-done a[href*=\"ansicht\"]'); return a && a.getAttribute('href').split('/').pop(); })()")
        vals = page.evaluate(FIELDS, new_id)
        check('PDF: text fields', vals.get('Text1') == 'Lehnen-Test' and vals.get('Text2') == 'Edwin' and vals.get('Text3') == '12.03.1961' and vals.get('Text4') == 'deutsch' and vals.get('Text8') == 'DE89 3704 0044 0532 0130 00', vals)
        check('PDF: empty fields stay empty', vals.get('Text7') == '' and vals.get('Text9') == '' and vals.get('Text5') == '', vals)
        check('PDF: check boxes, radio group, dropdown', vals.get('Check2') is True and vals.get('Check1') is False and vals.get('Check9') is True and vals.get('Gruppe1') == 'Auswahl2' and vals.get('Kombinationsfeld1') == 'Saarland', vals)
        check('PDF: multi-line text and place/date', 'gestiegen' in vals.get('Text20', '') and vals.get('Text30', '').startswith('Nonnweiler, '), vals)
        check('PDF: the original stays unchanged', page.evaluate(FIELDS, did).get('Text1') == '')
        check('draft removed after writing', page.evaluate(f"localStorage.getItem('fale-lotse:{did}')") is None)
        names = page.evaluate("async () => (await (await import('./js/db.js')).listDocs()).map(d => d.name)")
        check('saved as „… (ausgefüllt).pdf“', 'Mietzuschuss (ausgefüllt).pdf' in names, names)
        page.click('.lotse-done a[href*="unterschreiben"]')
        page.wait_for_selector('.sign-page canvas', timeout=30000)
        check('sign tool opens with the filled form', page.locator('.form-panel').count() == 1)
    step('phone', phone, page)
    ctx.close()

    # ------------------------------------------------------------------ desktop: AI help, translations, keyboard, viewer
    ctx, page = ctx_page(browser, 'desktop-en', lang='en', viewport={'width': 1280, 'height': 860})

    def desktop():
        did = page.evaluate(IMPORT, [b64(PDF), 'Mietzuschuss.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={did}'")
        page.wait_for_selector('.lotse-start', timeout=30000)
        page.wait_for_timeout(500)
        txt = page.locator('.lotse-start').inner_text()
        check('EN: start screen translated, languages named', "I'll guide you through this form" in txt and 'Deutsch' in txt and 'English' in txt, txt[:300])
        page.click('[data-go]'); page.wait_for_selector('.lotse-term'); page.wait_for_timeout(500)
        check('EN: term translated, the printed label shown as it is', term(page) == 'Surname' and 'Familienname' in page.locator('.lotse-orig q').inner_text() and 'In the form' in page.locator('.lotse-orig').inner_text(), (term(page), page.locator('.lotse-orig').inner_text()))
        check('EN: explanation translated', 'ID' in page.locator('.lotse-explain').inner_text() and 'Ausweis' not in page.locator('.lotse-explain').inner_text())
        check('desktop: the input has the focus', page.evaluate("document.activeElement && document.activeElement.classList.contains('lotse-field')"))
        page.keyboard.type('Kowalenko')
        page.keyboard.press('Enter'); page.wait_for_timeout(300)
        check('desktop: Enter goes to the next question', 'Question 2 of 16' in page.locator('.lotse-count').inner_text(), page.locator('.lotse-count').inner_text())
        check('desktop: the picture of the form and the question side by side', page.evaluate("(() => { const a = document.querySelector('.lotse-lens').getBoundingClientRect(), b = document.querySelector('.lotse-ask').getBoundingClientRect(); return b.left >= a.right - 1; })()"))
        go_to(page, 'Nationality')
        check('EN: hint that answers can be translated later', page.locator('.lotse-hint', has_text='translate').count() == 1)
        page.fill('.lotse-field', 'ukrainisch')
        go_to(page, 'Mietstufe der Gemeinde')
        # unknown label → AI (consent first, only labels are sent)
        n0 = len(sent)
        page.click('.lotse-whatis')
        page.wait_for_selector('dialog[open] .lotse-send')
        sendlist = page.locator('dialog[open] .lotse-send').inner_text()
        check('AI: the dialog lists exactly the labels that will be sent', 'Mietstufe der Gemeinde' in sendlist and 'Kowalenko' not in sendlist, sendlist)
        page.locator('dialog[open] button', has_text='Send & explain').click()
        page.wait_for_selector('dialog[open] .ai-consent', timeout=8000)
        page.locator('dialog[open] button', has_text='Agree').click()
        page.wait_for_selector('.lotse-aibadge', timeout=15000)
        page.wait_for_timeout(300)
        body = ' '.join(x[2] for x in sent[n0:])
        check('AI: request has the label, not the answers or the file name', 'Mietstufe der Gemeinde' in body and 'Kowalenko' not in body and 'ukrainisch' not in body and 'Mietzuschuss' not in body and '"task":"form_help"' in body.replace(' ', ''), body[:400])
        check('AI: term and explanation from the AI, marked as AI', '[Englisch] Mietstufe der Gemeinde' in term(page) and 'Test-Erklärung' in page.locator('.lotse-explain').inner_text(), term(page))
        cache = page.evaluate("localStorage.getItem('fale-lotse-help')") or ''
        check('AI: explanation cached on the device for the next form (labels only)', 'Mietstufe' in cache and 'Kowalenko' not in cache)
        go_to(page, 'Reason')
        page.fill('textarea.lotse-field', 'Моя квартира стала дорожчою.')
        page.click('[data-ov]'); page.wait_for_selector('.lotse-sum')
        check('overview: answers in another language offered for translation', page.locator('[data-tr]').count() == 1)
        n1 = len(sent)
        page.click('[data-tr]')
        page.wait_for_selector('dialog[open] .lotse-send')
        lst = page.locator('dialog[open] .lotse-send').inner_text()
        check('translate: dialog shows the answers that will be sent', 'ukrainisch' in lst and 'дорожчою' in lst and 'Kowalenko' not in lst, lst)
        page.locator('dialog[open] button', has_text='Send & translate').click()
        page.wait_for_selector('.lotse-badge', timeout=15000)
        body = ' '.join(x[2] for x in sent[n1:])
        check('translate: only free-text answers sent (no names, no IBAN)', 'form_answers' in body and 'Kowalenko' not in body and '"target":"de"' in body.replace(' ', ''), body[:300])
        check('translate: answers replaced, original shown, undo possible', page.locator('.lotse-badge').count() == 2 and page.locator('[data-undo]').count() == 2 and '[DE] ukrainisch' in page.locator('.lotse-sum').inner_text())
        page.locator('[data-undo]').first.click(); page.wait_for_timeout(300)
        check('translate: undo brings the original back', page.locator('.lotse-badge').count() == 1 and 'ukrainisch' in page.locator('.lotse-sum').inner_text())
        page.screenshot(path=os.path.join(OUT, 'desktop_overview_en.png'), full_page=True)
        # viewer: banner + menu entry
        page.evaluate(f"location.hash = '#/ansicht/{did}'")
        page.wait_for_selector('.lotse-banner', timeout=20000)
        check('viewer: „form detected“ banner', 'Form Guide' in page.locator('.lotse-banner').inner_text(), page.locator('.lotse-banner').inner_text())
        page.locator('[data-v="more"]').click(); page.wait_for_selector('.menu-layer.open .menu-item')
        check('viewer: menu entry', page.locator('.menu-layer .menu-item', has_text='Form Guide').count() == 1)
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        page.click('[data-lotse-x]'); page.wait_for_timeout(200)
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(500)
        page.evaluate(f"location.hash = '#/ansicht/{did}'"); page.wait_for_selector('.pdfViewer .page canvas', timeout=20000); page.wait_for_timeout(1500)
        check('viewer: a closed banner stays closed for this file', page.locator('.lotse-banner').count() == 0)
        # PDF without fields
        raw = page.evaluate("async () => { const { loadPdfLib } = await import('./js/pdflib.js'); const PL = await loadPdfLib(); const d = await PL.PDFDocument.create(); const p = d.addPage([595, 842]); p.drawText('Nur Text', { x: 50, y: 780 }); return Array.from(await d.save()); }")
        pid = page.evaluate(IMPORT, [base64.b64encode(bytes(raw)).decode(), 'Leer.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={pid}'")
        page.wait_for_selector('[data-pf]', timeout=20000)
        check('no fields: „Felder finden“ offered', 'no fields yet' in page.locator('.lotse-start').inner_text())
    step('desktop', desktop, page)
    ctx.close()
    # ------------------------------------------------------------------ robustness: XFA, paper form, big form, real English form
    ctx, page = ctx_page(browser, 'robust', viewport={'width': 1100, 'height': 800})

    def robust():
        X = os.path.join(SUITES, 'xfadata')
        xid = page.evaluate(IMPORT, [b64(os.path.join(X, 'xfa_pure.pdf')), 'XFA.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={xid}'")
        page.wait_for_selector('.xfa-info', timeout=20000)
        check('XFA-only form: sent to the form screen', page.locator('.xfa-info a[href*="behoerdenformular"]').count() == 1)
        hid = page.evaluate(IMPORT, [b64(os.path.join(X, 'xfa_hybrid.pdf')), 'Hybrid.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={hid}'")
        page.wait_for_selector('.lotse-start [data-go], .lotse-foot [data-go]', timeout=20000)
        check('XFA hybrid form: fields read', int(page.locator('.lotse-facts b').first.inner_text()) > 0)
        # paper form without fields → „Felder finden“ → the Lotse on the fillable copy
        fid = page.evaluate(IMPORT, [b64(os.path.join(SUITES, 'paperform', 'flat_form.pdf')), 'Papier.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={fid}'")
        page.wait_for_selector('[data-pf]', timeout=20000)
        t0 = time.time()
        page.click('[data-pf]')
        page.wait_for_selector('.lotse-facts', timeout=60000)
        n = int(page.locator('.lotse-facts b').first.inner_text())
        check(f'paper form: fields found, the Lotse continues on the fillable copy ({n} questions, {time.time() - t0:.1f} s)', n >= 5 and 'Papier (ausfüllbar).pdf' in page.locator('.screen-head .sub').inner_text(), n)
        page.click('[data-go]'); page.wait_for_selector('.lotse-term')
        check('paper form: first question has a real label', len(term(page)) > 2 and not term(page).startswith('Feld auf Seite'), term(page))
        # a big form: 8 pages × 45 fields
        raw = page.evaluate("""async () => { const { loadPdfLib } = await import('./js/pdflib.js'); const PL = await loadPdfLib(); const d = await PL.PDFDocument.create();
          const f = d.getForm(); const font = await d.embedFont(PL.StandardFonts.Helvetica);
          for (let pg = 0; pg < 8; pg++) { const p = d.addPage([595, 842]);
            for (let i = 0; i < 45; i++) { const y = 800 - i * 17.5; p.drawText(['Vorname', 'Familienname', 'Geburtsdatum', 'Straße', 'Beruf', 'Bemerkungen', 'Telefon'][i % 7] + ':', { x: 40, y: y + 3, size: 8, font });
              const t = f.createTextField(`p${pg}.f${i}`); t.addToPage(p, { x: 160, y, width: 380, height: 14 }); } }
          return Array.from(await d.save()); }""")
        bid = page.evaluate(IMPORT, [base64.b64encode(bytes(raw)).decode(), 'Gross.pdf'])
        t0 = time.time()
        page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={bid}'")
        page.wait_for_selector('.lotse-facts', timeout=30000)
        ms = (time.time() - t0) * 1000
        check(f'big form (360 fields): ready in {int(ms)} ms', ms < 8000 and page.locator('.lotse-facts b').first.inner_text() == '360', page.locator('.lotse-facts b').first.inner_text())
        page.click('[data-go]'); page.wait_for_selector('.lotse-term')
        worst = 0
        for i in range(40):
            t0 = time.time()
            page.keyboard.press('Enter')
            page.wait_for_function('n => document.querySelector(".lotse-count") && document.querySelector(".lotse-count").textContent.includes("Frage " + n + " ")', arg=i + 2, timeout=5000)
            worst = max(worst, (time.time() - t0) * 1000)
        check(f'big form: 40 questions in a row, slowest step {int(worst)} ms (no freeze)', worst < 1500, worst)
        check('big form: page 2 picture drawn', page.evaluate(LENS_INK) > 20)
        t0 = time.time()
        page.click('[data-ov]'); page.wait_for_selector('.lotse-sum')
        check(f'big form: overview of 360 rows in {int((time.time() - t0) * 1000)} ms', page.locator('.lotse-sumrow').count() == 360 and (time.time() - t0) < 3)
        # a real English authority form (third-party, not in the repository – only when present locally)
        real = os.path.join(X, 'real_imm5257e.pdf')
        if os.path.exists(real):
            rid = page.evaluate(IMPORT, [b64(real), 'IMM.pdf'])
            page.evaluate(f"location.hash = '#/werkzeug/formular-lotse?doc={rid}'")
            page.wait_for_selector('.lotse-start, .xfa-info', timeout=30000)
            if page.locator('.lotse-facts').count():
                page.click('[data-go]'); page.wait_for_selector('.lotse-term')
                labels = []
                for _ in range(25):
                    labels.append(term(page))
                    page.click('[data-skip]'); page.wait_for_timeout(120)
                known = sum(1 for l in labels if not l.startswith('Feld auf Seite'))
                print('   IMM 5257 first labels:', labels[:25])
                check(f'real English form: labels found for most fields ({known}/25)', known >= 18, labels)
    step('robust', robust, page)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:6])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])
