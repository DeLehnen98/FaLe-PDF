// „Meine Briefe per Post“ (#/post) and the status of one letter (#/post/<id>): payment → handed to the print
// service → sent (+ tracking for Einschreiben), with „Jetzt bezahlen“, „Abbrechen“, „Sendung verfolgen“ and a
// Versandnachweis (PDF in the library). Polls while something is still happening.
import { h, esc, toast, errorToast, confirmDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { listJobs, findJob, updateJob, jobStatus, cancelJob, mockPay, euro } from './api.js';
import { openCheckout } from './send.js';
import { locale, t } from '../i18n/index.js';

const WAY = { '': 'Brief', r1: 'Einschreiben Einwurf', r2: 'Einschreiben' };
const STATUS = {
  pending_payment: 'Wartet auf Bezahlung', paid: 'Bezahlt – wird übergeben', submitted: 'In der Druckerei',
  sent: 'Verschickt', failed: 'Nicht verschickt', refunded: 'Nicht verschickt – Geld zurück', canceled: 'Abgebrochen',
};
const FAX_STATUS = { ...STATUS, paid: 'Bezahlt – wird gefaxt', submitted: 'Wird gefaxt', sent: 'Übertragen', failed: 'Nicht übertragen', refunded: 'Nicht übertragen – Geld zurück' };
const isFax = j => !!(j && j.options && j.options.channel === 'fax');
const wayOf = j => (isFax(j) ? 'Fax' : WAY[j.options && j.options.registered || ''] || 'Brief');
const statusOf = (j, s = j.status) => (isFax(j) ? FAX_STATUS : STATUS)[s] || '';
const dt = ms => { try { return new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const trackUrl = code => `https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=${encodeURIComponent(code)}`;

export async function mount(screen, { parts, params }) {
  const id = parts[1];
  if (!id) return list(screen);
  return detail(screen, id, params);
}

function list(screen) {
  const jobs = listJobs();
  screen.body.innerHTML = `<div class="screen-inner post-list">
    ${jobs.length ? jobs.map(j => `<a class="order-item post-item" href="#/post/${esc(j.id)}"><span class="tile-ic">${oicon(isFax(j) ? 'print' : 'mail')}</span>
      <span class="doc-info"><span class="doc-name">${esc(j.docName || 'Brief')}</span><span class="doc-meta">${esc(wayOf(j))} · ${esc(euro(j.priceCents || 0))} · ${esc(dt(j.createdAt))}</span></span>
      <span class="post-chip st-${esc(j.status || '')}">${esc(statusOf(j))}</span></a>`).join('')
    : `<div class="empty"><div class="empty-art">${oicon('mail')}</div><h3>Noch keine Briefe per Post</h3><p>Öffne einen Brief oder eine PDF und tippe auf „Per Post senden“ – FaLe druckt, kuvertiert und verschickt ihn für dich.</p><a class="btn btn-primary" href="#/schreiben">${oicon('letter')} Brief schreiben</a></div>`}
  </div>`;
  screen.setFoot([]);
  // letters and faxes that are still on their way: ask once for news (e.g. a fax went through while the app was closed)
  const open = jobs.filter(j => ['pending_payment', 'paid', 'submitted'].includes(j.status) && Date.now() - (j.createdAt || 0) < 30 * 86400e3).slice(0, 8);
  if (open.length) {
    Promise.all(open.map(j => jobStatus(j.id, j.cap).then(r => updateJob(j.id, { status: r.job.status, tracking: r.job.tracking, paidAt: r.job.paidAt, sentAt: r.job.sentAt })).catch(() => null)))
      .then(res => { if (res.some((x, i) => x && x.status !== open[i].status) && screen.body.isConnected && location.hash === '#/post') list(screen); });
  }
}

async function detail(screen, id, params) {
  let j = findJob(id);
  if (!j) {
    // e.g. the payment page returned to a browser that is not the device that created the letter
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon(params.get('bezahlt') ? 'check' : 'mail')}</div>
      <h3>${params.get('bezahlt') ? 'Zahlung erhalten' : 'Dieser Brief ist auf einem anderen Gerät'}</h3>
      <p>${params.get('bezahlt') ? 'Danke! Du kannst diese Seite schließen und zur FaLe-App zurückkehren – dort siehst du, wann dein Brief verschickt ist.' : 'Den Stand siehst du in der FaLe-App auf dem Gerät, mit dem du den Brief verschickt hast.'}</p></div></div>`;
    screen.setFoot([]);
    return;
  }
  screen.setTitle(isFax(j) ? 'Fax' : 'Brief per Post', j.docName || '');
  const box = h('<div class="screen-inner post-detail"></div>');
  screen.body.appendChild(box);
  let timer = null, alive = true, busy = false;

  async function refresh(quiet = true) {
    if (busy) return;
    busy = true;
    try {
      const r = await jobStatus(j.id, j.cap);
      j = updateJob(j.id, { status: r.job.status, tracking: r.job.tracking, paidAt: r.job.paidAt, sentAt: r.job.sentAt, priceCents: r.job.priceCents }) || j;
    } catch (e) { if (!quiet) errorToast(e, 'Der Stand konnte nicht abgerufen werden.'); }
    finally { busy = false; }
    if (alive) { render(); schedule(); }
  }
  function schedule() {
    clearTimeout(timer);
    if (!alive) return;
    const wait = j.status === 'pending_payment' || j.status === 'paid' ? 4000 : j.status === 'submitted' ? (isFax(j) ? 6000 : 30000) : 0;
    if (wait) timer = setTimeout(() => refresh(), wait);
  }
  function step(n, done, active, title, text) {
    return `<li class="post-step ${done ? 'done' : ''} ${active ? 'active' : ''}"><span class="post-dot">${done ? oicon('check') : n}</span><div><b>${esc(title)}</b>${text ? `<span>${text}</span>` : ''}</div></li>`;
  }
  function render() {
    const s = j.status;
    const paid = ['paid', 'submitted', 'sent'].includes(s);
    const handed = ['submitted', 'sent'].includes(s);
    const sent = s === 'sent';
    const bad = ['failed', 'refunded', 'canceled'].includes(s);
    const fax = isFax(j);
    const way = wayOf(j);
    const badText = s === 'canceled' ? 'Du hast den Auftrag abgebrochen. Es wurde nichts abgebucht.'
      : fax ? (s === 'refunded' ? 'Das Fax kam nicht durch – auch nicht beim zweiten Versuch (besetzt oder keine Faxnummer). Das Geld wird dir automatisch zurückgebucht.' : 'Das Fax kam nicht durch. Bitte melde dich bei uns, falls schon abgebucht wurde.')
      : s === 'refunded' ? 'Der Brief konnte nicht an die Druckerei übergeben werden. Das Geld wird dir automatisch zurückgebucht.' : 'Der Brief konnte nicht verschickt werden. Bitte melde dich bei uns, falls schon abgebucht wurde.';
    const steps = fax ? `
          ${step(1, paid, s === 'pending_payment', 'Bezahlen', paid ? esc(dt(j.paidAt || Date.now())) : 'Noch nicht bezahlt')}
          ${step(2, handed, s === 'paid', 'Wird gefaxt', handed && !sent ? 'Die Nummer wird angewählt …' : '')}
          ${step(3, sent, s === 'submitted', 'Übertragen', sent ? esc(dt(j.sentAt || Date.now())) : '')}` : `
          ${step(1, paid, s === 'pending_payment', 'Bezahlen', paid ? esc(dt(j.paidAt || Date.now())) : 'Noch nicht bezahlt')}
          ${step(2, handed, s === 'paid', 'An die Druckerei übergeben', handed ? 'Wird gedruckt und kuvertiert' : '')}
          ${step(3, sent, s === 'submitted', 'Verschickt', sent ? esc(dt(j.sentAt || Date.now())) + (j.tracking ? ` · <span>Sendungsnummer</span> <span data-no-i18n>${esc(j.tracking)}</span>` : '') : '')}`;
    box.innerHTML = `
      ${j.test ? `<div class="post-test" role="note">${oicon('info')}<span>${fax ? 'Testmodus: Es wird nichts gefaxt oder abgebucht.' : 'Testmodus: Es wird nichts gedruckt, verschickt oder abgebucht.'}</span></div>` : ''}
      <div class="card card-pad post-card">
        <div class="post-head"><span class="tile-ic">${oicon(fax ? 'print' : 'mail')}</span><div><strong>${esc(way)} · ${esc(euro(j.priceCents || 0))}</strong>
          <span class="muted small" data-no-i18n>${esc((j.to || []).join(', '))}</span></div><span class="post-chip st-${esc(s)}">${esc(statusOf(j))}</span></div>
        ${bad ? `<p class="post-bad">${oicon('info')} <span>${badText}</span></p>` : `<ol class="post-steps">${steps}
        </ol>`}
      </div>
      <p class="hint post-hint">${oicon('pen')} <span>${fax ? 'Ein Fax kommt sofort an. Den Sendebericht kannst du als Nachweis speichern, sobald es übertragen ist.' : 'Für Kündigungen und Fristen zählt der Tag, an dem der Brief ankommt. Plane 1–2 Werktage ein.'}</span></p>`;
    const acts = [];
    if (s === 'pending_payment') {
      if (j.test && /^mock:/.test(j.checkoutUrl || '')) {
        const b = h(`<button class="btn btn-primary" type="button" data-mockpay>${oicon('check')} Testzahlung bestätigen</button>`);
        b.addEventListener('click', async () => { b.disabled = true; try { const r = await mockPay(j.id, j.cap); j = updateJob(j.id, { status: r.job.status, paidAt: r.job.paidAt }) || j; render(); schedule(); } catch (e) { errorToast(e); b.disabled = false; } });
        acts.push(b);
      } else {
        const b = h(`<button class="btn btn-primary" type="button" data-pay>Jetzt bezahlen</button>`);
        b.addEventListener('click', () => openCheckout(j.checkoutUrl));
        acts.unshift(b);
      }
      const c = h(`<button class="btn btn-ghost" type="button" data-cancel>Abbrechen</button>`);
      c.addEventListener('click', async () => {
        if (!(await confirmDialog('Auftrag abbrechen?', 'Der Brief wird nicht verschickt und nichts abgebucht.', { okLabel: 'Abbrechen', danger: true }))) return;
        try { const r = await cancelJob(j.id, j.cap); j = updateJob(j.id, { status: r.job.status }) || j; render(); schedule(); } catch (e) { errorToast(e); }
      });
      acts.unshift(c);
    }
    if (j.tracking) {
      const t = h(`<button class="btn btn-soft" type="button" data-track>${oicon('search')} Sendung verfolgen</button>`);
      t.addEventListener('click', async () => { const { openExternal } = await import('../security.js'); openExternal(trackUrl(j.tracking), { confirm: false }); });
      acts.push(t);
    }
    if (paid && !(isFax(j) && s !== 'sent')) {
      const p = h(`<button class="btn ${s === 'sent' ? 'btn-primary' : 'btn-soft'}" type="button" data-proof>${oicon('download')} ${isFax(j) ? 'Sendebericht' : 'Versandnachweis'}</button>`);
      p.addEventListener('click', () => saveProof(j));
      acts.push(p);
    }
    screen.setFoot(acts);
  }
  const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
  render();
  if (params.get('bezahlt')) toast('Danke! Die Zahlung wird geprüft …', 'success');
  refresh();
  return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
}

/** A one-page PDF in the library: what was sent when and how (proof for the person's own records, in their language). */
async function saveProof(j) {
  try {
    const { loadPdfLib } = await import('../pdflib.js');
    const P = await loadPdfLib();
    const U = await import('../office/unifont.js');
    const d = await P.PDFDocument.create();
    const p = d.addPage([595.28, 841.89]);
    const fax = isFax(j);
    const rows = fax ? [
      [t('Dokument'), j.docName || ''],
      [t('Empfänger (Fax)'), (j.options && j.options.to) || (j.to || [])[0] || ''],
      [t('Seiten'), String((j.options && j.options.pages) || '')],
      [t('Übertragen am'), j.sentAt ? dt(j.sentAt) : ''],
      [t('Ergebnis'), j.status === 'sent' ? t('OK – vollständig übertragen') : statusOf(j)],
      [t('Preis'), euro(j.priceCents || 0)],
      [t('Auftrag'), j.id],
    ] : [
      [t('Dokument'), j.docName || ''],
      [t('Versandart'), t(wayOf(j))],
      ...(j.to || []).map((l, i) => [i ? '' : t('Empfänger'), l]),
      [t('Seiten'), t('{n} (mit Adressblatt)', { n: (j.options && j.options.pages) || '' })],
      [t('Preis'), euro(j.priceCents || 0)],
      [t('Bezahlt'), j.paidAt ? dt(j.paidAt) : ''],
      [t('Verschickt'), j.sentAt ? dt(j.sentAt) : t('in Bearbeitung')],
      ...(j.tracking ? [[t('Sendungsnummer'), j.tracking]] : []),
      [t('Auftrag'), j.id],
    ];
    const title = fax ? t('Fax-Sendebericht') : t('Versandnachweis');
    const note = fax ? t('Erstellt mit FaLe PDF. Übertragen über den Faxdienst von FaLe. Unten: die erste Seite, wie sie in deinen Dateien liegt.')
      : t('Erstellt mit FaLe PDF. Den Zustellnachweis für Einschreiben findest du über die Sendungsnummer bei der Deutschen Post.');
    // Helvetica for Western European text, Liberation Sans for Polish, Turkish, Cyrillic …; Chinese, Japanese,
    // Korean, Hindi … are drawn as pictures by the device's own fonts (as on the recovery sheet)
    let f = await d.embedFont(P.StandardFonts.Helvetica), fb = await d.embedFont(P.StandardFonts.HelveticaBold);
    if (U.needsUnicode([title, note, ...rows.flat()].join('\n'))) {
      try { [f, fb] = await Promise.all([U.uniFont(d, { PDFLib: P }), U.uniFont(d, { PDFLib: P, bold: true })]); } catch (e) { console.warn('unicode font', e); }
    }
    const draw = async (s, o) => { if (!s) return; if (await U.drawTextImage(p, d, s, { ...o, bold: o.font === fb })) return; p.drawText(U.cleanText(s, o.font).text, o); };
    await draw(title, { x: 70, y: 800, size: 20, font: fb, color: P.rgb(0.23, 0.22, 0.63) });
    let y = 760;
    for (const [label, value] of rows) {
      await draw(label, { x: 70, y, size: 11, font: fb, color: P.rgb(0.2, 0.2, 0.3) });
      await draw(String(value), { x: 230, y, size: 11, font: f, color: P.rgb(0, 0, 0) });
      y -= 22;
    }
    // the note, wrapped at the right margin (by words; for scripts without spaces by the browser's segmentation)
    const words = U.needsTextImage(note) ? (() => { try { return [...new Intl.Segmenter(locale(), { granularity: 'word' }).segment(note)].map(x => x.segment); } catch { return [...note]; } })() : U.cleanText(note, f).text.split(/(\s+)/);
    const width = s => (U.needsTextImage(s) ? U.measureTextImage(s, 9) : f.widthOfTextAtSize(U.cleanText(s, f).text, 9));
    let line = '';
    y -= 20;
    for (const w of words) {
      if (line && width(line + w) > 455) { await draw(line.trim(), { x: 70, y, size: 9, font: f, color: P.rgb(0.35, 0.35, 0.4) }); y -= 12; line = w.trimStart(); }
      else line += w;
    }
    await draw(line.trim(), { x: 70, y, size: 9, font: f, color: P.rgb(0.35, 0.35, 0.4) });
    if (fax && j.docId) {
      // the first page as it was faxed (from the file in the library, if it is still there)
      try {
        const lib = await import('../library.js');
        const src = await lib.getDocBytes(j.docId);
        const { loadEditable } = await import('../pdflib.js');
        const sd = await loadEditable(src, j.docName || 'fax.pdf', { key: j.docId });
        const [ep] = await d.embedPages([sd.getPage(0)]);
        const boxH = Math.max(120, y - 70), boxW = 455;
        const sc = Math.min(boxW / ep.width, boxH / ep.height);
        const w = ep.width * sc, hh = ep.height * sc;
        p.drawRectangle({ x: 70 + (boxW - w) / 2 - 1, y: y - 24 - hh - 1, width: w + 2, height: hh + 2, borderColor: P.rgb(0.6, 0.6, 0.65), borderWidth: 0.8 });
        p.drawPage(ep, { x: 70 + (boxW - w) / 2, y: y - 24 - hh, width: w, height: hh });
      } catch (e) { console.warn('first page', e); }
    }
    const bytes = await d.save();
    const { saveResult } = await import('../library.js');
    const base = String(j.docName || t('Brief')).replace(/\.pdf$/i, '');
    const meta = await saveResult(bytes, fax ? t('{name} – Fax-Sendebericht.pdf', { name: base }) : t('{name} – Versandnachweis.pdf', { name: base }));
    toast(fax ? 'Sendebericht gespeichert.' : 'Versandnachweis gespeichert.', 'success');
    location.hash = `#/ansicht/${meta.id}`;
  } catch (e) { errorToast(e, 'Der Nachweis konnte nicht erstellt werden.'); }
}
