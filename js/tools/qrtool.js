// Tool: QR-Code erstellen — text, link, Wi-Fi, contact (vCard) and e-mail codes with the built-in
// encoder (qr.js); export as PNG, SVG or PDF, or stamp the code onto a page of a PDF.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, downloadBlob } from '../ui.js';
import { resultCard, pickDocsDialog } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { ensureCss, fileResultCard, updateFoot, hexToRgb, makeSanitizer, swatches } from './common.js';
import { encodeQR, qrToSvg, drawQR, byteCapacity, wifiPayload, vcardPayload, mailPayload } from './qr.js';

const TYPES = [
  { id: 'url', label: 'Link', icon: 'link' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'wifi', label: 'WLAN', icon: 'wifi' },
  { id: 'vcard', label: 'Kontakt', icon: 'contact' },
  { id: 'mail', label: 'E-Mail', icon: 'mail' },
];
const ECC = [['L', 'Niedrig (7 %)'], ['M', 'Mittel (15 %)'], ['Q', 'Hoch (25 %)'], ['H', 'Sehr hoch (30 %)']];
const COLORS = [{ c: '#000000', n: 'Schwarz' }, { c: '#1F2340', n: 'Tinte' }, { c: '#1C64F2', n: 'Blau' }, { c: '#2F9E44', n: 'Grün' }, { c: '#C92A2A', n: 'Rot' }];
const MM = 72 / 25.4;

export async function mount(screen, { docId } = {}) {
  await ensureCss();
  screen.setTitle('QR-Code erstellen', 'Für Links, WLAN, Kontakte und mehr');
  let type = 'url';
  let ecc = 'M';
  let color = '#000000';
  let qr = null, payload = '';
  const wrap = h(`<div class="screen-inner pt-stamp qt">
    <div class="pt-stamp-grid">
      <div class="pt-preview-col">
        <div class="qt-prev card"><div class="qt-code" data-code></div><p class="muted small qt-info" data-info></p></div>
        <div class="qt-exports">
          <button class="btn btn-soft btn-sm" type="button" data-exp="png">${icon('image')} PNG</button>
          <button class="btn btn-soft btn-sm" type="button" data-exp="svg">${icon('export')} SVG</button>
          <button class="btn btn-soft btn-sm" type="button" data-exp="pdf">${icon('file')} PDF</button>
        </div>
      </div>
      <form class="card card-pad pt-settings" data-form novalidate autocomplete="off">
        <div class="qt-types" role="tablist" aria-label="Inhalt">${TYPES.map(t => `<button type="button" role="tab" class="qt-type" data-type="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}</div>
        <div data-fields></div>
        <details class="pt-details"><summary>${icon('settings')} Darstellung</summary><div class="pt-details-body">
          <label class="field"><span class="field-label">Fehlerkorrektur</span><select class="select" name="ecc">${ECC.map(([v, l]) => `<option value="${v}" ${v === ecc ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="hint">Höhere Korrektur: Code bleibt auch bei Knicken oder Flecken lesbar, wird aber dichter.</p>
          <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>
          <label class="field"><span class="field-label">PNG-Größe</span><select class="select" name="px"><option value="512">512 px</option><option value="1024" selected>1024 px</option><option value="2048">2048 px</option></select></label>
          <label class="field"><span class="field-label">Beschriftung unter dem Code (PNG/PDF, optional)</span><input class="input" name="caption" maxlength="60"></label>
        </div></details>
      </form>
    </div>
    <h2 class="section-title">Auf eine PDF stempeln</h2>
    <div class="card card-pad qt-stamp" data-stamp></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const form = wrap.querySelector('[data-form]');
  const fieldsBox = wrap.querySelector('[data-fields]');
  const resultBox = wrap.querySelector('[data-result]');
  form.addEventListener('submit', e => e.preventDefault());
  wrap.querySelector('[data-colors]').appendChild(swatches(COLORS, color, c => { color = c; update(); }));

  const values = { url: 'https://', text: '', ssid: '', password: '', security: 'WPA', hidden: false, vorname: '', nachname: '', firma: '', telefon: '', email: '', web: '', strasse: '', plz: '', ort: '', to: '', subject: '', body: '' };
  // prefill the contact from the user's profile, if there is one
  try {
    const pm = await import('../extras/profile.js');
    const p = pm && pm.getProfile ? await pm.getProfile() : null;
    if (p) Object.assign(values, { vorname: p.vorname || '', nachname: p.nachname || '', firma: p.firma || '', telefon: p.telefon || '', email: p.email || '', strasse: [p.strasse, p.hausnummer].filter(Boolean).join(' '), plz: p.plz || '', ort: p.ort || '' });
  } catch { /* no profile module */ }

  function renderFields() {
    wrap.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.type === type)));
    const f = (name, label, attrs = '') => `<label class="field"><span class="field-label">${label}</span><input class="input" name="${name}" value="${esc(values[name])}" ${attrs}></label>`;
    if (type === 'url') fieldsBox.innerHTML = f('url', 'Link (URL)', 'type="url" inputmode="url" spellcheck="false"');
    else if (type === 'text') fieldsBox.innerHTML = `<label class="field"><span class="field-label">Text</span><textarea class="input pt-textarea" name="text" rows="4">${esc(values.text)}</textarea></label>`;
    else if (type === 'wifi') fieldsBox.innerHTML = f('ssid', 'Netzwerkname (SSID)', 'spellcheck="false"') + f('password', 'Passwort', 'spellcheck="false"')
      + `<label class="field"><span class="field-label">Verschlüsselung</span><select class="select" name="security"><option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">Keine</option></select></label>
         <label class="check"><input type="checkbox" name="hidden" ${values.hidden ? 'checked' : ''}><span>Verstecktes Netzwerk</span></label>`;
    else if (type === 'vcard') fieldsBox.innerHTML = `<div class="pt-two">${f('vorname', 'Vorname')}${f('nachname', 'Nachname')}</div>${f('firma', 'Firma')}<div class="pt-two">${f('telefon', 'Telefon', 'type="tel"')}${f('email', 'E-Mail', 'type="email"')}</div>${f('web', 'Webseite', 'type="url"')}${f('strasse', 'Straße und Nr.')}<div class="pt-two">${f('plz', 'PLZ')}${f('ort', 'Ort')}</div>`;
    else if (type === 'mail') fieldsBox.innerHTML = f('to', 'An (E-Mail-Adresse)', 'type="email"') + f('subject', 'Betreff') + `<label class="field"><span class="field-label">Nachricht</span><textarea class="input pt-textarea" name="body" rows="3">${esc(values.body)}</textarea></label>`;
    const sec = form.querySelector('[name=security]');
    if (sec) sec.value = values.security;
    update();
  }
  wrap.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { type = b.dataset.type; renderFields(); }));
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.name in values) values[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.name === 'ecc') ecc = t.value;
    update();
  });
  form.addEventListener('change', e => { if (e.target.name === 'ecc') { ecc = e.target.value; update(); } else if (e.target.name === 'security') { values.security = e.target.value; update(); } });

  function buildPayload() {
    const v = values;
    if (type === 'url') { const u = v.url.trim(); return u && u !== 'https://' ? (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`) : ''; }
    if (type === 'text') return v.text;
    if (type === 'wifi') return v.ssid.trim() ? wifiPayload({ ssid: v.ssid.trim(), password: v.password, security: v.security, hidden: v.hidden }) : '';
    if (type === 'vcard') return (v.vorname || v.nachname || v.firma) ? vcardPayload(v) : '';
    if (type === 'mail') return v.to.trim() ? mailPayload({ to: v.to.trim(), subject: v.subject, body: v.body }) : '';
    return '';
  }

  const codeBox = wrap.querySelector('[data-code]');
  const info = wrap.querySelector('[data-info]');
  function update() {
    payload = buildPayload();
    qr = null;
    if (!payload) {
      codeBox.innerHTML = `<div class="qt-empty">${icon('qr')}<span>Inhalt eingeben – der Code erscheint hier.</span></div>`;
      info.textContent = '';
    } else {
      try {
        qr = encodeQR(payload, { ecc });
        codeBox.innerHTML = qrToSvg(qr, { dark: color });
        const bytes = new TextEncoder().encode(payload).length;
        info.textContent = `Version ${qr.version} · ${qr.size} × ${qr.size} Module · ${bytes} von ${byteCapacity(40, ecc)} Bytes möglich`;
      } catch (e) {
        codeBox.innerHTML = `<div class="qt-empty">${icon('info')}<span>${esc(e.userMessage || 'Der Code konnte nicht erzeugt werden.')}</span></div>`;
        info.textContent = '';
      }
    }
    wrap.querySelectorAll('[data-exp]').forEach(b => { b.disabled = !qr; });
    stampUi.refresh();
    updateFoot(screen, []);
  }

  const fileBase = () => {
    const t = type === 'url' ? (() => { try { return new URL(payload).hostname; } catch { return 'Link'; } })()
      : type === 'wifi' ? `WLAN ${values.ssid}` : type === 'vcard' ? `Kontakt ${[values.vorname, values.nachname].filter(Boolean).join(' ')}` : type === 'mail' ? `E-Mail ${values.to}` : 'Text';
    return `QR ${t}`.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
  };

  function pngCanvas(px) {
    const caption = form.caption.value.trim();
    const capH = caption ? Math.round(px * 0.1) : 0;
    const c = document.createElement('canvas');
    c.width = px; c.height = px + capH;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    drawQR(g, qr, 0, 0, px, { dark: color });
    if (caption) {
      g.fillStyle = color;
      g.font = `600 ${Math.round(capH * 0.5)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(caption, px / 2, px + capH * 0.35, px * 0.92);
    }
    return c;
  }
  wrap.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', async () => {
    if (!qr) return;
    const kind = b.dataset.exp;
    try {
      resultBox.innerHTML = '';
      if (kind === 'png') {
        const c = pngCanvas(+form.px.value);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const name = `${fileBase()}.png`;
        resultBox.appendChild(fileResultCard(blob, name, { title: 'QR-Code als PNG', iconName: 'qr', note: `${c.width} × ${c.height} px`, type: 'image/png' }));
        downloadBlob(blob, name);
      } else if (kind === 'svg') {
        const blob = new Blob([qrToSvg(qr, { dark: color, size: 512 })], { type: 'image/svg+xml' });
        const name = `${fileBase()}.svg`;
        resultBox.appendChild(fileResultCard(blob, name, { title: 'QR-Code als SVG', iconName: 'qr', note: 'Vektor – beliebig skalierbar', type: 'image/svg+xml' }));
        downloadBlob(blob, name);
      } else {
        const prog = progress('Erstelle PDF …');
        try {
          const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
          const doc = await PDFDocument.create();
          const page = doc.addPage([595.28, 841.89]);
          const size = 80 * MM;
          const x = (595.28 - size) / 2, y = 841.89 - 60 * MM - size;
          drawVectorQr(page, qr, x, y + size, size, color, rgb);
          const caption = form.caption.value.trim();
          if (caption) {
            const font = await doc.embedFont(StandardFonts.HelveticaBold);
            const t = makeSanitizer(font)(caption);
            const w = font.widthOfTextAtSize(t, 16);
            page.drawText(t, { x: (595.28 - w) / 2, y: y - 30, size: 16, font, color: rgb(...hexToRgb(color)) });
          }
          doc.setTitle(fileBase());
          const res = await saveResult(await saveDoc(doc), `${fileBase()}.pdf`);
          resultBox.appendChild(resultCard(res, { title: 'QR-Code als PDF', note: '8 × 8 cm, Vektor' }));
        } finally { prog.done(); }
      }
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Export fehlgeschlagen.'); }
  }));

  // ---------- stamp onto a PDF page ----------
  const stampUi = await stampSection(wrap.querySelector('[data-stamp]'), { docId, getQr: () => qr, getColor: () => color, onResult: card => { resultBox.innerHTML = ''; resultBox.appendChild(card); resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
  renderFields();
  return () => stampUi.destroy();
}

/** Draw the code as vector rectangles; (x, top) = upper-left corner in PDF space. */
function drawVectorQr(page, qr, x, top, size, color, rgb, rot = 0, degrees = null) {
  const border = 4;
  const n = qr.size + border * 2;
  const s = size / n;
  // white quiet zone
  page.drawRectangle({ x, y: top - size, width: size, height: size, color: rgb(1, 1, 1), ...(rot && degrees ? { rotate: degrees(rot) } : {}) });
  let d = '';
  for (let my = 0; my < qr.size; my++) {
    let mx = 0;
    while (mx < qr.size) {
      if (!qr.get(mx, my)) { mx++; continue; }
      let run = 1;
      while (mx + run < qr.size && qr.get(mx + run, my)) run++;
      d += `M${mx + border} ${my + border}h${run}v1h-${run}z`;
      mx += run;
    }
  }
  page.drawSvgPath(d, { x, y: top, scale: s, color: rgb(...hexToRgb(color)), borderWidth: 0 });
}

async function stampSection(box, { docId, getQr, getColor, onResult }) {
  let doc = docId ? await db.getDoc(docId) : null;
  let pdf = null, pageNo = 1, base = null, scale = 1, canvas = null;
  let pos = null; // {x, y, size} in viewport@1 (top-left)
  let alive = true;
  async function load() {
    if (pdf) { pdf.destroy(); pdf = null; }
    if (!doc) { render(); return; }
    try { ({ pdf } = await loadPdf(await getDocBytes(doc.id), { name: doc.name, key: doc.id })); pageNo = 1; pos = null; }
    catch (e) { errorToast(e, 'Das Dokument konnte nicht geöffnet werden.'); doc = null; }
    render();
  }
  function render() {
    box.innerHTML = doc
      ? `<div class="qt-stamp-grid"><div><div class="qt-page" data-page><span class="spinner dark"></span></div>
          <div class="pt-prev-nav"><button class="icon-btn" type="button" data-pp aria-label="Vorherige Seite">${icon('chevronLeft')}</button><span data-pinfo></span><button class="icon-btn" type="button" data-pn aria-label="Nächste Seite">${icon('chevronRight')}</button></div></div>
        <div class="qt-stamp-opts"><div class="cmp-doc"><span class="tile-ic">${icon('file')}</span><span class="doc-info"><span class="doc-name">${esc(doc.name)}</span><span class="doc-meta">${pdf ? pdf.numPages : '?'} Seiten</span></span></div>
          <label class="field"><span class="field-label">Größe: <b data-sv>25</b> mm</span><input type="range" name="size" min="12" max="80" value="25"></label>
          <div class="pt-chips"><button type="button" class="pt-chip" data-corner="tl">Oben links</button><button type="button" class="pt-chip" data-corner="tr">Oben rechts</button><button type="button" class="pt-chip" data-corner="bl">Unten links</button><button type="button" class="pt-chip" data-corner="br">Unten rechts</button></div>
          <label class="check"><input type="checkbox" name="all"><span>Auf allen Seiten</span></label>
          <p class="hint">Ziehe den Code auf der Seite an die gewünschte Stelle.</p>
          <div class="qt-stamp-btns"><button class="btn btn-ghost btn-sm" type="button" data-other>${icon('rotate')} Andere PDF</button><button class="btn btn-primary btn-sm" type="button" data-apply>${icon('qr')} QR-Code einfügen</button></div></div></div>`
      : `<div class="qt-stamp-empty"><p class="muted">Setze den QR-Code auf eine Seite einer PDF – z. B. auf Flyer, Einladungen oder Rechnungen.</p><button class="btn btn-soft" type="button" data-choose>${icon('file')} PDF wählen</button></div>`;
    const choose = box.querySelector('[data-choose]') || box.querySelector('[data-other]');
    if (choose) choose.addEventListener('click', async () => {
      const ids = await pickDocsDialog({ title: 'PDF wählen' });
      if (!ids || !ids[0]) return;
      doc = await db.getDoc(ids[0]);
      await load();
    });
    if (!doc || !pdf) return;
    box.querySelector('[data-pp]').addEventListener('click', () => { if (pageNo > 1) { pageNo--; showPage(); } });
    box.querySelector('[data-pn]').addEventListener('click', () => { if (pageNo < pdf.numPages) { pageNo++; showPage(); } });
    box.querySelector('[name=size]').addEventListener('input', e => {
      box.querySelector('[data-sv]').textContent = e.target.value;
      if (pos) { const c = { x: pos.x + pos.size / 2, y: pos.y + pos.size / 2 }; pos.size = +e.target.value * MM; pos.x = c.x - pos.size / 2; pos.y = c.y - pos.size / 2; clampPos(); drawMark(); }
    });
    box.querySelectorAll('[data-corner]').forEach(b => b.addEventListener('click', () => corner(b.dataset.corner)));
    box.querySelector('[data-apply]').addEventListener('click', apply);
    showPage();
    refresh();
  }
  function corner(k) {
    const m = 10 * MM, sz = pos ? pos.size : 25 * MM;
    pos = { size: sz, x: k.endsWith('l') ? m : base.width - m - sz, y: k.startsWith('t') ? m : base.height - m - sz };
    drawMark();
  }
  function clampPos() { if (!base || !pos) return; pos.x = Math.max(0, Math.min(base.width - pos.size, pos.x)); pos.y = Math.max(0, Math.min(base.height - pos.size, pos.y)); }
  async function showPage() {
    const holder = box.querySelector('[data-page]');
    if (!holder) return;
    box.querySelector('[data-pinfo]').textContent = `Seite ${pageNo} von ${pdf.numPages}`;
    const page = await pdf.getPage(pageNo);
    base = page.getViewport({ scale: 1, rotation: page.rotate });
    const avail = Math.min(holder.parentElement.clientWidth || 300, 380);
    scale = Math.min(avail / base.width, 460 / base.height);
    const c = await renderPage(page, { scale, dpr: Math.min(2, window.devicePixelRatio || 1) });
    if (!alive) return;
    if (canvas) canvas.width = 0;
    canvas = c;
    c.style.width = `${Math.round(base.width * scale)}px`; c.style.height = `${Math.round(base.height * scale)}px`;
    holder.innerHTML = '';
    holder.style.width = c.style.width; holder.style.height = c.style.height;
    holder.appendChild(c);
    const mark = h('<div class="qt-mark" tabindex="0" aria-label="Position des QR-Codes"></div>');
    holder.appendChild(mark);
    if (!pos) corner('br'); else { clampPos(); drawMark(); }
    let g = null;
    mark.addEventListener('pointerdown', e => { e.preventDefault(); mark.setPointerCapture(e.pointerId); g = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }; });
    mark.addEventListener('pointermove', e => { if (!g) return; pos.x = g.ox + (e.clientX - g.x) / scale; pos.y = g.oy + (e.clientY - g.y) / scale; clampPos(); drawMark(); });
    const end = () => { g = null; };
    mark.addEventListener('pointerup', end); mark.addEventListener('pointercancel', end);
  }
  function drawMark() {
    const mark = box.querySelector('.qt-mark');
    const q = getQr();
    if (!mark || !pos) return;
    Object.assign(mark.style, { left: `${pos.x * scale}px`, top: `${pos.y * scale}px`, width: `${pos.size * scale}px`, height: `${pos.size * scale}px` });
    mark.innerHTML = q ? qrToSvg(q, { dark: getColor() }) : '';
  }
  function refresh() {
    const b = box.querySelector('[data-apply]');
    if (b) b.disabled = !getQr();
    drawMark();
  }
  async function apply() {
    const q = getQr();
    if (!q || !pdf || !pos) return;
    const prog = progress('Füge QR-Code ein …');
    try {
      const PDFLib = await loadPdfLib();
      const { rgb, degrees } = PDFLib;
      const pdfDoc = await loadEditable(await getDocBytes(doc.id), doc.name, { key: doc.id });
      const all = box.querySelector('[name=all]').checked;
      const pages = pdfDoc.getPages();
      const list = all ? pages.map((_, i) => i + 1) : [pageNo];
      for (const n of list) {
        const pg = await pdf.getPage(n);
        const vb = pg.getViewport({ scale: 1, rotation: pg.rotate });
        const rot = ((pg.rotate % 360) + 360) % 360;
        const size = Math.min(pos.size, vb.width, vb.height);
        const x = Math.min(pos.x, vb.width - size), y = Math.min(pos.y, vb.height - size);
        if (rot === 0) {
          const [px, py] = vb.convertToPdfPoint(x, y);
          drawVectorQr(pages[n - 1], q, px, py, size, getColor(), rgb);
        } else {
          // rotated pages: draw an upright PNG with the page rotation compensated
          const c = document.createElement('canvas');
          c.width = c.height = 600;
          drawQR(c.getContext('2d'), q, 0, 0, 600, { dark: getColor() });
          const img = await pdfDoc.embedPng(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()));
          const corners = [[x, y + size], [x + size, y + size], [x, y]].map(([a, b]) => vb.convertToPdfPoint(a, b));
          pages[n - 1].drawImage(img, { x: corners[0][0], y: corners[0][1], width: size, height: size, rotate: degrees(rot) });
        }
      }
      const res = await saveResult(await saveDoc(pdfDoc), `${baseName(doc.name)} (mit QR-Code).pdf`);
      onResult(resultCard(res, { from: doc.id, title: 'QR-Code eingefügt', note: all ? `${list.length} Seiten` : `Seite ${pageNo}` }));
      toast('QR-Code eingefügt.', 'success');
    } catch (e) { errorToast(e, 'Der QR-Code konnte nicht eingefügt werden.'); }
    finally { prog.done(); }
  }
  await load();
  return { refresh, destroy: () => { alive = false; if (pdf) pdf.destroy(); if (canvas) canvas.width = 0; } };
}
