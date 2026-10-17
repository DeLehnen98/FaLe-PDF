import base64, sys, json
from playwright.sync_api import sync_playwright
ORIGIN='http://127.0.0.1:8870'
JS = """async ({ id, design, pubs }) => {
  const { cvPdf, loadPhotoSource, cropPhoto } = await import('/assets/wt/lib/tpl-cv.js');
  const data = await (await fetch(`/vorlagen/data/${id}.json`)).json();
  const { photo, ...cv } = data.cv;
  let ph = null;
  if (photo) { const blob = await (await fetch(photo)).blob(); ph = await cropPhoto(await loadPhotoSource(blob), { zoom: 1, cx: 0.5, cy: 0.45 }, cv.photoShape || 'circle'); }
  const extra = pubs ? { pubs: [{ from: '', to: '2025', role: 'Messung von Bodenfeuchte mit preiswerten Sensoren', org: 'Zeitschrift für Feldforschung 12(3)', place: '', desc: '' }, { from: '', to: '2024', role: 'Vortrag: Offene Daten in der Agrarforschung', org: 'Jahrestagung Umweltinformatik', place: 'Kassel', desc: '' }] } : {};
  const { bytes, pages, missing } = await cvPdf({ ...cv, ...extra, design, date: '2026-10-15', place: 'Saarbrücken', signLine: true }, data.lang, ph);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return { b64: btoa(s), pages, missing };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto(ORIGIN + '/vorlagen/')
    for design in sys.argv[2:]:
        r = pg.evaluate(JS, {'id': sys.argv[1], 'design': design, 'pubs': design == 'academic'})
        open(f'cvr/{design}.pdf', 'wb').write(base64.b64decode(r['b64']))
        print(design, r['pages'], r['missing'])
    b.close()
