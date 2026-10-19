"""E2E tests for the FaLe PDF cloud-AI features (js/ai/*) against the local harness:
   node ai_harness.mjs 8799   (static app + /api/* with mock provider + in-memory store)
No real provider calls, no real ads. Screenshots → out_ai/."""
import os, sys, json, base64, shutil, traceback, re, time
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(SP, 'ai_data')
OUT = os.path.join(SP, 'out_ai')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('AI_URL', 'http://127.0.0.1:9409/')
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
            check('werkzeuge: KI section with 9 cards', page.locator('[data-ai-section] .tool-card').count() == 9)
            check('werkzeuge: Alltag section still 6 cards', page.locator('.alltag-grid .tool-card:not([data-tool^="web-"])').count() == 6)
            page.fill('#tool-search', 'Lernkarten')
            page.wait_for_timeout(300)
            check('werkzeuge search finds AI card', page.locator('[data-ai-section] .tool-card:not([hidden])').count() == 1)
            page.fill('#tool-search', '')
            page.dispatch_event('#tool-search', 'input')
            goto(page, '#/einstellungen', 900)
            check('ich: KI status card', 'Noch nicht eingerichtet' in page.locator('[data-ai-me]').inner_text())
            check('ich: text no longer claims "keine Uploads, keine Werbung"', 'keine Uploads, keine Werbung' not in page.locator('#view-einstellungen').inner_text())
        step('start without network', no_network_on_start)

        def hub_and_consent():
            goto(page, '#/ki', 1200)
            page.wait_for_selector('.ai-status[data-state]')
            page.wait_for_selector('[data-consent]', timeout=5000)
            check('hub: needs consent banner', page.locator('.ai-banner.consent').count() == 1)
            check('hub: 9 feature cards', page.locator('.ai-hub .ai-grid .tool-card').count() == 9)
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
            check('quota after consent: 5 of 5', 'Heute noch 5 von 5 gratis' in quota_text(page), quota_text(page))
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
            check('quota decremented (4 of 5)', 'Heute noch 4 von 5' in quota_text(page), quota_text(page))
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
            check('quota dialog: friendly, no ad offer and no Plus upsell on web', 'aufgebraucht' in txt and 'Werbevideo' not in txt and 'FaLe Plus' not in txt, txt)
            shot(page, 'desktop_quota_exhausted_light')
            close_dialogs(page)
            check('quota widget shows 0', 'Kontingent für heute aufgebraucht' in quota_text(page), quota_text(page))
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
            check('web: #/ki/plus redirects to the AI hub', page.evaluate('location.hash') == '#/ki', page.evaluate('location.hash'))
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
            goto(page, '#/werkzeuge', 900)
            page.locator('[data-ai-section]').scroll_into_view_if_needed()
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
            check('native: ad button shown', 'Werbevideo ansehen (+3)' in page.locator('[data-ai-ad]').inner_text())
            check('ads SDK not initialised before tapping', page.evaluate("window.__admob.calls.length") == 0)
            shot(page, 'phone_hub_ready_light')
            page.locator('[data-ai-ad]').click()
            page.wait_for_function("() => (document.querySelector('[data-aq-left]') || {}).innerText && document.querySelector('[data-aq-left]').innerText.includes('von 8')", timeout=15000)
            calls = page.evaluate("window.__admob.calls")
            names = [c[0] for c in calls]
            check('UMP consent requested + form shown before ad', names[:3] == ['initialize', 'requestConsentInfo', 'showConsentForm'], str(names))
            prep = next((c[1] for c in calls if c[0] == 'prepare'), {})
            tok = page.evaluate("localStorage.getItem('fale-ai-token')")
            check('rewarded ad prepared with SSV custom data = device token, test id, personalised after consent', prep.get('ssv', {}).get('customData') == tok and prep.get('adId', '').startswith('ca-app-pub-3940256099942544/') and prep.get('npa') is False, str(prep))
            check('server-verified reward: 8 requests today', 'von 8' in quota_text(page), quota_text(page))
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
            for h_ in ['#/ki', '#/ki/chat', '#/ki/lernkarten', '#/ki/plus', '#/ki/brief']:
                goto(page, h_, 1000)
                w = page.evaluate("() => Math.max(document.querySelector('#tool-screen').scrollWidth, document.documentElement.scrollWidth)")
                check(f'phone: no horizontal overflow {h_}', w <= 392, w)
        step('phone layout', phone_layout)
        ctx.close()
        browser.close()

    check('no console errors', not console_problems, '\n'.join(console_problems[:8]))
    passed = sum(1 for r in results if r[1])
    print(f'\n{passed} passed, {len(results) - passed} failed')
    for r in results:
        if not r[1]:
            print('  FAILED:', r[0], r[2][:200] if r[2] else '')
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
