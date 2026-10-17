"""Helpers for the organize/optimize tool tests (agent org)."""
import subprocess, zipfile
from pathlib import Path


def page_texts(path, password=None):
    """First line of text of every page."""
    n = int(next(l.split()[1] for l in subprocess.run(['pdfinfo'] + (['-upw', password] if password else []) + [str(path)], capture_output=True, text=True).stdout.splitlines() if l.startswith('Pages:')))
    out = []
    for i in range(1, n + 1):
        t = subprocess.run(['pdftotext'] + (['-upw', password] if password else []) + ['-f', str(i), '-l', str(i), '-layout', str(path), '-'], capture_output=True, text=True).stdout
        out.append(' '.join(t.split()))
    return out


def rotations(path):
    out = subprocess.run(['pdfinfo', '-f', '1', '-l', '9999', str(path)], capture_output=True, text=True).stdout
    return [int(l.split()[-1]) for l in out.splitlines() if l.startswith('Page') and ' rot:' in l]


def wait_grid(page, n=None, timeout=30000):
    try:
        page.wait_for_function("""n => { const c = document.querySelectorAll('.pg-stage:not([hidden]) .pg-card');
          return c.length > 0 && (n == null || c.length === n); }""", arg=n, timeout=timeout)
    except Exception:
        print('wait_grid failed:', page.evaluate("() => [document.querySelectorAll('.pg-card').length, [...document.querySelectorAll('.pg-stage')].map(x => x.hidden)]"))
        raise


def wait_thumbs(page, k=1, timeout=30000):
    page.wait_for_function("k => document.querySelectorAll('.pg-page.has-img').length >= k", arg=k, timeout=timeout)


def tap(page, v, locator):
    loc = page.locator(locator) if isinstance(locator, str) else locator
    loc.scroll_into_view_if_needed()
    if v.device == 'phone':
        loc.tap()
    else:
        loc.click()


def info(page):
    return page.locator('.pg-bar-info').first.inner_text()


def shots(s, page, v, tool, phase, top='.wt-files-head'):
    if v.device == 'phone' and v.lang == 'de':
        s.shot(page, f'{tool}_{phase}', top=top)


def dark_shot(s, page, tool, phase='result', top='.wt-result'):
    page.emulate_media(color_scheme='dark')
    s.shot(page, f'{tool}_{phase}_dark', top=top)
    page.emulate_media(color_scheme='light')


def all_outputs(s, page):
    """Download every output via the ZIP button (or the single file)."""
    n = page.locator('.wt-output').count()
    if n == 1:
        return [s.download(page)]
    z = s.download_click(page, page.locator('.wt-result-actions button').first)
    d = z.parent / 'unzipped'
    d.mkdir(exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        names = zf.namelist()
        zf.extractall(d)
    return [d / n for n in names]


def error_text(page):
    # real failures show the error card; input hints (nothing selected …) keep the files view and show the
    # message in the sticky bar (shell: err.stay, aud1)
    page.wait_for_selector('.wt-error:not([hidden]), .wt-bar-hint:not([hidden])', timeout=60000)
    if page.locator('.wt-error:not([hidden])').count():
        return page.locator('.wt-error').inner_text()
    return page.locator('.wt-bar-hint').inner_text()


def dismiss_error(page):
    """Leave the error card (if any) – input hints need no dismissing."""
    if page.locator('.wt-error:not([hidden])').count():
        page.locator('.wt-error button').last.click()


def back_to_files(page):
    page.locator('.wt-error:not([hidden]) button, .wt-restart button').filter(has_text='Zurück').or_(page.locator('.wt-error:not([hidden]) button, .wt-restart button').filter(has_text='Back')).first.click()


def long_press_drag(page, src, dst, hold=520, steps=12):
    """Touch: press and hold on src (locator), then drag to dst (x, y) – via CDP touch events."""
    box = src.bounding_box()
    x0, y0 = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
    page.wait_for_timeout(hold)
    x1, y1 = dst
    for k in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * k / steps, 'y': y0 + (y1 - y0) * k / steps}]})
        page.wait_for_timeout(16)
    page.wait_for_timeout(120)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(200)


def mouse_drag(page, src, dst, steps=12):
    box = src.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    for k in range(1, steps + 1):
        page.mouse.move(box['x'] + box['width'] / 2 + (dst[0] - box['x'] - box['width'] / 2) * k / steps,
                        box['y'] + box['height'] / 2 + (dst[1] - box['y'] - box['height'] / 2) * k / steps)
        page.wait_for_timeout(16)
    page.mouse.up()
    page.wait_for_timeout(200)


# print the traceback of an exception inside a Suite (wtlib only prints its repr)
import traceback as _tb
from wtlib import Suite as _Suite
_orig_exit = _Suite.__exit__
def _exit(self, *exc):
    if exc[0]:
        _tb.print_exception(*exc)
    return _orig_exit(self, *exc)
_Suite.__exit__ = _exit


def toggle(page, opt_id, on):
    """Shell switch: click its label (the visual switch covers the checkbox)."""
    box = page.locator(f'#wt-opt-{opt_id}')
    if box.is_checked() != on:
        page.locator(f'label[for="wt-opt-{opt_id}"]').click()
