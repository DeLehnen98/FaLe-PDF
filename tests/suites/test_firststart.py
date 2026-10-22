"""Erster Start, Teil 2 (js/extras/onboarding.js) + Hinweis vor der Mitteilungs-Erlaubnis (js/extras/reminders.js).
- Schritt „Unterschreib einmal zum Üben“: Demo-Unterschrift schreibt sich selbst (Animation), verschwindet beim ersten
  Strich; „Weiter“ speichert die Unterschrift (Unterschriften-Ablage) + Meldung; beim nächsten Mal entfällt der Schritt
- Schritt „Was möchtest du zuerst tun?“: vier große Knöpfe (animiert) – „Brief schreiben“ → #/schreiben, „Scannen“ →
  #/werkzeug/scannen, „Datei öffnen“ → Dateiauswahl; Aussehen + Profil + Hilfe-Zeile; „Los geht’s“ schließt
- Handy 360 px: alles passt, Knöpfe ≥ 44 px, nichts ragt rechts heraus; Bewegung reduzieren: keine Animation
- App (Android-Nachbildung): erste Frist → kurzer Hinweis „Erinnerungen aufs Handy“, danach fragt das Handy; zweite Frist
  und App-Start/Sync fragen nicht mehr
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_firststart')
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


SIGS = "async () => (await (await import('./js/tools/sigstore.js')).listAssets('signature')).length"
HEAD = "() => document.querySelector('.onboard .ob-step:not([hidden]) h2') && document.querySelector('.onboard .ob-step:not([hidden]) h2').textContent"


def fresh(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarding-force', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('.onboard', timeout=20000)
    return ctx, page


def to_step(page, title):
    for _ in range(8):
        if title in (page.evaluate(HEAD) or ''):
            return True
        page.locator('.onboard [data-next]').click()
        page.wait_for_timeout(350)
    return False


def draw(page):
    b = page.locator('.ob-pad canvas').bounding_box()
    page.mouse.move(b['x'] + 30, b['y'] + b['height'] * 0.6); page.mouse.down()
    for i in range(1, 26):
        page.mouse.move(b['x'] + 30 + i * (b['width'] - 60) / 25, b['y'] + b['height'] * (0.6 - 0.25 * ((i % 5) / 5)))
    page.mouse.up()


def run(p):
    browser = p.chromium.launch()
    ctx, page = fresh(browser, 'desktop', viewport={'width': 1280, 'height': 860})

    def sig():
        check('six steps (dots)', page.locator('.ob-dots span').count() == 6)
        ok = to_step(page, 'Unterschreib einmal zum Üben')
        check('signature practice step after the view choice', ok, page.evaluate(HEAD))
        page.wait_for_timeout(900)
        run_anim = page.evaluate("document.querySelector('.ob-sig-demo path').getAnimations().some(a => a.playState === 'running')")
        check('demo signature writes itself (animation)', run_anim and page.locator('.ob-sig-demo').is_visible())
        page.screenshot(path=os.path.join(OUT, 'sig_demo.png'))
        draw(page)
        page.wait_for_timeout(200)
        check('first stroke: demo disappears', not page.locator('.ob-sig-demo').is_visible())
        page.screenshot(path=os.path.join(OUT, 'sig_drawn.png'))
        page.locator('.onboard [data-next]').click()
        page.wait_for_timeout(700)
        check('„Weiter“ saves the signature for later + message', page.evaluate(SIGS) == 1 and page.locator('.toast', has_text='Unterschrift gespeichert').count() >= 1)
    step('signature practice', sig)

    def goals():
        check('last step: „Was möchtest du zuerst tun?“', 'Was möchtest du zuerst tun?' in (page.evaluate(HEAD) or ''))
        tiles = page.locator('.ob-goal')
        check('four big buttons (animated in), theme, profile, help line', tiles.count() == 4
              and page.evaluate("[...document.querySelectorAll('.ob-goal')].every(e => e.getAnimations().length >= 1 || getComputedStyle(e).opacity === '1')")
              and page.locator('.ob-step-go .ob-theme').count() == 1 and page.locator('.ob-step-go [data-profile]').count() == 1
              and 'Suche' in page.locator('.ob-help').inner_text(), tiles.all_inner_texts())
        check('last button reads „Los geht’s“', page.locator('.onboard [data-next]').inner_text().strip() == 'Los geht’s')
        page.screenshot(path=os.path.join(OUT, 'goals.png'))
        page.locator('.ob-goal', has_text='Brief schreiben').click()
        page.wait_for_timeout(600)
        check('„Brief schreiben“ closes and opens the letters', page.locator('.onboard').count() == 0 and page.evaluate('location.hash') == '#/schreiben'
              and page.evaluate("localStorage.getItem('fale-onboarded')") == '1')
    step('first goal', goals)

    def again():
        page.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
        page.wait_for_selector('.onboard')
        check('next time: signature step left out (one exists), 5 dots', page.locator('.ob-step-sig').count() == 0 and page.locator('.ob-dots span').count() == 5)
        to_step(page, 'Was möchtest du zuerst tun?')
        page.locator('.ob-goal', has_text='Scannen').click()
        page.wait_for_timeout(800)
        check('„Scannen“ opens the scanner', page.evaluate('location.hash').startswith('#/werkzeug/scannen'))
        page.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
        page.wait_for_selector('.onboard'); to_step(page, 'Was möchtest du zuerst tun?')
        with page.expect_file_chooser(timeout=5000) as fc:
            page.locator('.ob-goal', has_text='Datei öffnen').click()
        page.wait_for_timeout(400)
        check('„Datei öffnen“ opens the file choice', fc.value is not None and page.locator('.onboard').count() == 0)
        page.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
        page.wait_for_selector('.onboard'); to_step(page, 'Was möchtest du zuerst tun?')
        page.locator('.onboard [data-next]').click(); page.wait_for_timeout(400)
        check('„Los geht’s“ closes', page.locator('.onboard').count() == 0)
    step('goals + skipped signature step', again)
    ctx.close()

    ctx, page = fresh(browser, 'phone', viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True)

    def phone():
        for title in ('Unterschreib einmal zum Üben', 'Was möchtest du zuerst tun?'):
            to_step(page, title)
            page.wait_for_timeout(500)
            over = page.evaluate('document.documentElement.scrollWidth')
            nb = page.locator('.onboard [data-next]').bounding_box()
            card = page.locator('.ob-card').bounding_box()
            check(f'phone „{title}“: fits, buttons inside the card with a margin', over <= 361 and card['x'] + card['width'] <= 361 and nb['height'] >= 44 and nb['y'] + nb['height'] <= 740
                  and nb['x'] + nb['width'] <= card['x'] + card['width'] - 10, (over, card, nb))
            page.screenshot(path=os.path.join(OUT, f'phone_{title[:12]}.png'))
        g = page.locator('.ob-goal').first.bounding_box()
        check('phone: goal buttons big (≥ 80 px high, two per row)', g['height'] >= 80 and g['width'] >= 140, g)
    step('phone', phone)
    ctx.close()

    ctx, page = fresh(browser, 'reduced', viewport={'width': 1280, 'height': 860}, reduced_motion='reduce')

    def reduced():
        to_step(page, 'Unterschreib einmal zum Üben')
        n = page.evaluate("[...document.querySelectorAll('.ob-sig-demo path, .ob-goal')].reduce((n, e) => n + e.getAnimations().length, 0)")
        check('reduced motion: demo signature shown still, no animation', n == 0 and page.locator('.ob-sig-demo').is_visible(), n)
    step('reduced motion', reduced)
    ctx.close()

    # ---- the app on a phone (Android simulation): explain before the permission prompt, only once
    MOCK = r"""(() => { const calls = []; window.__calls = calls; const rec = (p, m, o) => calls.push({ p, m });
      const addL = () => async () => ({ remove: async () => {} });
      window.__perm = 'prompt';
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', convertFileSrc: x => x, Plugins: {
        LocalNotifications: { checkPermissions: async () => { rec('LN', 'check'); return { display: window.__perm }; },
          requestPermissions: async () => { rec('LN', 'request'); window.__perm = 'granted'; return { display: 'granted' }; },
          schedule: async o => { rec('LN', 'schedule'); return { notifications: o.notifications.map(n => ({ id: n.id })) }; },
          cancel: async () => rec('LN', 'cancel'), addListener: addL() },
        App: { addListener: addL() }, Haptics: { impact: async () => {} },
        FaleIncoming: { takePending: async () => ({ action: 'VIEW', files: [], skipped: [] }), addListener: addL(), setBarColors: async () => {} },
        Filesystem: { stat: async () => { throw new Error('File does not exist'); }, writeFile: async o => ({ uri: 'file:///x/' + o.path }) } } };
      try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {} })();"""
    ctx = browser.new_context(locale='de-DE', viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    page.on('pageerror', lambda e: problems.append(f'native [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start', timeout=30000)
    page.wait_for_timeout(1500)
    calls = lambda m: page.evaluate(f"window.__calls.filter(c => c.m === '{m}').length")

    def notif():
        check('app start: no permission prompt', calls('request') == 0 and page.locator('dialog[open]').count() == 0)
        page.evaluate("import('./js/extras/reminders.js').then(m => { window.__add = m.addReminder({ title: 'Ausweis verlängern', due: '2027-03-01', leads: [7] }); })")
        page.wait_for_selector('dialog[open] .rem-explain', timeout=8000)
        check('first Frist: short note „Erinnerungen aufs Handy“ before the phone asks', 'Zulassen' in page.locator('dialog[open]').inner_text() and calls('request') == 0)
        page.screenshot(path=os.path.join(OUT, 'notif_explain.png'))
        page.locator('dialog[open] .btn-primary').click()
        page.wait_for_timeout(800)
        check('… then the phone asks and the reminder is scheduled', calls('request') == 1 and calls('schedule') >= 1)
        page.evaluate("import('./js/extras/reminders.js').then(m => m.addReminder({ title: 'Kfz-Steuer', due: '2027-04-01', leads: [7] }))")
        page.wait_for_timeout(800)
        check('second Frist: no note, no new question', page.locator('dialog[open]').count() == 0 and calls('request') == 1)
    step('notification note (app)', notif)
    ctx.close()

    ctx = browser.new_context(locale='de-DE', viewport={'width': 390, 'height': 800})
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    page.goto(URL); page.wait_for_selector('#view-start', timeout=30000)

    def startsync():
        page.evaluate("""async () => { const db = await import('./js/db.js'); await db.putReminder({ id: 'x1', title: 'Aus der Synchronisierung', type: 'termin', due: '2027-05-01', leads: [7], done: false, notified: false, createdAt: Date.now() });
          await (await import('./js/extras/reminders.js')).syncNotifications(); }""")
        page.wait_for_timeout(600)
        check('reminders from a sync / at start: no note, no permission prompt', page.locator('dialog[open]').count() == 0
              and page.evaluate("window.__calls.filter(c => c.m === 'request').length") == 0)
    step('no prompt at start / sync', startsync)

    # very first start: the normal start page must never flash up before the intro (js/boot.js ob-first)
    def noflash():
        WATCH = """try { localStorage.setItem('fale-onboarding-force', '1'); } catch (e) {}
          window.__frames = []; (function tick() { const app = document.querySelector('#app'), hero = document.querySelector('#view-start .hero');
            if (app && hero) window.__frames.push({ visible: getComputedStyle(app).visibility !== 'hidden' && !!hero.offsetHeight, ob: !!document.querySelector('.onboard') });
            if (window.__frames.length < 4000) requestAnimationFrame(tick); })();"""
        for label, size in (('phone', {'width': 390, 'height': 844}), ('desktop', {'width': 1280, 'height': 800})):
            c = browser.new_context(locale='de-DE', viewport=size)
            c.add_init_script(WATCH)
            pg = c.new_page()
            pg.goto(URL)
            pg.wait_for_selector('.onboard', timeout=20000)
            pg.wait_for_timeout(300)
            fr = pg.evaluate('window.__frames')
            flash = [f for f in fr if f['visible'] and not f['ob']]
            check(f'{label}: first start shows no start page before the intro', len(fr) > 0 and not flash, (len(fr), flash[:2]))
            bg = pg.evaluate("getComputedStyle(document.querySelector('.onboard')).backgroundImage")
            check(f'{label}: intro covers the app completely on the first start', 'gradient' in bg and pg.evaluate("document.querySelector('.onboard').classList.contains('ob-first-run')"))
            pg.locator('.onboard [data-skip]').click()
            pg.wait_for_timeout(600)
            check(f'{label}: after „Überspringen“ the app is visible', pg.evaluate("!document.documentElement.classList.contains('ob-first') && getComputedStyle(document.querySelector('#app')).visibility !== 'hidden'"))
            pg.reload(); pg.wait_for_selector('#view-start .hero'); pg.wait_for_timeout(500)
            check(f'{label}: second start: no intro, app shown right away', pg.locator('.onboard').count() == 0 and not pg.evaluate("document.documentElement.classList.contains('ob-first')"))
            c.close()
        # a deep link on the first start (shared file, link): no intro, nothing hidden
        c = browser.new_context(locale='de-DE')
        c.add_init_script("try { localStorage.setItem('fale-onboarding-force', '1'); } catch (e) {}")
        pg = c.new_page(); pg.goto(URL + '#/werkzeuge'); pg.wait_for_selector('#view-werkzeuge .tool-card'); pg.wait_for_timeout(800)
        check('deep link on the first start: tools visible, no hidden app', not pg.evaluate("document.documentElement.classList.contains('ob-first')") and pg.locator('#view-werkzeuge .tool-card').first.is_visible())
        c.close()
    step('first start without flash', noflash)
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
