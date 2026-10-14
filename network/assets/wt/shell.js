// FaLe Werkzeuge – shell for every tool page.
//
// Reads the page config (<script type="application/json" id="wt-config">, written by build.py), loads
// the tool module (config.module) and handles everything around it: file intake (picker, camera, paste,
// drag & drop, hand-off from another tool), file cards with thumbnails / reorder / passwords, option
// controls from the tool's schema, progress + cancel, errors, the result (download, share, ZIP,
// "continue with …"), the privacy counter and offline warm-up. Tool modules only implement run().
// Contract: network/tools/webtools/README.md
import './lib/tt.js';
import { el, icon, clear, tick, reducedMotion } from './lib/dom.js';
import { t, pick } from './lib/strings.js';
import { formatSize, savedPercent, safeFileName, withSuffix } from './lib/format.js';
import { InputFile, accepted } from './lib/files.js';
import { PasswordError, BadPdfError } from './lib/pdf.js';
import { renderOptions, defaults } from './lib/options.js';
import { parsePages } from './lib/ranges.js';
import { startCounting, onCount, counts } from './lib/privacy.js';
import { takeHandoff, putHandoff, handoffFiles } from './lib/handoff.js';
import { registerSW, warmUp } from './lib/sw.js';
import { download, canShare, share } from './lib/download.js';

const cfgEl = document.getElementById('wt-config');
const app = document.getElementById('wt-app');
if (cfgEl && app) init(JSON.parse(cfgEl.textContent));

function init(cfg) {
  const lang = cfg.lang === 'en' ? 'en' : 'de';
  const T = (k, v) => t(lang, k, v);
  const P = v => pick(lang, v);
  // minFiles: 0 → a tool without file intake (generators like QR code or letters): no pick zone, the
  // stage/options are shown right away and run() gets an empty input list.
  const noFiles = cfg.minFiles === 0;
  // tool-specific wording for a few shell labels (tool.labels = { back_to_files: {de, en} })
  const L = k => (state.tool?.labels?.[k] ? P(state.tool.labels[k]) : T(k));
  document.documentElement.classList.add('wt-js');

  // ---------------------------------------------------------------- state
  const state = {
    phase: 'pick',           // pick | files | working | result | error
    inputs: [],
    values: {},
    tool: null,
    results: new Map(),      // cache: options key → result (quick switching between levels)
    current: null,           // shown result
    abort: null,
    lastError: null,
  };
  const cards = new Map();   // input.id → card element

  // ---------------------------------------------------------------- static markup from build.py
  const pickZone = app.querySelector('[data-wt-pick]');
  const fileInput = app.querySelector('[data-wt-input]');
  const drop = app.querySelector('[data-wt-drop]');
  const cameraLabel = app.querySelector('[data-wt-camera]');
  const pasteBtn = app.querySelector('[data-wt-paste]');
  const proof = document.querySelector('[data-wt-proof]');

  // ---------------------------------------------------------------- dynamic parts
  const live = el('p', { class: 'sr-only', aria: { live: 'polite' } });
  const alertLive = el('p', { class: 'sr-only', role: 'alert' });
  const notice = el('div', { class: 'wt-notice', hidden: true, role: 'status' });
  const filesHead = el('div', { class: 'wt-files-head' });
  const filesTitle = el('h2', { class: 'wt-files-title' });
  const addMore = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => fileInput.click() }, icon('plus'), T('pick_more'));
  filesHead.append(filesTitle, addMore);
  const reorderHint = el('p', { class: 'wt-hint', hidden: true }, T('reorder_hint'));
  const list = el('ul', { class: 'wt-files', aria: { label: T('files_h', { n: 0 }) } });
  const filesSec = el('div', { class: 'wt-files-sec', hidden: true }, filesHead, reorderHint, list);
  const stage = el('div', { class: 'wt-stage', hidden: true });
  const optsTitle = el('h2', { class: 'wt-opts-title' }, T('options_h'));
  const optsBox = el('div', { class: 'wt-opts-box' });
  const optsSec = el('div', { class: 'wt-opts-sec', hidden: true }, optsTitle, optsBox);
  const barSummary = el('p', { class: 'wt-bar-summary' });
  const barHint = el('p', { class: 'wt-bar-hint', hidden: true });
  const primary = el('button', { type: 'button', class: 'wt-btn wt-btn-primary wt-btn-lg', onclick: () => run() }, cfg.primary);
  const bar = el('div', { class: 'wt-bar', hidden: true }, el('div', { class: 'wt-bar-text' }, barSummary, barHint), primary);
  const progText = el('p', { class: 'wt-prog-text' }, T('preparing'));
  const progBar = el('progress', { class: 'wt-prog-bar', max: '1', aria: { label: T('working') } });
  const cancelBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => state.abort?.abort() }, T('cancel'));
  const progress = el('div', { class: 'wt-progress', hidden: true, aria: { busy: 'true' } },
    el('div', { class: 'wt-spinner', 'aria-hidden': 'true' }), progText, progBar, cancelBtn);
  const result = el('div', { class: 'wt-result', hidden: true });
  const errorBox = el('div', { class: 'wt-error', hidden: true, role: 'alert' });
  app.append(notice, filesSec, stage, optsSec, progress, result, errorBox, bar, live, alertLive);

  // ---------------------------------------------------------------- tool module
  let optsUI = null;
  const ready = import(cfg.module).then(m => {
    const tool = m.default || {};
    tool.options = Array.isArray(tool.options) ? tool.options : [];
    state.tool = tool;
    state.values = defaults(tool.options.filter(o => !o.perFile));
    renderOpts();
    // files picked before the module arrived: mount the tool's stage now (setPhase mounts it once)
    if (noFiles || (state.phase === 'files' && state.inputs.length)) setPhase('files');
    update();
    return tool;
  }).catch(err => { console.warn(err); showError(err); });

  function renderOpts() {
    const tool = state.tool;
    if (!tool) return;
    clear(optsBox);
    const global = tool.options.filter(o => !o.perFile);
    optsUI = global.length ? renderOptions(global, {
      lang, values: state.values, idPrefix: 'wt-opt',
      onChange: () => { onOptionsChanged(); update(); },
      getInputs: usable,
      pageCount: () => (usable().length === 1 ? usable()[0]._pages : null),
    }) : null;
    if (optsUI) optsBox.append(optsUI.root);
    optsSec.hidden = !optsUI || state.phase !== 'files';
  }

  function onOptionsChanged() { state.tool?.onOptionsChange?.(state.values, usable(), ctxBase()); }

  // ---------------------------------------------------------------- intake
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files], 'picker'); fileInput.value = ''; });
  if (cameraLabel) {
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    cameraLabel.hidden = !coarse;
    const camInput = cameraLabel.querySelector('input');
    camInput.addEventListener('change', () => { addFiles([...camInput.files], 'camera'); camInput.value = ''; });
  }
  if (pasteBtn && navigator.clipboard && typeof navigator.clipboard.read === 'function') {
    pasteBtn.hidden = false;
    pasteBtn.addEventListener('click', pasteFromClipboard);
  }
  document.addEventListener('paste', ev => {
    if (state.phase === 'working' || isTextField(ev.target)) return;
    const files = [...(ev.clipboardData?.files || [])];
    if (files.length) { ev.preventDefault(); addFiles(files, 'paste'); }
  });
  // drag & drop: the pick zone highlights, the whole page accepts a drop (no accidental navigation)
  let dragDepth = 0;
  document.addEventListener('dragenter', ev => { if (hasFiles(ev)) { dragDepth++; app.classList.add('wt-dragging'); } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; app.classList.remove('wt-dragging'); } });
  document.addEventListener('dragover', ev => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = state.phase === 'working' ? 'none' : 'copy'; } });
  document.addEventListener('drop', ev => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    app.classList.remove('wt-dragging');
    if (state.phase !== 'working') addFiles([...ev.dataTransfer.files], 'drop');
  });
  drop.dataset.dropLabel = T('drop_here');

  function hasFiles(ev) { return !!ev.dataTransfer && [...(ev.dataTransfer.types || [])].includes('Files'); }
  function isTextField(n) { return n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable); }

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      let i = 0;
      for (const item of items) {
        for (const type of item.types) {
          if (!(type === 'application/pdf' || type.startsWith('image/'))) continue;
          const blob = await item.getType(type);
          const ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '');
          files.push(new File([blob], `${lang === 'de' ? 'Eingefügt' : 'Pasted'}-${++i}.${ext}`, { type }));
          break;
        }
      }
      if (files.length) addFiles(files, 'paste'); else showNotice(T('paste_none'));
    } catch { showNotice(T('paste_denied')); }
  }

  async function addFiles(files, source) {
    if (!files.length || state.phase === 'working' || noFiles) return;
    startCounting();
    updateProof();
    if (state.phase === 'result' || state.phase === 'error') resetResults();
    const fresh = [];
    const rejected = [];
    for (const f of files) {
      const input = await InputFile.from(f);
      if (!accepted(input, cfg.accepts)) { rejected.push(input.name); continue; }
      fresh.push(input);
    }
    if (rejected.length) showNotice(rejected.map(n => T('bad_type', { name: n })).join(' '));
    else hideNotice();
    if (!fresh.length) return;
    if (!cfg.multiple) {
      if (state.inputs.length) showNotice(T('one_file'));
      state.inputs.forEach(removeInputQuiet);
      fresh.splice(1);
    }
    let incoming = fresh;
    if (cfg.maxFiles && state.inputs.length + fresh.length > cfg.maxFiles) {
      incoming = fresh.slice(0, Math.max(0, cfg.maxFiles - state.inputs.length));
      showNotice(T('max_files', { n: cfg.maxFiles }));
    }
    state.inputs.push(...incoming);
    state.results.clear();
    setPhase('files');
    for (const input of incoming) list.append(card(input));
    say(source === 'handoff' ? T('handoff_loaded', { n: incoming.length }) : T('added', { n: incoming.length }));
    update();
    await ready;
    await Promise.all(incoming.map(prepare));
    state.tool?.onInputs?.(usable(), ctxBase());
    optsUI?.refresh();
    update();
  }

  /** Open PDFs (page count, password check) and images (decode test) and render thumbnails. */
  async function prepare(input) {
    const c = cards.get(input.id);
    try {
      if (input.kind === 'pdf') {
        try { await input.pageCount(); } catch (err) {
          if (err instanceof PasswordError) { input.locked = true; refreshCard(input); return; }
          throw err;
        }
      } else if (input.kind === 'image') {
        await input.imageInfo();
      } else {
        // documents that are neither PDF nor image (Word, Excel, text …): an optional tool hook checks
        // the file (throw → error on the card) and may return a thumbnail canvas
        const thumb = state.tool?.prepareOther ? await state.tool.prepareOther(input, ctxBase()) : null;
        refreshCard(input);
        if (thumb && c?.isConnected) { const box = c.querySelector('.wt-thumb'); clear(box).append(thumb); box.classList.add('has-img'); }
        update();
        return;
      }
      refreshCard(input);
      const thumb = await input.thumbnail(64);
      if (c?.isConnected) {
        const box = c.querySelector('.wt-thumb');
        clear(box).append(thumb);
        box.classList.add('has-img');
      }
      if (input.kind === 'image' && input._dims) refreshCard(input);
    } catch (err) {
      console.warn(err);
      // tools that work on damaged files (repair-pdf: `acceptBroken: true`) get them even if pdf.js fails
      if (input.kind === 'pdf' && state.tool?.acceptBroken) { input.broken = true; refreshCard(input); c?.querySelector('.wt-thumb')?.classList.add('has-img'); update(); return; }
      if (input.kind === 'pdf') input.error = { key: err instanceof BadPdfError || !err?.wtKey ? 'bad_pdf' : err.wtKey };
      else if (err?.wtKey) input.error = { key: err.wtKey };
      else if (input.kind === 'other') input.error = { key: 'bad_doc', text: err?.userMessage || null };
      else input.error = { key: input.format === 'heic' ? 'heic_hint' : 'bad_image' };
      refreshCard(input);
    }
    update();
  }

  const usable = () => state.inputs.filter(i => !i.error);

  // ---------------------------------------------------------------- file cards
  function card(input) {
    const name = input.name;
    const up = el('button', { type: 'button', class: 'wt-icon-btn', aria: { label: T('move_up', { name }) }, onclick: () => move(input, -1) }, icon('up'));
    const down = el('button', { type: 'button', class: 'wt-icon-btn', aria: { label: T('move_down', { name }) }, onclick: () => move(input, 1) }, icon('down'));
    const rm = el('button', { type: 'button', class: 'wt-icon-btn wt-rm', aria: { label: T('remove', { name }) }, onclick: () => removeInput(input) }, icon('close'));
    const grip = el('button', { type: 'button', class: 'wt-grip', aria: { label: T('drag', { name }) } }, icon('grip'));
    const thumb = el('div', { class: 'wt-thumb', 'aria-hidden': 'true' }, icon(input.kind === 'image' ? 'image' : 'file'));
    const meta = el('p', { class: 'wt-file-meta' }, formatSize(input.size, lang));
    const info = el('div', { class: 'wt-file-info' }, el('p', { class: 'wt-file-name', title: name }, name), meta);
    const extra = el('div', { class: 'wt-file-extra' });
    const li = el('li', { class: 'wt-file', dataset: { id: input.id } },
      el('div', { class: 'wt-file-row' }, grip, thumb, info, el('div', { class: 'wt-file-actions' }, up, down, rm)), extra);
    li._parts = { meta, extra, up, down, grip };
    cards.set(input.id, li);
    dragHandle(grip, li, input);
    refreshCard(input);
    return li;
  }

  function refreshCard(input) {
    const li = cards.get(input.id);
    if (!li) return;
    const { meta, extra } = li._parts;
    const bits = [formatSize(input.size, lang)];
    if (input._pages != null) bits.push(T('pages', { n: input._pages }));
    if (input._dims) bits.push(`${input._dims.width} × ${input._dims.height}`);
    meta.textContent = bits.join(' · ');
    li.classList.toggle('is-error', !!input.error);
    li.classList.toggle('is-locked', !!input.locked);
    clear(extra);
    if (input.error) {
      extra.append(el('p', { class: 'wt-file-err' }, icon('alert'), el('span', {}, input.error.text ? P(input.error.text) : T(input.error.key, { name: input.name }))));
    } else if (input.locked) {
      extra.append(lockForm(input));
    } else if (state.tool) {
      const per = state.tool.options.filter(o => o.perFile && (!o.kinds || o.kinds.includes(input.kind)));
      if (per.length) {
        for (const o of per) if (!(o.id in input.opts)) input.opts[o.id] = o.default ?? '';
        const ui = renderOptions(per, {
          lang, values: input.opts, idPrefix: `wt-${input.id}`,
          onChange: () => { state.results.clear(); update(); },
          pageCount: () => input._pages,
        });
        li._validate = ui.validate;
        const hasValue = per.some(o => input.opts[o.id] !== (o.default ?? ''));
        extra.append(el('details', { class: 'wt-file-opts', open: hasValue }, el('summary', {}, icon('settings'), T('file_opts')), ui.root));
      }
    }
    updateMoveButtons();
  }

  function lockForm(input) {
    const id = `wt-pw-${input.id}`;
    const err = el('p', { class: 'wt-opt-err', hidden: true, id: id + '-err' }, T('pw_wrong'));
    const field = el('input', { id, class: 'wt-input', type: 'password', autocomplete: 'off', enterkeyhint: 'go', aria: { describedby: id + '-hint ' + id + '-err' } });
    const btn = el('button', { type: 'submit', class: 'wt-btn wt-btn-primary wt-btn-sm' }, T('pw_unlock'));
    const form = el('form', { class: 'wt-lock', onsubmit: async ev => {
      ev.preventDefault();
      if (!field.value) { field.focus(); return; }
      btn.disabled = true;
      const ok = await input.unlock(field.value).catch(() => false);
      btn.disabled = false;
      if (!ok) { err.hidden = false; field.setAttribute('aria-invalid', 'true'); field.select(); return; }
      refreshCard(input);
      say(T('added', { n: 1 }));
      await prepare(input);
      state.tool?.onInputs?.(usable(), ctxBase()); // contract: tools hear about unlocked files, too
    } },
    el('p', { class: 'wt-lock-title' }, icon('lock'), T('locked')),
    el('label', { for: id }, T('pw_label', { name: input.name })),
    el('div', { class: 'wt-lock-row' }, field, btn),
    el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T('pw_hint')), err);
    return form;
  }

  function updateMoveButtons() {
    const n = state.inputs.length;
    state.inputs.forEach((input, i) => {
      const li = cards.get(input.id);
      if (!li) return;
      li._parts.up.disabled = i === 0;
      li._parts.down.disabled = i === n - 1;
      li._parts.grip.hidden = n < 2;
      li._parts.up.hidden = li._parts.down.hidden = n < 2;
    });
    reorderHint.hidden = n < 2 || !cfg.multiple;
  }

  function move(input, delta, focusSel = null) {
    const i = state.inputs.indexOf(input);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.inputs.length) return;
    state.inputs.splice(i, 1);
    state.inputs.splice(j, 0, input);
    syncDomOrder();
    state.results.clear();
    updateMoveButtons();
    const li = cards.get(input.id);
    const btn = focusSel ? li.querySelector(focusSel) : (delta < 0 ? li._parts.up : li._parts.down);
    (btn && !btn.disabled ? btn : li._parts.grip).focus();
    say(T('moved', { name: input.name, pos: j + 1, n: state.inputs.length }));
    state.tool?.onInputs?.(usable(), ctxBase());
    update();
  }

  function syncDomOrder() { for (const input of state.inputs) list.append(cards.get(input.id)); }

  function removeInputQuiet(input) {
    input.release();
    cards.get(input.id)?.remove();
    cards.delete(input.id);
    state.inputs = state.inputs.filter(i => i !== input);
  }

  function removeInput(input) {
    const i = state.inputs.indexOf(input);
    removeInputQuiet(input);
    state.results.clear();
    say(T('removed', { name: input.name }));
    if (!state.inputs.length) { setPhase('pick'); drop.focus?.(); fileInput.focus(); } else {
      const next = state.inputs[Math.min(i, state.inputs.length - 1)];
      cards.get(next.id)?.querySelector('.wt-rm')?.focus();
    }
    updateMoveButtons();
    state.tool?.onInputs?.(usable(), ctxBase());
    update();
  }

  /** Touch/mouse drag on the grip; arrow keys on the focused grip. */
  function dragHandle(grip, li, input) {
    grip.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); move(input, ev.key === 'ArrowUp' ? -1 : 1, '.wt-grip'); }
    });
    let startY = 0, dy = 0, pid = null, scrollTimer = null, lastClientY = 0;
    grip.addEventListener('pointerdown', ev => {
      if (state.inputs.length < 2 || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      pid = ev.pointerId;
      try { grip.setPointerCapture(pid); } catch { /* capture is optional – window listeners below do the work */ }
      startY = ev.pageY;
      lastClientY = ev.clientY;
      dy = 0;
      li.classList.add('is-dragging');
      scrollTimer = setInterval(autoScroll, 30);
      // listeners on window: moving the card in the DOM releases pointer capture in some browsers
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    function onMove(ev) {
      if (ev.pointerId !== pid) return;
      lastClientY = ev.clientY;
      track(ev.pageY);
    }
    function end(ev) {
      if (ev.pointerId !== pid) return;
      pid = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      clearInterval(scrollTimer);
      li.classList.remove('is-dragging');
      li.style.transform = '';
      const order = [...list.children].map(n => n.dataset.id);
      const before = state.inputs.indexOf(input);
      state.inputs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      const after = state.inputs.indexOf(input);
      updateMoveButtons();
      if (before !== after) {
        state.results.clear();
        say(T('moved', { name: input.name, pos: after + 1, n: state.inputs.length }));
        state.tool?.onInputs?.(usable(), ctxBase());
        update();
      }
      grip.focus({ preventScroll: true });
    }

    function track(pageY) {
      dy = pageY - startY;
      const gap = 10;
      let prev = li.previousElementSibling, next = li.nextElementSibling;
      while (next && dy > next.offsetHeight / 2 + gap / 2) {
        list.insertBefore(next, li);
        startY += next.offsetHeight + gap;
        dy = pageY - startY;
        next = li.nextElementSibling;
      }
      while (prev && -dy > prev.offsetHeight / 2 + gap / 2) {
        list.insertBefore(li, prev);
        startY -= prev.offsetHeight + gap;
        dy = pageY - startY;
        prev = li.previousElementSibling;
      }
      li.style.transform = `translateY(${dy}px)`;
    }
    function autoScroll() {
      const edge = 72, h = window.innerHeight;
      let s = 0;
      if (lastClientY < edge) s = -Math.ceil((edge - lastClientY) / 6);
      else if (lastClientY > h - edge - 90) s = Math.ceil((lastClientY - (h - edge - 90)) / 6);
      if (s) { window.scrollBy(0, s); track(lastClientY + window.scrollY); }
    }
  }

  // ---------------------------------------------------------------- phases + bar
  function setPhase(phase) {
    state.phase = phase;
    app.dataset.state = phase;
    const hasFiles = state.inputs.length > 0 || noFiles;
    pickZone.hidden = noFiles || (hasFiles && phase !== 'pick');
    filesSec.hidden = !(phase === 'files' && state.inputs.length > 0);
    stage.hidden = !(phase === 'files' && hasFiles && state.tool?.mountStage);
    optsSec.hidden = !(phase === 'files' && hasFiles && optsUI);
    progress.hidden = phase !== 'working';
    result.hidden = phase !== 'result';
    errorBox.hidden = phase !== 'error';
    bar.hidden = !(phase === 'files' || phase === 'result');
    if (phase === 'pick') { state.inputs.forEach(removeInputQuiet); }
    if (phase === 'files' && state.tool?.mountStage && !stage._mounted && hasFiles) {
      stage._mounted = true;
      state.tool.mountStage(stage, state, ctxBase());
    }
    window.onbeforeunload = phase === 'working' ? () => true : null;
  }

  function update() {
    if (state.phase === 'files') {
      const use = usable();
      const size = use.reduce((s, i) => s + i.size, 0);
      filesTitle.textContent = T('files_h', { n: state.inputs.length });
      list.setAttribute('aria-label', T('files_h', { n: state.inputs.length }));
      barSummary.textContent = T('summary', { files: T('files_h', { n: use.length }), size: formatSize(size, lang) });
      const locked = use.filter(i => i.locked).length;
      const skipped = state.inputs.length - use.length;
      const min = cfg.minFiles ?? 1;
      if (noFiles) barSummary.textContent = cfg.name;
      // optional tool hook: status(values, inputs, lang) → { summary?, hint?, ok? }
      let st = null;
      try { st = state.tool?.status?.(state.values, use, lang) || null; } catch (err) { console.warn(err); }
      if (st?.summary) barSummary.textContent = P(st.summary);
      let hint = '';
      if (use.length < min) hint = T('need_files', { n: min });
      else if (locked) hint = T('pw_needed', { n: locked });
      else if (skipped) hint = T('skipped', { n: skipped });
      if (!hint && st?.hint) hint = P(st.hint);
      barHint.textContent = hint;
      barHint.hidden = !hint;
      primary.textContent = cfg.primary;
      primary.disabled = !state.tool || use.length < min || locked > 0 || st?.ok === false;
      primary.onclick = () => run();
    }
  }

  // ---------------------------------------------------------------- running
  function ctxBase(signal = null) {
    return {
      lang, signal,
      t: P,
      progress: () => {},
      tick: async () => { await tick(); if (signal?.aborted) throw abortError(); },
      throwIfAborted: () => { if (signal?.aborted) throw abortError(); },
      parsePages: (text, count) => parsePages(text, count),
      fileName: (name, suffix, ext) => withSuffix(name, suffix, ext),
      safeFileName,
      notes: [],
      note(text) { this.notes.push(P(text)); },
      announce: say,
      refresh: () => update(),   // stage UIs: re-evaluate the bar (status hook) after their data changed
    };
  }

  function optionsKey() {
    return JSON.stringify([state.values, state.inputs.map(i => [i.id, i.opts, !!i.error])]);
  }

  async function run({ fromResult = false } = {}) {
    const tool = state.tool;
    if (!tool || state.phase === 'working') return;
    if (!fromResult) {
      let ok = optsUI ? optsUI.validate() : true;
      for (const input of usable()) { const v = cards.get(input.id)?._validate; if (v && !v()) ok = false; }
      if (!ok) { app.querySelector('[aria-invalid="true"]')?.focus(); return; }
    }
    const key = optionsKey();
    if (state.results.has(key)) { showResult(state.results.get(key)); return; }
    const ac = new AbortController();
    state.abort = ac;
    const previous = state.phase;
    setPhase('working');
    setProgress(null, T('preparing'));
    cancelBtn.focus();
    const ctx = ctxBase(ac.signal);
    let lastSay = 0;
    ctx.progress = (fraction, text) => {
      setProgress(fraction, P(text) || T('working'));
      const now = performance.now();
      if (now - lastSay > 2500) { lastSay = now; say(P(text) || T('working')); }
    };
    try {
      const inputs = usable();
      const out = await tool.run(inputs, { ...state.values }, ctx);
      if (ac.signal.aborted) throw abortError();
      const res = normalizeResult(out, ctx, inputs);
      state.results.set(key, res);
      showResult(res);
      try { navigator.vibrate?.(12); } catch { /* not supported */ }
    } catch (err) {
      if (isAbort(err)) {
        setPhase(previous === 'result' ? 'result' : 'files');
        if (previous !== 'result') update();
        say(T('cancelled'));
        primary.focus();
      } else {
        console.warn(err);
        showError(err);
      }
    } finally {
      state.abort = null;
    }
  }

  function setProgress(fraction, text) {
    progText.textContent = text;
    if (fraction == null || !isFinite(fraction)) progBar.removeAttribute('value');
    else progBar.value = Math.max(0, Math.min(1, fraction));
  }

  function normalizeResult(out, ctx, inputs) {
    const r = Array.isArray(out) ? { outputs: out } : (out || {});
    const outputs = (r.outputs || []).filter(o => o && o.blob instanceof Blob).map(o => ({
      name: safeFileName(o.name || 'FaLe'), blob: o.blob, before: o.before ?? null, unchanged: !!o.unchanged, pages: o.pages ?? null,
      note: P(o.note) || '', meta: o.meta ?? null,
    }));
    if (!outputs.length) throw Object.assign(new Error('no output'), { wtKey: 'error_generic' });
    return { outputs, notes: [...ctx.notes, ...(r.notes || []).map(P)], inputs: inputs.length };
  }

  // ---------------------------------------------------------------- result
  let objectUrls = [];
  function showResult(res) {
    state.current = res;
    setPhase('result');
    objectUrls.forEach(u => URL.revokeObjectURL(u));
    objectUrls = [];
    clear(result);
    const heading = el('h2', { tabindex: '-1' }, T('done_h'));
    result.append(el('div', { class: 'wt-result-head' }, el('span', { class: 'wt-done-ic' }, icon('check')), el('div', {}, heading, el('p', {}, T('done_n', { n: res.outputs.length })))));

    const liveOpts = state.tool.options.filter(o => o.live && !o.perFile);
    if (liveOpts.length) {
      const ui = renderOptions(liveOpts, { lang, values: state.values, idPrefix: 'wt-live', onChange: () => run({ fromResult: true }), getInputs: usable });
      result.append(el('div', { class: 'wt-live-opts' }, el('p', { class: 'wt-live-title' }, T('options_live')), ui.root));
    }

    const ul = el('ul', { class: 'wt-outputs' });
    for (const o of res.outputs) ul.append(outputRow(o));
    result.append(ul);
    for (const n of res.notes.filter(Boolean)) result.append(el('p', { class: 'wt-note' }, icon('alert'), el('span', {}, n)));

    const actions = el('div', { class: 'wt-result-actions' });
    if (res.outputs.length > 1) {
      actions.append(el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => downloadZip(res) }, icon('zip'), T('download_all')));
    }
    if (canShare(res.outputs) && res.outputs.length > 1) {
      actions.append(el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => doShare(res.outputs) }, icon('share'), T('share')));
    }
    if (actions.childNodes.length) result.append(actions);
    // optional tool hook: add a preview (e.g. before/after comparison) to the result card
    try { state.tool.onResult?.(result, res, ctxBase()); } catch (err) { console.warn(err); }

    const nexts = (cfg.next || []).filter(n => res.outputs.every(o => accepted({ type: o.blob.type, name: o.name }, n.accepts)));
    if (nexts.length) {
      result.append(el('div', { class: 'wt-next' }, el('p', { class: 'wt-next-title' }, T('continue_with')),
        el('ul', {}, nexts.map(n => el('li', {}, el('button', { type: 'button', class: 'wt-next-chip', onclick: () => continueWith(n, res) }, el('span', {}, n.name), icon('arrow')))))));
    }
    result.append(el('div', { class: 'wt-restart' },
      el('button', { type: 'button', class: 'wt-btn wt-btn-text', onclick: () => { setPhase('files'); renderOpts(); setPhase('files'); update(); primary.focus(); } }, L('back_to_files')),
      el('button', { type: 'button', class: 'wt-btn wt-btn-text', onclick: restart }, icon('restart'), T('restart'))));

    // sticky bar: the main action is within thumb reach
    barSummary.textContent = res.outputs.length === 1 ? `${res.outputs[0].name} · ${formatSize(res.outputs[0].blob.size, lang)}` : T('files_h', { n: res.outputs.length });
    barHint.hidden = true;
    primary.disabled = false;
    if (res.outputs.length === 1) {
      primary.textContent = T('download');
      primary.onclick = () => save(res.outputs[0]);
    } else {
      primary.textContent = T('download_all');
      primary.onclick = () => downloadZip(res);
    }
    // tool.shareFirst (photo tools used from the phone gallery): the main action shares the result
    if (state.tool.shareFirst && canShare(res.outputs)) {
      primary.textContent = T('share');
      primary.onclick = () => doShare(res.outputs);
    }
    heading.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    say(`${T('done_h')} ${T('done_n', { n: res.outputs.length })}`);
  }

  function outputRow(o) {
    const thumb = el('div', { class: 'wt-thumb wt-thumb-lg', 'aria-hidden': 'true' }, icon(o.blob.type.startsWith('image/') ? 'image' : 'file'));
    renderOutputThumb(o, thumb);
    const size = el('p', { class: 'wt-out-size' });
    if (o.before != null) {
      size.append(T('before_after', { before: formatSize(o.before, lang), after: formatSize(o.blob.size, lang) }));
      const p = savedPercent(o.before, o.blob.size);
      size.append(' ', el('span', { class: 'wt-pill' + (p ? '' : ' wt-pill-muted') }, p ? T('smaller', { p }) : T('not_smaller')));
    } else {
      size.append(formatSize(o.blob.size, lang));
      if (o.pages) size.append(' · ', T('pages', { n: o.pages }));
    }
    const btns = el('div', { class: 'wt-out-btns' },
      el('button', { type: 'button', class: 'wt-btn wt-btn-primary wt-btn-sm', onclick: () => save(o) }, icon('download'), T('download')));
    if (canShare([o])) btns.append(el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => doShare([o]) }, icon('share'), T('share')));
    return el('li', { class: 'wt-output' }, thumb, el('div', { class: 'wt-out-info' },
      el('p', { class: 'wt-file-name', title: o.name }, o.name), size, o.note ? el('p', { class: 'wt-out-note' }, o.note) : null, btns));
  }

  async function renderOutputThumb(o, box) {
    try {
      let canvas;
      if (o.blob.type === 'application/pdf') {
        const { openPdfjs, renderPage } = await import('./lib/pdf.js');
        const doc = await openPdfjs(new Uint8Array(await o.blob.arrayBuffer()), null);
        try {
          const page = await doc.getPage(1);
          canvas = await renderPage(page, { width: 96, dpr: Math.min(3, devicePixelRatio || 1) });
          page.cleanup();
        } finally { doc.destroy(); }
      } else if (o.blob.type.startsWith('image/')) {
        const bmp = await createImageBitmap(o.blob);
        const s = Math.min(1, (96 * Math.min(3, devicePixelRatio || 1)) / bmp.width);
        canvas = el('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close?.();
      }
      if (canvas && box.isConnected) { clear(box).append(canvas); box.classList.add('has-img'); }
    } catch { /* keep the icon (e.g. encrypted result) */ }
  }

  function save(o) { download(o.blob, o.name); say(T('downloaded', { name: o.name })); }

  async function downloadZip(res) {
    const { createZip } = await import('./lib/shared/zip.js');
    const zip = await createZip(res.outputs.map(o => ({ name: o.name, data: o.blob })));
    const name = safeFileName(`${cfg.name}.zip`);
    download(new Blob([zip], { type: 'application/zip' }), name);
    say(T('downloaded', { name }));
  }

  async function doShare(outputs) {
    const r = await share(outputs, cfg.name);
    if (r === 'failed') showNotice(T('share_fail'));
  }

  async function continueWith(next, res) {
    try {
      await putHandoff(res.outputs.map(o => ({ name: o.name, type: o.blob.type, blob: o.blob })), { target: next.id, from: cfg.id });
      location.href = next.url + (lang === 'de' ? '?weiter=1' : '?continue=1');
    } catch (err) { console.warn(err); showNotice(T('error_generic')); }
  }

  function restart() {
    resetResults();
    setPhase(noFiles ? 'files' : 'pick');
    hideNotice();
    update();
    fileInput.focus();
    pickZone.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function resetResults() {
    state.results.clear();
    state.current = null;
    clear(result);
    objectUrls.forEach(u => URL.revokeObjectURL(u));
    objectUrls = [];
    primary.onclick = () => run();
  }

  // ---------------------------------------------------------------- errors + notices
  function showError(err) {
    state.lastError = err;
    clear(errorBox);
    let msg = T('error_generic');
    if (err?.wtKey) msg = T(err.wtKey, err.wtVars || {});
    else if (err instanceof PasswordError) msg = T('pw_wrong');
    else if (err instanceof BadPdfError) msg = T('bad_pdf', { name: err.wtName || '…' });
    else if (err?.userMessage && typeof err.userMessage === 'object') msg = P(err.userMessage);
    else if (err?.name === 'LimitError' || /memory|allocation|too large|RangeError/i.test(`${err?.name} ${err?.message}`)) msg = T('error_memory');
    errorBox.append(el('div', { class: 'wt-error-head' }, icon('alert'), el('h2', { tabindex: '-1' }, T('error_h'))), el('p', {}, msg),
      el('div', { class: 'wt-btn-row' },
        state.inputs.length || noFiles ? el('button', { type: 'button', class: 'wt-btn wt-btn-primary', onclick: () => { setPhase('files'); update(); run(); } }, T('retry')) : null,
        state.inputs.length || noFiles ? el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => { setPhase('files'); update(); } }, L('back_to_files')) : null));
    setPhase('error');
    errorBox.querySelector('h2').focus();
  }

  let noticeTimer = null;
  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, 12000);
  }
  function hideNotice() { notice.hidden = true; }

  function say(text) {
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  }

  // ---------------------------------------------------------------- privacy proof, offline
  function updateProof() {
    const c = counts();
    if (!proof || !c.active) return;
    proof.hidden = false;
    proof.textContent = T('proof_count', { own: c.own, ext: c.ext });
  }
  onCount(updateProof);

  const idle = fn => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
  window.addEventListener('load', () => idle(async () => {
    const reg = await registerSW();
    if (!reg) return;
    await ready;
    const urls = [location.pathname, cfg.module, ...performance.getEntriesByType('resource').map(e => new URL(e.name).pathname).filter(p => p.startsWith('/assets/wt/'))];
    const ok = await warmUp([...new Set(urls)], cfg.needs || []);
    if (ok) {
      document.documentElement.dataset.wtOffline = 'ready';
      const details = document.querySelector('.wt-proof > div');
      if (details && !details.querySelector('.wt-offline')) details.append(el('p', { class: 'wt-offline' }, icon('offline'), T('offline_ready')));
    }
  }));

  // ---------------------------------------------------------------- hand-off from the previous tool / share target
  const params = new URLSearchParams(location.search);
  if (params.has('weiter') || params.has('continue')) {
    history.replaceState(null, '', location.pathname + location.hash);
    takeHandoff(cfg.id).then(v => { if (v) addFiles(handoffFiles(v), 'handoff'); }).catch(() => {});
  }
  // files chosen before this script ran (slow connection) are picked up, too
  if (fileInput.files && fileInput.files.length) addFiles([...fileInput.files], 'picker');

  function abortError() { return new DOMException('Aborted', 'AbortError'); }
  function isAbort(err) { return err && (err.name === 'AbortError' || err.name === 'RenderingCancelledException'); }
}
