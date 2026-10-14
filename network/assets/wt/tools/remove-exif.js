// Tool: show and remove photo metadata (EXIF, GPS location, XMP, IPTC, comments, embedded thumbnails,
// data appended after the image). JPEG, PNG and WebP are cleaned losslessly by editing the file's
// segments – the image data is copied byte for byte (verified). HEIC/AVIF can only be re-saved as JPG.
// The orientation tag stays when the photo needs it to be shown upright; the capture date optionally.
import { el, icon, clear } from '../lib/dom.js';
import { ensureCss, loadCanvas, encode, release, imgProgress, uniqueNames, T, userError } from '../lib/img-core.js';
import { readMeta, stripMeta, imageData, sameBytes, hasPrivate, minimalTiff, insertSegment, detectFormat } from '../lib/img-meta.js';

ensureCss();

const L = {
  location: { de: 'Standort', en: 'Location' }, camera: { de: 'Kamera', en: 'Camera' }, lens: { de: 'Objektiv', en: 'Lens' },
  settings: { de: 'Aufnahme', en: 'Exposure' }, serial: { de: 'Seriennummer der Kamera', en: 'Camera serial number' },
  lensserial: { de: 'Seriennummer des Objektivs', en: 'Lens serial number' }, owner: { de: 'Besitzer', en: 'Owner' },
  artist: { de: 'Fotograf / Autor', en: 'Photographer / author' }, copyright: { de: 'Urheberrecht', en: 'Copyright' },
  uniqueid: { de: 'Eindeutige Bild-ID', en: 'Unique image ID' }, taken: { de: 'Aufgenommen am', en: 'Taken on' },
  modified: { de: 'Geändert am', en: 'Modified on' }, gpstime: { de: 'GPS-Zeit', en: 'GPS time' }, software: { de: 'Software / Gerät', en: 'Software / device' },
  description: { de: 'Beschreibung', en: 'Description' }, usercomment: { de: 'Kommentar', en: 'Comment' },
  thumb: { de: 'Eingebettetes Vorschaubild', en: 'Embedded thumbnail' }, xmp: { de: 'XMP-Daten', en: 'XMP data' }, iptc: { de: 'IPTC-Daten', en: 'IPTC data' },
  comments: { de: 'Textnotizen', en: 'Text notes' }, trailer: { de: 'Zusatzdaten nach dem Bild', en: 'Extra data after the image' },
  makernote: { de: 'Herstellerdaten', en: 'Maker data' }, other: { de: 'Weitere Metadaten', en: 'Other metadata' },
  date: { de: 'Datum', en: 'Date' }, person: { de: 'Persönliches', en: 'Personal' },
};
const kb = (n, lang) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** Display rows for a parsed metadata object. */
function rows(m, lang) {
  const out = [];
  if (m.gps) {
    const c = `${m.gps.lat.toFixed(6)}, ${m.gps.lon.toFixed(6)}`;
    out.push({ k: T(lang, L.location), v: c + (m.gps.alt != null ? ` · ${Math.round(m.gps.alt)} m` : ''), warn: true });
  }
  for (const e of m.entries) out.push({ k: T(lang, L[e.key] || { de: e.key, en: e.key }), v: String(e.value), warn: e.group === 'person' });
  if (m.thumb) out.push({ k: T(lang, L.thumb), v: T(lang, { de: 'kann den ungeschnittenen Originalausschnitt zeigen', en: 'can show the uncropped original' }) });
  if (m.makerNote) out.push({ k: T(lang, L.makernote), v: kb(m.makerNote, lang) });
  if (m.xmp) out.push({ k: T(lang, L.xmp), v: kb(m.xmp, lang) });
  if (m.iptc) out.push({ k: T(lang, L.iptc), v: kb(m.iptc, lang) });
  for (const c of m.comments) out.push({ k: T(lang, L.comments), v: c.slice(0, 200) });
  if (m.trailer) out.push({ k: T(lang, L.trailer), v: kb(m.trailer, lang) });
  if (m.other) out.push({ k: T(lang, L.other), v: kb(m.other, lang) });
  return out;
}

function chips(m, lang) {
  const c = [];
  if (m.gps) c.push([T(lang, L.location), 'warn']);
  if (m.entries.some(e => e.group === 'camera')) c.push([T(lang, L.camera), '']);
  if (m.entries.some(e => e.group === 'time')) c.push([T(lang, L.date), '']);
  if (m.entries.some(e => e.group === 'person')) c.push([T(lang, L.person), 'warn']);
  if (m.entries.some(e => e.group === 'software')) c.push([T(lang, { de: 'Software', en: 'Software' }), '']);
  if (m.thumb) c.push([T(lang, { de: 'Vorschaubild', en: 'Thumbnail' }), '']);
  if (m.xmp || m.iptc || m.comments.length || m.other || m.makerNote) c.push([T(lang, { de: 'Weitere Daten', en: 'More data' }), '']);
  if (m.trailer) c.push([T(lang, { de: 'Anhang', en: 'Appendix' }), '']);
  return c;
}

let stageCtl = null;
const cache = new Map(); // input.id → parsed metadata

async function inspect(input) {
  if (cache.has(input.id)) return cache.get(input.id);
  const p = (async () => {
    const b = new Uint8Array(await input.file.arrayBuffer());
    try { return readMeta(b); } catch { return null; }
  })();
  cache.set(input.id, p);
  return p;
}

export default {
  shareFirst: true,
  labels: { back_to_files: { de: 'Zurück zu den Fotos', en: 'Back to the photos' } },
  options: [
    { id: 'keepDate', type: 'toggle', default: false, label: { de: 'Aufnahmedatum behalten', en: 'Keep the capture date' },
      hint: { de: 'Hilft beim Sortieren in der Galerie. Alles andere wird entfernt.', en: 'Helps sorting in your gallery. Everything else is removed.' } },
  ],

  mountStage(stage, state, ctx) { stageCtl = metaStage(stage, state, ctx); stageCtl.refresh(); },
  onInputs() { stageCtl?.refresh(); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let reencoded = 0, clean = 0;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, imgProgress(i, inputs.length, input.name));
      await ctx.tick();
      const b = await input.bytes();
      const f = detectFormat(b);
      try {
        if (f === 'jpeg' || f === 'png' || f === 'webp') {
          const r = stripMeta(b, { keepDate: !!opts.keepDate });
          // proof: same compressed image data, nothing private left
          const same = sameBytes(imageData(b), imageData(r.bytes));
          const left = readMeta(r.bytes);
          const leftover = left.gps || left.entries.some(e => !(opts.keepDate && e.group === 'time')) || left.thumb || left.xmp || left.iptc || left.comments.length || left.trailer || left.makerNote || left.other;
          if (!same || leftover) throw userError(`„${input.name}“ konnte nicht sicher bereinigt werden.`, `“${input.name}” could not be cleaned safely.`);
          const had = hasPrivate(r.meta);
          if (!had) clean++;
          const removed = chips(r.meta, ctx.lang).map(c => c[0]);
          const kept = [];
          if (r.kept.includes('orientation')) kept.push(ctx.t({ de: 'Drehung', en: 'rotation' }));
          if (r.kept.includes('date')) kept.push(ctx.t({ de: 'Datum', en: 'date' }));
          if (r.kept.includes('icc')) kept.push(ctx.t({ de: 'Farbprofil', en: 'colour profile' }));
          const note = (had ? ctx.t({ de: `Entfernt: ${removed.join(', ')}.`, en: `Removed: ${removed.join(', ')}.` }) : ctx.t({ de: 'Keine persönlichen Daten gefunden.', en: 'No personal data found.' }))
            + ' ' + ctx.t({ de: 'Bilddaten unverändert (verlustfrei).', en: 'Image data unchanged (lossless).' })
            + (kept.length ? ' ' + ctx.t({ de: `Behalten: ${kept.join(', ')}.`, en: `Kept: ${kept.join(', ')}.` }) : '');
          outputs.push({ name: ctx.safeFileName(input.name), blob: new Blob([r.bytes], { type: input.type }), before: input.size, note, meta: { input, noCompare: true } });
        } else {
          // HEIC / AVIF / others: no lossless editing – save the pixels again as JPG
          const m = readMeta(b);
          const { canvas } = await loadCanvas(input);
          let blob;
          try { blob = await encode(canvas, { format: 'jpg', quality: 0.92 }); } finally { release(canvas); }
          const tiff = opts.keepDate && m.date ? minimalTiff({ date: m.date.slice(0, 19) }) : null;
          if (tiff) {
            const seg = new Uint8Array(10 + tiff.length);
            seg.set([0xff, 0xe1, (8 + tiff.length) >> 8, (8 + tiff.length) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
            seg.set(tiff, 10);
            blob = new Blob([insertSegment(new Uint8Array(await blob.arrayBuffer()), seg)], { type: 'image/jpeg' });
          }
          reencoded++;
          outputs.push({ name: ctx.fileName(input.name, '', 'jpg'), blob, before: input.size,
            note: ctx.t({ de: 'Als JPG neu gespeichert – dabei wurden alle Metadaten entfernt.', en: 'Saved again as JPG – all metadata was removed.' }), meta: { input, noCompare: true } });
        }
      } finally { input._bytes = null; }
    }
    if (reencoded) ctx.note({ de: 'HEIC- und AVIF-Fotos lassen sich im Browser nicht verlustfrei bereinigen. Sie wurden deshalb als JPG neu gespeichert (sehr hohe Qualität).', en: 'HEIC and AVIF photos can’t be cleaned losslessly in the browser, so they were saved again as JPG (very high quality).' });
    if (clean === inputs.length) ctx.note({ de: 'In diesen Bildern waren keine persönlichen Daten.', en: 'These images contained no personal data.' });
    return { outputs: uniqueNames(outputs) };
  },
};

// ---------------------------------------------------------------- stage: what's in the photos
function metaStage(stage, state, ctx) {
  const lang = ctx.lang;
  const list = el('div', { class: 'img-exif-list' });
  const summary = el('p', { class: 'img-exif-sum', role: 'status' });
  const box = el('section', { class: 'img-box img-exif', aria: { labelledby: 'img-exif-h' } },
    el('h2', { class: 'img-h', id: 'img-exif-h' }, T(lang, { de: 'Das steckt in deinen Fotos', en: 'What’s in your photos' })),
    summary, list,
    el('p', { class: 'img-muted' }, T(lang, { de: 'Koordinaten werden nur als Zahlen angezeigt – es wird keine Karte geladen und nichts gesendet.', en: 'Coordinates are only shown as numbers – no map is loaded and nothing is sent.' })));
  stage.append(box);
  let token = 0;

  async function refresh() {
    const my = ++token;
    const inputs = state.inputs.filter(i => !i.error);
    for (const id of [...cache.keys()]) if (!inputs.some(i => i.id === id)) cache.delete(id);
    clear(list);
    summary.textContent = T(lang, { de: 'Fotos werden gelesen …', en: 'Reading photos …' });
    let withGps = 0, withData = 0;
    for (const [n, input] of inputs.entries()) {
      const m = await inspect(input);
      if (my !== token) return;
      if (!m) continue;
      if (m.gps) withGps++;
      if (hasPrivate(m)) withData++;
      const r = rows(m, lang);
      const head = el('summary', {}, el('span', { class: 'img-exif-name' }, input.name),
        el('ul', { class: 'img-chips', aria: { label: T(lang, { de: 'Gefunden', en: 'Found' }) } },
          r.length ? chips(m, lang).map(([t, k]) => el('li', { class: 'img-chip' + (k === 'warn' ? ' img-chip-warn' : '') }, t))
            : el('li', { class: 'img-chip img-chip-ok' }, T(lang, { de: 'Keine persönlichen Daten', en: 'No personal data' }))));
      const body = el('div', { class: 'img-exif-body' });
      if (m.gps) {
        body.append(el('p', { class: 'img-note' }, icon('alert'), el('span', {}, T(lang, {
          de: 'Dieses Foto verrät, wo es aufgenommen wurde – auf wenige Meter genau. Wer es bekommt, kann den Ort sehen.',
          en: 'This photo reveals where it was taken – to within a few metres. Anyone who gets it can see the place.' }))));
      }
      if (r.length) body.append(el('dl', { class: 'img-exif-dl' }, r.flatMap(x => [el('dt', {}, x.k), el('dd', { class: x.warn ? 'is-warn' : '' }, x.v)])));
      if (m.orientation > 1) body.append(el('p', { class: 'img-muted' }, T(lang, { de: 'Die Drehung bleibt erhalten, damit das Foto richtig herum angezeigt wird. Sie verrät nichts über dich.', en: 'The rotation is kept so the photo is shown the right way up. It reveals nothing about you.' })));
      if (m.format === 'heif') body.append(el('p', { class: 'img-muted' }, T(lang, { de: 'HEIC/AVIF wird beim Bereinigen als JPG neu gespeichert.', en: 'HEIC/AVIF is saved again as JPG when cleaning.' })));
      list.append(el('details', { class: 'img-exif-item', open: (m.gps && withGps === 1) || inputs.length === 1 }, head, body));
      if (n % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
    if (my !== token) return;
    summary.textContent = withData
      ? T(lang, { de: `${withData} von ${inputs.length} ${inputs.length === 1 ? 'Foto enthält' : 'Fotos enthalten'} persönliche Daten${withGps ? `, ${withGps} mit Standort` : ''}.`, en: `${withData} of ${inputs.length} ${inputs.length === 1 ? 'photo contains' : 'photos contain'} personal data${withGps ? `, ${withGps} with location` : ''}.` })
      : T(lang, { de: 'Keine persönlichen Daten gefunden.', en: 'No personal data found.' });
    ctx.refresh();
  }
  return { refresh };
}
