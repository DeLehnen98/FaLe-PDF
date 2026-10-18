"""FaLe PDF app: fair monetisation + review fixes.

- native Plus screen (mocked Capacitor billing): subscriptions + "Für immer" one-time product, fair-billing card,
  lifetime purchase → verified → "gehört dir – für immer", no cancel button / reminder for lifetime
- subscription active → renew date, "Abo verwalten oder kündigen", renewal reminder 3 days ahead (scheduled,
  switch cancels it)
- tips: bought + consumed right away, counter, can be given again
- "KI komplett ausblenden": start card, Werkzeuge section, writer/sheet/slides menu items disappear; cloud AI off;
  hub shows a notice and can re-enable
- crash recovery: unsaved writer text survives a killed page and is restored as a new file; a normal save leaves
  no recovery entry
- English: new strings translated; no freeze (long tasks)

Run: python3 test_app_money.py   (static server: python3 -m http.server 8797 --bind 127.0.0.1 in /home/claude/FalePDF)
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8797/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_money')
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)


NATIVE = r"""
window.__bill = Object.assign({ calls: [], owned: [], subsActive: false }, window.__billInit || {});
const B = window.__bill;
const prices = { fale_plus_monthly: '2,99 €', fale_plus_yearly: '19,99 €', fale_plus_lifetime: '39,99 €', fale_tip_small: '1,99 €', fale_tip_medium: '4,99 €', fale_tip_large: '9,99 €' };
const NativePurchases = {
  isBillingSupported: async () => ({ isBillingSupported: true }),
  getProducts: async o => { B.calls.push(['getProducts', o.productType, o.productIdentifiers.join(',')]);
    return { products: o.productIdentifiers.filter(id => prices[id]).map(id => ({ identifier: id, priceString: prices[id], title: id, planIdentifier: id.includes('yearly') ? 'yearly' : id.includes('monthly') ? 'monthly' : undefined })) }; },
  purchaseProduct: async o => { B.calls.push(['purchase', o.productIdentifier, o.productType]); const tok = 'tok-' + o.productIdentifier + '-' + B.calls.length; B.owned.push({ productIdentifier: o.productIdentifier, purchaseToken: tok, type: o.productType }); return { purchaseToken: tok, productIdentifier: o.productIdentifier, purchaseState: '1' }; },
  consumePurchase: async o => { B.calls.push(['consume', o.purchaseToken]); B.owned = B.owned.filter(x => x.purchaseToken !== o.purchaseToken); },
  getPurchases: async o => ({ purchases: B.owned.filter(x => x.type === o.productType) }),
  manageSubscriptions: async () => { B.calls.push(['manage']); },
};
const LocalNotifications = {
  checkPermissions: async () => ({ display: B.perm || 'granted' }), requestPermissions: async () => { B.calls.push(['askPerm']); B.perm = 'granted'; return { display: 'granted' }; },
  schedule: async o => { B.calls.push(['notify', o.notifications[0].id, o.notifications[0].title, o.notifications[0].body, +new Date(o.notifications[0].schedule.at)]); },
  cancel: async o => { B.calls.push(['cancelNotify', JSON.stringify(o)]); },
  addListener: async () => ({ remove() {} }),
};
const AdMob = { initialize: async () => {}, addListener: async () => ({ remove() {} }) };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { NativePurchases, LocalNotifications, AdMob } };
"""


def api_routes(ctx, state):
    """Mock the backend: quota (with features.plus), register and plus-verify."""
    def quota(route):
        q = {'remaining': 200 if state['plus'] else 5, 'limit': 200 if state['plus'] else 5, 'plus': bool(state['plus']), 'scope': 'device'}
        if state['plus']:
            q['plusUntil'] = state['until']
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'configured': True, 'provider': 'mock', 'features': {'plus': True, 'ads': False}, 'limits': {}, 'quota': q}))

    def register(route):
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'token': 'test-token'}))

    def verify(route):
        b = json.loads(route.request.post_data or '{}')
        state['verified'].append(b.get('productId'))
        life = b.get('productId') == 'fale_plus_lifetime'
        state['plus'] = True
        state['until'] = '2099-12-31T23:59:59.000Z' if life else state['sub_until']
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'active': True, 'product': b.get('productId'), 'expiresAt': state['until'], 'lifetime': life, 'renews': (not life) and state.get('renews', True)}))
    ctx.route('**/api/ai/quota', quota)
    ctx.route('**/api/ai/register', register)
    ctx.route('**/api/plus-verify', verify)


def native_ctx(browser, state, lang='de-DE', pre=None):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale=lang, is_mobile=True, has_touch=True, device_scale_factor=2)
    if pre:
        ctx.add_init_script(pre)
    ctx.add_init_script(NATIVE)
    ctx.add_init_script("localStorage.setItem('fale-onboarding', '1'); if (!localStorage.getItem('fale-ai-consent')) localStorage.setItem('fale-ai-consent', JSON.stringify({ v: 1, at: Date.now(), provider: 'mock' }));")
    api_routes(ctx, state)
    return ctx


def errors_of(page):
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(m.text))
    return errs


def rec_count(page):
    return page.evaluate("async () => (await (await import('./js/db.js')).listRecovery()).length")


def wait_rec(page, n, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        if rec_count(page) == n:
            return True
        page.wait_for_timeout(150)
    return False


def freeze_probe(page):
    page.evaluate("""() => { window.__long = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => { window.__long = Math.max(window.__long, e.duration); })).observe({ type: 'longtask', buffered: true }); } catch {} }""")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ------------------------------------------------ lifetime purchase + tips
        state = {'plus': False, 'until': None, 'sub_until': None, 'verified': []}
        ctx = native_ctx(browser, state)
        page = ctx.new_page(); errs = errors_of(page)
        page.goto(URL + '#/ki/plus'); freeze_probe(page)

        def plus_offer():
            page.wait_for_selector('[data-plus-product]', timeout=8000)
            opts = page.locator('[data-plus-product]')
            ids = [opts.nth(i).get_attribute('data-plus-product') for i in range(opts.count())]
            check('subscriptions + one-time product offered', ids == ['fale_plus_monthly', 'fale_plus_yearly', 'fale_plus_lifetime'], str(ids))
            life = page.locator('[data-plus-product="fale_plus_lifetime"]')
            check('lifetime card: price + "Einmal zahlen, kein Abo"', '39,99 €' in life.inner_text() and 'Einmal zahlen, kein Abo' in life.inner_text(), life.inner_text())
            fair = page.locator('[data-fair]').inner_text()
            check('fair-billing card', 'Keine Probezeit' in fair and 'Kündigen mit einem Tipp' in fair and 'drei Tage' in fair, fair)
            check('one-time note under the buttons', 'einmaliger Kauf ohne Verlängerung' in page.locator('[data-buy]').inner_text())
            page.wait_for_selector('[data-tip]', timeout=5000)
            check('three tip buttons with prices', page.locator('[data-tip]').count() == 3 and '1,99 €' in page.locator('[data-tips]').inner_text())
            page.screenshot(path=os.path.join(OUT, 'plus_offer_phone.png'), full_page=True)
        step('plus offer', plus_offer)

        def tips():
            page.locator('[data-tip="fale_tip_small"]').click()
            page.wait_for_selector('[data-tip-count]', timeout=5000)
            calls = page.evaluate('window.__bill.calls')
            check('tip purchased as in-app and consumed right away', ['purchase', 'fale_tip_small', 'inapp'] in calls and any(c[0] == 'consume' for c in calls), str(calls[-3:]))
            check('thank-you counter', 'einmal unterstützt' in page.locator('[data-tip-count]').inner_text())
            page.locator('[data-tip="fale_tip_medium"]').click()
            page.wait_for_function("() => (document.querySelector('[data-tip-count]') || {}).innerText?.includes('2-mal')", timeout=5000)
            check('tip can be given again (consumed)', page.evaluate("window.__bill.owned.length") == 0)
            check('no server verification for tips', state['verified'] == [], str(state['verified']))
        step('tips', tips)

        def buy_lifetime():
            page.locator('[data-plus-product="fale_plus_lifetime"]').click()
            page.wait_for_selector('.ai-plus-active', timeout=10000)
            txt = page.locator('[data-buy]').inner_text()
            check('lifetime verified on the server', state['verified'] == ['fale_plus_lifetime'], str(state['verified']))
            check('lifetime active screen', 'für immer' in txt and 'Kein Abo' in txt, txt)
            check('no cancel button / reminder for lifetime', page.locator('[data-manage]').count() == 0 and page.locator('[data-remind]').count() == 0)
            check('no renewal notification for lifetime', not any(c[0] == 'notify' for c in page.evaluate('window.__bill.calls')))
            page.screenshot(path=os.path.join(OUT, 'plus_lifetime_phone.png'), full_page=True)
        step('buy lifetime', buy_lifetime)

        def restore_lifetime():
            page.evaluate("localStorage.removeItem('fale-plus-info'); window.__bill.owned = [{ productIdentifier: 'fale_plus_lifetime', purchaseToken: 'tok-life', type: 'inapp' }]")
            r = page.evaluate("async () => (await import('./js/ai/plus.js')).restore()")
            check('restore finds the one-time purchase', r.get('active') and r.get('lifetime'), str(r))
        step('restore lifetime', restore_lifetime)
        check('lifetime flow: no page errors', not errs, str(errs[:3]))
        check('lifetime flow: no freeze (long task < 400 ms)', page.evaluate('window.__long || 0') < 400, page.evaluate('window.__long || 0'))
        ctx.close()

        # ------------------------------------------------ subscription active + reminder
        until = time.strftime('%Y-%m-%dT10:00:00.000Z', time.gmtime(time.time() + 20 * 86400))
        state = {'plus': False, 'until': None, 'sub_until': until, 'verified': []}
        ctx = native_ctx(browser, state)
        page = ctx.new_page(); errs = errors_of(page)
        page.goto(URL + '#/ki/plus')

        def subscription():
            page.wait_for_selector('[data-plus-product="fale_plus_yearly"]', timeout=8000)
            page.locator('[data-plus-product="fale_plus_yearly"]').click()
            page.wait_for_selector('[data-manage]', timeout=10000)
            txt = page.locator('[data-buy]').inner_text()
            check('subscription: renew date shown', 'Verlängert sich am' in txt, txt)
            page.wait_for_function("() => window.__bill.calls.some(c => c[0] === 'notify')", timeout=5000)
            n = next(c for c in page.evaluate('window.__bill.calls') if c[0] == 'notify')
            days = (time.mktime(time.strptime(until[:10], '%Y-%m-%d')) - n[4] / 1000) / 86400
            check('renewal reminder scheduled ~3 days before', 2 <= days <= 3.6 and 'verlängert sich bald' in n[2] and 'kündigen' in n[3], str(n) + f' days={days:.2f}')
            page.locator('[data-manage]').click()
            page.wait_for_timeout(300)
            check('one tap opens the subscription management', ['manage'] in page.evaluate('window.__bill.calls'))
            page.locator('label:has([data-remind])').click()
            page.wait_for_timeout(400)
            check('reminder switch off cancels the notification', any(c[0] == 'cancelNotify' for c in page.evaluate('window.__bill.calls')))
            page.screenshot(path=os.path.join(OUT, 'plus_sub_phone.png'), full_page=True)
        step('subscription', subscription)
        check('subscription flow: no page errors', not errs, str(errs[:3]))
        ctx.close()

        # ------------------------------------------------ active subscription, page visit: fresh state, no permission prompt, leftover tip
        state = {'plus': True, 'until': until, 'sub_until': until, 'verified': [], 'renews': False}
        ctx = native_ctx(browser, state, pre="window.__billInit = { perm: 'prompt', owned: [{ productIdentifier: 'fale_plus_yearly', purchaseToken: 'tok-sub-1234567890', type: 'subs' }, { productIdentifier: 'fale_tip_small', purchaseToken: 'tok-tip-1234567890', type: 'inapp', purchaseState: '1' }] };"
                            "localStorage.setItem('fale-plus-info', JSON.stringify({ product: 'fale_plus_yearly', expiresAt: '" + until + "', renews: true, at: Date.now() - 2 * 864e5 }));")
        page = ctx.new_page(); errs = errors_of(page)
        page.goto(URL + '#/ki/plus')

        def visit_active():
            page.wait_for_selector('[data-manage]', timeout=10000)
            try:
                page.wait_for_function("() => document.querySelector('[data-buy]').innerText.includes('Gekündigt')", timeout=10000)
            except Exception:
                print('DEBUG buy:', page.locator('[data-buy]').inner_text()[:300], 'verified', state['verified'], 'calls', page.evaluate('window.__bill.calls'), 'info', page.evaluate("localStorage.getItem('fale-plus-info')"), 'errs', errs[:3])
                raise
            check('stale info re-checked with the store (cancelled in Play → „Gekündigt – läuft am …“)', 'fale_plus_yearly' in state['verified'], state['verified'])
            calls = page.evaluate('window.__bill.calls')
            check('page visit never asks for the notification permission', not any(c[0] == 'askPerm' for c in calls), calls)
            check('cancelled subscription: no renewal notification', not any(c[0] == 'notify' for c in calls))
            page.wait_for_function("() => window.__bill.calls.some(c => c[0] === 'consume')", timeout=8000)
            check('leftover tip purchase consumed (tier usable again)', ['consume', 'tok-tip-1234567890'] in page.evaluate('window.__bill.calls'))
            page.locator('label:has([data-remind])').click(); page.wait_for_timeout(300)
            page.locator('label:has([data-remind])').click(); page.wait_for_timeout(300)
            cs = page.evaluate('window.__bill.calls')
            check('cancelled: toggling the reminder schedules nothing and asks nothing', not any(c[0] in ('askPerm', 'notify') for c in cs), cs)
        step('visit active plus', visit_active)
        check('visit active plus: no page errors', not errs, str(errs[:3]))
        ctx.close()

        # ------------------------------------------------ English plus screen
        state = {'plus': False, 'until': None, 'sub_until': until, 'verified': []}
        ctx = native_ctx(browser, state, 'en-US')
        page = ctx.new_page()
        page.goto(URL + '#/ki/plus')

        def english():
            page.wait_for_selector('[data-plus-product]', timeout=8000)
            page.wait_for_selector('[data-tip]', timeout=5000)
            page.wait_for_timeout(500)
            txt = page.locator('#tool-screen').inner_text()
            check('English: fair card + lifetime + tips translated', 'How we bill fairly' in txt and 'Pay once, no subscription' in txt and 'Just say thanks' in txt, txt[:600])
            de = [w for w in ['Einmal zahlen', 'So fair', 'Danke sagen', 'Für immer', 'Kündigen mit'] if w in txt]
            check('English: no German leftovers on the Plus screen', not de, str(de))
            page.screenshot(path=os.path.join(OUT, 'plus_offer_phone_en.png'), full_page=True)
        step('english plus', english)
        ctx.close()

        # ------------------------------------------------ hide AI
        ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='de-DE')
        ctx.add_init_script("localStorage.setItem('fale-onboarding', '1');")
        page = ctx.new_page(); errs = errors_of(page)
        page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero')

        def menu_text(hash_, wait):
            page.goto(URL + hash_); page.wait_for_selector(wait, timeout=10000); page.wait_for_timeout(400)
            page.locator('[data-office-more]').click(); page.wait_for_selector('.menu', timeout=3000)
            t = page.locator('.menu').inner_text(); page.keyboard.press('Escape'); page.wait_for_timeout(200)
            return t

        def hide_ai():
            page.wait_for_selector('[data-ai-start] .ai-start-card', timeout=5000)
            check('AI start card visible by default', page.locator('[data-ai-start]').is_visible())
            check('writer menu has KI-Schreibhilfe by default', 'KI-Schreibhilfe' in menu_text('#/neu/dokument', '.doc-page'))
            page.goto(URL + '#/ki/einstellungen'); page.wait_for_selector('[data-hide]')
            page.locator('label:has([data-hide])').click(); page.wait_for_timeout(300)
            check('hide switch stored + cloud AI off', page.evaluate("localStorage.getItem('fale-ai-hidden') === '1' && localStorage.getItem('fale-ai-cloud') === 'off'"))
            page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero'); page.wait_for_timeout(500)
            check('start: AI card gone', not page.locator('[data-ai-start]').is_visible())
            page.goto(URL + '#/werkzeuge'); page.wait_for_timeout(700)
            check('Werkzeuge: AI section gone', page.locator('[data-ai-section]').count() == 0 or not page.locator('[data-ai-section]').is_visible())
            check('writer menu without KI-Schreibhilfe', 'KI-Schreibhilfe' not in menu_text('#/neu/dokument', '.doc-page'))
            check('sheet menu without Formel-Assistent', 'Formel-Assistent' not in menu_text('#/neu/tabelle', '.sheet-app'))
            check('slides menu without Folien per KI', 'Folien per KI' not in menu_text('#/neu/praesentation', '.slide-stage'))
            page.goto(URL + '#/ki'); page.wait_for_selector('[data-ai-hidden-note]', timeout=5000)
            page.screenshot(path=os.path.join(OUT, 'ai_hidden_hub.png'))
            page.locator('[data-unhide]').click(); page.wait_for_timeout(200)
            check('hub: re-enable works', page.evaluate("localStorage.getItem('fale-ai-hidden')") is None and page.locator('[data-ai-hidden-note]').count() == 0)
            check('re-enabling keeps cloud AI off until switched on', page.evaluate("localStorage.getItem('fale-ai-cloud')") == 'off')
        step('hide ai', hide_ai)
        check('hide AI: no page errors', not errs, str(errs[:3]))
        ctx.close()

        # ------------------------------------------------ crash recovery
        ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='de-DE')
        ctx.add_init_script("localStorage.setItem('fale-onboarding', '1');")
        page = ctx.new_page(); errs = errors_of(page)

        def recovery():
            page.goto(URL + '#/neu/dokument'); page.wait_for_selector('.doc-page[contenteditable]', timeout=10000)
            page.locator('.doc-page[contenteditable]').first.click()
            page.keyboard.type('Wichtiger Absatz, der nicht verloren gehen darf.')
            page.wait_for_timeout(300)
            page.evaluate("window.dispatchEvent(new Event('pagehide'))")
            check('snapshot written when the app goes to the background', wait_rec(page, 1))
            page.close(run_before_unload=False)  # app killed: no cleanup runs
            p2 = ctx.new_page(); e2 = errors_of(p2)
            p2.goto(URL + '#/start')
            p2.wait_for_selector('dialog.dlg', timeout=8000)
            dlg = p2.locator('dialog.dlg').inner_text()
            check('restore dialog after the crash', 'Ungespeicherte Änderungen gefunden' in dlg and 'neue Datei' in dlg, dlg)
            p2.screenshot(path=os.path.join(OUT, 'recovery_dialog.png'))
            p2.locator('dialog.dlg button[value="restore"]').click()
            p2.wait_for_selector('.doc-page[contenteditable]', timeout=10000)
            p2.wait_for_timeout(600)
            check('restored text in the editor', 'nicht verloren gehen darf' in p2.locator('.doc-page').inner_text())
            check('opened as a new file "(wiederhergestellt)"', '(wiederhergestellt)' in p2.locator('.title-btn').inner_text() and p2.evaluate('location.hash').startswith('#/bearbeiten/'), p2.locator('.title-btn').inner_text())
            check('recovery entry removed after restore', wait_rec(p2, 0))
            # edit + save → no entry left; edit + snapshot + save → entry removed
            p2.locator('.doc-page[contenteditable]').first.click(); p2.keyboard.press('End'); p2.keyboard.type(' Mehr.')
            p2.evaluate("window.dispatchEvent(new Event('pagehide'))")
            check('snapshot of the restored file', wait_rec(p2, 1))
            p2.locator('[data-office-save]').click(); p2.wait_for_timeout(800)
            check('save removes the snapshot', wait_rec(p2, 0))
            p2.goto(URL + '#/start'); p2.wait_for_timeout(800)
            check('no restore dialog after a clean session', p2.locator('dialog.dlg').count() == 0)
            check('recovery: no page errors', not e2, str(e2[:3]))
        step('recovery', recovery)

        def recovery_side_effects():
            p3 = ctx.new_page(); e3 = errors_of(p3)
            # slides: a snapshot while typing on a slide keeps the text box in edit mode
            p3.goto(URL + '#/neu/praesentation'); p3.wait_for_selector('.slide-stage', timeout=15000); p3.wait_for_timeout(800)
            p3.evaluate("() => { const a = document.querySelector('.slides-app')._slidesApi; a.startEdit(0); }"); p3.wait_for_timeout(300)
            p3.keyboard.type('Titel im Bearbeiten')
            p3.evaluate("() => document.querySelector('.slides-app')._slidesApi.pres()") and None
            editing = "() => !!document.querySelector('.slide-stage .tx[contenteditable], .slide-stage [contenteditable=\"true\"]')"
            was = p3.evaluate(editing)
            p3.evaluate("window.dispatchEvent(new Event('pagehide'))")
            check('slides snapshot written while typing', wait_rec(p3, 1))
            check('slides: still editing after the snapshot (no re-render)', was and p3.evaluate(editing))
            # second tab: the open editor is not offered for restore there
            p4 = ctx.new_page(); p4.goto(URL + '#/start'); p4.wait_for_selector('#view-start .hero'); p4.wait_for_timeout(1500)
            check('other tab: no restore dialog for an editor that is still open', p4.locator('dialog.dlg').count() == 0)
            p4.close()
            p3.locator('[data-office-save]').click(); p3.wait_for_timeout(800)
            check('slides: save removes the snapshot', wait_rec(p3, 0))
            # CSV with two sheets: the snapshot shows no „CSV speichert nur das aktuelle Blatt“ toast
            check('no slides errors', not e3, str(e3[:3]))
            p3.close()
        step('recovery side effects', recovery_side_effects)
        ctx.close()
        browser.close()

    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
