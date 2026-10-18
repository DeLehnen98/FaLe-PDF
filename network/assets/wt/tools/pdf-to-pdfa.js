// Tool: PDF to PDF/A (archive PDF for authorities, courts, universities, e-file systems) – PDF/A-2b by default,
// PDF/A-3b (keeps attachments such as e-invoice XML) or PDF/A-1b (older portals). Pages that cannot be made
// PDF/A in place (missing fonts, print colours, old compression, transparency for PDF/A-1) become an image of
// the page with the text as an invisible, searchable layer; everything else stays as it is. Core: lib/pdfa-core.js.
import { loadPdfLib } from '../lib/pdf.js';
import { formatPages } from '../lib/ranges.js';
import { pdfBlob } from '../lib/org-common.js';

const WHY = {
  font: { de: 'nicht eingebettete Schriften', en: 'fonts that are not embedded' },
  cmyk: { de: 'Druckfarben (CMYK) ohne Farbprofil', en: 'print colours (CMYK) without a colour profile' },
  lzw: { de: 'veraltete LZW-Kompression', en: 'outdated LZW compression' },
  jpx: { de: 'Bilder im Format JPEG 2000', en: 'JPEG 2000 images' },
  ps: { de: 'PostScript-Inhalte', en: 'PostScript content' },
  transparency: { de: 'Transparenz (in PDF/A-1 nicht erlaubt)', en: 'transparency (not allowed in PDF/A-1)' },
  noap: { de: 'Kommentare ohne festes Aussehen', en: 'comments without a fixed appearance' },
  broken: { de: 'beschädigte Inhalte', en: 'damaged content' },
};

export default {
  options: [
    {
      id: 'level', type: 'radio', default: '2',
      label: { de: 'Standard', en: 'Standard' },
      choices: [
        { value: '2', label: 'PDF/A-2b', hint: { de: 'Empfohlen – passt für fast alle Portale und Behörden', en: 'Recommended – accepted almost everywhere' } },
        { value: '3', label: 'PDF/A-3b', hint: { de: 'Behält Anhänge, z. B. die XML einer E-Rechnung', en: 'Keeps attachments, e.g. the XML of an e-invoice' } },
        { value: '1', label: 'PDF/A-1b', hint: { de: 'Nur wenn ausdrücklich verlangt (ältere Systeme)', en: 'Only if explicitly required (older systems)' } },
      ],
    },
    {
      id: 'method', type: 'radio', default: 'auto',
      label: { de: 'Umwandlung', en: 'Conversion' },
      choices: [
        { value: 'auto', label: { de: 'Text erhalten', en: 'Keep text' }, hint: { de: 'Nur Seiten, die nicht anders gehen, werden zum Bild (mit unsichtbarem Text)', en: 'Only pages that need it become an image (with invisible text)' } },
        { value: 'raster', label: { de: 'Alle Seiten als Bild', en: 'All pages as images' }, hint: { de: 'Am sichersten, Text bleibt durchsuchbar – Datei wird größer', en: 'Safest, text stays searchable – larger file' } },
      ],
    },
    {
      id: 'dpi', type: 'select', default: '200',
      label: { de: 'Bildqualität für umgewandelte Seiten', en: 'Image quality for converted pages' },
      choices: [
        { value: '150', label: { de: '150 dpi – kleinere Datei', en: '150 dpi – smaller file' } },
        { value: '200', label: { de: '200 dpi – ausgewogen', en: '200 dpi – balanced' } },
        { value: '300', label: { de: '300 dpi – Druckqualität', en: '300 dpi – print quality' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const core = await import('../lib/pdfa-core.js');
    const { getFont, loadUniTtf, subsetTtf } = await import('../lib/unifont.js');
    const de = ctx.lang === 'de';
    const part = Number(opts.level) || 2;
    const dpi = Number(opts.dpi) || 200;
    const outputs = [];
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const share = a => (f + a) / inputs.length;
      const doc = await input.pdfDoc();
      const srcPdf = await input.pdfjs();
      const n = doc.getPageCount();
      const res = await core.makePdfA(doc, PDFLib, {
        part, srcPdf, method: opts.method === 'raster' ? 'raster' : 'auto', dpi, tick: ctx.tick,
        getFont: () => getFont(doc, { PDFLib }),
        fonts: { loadTtf: loadUniTtf, subset: subsetTtf },
        onProgress: (i, total, rasterising) => ctx.progress(rasterising ? share(0.3 + 0.6 * i / total) : share(0.3 * i / total), rasterising
          ? { de: `Seite wird als Bild übernommen … ${i + 1} von ${total}`, en: `Converting page to an image … ${i + 1} of ${total}` }
          : { de: `Seiten werden geprüft … ${i + 1} von ${total}`, en: `Checking pages … ${i + 1} of ${total}` }),
      });
      ctx.progress(share(0.93), { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await core.savePdfA(doc, PDFLib, { part });
      const notes = [];
      const r = res.rasterised;
      if (opts.method === 'raster') {
        notes.push(de ? `Alle Seiten sind jetzt Bilder (${dpi} dpi) mit unsichtbarem Text – durchsuchbar und kopierbar.` : `All pages are images now (${dpi} dpi) with invisible text – searchable and copyable.`);
      } else if (r.length) {
        const why = Object.entries(res.reasons).filter(([k]) => WHY[k]).map(([k]) => (de ? WHY[k].de : WHY[k].en));
        const list = formatPages(r);
        notes.push(de
          ? `${r.length === 1 ? `Seite ${list} wurde` : `${r.length === n ? 'Alle Seiten wurden' : `Die Seiten ${list} wurden`}`} als Bild mit unsichtbarem Text übernommen (Grund: ${why.join(', ')}). Text bleibt durchsuchbar.`
          : `${r.length === 1 ? `Page ${list} was` : r.length === n ? 'All pages were' : `Pages ${list} were`} turned into an image with invisible text (reason: ${why.join(', ')}). Text stays searchable.`);
      }
      if (res.fontsEmbedded && opts.method !== 'raster') notes.push(de ? 'Fehlende Standardschriften (Helvetica/Arial) wurden durch die maßgleiche Liberation Sans ersetzt und eingebettet.' : 'Missing standard fonts (Helvetica/Arial) were replaced by the metric-compatible Liberation Sans and embedded.');
      const rm = res.removed;
      const gone = [];
      if (rm.javascript) gone.push(de ? 'JavaScript' : 'JavaScript');
      if (rm.actions) gone.push(de ? 'automatische Aktionen' : 'automatic actions');
      if (rm.attachments) gone.push(de ? 'Dateianhänge (in PDF/A-3 erlaubt)' : 'attachments (allowed in PDF/A-3)');
      if (rm.xfa) gone.push(de ? 'dynamische Formulardaten (XFA)' : 'dynamic form data (XFA)');
      if (rm.annotations) gone.push(de ? `${rm.annotations} Element(e) wie Video oder Ton` : `${rm.annotations} item(s) like video or sound`);
      if (gone.length) notes.push(de ? `Entfernt, weil im Archivformat nicht erlaubt: ${gone.join(', ')}.` : `Removed because the archive format does not allow it: ${gone.join(', ')}.`);
      if (input.password) notes.push(de ? 'Der Passwortschutz wurde entfernt – PDF/A erlaubt keine Verschlüsselung.' : 'The password protection was removed – PDF/A does not allow encryption.');
      const tag = `PDF/A-${part}b`;
      outputs.push({ name: ctx.fileName(input.name, ` (${tag})`, 'pdf'), blob: pdfBlob(bytes), pages: n, note: notes.join(' ') });
    }
    return { outputs };
  },
};
