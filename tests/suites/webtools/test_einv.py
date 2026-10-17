"""read-e-invoice: XRechnung UBL (attachment, allowance, 19/7 %), CII with SEPA direct debit, UBL credit note,
ZUGFeRD/Factur-X PDF (XML from the PDF, optional XML output), wrong sums + invalid IBAN, not an invoice,
ordinary PDF, ZUGFeRD 1; GiroCode in the stage decoded; readable PDF text; EN page."""
import os, re, subprocess
os.environ.setdefault('WT_PORT', '8791')
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/e-rechnung-lesen/', 'en': '/en/tools/read-e-invoice/'}
if not (FIX / 'einv' / 'zugferd.pdf').exists():
    subprocess.run(['node', str(FIX.parent / 'einv_make_fixtures.mjs')], check=True)

def flat(t): return re.sub(r'\s+', ' ', t)

def card(page, timeout=20000):
    page.wait_for_selector('.einv-card, .sec-stage .sec-info.is-warn', timeout=timeout)
    return flat(page.locator('.sec-stage').inner_text())

def stage_qr(page):
    return page.evaluate("""async () => {
      const c = document.querySelector('.einv-qr'); if (!c) return null;
      const mod = await import('/assets/wt/lib/img-qrdecode.js');
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return mod.decodeRaster(img, c.width / 4 - 4, 2);
    }""")

with Suite('read-e-invoice') as s:
    for v in s.variants():
        de = v.lang == 'de'
        shots = v.device == 'phone'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, f'read-e-invoice_{v.lang}_phone_initial')

        # ---- XRechnung UBL
        s.pick(page, 'einv/xrechnung_ubl.xml')
        t = card(page)
        s.expect('RE-2026-1042' in t and 'Müller IT-Service' in t, f'{v}: number + seller {t[:200]}')
        s.expect(('1.525,29' if de else '1,525.29') in t, f'{v}: amount due shown')
        s.expect('DE89 3704 0044 0532 0130 00' in t, f'{v}: IBAN formatted')
        s.expect(('XRechnung 3.0 (UBL)') in t, f'{v}: profile name')
        s.expect(page.locator('.einv-checks .is-warn').count() == 0, f'{v}: no warnings for a correct invoice: {t}')
        s.expect(page.locator('.einv-checks .is-ok').count() >= 4, f'{v}: checks listed')
        s.expect('stundenzettel-september.pdf' in t, f'{v}: attachment mentioned')
        qr = stage_qr(page)
        s.expect(qr and qr.startswith('BCD\n002\n1\nSCT\nCOBADEFFXXX\nMüller IT-Service GmbH\nDE89370400440532013000\nEUR1525.29'), f'{v}: GiroCode payload {qr!r}')
        if shots: s.shot(page, f'read-e-invoice_{v.lang}_phone_ubl', full=True)
        if s.run(page):
            pdf = s.download(page, 0)
            txt = flat(s.pdf_text(pdf))
            s.expect(all(x in txt for x in ['RE-2026-1042', 'Müller IT-Service GmbH', 'Kreisstadt Homburg', 'Wartung Server', 'Lizenz Backup-Software', 'Treuerabatt', '04011000-12345-67']), f'{v}: PDF content {txt[:400]}')
            s.expect(('1.525,29' if de else '1,525.29') in txt and ('229,90' if de else '229.90') in txt and ('5,59' if de else '5.59') in txt, f'{v}: PDF totals')
            s.expect(('maßgeblich ist die XML' if de else 'legally relevant original') in txt, f'{v}: PDF footer note')
            s.expect(page.locator('.wt-output').count() == 2, f'{v}: readable PDF + attachment as outputs ({page.locator(".wt-output").count()})')
            att = s.download(page, 1)
            s.expect(att.name.endswith('.pdf') and 'Stundenzettel' in s.pdf_text(att), f'{v}: attachment decoded {att.name}')
            if shots: s.shot(page, f'read-e-invoice_{v.lang}_phone_result')
        page.close()

        # ---- ZUGFeRD PDF + XML option
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'einv/zugferd.pdf')
        t = card(page)
        s.expect('2026-0815' in t and 'Grünwerk Gartenbau' in t and (('aus der PDF gelesen' if de else 'read from the PDF') in t), f'{v}: ZUGFeRD read from PDF {t[:200]}')
        s.expect('ZUGFeRD / Factur-X EN 16931' in t, f'{v}: ZUGFeRD profile')
        s.expect(('362,95' if de else '362.95') in t, f'{v}: ZUGFeRD amount')
        qr = stage_qr(page)
        s.expect(qr and 'DE02120300000000202051' in qr and 'EUR362.95' in qr, f'{v}: ZUGFeRD GiroCode {qr!r}')
        s.expect(page.locator('.wt-opts-sec .wt-opt').count() == 0, f'{v}: no settings needed')
        if s.run(page):
            s.expect(page.locator('.wt-output').count() == 2, f'{v}: PDF + XML outputs')
            x = s.download(page, 1)
            s.expect(x.name.endswith('.xml') and 'CrossIndustryInvoice' in x.read_text(encoding='utf-8'), f'{v}: XML extracted {x.name}')
        page.close()

        # ---- direct debit (CII)
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'einv/xrechnung_cii_lastschrift.xml')
        t = card(page)
        s.expect(('per Lastschrift eingezogen' if de else 'collected by direct debit') in t, f'{v}: direct debit note')
        s.expect(page.locator('.einv-qr').count() == 0, f'{v}: no GiroCode for direct debit')
        s.expect('XRechnung 3.0 (CII)' in t, f'{v}: CII profile')
        s.expect((('fällig seit' if de else 'overdue by')) in t, f'{v}: overdue date shown')
        if s.run(page):
            txt = flat(s.pdf_text(s.download(page, 0)))
            s.expect('MANDAT-0042' in txt and 'DE98ZZZ09999999999' in txt and 'DE02 5001 0517 0137 0750 30' in txt, f'{v}: mandate, creditor id, debited account in PDF')
        page.close()

        # ---- wrong sums + invalid IBAN
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'einv/kaputt_summen.xml')
        t = card(page)
        warns = page.locator('.einv-checks .is-warn').count()
        s.expect(warns >= 3, f'{v}: warnings for wrong sums/IBAN ({warns}) {t}')
        s.expect(('ungültige Prüfziffer' if de else 'invalid check digit') in t, f'{v}: IBAN warning')
        s.expect(page.locator('.einv-qr').count() == 0, f'{v}: no GiroCode with an invalid IBAN')
        if shots: s.shot(page, f'read-e-invoice_{v.lang}_phone_warnings', full=True)
        page.close()

        if v.device != 'desktop':
            continue
        # ---- credit note
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'einv/gutschrift_ubl.xml')
        t = card(page)
        s.expect(('Gutschrift' if de else 'Credit') in t and 'GS-2026-0007' in t and page.locator('.einv-qr').count() == 0, f'{v}: credit note {t[:200]}')
        page.close()
        # ---- errors
        for f, msg in [('einv/kein_einv.xml', ('keine E-Rechnung', 'not an e-invoice')), ('einv/normal.pdf', ('keine E-Rechnung (keine XML-Daten)', 'contains no e-invoice')), ('einv/zugferd1.xml', ('ZUGFeRD-1', 'ZUGFeRD 1'))]:
            page = s.open(v, PATHS[v.lang])
            s.pick(page, f)
            t = card(page)
            s.expect(msg[0 if de else 1] in t, f'{v}: {f} → clear message: {t[:200]}')
            page.close()
