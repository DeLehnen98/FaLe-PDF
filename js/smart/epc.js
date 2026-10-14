// GiroCode / EPC-QR (EPC069-12, version 002, UTF-8) for SEPA credit transfers.
// Only builds the QR payload for the user's banking app – FaLe never initiates a payment.
import { validIban, cleanIban } from './extract.js';

const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

/**
 * @param {{name: string, iban: string, bic?: string, amount?: number|null, purpose?: string, reference?: string}} p
 * @returns {string} payload (lines joined with LF), max. 331 bytes
 */
export function epcPayload({ name, iban, bic = '', amount = null, purpose = '', reference = '' }) {
  const ib = cleanIban(iban);
  if (!validIban(ib)) throw Object.assign(new Error('iban'), { userMessage: 'Die IBAN ist ungültig – bitte prüfen.' });
  const nm = clean(name, 70);
  if (!nm) throw Object.assign(new Error('name'), { userMessage: 'Bitte gib den Empfänger an.' });
  let amt = '';
  if (amount != null && amount !== '') {
    const v = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(v) || v < 0.01 || v > 999999999.99) throw Object.assign(new Error('amount'), { userMessage: 'Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.' });
    amt = 'EUR' + v.toFixed(2);
  }
  const b = String(bic || '').toUpperCase().replace(/\s/g, '');
  const ref = clean(reference, 35).replace(/\s/g, '');
  const structured = /^RF\d{2}[A-Z0-9]{1,21}$/.test(ref) ? ref : '';
  const text = structured ? '' : clean(purpose || reference, 140);
  // service tag, version, character set (1 = UTF-8), identification, BIC, name, IBAN, amount, purpose code, structured ref, text
  const lines = ['BCD', '002', '1', 'SCT', /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b) ? b : '', nm, ib, amt, '', structured, text];
  while (lines.length > 8 && lines[lines.length - 1] === '') lines.pop();
  const payload = lines.join('\n');
  if (new TextEncoder().encode(payload).length > 331) throw Object.assign(new Error('long'), { userMessage: 'Die Angaben sind zu lang für einen GiroCode.' });
  return payload;
}

/** Parse an EPC payload back (used by tests and by the QR scanner result sheet if wanted). */
export function parseEpc(s) {
  const l = String(s || '').split(/\r?\n/);
  if (l[0] !== 'BCD') return null;
  return { version: l[1], charset: l[2], id: l[3], bic: l[4] || '', name: l[5] || '', iban: l[6] || '', amount: l[7] ? parseFloat(l[7].replace(/^EUR/, '')) : null, purposeCode: l[8] || '', reference: l[9] || '', text: l[10] || '' };
}

/** SVG markup of the GiroCode (error correction M as required by EPC069-12). */
export async function epcSvg(payload, { size = 240 } = {}) {
  const { encodeQR, qrToSvg } = await import('../tools/qr.js');
  const qr = encodeQR(payload, { ecc: 'M', maxVersion: 13 });
  return qrToSvg(qr, { border: 4, size });
}
/** PNG blob of the GiroCode (for sharing/saving). */
export async function epcPng(payload, { px = 8 } = {}) {
  const { encodeQR, drawQR } = await import('../tools/qr.js');
  const qr = encodeQR(payload, { ecc: 'M', maxVersion: 13 });
  const n = qr.size + 8;
  const c = document.createElement('canvas');
  c.width = c.height = n * px;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  drawQR(g, qr, 0, 0, c.width, { border: 4 });
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
