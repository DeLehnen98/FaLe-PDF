import json, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
results = []
def check(name, ok, info=''):
    results.append((name, ok, info)); print(('PASS ' if ok else 'FAIL ') + name + (' – ' + str(info) if info else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(service_workers='allow')
    page = ctx.new_page()
    errors, requests = [], []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('request', lambda r: requests.append(r.url))
    supa_calls = []
    def api(route):
        u = route.request.url
        if 'a=config' in u and '/api/drive' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'configured': True, 'chunkSize': 1048576}))
        if '/api/account' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'configured': True, 'supabaseUrl': 'https://e2e.supabase.co', 'supabaseKey': 'pk-e2e'}))
        return route.fulfill(status=503, content_type='application/json', body='{"ok":false,"error":"x"}')
    def supa(route):
        supa_calls.append(route.request.url)
        body = json.loads(route.request.post_data or '{}')
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'access_token': 'acc-web', 'refresh_token': 'ref-web-2', 'expires_in': 3600, 'user': {'id': '11111111-2222-4333-8444-555555555555', 'email': 'w@example.invalid'}, 'presented': body.get('refresh_token')}))
    page.route('https://pdf.fale.network/**', api)
    page.route('https://e2e.supabase.co/**', supa)
    page.goto(BASE + '/', wait_until='load')
    page.wait_for_selector('.gate .gate-card', timeout=20000)
    page.wait_for_timeout(1500)
    check('Startbildschirm im Browser', True, page.inner_text('.gate-title') if page.query_selector('.gate-title') else '')
    errs = [e for e in errors if 'Failed to load resource' not in e]
    check('keine JS-Fehler', not errs, errs[:5])
    check('native.js im Browser nicht geladen', not any('native.js' in u for u in requests), [u for u in requests if 'native' in u])
    st = page.evaluate("""async () => ({ cap: typeof window.Capacitor, card: document.querySelectorAll('[data-autobackup]').length,
        sw: (await navigator.serviceWorker.getRegistrations()).length, sws: (await (await fetch('/sw.js')).text()).includes('native.js') })""")
    check('kein Capacitor, keine Sicherungskarte', st['cap'] == 'undefined' and st['card'] == 0, st)
    page.wait_for_timeout(1500)
    st2 = page.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length")
    check('Service Worker registriert (wie bisher)', st2 >= 1, st2)
    check('native.js nicht im Precache', not st['sws'])
    # auth.js without a native hook: refresh goes to the FaLe-Konto (Supabase) as before
    r = page.evaluate("""async () => { const { kv } = await import('/js/idb.js'); const A = await import('/js/auth.js');
        await kv.set('session', { refresh: 'ref-web-1', user: { id: '11111111-2222-4333-8444-555555555555', email: 'w@example.invalid' }, at: Date.now(), device: 'dev_web_1234567890ab', deviceName: 'Web' });
        const tok = await A.accessToken({ force: true }); const s = await kv.get('session', null);
        return { tok, refresh: s && s.refresh }; }""")
    check('Browser: Erneuerung direkt beim FaLe-Konto', r['tok'] == 'acc-web' and r['refresh'] == 'ref-web-2' and len(supa_calls) == 1, [r, supa_calls])
    # with a native hook (as in the Android app): no Supabase call, tokens from the hook; adopt only same user
    n0 = len(supa_calls)
    r = page.evaluate("""async () => { const { kv } = await import('/js/idb.js'); const A = await import('/js/auth.js');
        const calls = []; A.useNativeSession({ token: async o => { calls.push(o); return { armed: true, access_token: 'acc-native', refresh_token: 'ref-native', expires_in: 3600, user: { id: '11111111-2222-4333-8444-555555555555', email: 'w@example.invalid' } }; } });
        const tok = await A.accessToken({ force: true }); const s = await kv.get('session', null);
        const adoptedOther = await A.withSession(x => x.adopt({ access_token: 'z', refresh_token: 'z', user: { id: '99999999-2222-4333-8444-555555555555' } }));
        const adoptedSame = await A.withSession(x => x.adopt({ access_token: 'acc-native-2', refresh_token: 'ref-native-2', expires_in: 3600, user: { id: '11111111-2222-4333-8444-555555555555', email: 'w@example.invalid' } }));
        const s2 = await kv.get('session', null);
        // not armed → the app refreshes itself again
        A.useNativeSession({ token: async () => ({ armed: false }) });
        const tok3 = await A.accessToken({ force: true });
        // signed out in the background → local sign-out, wipe hooks first
        const wiped = []; A.onLocalWipe(reason => { wiped.push(reason); });
        A.useNativeSession({ token: async () => ({ armed: false, signedOut: true }) });
        const tok4 = await A.accessToken({ force: true }); const s4 = await kv.get('session', null);
        A.useNativeSession(null);
        return { tok, refresh: s && s.refresh, force: calls[0] && calls[0].force, adoptedOther, adoptedSame, refresh2: s2 && s2.refresh, tok3, tok4, s4: !!s4, wiped }; }""")
    check('App-Haken: Erneuerung nur über die Hintergrund-Sicherung', r['tok'] == 'acc-native' and r['refresh'] == 'ref-native' and r['force'] is True and len(supa_calls) == n0 + 1 and r['tok3'] == 'acc-web', r)
    check('App-Haken: Übernahme nur fürs selbe Konto', r['adoptedOther'] is False and r['adoptedSame'] is True and r['refresh2'] == 'ref-native-2', r)
    check('App-Haken: anderswo abgemeldet → lokal abgemeldet, Haken zuerst', r['tok4'] is None and r['s4'] is False and r['wiped'] == ['expired'], r)
    # English UI strings for the card exist (dictionary)
    r = page.evaluate("""async () => { const E = (await import('/js/i18n-en.js')).default;
        return ['Automatische Sicherung', 'Mitteilungen erlauben?', 'Angehalten: Bitte melde dich neu an.', 'Die Sicherung startet gleich.'].map(k => E[k] || null); }""")
    check('Englische Texte vorhanden', all(r), r)
    page.goto(BASE + '/', wait_until='load'); page.wait_for_selector('.gate .gate-card', timeout=20000)
    page.wait_for_timeout(800)
    errs = [e for e in errors if 'Failed to load resource' not in e]
    check('Neuladen ohne Fehler', not errs, errs[:5])
    page.screenshot(path=sys.argv[2])
    b.close()
fails = [r for r in results if not r[1]]
print(f"{len(results) - len(fails)}/{len(results)} bestanden")
sys.exit(1 if fails else 0)
