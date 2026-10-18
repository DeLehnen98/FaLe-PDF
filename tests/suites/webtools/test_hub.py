"""Hub pages: instant search, category chips, popular row, works without JavaScript, screenshots."""
from wtlib import Suite
import glob, json
SPECS=[json.load(open(f)) for f in glob.glob("/home/claude/FalePDF/network/tools/webtools/specs/*.json")]
N=len(SPECS)
OPT=sorted(x["id"] for x in SPECS if x["category"]=="optimize")

def visible_tools(page):
    return page.evaluate("() => [...document.querySelectorAll('[data-wt-catsec]:not([hidden]) [data-wt-tool]:not([hidden])')].map(c => c.dataset.wtTool)")

with Suite('hub') as s:
    for dark in (False, True):
        ctx = s.context('phone', 'de', dark=dark)
        page = s.open(ctx, '/werkzeuge/')
        s.shot(page, 'hub_phone' + ('_dark' if dark else ''))
        s.check_page(page)
    shown = lambda: page.locator('[data-wt-catsec] [data-wt-tool]:visible').count()
    s.expect(shown() == 0 and page.locator('details[data-wt-catsec] > summary:visible').count() >= 6, 'topics collapsed initially')
    s.expect(page.locator('[data-wt-popular] [data-wt-tool]').count() <= 8, 'popular row short (max 8)')
    page.fill('[data-wt-q]', 'zusammen')
    s.expect('merge-pdf' in visible_tools(page) and len(visible_tools(page)) < 6, f'search "zusammen": {visible_tools(page)}')
    s.expect(page.locator('[data-wt-catsec] [data-wt-tool="merge-pdf"]:visible').count() == 1, 'search opens the matching topic')
    s.expect(page.locator('[data-wt-popular]').is_hidden(), 'popular row hidden while searching')
    page.fill('[data-wt-q]', 'verkleinern')
    s.expect('compress-pdf' in visible_tools(page), f'search "verkleinern" (keyword): {visible_tools(page)}')
    page.fill('[data-wt-q]', 'xyzzy')
    s.expect(page.locator('[data-wt-nohits]').is_visible() and not visible_tools(page), 'no-hits message')
    page.fill('[data-wt-q]', '')
    s.expect(len(visible_tools(page)) == N, 'all tools after clearing')
    s.expect(shown() == 0 and page.locator('[data-wt-popular]').is_visible(), 'topics collapse again, popular back')
    page.click('#optimieren > summary')
    s.expect(page.locator('#optimieren [data-wt-tool]:visible').count() == len(OPT), 'topic opens on tap')
    page.goto(page.url.split('#')[0] + '#bilder'); page.reload(); page.wait_for_timeout(300)
    s.expect(page.locator('#bilder').get_attribute('open') is not None, 'deep link #bilder opens that topic')
    with page.expect_navigation():
        page.locator('[data-wt-popular] a', has_text='PDF komprimieren').click()
    s.expect(page.url.endswith('/werkzeuge/pdf-komprimieren/'), 'card link')

    # search from the home page (form GET ?q=) + "Beste Treffer": the obvious tool comes first
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/', wait_shell=False)
    page.fill('#home-q', 'unterschreiben'); page.press('#home-q', 'Enter'); page.wait_for_url('**/werkzeuge/?q=*'); page.wait_for_timeout(400)
    best = page.eval_on_selector_all('.wt-best:not([hidden]) .wt-card-name', 'els => els.map(e => e.textContent)')
    s.expect(best[:1] == ['PDF unterschreiben'], f'home search → best match first: {best}')
    s.expect(page.locator('[data-wt-q]').input_value() == 'unterschreiben', 'search word carried over')
    page.goto(page.url.split('?')[0] + '?q=verkleinern'); page.wait_for_timeout(400)
    best = page.eval_on_selector_all('.wt-best:not([hidden]) .wt-card-name', 'els => els.map(e => e.textContent)')
    s.expect(best[:1] == ['PDF komprimieren'], f'"verkleinern" → PDF komprimieren first: {best}')
    page.fill('[data-wt-q]', ''); page.wait_for_timeout(200)
    s.expect(page.locator('.wt-best').is_hidden(), 'best matches hidden after clearing')
    page = s.open(ctx, '/', wait_shell=False)
    s.expect(page.locator('.tasks a.task').count() == 8 and page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'home: 8 task buttons, no horizontal scroll')
    s.check_page(page)

    ctx = s.context('desktop', 'en')
    page = s.open(ctx, '/en/tools/')
    page.fill('[data-wt-q]', 'jpeg')
    s.expect('jpg-to-pdf' in visible_tools(page), f'EN search "jpeg": {visible_tools(page)}')
    s.shot(page, 'hub_desktop_en')
    s.check_page(page)

    # without JavaScript: a plain, complete list
    ctx = s.context('phone', 'de', java_script_enabled=False)
    page = s.open(ctx, '/werkzeuge/', wait_shell=False)
    s.expect(page.locator('[data-wt-search]').is_hidden(), 'search hidden without JS')
    s.expect(page.locator('[data-wt-catsec] a').count() == N, 'all tools listed without JS (in the collapsible topics)')
    page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/', wait_shell=False)
    s.expect(page.locator('noscript').count() == 1, 'noscript hint on tool pages')
