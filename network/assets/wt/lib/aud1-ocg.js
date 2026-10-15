// Optional content (layers) survives copyPages: pdf-lib copies the layer objects a page uses, but not the
// catalog's /OCProperties – without it every layer is shown, so content that was hidden in the source
// (alternative languages, notes, print-only marks) suddenly appears. OcgCarrier pairs the source and the
// copied layer objects by walking both page trees in parallel and writes a matching /OCProperties
// (layer list, panel order, which layers are off) into the new document.
//   const oc = new OcgCarrier(PDFLib, out);
//   … const copied = await out.copyPages(src, idx); copied.forEach((p, k) => oc.collect(src, src.getPage(idx[k]), p));
//   oc.finish();
const SKIP = new Set(['/Parent', '/P', '/Font', '/Dest', '/A', '/StructParents', '/Contents', '/Thumb', '/B', '/Metadata', '/PieceInfo']);

export class OcgCarrier {
  constructor(PDFLib, out) {
    this.L = PDFLib;
    this.out = out;
    this.sources = new Map(); // src doc → Map(src ref string → dst ref)
  }

  collect(src, srcPage, dstPage) {
    const { PDFDict, PDFName } = this.L;
    const oc = src.catalog.lookup(PDFName.of('OCProperties'));
    if (!(oc instanceof PDFDict)) return;
    let map = this.sources.get(src);
    if (!map) this.sources.set(src, (map = new Map()));
    this.walk(src.context, srcPage.node, this.out.context, dstPage.node, map, 0, new Set());
  }

  walk(sc, s, dc, d, map, depth, seen) {
    const { PDFDict, PDFArray, PDFRef, PDFName, PDFStream } = this.L;
    if (depth > 10) return;
    let sObj = s, dObj = d;
    if (s instanceof PDFRef) {
      if (!(d instanceof PDFRef)) return;
      const key = s.toString();
      if (seen.has(key)) return;
      seen.add(key);
      sObj = sc.lookup(s); dObj = dc.lookup(d);
      const sd = sObj instanceof PDFStream ? sObj.dict : sObj;
      const type = sd instanceof PDFDict ? sd.get(PDFName.of('Type'))?.toString() : null;
      if (type === '/OCG' || type === '/OCMD') { map.set(key, d); if (type === '/OCG') return; }
    }
    if (sObj instanceof PDFStream && dObj instanceof PDFStream) { sObj = sObj.dict; dObj = dObj.dict; }
    if (sObj instanceof PDFDict && dObj instanceof PDFDict) {
      for (const [k, v] of sObj.entries()) {
        if (SKIP.has(k.toString())) continue;
        const dv = dObj.get(k);
        if (dv !== undefined) this.walk(sc, v, dc, dv, map, depth + 1, seen);
      }
    } else if (sObj instanceof PDFArray && dObj instanceof PDFArray && sObj.size() === dObj.size()) {
      for (let i = 0; i < sObj.size(); i++) this.walk(sc, sObj.get(i), dc, dObj.get(i), map, depth + 1, seen);
    }
  }

  finish() {
    const { PDFDict, PDFArray, PDFRef, PDFName, PDFString, PDFHexString } = this.L;
    const N = k => PDFName.of(k);
    const ocgs = [], off = [], order = [];
    let name = null;
    for (const [src, map] of this.sources) {
      if (!map.size) continue;
      const oc = src.catalog.lookup(N('OCProperties'));
      const list = oc.lookup(N('OCGs'));
      const D = oc.lookup(N('D'));
      const refs = list instanceof PDFArray ? list.asArray().filter(r => r instanceof PDFRef) : [];
      const inList = (arr, r) => arr instanceof PDFArray && arr.asArray().some(x => x instanceof PDFRef && x.toString() === r.toString());
      const baseOff = D instanceof PDFDict && D.get(N('BaseState'))?.toString() === '/OFF';
      const on = D instanceof PDFDict ? D.lookup(N('ON')) : null, offs = D instanceof PDFDict ? D.lookup(N('OFF')) : null;
      for (const r of refs) {
        const m = map.get(r.toString());
        if (!m) continue;
        ocgs.push(m);
        if (baseOff ? !inList(on, r) : inList(offs, r)) off.push(m);
      }
      const mapOrder = arr => {
        const outArr = [];
        for (const x of arr.asArray()) {
          const v = x instanceof PDFRef ? src.context.lookup(x) : x;
          if (x instanceof PDFRef && !(v instanceof PDFArray)) { const m = map.get(x.toString()); if (m) outArr.push(m); }
          else if (v instanceof PDFArray) { const sub = mapOrder(v); if (sub.some(e => e instanceof PDFRef || Array.isArray(e))) outArr.push(sub); }
          else if (v instanceof PDFString || v instanceof PDFHexString) outArr.push(v);
        }
        return outArr;
      };
      const ord = D instanceof PDFDict ? D.lookup(N('Order')) : null;
      if (ord instanceof PDFArray) order.push(...mapOrder(ord));
      if (!name && D instanceof PDFDict) name = D.get(N('Name')) || null;
    }
    if (!ocgs.length) return false;
    const ctx = this.out.context;
    const toObj = a => ctx.obj(a.map(e => (Array.isArray(e) ? toObj(e) : e)));
    const d = ctx.obj({});
    if (name) d.set(N('Name'), name);
    d.set(N('Order'), order.length ? toObj(order) : ctx.obj(ocgs));
    if (off.length) d.set(N('OFF'), ctx.obj(off));
    const props = ctx.obj({});
    props.set(N('OCGs'), ctx.obj(ocgs));
    props.set(N('D'), d);
    this.out.catalog.set(N('OCProperties'), ctx.register(props));
    return true;
  }
}
