// Tool: create a signature image – draw (smooth strokes), type (handwriting-like fonts) or photo (paper
// removed, ink recoloured), reusing the sign-pdf signature dialog (lib/sec-sig.js). Output: transparent PNG
// (cropped, chosen height) and/or a real vector SVG (traced outline). "Remember on this device" makes the
// signature available in "Sign PDF". No file intake; nothing leaves the device.
import { el, clear } from '../lib/dom.js';
import { ensureCss, T, iconBtn, ICON, userError } from '../lib/new-ui.js';
import { ensureCss as secCss } from '../lib/sec-ui.js';
import { alphaMask, maskToPath } from '../lib/new-trace.js';

ensureCss();

let api = null;
const signPath = lang => (lang === 'en' ? '/en/tools/sign-pdf/' : '/werkzeuge/pdf-unterschreiben/');

export default {
  labels: { back_to_files: { de: 'Zurück zur Unterschrift', en: 'Back to the signature' } },
  options: [
    { id: 'format', type: 'radio', default: 'both', label: { de: 'Dateiformat', en: 'File format' },
      choices: [
        { value: 'both', label: { de: 'PNG und SVG', en: 'PNG and SVG' } },
        { value: 'png', label: { de: 'PNG (transparent)', en: 'PNG (transparent)' }, hint: { de: 'Für Word (DOCX), E-Mail-Signaturen und die meisten Apps.', en: 'For Word (DOCX), e-mail signatures and most apps.' } },
        { value: 'svg', label: { de: 'SVG (Vektor)', en: 'SVG (vector)' }, hint: { de: 'Gestochen scharf in jeder Größe, z. B. für Grafikprogramme und Webseiten.', en: 'Crisp at any size, e.g. for design programs and websites.' } },
      ] },
    { id: 'height', type: 'select', default: '300', label: { de: 'Höhe des PNG', en: 'PNG height' }, when: v => v.format !== 'svg',
      choices: [{ value: '150', label: '150 px' }, { value: '300', label: { de: '300 px (empfohlen)', en: '300 px (recommended)' } }, { value: '600', label: { de: '600 px (Druck)', en: '600 px (print)' } }] },
  ],
  mountStage(stage, state, ctx) { api = sigStage(stage, state, ctx); },
  status(values) {
    if (!values.sig) return { ok: false, hint: { de: 'Erstelle zuerst deine Unterschrift.', en: 'Create your signature first.' } };
    return null;
  },

  async run(inputs, opts, ctx) {
    const sig = opts.sig;
    if (!sig) throw userError('Erstelle zuerst deine Unterschrift.', 'Create your signature first.');
    const bmp = await createImageBitmap(sig.blob);
    const outputs = [];
    const base = ctx.t({ de: 'Unterschrift', en: 'Signature' });
    try {
      // PNG at the chosen height (never upscaled beyond 2× the drawn resolution)
      if (opts.format !== 'svg') {
        const H = Math.min(+opts.height || 300, bmp.height * 2);
        const W = Math.max(1, Math.round(bmp.width * H / bmp.height));
        const c = document.createElement('canvas');
        c.width = W; c.height = Math.round(H);
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        c.width = c.height = 0;
        if (!blob) throw userError('Das Bild konnte nicht erstellt werden.', 'The image could not be created.');
        outputs.push({ name: `${base}.png`, blob, note: `${W} × ${Math.round(H)} px · ${ctx.t({ de: 'transparent', en: 'transparent' })}` });
      }
      if (opts.format !== 'png') {
        ctx.progress(0.5, { de: 'Vektor wird berechnet …', en: 'Tracing vector …' });
        // trace at ≥ 400 px height for smooth curves
        const k = Math.max(1, Math.min(3, 400 / bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, c.width, c.height);
        const { mask, color, ink } = alphaMask(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        await ctx.tick();
        if (!ink) throw userError('Die Unterschrift ist leer.', 'The signature is empty.');
        const vw = +(c.width / k).toFixed(1), vh = +(c.height / k).toFixed(1);
        const d = maskToPath(mask, c.width, c.height, { scale: 1 / k, eps: 0.8 });
        c.width = c.height = 0;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}"><path fill="${color}" fill-rule="evenodd" d="${d}"/></svg>\n`;
        outputs.push({ name: `${base}.svg`, blob: new Blob([svg], { type: 'image/svg+xml' }), note: ctx.t({ de: 'Vektor, beliebig skalierbar', en: 'vector, scales to any size' }) });
      }
    } finally { bmp.close?.(); }
    if (sig.saved) ctx.note({ de: 'Die Unterschrift ist auf diesem Gerät gemerkt und steht in „PDF unterschreiben“ bereit.', en: 'The signature is remembered on this device and ready in “Sign PDF”.' });
    return { outputs };
  },

  onResult(result, res, ctx) {
    const lang = ctx.lang;
    result.append(el('section', { class: 'new-box' },
      el('h3', {}, T(lang, { de: 'Direkt ein PDF unterschreiben?', en: 'Sign a PDF right away?' })),
      el('p', { class: 'new-muted' }, T(lang, api?.saved()
        ? { de: 'Deine Unterschrift ist gemerkt – in „PDF unterschreiben“ findest du sie unter „Gespeichert“.', en: 'Your signature is remembered – in “Sign PDF” you’ll find it under “Saved”.' }
        : { de: 'Tipp: Setz beim Erstellen das Häkchen „Auf diesem Gerät merken“, dann steht sie in „PDF unterschreiben“ sofort bereit.', en: 'Tip: tick “Remember on this device” when creating it, and it is ready in “Sign PDF” right away.' })),
      el('a', { class: 'wt-btn wt-btn-quiet', href: signPath(lang) }, T(lang, { de: 'PDF unterschreiben', en: 'Sign PDF' }))));
  },
};

function sigStage(stage, state, ctx) {
  const lang = ctx.lang;
  secCss();
  let url = null, saved = false;
  const prev = el('div', { class: 'new-sig-prev', role: 'img', aria: { label: T(lang, { de: 'Vorschau der Unterschrift', en: 'Signature preview' }) } },
    el('p', { class: 'new-muted' }, T(lang, { de: 'Noch keine Unterschrift – wähl unten, wie du sie erstellen willst.', en: 'No signature yet – choose below how to create it.' })));
  const darkBtn = iconBtn(ICON.moon, T(lang, { de: 'Auf dunklem Hintergrund prüfen', en: 'Check on a dark background' }), () => {
    const on = !prev.classList.contains('is-dark');
    prev.classList.toggle('is-dark', on);
    darkBtn.setAttribute('aria-pressed', String(on));
  }, { pressed: false });
  const make = (mode, icn, de, en) => el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => create(mode) }, icn, T(lang, { de, en }));
  const savedBox = el('div', {});
  stage.append(el('section', { class: 'new-box', aria: { labelledby: 'new-sig-h' } },
    el('h2', { id: 'new-sig-h' }, T(lang, { de: 'Deine Unterschrift', en: 'Your signature' })),
    prev,
    el('div', { class: 'new-tools' },
      make('draw', svgIcon(ICON.pen), 'Zeichnen', 'Draw'),
      make('type', svgIcon(['M4 7V5h16v2', 'M12 5v14', 'M9 19h6']), 'Tippen', 'Type'),
      make('photo', svgIcon(['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z']), 'Foto', 'Photo'),
      darkBtn),
    el('p', { class: 'new-muted' }, T(lang, { de: 'Zeichnen mit Finger oder Stift, Tippen in Handschrift-Schriften, oder ein Foto deiner Unterschrift auf weißem Papier – der Hintergrund wird entfernt.', en: 'Draw with your finger or a stylus, type in handwriting-style fonts, or use a photo of your signature on white paper – the background is removed.' })),
    savedBox));

  async function create(mode) {
    const { createSignature, saveSig } = await import('../lib/sec-sig.js');
    const res = await createSignature({ lang, mode });
    if (!res) return;
    if (res.remember) saved = await saveSig({ kind: 'signature', blob: res.blob, w: res.w, h: res.h }) || saved;
    use(res, !!res.remember);
    renderSaved();
  }
  function use(res, isSaved) {
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(res.blob);
    clear(prev).append(el('img', { src: url, alt: T(lang, { de: 'Deine Unterschrift', en: 'Your signature' }) }));
    state.values.sig = { blob: res.blob, w: res.w, h: res.h, saved: isSaved, id: Date.now() };
    state.results.clear();
    ctx.refresh();
  }
  async function renderSaved() {
    const { listSigs, deleteSig } = await import('../lib/sec-sig.js');
    const list = (await listSigs()).filter(s => s.kind === 'signature');
    clear(savedBox);
    if (!list.length) return;
    const ul = el('ul', { class: 'new-sig-saved' });
    for (const s of list.slice(-6).reverse()) {
      const u = URL.createObjectURL(s.blob);
      ul.append(el('li', {},
        el('button', { type: 'button', class: 'new-sig-use', aria: { label: T(lang, { de: 'Gespeicherte Unterschrift verwenden', en: 'Use saved signature' }) }, onclick: () => use({ blob: s.blob, w: s.w, h: s.h }, true) }, el('img', { src: u, alt: '' })),
        iconBtn(ICON.trash, T(lang, { de: 'Gespeicherte Unterschrift löschen', en: 'Delete saved signature' }), async () => { await deleteSig(s.id); renderSaved(); }, { cls: 'wt-btn wt-btn-text wt-btn-sm' })));
    }
    savedBox.append(el('h3', { class: 'new-muted' }, T(lang, { de: 'Auf diesem Gerät gemerkt', en: 'Remembered on this device' })), ul);
  }
  renderSaved();
  ctx.refresh();
  return { saved: () => saved || !!state.values.sig?.saved };
}

function svgIcon(paths) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'wt-i' })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
