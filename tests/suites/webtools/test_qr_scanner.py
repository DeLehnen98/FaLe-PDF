"""qr-scanner: images (clean, tilted photo JPG, several codes, PDF page 2, no code), camera (fake stream from a
canvas: single hit stops the camera, series keeps going, denied access explains itself), link verdicts (open only
on tap, risky links need a second tap), Wi-Fi password masked + copy, payment code with IBAN check, contact as
.vcf, two-factor keys never shown/stored/exported, paste + drop through the shell, history after reload + clear,
CSV export with formula guard, built-in detector path (product barcode), camera allowed only on this page."""
import base64, csv, io, subprocess, urllib.request
from pathlib import Path
from wtlib import Suite, FIX, ORIGIN

HERE = Path(__file__).resolve().parent
if not (FIX / 'qrscan' / 'qr_photo.jpg').exists():
    subprocess.run(['python3', str(HERE / 'qrscan_make_fixtures.py')], check=True)
Q = FIX / 'qrscan'
PATHS = {'de': '/werkzeuge/qr-code-scannen/', 'en': '/en/tools/scan-qr-code/'}
IMG64 = base64.b64encode((Q / 'qr_link.png').read_bytes()).decode()
STUB = """
(() => {
  window.__opened = [];
  window.open = (u) => { window.__opened.push(String(u)); return null; };
  window.__camImg = 'data:image/png;base64,%s';
  window.__camStreams = [];
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
    if (window.__camDeny) throw new DOMException('denied', 'NotAllowedError');
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const g = cv.getContext('2d');
    const img = new Image(); img.src = window.__camImg; await img.decode();
    const draw = () => { g.fillStyle = '#bbb'; g.fillRect(0, 0, 1280, 720); if (!window.__camBlank) g.drawImage(img, 420, 110, 500, 500); };
    draw();
    const st = cv.captureStream(15);
    const iv = setInterval(draw, 66);
    st.getVideoTracks()[0].addEventListener('ended', () => clearInterval(iv));
    window.__camStreams.push(st);
    return st;
  };
})();
""" % IMG64


def pick(page, name):
    page.set_input_files('.qs-file', str(Q / name))


def cards(page):
    return page.locator('.qs-card')


def wait_cards(page, n, timeout=30000):
    page.wait_for_function('n => document.querySelectorAll(".qs-card").length >= n', arg=n, timeout=timeout)


with Suite('qr-scanner') as s:
    # ---------------------------------------------------------------- every variant: image → link card → open on tap
    for v in s.variants():
        v.ctx.add_init_script(STUB)
        page = s.open(v, PATHS[v.lang])
        page.evaluate("() => localStorage.removeItem('fale-wt-qr-scan')")
        s.expect(page.locator('[data-wt-pick]').is_hidden(), f'{v}: no shell pick zone')
        s.expect(page.locator('.qs-start-btn').is_visible(), f'{v}: camera button shown')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to export yet')
        pick(page, 'qr_link.png')
        wait_cards(page, 1)
        c = cards(page).first
        s.expect(c.locator('.qs-site').inner_text() == 'fale.network', f'{v}: destination shown')
        s.expect(c.locator('.qs-verdict.qs-lvl-ok').count() == 1, f'{v}: clean link verdict ok')
        s.expect(page.evaluate('window.__opened.length') == 0, f'{v}: nothing opened by itself')
        c.locator('.qs-actions .wt-btn-primary').click()
        s.expect(page.evaluate('window.__opened') == ['https://fale.network/werkzeuge/'], f'{v}: opened on tap')
        s.expect(not s.primary(page).is_disabled(), f'{v}: export enabled')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de', permissions=['clipboard-read', 'clipboard-write'])
    ctx.add_init_script(STUB)

    # ---------------------------------------------------------------- phishing link: two taps
    page = s.open(ctx, PATHS['de'])
    page.evaluate("() => localStorage.removeItem('fale-wt-qr-scan')")
    pick(page, 'qr_phish.png')
    wait_cards(page, 1)
    c = cards(page).first
    s.expect(c.locator('.qs-verdict.qs-lvl-warn').count() == 1, 'phish: warning verdict')
    s.expect(c.locator('.qs-site').inner_text() == 'example.xyz', f'phish: real domain {c.locator(".qs-site").inner_text()}')
    vt = c.locator('.qs-verdict').inner_text()
    s.expect('.xyz' in vt and 'login' in vt, f'phish: reasons listed ({vt[:200]})')
    btn = c.locator('.qs-open-risky')
    btn.click()
    s.expect(page.evaluate('window.__opened.length') == 0, 'phish: first tap does not open')
    s.expect('Trotzdem' in btn.inner_text(), 'phish: asks again')
    btn.click()
    s.expect(len(page.evaluate('window.__opened')) == 1, 'phish: second tap opens')

    # ---------------------------------------------------------------- Wi-Fi: masked password, show, copy
    pick(page, 'qr_wifi.png')
    wait_cards(page, 2)
    c = page.locator('.qs-card-wifi').first
    s.expect('geheim123' not in c.inner_text(), 'wifi: password masked')
    c.locator('button', has_text='Anzeigen').click()
    s.expect('geheim123' in c.inner_text(), 'wifi: password shown on request')
    c.locator('button', has_text='Passwort kopieren').click()
    page.wait_for_timeout(200)
    s.expect(page.evaluate('navigator.clipboard.readText()') == 'geheim123', 'wifi: password copied')
    s.expect('Café Netz' in c.inner_text(), 'wifi: network name')

    # ---------------------------------------------------------------- payment code: IBAN check, amount
    pick(page, 'qr_epc.png')
    wait_cards(page, 3)
    c = page.locator('.qs-card-payment').first
    t = c.inner_text()
    s.expect('DE89 3704 0044 0532 0130 00' in t and 'Prüfziffer stimmt' in t and '12,50' in t and 'Fale Test e.V.' in t, f'payment card ({t[:300]})')
    s.expect('überklebt' in t or 'Aufkleber' in t, 'payment: sticker warning')

    # ---------------------------------------------------------------- contact → .vcf
    pick(page, 'qr_vcard.png')
    wait_cards(page, 4)
    c = page.locator('.qs-card-contact').first
    vcf = s.download_click(page, c.locator('button', has_text='Kontakt speichern'))
    vt = vcf.read_text('utf-8')
    s.expect(vcf.name.endswith('.vcf') and 'FN:Erika Mustermann' in vt and 'TEL:+49 681 123456' in vt, f'vcard file {vcf.name}')

    # ---------------------------------------------------------------- two-factor key: never shown, never stored
    pick(page, 'qr_otp.png')
    wait_cards(page, 5)
    c = page.locator('.qs-card-otp').first
    s.expect('JBSWY3DPEHPK3PXP' not in page.locator('.qs-results').inner_text(), 'otp: secret not on screen')
    s.expect('Authenticator' in c.inner_text(), 'otp: explained')
    s.expect('JBSWY3DPEHPK3PXP' not in (page.evaluate("localStorage.getItem('fale-wt-qr-scan')") or ''), 'otp: not in history')

    # ---------------------------------------------------------------- formula text + export CSV
    pick(page, 'qr_formula.png')
    wait_cards(page, 6)
    if s.run(page):
        out = s.download(page, 0)
        raw = out.read_bytes()
        s.expect(raw.startswith(b'\xef\xbb\xbf'), 'csv: BOM for spreadsheets')
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';'))
        flat = '\n'.join(';'.join(r) for r in rows)
        s.expect(len(rows) == 7, f'csv: header + 6 rows ({len(rows)})')
        s.expect('JBSWY3DPEHPK3PXP' not in flat, 'csv: no otp secret')
        s.expect(any(r[-1].startswith("'=HYPERLINK") for r in rows), 'csv: formula guarded')
        s.expect(any('geheim123' in r[-1] for r in rows), 'csv: raw content kept')
        page.locator('.wt-result button', has_text='Zurück zum Scanner').click()
        page.wait_for_selector('.qs-start-btn:visible')
    s.check_page(page)

    # ---------------------------------------------------------------- history after reload, open from history, clear
    page.reload()
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    page.wait_for_selector('.qs-hist:not([hidden])')
    hist = page.locator('.qs-hist-item')
    s.expect(hist.count() == 5, f'history: 5 entries without the otp ({hist.count()})')
    page.locator('.qs-hist summary').click()
    hist.first.click()
    wait_cards(page, 1)
    s.expect(cards(page).count() == 1, 'history: entry opens as a card')
    page.locator('.qs-hist button', has_text='Verlauf löschen').click()
    s.expect(page.locator('.qs-hist').is_hidden(), 'history cleared')
    s.expect(page.evaluate("JSON.parse(localStorage.getItem('fale-wt-qr-scan')).items.length") == 0, 'history storage empty')
    page.close()

    # ---------------------------------------------------------------- photo, multi, PDF, nothing found
    page = s.open(ctx, PATHS['de'])
    pick(page, 'qr_photo.jpg')
    wait_cards(page, 1, timeout=40000)
    s.expect('fale.network' in cards(page).first.inner_text(), 'photo: tilted noisy JPG decoded')
    pick(page, 'qr_multi.png')
    wait_cards(page, 3)
    s.expect(page.locator('.qs-card-contact').count() == 1 and page.locator('.qs-card-text').count() == 1, 'multi: both codes')
    s.expect('👋' in page.locator('.qs-card-text').inner_text(), 'multi: UTF-8 text')
    pick(page, 'qr_invoice.pdf')
    page.wait_for_selector('.qs-card-payment', timeout=40000)
    s.expect('Seite 2' in page.locator('.qs-card-payment').inner_text(), 'pdf: code found on page 2')
    pick(page, 'no_code.png')
    page.wait_for_function("() => /Kein Code/.test(document.querySelector('.qs-status').textContent)", timeout=30000)
    s.expect(cards(page).count() == 4, 'no code: nothing added')
    s.check_page(page)
    page.close()

    # ---------------------------------------------------------------- paste + drop go through the shell to the tool
    page = s.open(ctx, PATHS['de'])
    page.evaluate("""async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }""", base64.b64encode((Q / 'qr_text.png').read_bytes()).decode())
    page.wait_for_selector('.qs-card-text', timeout=20000)
    s.expect(True, 'paste works')
    page.evaluate("""async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
      for (const t of ['dragenter', 'dragover', 'drop']) document.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }""", base64.b64encode((Q / 'qr_wifi.png').read_bytes()).decode())
    page.wait_for_selector('.qs-card-wifi', timeout=20000)
    s.expect(True, 'drop works')
    page.close()

    # ---------------------------------------------------------------- camera: single hit, series, denied
    for dev in ('phone', 'desktop'):
        cctx = s.context(dev, 'de')
        cctx.add_init_script(STUB)
        page = s.open(cctx, PATHS['de'])
        page.locator('.qs-start-btn').click()
        page.wait_for_selector('.qs-card', timeout=20000)
        page.wait_for_selector('.qs-again:not([hidden])')
        s.expect(page.evaluate("window.__camStreams.every(st => st.getVideoTracks().every(t => t.readyState === 'ended'))"), f'camera {dev}: stopped after a hit')
        s.expect('fale.network' in cards(page).first.inner_text(), f'camera {dev}: link read')
        s.expect(page.evaluate('window.__opened.length') == 0, f'camera {dev}: link not opened')
        s.check_page(page)
        # series: keep scanning, no duplicate cards
        page.locator('label[for=wt-opt-series]').click()
        page.locator('.qs-again').click()
        page.wait_for_selector('.qs-cam:not([hidden])')
        page.wait_for_timeout(1500)
        s.expect(page.locator('.qs-again').is_hidden() and cards(page).count() == 1, f'camera {dev}: series keeps scanning without duplicates')
        page.evaluate("window.__camImg = 'data:image/png;base64,' + %r" % base64.b64encode((Q / 'qr_wifi.png').read_bytes()).decode())
        page.locator('.qs-stop').click()
        page.locator('.qs-start-btn').click()
        page.wait_for_selector('.qs-card-wifi', timeout=20000)
        s.expect(cards(page).count() == 2, f'camera {dev}: second code in series')
        page.locator('.qs-stop').click()
        s.expect(page.evaluate("window.__camStreams.every(st => st.getVideoTracks().every(t => t.readyState === 'ended'))"), f'camera {dev}: stop releases the camera')
        s.record_freeze(page)
        page.close()

    page = s.open(ctx, PATHS['de'])
    page.evaluate('window.__camDeny = true')
    page.locator('.qs-start-btn').click()
    page.wait_for_selector('.qs-err:not([hidden])')
    s.expect('nicht erlaubt' in page.locator('.qs-err').inner_text(), 'camera denied: explained')
    page.close()

    # ---------------------------------------------------------------- built-in detector path (product barcode)
    bctx = s.context('phone', 'en')
    bctx.add_init_script(STUB + """
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code', 'ean_13']; }
      constructor() {} async detect() { return [{ rawValue: '4006381333931', format: 'ean_13', cornerPoints: [{x:1,y:1},{x:50,y:1},{x:50,y:20},{x:1,y:20}] }]; } };
    """)
    page = s.open(bctx, PATHS['en'])
    pick(page, 'no_code.png')
    page.wait_for_selector('.qs-card-product', timeout=20000)
    t = page.locator('.qs-card-product').inner_text()
    s.expect('EAN-13' in t and '4006381333931' in t and 'correct' in t, f'detector: product code ({t[:200]})')
    s.check_page(page)
    page.close()

    # ---------------------------------------------------------------- camera is allowed on this page only
    def pp(path):
        return urllib.request.urlopen(ORIGIN + path).headers.get('Permissions-Policy', '')
    s.expect('camera=(self)' in pp('/werkzeuge/qr-code-scannen/') and 'camera=(self)' in pp('/en/tools/scan-qr-code/'), 'camera allowed on the scanner')
    s.expect('camera=()' in pp('/werkzeuge/qr-code-erstellen/') and 'camera=()' in pp('/werkzeuge/'), 'camera still blocked elsewhere')
