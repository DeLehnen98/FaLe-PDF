"""E2E tests for the FaLe PDF cloud-AI features (js/ai/*) against the local harness:
   node ai_harness.mjs 8799   (static app + /api/* with mock provider + in-memory store)
No real provider calls, no real ads. Screenshots → out_ai/."""
import os, sys, json, base64, shutil, traceback, re, time
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(SP, 'ai_data')
OUT = os.path.join(SP, 'out_ai')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('AI_URL', 'http://127.0.0.1:8799/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems, api_calls = [], [], []
PAGES = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    if ONLY != 'all' and not any(o in name for o in ONLY.split(',')):
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        if PAGES:
            try:
                pg = PAGES[-1]
                pg.screenshot(path=os.path.join(OUT, 'fail_' + re.sub(r'\W+', '_', name) + '.png'))
                print('   toasts:', pg.locator('#toasts').inner_text()[:300], '| dialog:', pg.locator('dialog[open]').first.inner_text()[:300] if pg.locator('dialog[open]').count() else '-', '| url:', pg.url)
            except Exception as e2:
                print('   (no debug)', e2)


IGNORED = ('favicon', 'Failed to load resource: the server responded with a status of 429', 'Failed to load resource: the server responded with a status of 503',
           'net::ERR_INTERNET_DISCONNECTED', 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED')


def attach(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and not any(i in m.text for i in IGNORED) else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))
    page.on('request', lambda r: api_calls.append((label, r.method, r.url)) if '/api/' in r.url else None)


def harness(path):
    page_req = __import__('urllib.request').request
    with page_req.urlopen(URL.rstrip('/') + path) as r:
        return json.loads(r.read().decode())


def wait_count(page, sel, n, ms=10000):
    """poll from Python – the app's CSP blocks Playwright's wait_for_function (string eval)"""
    end = time.time() + ms / 1000
    while time.time() < end:
        if page.locator(sel).count() >= n:
            return True
        time.sleep(0.1)
    raise TimeoutError(f'{sel} ×{n} not reached')


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(OUT, name + '.png'))


def goto(page, h, wait=700):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(250)
    dlg = page.locator('dialog', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator('button[value="discard"]').click()
    page.wait_for_timeout(max(0, wait - 250))


def close_dialogs(page):
    for _ in range(3):
        d = page.locator('dialog[open]')
        if not d.count():
            return
        d.last.locator('button[value="__cancel"], button[value="cancel"], button[value="close"]').first.click()
        page.wait_for_timeout(200)


def set_theme(page, t):
    page.evaluate(f"localStorage.setItem('fale-theme', '{t}'); document.documentElement.dataset.theme = '{t}'")


def import_file(page, path, name, mime):
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    doc_id = page.evaluate("""async ([b64, name, mime]) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const { importFiles } = await import('./js/library.js');
      const [d] = await importFiles([new File([u], name, { type: mime })], { source: 'Gerät', any: true });
      for (let i = 0; i < 60; i++) { const db = await import('./js/db.js'); const m = await db.getDoc(d.id); if (m && m.textReady) break; await new Promise(r => setTimeout(r, 100)); }
      return d.id; }""", [b64, name, mime])
    return doc_id


def quota_text(page):
    loc = page.locator('[data-aq-left]')
    return loc.first.inner_text() if loc.count() else ''


def consent(page):
    page.locator('[data-consent]').first.click()
    page.wait_for_selector('dialog[open] .ai-consent')
    page.locator('dialog[open] button[value="ok"]').click()
    page.wait_for_selector('[data-aq-left]', timeout=6000)


NATIVE_MOCK = """
window.__FALE_AI_API__ = location.origin;
window.__admob = { calls: [], listeners: {}, customData: null };
const A = window.__admob;
const admob = {
  initialize: async o => { A.calls.push(['initialize', o]); },
  requestConsentInfo: async () => { A.calls.push(['requestConsentInfo']); return { status: A.consentDone ? 'OBTAINED' : 'REQUIRED', isConsentFormAvailable: true, canRequestAds: !!A.consentDone }; },
  showConsentForm: async () => { A.calls.push(['showConsentForm']); A.consentDone = true; return { status: 'OBTAINED', isConsentFormAvailable: true, canRequestAds: true }; },
  showPrivacyOptionsForm: async () => { A.calls.push(['showPrivacyOptionsForm']); },
  prepareRewardVideoAd: async o => { A.calls.push(['prepare', o]); A.customData = o.ssv && o.ssv.customData; return { adUnitId: o.adId }; },
  showRewardVideoAd: () => new Promise(async res => {
    A.calls.push(['show']);
    if (A.closeEarly) { // closed before the end: no reward, no SSV
      res({ type: '', amount: 0 });
      setTimeout(() => (A.listeners['onRewardedVideoAdDismissed'] || []).forEach(cb => cb()), 50);
      return;
    }
    // simulate Google's server-side verification callback for this device token
    await fetch('/__test/ssv?custom_data=' + encodeURIComponent(A.customData || ''));
    (A.listeners['onRewardedVideoAdReward'] || []).forEach(cb => cb({ type: 'KI', amount: 3 }));
    res({ type: 'KI', amount: 3 });
    setTimeout(() => (A.listeners['onRewardedVideoAdDismissed'] || []).forEach(cb => cb()), 50);
  }),
  addListener: (name, cb) => { (A.listeners[name] = A.listeners[name] || []).push(cb); return Promise.resolve({ remove: () => { A.listeners[name] = (A.listeners[name] || []).filter(x => x !== cb); } }); },
};
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { AdMob: admob } };
"""


def main():
    harness('/__test/reset')
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ================================================================ desktop web
        ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE')
        page = ctx.new_page()
        PAGES.append(page)
        attach(page, 'desktop')
        page.goto(URL)
        page.wait_for_selector('#view-start .hero')
        page.wait_for_timeout(600)
        state = {}

        def no_network_on_start():
            goto(page, '#/werkzeuge', 900)
            goto(page, '#/einstellungen', 900)
            goto(page, '#/start', 700)
            check('no /api calls on start/werkzeuge/ich', not api_calls, str(api_calls[:3]))
            check('start: KI card', page.locator('#view-start .ai-start-card').count() == 1)
            goto(page, '#/werkzeuge', 700)
            check('werkzeuge: KI section with 14 cards in 5 groups', page.locator('[data-ai-section] .tool-card').count() == 14 and page.locator('[data-ai-section] .ai-group').count() == 5, page.locator('[data-ai-section] .tool-card').count())
            check('werkzeuge: Alltag section with its 6 cards (+ web tools)', page.locator('.alltag-grid .tool-card').count() >= 6 and page.locator('.alltag-grid [data-tool="x-schreiben"]').count() == 1)
            page.fill('#tool-search', 'Lernkarten')
            page.wait_for_timeout(300)
            check('werkzeuge search finds AI card', page.locator('[data-ai-section] .tool-card:not([hidden])').count() == 1)
            page.fill('#tool-search', '')
            page.dispatch_event('#tool-search', 'input')
            goto(page, '#/einstellungen', 900)
            check('ich: KI status card (web: where the cloud AI is)', 'FaLe-App für Android' in page.locator('[data-ai-me]').inner_text(), page.locator('[data-ai-me]').inner_text())
            check('ich: text no longer claims "keine Uploads, keine Werbung"', 'keine Uploads, keine Werbung' not in page.locator('#view-einstellungen').inner_text())
        step('start without network', no_network_on_start)

        def hub_and_consent():
            goto(page, '#/ki', 1200)
            page.wait_for_selector('.ai-status[data-state]')
            page.wait_for_selector('[data-consent]', timeout=5000)
            check('hub: needs consent banner', page.locator('.ai-banner.consent').count() == 1)
            check('hub: 14 feature cards in groups', page.locator('.ai-hub .ai-grid .tool-card').count() == 14 and page.locator('.ai-hub .ai-group-title').first.inner_text() == 'Verstehen')
            check('anonymous status check only (no token)', all('/api/ai/quota' in u for (_, m, u) in api_calls), str(api_calls))
            shot(page, 'desktop_hub_consent_light')
            page.locator('[data-consent]').click()
            page.wait_for_selector('dialog[open] .ai-consent')
            txt = page.locator('dialog[open]').inner_text()
            check('consent dialog names provider + no storage + legal basis', 'Test-Anbieter' in txt and 'Wir speichern keine Inhalte' in txt and 'Art. 6 Abs. 1 lit. a' in txt, txt[:200])
            shot(page, 'desktop_consent_dialog_light')
            page.locator('dialog[open] button[value="cancel"]').click()
            page.wait_for_timeout(300)
            check('declined consent: no register call', not any('/register' in u for (_, m, u) in api_calls))
            check('declined consent: still needs consent', page.locator('[data-consent]').count() == 1)
            consent(page)
            page.wait_for_timeout(500)
            check('access after consent: 5 unlocked (test server gives 5)', '5 KI-Anfragen freigeschaltet' in quota_text(page) and 'gratis' not in quota_text(page), quota_text(page))
            check('web: no ad button', page.locator('[data-ai-ad]').count() == 0)
            check('web: no Plus upsell (non-commercial hosting until the Play launch)', page.locator('[data-ai-plus]').count() == 0)
            tok = page.evaluate("localStorage.getItem('fale-ai-token')")
            check('device token stored after consent', bool(tok) and tok.startswith('v1.'))
            shot(page, 'desktop_hub_ready_light')
        step('hub + consent', hub_and_consent)

        def import_docs():
            state['doc'] = import_file(page, os.path.join(DATA, 'vertrag.pdf'), 'vertrag.pdf', 'application/pdf')
            check('test PDF imported', bool(state['doc']))
        step('import', import_docs)

        def chat():
            goto(page, f"#/ki/chat?doc={state['doc']}", 1200)
            page.wait_for_selector('.ai-composer textarea')
            page.wait_for_selector('[data-aq-left]', timeout=5000)
            page.fill('.ai-composer textarea', 'Wie lang ist die Kündigungsfrist?')
            page.locator('.ai-composer [data-send]').click()
            page.wait_for_selector('.ai-msg .ai-answer .ai-cite', timeout=10000)
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=10000)
            ans = page.locator('.ai-msg .ai-answer').last.inner_text()
            check('chat answer streamed with citation', 'Kündigungsfrist' in ans and 'S. 3' in ans, ans)
            cites = page.locator('.ai-msg .ai-answer .ai-cite').all_inner_texts()
            check('first citation is page 3 (BM25 picked the right chunk)', cites and cites[0] == 'S. 3', str(cites))
            check('one used (4 left)', '4 KI-Anfragen freigeschaltet' in quota_text(page), quota_text(page))
            reqs = [u for (_, m, u) in api_calls if u.endswith('/api/ai')]
            check('one AI request for one question', len(reqs) == 1, str(reqs))
            shot(page, 'desktop_chat_light')
            page.locator('.ai-msg .ai-answer .ai-cite').first.click()
            page.wait_for_timeout(1500)
            check('citation opens viewer at page 3', re.search(r'#/ansicht/[^?]+\?seite=3', page.url) and page.locator('#viewer').is_visible(), page.url)
            cur = page.evaluate("() => { const pv = document.querySelector('#viewer .pdfViewer'); const pages = [...document.querySelectorAll('#viewer .page')]; const st = document.querySelector('#viewer [data-v=\"container\"]'); const top = st.scrollTop; const p3 = document.querySelector('#viewer .page[data-page-number=\"3\"]'); return p3 ? Math.abs(p3.offsetTop - top) < p3.offsetHeight : false; }")
            check('page 3 scrolled into view', cur)
            page.go_back()
            page.wait_for_timeout(1000)
            # viewer menu entry
            goto(page, f"#/ansicht/{state['doc']}", 1500)
            page.locator('#viewer [data-v="more"]').click()
            item = page.locator('.menu-item', has_text='KI-Assistent')
            check('viewer menu has KI-Assistent', item.count() == 1)
            item.click()
            page.wait_for_timeout(1000)
            check('viewer → hub with doc preselected', '#/ki?doc=' in page.url and page.locator('.ai-docchip').count() == 1)
        step('chat with citations', chat)

        def chat_extras():
            harness('/__test/env?FREE_DAILY=100')  # these extra questions must not use up the quota of the later steps
            goto(page, f"#/ki/chat?doc={state['doc']}", 1200)
            page.wait_for_selector('.ai-composer textarea')
            page.wait_for_selector('[data-aq-left]', timeout=5000)
            # device voice: record what would be spoken (headless Chromium has no voices)
            page.evaluate("""() => { window.__said = []; const fake = { speaking: false, getVoices: () => [], cancel() { window.__said.push('<cancel>'); },
              speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend({}), 20); } };
              Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true, writable: true }); }""")
            page.fill('.ai-composer textarea', 'Wie lang ist die Kündigungsfrist?')
            page.locator('.ai-composer [data-send]').click()
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=10000)
            chips = page.locator('.ai-more .lt-chip').all_inner_texts()
            check('chat: 3 follow-up questions offered under the answer', len(chips) == 3 and 'Wie lang ist die Kündigungsfrist?' not in chips, chips)
            check('chat: answer has a read-aloud button', page.locator('.ai-msg-foot [data-say]').count() == 1)
            page.locator('.ai-msg-foot [data-say]').last.click()
            page.wait_for_timeout(400)
            said = page.evaluate('window.__said')
            check('chat: read aloud speaks the answer without page marks', any('Kündigungsfrist' in x for x in said) and not any('[S.' in x for x in said), said)
            # follow-up chip asks the next question; the old chips disappear
            page.locator('.ai-more .lt-chip').first.click()
            wait_count(page, '.ai-msg-foot:not([hidden])', 2)
            check('chat: tapping a follow-up asks it (old chips removed, new ones shown)', page.locator('.ai-more').count() == 1)
            # a page the AI never got → not clickable, marked, honest hint
            page.fill('.ai-composer textarea', 'Geisterseite: Wie lang ist die Kündigungsfrist?')
            page.locator('.ai-composer [data-send]').click()
            wait_count(page, '.ai-msg-foot:not([hidden])', 3)
            last = page.locator('.ai-msg').last
            check('chat: invented page reference is not a link and is marked', last.locator('.ai-cite-x').count() == 1 and 'S. 999' in last.locator('.ai-cite-x').inner_text() and last.locator('.ai-cite[data-page="999"]').count() == 0)
            check('chat: hint to check the document', last.locator('[data-cite-warn]').count() == 1)
            # citation jump carries a highlight word
            last.locator('.ai-cite').first.click()
            page.wait_for_timeout(1200)
            check('chat: citation opens the page with a word to highlight', re.search(r'#/ansicht/[^?]+\?seite=\d+&q=k%C3%BCndigungsfrist', page.url), page.url)
            page.go_back()
            page.wait_for_timeout(900)
            # a stream that goes quiet must not hang: watchdog ends it with a clear message
            goto(page, f"#/ki/chat?doc={state['doc']}", 1200)
            page.wait_for_selector('.ai-composer textarea')
            page.evaluate("import('./js/ai/client.js').then(m => { m.AI_WAIT.IDLE_MS = 1500; })")
            t0 = time.time()
            page.fill('.ai-composer textarea', '[[mock:stall]] Wie lang ist die Kündigungsfrist?')
            page.locator('.ai-composer [data-send]').click()
            ok = False
            while time.time() - t0 < 12:
                if page.locator('.ai-msg-foot:not([hidden]) .ai-warn').count() or page.locator('#toasts .toast').count():
                    ok = True; break
                time.sleep(0.2)
            dt = time.time() - t0
            warn = page.locator('.ai-msg-foot .ai-warn').all_inner_texts()
            check('chat: silent stream ends after the idle limit with a message (no endless spinner)', ok and dt < 6 and any('nicht weitergeschrieben' in w for w in warn), (dt, warn))
            check('chat: send button is ready again after the stall', page.locator('.ai-composer [data-send]').get_attribute('aria-label') == 'Senden')
            page.evaluate("import('./js/ai/client.js').then(m => { m.AI_WAIT.IDLE_MS = 40000; })")
            page.wait_for_timeout(6500)  # let the stalled mock stream finish on the server
            harness('/__test/reset')  # back to 5 per day, nothing used (the device registers again on its own)
            page.evaluate("async () => { const C = await import('./js/ai/client.js'); C._resetStatusCache(); await C.ensureToken({ renew: true }); await C.refreshQuota().catch(() => null); }")
        step('chat extras', chat_extras)

        def new_tools():
            harness('/__test/env?FREE_DAILY=100')
            tmp = os.path.join(OUT, '_docs'); os.makedirs(tmp, exist_ok=True)
            def txt(name, body):
                pth = os.path.join(tmp, name); open(pth, 'w', encoding='utf-8').write(body); return import_file(page, pth, name, 'text/plain')
            old = txt('Tarif-alt.txt', 'Stromvertrag Tarif Basis. Monatspreis 10,00 € brutto. Kündigungsfrist ein Monat zum Monatsende. Laufzeit 12 Monate.')
            new = txt('Tarif-neu.txt', 'Stromvertrag Tarif Basis Plus. Monatspreis 12,00 € brutto. Kündigungsfrist drei Monate. Laufzeit 24 Monate. Neu: Grundgebühr.')
            letter = txt('Brief-Stadtwerke.txt', 'Stadtwerke Teststadt GmbH, Hauptstraße 1, 12345 Teststadt. Aktenzeichen: AZ-2026/17. Ihre Jahresabrechnung: Nachzahlung 240,00 € bis zum 15.11.2026.')
            # Brief einfach erklärt: summary in „einfach“ mode + next steps
            goto(page, f'#/ki/erklaeren?doc={letter}', 1200)
            page.wait_for_selector('[data-go]')
            check('erklaeren: „Einfach erklärt“ is preselected', page.locator('[data-mode="einfach"]').get_attribute('aria-pressed') == 'true')
            page.evaluate("() => { const of = window.fetch; window.__aiBodies = []; window.fetch = (u, o) => { if (String(u).includes('/api/ai') && o && o.body) window.__aiBodies.push(String(o.body)); return of(u, o); }; }")
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-next]:not([hidden])', timeout=10000)
            body = page.evaluate("() => (window.__aiBodies || []).pop() || ''")
            check('erklaeren: sends the summarize task with mode „einfach“', '"task":"summarize"' in body and '"mode":"einfach"' in body, body[:200])
            check('erklaeren: next steps link the reply and the chat for this letter', page.locator(f'[data-next-reply][href="#/ki/antwort?doc={letter}"]').count() == 1 and page.locator(f'[data-next-chat][href="#/ki/chat?doc={letter}"]').count() == 1)
            shot(page, 'desktop_erklaeren_light')
            # Auf einen Brief antworten: the letter's text goes along, the sender becomes the recipient
            page.locator('[data-next-reply]').click()
            page.wait_for_selector('.ai-reply [name=request]', timeout=8000)
            check('antwort: the letter is preselected', page.locator('.ai-reply-src .ai-docchip').count() == 1 and 'Brief-Stadtwerke' in page.locator('.ai-reply-src').inner_text())
            page.locator('[data-idea="1"]').click()
            check('antwort: a quick idea fills the request', 'Ratenzahlung' in page.locator('[name=request]').input_value())
            page.fill('[name=request]', 'Ich bitte um Ratenzahlung von 40 Euro im Monat.')
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-draft]:not([hidden])', timeout=10000)
            prev = page.locator('.lt-paper').inner_text()
            body = page.evaluate("() => (window.__aiBodies || []).pop() || ''")
            check('antwort: request + letter text sent (as „reply“)', '"reply":' in body and 'AZ-2026/17' in body and 'Ratenzahlung' in body, body[:300])
            check('antwort: Aktenzeichen in the subject, sender of the letter as recipient', 'AZ-2026/17' in page.locator('[name=subject]').input_value() and 'Stadtwerke Teststadt GmbH' in prev and '12345 Teststadt' in prev, prev.replace(chr(10), ' | ')[:500])
            shot(page, 'desktop_antwort_light')
            # Was hat sich geändert?
            goto(page, f'#/ki/vergleichen?doc={old}&doc2={new}', 1200)
            page.wait_for_selector('[data-go]')
            check('vergleichen: both documents preselected', page.locator('.ai-cmp-slot .ai-docchip').count() == 2)
            page.locator('[data-go]').click()
            page.wait_for_function("() => (document.querySelector('[data-out]') || {}).innerText && document.querySelector('[data-out]').innerText.includes('→') && !document.querySelector('#tool-screen [data-go]').disabled", timeout=10000)
            out = page.locator('[data-out]').inner_text()
            check('vergleichen: changes in plain words („alt → neu“, with headings)', '10,00 € → 12,00 €' in out.replace('\xa0', ' ') and 'Geändert' in out, out)
            shot(page, 'desktop_vergleichen_light')
            goto(page, '#/ki/vergleichen', 1000)
            check('vergleichen without documents: two pickers, „Vergleichen“ asks for the first', page.locator('.ai-cmp-slot .ai-picker').count() == 2)
            page.locator('[data-go]').click()
            page.wait_for_timeout(400)
            check('vergleichen: friendly hint instead of a request', 'ältere Fassung' in page.locator('#toasts').inner_text())
            # Text verbessern: diff + clean view
            goto(page, '#/ki/verbessern', 1000)
            page.fill('[name=text]', 'Das ist ein sehr sehr schlecht geschriebener Text mit Feler.')
            page.locator('[data-mode="rechtschreibung"]').click()
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-result]:not([hidden])', timeout=10000)
            check('verbessern: changes marked (ins/del)', page.locator('[data-out] ins').count() >= 1 and page.locator('[data-out] del').count() >= 1)
            page.locator('[data-view="clean"]').click()
            clean = page.locator('[data-out]').inner_text()
            check('verbessern: „Neuer Text“ shows the clean proposal', 'Fehler' in clean and 'Feler' not in clean, clean)
            page.locator('[data-use]').click()
            check('verbessern: „Mit dem Vorschlag weiterarbeiten“ puts it into the text box', 'Fehler' in page.locator('[name=text]').input_value())
            shot(page, 'desktop_verbessern_light')
            harness('/__test/reset')
            page.evaluate("async () => { const C = await import('./js/ai/client.js'); C._resetStatusCache(); await C.ensureToken({ renew: true }); await C.refreshQuota().catch(() => null); }")
        step('new ai tools', new_tools)

        def summarize():
            goto(page, f"#/ki/zusammenfassen?doc={state['doc']}", 1200)
            page.wait_for_selector('[data-go]')
            page.wait_for_selector('[data-aq-left]', timeout=5000)
            page.locator('[data-mode="stichpunkte"]').click()
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-out] li', timeout=10000)
            page.wait_for_function("() => !document.querySelector('#tool-screen [data-go]').disabled", timeout=10000)
            out = page.locator('[data-out]').inner_text()
            check('summary rendered as bullets', 'Zusammenfassung (Test): Mietvertrag' in out and page.locator('[data-out] li').count() == 3, out)
            shot(page, 'desktop_summary_light')
            page.locator('.ai-res-acts [data-act="docx"]').click()
            page.wait_for_timeout(2000)
            names = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).map(d => d.name)")
            check('summary saved as .docx', any('Zusammenfassung' in n and n.endswith('.docx') for n in names), str(names))
            check('summary modes include „Einfach erklärt“', page.locator('[data-mode="einfach"]').count() == 1)
            page.evaluate("""() => { window.__said = []; const fake = { speaking: false, getVoices: () => [], cancel() {},
              speak(u) { window.__said.push(u.text + '|' + u.lang); setTimeout(() => u.onend && u.onend({}), 20); } };
              Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true, writable: true }); }""")
            page.locator('.ai-res-acts [data-say]').click()
            page.wait_for_timeout(500)
            said = page.evaluate('window.__said')
            check('summary: „Vorlesen“ reads the bullets without list marks, in the output language', said and all(not x.startswith('- ') for x in said) and any('Zusammenfassung (Test)' in x for x in said) and all(x.endswith('|de-DE') for x in said), said)
            check('summary: „Vorlesen“ button back to normal after speaking', page.locator('.ai-res-acts [data-say]').get_attribute('aria-pressed') == 'false')
        step('summarize', summarize)

        def translate():
            goto(page, '#/ki/uebersetzen', 1200)
            page.locator('[data-src="text"]').click()
            page.fill('.ai-paste textarea', 'Guten Tag.\n\nDie Miete ist am Monatsanfang fällig.')
            page.select_option('[name=target]', 'en')
            page.locator('[data-go]').click()
            page.wait_for_function("() => (document.querySelector('[data-out]') || {}).innerText && document.querySelector('[data-out]').innerText.includes('Monatsanfang') && !document.querySelector('[data-go]').disabled", timeout=10000)
            out = page.locator('[data-out]').inner_text()
            check('translation keeps paragraphs', out.startswith('[EN] Guten Tag.') and 'Monatsanfang' in out, out)
            page.locator('.ai-res-acts [data-act="txt"]').click()
            page.wait_for_timeout(1200)
            names = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).map(d => d.name)")
            check('translation saved as .txt', any(n.endswith('.txt') and 'Übersetzung' in n for n in names), str(names))
            shot(page, 'desktop_translate_light')
            # long text → split into parts
            long = '\n\n'.join(f'Absatz {i}: ' + 'Wort ' * 60 for i in range(60))
            page.fill('.ai-paste textarea', long)
            page.locator('[data-go]').click()
            page.wait_for_selector('.ai-more button', timeout=40000)
            check('long text: "Nächsten Teil übersetzen" offered', '1 von 2 Teilen' in page.locator('.ai-more').inner_text(), page.locator('.ai-more').inner_text())
        step('translate', translate)

        def rewrite():
            harness('/__test/reset')
            page.evaluate("localStorage.removeItem('fale-ai-token')")  # token from before reset is still valid (same secret) – re-register anyway
            goto(page, '#/neu/dokument', 1500)
            page.wait_for_selector('.doc-page')
            page.evaluate("""() => { const ed = document.querySelector('.doc-page'); ed.innerHTML = '<p>Das ist ein sehr sehr schlecht geschriebener Satz.</p><p>Zweiter Absatz bleibt.</p>'; ed.dispatchEvent(new Event('input', { bubbles: true }));
              const r = document.createRange(); r.selectNodeContents(ed.querySelector('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); document.dispatchEvent(new Event('selectionchange')); }""")
            page.wait_for_timeout(200)
            page.locator('[data-office-more]').click()
            page.locator('.menu-item', has_text='KI-Schreibhilfe').click()
            page.wait_for_selector('dialog[open] .ai-assist')
            check('assist dialog shows selected text', 'sehr sehr schlecht' in page.locator('dialog[open] .ai-assist-text').inner_text())
            page.locator('dialog[open] [data-mode="verbessern"]').click()
            page.wait_for_selector('dialog[open] .ai-diff ins', timeout=10000)
            check('diff preview marks changes', page.locator('dialog[open] .ai-diff del').count() >= 1 and page.locator('dialog[open] .ai-diff ins').count() >= 1)
            shot(page, 'desktop_rewrite_diff_light')
            page.locator('dialog[open] button[value="ok"]').click()
            page.wait_for_timeout(500)
            txt = page.locator('.doc-page').inner_text()
            check('accepted rewrite replaced only the selection', 'sehr ungünstig geschriebener Satz. Vielen Dank.' in txt and 'Zweiter Absatz bleibt.' in txt and 'sehr sehr' not in txt, txt)
            check('editor marked dirty', 'Nicht gespeichert' in page.locator('#tool-screen .screen-head').inner_text() or 'Neu' in page.locator('#tool-screen .screen-head').inner_text())
        step('writer assist', rewrite)

        def formula():
            goto(page, '#/neu/tabelle', 1500)
            page.wait_for_selector('.sh-body .sh-cells', state='attached')
            page.locator('[data-office-more]').click()
            page.locator('.menu-item', has_text='Formel-Assistent').click()
            for _i in range(8):
                page.wait_for_timeout(250)
                if os.environ.get('DBG'): print('DBG', page.locator('dialog[open]').count(), page.locator('#toasts').inner_text()[:150], page.locator('.menu-layer').count())
            page.wait_for_selector('dialog[open] .ai-formula')
            page.fill('dialog[open] [name=req]', 'Summe der Umsätze in Spalte B')
            page.locator('dialog[open] [data-go]').click()
            page.wait_for_selector('dialog[open] [data-out]:not([hidden])', timeout=10000)
            check('formula shown with explanation', page.locator('dialog[open] [data-f]').inner_text() == '=SUMME(B2:B10)' and 'Addiert' in page.locator('dialog[open] [data-expl]').inner_text())
            shot(page, 'desktop_formula_light')
            page.locator('dialog[open] button[value="ok"]').click()
            page.wait_for_timeout(400)
            val = page.evaluate("() => (document.querySelector('.cell-editor') || document.querySelector('.sh-fx-input') || {}).value")
            check('formula put into the cell editor for confirmation', val == '=SUMME(B2:B10)', val)
            page.keyboard.press('Escape')
        step('formula assistant', formula)

        def slides():
            goto(page, '#/ki/folien', 1400)
            page.fill('[name=topic]', 'Klimaschutz in der Schule')
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-prev] .ol-slide', timeout=10000)
            n = page.locator('[data-prev] .ol-slide').count()
            check('slide preview built from AI outline (title+agenda+3+closing)', n == 6, n)
            shot(page, 'desktop_slides_light')
            page.locator('#tool-screen [data-create]').click()
            page.wait_for_timeout(2000)
            check('opens slides editor with generated deck', '#/neu/praesentation' in page.url or '#/bearbeiten/' in page.url, page.url)
            check('deck contains AI heading', 'Klimaschutz in der Schule' in page.locator('#tool-screen').inner_text())
            goto(page, '#/start', 500)
            leave = page.locator('dialog[open] button[value="discard"]')
            if leave.count():
                leave.click()
        step('slides', slides)

        def study():
            goto(page, f"#/ki/lernkarten?doc={state['doc']}", 1400)
            page.locator('[data-go]').click()
            page.wait_for_selector('.ai-card', timeout=10000)
            check('flashcards generated → review', 'Was ist das Thema?' in page.locator('.ai-card').inner_text())
            shot(page, 'desktop_flashcard_light')
            for _ in range(3):
                page.locator('[data-show]').click()
                page.locator('[data-g="good"]').click()
                page.wait_for_timeout(150)
            check('review done screen', page.locator('.ai-review-done').count() == 1 and 'Alles gelernt' in page.locator('.ai-review-done').inner_text())
            decks = page.evaluate("async () => (await (await import('./js/db.js')).getSetting('aiDecks', []))")
            check('deck stored locally with spaced repetition (box 2, due later)', decks and all(c['box'] == 2 and c['due'] > time.time() * 1000 for c in decks[0]['cards']), str(decks)[:300])
            goto(page, f"#/ki/lernkarten?doc={state['doc']}", 1200)
            page.locator('[data-kind="quiz"]').click()
            page.locator('[data-go]').click()
            page.wait_for_selector('.ai-q', timeout=10000)
            check('quiz has 2 valid questions', 'Frage 1 von 2' in page.locator('.ai-q').inner_text())
            page.locator('.ai-opt').first.click()
            check('right answer marked', page.locator('.ai-opt.right').count() == 1)
            shot(page, 'desktop_quiz_light')
            page.locator('[data-next]').click()
            page.locator('.ai-opt').first.click()
            check('wrong answer marked', page.locator('.ai-opt.wrong').count() == 1)
            page.locator('[data-next]').click()
            check('quiz score', '1 von 2 richtig' in page.locator('.ai-review-done').inner_text())
            goto(page, '#/ki/lernkarten', 1000)
            check('deck list shows the set', page.locator('.ai-deck').count() == 1 and '3 Karten' in page.locator('.ai-deck').inner_text() and '2 Quizfragen' in page.locator('.ai-deck').inner_text())
        step('flashcards + quiz', study)

        def letter():
            harness('/__test/reset')
            page.evaluate("localStorage.removeItem('fale-ai-token')")
            page.evaluate("async () => (await import('./js/extras/profile.js')).setProfile({ vorname: 'Max', nachname: 'Muster', strasse: 'Hauptstraße', hausnummer: '1', plz: '66111', ort: 'Saarbrücken' })")
            goto(page, '#/ki/brief', 1400)
            page.fill('[name=request]', 'Ich möchte meinen Handyvertrag zum nächstmöglichen Termin kündigen.')
            page.fill('[name=r_name]', 'Muster Mobilfunk GmbH')
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-draft]:not([hidden])', timeout=10000)
            prev = page.locator('.lt-paper').inner_text()
            check('letter preview: subject, recipient, sender from profile', 'Kündigung meines Vertrags' in prev and 'Muster Mobilfunk GmbH' in prev and 'Max Muster' in prev and '[Datum]' in prev, prev.replace(chr(10), ' | ')[:900])
            sent = page.evaluate("() => window.__lastAiBody || null")
            shot(page, 'desktop_letter_light')
            page.locator('[data-out="pdf"]').click()
            page.wait_for_selector('dialog[open]', timeout=10000)
            check('letter PDF created', 'PDF erstellt' in page.locator('dialog[open]').inner_text())
            close_dialogs(page)
        step('letter', letter)

        def privacy_of_letter():
            # the sender profile must never be sent to the AI
            bodies = page.evaluate("() => window.__aiBodies || []")
            check('profile data not sent (checked via request log)', all('Saarbrücken' not in b and 'Hauptstraße' not in b for b in bodies), str(bodies)[:200])
        page.evaluate("""() => { const of = window.fetch; window.__aiBodies = []; window.fetch = (u, o) => { if (String(u).includes('/api/ai') && o && o.body) window.__aiBodies.push(String(o.body)); return of(u, o); }; }""")

        def letter_again():
            goto(page, '#/ki/brief', 1200)
            page.fill('[name=request]', 'Bitte um Rückruf wegen meiner Rechnung vom letzten Monat.')
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-draft]:not([hidden])', timeout=10000)
        step('letter privacy', letter_again)
        step('letter privacy check', privacy_of_letter)

        def quota_exhausted():
            st = page.evaluate("async () => (await import('./js/ai/client.js')).cachedQuota()")
            left = st['remaining'] if st else 0
            goto(page, '#/ki/uebersetzen', 1000)
            page.locator('[data-src="text"]').click()
            for _ in range(left):
                page.fill('.ai-paste textarea', 'Hallo Welt')
                page.locator('[data-go]').click()
                page.wait_for_timeout(700)
            page.fill('.ai-paste textarea', 'Hallo Welt')
            page.locator('[data-go]').click()
            page.wait_for_selector('dialog[open] .ai-limit', timeout=6000)
            txt = page.locator('dialog[open]').inner_text()
            check('nothing left on web: friendly dialog, no video button, no Pro upsell – the AI is in the Android app', 'Android-App' in txt
                  and page.locator('dialog[open] .dlg-actions button', has_text='Video').count() == 0 and 'FaLe Pro' not in txt, txt)
            shot(page, 'desktop_quota_exhausted_light')
            close_dialogs(page)
            check('access line on web with nothing left: where the cloud AI is', 'FaLe-App für Android' in quota_text(page), quota_text(page))
            goto(page, '#/werkzeug/zusammenfuegen', 1000)
            check('non-AI tools still work when quota is exhausted', page.locator('#tool-screen').is_visible())
        step('quota exhaustion', quota_exhausted)

        def budget():
            harness('/__test/reset?AI_MONTHLY_BUDGET_EUR=0')
            page.evaluate("localStorage.removeItem('fale-ai-token')")
            goto(page, '#/ki/uebersetzen', 1200)
            page.locator('[data-src="text"]').click()
            page.fill('.ai-paste textarea', 'Hallo')
            page.locator('[data-go]').click()
            page.wait_for_selector('dialog[open]', timeout=6000)
            check('budget cap dialog', 'KI-Kontingent für diesen Monat aufgebraucht' in page.locator('dialog[open]').inner_text())
            close_dialogs(page)
            goto(page, '#/ki', 1200)
            check('hub notes monthly budget', page.locator('.ai-budget-note').count() == 1)
            harness('/__test/reset')
        step('budget cap', budget)

        def not_configured():
            harness('/__test/env?AI_PROVIDER=anthropic&ANTHROPIC_API_KEY=')
            try:
                page.evaluate("async () => (await import('./js/ai/client.js'))._resetStatusCache()")
                goto(page, '#/start', 400)
                goto(page, '#/ki', 1300)
                page.wait_for_selector('.ai-banner.soon', timeout=5000)
                check('KI kommt bald state', 'KI kommt bald' in page.locator('.ai-status').inner_text())
                shot(page, 'desktop_hub_not_configured_light')
                goto(page, '#/ki/zusammenfassen', 1200)
                check('run button disabled when not configured', page.locator('#tool-screen [data-go]').is_disabled())
            finally:
                harness('/__test/env?AI_PROVIDER=mock')
                page.evaluate("async () => (await import('./js/ai/client.js'))._resetStatusCache()")
        step('ai not configured', not_configured)

        def offline():
            ctx.set_offline(True)
            goto(page, '#/ki', 1000)
            page.evaluate("window.dispatchEvent(new Event('offline'))")
            page.wait_for_selector('.ai-banner.off', timeout=4000)
            check('offline banner', 'Du bist offline' in page.locator('.ai-status').inner_text())
            goto(page, '#/ki/chat?doc=' + state['doc'], 1000)
            page.evaluate("window.dispatchEvent(new Event('offline'))")
            page.wait_for_timeout(300)
            check('offline: send disabled', page.locator('[data-send]').is_disabled())
            shot(page, 'desktop_chat_offline_light')
            ctx.set_offline(False)
            page.evaluate("window.dispatchEvent(new Event('online'))")
            page.wait_for_timeout(1800)
            check('back online: send enabled', not page.locator('[data-send]').is_disabled())
        step('offline', offline)

        def settings():
            goto(page, '#/ki/einstellungen', 1000)
            shot(page, 'desktop_settings_light')
            page.locator('label.switch:has([data-cloud])').click()
            page.wait_for_timeout(300)
            n0 = len(api_calls)
            goto(page, '#/ki', 1000)
            check('cloud off → banner, no AI calls', 'Cloud-KI ist ausgeschaltet' in page.locator('.ai-status').inner_text() and not [c for c in api_calls[n0:] if c[2].endswith('/api/ai')])
            page.locator('[data-enable]').click()
            page.wait_for_timeout(800)
            goto(page, '#/ki/einstellungen', 800)
            page.locator('[data-revoke]').click()
            page.locator('dialog[open] button[value="ok"]').click()
            page.wait_for_timeout(300)
            ls = page.evaluate("[localStorage.getItem('fale-ai-consent'), localStorage.getItem('fale-ai-token'), localStorage.getItem('fale-ai-device')]")
            check('revoke deletes consent, token and device id', ls == [None, None, None], str(ls))
        step('settings', settings)

        def plus_web():
            goto(page, '#/ki/plus', 1200)
            check('web: #/ki/plus (no paid offer) redirects to the KI-Werkzeuge page', page.evaluate('location.hash') == '#/werkzeuge/ki', page.evaluate('location.hash'))
            shot(page, 'desktop_plus_light')
        step('plus web', plus_web)

        def dark_shots():
            set_theme(page, 'dark')
            consent_needed = page.locator('[data-consent]')
            goto(page, '#/ki', 1200)
            if consent_needed.count():
                consent(page)
            shot(page, 'desktop_hub_dark')
            goto(page, f"#/ki/chat?doc={state['doc']}", 1300)
            page.fill('.ai-composer textarea', 'Wie hoch ist die Miete?')
            page.locator('[data-send]').click()
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=10000)
            cites = page.locator('.ai-msg .ai-answer .ai-cite').all_inner_texts()
            check('second chat: rent question cites page 4', cites and cites[0] == 'S. 4', str(cites))
            shot(page, 'desktop_chat_dark')
            goto(page, '#/ki/lernkarten', 1000)
            shot(page, 'desktop_study_dark')
            goto(page, '#/start', 900)
            shot(page, 'desktop_start_dark')
            goto(page, '#/werkzeuge/ki', 900)
            shot(page, 'desktop_werkzeuge_ai_dark')
            set_theme(page, 'light')
        step('desktop dark screenshots', dark_shots)

        def image_translate():
            goto(page, '#/ki/bild', 1200)
            with page.expect_file_chooser() as fc:
                page.locator('[data-pick]').click()
            fc.value.set_files(os.path.join(DATA, 'schild.png'))
            try:
                page.wait_for_selector('[data-textbox]:not([hidden])', timeout=60000)
            except Exception:
                check('image OCR (engine available)', False, page.locator('.toasts').inner_text())
                return
            txt = page.locator('[name=text]').input_value()
            check('OCR recognised sign text on device', 'Notausgang' in txt, txt)
            page.select_option('[name=target]', 'de')
            page.locator('[data-go]').click()
            page.wait_for_function("() => document.querySelector('[data-out]').innerText.includes('Notausgang')", timeout=10000)
            check('image translation result', page.locator('[data-out]').inner_text().startswith('[DE]'))
            shot(page, 'desktop_image_translate_light')
        step('image translate', image_translate)
        ctx.close()

        # ================================================================ phone, native (mocked Capacitor + AdMob)
        harness('/__test/reset')
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True, device_scale_factor=2)
        ctx.add_init_script(NATIVE_MOCK)
        page = ctx.new_page()
        PAGES.append(page)
        attach(page, 'native')
        page.goto(URL)
        page.wait_for_selector('#view-start .hero')
        page.wait_for_timeout(500)

        def native_ads():
            check('native mock active', page.evaluate("async () => (await import('./js/platform.js')).isNative()"))
            shot(page, 'phone_start_light')
            goto(page, '#/ki', 1300)
            page.wait_for_selector('[data-consent]', timeout=5000)
            shot(page, 'phone_hub_consent_light')
            consent(page)
            page.wait_for_selector('[data-ai-ad]', timeout=5000)
            check('native: video button shown', 'Video ansehen' in page.locator('[data-ai-ad]').inner_text(), page.locator('[data-ai-ad]').inner_text())
            check('ads SDK not initialised before tapping', page.evaluate("window.__admob.calls.length") == 0)
            shot(page, 'phone_hub_ready_light')
            page.locator('[data-ai-ad]').click()
            page.wait_for_function("() => (document.querySelector('[data-aq-left]') || {}).innerText && document.querySelector('[data-aq-left]').innerText.includes('8 KI-Anfragen')", timeout=15000)
            calls = page.evaluate("window.__admob.calls")
            names = [c[0] for c in calls]
            check('UMP consent requested + form shown before ad', names[:3] == ['initialize', 'requestConsentInfo', 'showConsentForm'], str(names))
            prep = next((c[1] for c in calls if c[0] == 'prepare'), {})
            tok = page.evaluate("localStorage.getItem('fale-ai-token')")
            check('rewarded ad prepared with SSV custom data = device token, test id, personalised after consent', prep.get('ssv', {}).get('customData') == tok and prep.get('adId', '').startswith('ca-app-pub-3940256099942544/') and prep.get('npa') is False, str(prep))
            check('server-verified reward: 8 requests unlocked today', '8 KI-Anfragen freigeschaltet' in quota_text(page), quota_text(page))
            st = harness('/__test/state')
            check('reward recorded server-side once', st['rewards'] == 1)
            shot(page, 'phone_hub_after_reward_light')
            goto(page, '#/ki/plus', 1200)
            check('native Plus without server config: "bald verfügbar"', 'bald verfügbar' in page.locator('#tool-screen .ai-plus').inner_text(), page.locator('#tool-screen .ai-plus').inner_text())
            shot(page, 'phone_plus_light')
        step('native ads', native_ads)

        def phone_flows():
            doc = import_file(page, os.path.join(DATA, 'vertrag.pdf'), 'vertrag.pdf', 'application/pdf')
            goto(page, f'#/ki/chat?doc={doc}', 1300)
            page.fill('.ai-composer textarea', 'Wann beginnt das Mietverhältnis?')
            page.locator('[data-send]').click()
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=10000)
            cites = page.locator('.ai-msg .ai-answer .ai-cite').all_inner_texts()
            check('phone chat cites page 2', cites and cites[0] == 'S. 2', str(cites))
            shot(page, 'phone_chat_light')
            goto(page, f'#/ki/zusammenfassen?doc={doc}', 1200)
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-out] li', timeout=10000)
            shot(page, 'phone_summary_light')
            goto(page, '#/ki/brief', 1200)
            shot(page, 'phone_letter_light')
            goto(page, f'#/ki/lernkarten?doc={doc}', 1200)
            page.locator('[data-go]').click()
            page.wait_for_selector('.ai-card', timeout=10000)
            shot(page, 'phone_flashcard_light')
            set_theme(page, 'dark')
            goto(page, '#/ki', 1200)
            shot(page, 'phone_hub_dark')
            goto(page, f'#/ki/chat?doc={doc}', 1200)
            page.fill('.ai-composer textarea', 'Wie hoch ist die Kaltmiete?')
            page.locator('[data-send]').click()
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=10000)
            shot(page, 'phone_chat_dark')
            goto(page, '#/ki/folien', 1200)
            page.fill('[name=topic]', 'Mülltrennung')
            page.locator('[data-go]').click()
            page.wait_for_selector('[data-prev] .ol-slide', timeout=10000)
            shot(page, 'phone_slides_dark')
            goto(page, '#/ki/einstellungen', 1000)
            check('native settings: ad privacy option', page.locator('[data-adprivacy]').count() == 1)
            page.locator('[data-adprivacy]').click()
            page.wait_for_timeout(500)
            check('ad privacy options form opened', 'showPrivacyOptionsForm' in [c[0] for c in page.evaluate('window.__admob.calls')])
            shot(page, 'phone_settings_dark')
            goto(page, '#/einstellungen', 1000)
            shot(page, 'phone_ich_dark')
            set_theme(page, 'light')
        step('phone flows', phone_flows)

        def phone_layout():
            for h_ in ['#/ki', '#/ki/chat', '#/ki/zusammenfassen', '#/ki/lernkarten', '#/ki/pro', '#/ki/brief']:
                goto(page, h_, 1000)
                w = page.evaluate("() => Math.max(document.querySelector('#tool-screen').scrollWidth, document.documentElement.scrollWidth)")
                check(f'phone: no horizontal overflow {h_}', w <= 392, w)
        step('phone layout', phone_layout)

        def pro_and_videos():
            # the real model: nothing free – one fully watched video unlocks one KI request; FaLe Pro: no videos
            harness('/__test/reset?FREE_DAILY=0&REWARD_BONUS=1')
            page.evaluate("async () => { const C = await import('./js/ai/client.js'); C._resetStatusCache(); await C.ensureToken({ renew: true }); await C.refreshQuota(); }")
            goto(page, '#/werkzeuge/ki', 1300)
            check('KI-Werkzeuge page: „Auf Pro upgraden“ bar on top', page.locator('[data-pro-bar] .pro-bar[data-pro-state="off"]').count() == 1 and 'Auf Pro upgraden' in page.locator('[data-pro-bar]').inner_text())
            vis = page.evaluate("""() => { const v = e => !!(e.offsetWidth || e.offsetHeight); const cards = [...document.querySelectorAll('#view-werkzeuge .tool-card')].filter(v);
              return { ai: cards.filter(c => (c.dataset.tool || '').startsWith('ai-')).length, other: cards.filter(c => !(c.dataset.tool || '').startsWith('ai-')).length,
                       sel: (document.querySelector('[data-tab-link="ki"]') || {}).getAttribute && document.querySelector('[data-tab-link="ki"]').getAttribute('aria-selected') }; }""")
            check('KI-Werkzeuge page shows only the KI tools (tab selected)', vis['ai'] == 14 and vis['other'] == 0 and vis['sel'] == 'true', vis)
            check('KI page explains: one video per request, watch to the end', 'bis zum Ende' in page.locator('[data-ai-access]').inner_text())
            shot(page, 'phone_ki_tab_light')
            goto(page, '#/werkzeuge', 900)
            vis = page.evaluate("""() => { const v = e => !!(e.offsetWidth || e.offsetHeight); const cards = [...document.querySelectorAll('#view-werkzeuge .tool-card')].filter(v);
              return { ai: cards.filter(c => (c.dataset.tool || '').startsWith('ai-')).length, other: cards.filter(c => !(c.dataset.tool || '').startsWith('ai-')).length }; }""")
            check('Werkzeuge page: the normal tools, no KI tools', vis['ai'] == 0 and vis['other'] >= 40, vis)
            doc = import_file(page, os.path.join(DATA, 'vertrag.pdf'), 'vertrag2.pdf', 'application/pdf')
            goto(page, f'#/ki/chat?doc={doc}', 1300)
            check('chat: access line asks for a video', 'ein kurzes Video' in quota_text(page), quota_text(page))
            page.fill('.ai-composer textarea', 'Wann beginnt das Mietverhältnis?')
            page.locator('[data-send]').click()
            page.wait_for_selector('dialog[open] .ai-limit', timeout=8000)
            txt = page.locator('dialog[open]').inner_text()
            check('no Pro, nothing unlocked: dialog offers the video and says „bis zum Ende“', 'Video ansehen' in txt and 'bis zum Ende' in txt and 'FaLe Pro' in txt, txt)
            page.locator('dialog[open] button[value="ad"]').click()
            page.wait_for_selector('.ai-msg-foot:not([hidden])', timeout=20000)
            st = harness('/__test/state')
            check('watched to the end: Google confirms → one request unlocked and used, answer shown', st['rewards'] == 1 and page.locator('.ai-msg .ai-answer .ai-cite').count() >= 1, st['rewards'])
            page.wait_for_timeout(600)
            check('after using it: the next request needs a new video', 'ein kurzes Video' in quota_text(page), quota_text(page))
            # closed early: no reward, no answer
            page.evaluate("window.__admob.closeEarly = true")
            page.fill('.ai-composer textarea', 'Wie hoch ist die Kaltmiete?')
            page.locator('[data-send]').click()
            page.wait_for_selector('dialog[open] .ai-limit', timeout=8000)
            page.locator('dialog[open] button[value="ad"]').click()
            page.wait_for_timeout(1500)
            toasts = page.locator('#toasts').inner_text()
            check('video closed early: no unlock, clear message, no answer', 'nicht bis zum Ende' in toasts and page.locator('.ai-msg-foot:not([hidden])').count() == 1 and harness('/__test/state')['rewards'] == 1, toasts)
            page.evaluate("window.__admob.closeEarly = false")
            # FaLe Pro: no videos, „PRO“ everywhere
            tok = page.evaluate("localStorage.getItem('fale-ai-token')")
            harness('/__test/pro?token=' + tok)
            page.evaluate("async () => { const C = await import('./js/ai/client.js'); C._resetStatusCache(); await C.refreshQuota(); }")
            page.wait_for_timeout(400)
            page.fill('.ai-composer textarea', 'Wie hoch ist die Kaltmiete?')
            page.locator('[data-send]').click()
            page.wait_for_timeout(300)
            check('Pro: no video dialog', page.locator('dialog[open] .ai-limit').count() == 0)
            wait_count(page, '.ai-msg-foot:not([hidden])', 2, 15000)
            check('Pro: answer without video', page.locator('.ai-msg-foot:not([hidden])').count() == 2 and harness('/__test/state')['rewards'] == 1)
            check('Pro: access line says Pro', 'FaLe Pro aktiv' in quota_text(page), quota_text(page))
            goto(page, '#/werkzeuge/ki', 1000)
            check('Pro: bar shows „FaLe Pro ist aktiv“ and the logo carries „PRO“', page.locator('[data-pro-bar] .pro-bar[data-pro-state="on"]').count() == 1
                  and page.evaluate("getComputedStyle(document.querySelector('.brand-pro')).display") != 'none')
            shot(page, 'phone_ki_tab_pro_light')
            goto(page, '#/ki/pro', 1200)
            check('Pro page: compare table + „Du hast FaLe Pro“', page.locator('.pro-compare .pc-row').count() == 6 and 'Du hast FaLe Pro' in page.locator('#tool-screen').inner_text())
            shot(page, 'phone_pro_page_light')
        step('pro and videos', pro_and_videos)
        ctx.close()
        browser.close()

    check('no console errors', not console_problems, '\n'.join(console_problems[:8]))
    passed = sum(1 for r in results if r[1])
    print(f'\n{passed} passed, {len(results) - passed} failed')
    for r in results:
        if not r[1]:
            print('  FAILED:', r[0], str(r[2])[:200] if r[2] else '')
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
