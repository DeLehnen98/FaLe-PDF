// ENEX (note export format) → open files. Notes are cut out of the export with plain string scanning
// (exports can be hundreds of MB of base64 – no DOM for the whole file), the note body (ENML, an XHTML
// subset) is parsed with the Trusted-Types-safe HTML parser and turned into Markdown or clean HTML.
// Attachments are matched to <en-media hash="…"> by the MD5 of their bytes. Nothing leaves the browser.
import { parseHtmlString } from './conv-domparse.js';

// ---------------------------------------------------------------- MD5 (RFC 1321) – only to match attachments
const K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
export function md5hex(bytes) {
  const n = bytes.length;
  const total = ((n + 8) >>> 6) + 1 << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (n * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      const x = (a + f + K[i] + M[g]) | 0;
      b = (b + ((x << R[i]) | (x >>> (32 - R[i])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setInt32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- ENEX scanning
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()]));
function inner(block, tag, from = 0) {
  const a = block.indexOf(`<${tag}`, from);
  if (a < 0) return null;
  const gt = block.indexOf('>', a);
  if (gt < 0) return null;
  if (block[gt - 1] === '/') return { text: '', end: gt + 1, attrs: block.slice(a + tag.length + 1, gt - 1) };
  const b = block.indexOf(`</${tag}>`, gt);
  if (b < 0) return null;
  return { text: block.slice(gt + 1, b), end: b + tag.length + 3, attrs: block.slice(a + tag.length + 1, gt) };
}
const textOf = (block, tag) => { const r = inner(block, tag); return r ? unxml(r.text.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim() : ''; };
function allOf(block, tag) {
  const out = [];
  let from = 0, r;
  while ((r = inner(block, tag, from))) { out.push(r); from = r.end; }
  return out;
}
/** "20200131T120000Z" → Date | null */
export function enexDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || '').trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

function b64bytes(s) {
  const bin = atob(String(s).replace(/[^A-Za-z0-9+/=]/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/**
 * Notes of an ENEX export: [{title, created, updated, tags, source, author, enml, resources: [{hash, mime, name, bytes}]}]
 * Throws Error({userMessage}) when the text is no ENEX export.
 */
export function parseEnex(text) {
  if (!/<en-export[\s>]/.test(text.slice(0, 4000))) {
    throw Object.assign(new Error('not enex'), { userMessage: { de: 'Das ist keine ENEX-Datei (Notiz-Export).', en: 'This is not an ENEX file (note export).' } });
  }
  const notes = [];
  let from = 0;
  for (;;) {
    const a = text.indexOf('<note>', from);
    if (a < 0) break;
    const b = text.indexOf('</note>', a);
    if (b < 0) break;
    const block = text.slice(a + 6, b);
    from = b + 7;
    const contentRaw = inner(block, 'content');
    let enml = contentRaw ? contentRaw.text : '';
    const cd = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(enml);
    enml = cd ? cd[1] : unxml(enml);
    const attrs = inner(block, 'note-attributes');
    const resources = [];
    for (const r of allOf(block, 'resource')) {
      const data = inner(r.text, 'data');
      if (!data) continue;
      let bytes;
      try { bytes = b64bytes(data.text); } catch { continue; }
      const ra = inner(r.text, 'resource-attributes');
      resources.push({ hash: md5hex(bytes), mime: textOf(r.text, 'mime') || 'application/octet-stream', name: ra ? textOf(ra.text, 'file-name') : '', bytes });
    }
    notes.push({
      title: textOf(block, 'title') || 'Ohne Titel',
      created: enexDate(textOf(block, 'created')), updated: enexDate(textOf(block, 'updated')),
      tags: allOf(block, 'tag').map(t => unxml(t.text).trim()).filter(Boolean),
      source: attrs ? textOf(attrs.text, 'source-url') : '', author: attrs ? textOf(attrs.text, 'author') : '',
      enml, resources,
    });
  }
  return notes;
}

// ---------------------------------------------------------------- file names
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/amr': '.amr', 'video/mp4': '.mp4', 'text/plain': '.txt', 'application/zip': '.zip' };
export function safeName(s, max = 80) {
  let t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').trim();
  if (!t) t = 'Notiz';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = '_' + t;
  return t.length > max ? t.slice(0, max).trim() : t;
}
export function uniqueName(name, used) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = name, i = 2;
  while (used.has(n.toLowerCase())) n = `${base} (${i++})${ext}`;
  used.add(n.toLowerCase());
  return n;
}
/** Markdown link target: keep letters (ä stays ä), escape spaces and brackets. */
export const linkPath = p => String(p).replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
export const resourceFileName = r => (r.name ? safeName(r.name, 100) : `${r.hash.slice(0, 12)}${EXT[r.mime] || ''}`);

// ---------------------------------------------------------------- ENML → Markdown
function bodyOf(enml) {
  const s = String(enml).replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '');
  const doc = parseHtmlString(s.replace(/<en-note\b/i, '<div data-en-note').replace(/<\/en-note>/i, '</div>'));
  return doc.body.querySelector('[data-en-note]') || doc.body;
}
const mdEsc = s => s.replace(/([\\`*_[\]#|])/g, '\\$1').replace(/^(\s*)([-+>]|\d+\.)(\s)/, '$1\\$2$3');
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'pre', 'blockquote', 'hr', 'br', 'tr', 'en-todo']);

/**
 * @param links  Map hash → relative path of the attachment file
 * @param spare  [{mime, path}] attachments no <en-media> hash points to – used in order for media whose hash
 *               matches nothing (some exporters write wrong hashes); whatever is left is listed at the end
 * @returns {markdown, missing: number}  missing = media without any attachment
 */
export function enmlToMarkdown(enml, links, spare = []) {
  let missing = 0;
  const left = [...spare];
  const root = bodyOf(enml);
  const inline = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += mdEsc(n.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (tag === 'br') { out += '  \n'; continue; }
      if (tag === 'en-todo') { out += n.getAttribute('checked') === 'true' ? '[x] ' : '[ ] '; continue; }
      if (tag === 'en-media' || tag === 'img') { out += media(n); continue; }
      if (tag === 'en-crypt') { out += '*[verschlüsselter Text – nur in der Original-App lesbar]*'; continue; }
      const t = inline(n);
      if (!t.trim()) { out += t; continue; }
      const style = (n.getAttribute('style') || '').toLowerCase();
      if (tag === 'b' || tag === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(style)) out += wrapMark(t, '**');
      else if (tag === 'i' || tag === 'em' || /font-style:\s*italic/.test(style)) out += wrapMark(t, '*');
      else if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(style)) out += wrapMark(t, '~~');
      else if (tag === 'code' || tag === 'tt') out += '`' + n.textContent.replace(/`/g, '\\`') + '`';
      else if (tag === 'a') { const href = n.getAttribute('href') || ''; out += href && !/^\s*javascript:/i.test(href) ? `[${t.trim()}](${href.replace(/\s/g, '%20').replace(/\)/g, '%29')})` : t; }
      else if (BLOCK.has(tag)) out += '\n' + block(n).trim() + '\n';
      else out += t;
    }
    return out;
  };
  const wrapMark = (t, m) => { const l = t.match(/^\s*/)[0], r = t.match(/\s*$/)[0]; return `${l}${m}${t.trim()}${m}${r}`; };
  function media(n) {
    const hash = (n.getAttribute('hash') || '').toLowerCase();
    let path = links.get(hash);
    if (!path && n.localName === 'en-media' && left.length) {
      const type = n.getAttribute('type') || '';
      const i = Math.max(0, left.findIndex(x => x.mime === type));
      path = left.splice(i, 1)[0].path;
    }
    if (!path) { if (n.localName === 'en-media') missing++; const src = n.getAttribute('src'); return src && /^https?:/i.test(src) ? `![](${src})` : ''; }
    const type = n.getAttribute('type') || '';
    const label = path.split('/').pop();
    return /^image\//.test(type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(path) ? `![${mdEsc(label)}](${linkPath(path)})` : `[📎 ${mdEsc(label)}](${linkPath(path)})`;
  }
  function list(n, depth, ordered) {
    let out = '', i = 1;
    for (const li of n.children) {
      if (li.localName !== 'li') { out += block(li); continue; }
      const nested = [...li.children].filter(c => c.localName === 'ul' || c.localName === 'ol');
      const clone = li.cloneNode(true);
      [...clone.children].filter(c => c.localName === 'ul' || c.localName === 'ol').forEach(c => c.remove());
      const text = inline(clone).replace(/\n+/g, ' ').trim();
      out += `${'  '.repeat(depth)}${ordered ? `${i++}.` : '-'} ${text}\n`;
      for (const sub of nested) out += list(sub, depth + 1, sub.localName === 'ol');
    }
    return out;
  }
  function table(n) {
    const rows = [...n.querySelectorAll('tr')].map(tr => [...tr.children].filter(c => c.localName === 'td' || c.localName === 'th').map(c => inline(c).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const w = Math.max(...rows.map(r => r.length));
    const line = r => `| ${Array.from({ length: w }, (_, i) => r[i] || '').join(' | ')} |`;
    return [line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n';
  }
  function block(n) {
    const tag = n.localName;
    if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(+tag[1])} ${inline(n).replace(/\n+/g, ' ').trim()}\n\n`;
    if (tag === 'ul' || tag === 'ol') return '\n' + list(n, 0, tag === 'ol') + '\n';
    if (tag === 'table') return '\n' + table(n) + '\n';
    if (tag === 'pre') return '\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n';
    if (tag === 'blockquote') return '\n' + children(n).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    if (tag === 'hr') return '\n---\n\n';
    if (tag === 'br') return '\n';
    if (tag === 'div' || tag === 'p' || tag === 'li' || tag === 'en-note') {
      const hasBlock = [...n.children].some(c => BLOCK.has(c.localName) && c.localName !== 'br' && c.localName !== 'en-todo');
      if (hasBlock) return children(n);
      const t = inline(n).replace(/[ \t]+\n/g, m => (m.endsWith('  \n') ? m : '\n'));
      return t.trim() ? t.trim() + '\n\n' : (tag === 'div' ? '\n' : '');
    }
    return inline(n);
  }
  function children(n) {
    let out = '';
    let run = null;
    const flush = () => { if (run && run.childNodes.length) { const t = inline(run).trim(); if (t) out += t + '\n\n'; } run = null; };
    for (const c of n.childNodes) {
      if (c.nodeType === 1 && BLOCK.has(c.localName) && c.localName !== 'br' && c.localName !== 'en-todo') { flush(); out += block(c); }
      else { if (!run) run = n.ownerDocument.createElement('span'); run.appendChild(c.cloneNode(true)); }
    }
    flush();
    return out;
  }
  let md = children(root).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  if (left.length) md += '\n' + left.map(x => `[📎 ${mdEsc(x.path.split('/').pop())}](${linkPath(x.path)})`).join('  \n') + '\n';
  return { markdown: md, missing };
}

/** YAML front matter for a note. */
export function frontMatter(note) {
  const q = s => JSON.stringify(String(s));
  const lines = ['---', `title: ${q(note.title)}`];
  if (note.created) lines.push(`created: ${note.created.toISOString()}`);
  if (note.updated) lines.push(`updated: ${note.updated.toISOString()}`);
  if (note.tags.length) lines.push(`tags: [${note.tags.map(q).join(', ')}]`);
  if (note.source) lines.push(`source: ${q(note.source)}`);
  if (note.author) lines.push(`author: ${q(note.author)}`);
  lines.push('---', '');
  return lines.join('\n');
}
