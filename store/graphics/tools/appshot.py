"""Helpers to drive the real FaLe PDF app (served from a dist copy) for store screenshots."""
import json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FALE_SHOTS_URL', 'http://127.0.0.1:8802/')
WORK = Path(os.environ.get('FALE_SHOTS_WORK', '/tmp/fale-store-shots'))  # build copy, demo files, raw captures
SP = WORK
DEMO = WORK / 'site' / 'demo'

FILES = {
    # import order: last one ends up on top of "recent"
    'de': ['Projekt_Solarpark.pptx', 'Lebenslauf_Anna_Berger.docx', 'Haushaltsbuch_2026.xlsx', 'Mietvertrag_Wohnung.pdf', 'Rechnung_2026-0412.pdf'],
    'en': ['Solar_Park_Project.pptx', 'CV_Anna_Berger.docx', 'Monthly_Expenses_2026.xlsx', 'Rental_Agreement.pdf', 'Invoice_2026-0412.pdf'],
}
MIME = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'jpg': 'image/jpeg'}

QUOTA = {'used': 1, 'limit': 5, 'remaining': 4, 'free': 5, 'rewarded': 0, 'bonus': 3, 'rewardsLeft': 3, 'plus': False, 'plusUntil': None}


def ai_routes(ctx, answers):
    """Mock the optional cloud-AI backend (the real one needs server secrets)."""
    status = {'ok': True, 'configured': True, 'provider': {'id': 'cloud', 'label': 'Cloud-KI', 'company': '', 'privacy': ''},
              'features': {'ads': True, 'plus': True}, 'limits': {'free': 5, 'bonus': 3, 'maxRewards': 3, 'plusDaily': 200}, 'quota': QUOTA}
    ctx.route('**/api/ai/quota', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(status)))
    ctx.route('**/api/ai/register', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'token': 'demo-token'})))

    def ai(route):
        body = json.loads(route.request.post_data or '{}')
        text = answers.get(body.get('task'), answers.get('*', 'OK'))
        q = dict(QUOTA, used=2, remaining=3)
        ev = f"event: meta\ndata: {json.dumps({'task': body.get('task'), 'truncated': False, 'note': '', 'quota': q})}\n\n"
        ev += f"event: delta\ndata: {json.dumps({'t': text})}\n\n"
        ev += f"event: done\ndata: {json.dumps({'quota': q, 'cut': False})}\n\n"
        route.fulfill(status=200, headers={'content-type': 'text/event-stream'}, body=ev)
    ctx.route('**/api/ai', ai)


class App:
    def __init__(self, lang='de', width=360, height=760, dpr=3, camera=None, dark=False, answers=None, touch=True):
        self.lang = lang
        self.pw = sync_playwright().start()
        args = []
        if camera:
            args += ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={camera}']
        self.browser = self.pw.chromium.launch(args=args)
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=dpr,
                                            locale='de-DE' if lang == 'de' else 'en-GB', color_scheme='dark' if dark else 'light',
                                            is_mobile=width < 700, has_touch=touch, permissions=['camera'] if camera else [])
        consent = json.dumps({'v': 1, 'at': int(time.time() * 1000), 'provider': 'cloud'})
        self.ctx.add_init_script(f"""try {{ localStorage.setItem('fale-onboarded','1'); localStorage.setItem('fale-simple-hint','hidden'); localStorage.setItem('fale-lang','{lang}');
          localStorage.setItem('fale-ai-consent', {json.dumps(consent)}); localStorage.setItem('fale-ai-token','demo-token');
          localStorage.setItem('fale-ai-device','demodevice0123456789abcd'); }} catch (e) {{}}""")
        ai_routes(self.ctx, answers or {})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.goto(BASE + '#/start')
        self.page.wait_for_timeout(1200)

    def seed(self, names=None, extra=()):
        names = list(names or FILES[self.lang]) + list(extra)
        for n in names:
            ext = n.rsplit('.', 1)[1].lower()
            self.page.evaluate("""async ([url, name, type]) => {
                const lib = await import('./js/library.js');
                const b = await (await fetch(url)).blob();
                await lib.importAny(new File([b], name, { type }), { silent: true, source: 'Gerät' });
                await new Promise(r => setTimeout(r, 120));
            }""", [f'demo/{self.lang}/{n}', n, MIME[ext]])
        self.page.wait_for_timeout(2500)  # thumbnails / text index in the background

    def doc_id(self, name):
        return self.page.evaluate("""async (name) => { const db = await import('./js/db.js'); const d = (await db.listFiles()).find(x => x.name === name); return d && d.id; }""", name)

    def go(self, hash_, wait=1500):
        self.page.evaluate("h => { location.hash = h; }", hash_)
        self.page.wait_for_timeout(wait)

    def clean(self):
        # hide transient UI (toasts) before a capture
        self.page.add_style_tag(content='.toasts{display:none!important}')

    def shot(self, path):
        self.page.screenshot(path=str(path))

    def close(self):
        self.browser.close(); self.pw.stop()
