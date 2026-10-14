// Minimal XLSX writer (SpreadsheetML) for pdf-to-excel: several sheets, inline strings, numbers with
// number formats (currency, percent, dates), a bold header row, column widths, frozen header.
import { loadJSZip } from './pdf.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // characters XML 1.0 does not allow
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const colName = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Sheet names: max. 31 chars, no []:*?/\, unique. */
export function sheetName(name, used) {
  let base = String(name || 'Tabelle').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Tabelle';
  let n = base, k = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${k++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

/**
 * @param {{name: string, rows: Array<Array<{v: any, fmt?: string, b?: boolean}|null>>, header?: boolean}[]} sheets
 * @returns {Promise<Blob>}
 */
export async function writeXlsx(sheets, { title = '' } = {}) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  // number formats → style ids (0 = default, 1 = bold, then pairs per format: normal, bold)
  const fmts = [];
  const fmtId = f => { let i = fmts.indexOf(f); if (i < 0) { fmts.push(f); i = fmts.length - 1; } return 164 + i; };
  const xfs = [[0, false], [0, true]];
  const xfOf = (fmt, bold) => {
    const nf = fmt ? fmtId(fmt) : 0;
    let i = xfs.findIndex(([n, b]) => n === nf && b === bold);
    if (i < 0) { xfs.push([nf, bold]); i = xfs.length - 1; }
    return i;
  };
  const used = new Set();
  const names = sheets.map(s => sheetName(s.name, used));
  sheets.forEach((sh, si) => {
    const rows = sh.rows;
    const nCols = Math.max(1, ...rows.map(r => r.length));
    const widths = new Array(nCols).fill(6);
    rows.slice(0, 500).forEach(r => r.forEach((c, k) => {
      if (!c || c.v == null) return;
      const len = typeof c.v === 'number' ? (c.fmt ? 12 : String(c.v).length + 1) : Math.min(60, String(c.v).length);
      widths[k] = Math.max(widths[k], len);
    }));
    const out = [];
    rows.forEach((r, ri) => {
      const cells = [];
      r.forEach((c, k) => {
        if (!c || c.v == null || c.v === '') return;
        const ref = colName(k) + (ri + 1);
        const s = xfOf(c.fmt || null, !!c.b);
        const sa = s ? ` s="${s}"` : '';
        if (typeof c.v === 'number' && Number.isFinite(c.v)) cells.push(`<c r="${ref}"${sa}><v>${c.v}</v></c>`);
        else cells.push(`<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`);
      });
      out.push(`<row r="${ri + 1}">${cells.join('')}</row>`);
    });
    const cols = widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${Math.min(70, w + 2).toFixed(1)}" customWidth="1"/>`).join('');
    const pane = sh.header && rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const dim = rows.length ? `<dimension ref="A1:${colName(nCols - 1)}${rows.length}"/>` : '';
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${dim}${pane}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${out.join('')}</sheetData></worksheet>`);
  });
  const numFmts = fmts.length ? `<numFmts count="${fmts.length}">${fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '';
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.map(([nf, b]) => `<xf numFmtId="${nf}" fontId="${b ? 1 : 0}" fillId="0" borderId="0" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${b ? ' applyFont="1"' : ''}/>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>FaLe Werkzeuge</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((n, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

/** CSV with ; for German (comma decimals) or , for English, UTF-8 with BOM (spreadsheet apps detect it). */
export function toCsv(rows, lang) {
  const sep = lang === 'de' ? ';' : ',';
  const q = s => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + rows.map(r => r.map(c => q(String(c ?? ''))).join(sep)).join('\r\n') + '\r\n';
}
