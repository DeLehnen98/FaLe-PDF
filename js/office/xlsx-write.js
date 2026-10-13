// Workbook model → .xlsx (own SpreadsheetML writer on top of JSZip). Opens in Excel and LibreOffice without repair.
import { loadJSZip, xmlEsc } from './vendor.js';
import { KEY, R_OF, C_OF } from './workbook.js';
import { colName, toXlsx, isErr } from './formula.js';
import { ensureSheetExtras, filterHidden, parseRange, CF_STYLES, CF_SCALES } from './sheetfx.js';

const BUILTIN = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49 };
const ERRS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);

function argb(hex) { return 'FF' + String(hex || '#000000').replace('#', '').toUpperCase(); }

export async function writeXlsx(wb, { title = 'Tabelle' } = {}) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  // ---- styles registry ----
  const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'];
  const fontIdx = new Map([['', 0]]);
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fillIdx = new Map([['', 0]]);
  const numFmts = [];
  const fmtIdx = new Map();
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const borderIdx = new Map([['', 0]]);
  const BL = '<color rgb="FF000000"/>';
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIdx = new Map([['', 0]]);
  const styleId = s => {
    if (!s) return 0;
    const fontKey = (s.b ? 'b' : '') + (s.i ? 'i' : '') + (s.u ? 'u' : '') + (s.color || '') + '|' + (s.size || '');
    let fi = 0;
    if (fontKey !== '|') {
      if (!fontIdx.has(fontKey)) {
        fontIdx.set(fontKey, fonts.length);
        fonts.push(`<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.u ? '<u/>' : ''}<sz val="${s.size || 11}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : '<color theme="1"/>'}<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`);
      }
      fi = fontIdx.get(fontKey);
    }
    let fl = 0;
    if (s.fill) {
      if (!fillIdx.has(s.fill)) { fillIdx.set(s.fill, fills.length); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`); }
      fl = fillIdx.get(s.fill);
    }
    let nf = 0;
    if (s.fmt && s.fmt !== 'General') {
      if (BUILTIN[s.fmt] != null) nf = BUILTIN[s.fmt];
      else {
        if (!fmtIdx.has(s.fmt)) { fmtIdx.set(s.fmt, 164 + numFmts.length); numFmts.push(`<numFmt numFmtId="${164 + numFmts.length}" formatCode="${xmlEsc(s.fmt)}"/>`); }
        nf = fmtIdx.get(s.fmt);
      }
    }
    let bi = 0;
    if (s.bd && (s.bd.t || s.bd.r || s.bd.b || s.bd.l)) {
      const k = `${s.bd.l ? 1 : 0}${s.bd.r ? 1 : 0}${s.bd.t ? 1 : 0}${s.bd.b ? 1 : 0}`;
      if (!borderIdx.has(k)) { borderIdx.set(k, borders.length); borders.push(`<border>${s.bd.l ? `<left style="thin">${BL}</left>` : '<left/>'}${s.bd.r ? `<right style="thin">${BL}</right>` : '<right/>'}${s.bd.t ? `<top style="thin">${BL}</top>` : '<top/>'}${s.bd.b ? `<bottom style="thin">${BL}</bottom>` : '<bottom/>'}<diagonal/></border>`); }
      bi = borderIdx.get(k);
    }
    const al = s.align || s.wrap ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>` : '';
    const key = `${nf}|${fi}|${fl}|${bi}|${al}`;
    if (!xfIdx.has(key)) {
      xfIdx.set(key, xfs.length);
      xfs.push(`<xf numFmtId="${nf}" fontId="${fi}" fillId="${fl}" borderId="${bi}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${fi ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}${bi ? ' applyBorder="1"' : ''}${al ? ` applyAlignment="1">${al}</xf>` : '/>'}`);
    }
    return xfIdx.get(key);
  };

  // ---- shared strings ----
  const sst = [];
  const sstIdx = new Map();
  let sstCount = 0;
  const strId = s => {
    sstCount++;
    if (!sstIdx.has(s)) { sstIdx.set(s, sst.length); sst.push(s); }
    return sstIdx.get(s);
  };

  // ---- differential styles (conditional formatting) ----
  const dxfs = [];
  const dxfIdx = new Map();
  const dxfId = st => {
    const key = `${st.fill || ''}|${st.color || ''}|${st.b ? 1 : 0}`;
    if (!dxfIdx.has(key)) {
      dxfIdx.set(key, dxfs.length);
      dxfs.push(`<dxf>${st.color || st.b ? `<font>${st.b ? '<b/>' : ''}${st.color ? `<color rgb="${argb(st.color)}"/>` : ''}</font>` : ''}${st.fill ? `<fill><patternFill><bgColor rgb="${argb(st.fill)}"/></patternFill></fill>` : ''}</dxf>`);
    }
    return dxfIdx.get(key);
  };
  const numLit = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? String(n) : `"${String(v ?? '').replace(/"/g, '""')}"`; };
  const charts = []; // { si, sh, chart }
  const filterNames = [];

  const names = uniqueSheetNames(wb.sheets.map(s => s.name));
  // ---- sheets ----
  const sheetXml = wb.sheets.map((sh, si) => {
    ensureSheetExtras(sh);
    const hidden = new Set([...sh.hiddenRows, ...filterHidden(sh)]);
    const byRow = new Map();
    for (const [k, cell] of sh.cells) {
      const r = R_OF(k);
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push([C_OF(k), cell]);
    }
    for (const r of hidden) if (!byRow.has(r)) byRow.set(r, []);
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    let out = '';
    for (const r of rows) {
      const cells = byRow.get(r).sort((a, b) => a[0] - b[0]);
      let rx = `<row r="${r + 1}"${hidden.has(r) ? ' hidden="1"' : ''}>`;
      for (const [c, cell] of cells) {
        const ref = colName(c) + (r + 1);
        const s = styleId(cell.s);
        const sa = s ? ` s="${s}"` : '';
        if (cell.f) {
          const f = `<f>${xmlEsc(toXlsx(cell.f))}</f>`;
          const v = cell.cv;
          if (typeof v === 'number' && Number.isFinite(v)) rx += `<c r="${ref}"${sa}>${f}<v>${v}</v></c>`;
          else if (typeof v === 'boolean') rx += `<c r="${ref}"${sa} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
          else if (typeof v === 'string') rx += `<c r="${ref}"${sa} t="str">${f}<v>${xmlEsc(v)}</v></c>`;
          else if (isErr(v)) rx += `<c r="${ref}"${sa} t="e">${f}<v>${ERRS.has(v.code) ? v.code : '#VALUE!'}</v></c>`;
          else rx += `<c r="${ref}"${sa}>${f}</c>`;
          continue;
        }
        const v = cell.v;
        if (v === null || v === undefined || v === '') { if (s) rx += `<c r="${ref}"${sa}/>`; continue; }
        if (typeof v === 'number') rx += Number.isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : `<c r="${ref}"${sa} t="e"><v>#NUM!</v></c>`;
        else if (typeof v === 'boolean') rx += `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
        else if (isErr(v)) rx += `<c r="${ref}"${sa} t="e"><v>${ERRS.has(v.code) ? v.code : '#VALUE!'}</v></c>`;
        else rx += `<c r="${ref}"${sa} t="s"><v>${strId(String(v))}</v></c>`;
      }
      out += rx + '</row>';
    }
    const dim = sh.maxR >= 0 && sh.maxC >= 0 ? `A1:${colName(sh.maxC)}${sh.maxR + 1}` : 'A1';
    let cols = '';
    const widths = sh.colW.map((w, i) => [i, w]).filter(([, w]) => w != null);
    if (widths.length) cols = '<cols>' + widths.map(([i, w]) => (w === 0 ? `<col min="${i + 1}" max="${i + 1}" width="9.140625" hidden="1" customWidth="1"/>` : `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, (w - 5) / 7).toFixed(2)}" customWidth="1"/>`)).join('') + '</cols>';
    const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>` : '';
    const views = `<sheetViews><sheetView${si === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>`;
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${colName(m.c1)}${m.r1 + 1}:${colName(m.c2)}${m.r2 + 1}"/>`).join('')}</mergeCells>` : '';
    // AutoFilter
    let af = '';
    const afr = sh.autoFilter && parseRange(sh.autoFilter.range);
    if (afr) {
      const ref = `${colName(afr.c1)}${afr.r1 + 1}:${colName(afr.c2)}${afr.r2 + 1}`;
      const fcols = Object.entries(sh.autoFilter.filters || {}).filter(([, v]) => Array.isArray(v));
      af = `<autoFilter ref="${ref}">${fcols.map(([c, vals]) => `<filterColumn colId="${+c - afr.c1}"><filters${vals.includes('(Leer)') ? ' blank="1"' : ''}>${vals.filter(v => v !== '(Leer)').map(v => `<filter val="${xmlEsc(v)}"/>`).join('')}</filters></filterColumn>`).join('')}</autoFilter>`;
      filterNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${si}" hidden="1">${xmlEsc(`'${names[si].replace(/'/g, "''")}'!$${colName(afr.c1)}$${afr.r1 + 1}:$${colName(afr.c2)}$${afr.r2 + 1}`)}</definedName>`);
    }
    // conditional formatting
    let prio = 1;
    const cfx = (sh.cf || []).map(rule => {
      const rg = parseRange(rule.range);
      if (!rg) return '';
      const sq = `${colName(rg.c1)}${rg.r1 + 1}:${colName(rg.c2)}${rg.r2 + 1}`;
      const tl = `${colName(rg.c1)}${rg.r1 + 1}`;
      if (rule.type === 'scale') {
        const sc = CF_SCALES.find(x => x.id === rule.scale) || CF_SCALES[0];
        return `<conditionalFormatting sqref="${sq}"><cfRule type="colorScale" priority="${prio++}"><colorScale><cfvo type="min"/>${sc.mid ? '<cfvo type="percentile" val="50"/>' : ''}<cfvo type="max"/><color rgb="${argb(sc.min)}"/>${sc.mid ? `<color rgb="${argb(sc.mid)}"/>` : ''}<color rgb="${argb(sc.max)}"/></colorScale></cfRule></conditionalFormatting>`;
      }
      const st = rule.custom || CF_STYLES.find(x => x.id === rule.style) || CF_STYLES[0];
      const d = dxfId(st);
      if (rule.type === 'contains') {
        const t = String(rule.v1 || '').replace(/"/g, '""');
        return `<conditionalFormatting sqref="${sq}"><cfRule type="containsText" dxfId="${d}" priority="${prio++}" operator="containsText" text="${xmlEsc(rule.v1 || '')}"><formula>${xmlEsc(`NOT(ISERROR(SEARCH("${t}",${tl})))`)}</formula></cfRule></conditionalFormatting>`;
      }
      const op = { gt: 'greaterThan', lt: 'lessThan', between: 'between', eq: 'equal' }[rule.type];
      if (!op) return '';
      return `<conditionalFormatting sqref="${sq}"><cfRule type="cellIs" dxfId="${d}" priority="${prio++}" operator="${op}"><formula>${xmlEsc(numLit(rule.v1))}</formula>${rule.type === 'between' ? `<formula>${xmlEsc(numLit(rule.v2))}</formula>` : ''}</cfRule></conditionalFormatting>`;
    }).join('');
    // data validation (dropdown lists)
    const dvs = (sh.dv || []).map(d => {
      const rg = parseRange(d.range);
      if (!rg || !d.list || !d.list.length) return '';
      const list = d.list.map(v => String(v).replace(/"/g, '""')).join(',');
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Ungültiger Wert" error="Bitte wähle einen Wert aus der Liste." sqref="${colName(rg.c1)}${rg.r1 + 1}:${colName(rg.c2)}${rg.r2 + 1}"><formula1>${xmlEsc(`"${list}"`)}</formula1></dataValidation>`;
    }).filter(Boolean);
    const dvx = dvs.length ? `<dataValidations count="${dvs.length}">${dvs.join('')}</dataValidations>` : '';
    const hasCharts = sh.charts && sh.charts.length;
    if (hasCharts) sh.charts.forEach(chart => charts.push({ si, sh, chart }));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dim}"/>${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${out}</sheetData>${af}${merges}${cfx}${dvx}<pageMargins left="0.7" right="0.7" top="0.78740157499999996" bottom="0.78740157499999996" header="0.3" footer="0.3"/>${hasCharts ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  });

  const n = wb.sheets.length;
  // ---- charts (DrawingML) ----
  const chartParts = [];
  if (charts.length) {
    const { chartSpaceXml, drawingXml } = await import('./chart-xml.js');
    let num = 0, dnum = 0;
    const bySheet = new Map();
    charts.forEach(c => { if (!bySheet.has(c.si)) bySheet.set(c.si, []); bySheet.get(c.si).push(c); });
    for (const [si, list] of bySheet) {
      dnum++;
      const nums = list.map(() => ++num);
      list.forEach((c, i) => zip.file(`xl/charts/chart${nums[i]}.xml`, chartSpaceXml(wb, c.sh, c.chart)));
      const d = drawingXml(list[0].sh, list.map(c => c.chart), nums);
      zip.file(`xl/drawings/drawing${dnum}.xml`, d.xml);
      zip.file(`xl/drawings/_rels/drawing${dnum}.xml.rels`, d.rels);
      zip.file(`xl/worksheets/_rels/sheet${si + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${dnum}.xml"/></Relationships>`);
      chartParts.push(`<Override PartName="/xl/drawings/drawing${dnum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      nums.forEach(k => chartParts.push(`<Override PartName="/xl/charts/chart${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`));
    }
  }
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${chartParts.join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>FaLe PDF</dc:creator><cp:lastModifiedBy>FaLe PDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FaLe PDF</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Arbeitsblätter</vt:lpstr></vt:variant><vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${n}" baseType="lpstr">${names.map(s => `<vt:lpstr>${xmlEsc(s)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${wb.date1904 ? ' date1904="1"' : ''}/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets>${names.map((s, i) => `<sheet name="${xmlEsc(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filterNames.length ? `<definedNames>${filterNames.join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstCount}" uniqueCount="${sst.length}">${sst.map(s => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${xmlEsc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>${dxfs.length ? `<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs>` : '<dxfs count="0"/>'}<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`);
  zip.file('xl/theme/theme1.xml', THEME);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function uniqueSheetNames(list) {
  const seen = new Set();
  return list.map((raw, i) => {
    let n = String(raw || `Tabelle${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Tabelle${i + 1}`;
    let k = 2;
    const base = n.slice(0, 28);
    while (seen.has(n.toLowerCase())) n = `${base} (${k++})`;
    seen.add(n.toLowerCase());
    return n;
  });
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FaLe"><a:themeElements><a:clrScheme name="FaLe"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="15172F"/></a:dk2><a:lt2><a:srgbClr val="EEF0F8"/></a:lt2><a:accent1><a:srgbClr val="3B37A0"/></a:accent1><a:accent2><a:srgbClr val="0B8F80"/></a:accent2><a:accent3><a:srgbClr val="D99A06"/></a:accent3><a:accent4><a:srgbClr val="C23A4B"/></a:accent4><a:accent5><a:srgbClr val="2F67D8"/></a:accent5><a:accent6><a:srgbClr val="15895A"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="FaLe"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="FaLe"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
