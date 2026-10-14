// XML and HTML parsing without HTML strings (Trusted Types): the tool pages enforce
// "require-trusted-types-for 'script'" without an HTML policy, so DOMParser.parseFromString() throws.
// The office readers synced from the app (lib/shared/office/*) parse DOCX/XLSX/PPTX parts with
// DOMParser and build their document model from HTML strings. These parsers build the same DOM with
// createElementNS/createTextNode instead – nothing executes, nothing is fetched (inert documents),
// style attributes go through the CSSOM (allowed by the CSP, unlike style="…" in markup).
//
// installDomParserFallback() routes DOMParser.prototype.parseFromString through them on this page.

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', euro: '€', copy: '©', reg: '®', trade: '™',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚',
  bull: '•', middot: '·', deg: '°', sect: '§', para: '¶', times: '×', divide: '÷', plusmn: '±', micro: 'µ', szlig: 'ß',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ccedil: 'ç',
  thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', larr: '←', rarr: '→', check: '✓',
};

function decodeEntities(s, html) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    }
    if (!html) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? m;
    return NAMED[e] ?? m;
  });
}

const ATTR_RE = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function attrsOf(src, html) {
  const out = [];
  if (!src) return out;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src))) {
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    out.push([m[1], decodeEntities(v, html)]);
  }
  return out;
}

const TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<!(?:DOCTYPE|doctype)(?:[^>[]|\[[\s\S]*?\])*>|<\/([^\s>]+)\s*>|<([A-Za-z_][^\s\/>]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;

function errorDoc(msg) {
  const doc = document.implementation.createDocument(null, null, null);
  const el = doc.createElementNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror');
  el.textContent = msg;
  doc.appendChild(el);
  return doc;
}

/** Parse an XML string into an XMLDocument (namespaces resolved like DOMParser). */
export function parseXmlString(text) {
  const doc = document.implementation.createDocument(null, null, null);
  const src = String(text).replace(/^﻿/, '');
  const stack = [];           // { el, ns: Map(prefix → uri) }
  let nsScope = new Map([['xml', XML_NS], ['xmlns', XMLNS]]);
  let root = null;
  TOKEN_RE.lastIndex = 0;
  let m;
  const parent = () => (stack.length ? stack[stack.length - 1].el : null);
  try {
    while ((m = TOKEN_RE.exec(src))) {
      const [tok, cdata, close, open, attrSrc, selfClose, text, stray] = m;
      if (stray) return errorDoc('unexpected <');
      if (text != null) {
        const p = parent();
        if (p) p.appendChild(doc.createTextNode(decodeEntities(text, false)));
        else if (text.trim()) return errorDoc('text outside root');
        continue;
      }
      if (cdata != null) { const p = parent(); if (p) p.appendChild(doc.createCDATASection(cdata)); continue; }
      if (close) {
        const top = stack.pop();
        if (!top || top.el.tagName !== close) return errorDoc(`mismatched </${close}>`);
        nsScope = top.parentNs;
        continue;
      }
      if (!open) continue; // comment, PI, doctype
      if (!parent() && root) return errorDoc('second root');
      const attrs = attrsOf(attrSrc, false);
      let scope = nsScope;
      for (const [n, v] of attrs) {
        if (n === 'xmlns' || n.startsWith('xmlns:')) {
          if (scope === nsScope) scope = new Map(nsScope);
          scope.set(n === 'xmlns' ? '' : n.slice(6), v);
        }
      }
      const colon = open.indexOf(':');
      const prefix = colon > 0 ? open.slice(0, colon) : '';
      const uri = scope.get(prefix) || null;
      const el = doc.createElementNS(uri, open);
      for (const [n, v] of attrs) {
        if (n === 'xmlns' || n.startsWith('xmlns:')) { el.setAttributeNS(XMLNS, n, v); continue; }
        const c = n.indexOf(':');
        if (c > 0) el.setAttributeNS(scope.get(n.slice(0, c)) || null, n, v);
        else el.setAttribute(n, v);
      }
      const p = parent();
      if (p) p.appendChild(el); else { doc.appendChild(el); root = el; }
      if (!selfClose) { stack.push({ el, parentNs: nsScope }); nsScope = scope; }
      void tok;
    }
  } catch (err) {
    return errorDoc(String(err && err.message || err));
  }
  if (stack.length || !root) return errorDoc('unclosed element');
  return doc;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param']);
const SKIP_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'title', 'textarea']);
// end tags that implicitly close an open <p>/<li>/<td> … (enough for generated, well-formed HTML)
const CLOSES = { p: ['p'], li: ['li'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'], option: ['option'] };

/** Parse an HTML string into an inert HTMLDocument (no scripts, no event handlers, no loading). */
export function parseHtmlString(text) {
  const doc = document.implementation.createHTMLDocument('');
  const body = doc.body;
  const stack = [body];
  const top = () => stack[stack.length - 1];
  const src = String(text);
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(src))) {
    const [, cdata, close, open, attrSrc, selfClose, txt, stray] = m;
    if (txt != null || stray) { top().appendChild(doc.createTextNode(decodeEntities(txt ?? '<', true))); continue; }
    if (cdata != null) { top().appendChild(doc.createTextNode(cdata)); continue; }
    if (close) {
      const name = close.toLowerCase();
      if (name === 'body' || name === 'html' || name === 'head') continue;
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].localName === name) { stack.length = i; break; }
      }
      continue;
    }
    if (!open) continue;
    const name = open.toLowerCase();
    if (name === 'html' || name === 'head' || name === 'body') {
      if (name === 'body') for (const [n, v] of attrsOf(attrSrc, true)) if (n.toLowerCase() === 'class') body.className = v;
      continue;
    }
    if (SKIP_CONTENT.has(name)) {
      if (!selfClose) {
        const end = src.toLowerCase().indexOf(`</${name}`, TOKEN_RE.lastIndex);
        TOKEN_RE.lastIndex = end < 0 ? src.length : src.indexOf('>', end) + 1 || src.length;
      }
      continue;
    }
    const implied = CLOSES[name];
    if (implied && implied.includes(top().localName) && name !== 'tr') stack.pop();
    else if (name === 'tr') while (stack.length > 1 && ['td', 'th', 'tr'].includes(top().localName)) stack.pop();
    const el = /^(svg|math)$/.test(name) ? null : doc.createElement(name);
    if (!el) { // foreign content is not needed by the readers: skip it with its children
      const end = src.toLowerCase().indexOf(`</${name}`, TOKEN_RE.lastIndex);
      if (!selfClose) TOKEN_RE.lastIndex = end < 0 ? src.length : src.indexOf('>', end) + 1 || src.length;
      continue;
    }
    for (const [n, v] of attrsOf(attrSrc, true)) {
      const ln = n.toLowerCase();
      if (ln.startsWith('on') || ln === 'srcdoc' || ln === 'formaction') continue;
      if (ln === 'style') { el.style.cssText = v; continue; }
      if ((ln === 'href' || ln === 'src') && /^\s*javascript:/i.test(v)) continue;
      try { el.setAttribute(n, v); } catch { /* invalid attribute name */ }
    }
    top().appendChild(el);
    if (!VOID.has(name) && !selfClose) stack.push(el);
  }
  return doc;
}

let installed = false;
/** Route DOMParser through the parsers above on this page (idempotent). */
export function installDomParserFallback() {
  if (installed || typeof DOMParser === 'undefined') return;
  installed = true;
  const orig = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function parseFromString(str, type) {
    if (typeof str !== 'string') return orig.call(this, str, type);
    return /html/i.test(type) && !/xhtml/i.test(type) ? parseHtmlString(str) : parseXmlString(str);
  };
}
