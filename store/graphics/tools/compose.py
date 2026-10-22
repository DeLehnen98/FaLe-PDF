"""Compose framed, captioned store screenshots from raw app captures (HTML/CSS rendered by Chromium)."""
import sys, html
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

import os
WORK = Path(os.environ.get('FALE_SHOTS_WORK', '/tmp/fale-store-shots'))  # build copy, demo files, raw captures
SP = WORK
OUT = Path(__file__).resolve().parents[1]  # store/graphics

CAP = {
 'de': {
  'home': ('Alle Pro-Funktionen an Bord', 'Kein Konto, keine Wasserzeichen'),
  'sign': ('Unterschreiben in Sekunden', 'Verträge und Formulare direkt auf dem Handy'),
  'scan': ('Scannen mit Kantenerkennung', 'Seiten werden automatisch erkannt und begradigt'),
  'ocr': ('Texterkennung – auch offline', 'Scans werden durchsuchbar, direkt auf dem Gerät'),
  'ai': ('KI-Assistent für deine Dokumente', 'Optional – nur nach deiner Zustimmung'),
  'sheet': ('Dokumente, Tabellen & Präsentationen', 'Mit Formeln, Diagrammen und Vorlagen'),
  'letters': ('Kündigung in einer Minute', 'Briefe, Widerruf & Co. – fertig als PDF'),
  'reminders': ('Keine Frist mehr verpassen', 'Erinnerungen für Rechnungen, Verträge und Ausweise'),
  'privacy': ('Deine Daten bleiben auf dem Handy', 'Kein Konto, kein Tracking, Verarbeitung auf dem Gerät'),
  'files': ('Alles an einem Ort', 'PDF, DOCX, XLSX, PPTX und Bilder – offline'),
  'viewer': ('PDFs lesen & bearbeiten', 'Mit Seitenleiste, Suche und Lesemodus'),
  'doc': ('Dokumente schreiben & bearbeiten', 'Lebenslauf, Briefe und mehr – als DOCX oder PDF'),
  'slides': ('Präsentationen erstellen', 'Folien bearbeiten und als PPTX oder PDF speichern'),
 },
 'en': {
  'home': ('All pro features on board', 'No account, no watermarks'),
  'sign': ('Sign in seconds', 'Contracts and forms, right on your phone'),
  'scan': ('Scan with edge detection', 'Pages are detected and straightened automatically'),
  'ocr': ('Text recognition, offline', 'Make scans searchable, right on your device'),
  'ai': ('AI assistant for your documents', 'Optional – only with your consent'),
  'sheet': ('Documents, spreadsheets & slides', 'With formulas, charts and templates'),
  'reminders': ('Never miss a deadline', 'Reminders for bills, contracts and appointments'),
  'privacy': ('Your files stay on your phone', 'No account, no tracking, on-device processing'),
  'files': ('Everything in one place', 'PDF, DOCX, XLSX, PPTX and images – offline'),
  'viewer': ('Read & edit PDFs', 'With thumbnails, search and reading mode'),
  'doc': ('Write & edit documents', 'CVs, letters and more – as DOCX or PDF'),
  'slides': ('Create presentations', 'Edit slides and save as PPTX or PDF'),
 },
}

ORDER = {
 'phone': {'de': ['home', 'sign', 'scan', 'ocr', 'ai', 'sheet', 'letters', 'privacy'],
           'en': ['home', 'sign', 'scan', 'ocr', 'ai', 'sheet', 'reminders', 'privacy']},
 'tab7': {'de': ['home', 'sign', 'ai'], 'en': ['home', 'sign', 'ai']},
 'tab10': {'de': ['home', 'viewer', 'doc'], 'en': ['home', 'viewer', 'doc']},
}
# the other 14 languages: phone screenshots (captions in captions_i18n.py)
from captions_i18n import CAP as CAP_MORE, PHONE_ORDER
CAP.update(CAP_MORE)
for _l in CAP_MORE:
    ORDER['phone'][_l] = PHONE_ORDER
# canvas size, device screen box (display px), raw capture aspect
GEO = {
 'phone': dict(W=1080, H=1920, sw=700, top=372, bezel=14, r_out=72, r_in=56, head=96, sub=44, cap_top=118),
 'tab7': dict(W=1200, H=1920, sw=1000, top=336, bezel=16, r_out=56, r_in=40, head=92, sub=44, cap_top=104),
 'tab10': dict(W=2560, H=1600, sw=2096, top=244, bezel=16, r_out=48, r_in=32, head=80, sub=40, cap_top=46),
}

CSS = """
*{margin:0;box-sizing:border-box}
html,body{width:%(W)dpx;height:%(H)dpx;overflow:hidden}
body{font-family:Inter,system-ui,'Noto Sans','Noto Sans CJK SC','Noto Sans CJK JP','Noto Sans CJK KR','Noto Sans Devanagari','Lohit Devanagari',sans-serif;color:#fff;position:relative;
 background:radial-gradient(1200px 900px at 85%% 105%%, rgba(45,212,191,.38), rgba(45,212,191,0) 60%%),
 radial-gradient(900px 700px at 0%% 0%%, rgba(142,138,247,.45), rgba(142,138,247,0) 60%%),
 linear-gradient(165deg,#3B37A0 0%%,#24206E 48%%,#141238 100%%)}
.cap{position:absolute;left:0;right:0;top:%(cap_top)dpx;text-align:center;padding:0 60px}
h1{white-space:nowrap;font-size:%(head)dpx;line-height:1.08;font-weight:800;letter-spacing:-.025em}
p{white-space:nowrap;margin-top:22px;font-size:%(sub)dpx;line-height:1.25;font-weight:500;color:#D9DAF7}
.dev{position:absolute;left:50%%;top:%(top)dpx;transform:translateX(-50%%);padding:%(bezel)dpx;border-radius:%(r_out)dpx;
 background:#0B0B1C;box-shadow:0 0 0 3px #2E2F55, 0 40px 90px rgba(5,4,25,.55)}
.dev img{display:block;width:%(sw)dpx;border-radius:%(r_in)dpx}
.dot{position:absolute;left:50%%;top:-4px;width:120px;height:4px}
"""


def page_html(device, img, head, sub):
    g = GEO[device]
    css = CSS % g
    if device == 'tab10':  # landscape: wider caption on one line
        css += '.cap{padding:0 120px} p{margin-top:14px}'
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="cap"><h1>{html.escape(head)}</h1><p>{html.escape(sub)}</p></div>
<div class="dev"><img src="{img}"></div>
<script>for (const el of document.querySelectorAll('h1,p')) {{ let s = parseFloat(getComputedStyle(el).fontSize); while (el.scrollWidth > el.clientWidth && s > 20) {{ s -= 1; el.style.fontSize = s + 'px'; }} }}</script></body></html>"""


def main(devices, langs, only=None):
    with sync_playwright() as p:
        b = p.chromium.launch()
        for device in devices:
            g = GEO[device]
            pg = b.new_page(viewport={'width': g['W'], 'height': g['H']}, device_scale_factor=1)
            for lang in langs:
                for i, name in enumerate(ORDER[device][lang], 1):
                    if only and name not in only:
                        continue  # re-compose just these shots (keeps the numbering of the others)
                    raw = SP / 'raw' / device / lang / f'{name}.png'
                    head, sub = CAP[lang][name]
                    if device != 'phone':
                        sub = sub.replace('auf dem Handy', 'auf dem Tablet').replace('on your phone', 'on your tablet')
                    tmp = SP / 'compose_tmp.html'
                    tmp.write_text(page_html(device, raw.as_uri(), head, sub), encoding='utf-8')
                    pg.goto(tmp.as_uri()); pg.wait_for_timeout(250)
                    # sanity: caption must not overlap the device
                    cap_bottom = pg.evaluate("document.querySelector('.cap').getBoundingClientRect().bottom")
                    dev = pg.evaluate("(()=>{const r=document.querySelector('.dev').getBoundingClientRect();return [r.top,r.bottom,r.left,r.right]})()")
                    if cap_bottom > dev[0] - 20 or dev[1] > g['H'] + 1 or dev[2] < 0:
                        print('LAYOUT WARNING', device, lang, name, cap_bottom, dev)
                    sub_dir = {'phone': 'phone', 'tab7': 'tablet-7', 'tab10': 'tablet-10'}[device]
                    out = OUT / sub_dir / lang / f'{i:02d}_{name}.png'
                    out.parent.mkdir(parents=True, exist_ok=True)
                    pg.screenshot(path=str(out))
                    Image.open(out).convert('RGB').save(out, optimize=True)  # 24-bit, no alpha (Play requirement)
                    print('wrote', out.relative_to(OUT))
        b.close()


if __name__ == '__main__':
    devs = sys.argv[1].split(',') if len(sys.argv) > 1 else ['phone']
    langs = sys.argv[2].split(',') if len(sys.argv) > 2 else ['de', 'en']
    only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None  # optional: only these shots, e.g. home
    main(devs, langs, only)
