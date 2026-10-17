"""password-generator: crypto-random passwords (sets, look-alikes, length), passphrases (DE/EN lists, separator,
capitalisation, digit), honest strength meter, copy to clipboard, batch + TXT, nothing stored or sent."""
import re
from wtlib import Suite

PATHS = {'de': '/werkzeuge/passwort-generator/', 'en': '/en/tools/password-generator/'}
LOOK = set('Il1O0o')

def values(page):
    return page.locator('.seo-pw-value').all_inner_texts()

def set_range(page, oid, val):
    page.locator(f'#wt-opt-{oid}').evaluate(f"e => {{ e.value = '{val}'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }}")

with Suite('password-generator') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        writes = []
        page.on('request', lambda r: r.method != 'GET' and writes.append(r.url))
        page.wait_for_selector('.seo-pw-value')
        s.expect(page.locator('[data-wt-pick]').is_hidden(), f'{v}: no pick zone')
        pw = values(page)[0]
        s.expect(len(pw) == 20 and re.search('[A-Z]', pw) and re.search('[a-z]', pw) and re.search(r'\d', pw) and re.search(r'[^A-Za-z0-9]', pw) and not LOOK & set(pw), f'{v}: default password {pw!r}')
        st = page.locator('.seo-pw-strength').inner_text()
        s.expect(('Sehr stark' in st or 'Very strong' in st) and re.search(r'1[12]\d', st), f'{v}: strength {st!r}')
        if shots: s.shot(page, 'seo_password_initial')
        page.locator('.seo-pw-regen').click(); page.wait_for_timeout(100)
        s.expect(values(page)[0] != pw, f'{v}: regenerate gives a new password')
        set_range(page, 'length', 32); page.wait_for_timeout(150)
        s.expect(len(values(page)[0]) == 32, f'{v}: length 32')
        # only digits → weak and digits only
        for oid in ('upper', 'lower', 'symbols'):
            page.locator(f'#wt-opt-{oid}').uncheck(force=True)
        page.wait_for_timeout(150)
        s.expect(re.fullmatch(r'\d{32}', values(page)[0]) is not None, f'{v}: digits only {values(page)[0]}')
        page.locator('#wt-opt-digits').uncheck(force=True); page.wait_for_timeout(150)
        s.expect(s.primary(page).is_disabled() and page.locator('.seo-pw .img-note').is_visible(), f'{v}: nothing selected → disabled + hint')
        for oid in ('upper', 'lower', 'digits', 'symbols'):
            page.locator(f'#wt-opt-{oid}').check(force=True)
        # passphrase
        page.locator('input[name="wt-opt-mode"][value="phrase"]').check(force=True)
        page.wait_for_function("() => /^[A-Z][a-z]+(-[A-Z][a-z]+){5}$/.test(document.querySelector('.seo-pw-value')?.textContent || '')", timeout=5000)
        st = page.locator('.seo-pw-strength').inner_text()
        s.expect(re.search(r'6\d', st) and ('Gut' in st or 'Good' in st), f'{v}: 6-word phrase ~65 bits {st!r}')
        if shots: s.shot(page, 'seo_password_phrase')
        page.locator('#wt-opt-separator').select_option(' ')
        page.locator('#wt-opt-capitalize').uncheck(force=True)
        page.locator('#wt-opt-digit').check(force=True); page.wait_for_timeout(200)
        ph = values(page)[0]
        s.expect(re.fullmatch(r'([a-z]+\d? ){5}[a-z]+\d?', ph) and len(re.findall(r'\d', ph)) == 1, f'{v}: phrase options {ph!r}')
        page.locator('#wt-opt-wordLang').select_option('en' if v.lang == 'de' else 'de'); page.wait_for_timeout(300)
        # batch
        page.locator('#wt-opt-count').select_option('10'); page.wait_for_timeout(300)
        lst = values(page)
        s.expect(len(lst) == 10 and len(set(lst)) == 10, f'{v}: batch of 10')
        s.expect(page.locator('.seo-pw-actions .wt-btn', has_text='kopieren' if v.lang == 'de' else 'Copy all').is_visible(), f'{v}: copy all')
        if v.device == 'desktop':
            v.ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
            page.locator('.seo-copy').nth(2).click(); page.wait_for_timeout(200)
            clip = page.evaluate('() => navigator.clipboard.readText()')
            s.expect(clip == lst[2], f'{v}: copied {clip!r}')
        s.check_page(page)
        if s.run(page):
            o = s.download(page, 0)
            s.expect(o.read_text().splitlines() == lst, f'{v}: TXT matches the list')
            s.expect('nicht verschlüsselt' in page.locator('.wt-result').inner_text() or 'not encrypted' in page.locator('.wt-result').inner_text(), f'{v}: TXT warning')
            if shots: s.shot(page, 'seo_password_result', top='.wt-result')
        stored = page.evaluate('() => [localStorage.length, sessionStorage.length]')
        s.expect(stored == [0, 0], f'{v}: nothing stored {stored}')
        s.expect(not writes, f'{v}: nothing sent {writes}')
        s.check_page(page)
    ctx = s.context('phone', 'en', dark=True)
    page = s.open(ctx, PATHS['en']); page.wait_for_selector('.seo-pw-value')
    s.shot(page, 'seo_password_dark'); s.check_page(page)
