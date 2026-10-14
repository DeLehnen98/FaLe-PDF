// Workbook model → .xlsx (own SpreadsheetML writer on top of JSZip). Opens in Excel and LibreOffice without repair.
import { loadJSZip, xmlEsc } from './vendor.js';
import { KEY, R_OF, C_OF } from './workbook.js';
import { colName, toXlsx, isErr, functionsIn, ARRAY_FUNCTIONS } from './formula.js';
import { ensureSheetExtras, filterHidden, parseRange, CF_STYLES, CF_SCALES } from './sheetfx.js';

const BUILTIN = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49 };
const ERRS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!']);
const ROW_PX_PER_PT = 28 / 15;
const BORDER_STYLES = new Set(['thin', 'medium', 'thick', 'double', 'dashed', 'dotted', 'hair', 'mediumDashed', 'dashDot', 'mediumDashDot', 'dashDotDot', 'slantDashDot']);
const bstyle = v => (v === true ? 'thin' : BORDER_STYLES.has(v) ? v : 'thin');

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
    const fontKey = (s.b ? 'b' : '') + (s.i ? 'i' : '') + (s.u ? 'u' : '') + (s.st ? 's' : '') + (s.va || '') + (s.color || '') + '|' + (s.size || '') + '|' + (s.font || '');
    let fi = 0;
    if (fontKey !== '||') {
      if (!fontIdx.has(fontKey)) {
        fontIdx.set(fontKey, fonts.length);
        const name = s.font || 'Calibri';
        fonts.push(`<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.st ? '<strike/>' : ''}${s.u ? '<u/>' : ''}${s.va ? `<vertAlign val="${s.va === 'sup' ? 'superscript' : 'subscript'}"/>` : ''}<sz val="${s.size || 11}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : '<color theme="1"/>'}<name val="${xmlEsc(name)}"/><family val="2"/>${s.font ? '' : '<scheme val="minor"/>'}</font>`);
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
      const k = ['l', 'r', 't', 'b'].map(x => (s.bd[x] ? bstyle(s.bd[x]) : '-')).join(',') + '|' + (s.bd.color || '');
      if (!borderIdx.has(k)) {
        borderIdx.set(k, borders.length);
        const col = `<color rgb="${argb(s.bd.color || '#000000')}"/>`;
        const side = (tag, v) => (v ? `<${tag} style="${bstyle(v)}">${col}</${tag}>` : `<${tag}/>`);
        borders.push(`<border>${side('left', s.bd.l)}${side('right', s.bd.r)}${side('top', s.bd.t)}${side('bottom', s.bd.b)}<diagonal/></border>`);
      }
      bi = borderIdx.get(k);
    }
    const rot = s.rot === 90 ? 90 : s.rot === 270 ? 180 : s.rot === 255 ? 255 : s.rot === 45 ? 45 : 0;
    const halign = s.align || (s.indent ? 'left' : null);
    const alParts = `${halign ? ` horizontal="${halign}"` : ''}${s.valign ? ` vertical="${s.valign}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}${rot ? ` textRotation="${rot}"` : ''}`;
    const al = alParts ? `<alignment${alParts}/>` : '';
    const pr = s.unlocked || s.hideF ? `<protection${s.unlocked ? ' locked="0"' : ''}${s.hideF ? ' hidden="1"' : ''}/>` : '';
    const key = `${nf}|${fi}|${fl}|${bi}|${al}|${pr}`;
    if (!xfIdx.has(key)) {
      xfIdx.set(key, xfs.length);
      const inner = al + pr;
      xfs.push(`<xf numFmtId="${nf}" fontId="${fi}" fillId="${fl}" borderId="${bi}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${fi ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}${bi ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1"' : ''}${pr ? ' applyProtection="1"' : ''}${inner ? `>${inner}</xf>` : '/>'}`);
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
  let usesDynamic = false;

  const names = uniqueSheetNames(wb.sheets.map(s => s.name));
  // ---- sheets ----
  const sheetXml = wb.sheets.map((sh, si) => {
    ensureSheetExtras(sh);
    const hidden = new Set([...sh.hiddenRows, ...filterHidden(sh)]);
    const byRow = new Map();
    const addTo = (r, item) => { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(item); };
    for (const [k, cell] of sh.cells) addTo(R_OF(k), [C_OF(k), cell]);
    if (sh.spill) for (const [k, sp] of sh.spill) { if (!sh.cells.has(k) || sh.cells.get(k).v == null) { const own = sh.cells.get(k); if (own) { const list = byRow.get(R_OF(k)); const it = list && list.find(x => x[0] === C_OF(k)); if (it) it[1] = { ...own, v: sp.v, _spill: true }; } else addTo(R_OF(k), [C_OF(k), { v: sp.v, _spill: true }]); } }
    for (const r of hidden) if (!byRow.has(r)) byRow.set(r, []);
    if (sh.rowH) for (const r of sh.rowH.keys()) if (!byRow.has(r)) byRow.set(r, []);
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    let out = '';
    for (const r of rows) {
      const cells = byRow.get(r).sort((a, b) => a[0] - b[0]);
      const hpx = sh.rowH && sh.rowH.get(r);
      let rx = `<row r="${r + 1}"${hidden.has(r) ? ' hidden="1"' : ''}${hpx ? ` ht="${(hpx / ROW_PX_PER_PT).toFixed(2)}" customHeight="1"` : ''}>`;
      for (const [c, cell] of cells) {
        const ref = colName(c) + (r + 1);
        const s = styleId(cell.s);
        const sa = s ? ` s="${s}"` : '';
        if (cell.f) {
          const dyn = cell.da && (cell.spill || functionsIn(cell.f).some(fn => ARRAY_FUNCTIONS.has(fn)));
          const fattr = dyn ? ` t="array" ref="${ref}${cell.spill ? ':' + colName(c + cell.spill.w - 1) + (r + cell.spill.h) : ''}"` : '';
          const cm = dyn ? ' cm="1"' : '';
          if (dyn) usesDynamic = true;
          const f = `<f${fattr}>${xmlEsc(toXlsx(cell.f))}</f>`;
          const v = cell.cv;
          if (typeof v === 'number' && Number.isFinite(v)) rx += `<c r="${ref}"${sa}${cm}>${f}<v>${v}</v></c>`;
          else if (typeof v === 'boolean') rx += `<c r="${ref}"${sa} t="b"${cm}>${f}<v>${v ? 1 : 0}</v></c>`;
          else if (typeof v === 'string') rx += `<c r="${ref}"${sa} t="str"${cm}>${f}<v>${xmlEsc(v)}</v></c>`;
          else if (isErr(v)) rx += `<c r="${ref}"${sa} t="e"${cm}>${f}<v>${ERRS.has(v.code) ? v.code : '#VALUE!'}</v></c>`;
          else rx += `<c r="${ref}"${sa}${cm}>${f}</c>`;
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
    const hcw = sh.hiddenColW || {};
    if (widths.length) cols = '<cols>' + widths.map(([i, w]) => (w === 0 ? `<col min="${i + 1}" max="${i + 1}" width="${hcw[i] ? Math.max(1, (hcw[i] - 5) / 7).toFixed(2) : '9.140625'}" hidden="1" customWidth="1"/>` : `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, (w - 5) / 7).toFixed(2)}" customWidth="1"/>`)).join('') + '</cols>';
    const fr = sh.freeze || 0, fc = sh.freezeC || 0;
    let pane = '';
    if (fr || fc) {
      const tl = `${colName(fc)}${fr + 1}`;
      const ap = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight';
      pane = `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${tl}" activePane="${ap}" state="frozen"/>${fr && fc ? `<selection pane="topRight"/><selection pane="bottomLeft"/>` : ''}<selection pane="${ap}" activeCell="${tl}" sqref="${tl}"/>`;
    }
    const views = `<sheetViews><sheetView${si === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>`;
    const sheetPr = sh.tabColor ? `<sheetPr><tabColor rgb="${argb(sh.tabColor)}"/></sheetPr>` : '';
    const protection = sh.protect && sh.protect.on ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : '';
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${colName(m.c1)}${m.r1 + 1}:${colName(m.c2)}${m.r2 + 1}"/>`).join('')}</mergeCells>` : '';
    // AutoFilter
    let af = '';
    const afr = sh.autoFilter && parseRange(sh.autoFilter.range);
    if (afr) {
      const ref = `${colName(afr.c1)}${afr.r1 + 1}:${colName(afr.c2)}${afr.r2 + 1}`;
      const OPX = { eq: 'equal', ne: 'notEqual', gt: 'greaterThan', ge: 'greaterThanOrEqual', lt: 'lessThan', le: 'lessThanOrEqual' };
      const fcol = ([c, f]) => {
        const id = +c - afr.c1;
        if (Array.isArray(f)) return `<filterColumn colId="${id}"><filters${f.includes('(Leer)') ? ' blank="1"' : ''}>${f.filter(v => v !== '(Leer)').map(v => `<filter val="${xmlEsc(v)}"/>`).join('')}</filters></filterColumn>`;
        if (f && f.custom) {
          const cf = f.custom.slice(0, 2).map(cd => {
            let op = OPX[cd.op], val = String(cd.v ?? '');
            if (cd.op === 'contains') { op = 'equal'; val = `*${val}*`; } else if (cd.op === 'notcontains') { op = 'notEqual'; val = `*${val}*`; }
            else if (cd.op === 'begins') { op = 'equal'; val = `${val}*`; } else if (cd.op === 'ends') { op = 'equal'; val = `*${val}`; }
            const num = parseFloat(val.replace(',', '.'));
            if (!/\*/.test(val) && Number.isFinite(num) && /^-?[\d.,]+$/.test(val)) val = String(num);
            return `<customFilter${op && op !== 'equal' ? ` operator="${op}"` : ''} val="${xmlEsc(val)}"/>`;
          }).join('');
          return `<filterColumn colId="${id}"><customFilters${f.and ? ' and="1"' : ''}>${cf}</customFilters></filterColumn>`;
        }
        if (f && f.top) return `<filterColumn colId="${id}"><top10${f.bottom ? ' top="0"' : ''}${f.percent ? ' percent="1"' : ''} val="${f.top}"/></filterColumn>`;
        return '';
      };
      af = `<autoFilter ref="${ref}">${Object.entries(sh.autoFilter.filters || {}).map(fcol).join('')}</autoFilter>`;
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
      if (!rg) return '';
      const sq = `${colName(rg.c1)}${rg.r1 + 1}:${colName(rg.c2)}${rg.r2 + 1}`;
      const msg = `${d.prompt ? ` showInputMessage="1" prompt="${xmlEsc(d.prompt)}"` : ' showInputMessage="1"'} showErrorMessage="1" errorTitle="Ungültiger Wert" error="${xmlEsc(d.error || 'Dieser Wert ist hier nicht erlaubt.')}"`;
      const type = d.type || 'list';
      if (type === 'list') {
        if (d.src) return `<dataValidation type="list" allowBlank="1"${msg} sqref="${sq}"><formula1>${xmlEsc(toXlsx(d.src))}</formula1></dataValidation>`;
        if (!d.list || !d.list.length) return '';
        const list = d.list.map(v => String(v).replace(/"/g, '""')).join(',');
        return `<dataValidation type="list" allowBlank="1"${msg} sqref="${sq}"><formula1>${xmlEsc(`"${list}"`)}</formula1></dataValidation>`;
      }
      const f = v => { const s2 = String(v ?? '').trim(); if (type === 'date') { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s2); if (m) return String((Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000); } const n = parseFloat(s2.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? String(n) : '0'; };
      const two = /between/i.test(d.op || 'between');
      return `<dataValidation type="${type}" operator="${d.op || 'between'}" allowBlank="1"${msg} sqref="${sq}"><formula1>${f(d.v1)}</formula1>${two ? `<formula2>${f(d.v2)}</formula2>` : ''}</dataValidation>`;
    }).filter(Boolean);
    const dvx = dvs.length ? `<dataValidations count="${dvs.length}">${dvs.join('')}</dataValidations>` : '';
    const hasCharts = sh.charts && sh.charts.length;
    if (hasCharts) sh.charts.forEach(chart => charts.push({ si, sh, chart }));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheetPr}<dimension ref="${dim}"/>${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${out}</sheetData>${protection}${af}${merges}${cfx}${dvx}<pageMargins left="0.7" right="0.7" top="0.78740157499999996" bottom="0.78740157499999996" header="0.3" footer="0.3"/>${hasCharts ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
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
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${chartParts.join('')}${usesDynamic ? '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>' : ''}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>FaLe PDF</dc:creator><cp:lastModifiedBy>FaLe PDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FaLe PDF</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Arbeitsblätter</vt:lpstr></vt:variant><vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${n}" baseType="lpstr">${names.map(s => `<vt:lpstr>${xmlEsc(s)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`);
  const userNames = (wb.names || []).filter(nm => nm && nm.name && nm.ref).map(nm => `<definedName name="${xmlEsc(nm.name)}"${nm.si != null && nm.si >= 0 ? ` localSheetId="${nm.si}"` : ''}${nm.comment ? ` comment="${xmlEsc(nm.comment)}"` : ''}>${xmlEsc(toXlsx(nm.ref))}</definedName>`);
  // Excel expects defined names sorted (filter databases first is fine, but names must be unique per scope)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${wb.date1904 ? ' date1904="1"' : ''}/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets>${names.map((s, i) => `<sheet name="${xmlEsc(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filterNames.length || userNames.length ? `<definedNames>${filterNames.join('')}${userNames.join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${usesDynamic ? `<Relationship Id="rId${n + 4}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>` : ''}</Relationships>`);
  if (usesDynamic) zip.file('xl/metadata.xml', METADATA);
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

const METADATA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FaLe"><a:themeElements><a:clrScheme name="FaLe"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="15172F"/></a:dk2><a:lt2><a:srgbClr val="EEF0F8"/></a:lt2><a:accent1><a:srgbClr val="3B37A0"/></a:accent1><a:accent2><a:srgbClr val="0B8F80"/></a:accent2><a:accent3><a:srgbClr val="D99A06"/></a:accent3><a:accent4><a:srgbClr val="C23A4B"/></a:accent4><a:accent5><a:srgbClr val="2F67D8"/></a:accent5><a:accent6><a:srgbClr val="15895A"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="FaLe"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="FaLe"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
