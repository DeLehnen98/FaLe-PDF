// „Dokumenten-Gedächtnis“: lokaler Volltext-Index über alle Dateien (PDF-Textebene, OCR-Text von Scans,
// Word/Excel/PowerPoint, Text) mit deutscher Normalisierung (Umlaute, ß → ss, Stammformen nach CISTEM,
// Komposita-Zerlegung, Synonyme). Invertierter Index in IndexedDB (falepdf-smart: terms + idxdocs),
// inkrementell über die Bibliotheks-Hooks. Fragen wie „Wann läuft mein Handyvertrag aus?“ werden aus
// Fakten (Verträge, Beträge, Fristen, IBAN – erkannt vom Briefkasten-Extraktor) offline beantwortet.
// Optional: KI-Antwort über die besten Textstellen (nur nach Tipp + Zustimmung).
import * as db from '../db.js';
import { sdb, stx, reqP, h, esc, oicon, ensureSmartCss, emitSmart, money, deDate, todayIso, lsGet, lsSet } from './common.js';

// ------------------------------------------------------------------ German text normalisation
const STOP = new Set(('aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes auch auf aus bei bin bis bist da damit dann das dass dein deine deinem deinen deiner dem den denn der des dessen die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines er es etwas euch euer für gegen gewesen hab habe haben hat hatte hier hin hinter ich ihm ihn ihr ihre ihrem ihren ihrer im in indem ins ist jede jedem jeden jeder jetzt kann kein keine man mein meine meinem meinen meiner mich mir mit muss nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich sie sind so soll sollen über um und uns unser unsere unter vom von vor war waren was weil wenn wer werde werden wie wieder will wir wird wo zu zum zur zwar wann welche welcher welches wieviel viel ist sind gibt habe hast eure sowie bzw ca usw herr herrn frau sehr geehrte geehrter grüße freundlichen'
  .split(' ')).map(w => fold(w)));
const QUESTION = /\b(?:wann|wie|was|wo|welche[rsmn]?|wieviel|wie viel|bis wann|zeig|zeige|finde|suche|such|gib|nenne|mein|meine|meinen|meinem|meiner)\b/g;

export function fold(w) {
  return String(w || '').toLocaleLowerCase('de').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
}
/** CISTEM stemmer (Weissweiler & Fraser 2017), case-insensitive variant, on folded words. */
export function stem(word) {
  let w = fold(word);
  if (w.length <= 3 || /\d/.test(w)) return w;
  w = w.replace(/^ge(.{4,})/, '$1');
  w = w.replace(/sch/g, '$').replace(/ei/g, '%').replace(/ie/g, '&').replace(/(.)\1/g, '$1*');
  while (w.length > 3) {
    if (w.length > 5) {
      const a = w.replace(/e[mr]$/, ''); if (a !== w) { w = a; continue; }
      const b = w.replace(/nd$/, ''); if (b !== w) { w = b; continue; }
    }
    const c = w.replace(/t$/, ''); if (c !== w) { w = c; continue; }
    const d = w.replace(/[esn]$/, ''); if (d !== w) { w = d; continue; }
    break;
  }
  return w.replace(/(.)\*/g, '$1$1').replace(/\$/g, 'sch').replace(/%/g, 'ei').replace(/&/g, 'ie');
}
// common heads of German document compounds (folded) – "Handyvertrag" → handy + vertrag
const HEADS = ['vertrag', 'vertrage', 'nummer', 'rechnung', 'betrag', 'frist', 'versicherung', 'kasse', 'steuer', 'bescheid', 'konto', 'zahlung', 'kosten', 'gebuhr', 'beitrag', 'abrechnung',
  'bestatigung', 'kundigung', 'anbieter', 'strom', 'wasser', 'miete', 'telefon', 'karte', 'schein', 'laufzeit', 'datum', 'zeitraum', 'leistung', 'auszug', 'stand', 'nachweis', 'erklarung',
  'bescheinigung', 'antrag', 'termin', 'praxis', 'dienst', 'service', 'werke', 'amt', 'haus', 'wohnung', 'fahrzeug', 'reise', 'ticket', 'gutschein', 'pauschale', 'zuschlag', 'abschlag',
  'guthaben', 'nachzahlung', 'erstattung', 'forderung', 'mahnung', 'gehalt', 'lohn', 'einkommen', 'rente', 'geld', 'vermieter', 'verwaltung', 'mitgliedschaft', 'abo', 'tarif', 'police',
  'schutz', 'pflicht', 'haftpflicht', 'karte', 'zahler', 'buchung', 'bank', 'kunde', 'kunden', 'ende', 'beginn', 'zeit', 'jahr', 'monat', 'brief', 'post', 'bon', 'beleg', 'quittung'];
function splitCompound(fw) {
  const out = [];
  if (fw.length < 8) return out;
  for (const head of HEADS) {
    if (fw.length - head.length < 3 || !fw.endsWith(head)) continue;
    let left = fw.slice(0, fw.length - head.length);
    if (/(?:ungs|ions|tats|heits|keits|schafts|s)$/.test(left) && left.length > 4) left = left.replace(/s$/, '');
    if (left.endsWith('-')) left = left.slice(0, -1);
    if (left.length >= 3) { out.push(left, head); break; }
  }
  return out;
}
/** Tokens with positions: [{t: stem, i: start, e: end, w: folded word}] */
export function tokenize(text, { keepStop = false } = {}) {
  const out = [];
  const re = /[\p{L}\d][\p{L}\d.\-/]*[\p{L}\d]|[\p{L}\d]/gu;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[0];
    // codes keep their shape (IBAN, numbers with separators): also index the compact form
    const isCode = /\d/.test(raw);
    if (isCode) {
      const compact = raw.replace(/[.\-/]/g, '').toLowerCase();
      if (compact.length >= 2) out.push({ t: compact, i: m.index, e: m.index + raw.length, w: compact, code: true });
      continue;
    }
    for (const part of raw.split(/[-/.]/)) {
      const fw = fold(part);
      if (fw.length < 2 || (!keepStop && STOP.has(fw))) continue;
      out.push({ t: stem(fw), i: m.index, e: m.index + raw.length, w: fw });
      for (const p of splitCompound(fw)) out.push({ t: stem(p), i: m.index, e: m.index + raw.length, w: p, part: true });
    }
  }
  return out;
}
// synonym groups (folded stems are computed lazily)
const SYN_GROUPS = [
  ['handyvertrag', 'mobilfunkvertrag', 'mobilfunk', 'handy', 'smartphone', 'telefonvertrag', 'tarif', 'rufnummer', 'allnet'],
  ['strom', 'energie', 'stadtwerke', 'stromrechnung', 'stromvertrag', 'kwh', 'jahresabrechnung'],
  ['gas', 'gasrechnung', 'heizung', 'energie'],
  ['vermieter', 'hausverwaltung', 'miete', 'mietvertrag', 'wohnung', 'nebenkosten', 'betriebskosten'],
  ['kündigung', 'kündigen', 'kündigungsfrist', 'kündigungsbestätigung'],
  ['laufzeit', 'vertragsende', 'laufzeitende', 'endet', 'ablauf', 'mindestlaufzeit', 'ausläuft'],
  ['rechnung', 'abrechnung', 'beleg', 'quittung', 'kassenbon', 'invoice'],
  ['iban', 'konto', 'bankverbindung', 'kontonummer'],
  ['krankenkasse', 'krankenversicherung', 'aok', 'barmer', 'techniker', 'bkk', 'ikk', 'gesundheitskasse'],
  ['finanzamt', 'steuer', 'steuerbescheid', 'einkommensteuer', 'steuererklärung'],
  ['gehalt', 'lohn', 'lohnabrechnung', 'gehaltsabrechnung', 'entgelt', 'verdienst'],
  ['versicherung', 'police', 'versicherungsschein', 'beitrag'],
  ['fitness', 'fitnessstudio', 'studio', 'mitgliedschaft', 'gym'],
  ['auto', 'kfz', 'fahrzeug', 'pkw'],
  ['rundfunk', 'gez', 'rundfunkbeitrag', 'beitragsservice'],
  ['mahnung', 'zahlungserinnerung', 'inkasso', 'forderung'],
  ['arzt', 'praxis', 'befund', 'ärztin', 'zahnarzt'],
  ['internet', 'dsl', 'glasfaser', 'router', 'kabel'],
  ['kinder', 'kita', 'kindergarten', 'kindergeld', 'betreuung'],
  ['bezahlen', 'zahlen', 'überweisen', 'zahlbar', 'fällig', 'zahlung', 'nachzahlung'],
];
let synMap = null;
function synonymsOf(t) {
  if (!synMap) {
    synMap = new Map();
    for (const g of SYN_GROUPS) {
      const stems = [...new Set(g.flatMap(w => [stem(w), ...splitCompound(fold(w)).map(stem)]))];
      for (const s of stems) synMap.set(s, [...new Set([...(synMap.get(s) || []), ...stems.filter(x => x !== s)])]);
    }
  }
  return synMap.get(t) || [];
}

// ------------------------------------------------------------------ index maintenance
const MAX_PAGES = 200;
const sigOf = (d, extra) => `${d.size}|${d.modifiedAt || 0}|${d.textReady ? 1 : 0}|${d.name}|${extra ? extra.v : 0}`;
let syncing = null, dirty = true;

/** Bring the index up to date with the library (incremental). */
export function syncIndex({ force = false } = {}) {
  if (syncing) { if (force) dirty = true; return syncing; }
  if (!dirty && !force) return Promise.resolve(false);
  syncing = (async () => {
    dirty = false;
    let changed = false;
    try {
      const [docs, texts, idx] = await Promise.all([db.listFiles(), db.allTexts(), sdb.all('idxdocs')]);
      const tmap = new Map(texts.map(t => [t.id, t.pages || []]));
      const imap = new Map(idx.map(x => [x.id, x]));
      const alive = new Set(docs.map(d => d.id));
      for (const x of idx) if (!alive.has(x.id)) { await removeDoc(x.id); changed = true; }
      let n = 0;
      for (const d of docs) {
        const cur = imap.get(d.id);
        const extra = cur && cur.extra ? cur.extra : null;
        const sig = sigOf(d, extra);
        if (cur && cur.sig === sig && !force) continue;
        let pages = (tmap.get(d.id) || []).slice(0, MAX_PAGES);
        if (extra && extra.pages && extra.pages.length) {
          // OCR text (Briefkasten / background OCR) fills pages without a text layer
          pages = pages.length ? pages.map((p, i) => (String(p || '').replace(/\s+/g, '').length < 20 && extra.pages[i] ? extra.pages[i] : p)) : extra.pages.slice();
        }
        await indexDoc(d, pages, sig, extra);
        changed = true;
        if (++n % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    } catch (e) { console.warn('index', e); }
    finally { syncing = null; }
    if (changed) emitSmart('index');
    if (dirty) setTimeout(() => syncIndex(), 500);
    return changed;
  })();
  return syncing;
}
export function markDirty() { dirty = true; }

async function removeDoc(id) {
  const cur = await sdb.get('idxdocs', id);
  await stx(['terms', 'idxdocs', 'facts'], 'readwrite', async t => {
    const ts = t.objectStore('terms');
    for (const term of (cur && cur.terms) || []) {
      const rec = await reqP(ts.get(term));
      if (!rec) continue;
      delete rec.d[id];
      if (Object.keys(rec.d).length) ts.put(rec); else ts.delete(term);
    }
    t.objectStore('idxdocs').delete(id);
    const fs = t.objectStore('facts');
    const old = await reqP(fs.index('docId').getAll(id));
    for (const f of old) if (f.source === 'index') fs.delete(f.id);
  });
}

async function indexDoc(d, pages, sig, extra) {
  const post = new Map(); // term → [page, tf, page, tf …]
  const lens = [];
  const nameToks = tokenize(d.name.replace(/\.[a-z0-9]{2,5}$/i, ''));
  // tokenizing 200 long pages takes a few hundred ms – give the page a turn every ~25 ms (indexing runs in the
  // background right after an import, while the user is already working)
  let slice = performance.now();
  for (let pi = 0; pi < pages.length; pi++) {
    if (performance.now() - slice > 25) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
    const p = String(pages[pi] || '');
    const tf = new Map();
    // a Word/text file is one long „page“: tokenize it in pieces with breaks too (it froze the app after adding it)
    let n = 0;
    for (let at = 0; at < p.length || at === 0; ) {
      let end = Math.min(p.length, at + 4000);
      if (end < p.length) { const sp = p.lastIndexOf(' ', end); if (sp > at + 1000) end = sp; }
      const toks = tokenize(p.slice(at, end));
      n += toks.length;
      for (const tk of toks) tf.set(tk.t, (tf.get(tk.t) || 0) + (tk.part ? 0.5 : 1));
      at = end;
      if (at >= p.length) break;
      if (performance.now() - slice > 25) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
    }
    lens.push(n);
    if (pi === 0) for (const tk of nameToks) tf.set(tk.t, (tf.get(tk.t) || 0) + 2);
    for (const [t, n] of tf) { if (!post.has(t)) post.set(t, []); post.get(t).push(pi, Math.round(n * 2) / 2); }
  }
  if (!pages.length && nameToks.length) { lens.push(nameToks.length); for (const tk of nameToks) { if (!post.has(tk.t)) post.set(tk.t, [0, 2]); } }
  const old = await sdb.get('idxdocs', d.id);
  const oldTerms = new Set((old && old.terms) || []);
  const terms = [...post.keys()];
  await stx(['terms', 'idxdocs'], 'readwrite', async t => {
    const ts = t.objectStore('terms');
    for (const term of oldTerms) {
      if (post.has(term)) continue;
      const rec = await reqP(ts.get(term));
      if (!rec) continue;
      delete rec.d[d.id];
      if (Object.keys(rec.d).length) ts.put(rec); else ts.delete(term);
    }
    for (const [term, arr] of post) {
      const rec = (await reqP(ts.get(term))) || { t: term, d: {} };
      rec.d[d.id] = arr;
      ts.put(rec);
    }
    t.objectStore('idxdocs').put({ id: d.id, sig, name: d.name, kind: d.kind || 'pdf', pages: pages.map(p => String(p || '').slice(0, 20000)), lens, terms, extra: extra || null, updatedAt: Date.now() });
  });
  await factsFromText(d, pages);
}

/** Facts from any indexed letter-like document (contracts, deadlines, IBAN …), source 'index'. */
async function factsFromText(d, pages) {
  // the first pages are enough for sender, amounts and deadlines – a whole Word/text file in one „page“ took
  // half a second of frozen screen right after adding it
  const text = pages.slice(0, 4).join('\n\n').slice(0, 12000);
  const old = await sdb.byIndex('facts', 'docId', d.id);
  for (const o of old) if (o.source === 'index') await sdb.del('facts', o.id);
  if (text.replace(/\s+/g, '').length < 120) return;
  if (old.some(o => o.source === 'briefkasten')) return; // the Briefkasten record (user-checked) wins
  const X = await import('./extract.js');
  const r = X.extractLetter(text, { today: todayIso() });
  if (r.confidence < 0.45 && r.type !== 'vertrag') return;
  for (const f of X.factsOf(r)) await sdb.put('facts', { ...f, id: db.uid(), docId: d.id, source: 'index', updatedAt: Date.now() });
}

/** OCR text recognised elsewhere (Briefkasten, background OCR) → part of the index. */
export async function indexExtraText(docId, pages, { ocr = true } = {}) {
  if (!pages || !pages.some(p => String(p || '').trim())) return;
  const cur = (await sdb.get('idxdocs', docId)) || { id: docId, sig: '', terms: [], pages: [], lens: [] };
  cur.extra = { pages: pages.map(p => String(p || '').slice(0, 20000)), ocr, v: Date.now() };
  cur.sig = ''; // force re-index
  await sdb.put('idxdocs', cur);
  markDirty();
  return syncIndex();
}

// ------------------------------------------------------------------ querying
async function loadPostings(terms) {
  return stx('terms', 'readonly', async t => {
    const s = t.objectStore('terms');
    const out = new Map();
    for (const term of terms) { const r = await reqP(s.get(term)); if (r) out.set(term, r.d); }
    return out;
  });
}

/** Query terms with weights: original stems 1.0, compound parts 0.7, synonyms 0.55. */
export function queryTerms(q) {
  const cleaned = fold(q).replace(QUESTION, ' ');
  const toks = tokenize(cleaned);
  const terms = new Map();
  const concepts = [];
  for (const tk of toks) {
    const w = tk.part ? 0.7 : 1;
    if ((terms.get(tk.t) || 0) < w) terms.set(tk.t, w);
    if (!tk.part) concepts.push(new Set([tk.t, ...synonymsOf(tk.t), ...splitCompound(tk.w).map(stem)]));
    for (const s of synonymsOf(tk.t)) if (!terms.has(s)) terms.set(s, 0.55);
    // user typed "kuendigung" for "kündigung"
    if (/ae|oe|ue/.test(tk.w)) { const alt = stem(tk.w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')); if (!terms.has(alt)) terms.set(alt, 1); }
  }
  return { terms, concepts };
}

/**
 * Ranked passages for a query.
 * @returns {Promise<{results: Array, terms: Map}>}
 */
export async function searchPassages(q, { limit = 8 } = {}) {
  await syncIndex();
  const { terms, concepts } = queryTerms(q);
  if (!terms.size) return { results: [], terms };
  const post = await loadPostings([...terms.keys()]);
  const idx = await sdb.all('idxdocs');
  const byId = new Map(idx.map(x => [x.id, x]));
  let N = 0, total = 0;
  for (const x of idx) for (const l of x.lens || []) { N++; total += l; }
  const avg = N ? total / N : 1;
  const k1 = 1.4, b = 0.7;
  const units = new Map(); // "doc|page" → {score, matched:Set}
  const pw = new Map(); // term → weight·idf (rare words like a company name count more in the snippet window)
  for (const [term, w] of terms) {
    const d = post.get(term);
    if (!d) continue;
    let df = 0;
    for (const arr of Object.values(d)) df += arr.length / 2;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    pw.set(term, w * idf);
    for (const [docId, arr] of Object.entries(d)) {
      const x = byId.get(docId);
      if (!x) continue;
      for (let i = 0; i < arr.length; i += 2) {
        const page = arr[i], tf = arr[i + 1];
        const len = (x.lens && x.lens[page]) || avg;
        const s = w * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len / avg));
        const key = `${docId}|${page}`;
        const u = units.get(key) || { docId, page, score: 0, matched: new Set() };
        u.score += s;
        u.matched.add(term);
        units.set(key, u);
      }
    }
  }
  // concept coverage: pages matching more of the question's ideas rank higher
  for (const u of units.values()) {
    const cov = concepts.length ? concepts.filter(c => [...c].some(t => u.matched.has(t))).length / concepts.length : 1;
    u.score *= 0.4 + cov;
    u.coverage = cov;
  }
  const ranked = [...units.values()].sort((a, b2) => b2.score - a.score);
  const perDoc = new Map();
  const out = [];
  for (const u of ranked) {
    const c = perDoc.get(u.docId) || 0;
    if (c >= 2) continue;
    perDoc.set(u.docId, c + 1);
    const x = byId.get(u.docId);
    const text = (x.pages && x.pages[u.page]) || '';
    out.push({ docId: u.docId, name: x.name, kind: x.kind, page: u.page + 1, score: u.score, coverage: u.coverage, snippet: passage(text, terms, 260, pw, concepts), ocr: !!(x.extra && x.extra.ocr && x.extra.pages && x.extra.pages[u.page]) });
    if (out.length >= limit) break;
  }
  return { results: out, terms };
}

/** Best window of ~260 characters around the query terms → [{text, hit}] segments. */
export function passage(text, terms, size = 260, weights = null, concepts = null) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const toks = tokenize(t, { keepStop: true }).filter(tk => terms.has(tk.t));
  if (!toks.length) return [{ text: t.slice(0, size) + (t.length > size ? ' …' : ''), hit: false }];
  let best = { s: -1, a: 0 };
  for (const tk of toks) {
    const a = Math.max(0, tk.i - 60);
    const inWin = toks.filter(x => x.i >= a && x.e <= a + size);
    const seen = new Set(inWin.map(x => x.t));
    const wt = x => (weights && weights.has(x) ? weights.get(x) : 1);
    // each idea of the question counts once (synonyms do not stack); rare words (names) weigh more
    const s = concepts && concepts.length
      ? concepts.reduce((n, c) => n + 10 * Math.max(0, ...[...c].filter(x => seen.has(x)).map(wt)), 0) + inWin.length * 0.5
      : [...seen].reduce((n, x) => n + 10 * wt(x), 0) + inWin.length;
    if (s > best.s) best = { s, a };
  }
  let a = best.a;
  if (a > 0) { const sp = t.indexOf(' ', a); if (sp > 0 && sp - a < 20) a = sp + 1; }
  let e = Math.min(t.length, a + size);
  if (e < t.length) { const sp = t.lastIndexOf(' ', e); if (sp > a + size * 0.7) e = sp; }
  const segs = [];
  let pos = a;
  for (const tk of toks.filter(x => x.i >= a && x.e <= e)) {
    if (tk.i < pos) continue;
    if (tk.i > pos) segs.push({ text: t.slice(pos, tk.i), hit: false });
    segs.push({ text: t.slice(tk.i, tk.e), hit: true });
    pos = tk.e;
  }
  if (pos < e) segs.push({ text: t.slice(pos, e), hit: false });
  if (a > 0) segs.unshift({ text: '… ', hit: false });
  if (e < t.length) segs.push({ text: ' …', hit: false });
  return segs;
}

// ------------------------------------------------------------------ facts → offline answers
const INTENTS = [
  ['vertrag', /kündig|kuendig|läuft.*aus|lauft.*aus|ausläuft|endet|vertragsende|laufzeit|wann.*ende|bis wann.*vertrag|wie lange/],
  ['iban', /\biban\b|bankverbindung|kontonummer|konto\b|überweis/],
  ['frist', /frist|fällig|faellig|bis wann|wann muss|deadline|termin/],
  ['betrag', /wie ?viel|betrag|kostet|kosten|zahle|summe|höhe|preis|beitrag/],
  ['nummer', /kundennummer|vertragsnummer|aktenzeichen|steuernummer|rechnungsnummer|versichertennummer|mitgliedsnummer|nummer/],
  ['kontakt', /telefon|hotline|anrufen|e-mail|email|kontakt|erreiche/],
];
const INTENT_WORDS = /kündig\w*|kuendig\w*|läuft|lauft|aus|ausläuft|endet|ende|vertragsende|laufzeit|iban|bankverbindung|kontonummer|konto|frist\w*|fällig\w*|faellig|wann|bis|muss|wie|viel|wieviel|betrag|kostet|kosten|zahle\w*|summe|höhe|preis|nummer|telefon\w*|hotline|anrufen|e-mail|email|kontakt|mein\w*|der|die|das|von|vom|für|ist|wo|was|welche\w*|nächste\w*|termin\w*|lange/g;

export async function answerFacts(q, { today = todayIso() } = {}) {
  const ql = String(q || '').toLocaleLowerCase('de');
  const intents = INTENTS.filter(([, re]) => re.test(ql)).map(([k]) => k);
  if (!intents.length) return null;
  const entityText = ql.replace(INTENT_WORDS, ' ');
  const { terms } = queryTerms(entityText);
  const facts = await sdb.all('facts');
  if (!facts.length) return null;
  const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
  const X = await import('./extract.js');
  const scoreFact = f => {
    const doc = docs.get(f.docId);
    if (!doc) return -1;
    const hay = new Set(tokenize(`${f.subject || ''} ${X.typeInfo(f.docType).label} ${f.subtype ? X.SUBTYPE_LABELS[f.subtype] || '' : ''} ${doc.name} ${f.label || ''} ${(f.data && f.data.refs && Object.values(f.data.refs).join(' ')) || ''}`).map(t => t.t));
    if (f.kind === 'vertrag' && f.data) { const ctx = guessContractTopic(f, doc); ctx.forEach(t => hay.add(stem(t))); }
    let s = 0;
    for (const [t, w] of terms) if (hay.has(t)) s += w;
    if (!terms.size) s = 0.1;
    if (f.source === 'briefkasten') s += 0.2;
    if (f.letterDate) s += Math.max(0, 0.3 - (Date.now() - new Date(f.letterDate).getTime()) / (3.15e10 * 3));
    return s;
  };
  const want = intents[0];
  const kindFor = { vertrag: 'vertrag', iban: 'iban', frist: 'frist', betrag: 'betrag', nummer: 'nummer', kontakt: 'kontakt' }[want];
  let cands = facts.filter(f => f.kind === kindFor).map(f => ({ f, s: scoreFact(f) })).filter(x => x.s > 0);
  if (want === 'nummer') { const lab = /(kunden|vertrags|akten|steuer|rechnungs|versicherten|mitglieds)nummer|aktenzeichen/.exec(ql); if (lab) cands = cands.filter(x => fold(x.f.label).startsWith(fold(lab[0]).slice(0, 6))); }
  if (want === 'frist') cands = cands.filter(x => x.f.date >= today).sort((a, b) => b.s - a.s || a.f.date.localeCompare(b.f.date));
  else cands.sort((a, b) => b.s - a.s || String(b.f.letterDate || '').localeCompare(String(a.f.letterDate || '')));
  if (!cands.length || (terms.size && cands[0].s < 0.5)) {
    // contracts: also allow deadline facts of the same subject, or nothing
    if (want === 'vertrag') return answerFacts(q.replace(/kündig\w*|endet|ausläuft|läuft.*aus/gi, 'frist'), { today });
    return null;
  }
  const best = cands[0].f;
  const doc = docs.get(best.docId);
  let text = '', detail = '';
  if (best.kind === 'vertrag') {
    const c = X.nextCancellation(best.data, today);
    text = c.text || 'Vertragsdaten gefunden.';
    const bits = [best.data.start ? `Beginn ${deDate(best.data.start)}` : '', best.data.minTermMonths ? `Mindestlaufzeit ${best.data.minTermMonths} Monate` : '', best.data.renewalMonths ? `verlängert sich um ${best.data.renewalMonths} Monate` : best.data.renewalIndefinite ? 'danach monatlich kündbar' : ''].filter(Boolean);
    detail = bits.join(' · ');
  } else if (best.kind === 'frist') {
    text = `${best.label}: ${deDate(best.date)}`;
    detail = best.data && best.data.hint ? best.data.hint : '';
  } else if (best.kind === 'betrag') {
    text = `${best.label || 'Betrag laut Schreiben'}: ${best.value}`;
  } else text = `${best.label}: ${best.value}`;
  return { intent: want, subject: best.subject, text, detail, docId: best.docId, docName: doc ? doc.name : '', fact: best, more: cands.slice(1, 4).map(x => x.f) };
}
function guessContractTopic(f, doc) {
  const t = fold(`${f.subject || ''} ${doc.name}`);
  const out = [];
  if (/mobil|funk|telefon|handy|telekom|vodafone|o2/.test(t)) out.push('handyvertrag', 'handy', 'mobilfunk');
  if (/fitness|sport|studio|club|gym/.test(t)) out.push('fitness', 'fitnessstudio');
  if (/energie|strom|stadtwerke|gas/.test(t)) out.push('strom', 'stromvertrag');
  if (/versicher|assekuranz|haftpflicht/.test(t)) out.push('versicherung');
  if (/abo|verlag|zeitung|stream|film/.test(t)) out.push('abo', 'abonnement');
  if (/kabel|glasfaser|dsl|internet|net/.test(t)) out.push('internet');
  return out;
}

// ------------------------------------------------------------------ UI: answer box on #/suche
let seq = 0;
/** Render the "Gedächtnis" answer + passages above the classic search results. */
export async function renderAnswer(box, query) {
  if (!box) return;
  ensureSmartCss();
  const my = ++seq;
  const q = String(query || '').trim();
  if (q.length < 3) { box.replaceChildren(); box.hidden = true; return; }
  let ans = null, res = { results: [] };
  try { [ans, res] = await Promise.all([answerFacts(q), searchPassages(q, { limit: 6 })]); } catch (e) { console.warn(e); }
  if (my !== seq) return;
  const words = (q.match(/\S+/g) || []).length;
  // single plain words are covered by the classic search below – only show passages for real questions / multiple words
  const showPassages = res.results.length && (words >= 2 || /\?$/.test(q));
  if (!ans && !showPassages) { box.replaceChildren(); box.hidden = true; return; }
  const card = h(`<section class="card sm-answer" aria-live="polite"><div class="sm-answer-head">${oicon('sparkle')}<strong>Aus deinen Dokumenten</strong><span class="muted small">offline · auf diesem Gerät</span></div></section>`);
  if (ans) {
    // generated sentences (contract / deadline) are translatable; names and values from the document are not
    const a = h(`<div class="sm-fact"><p class="sm-fact-main"><span class="sm-fact-subj" data-no-i18n></span><span class="sm-fact-text"></span></p><p class="sm-fact-detail muted small"></p><a class="btn btn-soft btn-sm sm-fact-open">${oicon('file')}<span data-no-i18n></span></a></div>`);
    a.querySelector('.sm-fact-subj').textContent = ans.subject ? ans.subject + ': ' : '';
    const ft = a.querySelector('.sm-fact-text');
    const f = ans.fact || {};
    if (f.kind === 'vertrag') ft.textContent = ans.text;
    else if (f.kind === 'frist') { const lab = document.createElement('span'); lab.textContent = f.label || 'Frist'; ft.append(lab, ': ' + deDate(f.date)); }
    else {
      const lab = document.createElement('span'); lab.textContent = f.label || 'Betrag laut Schreiben';
      if (f.kind === 'betrag' && f.label) lab.dataset.noI18n = ''; // the amount label is the document's own wording
      const val = document.createElement('span'); val.dataset.noI18n = ''; val.textContent = f.value != null ? String(f.value) : '';
      ft.append(lab, ': ', val);
    }
    a.querySelector('.sm-fact-detail').textContent = ans.detail || '';
    a.querySelector('.sm-fact-open span').textContent = ans.docName || 'Dokument';
    a.querySelector('.sm-fact-open').href = await docHref(ans.docId, 1);
    card.appendChild(a);
  }
  if (showPassages) {
    const list = h('<div class="sm-passages"><h3 class="sm-pass-title">Passende Stellen</h3></div>');
    for (const r of res.results) {
      const it = h(`<a class="sm-pass"><span class="sm-pass-head"><strong data-no-i18n></strong><span class="sm-pass-page"></span></span><span class="sm-pass-snip" data-no-i18n></span></a>`);
      it.querySelector('strong').textContent = r.name;
      it.querySelector('.sm-pass-page').textContent = `Öffnen auf Seite ${r.page}`;
      const snip = it.querySelector('.sm-pass-snip');
      for (const s of r.snippet) { if (s.hit) { const m = document.createElement('mark'); m.textContent = s.text; snip.appendChild(m); } else snip.appendChild(document.createTextNode(s.text)); }
      it.href = await docHref(r.docId, r.page, q);
      list.appendChild(it);
    }
    card.appendChild(list);
    const ai = h(`<button class="btn btn-ghost btn-sm sm-ai-btn" type="button">${oicon('sparkle')}<span>KI-Antwort aus diesen Stellen (Cloud, optional)</span></button>`);
    ai.addEventListener('click', () => aiAnswer(card, q, res.results));
    card.appendChild(ai);
  }
  box.replaceChildren(card);
  box.hidden = false;
}
async function docHref(docId, page, q) {
  const d = await db.getDoc(docId);
  if (!d) return '#/dateien';
  const { openHash } = await import('../office/kinds.js');
  if (!d.kind || d.kind === 'pdf') return `#/ansicht/${d.id}?seite=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  return openHash(d);
}

async function aiAnswer(card, q, results) {
  const chunks = results.slice(0, 6).map(r => ({ page: r.page, text: `${r.name}: ${r.snippet.map(s => s.text).join('')}` }));
  const r = await (await import('../ui.js')).openDialog({
    title: 'KI-Antwort aus deinen Dokumenten?', wide: true,
    body: '<p>Deine Frage und die gezeigten Textstellen (nicht die ganzen Dateien) werden an die Cloud-KI gesendet.</p><details class="sm-text"><summary>Diese Textstellen senden</summary><pre data-no-i18n></pre></details>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Senden', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => { dlg.querySelector('pre').textContent = chunks.map(c => `[S. ${c.page}] ${c.text}`).join('\n\n'); return null; },
  });
  if (r.value !== 'ok') return;
  const ui = await import('../ai/ui.js');
  if (!(await ui.ensureCloud())) return;
  const out = h('<div class="sm-ai-out" aria-live="polite"><p class="muted small">Die KI antwortet …</p></div>');
  card.appendChild(out);
  try {
    const C = await import('../ai/client.js');
    let full = '';
    const res = await C.runTask('chat', { question: q, chunks, unit: 'S.', title: 'Meine Dokumente' }, {}, { stream: true, onDelta: (d, f) => { full = f; out.textContent = f; } });
    out.textContent = res.output || full;
  } catch (e) { out.remove(); ui.showAiError(e); }
}

// ------------------------------------------------------------------ background OCR (opt-in)
export const BG_OCR_KEY = 'fale-smart-bg-ocr';
export const bgOcrEnabled = () => lsGet(BG_OCR_KEY, '') === '1';
export function setBgOcr(on) { lsSet(BG_OCR_KEY, on ? '1' : null); if (on) scheduleBgOcr(5000); }
let bgTimer = 0, bgRunning = false;
async function charging() {
  try { if (navigator.getBattery) { const b = await navigator.getBattery(); return !!b.charging; } } catch {}
  return false;
}
export function scheduleBgOcr(ms = 60000) {
  if (!bgOcrEnabled()) return;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => {
    const go = () => runBgOcr().catch(e => console.warn('bg ocr', e)).finally(() => scheduleBgOcr(5 * 60000));
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 30000 }); else go();
  }, ms);
}
/** One step: OCR the next image-only document while the device is idle and charging. */
export async function runBgOcr({ ignoreCharging = false } = {}) {
  if (bgRunning || !bgOcrEnabled()) return false;
  if (document.visibilityState !== 'visible' && !ignoreCharging) return false;
  if (!ignoreCharging && !(await charging())) return false;
  const assets = await import('../ocr/assets.js');
  const st = await assets.offlineStatus(['deu', 'eng']);
  if (!(st.mode === 'bundled' || st.mode === 'cached')) return false; // never downloads in the background
  bgRunning = true;
  try {
    await syncIndex();
    const [docs, idx] = await Promise.all([db.listFiles(), sdb.all('idxdocs')]);
    const imap = new Map(idx.map(x => [x.id, x]));
    const todo = docs.find(d => {
      const x = imap.get(d.id);
      if (!x || x.bgTried || (x.extra && x.extra.pages)) return false;
      if (d.kind === 'image') return true;
      if (d.kind && d.kind !== 'pdf') return false;
      return d.textReady && (x.pages || []).length && (x.pages || []).slice(0, 10).every(p => String(p || '').replace(/\s+/g, '').length < 20);
    });
    if (!todo) return false;
    const x = imap.get(todo.id);
    x.bgTried = Date.now();
    await sdb.put('idxdocs', x);
    const { textOfDoc } = await import('./textsrc.js');
    const r = await textOfDoc(todo.id, { maxPages: 10 });
    if (r.ocr) await indexExtraText(todo.id, r.pages, { ocr: true });
    return true;
  } finally { bgRunning = false; }
}

// ------------------------------------------------------------------ status screen #/gedaechtnis
export async function stats() {
  const [idx, facts, docs] = await Promise.all([sdb.all('idxdocs'), sdb.all('facts'), db.listFiles()]);
  const terms = await stx('terms', 'readonly', t => reqP(t.objectStore('terms').count()));
  return { docs: idx.length, files: docs.length, pages: idx.reduce((s, x) => s + (x.lens || []).length, 0), terms, facts: facts.length, ocrDocs: idx.filter(x => x.extra && x.extra.ocr).length, contracts: facts.filter(f => f.kind === 'vertrag') };
}

export async function mount(screen) {
  ensureSmartCss();
  screen.root.classList.add('sm-screen');
  const wrap = h(`<div class="screen-inner sm-memory">
    <div class="card sm-hero"><span class="sm-hero-ic">${oicon('search')}</span><div><strong>Frag deine Dokumente</strong>
      <p>FaLe merkt sich den Inhalt aller Dateien auf diesem Gerät – auch erkannte Scans – und beantwortet Fragen wie „Wann läuft mein Handyvertrag aus?“ oder „IBAN Vermieter“. Ohne Internet.</p>
      <form class="search-box sm-ask" role="search">${oicon('search')}<input class="input" type="search" name="q" placeholder="z. B. Wann läuft mein Handyvertrag aus?" aria-label="Frage an deine Dokumente" enterkeyhint="search" autocomplete="off"></form>
    </div></div>
    <div data-answer></div>
    <h2 class="section-title">Verträge &amp; Fristen</h2>
    <div class="sm-contracts" data-contracts></div>
    <h2 class="section-title">Index</h2>
    <div class="card card-pad sm-idx" data-stats></div>
    <div class="card settings-group">
      <div class="settings-row"><div class="label"><strong>Scans im Hintergrund erkennen</strong><span>Bilder und Scans ohne Text werden nach und nach per Texterkennung durchsuchbar – nur wenn das Gerät lädt und FaLe gerade nicht genutzt wird. Alles bleibt auf dem Gerät.</span></div>
        <label class="switch"><input type="checkbox" data-bgocr><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Scans im Hintergrund erkennen</span></label></div>
      <div class="settings-row"><div class="label"><strong>Index neu aufbauen</strong><span>Falls Suchergebnisse fehlen.</span></div><button class="btn btn-ghost btn-sm" type="button" data-rebuild>${oicon('rotate')} Neu aufbauen</button></div>
    </div>
  </div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const form = wrap.querySelector('.sm-ask');
  form.addEventListener('submit', e => { e.preventDefault(); renderAnswer(wrap.querySelector('[data-answer]'), form.q.value); });
  const bg = wrap.querySelector('[data-bgocr]');
  bg.checked = bgOcrEnabled();
  bg.addEventListener('change', async () => {
    if (bg.checked) { const { ensureOcrReady } = await import('../ocr/ui.js'); if (!(await ensureOcrReady('deu+eng'))) { bg.checked = false; return; } }
    setBgOcr(bg.checked);
  });
  wrap.querySelector('[data-rebuild]').addEventListener('click', async () => {
    const { progress, toast } = await import('../ui.js');
    const p = progress('Index wird aufgebaut …');
    try { await sdb.clear('terms'); for (const x of await sdb.all('idxdocs')) { x.sig = ''; x.terms = []; await sdb.put('idxdocs', x); } await syncIndex({ force: true }); toast('Index ist aktuell.', 'success'); } finally { p.done(); paint(); }
  });
  async function paint() {
    await syncIndex();
    const s = await stats();
    const st = wrap.querySelector('[data-stats]');
    st.innerHTML = '';
    st.appendChild(h(`<div class="stat-row"><span><b>${s.docs}</b> von ${s.files} Dateien im Index</span><span><b>${s.pages}</b> Seiten</span><span><b>${s.terms}</b> Suchbegriffe</span><span><b>${s.facts}</b> erkannte Fakten</span>${s.ocrDocs ? `<span><b>${s.ocrDocs}</b> per Texterkennung</span>` : ''}</div>`));
    const box = wrap.querySelector('[data-contracts]');
    box.innerHTML = '';
    const X = await import('./extract.js');
    const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
    const list = s.contracts.filter(f => docs.has(f.docId));
    if (!list.length) { box.appendChild(h('<p class="muted small">Noch keine Verträge erkannt. Werte Vertragsbestätigungen im Briefkasten aus – dann erscheinen hier Laufzeiten und Kündigungstermine.</p>')); return; }
    for (const f of list) {
      const c = X.nextCancellation(f.data, todayIso());
      const it = h(`<a class="card sm-contract-row"><span class="sm-type-ic">${oicon('letter')}</span><span class="sm-row-txt"><strong data-no-i18n></strong><span class="small muted" data-no-i18n></span></span></a>`);
      it.querySelector('strong').textContent = f.subject || docs.get(f.docId).name;
      it.querySelector('span.small').textContent = c.text || '';
      it.href = await docHref(f.docId, 1);
      box.appendChild(it);
    }
  }
  await paint();
}
