// GENERATED – synced copy of js/pdflibtune.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Two fixes for pdf-lib, applied once to the loaded library (app and webtools; no imports, synced to
// network/assets/wt/lib/shared/ by scripts/sync-webtools-vendor.mjs):
//
// 1. Writing pauses by time. pdf-lib only gives the page a turn when its object counter hits a multiple of
//    objectsPerTick – the object-stream writer counts in steps of 50, so big documents were written in one go and
//    the page froze for seconds. Now it pauses every ~30 ms.
// 2. One font resource per font and page. page.drawText(…, { font }) registers the font under a new random name
//    on every call; a 600-page text document had over 1000 font entries per page (13 MB instead of 2 MB) and
//    saving took seconds. The name of a font already on the page is reused.

export function tunePdfLib(PDFLib) {
  if (!PDFLib || PDFLib.faleTuned) return PDFLib;
  for (const W of [PDFLib.PDFWriter, PDFLib.PDFStreamWriter]) {
    if (!W || typeof W.forContext !== 'function') continue;
    const make = W.forContext;
    W.forContext = function (...args) {
      const w = make.apply(this, args);
      let last = performance.now();
      w.shouldWaitForTick = () => {
        const now = performance.now();
        if (now - last < 30) return false;
        last = now;
        return true;
      };
      return w;
    };
  }
  const P = PDFLib.PDFPage && PDFLib.PDFPage.prototype;
  if (P && typeof P.setFont === 'function' && PDFLib.PDFName) {
    const setFont = P.setFont;
    P.setFont = function (font) {
      const known = this.faleFontKeys && font && this.faleFontKeys.get(font.ref);
      if (known) {
        // only while the page still lists that name for exactly this font
        const dict = this.node.Resources?.()?.lookupMaybe?.(PDFLib.PDFName.of('Font'), PDFLib.PDFDict);
        if (dict && dict.get(known) === font.ref) {
          this.font = font;
          this.fontKey = known;
          return;
        }
      }
      setFont.call(this, font);
      if (font && this.fontKey) (this.faleFontKeys ||= new Map()).set(font.ref, this.fontKey);
    };
  }
  PDFLib.faleTuned = true;
  return PDFLib;
}
