"""Capture real app screens (DE + EN) for the store graphics.
usage: python3 capture.py <lang> <device: phone|tab7|tab10> [shot ...]"""
import sys
from pathlib import Path
from appshot import App, SP
from answers import ANSWERS, QUESTION
import sig

lang, device = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
VIEW = {'phone': (360, 760, 3), 'tab7': (800, 1200, 1.5), 'tab10': (1280, 800, 2)}[device]
OUT = SP / 'raw' / device / lang
OUT.mkdir(parents=True, exist_ok=True)
N = {
    'de': dict(inv='Rechnung_2026-0412.pdf', lease='Mietvertrag_Wohnung.pdf', xl='Haushaltsbuch_2026.xlsx', pp='Projekt_Solarpark.pptx', cv='Lebenslauf_Anna_Berger.docx',
               scanname='Brief Hausverwaltung', q='Heizung', cell='D8'),
    'en': dict(inv='Invoice_2026-0412.pdf', lease='Rental_Agreement.pdf', xl='Monthly_Expenses_2026.xlsx', pp='Solar_Park_Project.pptx', cv='CV_Anna_Berger.docx',
               scanname='Letter from landlord', q='heating', cell='D2'),
}[lang]
W, H, DPR = VIEW


def want(name):
    return not only or name in only


def app(**kw):
    a = App(lang, width=W, height=H, dpr=DPR, answers=ANSWERS[lang], **kw)
    a.seed(); a.clean()
    return a


def done(a, name):
    a.page.wait_for_timeout(300)
    a.shot(OUT / f'{name}.png')
    if a.errors: print(name, 'console errors:', a.errors)
    print('saved', OUT / f'{name}.png')


a = app(camera=str(SP / 'demo' / lang / 'camera.y4m'))
pg = a.page

if want('home'):
    a.go('#/start', 1800)
    done(a, 'home')

if want('files'):
    a.go('#/dateien', 1800)
    done(a, 'files')

if want('sign'):
    a.go(f"#/werkzeug/unterschreiben?doc={a.doc_id(N['lease'])}", 2500)
    pg.click('[data-mode="sign"]'); pg.wait_for_timeout(800)
    c = pg.locator('canvas.sig-pad').bounding_box()
    sig.draw(pg, c['x'] + 14, c['y'] + c['height'] * 0.18, c['width'] - 28, c['height'] * 0.6)
    pg.wait_for_timeout(300)
    pg.locator('.dialog button.btn-primary, dialog button.btn-primary').last.click(); pg.wait_for_timeout(700)
    box = pg.locator('.sign-page').first.bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.73, box['y'] + box['height'] * 0.79); pg.wait_for_timeout(800)
    pg.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.4); pg.wait_for_timeout(400)
    done(a, 'sign')

if want('scan') or want('ocr'):
    a.go('#/werkzeug/scannen', 4000)
    done(a, 'scan')
    pg.click('[data-shoot]'); pg.wait_for_timeout(3000)
    pg.click('[data-done]'); pg.wait_for_timeout(2500)
    pg.locator('#tool-screen input.input').first.fill(N['scanname'])
    pg.locator('#tool-screen button.btn-primary').last.click(); pg.wait_for_timeout(25000)
    did = pg.evaluate("""async () => { const db = await import('./js/db.js'); return (await db.listFiles())[0].id }""")
    a.go(f"#/ansicht/{did}?q={N['q']}", 3500)
    if device == 'phone':
        pg.click('[data-v="zoomval"]'); pg.wait_for_timeout(400)
        pg.locator('.menu-layer [role="menuitem"], .menu-layer button').filter(has_text=__import__('re').compile(r'^\s*50\s?%')).first.click(); pg.wait_for_timeout(1500)
        pg.evaluate("""() => { const hit = document.querySelector('.viewer .highlight.selected, .viewer .highlight'); if (!hit) return; hit.scrollIntoView({block: 'center'}); let sc = hit.parentElement; while (sc && !(sc.scrollWidth > sc.clientWidth + 4 && getComputedStyle(sc).overflowX !== 'visible')) sc = sc.parentElement; if (sc) sc.scrollLeft = 0; }""")
        pg.wait_for_timeout(1200)
    done(a, 'ocr')

if want('ai'):
    a.go(f"#/ki/chat?doc={a.doc_id(N['inv'])}", 2500)
    pg.fill('#ai-q', QUESTION[lang]); pg.click('[data-send]'); pg.wait_for_timeout(3500)
    if lang == 'en':  # the composer placeholder is not translated yet (app bug) – keep it hidden
        pg.fill('#ai-q', 'Can I pay in two instalments?')
    pg.locator('#ai-q').blur()
    done(a, 'ai')

if want('sheet'):
    a.go(f"#/bearbeiten/{a.doc_id(N['xl'])}", 3000)
    cell = pg.locator(f'[data-cell="{N["cell"]}"], td[data-addr="{N["cell"]}"]')
    if cell.count():
        cell.first.click(); pg.wait_for_timeout(400)
    done(a, 'sheet')

if want('slides'):
    a.go(f"#/bearbeiten/{a.doc_id(N['pp'])}", 3000)
    done(a, 'slides')

if want('doc'):
    a.go(f"#/bearbeiten/{a.doc_id(N['cv'])}", 3000)
    done(a, 'doc')

if want('viewer'):
    a.go(f"#/ansicht/{a.doc_id(N['inv'])}", 3000)
    pg.evaluate("() => { const p = document.querySelector('.viewer .pdfViewer'); let sc = p && p.parentElement; while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement; if (sc) sc.scrollTop = 150; }")
    pg.wait_for_timeout(800)
    done(a, 'viewer')

if want('letters') and lang == 'de':
    a.go('#/schreiben', 2000)
    done(a, 'letters')

if want('tools'):
    a.go('#/werkzeuge', 1800)
    done(a, 'tools')

if want('reminders'):
    R = {'de': [('Rechnung Malerbetrieb bezahlen', 'termin', '2026-10-16'), ('Kfz-Versicherung wechseln', 'kuendigung', '2026-11-30'), ('Fitnessstudio kündigen', 'kuendigung', '2026-12-31'), ('Reisepass läuft ab', 'ablauf', '2027-03-02')],
         'en': [('Pay painter invoice', 'termin', '2026-10-16'), ('Return online order (withdrawal period)', 'kuendigung', '2026-10-19'), ('Cancel gym membership', 'kuendigung', '2026-10-23'), ('Car inspection due', 'termin', '2026-10-27')]}[lang]  # EN: < 14 days only ('in N weeks/months' is not translated yet)
    inv = a.doc_id(N['inv'])
    for i, (t, ty, d) in enumerate(R):
        pg.evaluate("async ([t, ty, d, doc]) => { const m = await import('./js/extras/reminders.js'); await m.addReminder({ title: t, type: ty, due: d, leads: [30, 7], docId: doc }); }", [t, ty, d, inv if i == 0 else None])
    a.go('#/start', 800); a.go('#/fristen', 2000)
    pg.evaluate("() => { const t = [...document.querySelectorAll('#tool-screen h2, #tool-screen h3, .screen h2')].find(e => /Demnächst|Coming up/.test(e.textContent)); if (t) t.scrollIntoView({block: 'start'}); }"); pg.wait_for_timeout(500)
    done(a, 'reminders')

if want('privacy'):
    a.go('#/start', 1200)
    pg.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())"); pg.wait_for_timeout(700)
    pg.click('[data-next]'); pg.wait_for_timeout(700)
    done(a, 'privacy')

a.close()
