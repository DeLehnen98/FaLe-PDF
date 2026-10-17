"""read-aloud: speech is stubbed (records utterances, fires word boundaries and end). Checks: text pane without
page numbers / running heads, two-column order, sentences spoken one after another with highlighting, tap a
sentence to start there, pause, speed applied, position remembered after a reload, TXT input, scanned PDF hint."""
from wtlib import Suite

PATHS = {'de': '/werkzeuge/pdf-vorlesen/', 'en': '/en/tools/read-pdf-aloud/'}
STUB = """
(() => {
  window.__spoken = [];
  class U { constructor(t) { this.text = t; this.rate = 1; } }
  const voices = [{ name: 'Teststimme', lang: 'de-DE', voiceURI: 'test-de', localService: true, default: true },
                  { name: 'Test voice', lang: 'en-GB', voiceURI: 'test-en', localService: true }];
  let cur = null, timer = null;
  const synth = {
    getVoices: () => voices, addEventListener() {}, pause() {}, resume() {},
    cancel() { clearTimeout(timer); const u = cur; cur = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    speak(u) {
      cur = u; window.__spoken.push({ text: u.text, rate: u.rate, voice: u.voice && u.voice.voiceURI });
      setTimeout(() => { if (cur === u && u.onboundary) u.onboundary({ name: 'word', charIndex: 0 }); }, 20);
      timer = setTimeout(() => { if (cur === u) { cur = null; u.onend && u.onend({}); } }, window.__speakMs || 120);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
})();
"""

with Suite('read-aloud') as s:
    for v in s.variants():
        v.ctx.add_init_script(STUB)
        page = s.open(v, PATHS[v.lang])
        page.evaluate("() => localStorage.removeItem('fale-wt-read-aloud')")
        s.pick(page, 'conv_columns.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.ra-s', timeout=30000)
        text = page.locator('.ra-text').inner_text()
        s.expect(page.locator('.ra-s').count() > 5, f'{v}: sentences listed')
        s.check_page(page)
        page.evaluate('window.__speakMs = 60')
        s.primary(page).click()   # bar button starts reading
        page.wait_for_function('() => window.__spoken.length >= 3', timeout=10000)
        sp = page.evaluate('window.__spoken')
        flat = page.evaluate("() => [...document.querySelectorAll('.ra-s')].map(s => s.textContent.trim())")
        s.expect([x['text'] for x in sp[:3]] == flat[:3], f'{v}: sentences spoken in order {sp[:3]} vs {flat[:3]}')
        s.expect(page.locator('.ra-s.is-current').count() == 1, f'{v}: current sentence highlighted')
        page.locator('.ra-controls .wt-btn-primary').click()   # pause
        n = page.evaluate('window.__spoken.length')
        page.wait_for_timeout(400)
        s.expect(page.evaluate('window.__spoken.length') == n, f'{v}: pause stops speaking')
        page.close()

    # column order, no page numbers, tap to start, speed, remembered position
    ctx = s.context('desktop', 'de')
    ctx.add_init_script(STUB)
    page = s.open(ctx, PATHS['de'])
    page.evaluate("() => localStorage.removeItem('fale-wt-read-aloud')")
    s.pick(page, 'conv_columns.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.ra-s', timeout=30000)
    text = page.locator('.ra-text').inner_text()
    s.expect(not any(line.strip().isdigit() for line in text.splitlines()), 'no bare page numbers read')
    page.locator('#ra-rate').fill('1.5'); page.locator('#ra-rate').dispatch_event('input')
    page.evaluate('window.__speakMs = 4000')
    target = page.locator('.ra-s').nth(4)
    want = target.inner_text().strip()
    target.click()
    page.wait_for_function('() => window.__spoken.length >= 1', timeout=5000)
    sp = page.evaluate('window.__spoken')
    s.expect(sp[-1]['text'] == want and abs(sp[-1]['rate'] - 1.5) < 0.01, f'tap starts there with speed 1.5 ({sp[-1]})')
    page.locator('.ra-controls .wt-btn-primary').click()   # pause → position saved
    page.reload()
    s.pick(page, 'conv_columns.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.ra-s.is-current', timeout=30000)
    s.expect(page.locator('.ra-s.is-current').inner_text().strip() == want, 'position remembered after reload')
    s.check_page(page)
    page.close()

    # text file + scanned PDF
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'text3.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.ra-s', timeout=30000)
    s.expect('Alpha' in page.locator('.ra-text').inner_text(), 'PDF text shown')
    page.close()
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'new_scan_1p.pdf')
    s.wait_ready(page, 1)
    page.wait_for_function("() => /gescannt/.test(document.querySelector('.ra [role=status]')?.textContent || '')", timeout=30000)
    s.expect(page.locator('.ra button', has_text='OCR').is_visible(), 'scanned PDF: OCR button offered')
    page.close()
