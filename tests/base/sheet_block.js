  // ---------------- Rahmen, Umbruch, Verbinden ----------------
  function borderMenu(anchor) {
    const apply = mode => {
      pushUndo();
      const [r1, r2, c1, c2] = rangeBounds();
      forEachSel((n, r, c) => {
        if (mode === 'none') { delete n.s.bd; return; }
        const bd = { ...(n.s.bd || {}) };
        if (mode === 'all') Object.assign(bd, { t: true, r: true, b: true, l: true });
        if (mode === 'outer') { if (r === r1) bd.t = true; if (r === r2) bd.b = true; if (c === c1) bd.l = true; if (c === c2) bd.r = true; }
        if (mode === 'bottom' && r === r2) bd.b = true;
        if (mode === 'top' && r === r1) bd.t = true;
        n.s.bd = bd;
      });
      changed();
    };
    officeMenu(anchor, [
      { label: 'Alle Rahmenlinien', icon: 'table', onClick: () => apply('all') },
      { label: 'Außenrahmen', icon: 'border', onClick: () => apply('outer') },
      { label: 'Rahmen oben', icon: 'border', onClick: () => apply('top') },
      { label: 'Rahmen unten', icon: 'border', onClick: () => apply('bottom') },
      '-',
      { label: 'Kein Rahmen', icon: 'close', onClick: () => apply('none') },
    ], { label: 'Rahmen' });
  }
  function mergeAction() {
    const [r1, r2, c1, c2] = rangeBounds();
    const m = mergeAt(sel.r, sel.c);
    const exact = m && m.r1 === r1 && m.r2 === r2 && m.c1 === c1 && m.c2 === c2;
    if ((r1 === r2 && c1 === c2) || exact) {
      if (!m) { toast('Markiere mehrere Zellen, um sie zu verbinden.', 'info'); return; }
      pushUndo(); sh.merges = sh.merges.filter(x => x !== m); changed(); toast('Verbindung aufgehoben'); return;
    }
    pushUndo();
    sh.merges = sh.merges.filter(x => x.r2 < r1 || x.r1 > r2 || x.c2 < c1 || x.c1 > c2);
    let lost = 0;
    for (let r = r1; r <= Math.min(r2, sh.maxR); r++) for (let c = c1; c <= Math.min(c2, sh.maxC); c++) {
      if (r === r1 && c === c1) continue;
      const x = getCell(sh, r, c);
      if (x && (x.f || (x.v != null && x.v !== ''))) { lost++; setCell(sh, r, c, x.s ? { v: null, s: x.s } : null); }
    }
    sh.merges.push({ r1, c1, r2, c2 });
    sel.r = r1; sel.c = c1; sel.ar = r1; sel.ac = c1;
    changed();
    toast(lost ? 'Zellen verbunden – nur der Wert oben links bleibt erhalten.' : 'Zellen verbunden');
  }

  // ---------------- bedingte Formatierung ----------------
  async function cfDialog() {
    const [r1, r2, c1, c2] = rangeBounds();
    const def = rangeStr(r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2, c2 });
    const rules = sh.cf;
    const r = await openDialog({
      title: 'Bedingte Formatierung', wide: true,
      body: `<div class="cf-dlg">
        ${rules.length ? `<div class="cf-list"><span class="field-label">Regeln auf diesem Blatt</span>${rules.map((x, i) => `<div class="cf-rule" data-i="${i}"><span class="cf-sw" style="background:${x.type === 'scale' ? 'linear-gradient(90deg,#F8696B,#FFEB84,#63BE7B)' : ((x.custom || CF_STYLES.find(s2 => s2.id === x.style) || {}).fill || 'transparent')}"></span><span>${esc(x.range)}: ${esc((CF_TYPES.find(t => t.id === x.type) || {}).label || '')} ${x.type === 'scale' ? '' : esc(x.v1 || '')}${x.type === 'between' ? ` und ${esc(x.v2 || '')}` : ''}</span><button class="icon-btn" type="button" data-del="${i}" aria-label="Regel entfernen">${oicon('trash')}</button></div>`).join('')}</div>` : ''}
        <span class="field-label">Neue Regel</span>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(def)}" spellcheck="false"></label>
        <div class="field-row"><label class="field"><span class="field-label">Wenn der Wert …</span><select class="select" name="type">${CF_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
          <label class="field cf-v1"><span class="field-label">Wert</span><input class="input" name="v1" inputmode="decimal"></label></div>
        <label class="field cf-v2" hidden><span class="field-label">und</span><input class="input" name="v2" inputmode="decimal"></label>
        <label class="field cf-style"><span class="field-label">dann formatieren als</span><select class="select" name="style">${CF_STYLES.map(st => `<option value="${st.id}">${st.label}</option>`).join('')}</select></label>
        <label class="field cf-scale" hidden><span class="field-label">Farbskala</span><select class="select" name="scale">${CF_SCALES.map(sc => `<option value="${sc.id}">${sc.label}</option>`).join('')}</select></label>
      </div>`,
      actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Regel hinzufügen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an, z. B. B2:B20.', 'error'); return false; }
        const t = $('[name=type]', dlg).value;
        if (t !== 'scale' && !$('[name=v1]', dlg).value.trim()) { toast('Bitte gib einen Vergleichswert ein.', 'error'); return false; }
        return true;
      },
      onMount: dlg => {
        const sync = () => {
          const t = $('[name=type]', dlg).value;
          $('.cf-v1', dlg).hidden = t === 'scale';
          $('.cf-v2', dlg).hidden = t !== 'between';
          $('.cf-style', dlg).hidden = t === 'scale';
          $('.cf-scale', dlg).hidden = t !== 'scale';
          $('[name=v1]', dlg).inputMode = t === 'contains' ? 'text' : 'decimal';
        };
        $('[name=type]', dlg).addEventListener('change', sync);
        sync();
        $$('[data-del]', dlg).forEach(bt => bt.addEventListener('click', () => { pushUndo(); sh.cf.splice(+bt.dataset.del, 1); changed(); bt.closest('.cf-rule').remove(); toast('Regel entfernt'); }));
        return { collect: () => ({ range: $('[name=range]', dlg).value.trim().toUpperCase(), type: $('[name=type]', dlg).value, v1: $('[name=v1]', dlg).value.trim(), v2: $('[name=v2]', dlg).value.trim(), style: $('[name=style]', dlg).value, scale: $('[name=scale]', dlg).value }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    sh.cf.push({ id: newChartId(), ...r.data, range: rangeStr(parseRange(r.data.range)) });
    changed();
    toast('Bedingte Formatierung angewendet', 'success');
  }

  // ---------------- AutoFilter ----------------
  function toggleFilter() {
    if (sh.autoFilter) { pushUndo(); sh.autoFilter = null; changed(); toast('Filter entfernt'); return; }
    const [r1, r2, c1, c2] = rangeBounds();
    const rg = r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2: Math.min(r2, Math.max(r1, sh.maxR)), c2: Math.min(c2, Math.max(c1, sh.maxC)) };
    if (rg.r2 <= rg.r1) { toast('Markiere eine Tabelle mit Überschriftenzeile, um zu filtern.', 'info'); return; }
    pushUndo();
    sh.autoFilter = { range: rangeStr(rg), filters: {} };
    changed();
    toast('Filter aktiviert – tippe auf ▾ in der Kopfzeile.');
  }
  async function filterMenu(c) {
    const af = sh.autoFilter;
    if (!af) return;
    const vals = columnValues(sh, c);
    const cur = Array.isArray(af.filters[c]) ? new Set(af.filters[c]) : null;
    const r = await openDialog({
      title: `Filter: Spalte ${colName(c)}`,
      body: `<div class="af-dlg">
        <div class="af-sort"><button class="btn btn-ghost btn-sm" type="button" data-sort="asc">${oicon('sortAsc')} A → Z</button><button class="btn btn-ghost btn-sm" type="button" data-sort="desc">${oicon('sortDesc')} Z → A</button></div>
        <input class="input" type="search" data-q placeholder="Werte durchsuchen" aria-label="Werte durchsuchen">
        <label class="check af-all"><input type="checkbox" data-all> <strong>Alle auswählen</strong></label>
        <div class="af-list">${vals.map((v, i) => `<label class="check af-item"><input type="checkbox" value="${i}" ${!cur || cur.has(v.text) ? 'checked' : ''}> <span>${esc(v.text)}</span><span class="muted small">${v.n}</span></label>`).join('')}</div>
      </div>`,
      actions: [{ label: 'Filter löschen', value: 'clear' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        const boxes = $$('.af-item input', dlg), all = $('[data-all]', dlg);
        const syncAll = () => { const n = boxes.filter(b => b.checked).length; all.checked = n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; };
        syncAll();
        all.addEventListener('change', () => { boxes.forEach(b => { if (!b.closest('label').hidden) b.checked = all.checked; }); syncAll(); });
        boxes.forEach(b => b.addEventListener('change', syncAll));
        $('[data-q]', dlg).addEventListener('input', e => { const q = e.target.value.toLocaleLowerCase('de'); boxes.forEach((b, i) => { b.closest('label').hidden = !!q && !vals[i].text.toLocaleLowerCase('de').includes(q); }); });
        $$('[data-sort]', dlg).forEach(b => b.addEventListener('click', () => { dlg._sort = b.dataset.sort; dlg.close(); }));
        return { collect: () => boxes.filter(b => b.checked).map(b => vals[+b.value].text) };
      },
    });
    if (r.dialog && r.dialog._sort) {
      const rg = parseRange(af.range);
      pushUndo();
      sortRows(wb, si, rg.r1 + 1, Math.min(rg.r2, sh.maxR), c, r.dialog._sort === 'asc', rg.c1, rg.c2);
      changed(); toast(r.dialog._sort === 'asc' ? 'Aufsteigend sortiert' : 'Absteigend sortiert');
      return;
    }
    if (r.value === 'clear') { pushUndo(); delete af.filters[c]; changed(); return; }
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    if (r.data.length === vals.length) delete af.filters[c]; else af.filters[c] = r.data;
    changed();
    const hiddenN = filterHidden(sh).size;
    toast(hiddenN ? `${hiddenN} Zeile${hiddenN === 1 ? '' : 'n'} ausgeblendet` : 'Alle Zeilen sichtbar');
  }

  // ---------------- Datenvalidierung (Dropdown) ----------------
  async function dvDialog() {
    const [r1, r2, c1, c2] = rangeBounds();
    const existing = validationAt(sh, sel.r, sel.c);
    const r = await openDialog({
      title: 'Dropdown-Liste',
      body: `<p class="small">In den gewählten Zellen sind dann nur diese Werte erlaubt – auswählbar über den kleinen Pfeil.</p>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(existing ? existing.range : rangeStr({ r1, c1, r2, c2 }))}" spellcheck="false"></label>
        <label class="field"><span class="field-label">Erlaubte Werte (je Zeile einer)</span><textarea class="input dv-ta" name="list" rows="6" placeholder="Offen&#10;In Arbeit&#10;Erledigt">${esc(existing ? existing.list.join('\n') : '')}</textarea></label>`,
      actions: [...(existing ? [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an.', 'error'); return false; }
        if (!parseList($('[name=list]', dlg).value).length) { toast('Bitte gib mindestens einen Wert ein.', 'error'); return false; }
        return true;
      },
      onMount: dlg => ({ collect: () => ({ range: $('[name=range]', dlg).value.trim().toUpperCase(), list: parseList($('[name=list]', dlg).value) }) }),
    });
    if (r.value === 'remove' && existing) { pushUndo(); sh.dv = sh.dv.filter(x => x !== existing); changed(); toast('Dropdown-Liste entfernt'); return; }
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    if (existing) sh.dv = sh.dv.filter(x => x !== existing);
    sh.dv.push({ range: rangeStr(parseRange(r.data.range)), list: r.data.list });
    changed();
    toast('Dropdown-Liste angelegt', 'success');
  }
  function placeDvButton() {
    const old = $('.dv-btn', root);
    const dv = validationAt(sh, sel.r, sel.c);
    if (!dv || editing) { if (old) old.remove(); return; }
    const f = sh.freeze || 0;
    const layer = sel.r < f ? frozenCells : bodyCells;
    const btn = old || h(`<button class="dv-btn" type="button" data-dv aria-label="Wert aus Liste wählen">${oicon('chevronDown')}</button>`);
    const m = mergeAt(sel.r, sel.c);
    const right = m ? colX[m.c2 + 1] : colX[sel.c + 1];
    btn.style.left = `${right + 2}px`;
    btn.style.top = `${(sel.r < f ? rowTop(sel.r) : rowTop(sel.r) - rowTop(f)) + 2}px`;
    if (btn.parentElement !== layer) layer.appendChild(btn);
  }
  function dvMenu(anchor) {
    const dv = validationAt(sh, sel.r, sel.c);
    if (!dv) return;
    officeMenu(anchor, [
      ...dv.list.map(v => ({ label: v, icon: 'check', onClick: () => { applyInput(sel.r, sel.c, v); scroll.focus({ preventScroll: true }); } })),
      '-', { label: 'Leeren', icon: 'close', onClick: () => { applyInput(sel.r, sel.c, ''); } },
    ], { label: 'Wert wählen' });
  }

  // ---------------- Suchen & Ersetzen ----------------
  const fbar = $('.s-find', root);
  const fq = $('[data-fq]', fbar), fr = $('[data-fr]', fbar), fcount = $('[data-fcount]', fbar);
  let findOpen = false, fmatches = [], fcur = -1;
  function openFind(focus) {
    findOpen = true; fbar.hidden = false;
    $('[data-a="find"]', root).setAttribute('aria-pressed', 'true');
    if (focus) setTimeout(() => { fq.focus(); fq.select(); }, 30);
    runFind(true);
  }
  function closeFind() { findOpen = false; fbar.hidden = true; fmatches = []; $('[data-a="find"]', root).setAttribute('aria-pressed', 'false'); scroll.focus({ preventScroll: true }); }
  function runFind(jump) {
    const q = fq.value.toLocaleLowerCase('de');
    fmatches = [];
    if (q) {
      const keys = [...sh.cells.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const cell = sh.cells.get(k);
        const t = displayOf(cell).toLocaleLowerCase('de');
        if (t.includes(q) || (cell.f && ('=' + toDisplay(cell.f)).toLocaleLowerCase('de').includes(q))) fmatches.push({ r: R_OF(k), c: C_OF(k) });
      }
    }
    if (jump || fcur >= fmatches.length) fcur = fmatches.length ? 0 : -1;
    fcount.textContent = fq.value ? (fmatches.length ? `${fcur + 1} von ${fmatches.length}` : 'Keine Treffer') : '';
    fcount.classList.toggle('notfound', !!fq.value && !fmatches.length);
    if (jump && fcur >= 0) select(fmatches[fcur].r, fmatches[fcur].c);
  }
  const fstep = d => { if (!fmatches.length) return; fcur = (fcur + d + fmatches.length) % fmatches.length; fcount.textContent = `${fcur + 1} von ${fmatches.length}`; select(fmatches[fcur].r, fmatches[fcur].c); };
  function replaceIn(r, c) {
    const cell = getCell(sh, r, c);
    if (!cell || cell.f) return false;
    const txt = editTextOf(cell, toDisplay);
    const re = new RegExp(fq.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (!re.test(txt)) return false;
    const next = txt.replace(re, fr.value);
    const p = parseInput(next, cell.s && cell.s.fmt);
    const n = { ...cell };
    delete n.cv; delete n.cv0;
    if (p.f) { n.f = p.f; delete n.v; } else n.v = p.v;
    setCell(sh, r, c, n.v == null && !n.f && !n.s ? null : n);
    return true;
  }
  fq.addEventListener('input', () => runFind(true));
  fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fstep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  $('[data-fnext]', fbar).addEventListener('click', () => fstep(1));
  $('[data-fprev]', fbar).addEventListener('click', () => fstep(-1));
  $('[data-fclose]', fbar).addEventListener('click', closeFind);
  $('[data-frep]', fbar).addEventListener('click', () => {
    if (fcur < 0 || !fmatches[fcur]) return;
    pushUndo();
    const m = fmatches[fcur];
    if (!replaceIn(m.r, m.c)) toast('Formeln werden beim Ersetzen nicht verändert.', 'info');
    changed(); runFind(false); if (fmatches.length) select(fmatches[Math.min(fcur, fmatches.length - 1)].r, fmatches[Math.min(fcur, fmatches.length - 1)].c);
  });
  $('[data-freall]', fbar).addEventListener('click', () => {
    if (!fmatches.length) return;
    pushUndo();
    let n = 0, skipped = 0;
    for (const m of fmatches) { if (replaceIn(m.r, m.c)) n++; else skipped++; }
    changed(); runFind(true);
    toast(`${n} Zelle${n === 1 ? '' : 'n'} ersetzt${skipped ? ` · ${skipped} Formel${skipped === 1 ? '' : 'n'} unverändert` : ''}`, 'success');
  });

  // ---------------- Diagramme ----------------
  const chartsLayer = $('.sh-charts', root);
  let chartSel = null, chartRaf = 0;
  const darkMode = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const chartTop = ch => { const y = ch.y || 0; const r = Math.floor(y / ROW_H); return rowTop(r) + (y - r * ROW_H); };
  function scheduleCharts() { if (!chartRaf) chartRaf = requestAnimationFrame(() => { chartRaf = 0; renderCharts(); }); }
  function renderCharts() {
    const mode = darkMode() ? 'dark' : 'light';
    chartsLayer.innerHTML = '';
    for (const ch of sh.charts) {
      const el = h(`<div class="sh-chart${chartSel === ch.id ? ' sel' : ''}" data-chart="${ch.id}" tabindex="0" role="figure" aria-label="Diagramm ${esc(ch.title || '')}" style="left:${ch.x}px;top:${chartTop(ch)}px;width:${ch.w}px;height:${ch.h}px">
        <div class="shc-svg"></div><button class="shc-more icon-btn" type="button" aria-label="Diagramm-Aktionen">${oicon('more')}</button><span class="shc-handle" aria-hidden="true"></span></div>`);
      try { $('.shc-svg', el).innerHTML = chartSvg(ch, chartData(wb, sh, ch, mode), { w: ch.w, h: ch.h, mode }); } catch (e) { console.warn(e); }
      chartsLayer.appendChild(el);
    }
  }
  function selectChart(id) {
    chartSel = id;
    $$('.sh-chart', chartsLayer).forEach(x => x.classList.toggle('sel', x.dataset.chart === id));
  }
  function deleteChart(id) {
    pushUndo();
    sh.charts = sh.charts.filter(x => x.id !== id);
    chartSel = null; shell.markDirty(); renderCharts();
    toast('Diagramm gelöscht', 'info', { action: { label: 'Rückgängig', onClick: doUndo } });
  }
  async function insertChart(existing = null) {
    if (editing) commit();
    const { chartDialog } = await import('./chart.js');
    const [r1, r2, c1, c2] = rangeBounds();
    const rg = existing ? null : (r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2, c2 });
    const mode = darkMode() ? 'dark' : 'light';
    const init = existing ? { ...existing } : { range: rangeStr(rg), type: 'col' };
    if (existing && !existing.range) init.range = '';
    const res = await chartDialog(init, { getData: draft => chartData(wb, sh, draft, mode), title: existing ? 'Diagramm bearbeiten' : 'Diagramm einfügen', mode });
    if (!res) return;
    pushUndo();
    const phone = matchMedia('(max-width: 720px)').matches;
    const cfg = { type: res.type, range: rangeStr(parseRange(res.range)), title: res.title.trim(), xTitle: res.xTitle.trim(), yTitle: res.yTitle.trim(), legend: res.legend, palette: res.palette, byRows: res.byRows, series: null, colors: null };
    if (existing) Object.assign(existing, cfg);
    else {
      const pr = parseRange(cfg.range);
      const x = phone ? 8 : Math.min(colX[Math.min(pr.c2 + 1, nCols)] + 16, colX[nCols] - 500);
      const y = phone ? (pr.r2 + 2) * ROW_H : pr.r1 * ROW_H;
      sh.charts.push({ id: newChartId(), ...cfg, x: Math.max(0, x), y, w: phone ? 330 : 480, h: phone ? 230 : 300 });
      chartSel = sh.charts[sh.charts.length - 1].id;
      track('files_created', 0);
    }
    shell.markDirty(); renderCharts();
    const el = $(`.sh-chart[data-chart="${chartSel || (existing && existing.id)}"]`, chartsLayer);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toast(existing ? 'Diagramm aktualisiert' : 'Diagramm eingefügt – ziehen zum Verschieben, Ecke zum Vergrößern.', 'success');
  }
  let cdrag = null;
  chartsLayer.addEventListener('pointerdown', e => {
    const el = e.target.closest('.sh-chart');
    if (!el) return;
    e.stopPropagation();
    if (editing) commit();
    const ch = sh.charts.find(x => x.id === el.dataset.chart);
    if (!ch) return;
    selectChart(ch.id);
    if (e.target.closest('.shc-more')) {
      e.preventDefault();
      officeMenu(e.target.closest('.shc-more'), [
        { label: 'Bearbeiten …', icon: 'edit', onClick: () => insertChart(ch) },
        { label: 'Nach vorne', icon: 'arrowUp', onClick: () => { pushUndo(); sh.charts = [...sh.charts.filter(x => x !== ch), ch]; shell.markDirty(); renderCharts(); } },
        '-', { label: 'Diagramm löschen', icon: 'trash', danger: true, onClick: () => deleteChart(ch.id) },
      ], { label: 'Diagramm' });
      return;
    }
    e.preventDefault();
    cdrag = { ch, el, x: e.clientX, y: e.clientY, ox: ch.x, oy: ch.y, ow: ch.w, oh: ch.h, resize: !!e.target.closest('.shc-handle'), moved: false };
    el.setPointerCapture(e.pointerId);
  });
  chartsLayer.addEventListener('pointermove', e => {
    if (!cdrag) return;
    const dx = e.clientX - cdrag.x, dy = e.clientY - cdrag.y;
    if (!cdrag.moved && Math.hypot(dx, dy) < 4) return;
    if (!cdrag.moved) { pushUndo(); cdrag.moved = true; }
    const ch = cdrag.ch;
    if (cdrag.resize) { ch.w = Math.max(200, Math.round(cdrag.ow + dx)); ch.h = Math.max(140, Math.round(cdrag.oh + dy)); }
    else { ch.x = Math.max(0, Math.round(cdrag.ox + dx)); ch.y = Math.max(0, Math.round(cdrag.oy + dy)); }
    cdrag.el.style.left = `${ch.x}px`; cdrag.el.style.top = `${chartTop(ch)}px`; cdrag.el.style.width = `${ch.w}px`; cdrag.el.style.height = `${ch.h}px`;
  });
  const endChartDrag = () => { if (!cdrag) return; const d = cdrag; cdrag = null; if (d.moved) { shell.markDirty(); renderCharts(); } };
  chartsLayer.addEventListener('pointerup', endChartDrag);
  chartsLayer.addEventListener('pointercancel', endChartDrag);
  chartsLayer.addEventListener('dblclick', e => { const el = e.target.closest('.sh-chart'); if (el) { const ch = sh.charts.find(x => x.id === el.dataset.chart); if (ch) insertChart(ch); } });
  chartsLayer.addEventListener('keydown', e => {
    const el = e.target.closest('.sh-chart');
    if (!el) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteChart(el.dataset.chart); }
    if (e.key === 'Enter') { e.preventDefault(); const ch = sh.charts.find(x => x.id === el.dataset.chart); if (ch) insertChart(ch); }
  });
  const themeObs = new MutationObserver(() => renderCharts());
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

