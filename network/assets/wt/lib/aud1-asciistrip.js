// Lossless: remove ASCII85 / ASCIIHex layers from stream filter chains (they only make binary data 25–100 %
// larger, e.g. [/ASCII85Decode /DCTDecode] photos written by some PDF generators). The rest of the chain
// (DCT, Flate …) is kept byte-identical, so nothing visible changes. Returns the number of streams changed.
const ASCII = new Set(['/ASCII85Decode', '/A85', '/ASCIIHexDecode', '/AHx']);

export async function stripAsciiFilters(doc, PDFLib, tick = null) {
  const { PDFRawStream, PDFName, PDFArray, PDFDict, PDFNull } = PDFLib;
  const ctx = doc.context;
  const F = PDFName.of('Filter'), DP = PDFName.of('DecodeParms');
  let n = 0, k = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const f = obj.dict.lookup(F);
    const filters = f instanceof PDFName ? [f] : f instanceof PDFArray ? f.asArray().map(x => ctx.lookup(x)) : [];
    let lead = 0;
    while (lead < filters.length && filters[lead] instanceof PDFName && ASCII.has(filters[lead].toString())) lead++;
    if (!lead) continue;
    const dp = obj.dict.lookup(DP);
    if (dp && !(dp instanceof PDFArray) && filters.length > 1) continue; // ambiguous parameters – leave it
    try {
      const td = ctx.obj({});
      td.set(F, ctx.obj(filters.slice(0, lead)));
      const decoded = PDFLib.decodePDFRawStream(PDFRawStream.of(td, obj.getContents())).decode();
      const nd = obj.dict.clone(ctx);
      const rest = filters.slice(lead);
      if (!rest.length) { nd.delete(F); nd.delete(DP); }
      else {
        nd.set(F, rest.length === 1 ? rest[0] : ctx.obj(rest));
        if (dp instanceof PDFArray) {
          const parms = dp.asArray().slice(lead).map(x => ctx.lookup(x));
          if (rest.length === 1) { if (parms[0] instanceof PDFDict) nd.set(DP, parms[0]); else nd.delete(DP); }
          else if (parms.some(p => p instanceof PDFDict)) nd.set(DP, ctx.obj(parms.map(p => p ?? PDFNull)));
          else nd.delete(DP);
        }
      }
      nd.delete(PDFName.of('Length'));
      ctx.assign(ref, PDFRawStream.of(nd, decoded));
      n++;
    } catch (err) { console.warn('ascii filter kept', err); }
    if (tick && ++k % 20 === 0) await tick();
  }
  return n;
}
