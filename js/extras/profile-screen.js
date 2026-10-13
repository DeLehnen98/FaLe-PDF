// Profil-Bildschirm (#/profil): eigene Daten zum Ausfüllen – lokal gespeichert, exportierbar, löschbar.
import { $, $$, h, esc, toast, confirmDialog, downloadBlob, debounce, errorToast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { PROFILE_FIELDS, getProfile, setProfile, clearProfile } from './profile.js';

const GROUPS = [
  { id: 'person', title: 'Person', icon: 'person' },
  { id: 'adresse', title: 'Adresse', icon: 'pin' },
  { id: 'kontakt', title: 'Kontakt', icon: 'letter' },
  { id: 'beruf', title: 'Beruf & Rechnungen', icon: 'euro', note: 'Nur nötig, wenn du Rechnungen oder Angebote schreibst.' },
];

export async function mount(screen) {
  const p = (await getProfile()) || {};
  const wrap = h(`<div class="screen-inner profile-screen">
    <div class="card intro">
      <span class="tile-ic">${oicon('shield')}</span>
      <div><strong>Deine Daten bleiben bei dir</strong>
      <p>Mit diesen Angaben füllt FaLe Briefe, Kündigungen, Rechnungen und Formulare automatisch aus. Sie werden nur in diesem Browser auf diesem Gerät gespeichert – nie hochgeladen. Alle Felder sind freiwillig.</p></div>
    </div>
    <form class="profile-form" autocomplete="on" novalidate></form>
    <div class="card card-pad profile-actions">
      <div><strong>Daten mitnehmen oder entfernen</strong><p class="muted small">Export als JSON-Datei, z. B. für ein neues Gerät. „Löschen“ entfernt alle Angaben sofort.</p></div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-export>${oicon('download')} Exportieren</button>
        <button class="btn btn-danger-ghost btn-sm" type="button" data-clear>${oicon('trash')} Löschen</button>
      </div>
    </div>
  </div>`);
  const form = $('.profile-form', wrap);
  for (const g of GROUPS) {
    const fields = PROFILE_FIELDS.filter(f => f.group === g.id);
    const sec = h(`<fieldset class="card card-pad pf-group"><legend class="pf-legend">${oicon(g.icon)}<span>${esc(g.title)}</span></legend>
      ${g.note ? `<p class="hint pf-note">${esc(g.note)}</p>` : ''}<div class="pf-grid"></div></fieldset>`);
    const grid = $('.pf-grid', sec);
    for (const f of fields) {
      grid.appendChild(h(`<label class="field${f.short ? ' pf-short' : ''}"><span class="field-label">${esc(f.label)}</span>
        <input class="input" name="${f.id}" type="${f.type || 'text'}" autocomplete="${f.auto || 'off'}" ${f.mode ? `inputmode="${f.mode}"` : ''} placeholder="${esc(f.placeholder || '')}" value="${esc(p[f.id] || '')}"></label>`));
    }
    form.appendChild(sec);
  }
  screen.body.appendChild(wrap);
  const status = h('<span class="foot-info" aria-live="polite"></span>');
  const done = h(`<button class="btn btn-primary" type="button">${oicon('check')} Fertig</button>`);
  screen.setFoot([done]);
  screen.foot.prepend(status);

  const collect = () => Object.fromEntries($$('input[name]', form).map(i => [i.name, i.value]));
  let saving = Promise.resolve();
  const save = async () => {
    saving = saving.then(async () => {
      try { await setProfile(collect()); status.textContent = 'Automatisch gespeichert'; } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    });
    return saving;
  };
  const auto = debounce(save, 350);
  form.addEventListener('input', () => { status.textContent = 'Wird gespeichert …'; auto(); });
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  done.addEventListener('click', async () => { await save(); toast('Profil gespeichert', 'success'); history.length > 1 ? history.back() : (location.hash = '#/einstellungen'); });

  $('[data-export]', wrap).addEventListener('click', async () => {
    await save();
    const data = (await getProfile()) || {};
    const blob = new Blob([JSON.stringify({ app: 'FaLe PDF', type: 'profil', exportedAt: new Date().toISOString(), profil: data }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'FaLe-Profil.json');
    toast('Profil exportiert', 'success');
  });
  $('[data-clear]', wrap).addEventListener('click', async () => {
    if (!await confirmDialog('Profil löschen?', 'Alle gespeicherten Angaben werden von diesem Gerät entfernt.', { okLabel: 'Löschen', danger: true })) return;
    await clearProfile();
    $$('input[name]', form).forEach(i => { i.value = ''; });
    status.textContent = '';
    toast('Profil gelöscht', 'success');
  });
  return () => { auto && save(); };
}
