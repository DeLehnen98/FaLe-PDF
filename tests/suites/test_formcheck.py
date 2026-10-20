"""„Prüfen vor dem Speichern“ (js/tools/formcheck.js + js/tools/sign.js) with formcheck/antrag.pdf.
- Pflichtfelder (PDF flag) get a „Pflichtfeld“ tag; leaving a field with a wrong entry shows a message under it
  (date that does not exist, IBAN with a typo, incomplete e-mail, text in a number field, wrong date format) – it
  disappears as soon as the entry is right; „Saarbrücken, 20.10.2026“ in „Ort, Datum“ is fine
- Speichern with problems: list „Bitte n Felder prüfen“, a tap on an entry jumps to the field (focused);
  „Trotzdem speichern“ saves anyway; everything right → saves without asking
- Handy 360 px: the list fits, big buttons; no console errors
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, base64, re, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(SUITES, 'formcheck', 'antrag.pdf')
OUT = os.path.join(SUITES, 'out_formcheck')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => f.name)"
B64 = base64.b64encode(open(PDF, 'rb').read()).decode()


def open_sign(page, name):
    did = page.evaluate(IMPORT, [B64, name])
    page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_timeout(300)
    page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
    page.wait_for_selector('.sign-page canvas', timeout=20000)
    page.wait_for_timeout(800)


def fld(page, name):
    """The panel input of a field by its PDF name."""
    i = page.evaluate("""(n) => { const labels = [...document.querySelectorAll('.form-panel [data-ff]')];
      const el = labels.find(l => (l.querySelector('.field-label, .check span') || {}).textContent.trim().startsWith(n)); return el ? el.dataset.ff : null; }""", name)
    return page.locator(f'.form-panel [data-fi="{i}"]'), page.locator(f'.form-panel [data-ff="{i}"] .ff-msg')


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def run(p):
    browser = p.chromium.launch()
    ctx, page = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 900})

    def live():
        open_sign(page, 'Antrag.pdf')
        tags = page.locator('.form-panel .ff-req')
        check('Pflichtfelder marked (Name, IBAN, Einwilligung)', tags.count() == 3, tags.count())
        gd, gdm = fld(page, 'geburtsdatum')
        gd.fill('31.02.1990'); page.locator('.form-panel h2').click(); page.wait_for_timeout(300)
        check('leaving the field: „Dieses Datum gibt es nicht“ under it', gdm.is_visible() and 'gibt es nicht' in gdm.inner_text() and gd.get_attribute('aria-invalid') == 'true')
        page.screenshot(path=os.path.join(OUT, 'field_msg.png'))
        gd.fill('28.02.1990'); page.wait_for_timeout(200)
        check('… disappears while correcting it', gdm.is_hidden() and gd.get_attribute('aria-invalid') is None)
        nm, nmm = fld(page, 'name')
        nm.fill('Erika'); page.wait_for_timeout(100)
        check('no message while typing in a field without a problem', nmm.is_hidden())
        tm, tmm = fld(page, 'termin')
        tm.fill('2026'); page.locator('.form-panel h2').click(); page.wait_for_timeout(200)
        check('date field with the PDF\'s own format: example shown', tmm.is_visible() and '24.12.2026' in tmm.inner_text(), tmm.inner_text())
        od, odm = fld(page, 'ort_datum')
        od.fill('Saarbrücken, 20.10.2026'); page.locator('.form-panel h2').click(); page.wait_for_timeout(200)
        check('„Ort, Datum“ with place and date is fine', odm.is_hidden())
        bt, btm = fld(page, 'betrag')
        bt.fill('zwölf Euro'); page.locator('.form-panel h2').click(); page.wait_for_timeout(200)
        check('number field: „nur eine Zahl“', btm.is_visible() and 'Zahl' in btm.inner_text())
        bt.fill('12,50'); page.wait_for_timeout(150)
        check('… 12,50 is a number', btm.is_hidden())
    step('messages while filling in', live)

    def on_save():
        ib, _ = fld(page, 'iban')
        ib.fill('DE89 3704 0044 0532 0130 01')
        em, _ = fld(page, 'email')
        em.fill('erika@web')
        tm, _ = fld(page, 'termin')
        tm.fill('24.12.2026')
        page.locator('[data-save]').click()
        page.wait_for_selector('dialog[open] .ff-list', timeout=5000)
        items = page.locator('dialog[open] .ff-go')
        txt = page.locator('dialog[open]').inner_text()
        check('Speichern: list „Bitte 3 Felder prüfen“ (IBAN, E-Mail, Einwilligung)', items.count() == 3 and 'Bitte 3 Felder prüfen' in txt
              and 'IBAN stimmt nicht' in txt and 'E-Mail-Adresse' in txt and 'ankreuzen' in txt, txt[:400])
        page.screenshot(path=os.path.join(OUT, 'list.png'))
        page.locator('dialog[open] .ff-go', has_text='iban').click()
        page.wait_for_timeout(600)
        check('tap on an entry: dialog closes, the field is focused', page.locator('dialog[open]').count() == 0
              and page.evaluate("document.activeElement && document.activeElement.value") == 'DE89 3704 0044 0532 0130 01')
        check('nothing saved yet', not any('ausgefüllt' in n for n in page.evaluate(FILES)))
        ib.fill('DE89 3704 0044 0532 0130 00')
        em.fill('erika@web.de')
        page.locator('.form-panel input[type=checkbox][data-fi]').check()
        page.locator('[data-save]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        check('everything right: saves without asking', page.locator('dialog[open]').count() == 0 and any(re.search(r'Antrag \(ausgefüllt\)', n) for n in page.evaluate(FILES)))
    step('check on save', on_save)

    def anyway():
        open_sign(page, 'Leer.pdf')
        tm, _ = fld(page, 'termin')
        tm.fill('31.02.2026')
        page.locator('[data-save]').click()
        page.wait_for_selector('dialog[open] .ff-list', timeout=5000)
        check('empty Pflichtfelder + wrong date listed', page.locator('dialog[open] .ff-go').count() == 4, page.locator('dialog[open] .ff-go').count())
        page.locator('dialog[open] button[value="save"]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        check('„Trotzdem speichern“ saves anyway', any(re.search(r'Leer \(ausgefüllt\)', n) for n in page.evaluate(FILES)))
    step('save anyway', anyway)
    ctx.close()

    ctx, page = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True)

    def phone():
        open_sign(page, 'Handy.pdf')
        page.locator('[data-mode="form"]').tap(); page.wait_for_timeout(400)
        tm, _ = fld(page, 'termin')
        tm.fill('31.02.2026')
        page.locator('.form-panel [data-close]').tap(); page.wait_for_timeout(300)
        page.locator('[data-save]').tap()
        page.wait_for_selector('dialog[open] .ff-list', timeout=5000)
        over = page.evaluate('document.documentElement.scrollWidth')
        go = page.locator('dialog[open] .ff-go').first.bounding_box()
        btns = [page.locator(f'dialog[open] button[value="{v}"]').bounding_box() for v in ('save', 'fix')]
        check('phone: list fits, entries and buttons big enough', over <= 361 and go['width'] <= 340 and go['height'] >= 48 and all(b['height'] >= 40 and b['x'] + b['width'] <= 361 for b in btns), (over, go, btns))
        page.screenshot(path=os.path.join(OUT, 'phone_list.png'))
        page.locator('dialog[open] button[value="fix"]').tap(); page.wait_for_timeout(700)
        check('phone: „Felder prüfen“ opens the field list at the first problem', page.locator('.form-panel.open').count() == 1 and page.evaluate("document.activeElement && document.activeElement.dataset.fi != null"))
        page.screenshot(path=os.path.join(OUT, 'phone_field.png'))
    step('phone', phone)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)
