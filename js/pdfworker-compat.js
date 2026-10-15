// Polyfills the pdf.js worker needs but older Android System WebViews (< Chrome 114) lack.
// Without ArrayBuffer.prototype.transferToFixedLength pdf.js 6 skips page content
// ("getOperatorList – ignoring errors … transferToFixedLength is not a function").
const AB = typeof ArrayBuffer !== 'undefined' ? ArrayBuffer.prototype : null;
function copyTo(buf, len) {
  const n = len === undefined ? buf.byteLength : Math.max(0, Math.floor(Number(len)) || 0);
  const out = new ArrayBuffer(n);
  new Uint8Array(out).set(new Uint8Array(buf, 0, Math.min(n, buf.byteLength)));
  try { if (typeof structuredClone === 'function') structuredClone(buf, { transfer: [buf] }); } catch { /* detaching is best effort */ }
  return out;
}
if (AB && typeof AB.transferToFixedLength !== 'function') {
  Object.defineProperty(AB, 'transferToFixedLength', { value(len) { return copyTo(this, len); }, configurable: true, writable: true });
}
if (AB && typeof AB.transfer !== 'function') {
  Object.defineProperty(AB, 'transfer', { value(len) { return copyTo(this, len); }, configurable: true, writable: true });
}
