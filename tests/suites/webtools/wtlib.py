"""Reusable Playwright helpers for the FaLe Werkzeuge tests.

    from wtlib import Suite
    with Suite('merge-pdf') as s:
        for v in s.variants():                       # DE/EN × phone/desktop
            page = s.open(v, '/werkzeuge/pdf-zusammenfuegen/')
            s.pick(page, 'text3.pdf', 'text5.pdf')
            out = s.run_and_download(page)
            s.expect(s.pdf_pages(out) == 8, 'page count')

Every page opened through Suite.open() fails the suite on console errors, page errors, CSP violations
(securitypolicyviolation) and requests to any origin other than the test server.
Server: node server.mjs 8710 (started by run_all.sh, or by Suite when not running).
"""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
FIX = HERE / 'fixtures'
OUT = HERE / 'out'
SHOTS = HERE / 'shots'
PORT = int(os.environ.get('WT_PORT', '8710'))
ORIGIN = f'http://127.0.0.1:{PORT}'
OUT.mkdir(exist_ok=True)
SHOTS.mkdir(exist_ok=True)

PHONE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
DESKTOP = dict(viewport={'width': 1280, 'height': 900})
INIT = """
window.__wt = { csp: [], errors: [] };
document.addEventListener('securitypolicyviolation', e => window.__wt.csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber));
"""


def server_up():
    try:
        urllib.request.urlopen(ORIGIN + '/werkzeuge/', timeout=2)
        return True
    except Exception:
        return False


class Variant:
    def __init__(self, lang, device, ctx):
        self.lang, self.device, self.ctx = lang, device, ctx

    def __repr__(self):
        return f'{self.lang}/{self.device}'


class Suite:
    def __init__(self, name, headless=True):
        self.name = name
        self.fails = []
        self.notes = []
        self.headless = headless
        self.proc = None

    # ------------------------------------------------------------ lifecycle
    def __enter__(self):
        if not server_up():
            self.proc = subprocess.Popen(['node', str(HERE / 'server.mjs'), str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                if server_up():
                    break
                time.sleep(0.1)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=self.headless)
        self.contexts = []
        return self

    def __exit__(self, *exc):
        for c in self.contexts:
            try:
                c.close()
            except Exception:
                pass
        self.browser.close()
        self.pw.stop()
        if self.proc:
            self.proc.kill()
        if exc[0]:
            self.fails.append(f'exception: {exc[1]!r}')
        status = 'PASS' if not self.fails else 'FAIL'
        print(f'[{status}] {self.name}' + ''.join(f'\n   - {f}' for f in self.fails))
        for n in self.notes:
            print('   ·', n)
        if self.fails:
            sys.exit(1)
        return True

    def context(self, device='phone', lang='de', dark=False, **extra):
        opts = dict(PHONE if device == 'phone' else DESKTOP)
        opts.update(locale='de-DE' if lang == 'de' else 'en-GB', color_scheme='dark' if dark else 'light',
                    accept_downloads=True, service_workers='allow')
        opts.update(extra)
        ctx = self.browser.new_context(**opts)
        ctx.add_init_script(INIT)
        self.contexts.append(ctx)
        return ctx

    def variants(self, langs=('de', 'en'), devices=('phone', 'desktop')):
        for lang in langs:
            for dev in devices:
                yield Variant(lang, dev, self.context(dev, lang))

    # ------------------------------------------------------------ pages
    def open(self, v_or_ctx, path, wait_shell=True):
        ctx = v_or_ctx.ctx if isinstance(v_or_ctx, Variant) else v_or_ctx
        page = ctx.new_page()
        tag = f'{path} [{v_or_ctx!r}]' if isinstance(v_or_ctx, Variant) else path
        page.on('console', lambda m: m.type == 'error' and self.fails.append(f'console error on {tag}: {m.text[:300]}'))
        page.on('pageerror', lambda e: self.fails.append(f'page error on {tag}: {str(e)[:300]}'))

        def on_request(req):
            u = req.url
            if not (u.startswith(ORIGIN) or u.startswith('blob:') or u.startswith('data:')):
                self.fails.append(f'request to foreign origin from {tag}: {u[:200]}')
        page.on('request', on_request)
        page.goto(ORIGIN + path)
        if wait_shell:
            page.wait_for_function("() => document.documentElement.classList.contains('wt-js')", timeout=15000)
        page._wt_tag = tag
        return page

    def check_page(self, page):
        """CSP violations + no horizontal scroll + basic a11y – call before closing a page."""
        tag = getattr(page, '_wt_tag', page.url)
        csp = page.evaluate('window.__wt ? window.__wt.csp : []')
        for c in csp:
            self.fails.append(f'CSP violation on {tag}: {c}')
        sw = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
        if sw[0] > sw[1] + 1:
            self.fails.append(f'horizontal scroll on {tag}: scrollWidth {sw[0]} > {sw[1]}')
        problems = page.evaluate(A11Y)
        for p in problems:
            self.fails.append(f'a11y on {tag}: {p}')

    # ------------------------------------------------------------ tool actions
    def pick(self, page, *names, selector='[data-wt-input]'):
        page.set_input_files(selector, [str(FIX / n) for n in names])

    def wait_ready(self, page, n=None, timeout=20000):
        """Wait until n file cards are prepared (thumbnail or error/lock shown) and the button state settled."""
        page.wait_for_function("""n => {
          const cards = [...document.querySelectorAll('.wt-file')];
          if (n != null && cards.length !== n) return false;
          return cards.length && cards.every(c => c.querySelector('.wt-thumb.has-img') || c.classList.contains('is-error') || c.classList.contains('is-locked'));
        }""", arg=n, timeout=timeout)

    def primary(self, page):
        return page.locator('.wt-bar .wt-btn-primary')

    def run(self, page, timeout=90000):
        self.primary(page).click()
        page.wait_for_selector('.wt-result:not([hidden]), .wt-error:not([hidden])', timeout=timeout)
        if page.locator('.wt-error:not([hidden])').count():
            self.fails.append(f'tool error on {page._wt_tag}: {page.locator(".wt-error").inner_text()[:300]}')
            return False
        return True

    def download(self, page, index=0, name=None):
        with page.expect_download() as d:
            page.locator('.wt-output .wt-btn-primary').nth(index).click()
        dl = d.value
        path = OUT / f'{self.name}-{len(list(OUT.glob(self.name + "-*")))}' / (name or dl.suggested_filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        dl.save_as(path)
        return path

    def download_click(self, page, locator):
        """Click any element that triggers a download, return the saved path."""
        with page.expect_download() as d:
            (page.locator(locator) if isinstance(locator, str) else locator).click()
        path = OUT / f'{self.name}-{len(list(OUT.glob(self.name + "-*")))}' / d.value.suggested_filename
        path.parent.mkdir(parents=True, exist_ok=True)
        d.value.save_as(path)
        return path

    def run_and_download(self, page, name=None):
        if not self.run(page):
            return None
        return self.download(page, 0, name)

    def shot(self, page, name, full=False, top=None):
        if top:
            page.evaluate("s => document.querySelector(s)?.scrollIntoView({block: 'start'})", top)
            page.wait_for_timeout(150)
        page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=full)

    # ------------------------------------------------------------ verification
    def expect(self, cond, msg):
        if not cond:
            self.fails.append(msg)
        return cond

    @staticmethod
    def pdf_pages(path):
        out = subprocess.run(['pdfinfo', str(path)], capture_output=True, text=True).stdout
        for line in out.splitlines():
            if line.startswith('Pages:'):
                return int(line.split()[1])
        return -1

    @staticmethod
    def pdf_info(path, password=None):
        args = ['pdfinfo'] + (['-upw', password] if password else []) + [str(path)]
        out = subprocess.run(args, capture_output=True, text=True)
        info = {}
        for line in out.stdout.splitlines():
            if ':' in line:
                k, v = line.split(':', 1)
                info[k.strip()] = v.strip()
        info['_rc'] = out.returncode
        return info

    @staticmethod
    def pdf_text(path, password=None):
        args = ['pdftotext'] + (['-upw', password] if password else []) + ['-layout', str(path), '-']
        return subprocess.run(args, capture_output=True, text=True).stdout

    @staticmethod
    def qpdf_check(path, password=None):
        args = ['qpdf', '--check'] + ([f'--password={password}'] if password else []) + [str(path)]
        r = subprocess.run(args, capture_output=True, text=True)
        return r.returncode in (0, 3), (r.stdout + r.stderr)[-400:]

    @staticmethod
    def render(path, page=1, dpi=30):
        """Render one page with pdftoppm → PIL image."""
        from PIL import Image
        prefix = OUT / f'_render_{Path(path).stem}_{page}'
        subprocess.run(['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-png', '-singlefile', str(path), str(prefix)], check=True)
        return Image.open(str(prefix) + '.png').convert('RGB')

    @staticmethod
    def page_sizes(path):
        out = subprocess.run(['pdfinfo', '-f', '1', '-l', '999', str(path)], capture_output=True, text=True).stdout
        sizes = []
        for line in out.splitlines():
            if line.startswith('Page') and 'size:' in line:
                parts = line.split('size:')[1].split()
                sizes.append((float(parts[0]), float(parts[2])))
        return sizes


A11Y = r"""(() => {
  const out = [];
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const name = el => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.getAttribute('title') || '').trim();
  for (const b of document.querySelectorAll('button, a[href], [role=button]')) if (visible(b) && !name(b) && !b.querySelector('img[alt]:not([alt=""])')) out.push('unnamed ' + b.outerHTML.slice(0, 120));
  for (const i of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (i.classList.contains('wt-picker')) continue; // visually hidden picker inputs are wrapped by their <label>
    const ok = i.labels?.length || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.closest('label');
    if (!ok && visible(i)) out.push('unlabelled ' + i.outerHTML.slice(0, 120));
  }
  for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push('img without alt ' + img.src);
  if (document.querySelectorAll('h1').length !== 1) out.push('h1 count ' + document.querySelectorAll('h1').length);
  if (!document.documentElement.lang) out.push('no lang');
  const small = [...document.querySelectorAll('.wt-app button, .wt-app label.wt-chipbtn, .wt-bar button')].filter(b => visible(b)).filter(b => { const r = b.getBoundingClientRect(); return r.height < 40 || r.width < 40; });
  for (const b of small) out.push('touch target < 40px: ' + (name(b) || b.className).slice(0, 60));
  return out;
})()"""

# NOTE for test authors: page.wait_for_function / evaluate must get a function ("() => …"), not a bare
# expression – bare expressions are run with eval(), which the tool pages' CSP correctly refuses.
