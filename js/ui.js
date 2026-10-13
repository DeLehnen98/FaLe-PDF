// Shared UI helpers: toasts, dialogs, menus, formatting, download/share.
import { icon } from './icons.js';
import { saveFile, shareFile } from './platform.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function pagesLabel(n) {
  return n === 1 ? '1 Seite' : `${n ?? '?'} Seiten`;
}

// ---- toasts ----
export function toast(message, type = 'info', { timeout = 3800, action } = {}) {
  const box = $('#toasts');
  const el = h(`<div class="toast toast-${type}" role="${type === 'error' ? 'alert' : 'status'}">
    <span class="toast-ic">${icon(type === 'error' ? 'info' : type === 'success' ? 'check' : 'info')}</span>
    <span class="toast-msg">${esc(message)}</span></div>`);
  if (action) {
    const b = h(`<button class="toast-btn" type="button">${esc(action.label)}</button>`);
    b.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.appendChild(b);
  }
  box.appendChild(el);
  // keep the stack short: drop the oldest non-progress toasts
  const shown = Array.from(box.querySelectorAll('.toast:not(.toast-progress)'));
  shown.slice(0, Math.max(0, shown.length - 2)).forEach(t => t.remove());
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = setTimeout(dismiss, timeout);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }
  return { dismiss, update(msg) { el.querySelector('.toast-msg').textContent = msg; clearTimeout(timer); timer = setTimeout(dismiss, timeout); } };
}

export function errorToast(err, fallback = 'Etwas ist schiefgelaufen.') {
  if (err && err.name === 'AbortError') return;
  const msg = err && err.userMessage ? err.userMessage : fallback;
  if (err && !err.userMessage) console.warn(err);
  toast(msg, 'error', { timeout: 5200 });
}

export class UserError extends Error {
  constructor(msg) { super(msg); this.userMessage = msg; }
}

// Long running progress toast
export function progress(label) {
  const box = $('#toasts');
  const el = h(`<div class="toast toast-progress show" role="status"><span class="spinner" aria-hidden="true"></span><span class="toast-msg">${esc(label)}</span></div>`);
  box.appendChild(el);
  return {
    set(text) { el.querySelector('.toast-msg').textContent = text; },
    done() { el.classList.remove('show'); setTimeout(() => el.remove(), 200); },
  };
}

// ---- dialogs ----
let dialogQueue = Promise.resolve();

export function openDialog({ title, body, actions = [], wide = false, dismissable = true, onMount, validate }) {
  const run = () => new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg' + (wide ? ' dlg-wide' : '');
    dlg.innerHTML = `<form method="dialog" class="dlg-inner">
      <header class="dlg-head"><h2 class="dlg-title">${esc(title)}</h2>
      ${dismissable ? `<button class="icon-btn" value="__cancel" type="submit" aria-label="Schließen">${icon('close')}</button>` : ''}</header>
      <div class="dlg-body"></div>
      <footer class="dlg-actions"></footer></form>`;
    const bodyEl = dlg.querySelector('.dlg-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = dlg.querySelector('.dlg-actions');
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'submit';
      b.value = a.value;
      b.className = 'btn ' + (a.kind || 'btn-ghost');
      b.textContent = a.label;
      foot.appendChild(b);
    });
    if (!actions.length) foot.remove();
    let result = null;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', e => {
      const v = e.submitter ? e.submitter.value : (actions.find(a => a.default) || {}).value;
      result = v === '__cancel' ? null : v;
      if (result && result !== 'cancel' && validate && !validate(result, dlg)) { e.preventDefault(); }
    });
    dlg.addEventListener('cancel', e => { if (!dismissable) e.preventDefault(); });
    dlg.addEventListener('close', () => { const api = dlg._api; dlg.remove(); resolve({ value: result, dialog: dlg, data: api && api.collect ? api.collect() : null }); });
    document.body.appendChild(dlg);
    if (typeof onMount === 'function') dlg._api = onMount(dlg) || null;
    dlg.showModal();
    const focusEl = dlg.querySelector('[autofocus]') || dlg.querySelector('.dlg-actions .btn-primary');
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  });
  const p = dialogQueue.then(run);
  dialogQueue = p.catch(() => {});
  return p;
}

export async function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  const r = await openDialog({
    title, body: `<p>${esc(message)}</p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: okLabel, value: 'ok', kind: danger ? 'btn-danger' : 'btn-primary' }],
  });
  return r.value === 'ok';
}

export async function promptDialog(title, label, value = '', { type = 'text', okLabel = 'OK', hint = '' } = {}) {
  let input;
  const r = await openDialog({
    title,
    body: `<label class="field"><span class="field-label">${esc(label)}</span>
      <input class="input" name="v" type="${type}" value="${esc(value)}" autocomplete="${type === 'password' ? 'current-password' : 'off'}" autofocus></label>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: okLabel, value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      input = dlg.querySelector('input');
      if (type === 'text') {
        const dot = value.lastIndexOf('.');
        setTimeout(() => input.setSelectionRange(0, dot > 0 ? dot : value.length), 40);
      }
      return { collect: () => input.value };
    },
  });
  return r.value === 'ok' ? r.data : null;
}

// ---- popover / action-sheet menu ----
export function showMenu(anchor, items, { label = 'Menü' } = {}) {
  closeMenus();
  const sheet = window.matchMedia('(max-width: 720px)').matches;
  const wrap = h(`<div class="menu-layer ${sheet ? 'as-sheet' : ''}"><div class="menu" role="menu" aria-label="${esc(label)}"></div></div>`);
  const menu = wrap.firstElementChild;
  items.filter(Boolean).forEach(it => {
    if (it === '-') { menu.appendChild(h('<div class="menu-sep" role="separator"></div>')); return; }
    const b = h(`<button class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem" type="button" ${it.disabled ? 'disabled' : ''}>${icon(it.icon || 'file')}<span>${esc(it.label)}</span></button>`);
    b.addEventListener('click', () => { closeMenus(); it.onClick && it.onClick(); });
    menu.appendChild(b);
  });
  wrap.addEventListener('click', e => { if (e.target === wrap) closeMenus(); });
  document.body.appendChild(wrap);
  if (!sheet) {
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  requestAnimationFrame(() => wrap.classList.add('open'));
  const first = menu.querySelector('.menu-item:not([disabled])');
  first && first.focus();
  const onKey = e => {
    if (e.key === 'Escape') { closeMenus(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = $$('.menu-item:not([disabled])', menu);
      const i = list.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n].focus(); e.preventDefault();
    }
  };
  wrap.addEventListener('keydown', onKey);
}

export function closeMenus() {
  $$('.menu-layer').forEach(m => m.remove());
}

// ---- files ----
// Download/share go through platform.js: browser download on the web,
// Documents/FaLe PDF + share sheet in the Android app (where <a download> of blob URLs fails).
/** Save a file for the user. Resolves {ok, where}. */
export function downloadBlob(blob, name, type) {
  return saveFile(blob, name, type || (blob && blob.type) || undefined);
}

/** Share a file (fallback: download). Resolves true when it was shared. */
export async function shareBlob(blob, name, type = 'application/pdf') {
  const r = await shareFile(blob, name, type, { title: name });
  return !!r.ok;
}

export function baseName(name) {
  return String(name || 'Dokument').replace(/\.pdf$/i, '');
}

export function safeFileName(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n || 'Dokument';
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function pickFiles({ accept = '.pdf,application/pdf', multiple = true, capture = null, parent = null } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.className = 'sr-only';
    input.dataset.picker = '1';
    let settled = false;
    input.addEventListener('change', () => { settled = true; resolve(Array.from(input.files || [])); input.remove(); });
    input.addEventListener('cancel', () => { if (!settled) resolve([]); input.remove(); });
    (parent || document.body).appendChild(input);
    input.click();
  });
}

// ---- central PDF file input (#pdf-input) ----
let pdfResolver = null;
let pdfDefault = null;
export function setDefaultPdfHandler(fn) { pdfDefault = fn; }
export function initPdfInput() {
  const input = document.getElementById('pdf-input');
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (pdfResolver) { const r = pdfResolver; pdfResolver = null; r(files); } else if (pdfDefault) pdfDefault(files);
  });
  input.addEventListener('cancel', () => { if (pdfResolver) { const r = pdfResolver; pdfResolver = null; r([]); } });
}
/** Ask the user for PDF files via the shared input; resolves with File[]. */
export function choosePdfs() {
  return new Promise(resolve => {
    if (pdfResolver) pdfResolver([]);
    pdfResolver = resolve;
    document.getElementById('pdf-input').click();
  });
}
