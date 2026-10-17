"""Share target: a multipart POST to the share action (what Android sends after "Share → FaLe Werkzeuge")
is stored by the service worker and the hub offers matching tools."""
import base64
from wtlib import Suite, FIX

POST = """async ([b64, name, type, action]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const fd = new FormData();
  if (b64) fd.append('files', new File([bytes], name, { type }));
  fd.append('title', 'test');
  const res = await fetch(action, { method: 'POST', body: fd });
  return [res.redirected, new URL(res.url).pathname + new URL(res.url).search, res.status];
}"""

with Suite('share-target') as s:
    for lang, hub, action in (('de', '/werkzeuge/', '/werkzeuge/teilen/'), ('en', '/en/tools/', '/en/tools/share/')):
        ctx = s.context('phone', lang)
        page = s.open(ctx, hub)
        page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
        b64 = base64.b64encode((FIX / 'text5.pdf').read_bytes()).decode()
        r = page.evaluate(POST, [b64, 'Rechnung.pdf', 'application/pdf', action])
        s.expect(r[1] == (hub + ('?geteilt=1' if lang == 'de' else '?shared=1')) and r[2] == 200, f'{lang}: share POST result {r}')
        page.goto(f'http://127.0.0.1:8710{r[1]}')
        page.wait_for_selector('[data-wt-shared]:not([hidden])')
        if lang == 'de':
            s.shot(page, 'hub_phone_shared')
        names = page.locator('[data-wt-shared-list] li:not([hidden]) .wt-card-name').all_inner_texts()
        s.expect(any(('omprim' in n or 'ompress' in n) for n in names) and not any((n.startswith('Bild') or n.startswith('JPG') or n.startswith('Image')) for n in names) and len(names) <= 8 and page.locator('.wt-shared-more').is_visible(), f'{lang}: tools offered for a PDF: {names}')
        s.expect('Rechnung.pdf' in page.locator('[data-wt-shared-files]').inner_text(), f'{lang}: shared file name shown')
        with page.expect_navigation():
            page.locator('[data-wt-shared-list] a[href*="komprimieren"], [data-wt-shared-list] a[href*="compress-pdf"]').click()   # batch tool also mentions compressing
        page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
        s.wait_ready(page, 1)
        s.expect(page.locator('.wt-file .wt-file-name').inner_text() == 'Rechnung.pdf', f'{lang}: shared file loaded into the tool')
        s.check_page(page)
        # an empty share says so
        r = page.evaluate(POST, ['', '', '', action])
        page.goto(f'http://127.0.0.1:8710{r[1]}')
        page.wait_for_selector('[data-wt-shared]:not([hidden])')
        txt = page.locator('[data-wt-shared-files]').inner_text()
        s.expect(('keine Dateien' in txt) if lang == 'de' else ('No files' in txt), f'{lang}: empty share message: {txt}')
    # without a service worker the share action is a harmless page, not an error
    ctx = s.context('desktop', 'de', service_workers='block')
    p = s.open(ctx, '/werkzeuge/teilen/', wait_shell=False)
    s.expect(p.locator('h1').inner_text() == 'Geteilte Dateien', 'share landing page (GET)')
