// QR code encoder (ISO/IEC 18004), written for FaLe PDF: byte mode (UTF-8), ECC levels L/M/Q/H,
// versions 1–40, automatic or fixed mask with the standard penalty rules. Pure functions, no DOM.

const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// codewords per block / number of blocks, indexed [ecc][version]
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

export class QRTooLongError extends Error {
  constructor() { super('Der Inhalt ist zu lang für einen QR-Code.'); this.userMessage = this.message; }
}

/** Number of data modules (bits) available in a version (all modules minus function patterns). */
function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(ver, ecc) {
  const e = ECC[ecc];
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
}

/** Maximum number of bytes in byte mode for (version, ecc). */
export function byteCapacity(ver, ecc) {
  const bits = dataCodewords(ver, ecc) * 8 - 4 - (ver < 10 ? 8 : 16);
  return Math.max(0, Math.floor(bits / 8));
}

// ---------------------------------------------------------------- Reed–Solomon (GF(256), 0x11D)
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ---------------------------------------------------------------- encoding
function utf8(text) { return new TextEncoder().encode(String(text)); }

/**
 * Encode text as a QR code.
 * @param {string|Uint8Array} input
 * @param {{ecc?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number, mask?: number, boostEcc?: boolean}} [opts]
 * @returns {{version:number, size:number, ecc:string, mask:number, modules:Uint8Array, get:(x:number,y:number)=>boolean}}
 */
export function encodeQR(input, { ecc = 'M', minVersion = 1, maxVersion = 40, mask = -1, boostEcc = false } = {}) {
  if (!(ecc in ECC)) throw new Error('ecc');
  const bytes = input instanceof Uint8Array ? input : utf8(input);
  let ver;
  for (ver = Math.max(1, minVersion); ver <= maxVersion; ver++) {
    if (bytes.length <= byteCapacity(ver, ecc)) break;
  }
  if (ver > maxVersion) throw new QRTooLongError();
  // optionally raise ECC when it still fits in the same version
  if (boostEcc) for (const e of ['M', 'Q', 'H']) if (ECC[e] > ECC[ecc] && bytes.length <= byteCapacity(ver, e)) ecc = e;

  // bit stream
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCodewords(ver, ecc) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = new Uint8Array(capBits / 8);
  for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));

  // blocks + error correction, interleaved
  const e = ECC[ecc];
  const numBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ec = rsRemainder(dat, div);
    blocks.push({ dat, ec });
  }
  const codewords = [];
  const maxData = shortLen - eccLen + 1;
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dat.length) codewords.push(b.dat[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) codewords.push(b.ec[i]);

  // matrix
  const size = ver * 4 + 17;
  const mods = new Uint8Array(size * size);
  const isFn = new Uint8Array(size * size);
  const set = (x, y, dark, fn = true) => { mods[y * size + x] = dark ? 1 : 0; if (fn) isFn[y * size + x] = 1; };

  // timing patterns
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // finder patterns (+ separators)
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // alignment patterns
  const align = alignmentPositions(ver);
  const na = align.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // reserve format areas (written later) + dark module
  drawFormat(0);
  drawVersion();

  function drawFormat(m) {
    const dataBits = (FORMAT_BITS[ecc] << 3) | m;
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((dataBits << 10) | rem) ^ 0x5412;
    const bit = i => ((fbits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  }
  function drawVersion() {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }

  // data placement (zigzag)
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y * size + x]) continue;
        if (i < codewords.length * 8) mods[y * size + x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }

  const applyMask = m => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isFn[y * size + x]) continue;
      let inv;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv) mods[y * size + x] ^= 1;
    }
  };

  let best = mask;
  if (best < 0 || best > 7) {
    let minPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(mods, size);
      if (p < minPenalty) { minPenalty = p; best = m; }
      applyMask(m); // undo (XOR)
    }
  }
  applyMask(best);
  drawFormat(best);
  return { version: ver, size, ecc, mask: best, modules: mods, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mods[y * size + x] === 1 };
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

function penalty(m, size) {
  let result = 0;
  const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
  // runs + finder-like patterns, rows and columns
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let runColor = 0, runLen = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      const at = b => (pass ? m[b * size + a] : m[a * size + b]);
      const pushRun = len => { if (hist[0] === 0) len += size; hist.copyWithin(1, 0, 6); hist[0] = len; };
      const countPatterns = () => {
        const n = hist[1];
        const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
        return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
      };
      for (let b = 0; b < size; b++) {
        const c = at(b);
        if (c === runColor) {
          runLen++;
          if (runLen === 5) result += N1; else if (runLen > 5) result++;
        } else {
          pushRun(runLen);
          if (!runColor) result += countPatterns() * N3;
          runColor = c; runLen = 1;
        }
      }
      // terminate
      if (runColor) { pushRun(runLen); runLen = 0; }
      runLen += size;
      pushRun(runLen);
      result += countPatterns() * N3;
    }
  }
  // 2×2 blocks
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y * size + x];
    if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) result += N2;
  }
  // dark balance
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i];
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += Math.max(0, k) * N4;
  return result;
}

// ---------------------------------------------------------------- output helpers
/** SVG markup (one path), quiet zone of `border` modules. */
export function qrToSvg(qr, { border = 4, dark = '#000000', light = '#FFFFFF', size = null } = {}) {
  const n = qr.size + border * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.get(x, y)) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.get(x + run, y)) run++;
      d += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${dim} shape-rendering="crispEdges">`
    + (light && light !== 'transparent' ? `<rect width="${n}" height="${n}" fill="${light}"/>` : '')
    + `<path d="${d}" fill="${dark}"/></svg>`;
}

/** Draw into a 2D context at (x, y) with given pixel size (including quiet zone). */
export function drawQR(ctx, qr, x, y, px, { border = 4, dark = '#000000', light = '#FFFFFF' } = {}) {
  const n = qr.size + border * 2;
  const s = px / n;
  if (light && light !== 'transparent') { ctx.fillStyle = light; ctx.fillRect(x, y, px, px); }
  ctx.fillStyle = dark;
  for (let my = 0; my < qr.size; my++) for (let mx = 0; mx < qr.size; mx++) {
    if (!qr.get(mx, my)) continue;
    // integer-aligned edges avoid hairline gaps between modules
    const x0 = Math.round(x + (mx + border) * s), y0 = Math.round(y + (my + border) * s);
    const x1 = Math.round(x + (mx + border + 1) * s), y1 = Math.round(y + (my + border + 1) * s);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/** PDF content-stream operators drawing the code (without quiet zone background) into a box. */
export function qrPdfOps(qr, x, y, sizePt, { border = 4, rgb = [0, 0, 0], background = [1, 1, 1] } = {}) {
  const n = qr.size + border * 2;
  const s = sizePt / n;
  const f = v => String(+v.toFixed(4));
  let ops = '';
  if (background) ops += `${background.map(f).join(' ')} rg ${f(x)} ${f(y)} ${f(sizePt)} ${f(sizePt)} re f\n`;
  ops += `${rgb.map(f).join(' ')} rg\n`;
  for (let my = 0; my < qr.size; my++) {
    let mx = 0;
    while (mx < qr.size) {
      if (!qr.get(mx, my)) { mx++; continue; }
      let run = 1;
      while (mx + run < qr.size && qr.get(mx + run, my)) run++;
      ops += `${f(x + (mx + border) * s)} ${f(y + sizePt - (my + border + 1) * s)} ${f(run * s)} ${f(s)} re\n`;
      mx += run;
    }
  }
  return ops + 'f\n';
}

// ---------------------------------------------------------------- payload builders
const escWifi = s => String(s || '').replace(/([\\;,:"])/g, '\\$1');
const escVcard = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function wifiPayload({ ssid, password = '', security = 'WPA', hidden = false }) {
  const t = security === 'nopass' ? 'nopass' : security;
  return `WIFI:T:${t};S:${escWifi(ssid)};${t !== 'nopass' ? `P:${escWifi(password)};` : ''}${hidden ? 'H:true;' : ''};`;
}

export function vcardPayload(c) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const fn = [c.vorname, c.nachname].filter(Boolean).join(' ') || c.firma || '';
  lines.push(`N:${escVcard(c.nachname)};${escVcard(c.vorname)};;;`);
  lines.push(`FN:${escVcard(fn)}`);
  if (c.firma) lines.push(`ORG:${escVcard(c.firma)}`);
  if (c.titel) lines.push(`TITLE:${escVcard(c.titel)}`);
  if (c.telefon) lines.push(`TEL;TYPE=CELL:${escVcard(c.telefon)}`);
  if (c.email) lines.push(`EMAIL:${escVcard(c.email)}`);
  if (c.web) lines.push(`URL:${escVcard(c.web)}`);
  if (c.strasse || c.ort || c.plz) lines.push(`ADR;TYPE=WORK:;;${escVcard(c.strasse)};${escVcard(c.ort)};;${escVcard(c.plz)};${escVcard(c.land)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function mailPayload({ to, subject = '', body = '' }) {
  const q = [];
  if (subject) q.push('subject=' + encodeURIComponent(subject));
  if (body) q.push('body=' + encodeURIComponent(body));
  return `mailto:${to}${q.length ? '?' + q.join('&') : ''}`;
}

// ---------------------------------------------------------------- decoded content parsing (scanner)
/** Recognise what a scanned code contains. */
export function parsePayload(raw) {
  const s = String(raw || '');
  if (/^WIFI:/i.test(s)) {
    const get = k => { const m = s.match(new RegExp(`[:;]${k}:((?:\\\\.|[^;])*)`, 'i')); return m ? m[1].replace(/\\(.)/g, '$1') : ''; };
    return { type: 'wifi', ssid: get('S'), password: get('P'), security: get('T') || 'nopass', hidden: /H:true/i.test(s) };
  }
  if (/^BEGIN:VCARD/i.test(s)) {
    const get = k => { const m = s.match(new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, 'im')); return m ? m[1].replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, '\n').trim() : ''; };
    const n = get('N').split(';');
    return { type: 'vcard', name: get('FN') || [n[1], n[0]].filter(Boolean).join(' '), org: get('ORG'), tel: get('TEL'), email: get('EMAIL'), url: get('URL'), raw: s };
  }
  if (/^MECARD:/i.test(s)) {
    const get = k => { const m = s.match(new RegExp(`[:;]${k}:((?:\\\\.|[^;])*)`, 'i')); return m ? m[1].replace(/\\(.)/g, '$1') : ''; };
    const name = get('N').split(',').reverse().join(' ').trim();
    const vc = vcardPayload({ vorname: name, telefon: get('TEL'), email: get('EMAIL'), web: get('URL') });
    return { type: 'vcard', name, org: '', tel: get('TEL'), email: get('EMAIL'), url: get('URL'), raw: vc };
  }
  if (/^mailto:/i.test(s)) return { type: 'mail', to: decodeURIComponent(s.slice(7).split('?')[0]), raw: s };
  if (/^tel:/i.test(s)) return { type: 'tel', number: s.slice(4), raw: s };
  if (/^(https?:\/\/|www\.)\S+$/i.test(s.trim())) return { type: 'url', url: /^www\./i.test(s.trim()) ? 'https://' + s.trim() : s.trim() };
  return { type: 'text', text: s };
}
