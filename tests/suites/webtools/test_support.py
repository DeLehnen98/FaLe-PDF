"""Support page (/unterstuetzen/, /en/support/): reachable from every footer and the "More" menu, honest
"being set up" notice while no payment link is configured, payment buttons only for https links from
tools/support.json, share button copies the link, no third-party requests. Tool results: the quiet support
line appears only from the third result, once per visit, stores nothing until dismissed, then stays away."""
import importlib.util, re, sys
sys.dont_write_bytecode = True   # no __pycache__ inside network/
from pathlib import Path
from wtlib import Suite, FIX

NET = Path(__file__).resolve().parents[3] / 'network'
spec = importlib.util.spec_from_file_location('bp', NET / 'tools' / 'build_pages.py')
bp = importlib.util.module_from_spec(spec); spec.loader.exec_module(bp)

with Suite('support') as s:
    # ---------------------------------------------------------------- builder: links only when configured, https only
    orig = bp.support_config
    bp.support_config = lambda: {}
    html = bp.page_support('de')
    s.expect('wird gerade eingerichtet' in html and 'support-card' not in html, 'no links: honest notice, no buttons')
    s.expect('mailto:' not in html, 'no contact address: no mail button')
    bp.support_config = lambda: {'once': {'url': 'https://pay.example/fale', 'via': 'Beispiel-Anbieter'}, 'monthly': {'url': 'javascript:alert(1)'}, 'contact_email': 'hallo@example.de'}
    html = bp.page_support('de')
    s.expect(html.count('class="support-card"') == 1 and 'https://pay.example/fale' in html and 'javascript:' not in html, 'only https payment links become buttons')
    s.expect('rel="noopener noreferrer"' in html and 'Beispiel-Anbieter' in html, 'payment link: noopener + provider named')
    s.expect('mailto:hallo@example.de?subject=' in html, 'contact address: mail button')
    s.expect('monatlichen Beitrag beenden' not in html, 'no monthly link: no cancel question')
    bp.support_config = orig

    # ---------------------------------------------------------------- the published page
    for v in s.variants():
        path = '/unterstuetzen/' if v.lang == 'de' else '/en/support/'
        page = s.open(v, path, wait_shell=False)
        s.expect(page.locator('h1').count() == 1, f'{v}: page renders')
        s.expect(page.locator('.notice').count() == 1, f'{v}: setup notice while no link is configured')
        s.expect(page.locator(f'.site-foot a[href="{path}"]').count() == 1, f'{v}: footer link')
        s.check_page(page)
        page.close()
    ctx = s.context('desktop', 'de', permissions=['clipboard-read', 'clipboard-write'])
    page = s.open(ctx, '/unterstuetzen/', wait_shell=False)
    page.evaluate('() => { delete Navigator.prototype.share; }')
    btn = page.locator('[data-share-url]')
    btn.click()
    page.wait_for_timeout(200)
    s.expect(page.evaluate('navigator.clipboard.readText()') == 'https://fale.network/werkzeuge/', 'share: link copied')
    s.expect('kopiert' in btn.inner_text(), 'share: confirmation shown')
    page.close()
    # the footer on a tool page and the "More" menu
    page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/')
    s.expect(page.locator('.site-foot a[href="/unterstuetzen/"]').count() == 1, 'tool page footer links the support page')
    s.expect(page.locator('.nav-more-menu a[href="/unterstuetzen/"], [data-nav-more] a[href="/unterstuetzen/"]').count() >= 1, '"More" menu links the support page')
    page.close()

    # ---------------------------------------------------------------- quiet line under results
    page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
    page.evaluate("() => localStorage.removeItem('fale-wt-support')")
    seen = []
    for i in range(4):
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        s.run(page)
        seen.append(page.locator('.wt-result .wt-support').count())
        page.locator('.wt-restart button').last.click()
        page.wait_for_selector('[data-wt-pick]:not([hidden])')
    s.expect(seen == [0, 0, 1, 0], f'support line only on the 3rd result, once per visit ({seen})')
    s.expect(page.evaluate('() => [localStorage.length, sessionStorage.length]') == [0, 0], 'nothing stored just for counting')

    def three_runs():
        page.reload()
        page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
        for i in range(3):
            s.pick(page, 'text3.pdf'); s.wait_ready(page, 1); s.run(page)
            if i < 2:
                page.locator('.wt-restart button').last.click()
                page.wait_for_selector('[data-wt-pick]:not([hidden])')
        return page.locator('.wt-result .wt-support')
    line = three_runs()
    s.expect(line.count() == 1, 'new visit: shown again on the 3rd result')
    line.locator('button').click()
    s.expect(line.count() == 0, 'dismissed')
    s.expect(three_runs().count() == 0, 'stays away after dismissing')
    s.check_page(page)
    page.close()
