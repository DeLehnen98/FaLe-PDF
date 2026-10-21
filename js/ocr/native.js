// Text recognition with Apple's on-device engine (Vision) in the iOS app – ios-native/Sources/FaleVisionPlugin.swift.
// Faster and more accurate than the WebAssembly engine, works offline without language downloads; nothing leaves
// the device. The result has the same shape as js/ocr/engine.js recognize() (words, lines, paragraphs with boxes in
// source-image pixels), so text layers, searchable PDFs and form detection work unchanged.
// Anywhere else (web, Android) available() is false and the WebAssembly engine is used.

// the app's OCR language ids → Apple's
const APPLE = { deu: 'de-DE', eng: 'en-US', fra: 'fr-FR', ita: 'it-IT', spa: 'es-ES', por: 'pt-BR', nld: 'nl-NL', pol: 'pl-PL', tur: 'tr-TR', ukr: 'uk-UA', rus: 'ru-RU', jpn: 'ja-JP', kor: 'ko-KR', chi_sim: 'zh-Hans', chi_tra: 'zh-Hant' };
let langsP = null;
let off = false; // switched off after a native failure (until the next start) – the WebAssembly engine takes over

// (platform.js is loaded lazily: fromVision() stays usable in plain Node tests)
async function vision() {
  if (off || typeof window === 'undefined' || !window.Capacitor) return null;
  try {
    const { plugin, platformName, isNative } = await import('../platform.js');
    return isNative() && platformName() === 'ios' ? plugin('FaleVision') : null;
  } catch { return null; }
}

/** Apple languages the device supports (cached). */
function deviceLangs(p) {
  if (!langsP) langsP = Promise.resolve(p.languages()).then(r => (r && Array.isArray(r.languages) ? r.languages : []), () => []);
  return langsP;
}

/** Apple language ids for an app language string ('deu+eng'), or null when the device cannot read one of them. */
export async function appleLangs(lang) {
  const p = await vision();
  if (!p) return null;
  const want = String(lang || 'deu+eng').split('+').filter(Boolean).map(l => APPLE[l]);
  if (!want.length || want.some(x => !x)) return null;
  const have = await deviceLangs(p);
  if (!have.length) return null;
  const ok = want.every(w => have.includes(w) || have.some(h => h.split('-')[0] === w.split('-')[0]));
  return ok ? want.map(w => (have.includes(w) ? w : have.find(h => h.split('-')[0] === w.split('-')[0]))) : null;
}

/** Can Apple's engine read this language combination here? */
export async function available(lang = 'deu+eng') {
  return !!(await appleLangs(lang));
}

/** Switch native recognition off for this session (after an error) – callers fall back to the WebAssembly engine. */
export function disable() { off = true; }

function toB64(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.92);
  c.width = c.height = 0;
  return url.slice(url.indexOf(',') + 1);
}

/**
 * Recognize text in ImageData (from engine.toImageData) with Vision.
 * @returns engine-shaped result in SOURCE pixels (imageData.sourceScale undone)
 */
export async function recognizeImageData(imageData, { lang = 'deu+eng' } = {}) {
  const p = await vision();
  const langs = await appleLangs(lang);
  if (!p || !langs) throw Object.assign(new Error('native OCR not available'), { code: 'native_unavailable' });
  const r = await p.recognize({ image: toB64(imageData), languages: langs });
  return fromVision(r, imageData.sourceScale || 1);
}

/** Vision result → { text, words, lines, paragraphs, conf, width, height, angle } (pure; exported for tests). */
export function fromVision(r, srcScale = 1) {
  const k = 1 / (srcScale || 1);
  const bb = b => ({ x0: b[0] * k, y0: b[1] * k, x1: (b[0] + b[2]) * k, y1: (b[1] + b[3]) * k });
  const words = [], lines = [], paragraphs = [];
  let confSum = 0, confN = 0;
  // reading order: top to bottom (Vision mostly delivers it that way; sort to be sure, same row → left to right)
  const raw = (r && r.lines || []).filter(l => l && l.text && String(l.text).trim() && Array.isArray(l.box))
    .map(l => ({ ...l, b: bb(l.box) }))
    .sort((a, b) => {
      const ha = a.b.y1 - a.b.y0, hb = b.b.y1 - b.b.y0;
      const sameRow = Math.abs(a.b.y0 - b.b.y0) < Math.min(ha, hb) * 0.5;
      return sameRow ? a.b.x0 - b.b.x0 : a.b.y0 - b.b.y0;
    });
  let para = null, prev = null;
  raw.forEach(l => {
    const h = Math.max(1, l.b.y1 - l.b.y0);
    const size = h * 0.78; // box height (ascender to descender) → font size
    const base = l.b.y1 - h * 0.2;
    const ws = (Array.isArray(l.words) && l.words.length ? l.words : [{ text: l.text, conf: l.conf, box: l.box }])
      .map(wd => ({ t: String(wd.text || '').trim(), conf: (wd.conf || 0) * 100, b: Array.isArray(wd.box) ? bb(wd.box) : l.b }))
      .filter(x => x.t);
    if (!ws.length) return;
    // a new paragraph after a clear gap or when the line starts far from the previous one
    const gap = prev ? l.b.y0 - prev.b.y1 : Infinity;
    if (!para || gap > h * 0.9 || (prev && Math.abs(l.b.x0 - prev.b.x0) > h * 4 && gap > -h * 0.3)) {
      para = { text: '', bbox: { ...l.b }, lines: [], block: paragraphs.length };
      paragraphs.push(para);
    }
    const lineIdx = lines.length;
    const line = { text: '', bbox: l.b, conf: (l.conf || 0) * 100, words: [], par: paragraphs.length - 1, size, baseline: { x0: l.b.x0, y0: base, x1: l.b.x1, y1: base } };
    ws.forEach(x => {
      const word = { text: x.t, bbox: x.b, conf: x.conf, baseline: { x0: x.b.x0, y0: base, x1: x.b.x1, y1: base }, size, line: lineIdx, par: line.par };
      words.push(word);
      line.words.push(word);
      confSum += word.conf * x.t.length; confN += x.t.length;
    });
    line.text = line.words.map(w => w.text).join(' ');
    lines.push(line);
    para.lines.push(lineIdx);
    para.bbox = { x0: Math.min(para.bbox.x0, l.b.x0), y0: Math.min(para.bbox.y0, l.b.y0), x1: Math.max(para.bbox.x1, l.b.x1), y1: Math.max(para.bbox.y1, l.b.y1) };
    prev = l;
  });
  paragraphs.forEach(p => { p.text = p.lines.map(i => lines[i].text).join('\n'); });
  const clean = paragraphs;
  return {
    text: clean.map(p => p.text).join('\n\n'), words, lines, paragraphs: clean, conf: confN ? confSum / confN : 0,
    width: Math.round(((r && r.width) || 0) * k), height: Math.round(((r && r.height) || 0) * k), angle: 0, engine: 'apple',
  };
}

/**
 * Simulator test (scripts/ios-e2e/run.py, route #/e2e/ocr): Apple's engine reads a drawn test card – logs
 * „FALE-E2E ocr apple ok: …“ with the text and whether the word boxes sit where the words were drawn.
 */
export async function selfTest() {
  try {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111'; g.font = '56px Helvetica, Arial, sans-serif';
    g.fillText('Vollmacht für Edwin', 60, 120);
    g.font = '40px Helvetica, Arial, sans-serif';
    g.fillText('Geburtsdatum: 12.03.1961', 60, 230);
    g.fillText('Straße 42, 66620 Nonnweiler', 60, 320);
    const t0 = Date.now();
    const ok = await available('deu+eng');
    if (!ok) { console.error('FALE-E2E ocr apple failed: not available'); return; }
    // through the app's OCR entry point – the same path the tools use
    const r = await (await import('./engine.js')).recognize(c, { lang: 'deu+eng' });
    if (r.engine !== 'apple') { console.error('FALE-E2E ocr apple failed: engine ' + r.engine); return; }
    const w = r.words.find(x => /Geburtsdatum/.test(x.text));
    const boxOk = !!w && w.bbox.x0 > 30 && w.bbox.x0 < 120 && w.bbox.y0 > 170 && w.bbox.y1 < 260;
    const text = r.text.replace(/\s+/g, ' ').trim();
    const good = /Vollmacht/.test(text) && /Geburtsdatum/.test(text) && /66620/.test(text) && boxOk && r.paragraphs.length >= 1;
    console[good ? 'info' : 'error'](`FALE-E2E ocr apple ${good ? 'ok' : 'failed'}: ${JSON.stringify({ text, words: r.words.length, lines: r.lines.length, box: w && w.bbox, ms: Date.now() - t0 })}`);
  } catch (e) { console.error('FALE-E2E ocr apple failed: ' + (e && (e.message || e.code))); }
}
