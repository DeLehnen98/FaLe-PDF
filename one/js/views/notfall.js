// Notfallzugang (emergency access): owner overview + 3-step setup, safety-code check, request / veto / revoke,
// the visible log; "Für andere da" for trusted contacts; and the read-only browser of a released Notfallzugang.
// All crypto runs in the worker (engine); this file only renders decrypted views.
import { el, clear, icon, toast, errorToast, errorText, openDialog, confirmDialog, saveBlob, progressBar } from '../dom.js';
import { t, tp, fmtDateTime, fmtDate, fmtSize, getLang } from '../i18n.js';
import * as E from '../engine.js';
import { waitLabel, countdown } from '../app.js';

const WAITS = [24, 72, 168, 336, 720];
const CHECK = [['contracts', () => t('Verträge & Versicherungen')], ['powers', () => t('Vollmachten & Verfügungen')], ['bank', () => t('Bank- & Konto-Hinweise')],
  ['health', () => t('Ärzte & Medikamente')], ['contacts', () => t('Wichtige Kontakte')], ['wishes', () => t('Persönliche Wünsche & Briefe')]];
const APP_URL = 'https://fale-one.vercel.app';

export async function mount(main, { parts, setTitle }) {
  if (parts[0] === 'einrichten') return wizard(main, setTitle);
  if (parts[0] === 'fuer-andere') return othersView(main, setTitle);
  if (parts[0] === 'zugang' && parts[1]) return browse(main, setTitle, parts[1], parts[2] === 'f' ? parts[3] : null, parts[2] === 'a' ? parts[3] : null);
  return overview(main, setTitle);
}

async function run(fn, okMsg) {
  try { const r = await fn(); if (r && (r.own !== undefined || r.others)) E.setEm(r); else if (r && r.status) E.setEm(r.status); if (okMsg) toast(okMsg); return r; }
  catch (e) { errorToast(e); return null; }
}
const contactOf = (own, slot) => (own.contacts.find(c => c.slot === slot) || null);
const emailOf = (own, slot) => { const c = contactOf(own, slot); return c ? c.email : t('Person {n}', { n: slot }); };
const activeCount = own => own.contacts.filter(c => c.status === 'active').length;
const isActive = own => { const a = activeCount(own); return a > 0 && a >= own.setup.threshold; };

/** Six emoji with names + the digits. */
function sasBox(sas) {
  const en = getLang() === 'en';
  return el('div.sas', { role: 'group', aria: { label: t('Sicherheitscode') } },
    el('div.sas-emoji', sas.emoji.map(e => el('span.sas-item', el('span.sas-glyph', { aria: { hidden: 'true' } }, e[0]), el('span.sas-name', en ? e[2] : e[1])))),
    el('p.sas-digits', el('span.muted', t('oder als Zahlen:')), ' ', el('strong.mono', sas.digits)));
}

// ================================================================ owner overview
function overview(main, setTitle) {
  setTitle(t('Notfallzugang'));
  const wrap = el('div.view.notfall');
  main.appendChild(wrap);
  const body = el('div.em-body');
  wrap.append(el('div.view-head', el('h2.view-title', t('Notfallzugang'))), body);
  let tick = null;
  const paint = () => {
    const st = E.state.em;
    clear(body);
    if (!st) { body.append(el('p.muted', t('Lade …'))); return; }
    const own = st.own;
    if (!own) body.append(hero());
    else body.append(...ownerCards(own, st));
    body.append(othersLink(st));
  };
  paint();
  E.refreshEm();
  tick = setInterval(() => { const o = E.state.em && E.state.em.own; if (o && o.request && document.visibilityState === 'visible') paint(); }, 30000);
  return { update: what => { if (what.has('em') || what.has('nodes')) paint(); }, destroy: () => clearInterval(tick) };
}

function hero() {
  return el('section.card.em-hero',
    el('span.em-hero-ic', icon('shield')),
    el('h3.em-hero-title', t('Für den Fall der Fälle')),
    el('p', t('Bestimme Menschen, denen du vertraust. Im Notfall können sie Zugang anfragen. Du wirst benachrichtigt und kannst mit einem Tipp ablehnen. Erst wenn die Wartezeit ohne Widerspruch abläuft, können sie lesen, was du freigegeben hast.')),
    el('ul.gate-points',
      el('li', icon('lock'), el('span', t('Ende-zu-Ende-verschlüsselt: Auch FaLe kann die Dateien nie lesen.'))),
      el('li', icon('folder'), el('span', t('Du entscheidest, was dazugehört – zum Beispiel nur ein Notfallordner mit Vollmachten und Verträgen.'))),
      el('li', icon('check'), el('span', t('Jede Anfrage siehst du sofort. Ablehnen und Widerrufen geht jederzeit.')))),
    el('a.btn.primary', { href: '#/notfall/einrichten' }, icon('shield'), t('Notfallzugang einrichten')));
}

function othersLink(st) {
  const list = (st.others || []);
  const inv = list.filter(x => x.status === 'invited').length;
  const sub = list.length ? (inv ? tp(inv, '{n} neue Einladung', '{n} neue Einladungen') : tp(list.length, 'Vertrauensperson für {n} Person', 'Vertrauensperson für {n} Personen'))
    : t('Hier erscheint es, wenn dich jemand als Vertrauensperson einträgt.');
  return el('a.em-card.em-others' + (inv ? '.todo' : ''), { href: '#/notfall/fuer-andere' }, el('span.em-card-ic', icon('user')), el('span.em-card-text', el('strong', t('Für andere da')), el('span', sub)), icon('chevronRight'));
}

function ownerCards(own, st) {
  const out = [];
  const active = isActive(own);
  const a = activeCount(own);
  // ------------------------------------------------ status
  const summary = [tp(a, '{n} Person bestätigt', '{n} Personen bestätigt'), own.setup.threshold > 1 ? t('{k} müssen gemeinsam anfragen', { k: own.setup.threshold }) : null,
    t('{w} Wartezeit', { w: waitLabel(own.setup.waitHours) })].filter(Boolean).join(' · ');
  out.push(el('section.card.em-status' + (active ? '.on' : '.todo'), { aria: { labelledby: 'em-st' } },
    el('div.em-status-head', el('span.em-hero-ic.sm', icon(active ? 'shield' : 'info')),
      el('div', el('h3#em-st.em-status-title', active ? t('Notfallzugang aktiv') : t('Notfallzugang fast fertig')), el('p.muted', summary))),
    active ? null : el('p', a < own.setup.threshold && a > 0 ? t('Es müssen noch {n} weitere Personen bestätigt werden.', { n: own.setup.threshold - a })
      : t('Sobald eine Vertrauensperson angenommen hat, vergleicht ihr den Sicherheitscode. Danach ist der Notfallzugang aktiv.'))));
  // ------------------------------------------------ open request
  const rq = own.request;
  if (rq) {
    const who = rq.requesters.map(q => emailOf(own, q.slot)).join(', ');
    if (rq.status === 'waiting') {
      const txt = rq.releaseAt
        ? t('{who} hat am {date} Zugang angefragt. Ohne deinen Widerspruch wird er in {left} freigegeben ({at}).', { who, date: fmtDateTime(rq.startedAt), left: countdown(rq.releaseAt, rq.now), at: fmtDateTime(rq.releaseAt) })
        : t('{who} hat Zugang angefragt. Es müssen {k} Personen gemeinsam anfragen – bisher {n}.', { who, k: rq.threshold, n: rq.requesters.length });
      out.push(el('section.card.em-req.urgent', { role: 'alert' }, el('h3.set-title', icon('warning'), t('Zugang angefragt')), el('p', txt),
        el('p.muted', t('Wenn alles in Ordnung ist und du das nicht willst: ablehnen. Es wird dann nichts freigegeben.')),
        el('div.set-btns', el('button.btn.danger-solid', { type: 'button', data: { act: 'deny' }, onclick: () => run(() => E.call('emDeny'), t('Anfrage abgelehnt. Es wurde nichts freigegeben.')) }, icon('close'), t('Ablehnen')))));
    } else {
      out.push(el('section.card.em-req.warn', el('h3.set-title', icon('shield'), t('Zugang freigegeben')),
        el('p', t('Seit {date} kann {who} lesen, was du für den Notfall freigegeben hast (nur lesen).', { date: fmtDateTime(rq.releasedAt), who })),
        el('div.set-btns', el('button.btn.danger', { type: 'button', data: { act: 'revoke' }, onclick: async () => {
          if (await confirmDialog({ title: t('Zugang widerrufen?'), text: t('Der Server liefert ab sofort nichts mehr aus. Was bereits heruntergeladen wurde, kann FaLe nicht zurückholen.'), ok: t('Widerrufen'), danger: true })) run(() => E.call('emRevoke'), t('Zugang widerrufen.'));
        } }, t('Zugang widerrufen')))));
    }
  } else if (own.lastClosed && own.lastClosed.status === 'denied' && own.lastClosed.retryAt && Date.parse(own.lastClosed.retryAt) > Date.now()) {
    out.push(el('p.callout', icon('info'), el('span', t('Du hast die letzte Anfrage am {date} abgelehnt.', { date: fmtDateTime(own.lastClosed.closedAt) }))));
  }
  // ------------------------------------------------ what is covered
  const covered = el('div.em-covered');
  if (own.scope && own.scope.mode === 'all') covered.append(el('p', icon('drive'), ' ', t('Alles in Drive und Fotos (nur lesen)')));
  else {
    const items = [...(own.rootNames || []).map(r => el('li', icon(r.kind === 'folder' ? 'folder' : 'file'), el('span', r.missing ? t('(gelöscht)') : (r.name || t('Ohne Namen'))), r.trashed ? el('span.muted', ' · ' + t('im Papierkorb')) : null)),
      ...(own.albumNames || []).map(r => el('li', icon('album'), el('span', r.missing ? t('(gelöscht)') : r.name)))];
    covered.append(items.length ? el('ul.em-list', items) : el('p.muted', t('Noch nichts ausgewählt.')));
  }
  covered.append(el('p.muted.small', tp(own.setup.nodeKeys, '{n} Element ist abgedeckt – neue Dateien in diesen Ordnern kommen automatisch dazu.', '{n} Elemente sind abgedeckt – neue Dateien in diesen Ordnern kommen automatisch dazu.')));
  if (own.scope && own.scope.note) covered.append(el('blockquote.em-note', own.scope.note));
  out.push(el('section.card.set-sec', el('h3.set-title', t('Was im Notfall zugänglich ist')), covered,
    el('div.set-btns', el('button.btn.ghost.sm', { type: 'button', onclick: () => editScope(own) }, icon('edit'), t('Ändern')))));
  // ------------------------------------------------ contacts
  const rows = own.contacts.map(c => contactRow(own, c));
  out.push(el('section.card.set-sec', el('h3.set-title', t('Vertrauenspersonen')), ...rows,
    own.contacts.length < 3 ? el('div.set-btns', el('button.btn.ghost.sm', { type: 'button', onclick: () => addContact(own) }, icon('plus'), t('Person hinzufügen'))) : null,
    st.notify ? null : el('p.callout', icon('info'), el('span', t('E-Mails verschickt FaLe One in der Beta noch nicht. Sag deinen Vertrauenspersonen selbst Bescheid. Anfragen siehst du hier und als Hinweis, sobald du FaLe One öffnest – wähle die Wartezeit so, dass du sicher vorher reinschaust.')))));
  // ------------------------------------------------ settings: waiting period, k of n
  const nPeople = own.contacts.length;
  out.push(el('section.card.set-sec', el('h3.set-title', t('Wartezeit')),
    el('p.muted', t('So lange hast du nach einer Anfrage Zeit, abzulehnen.')),
    el('div.seg', { role: 'group', aria: { label: t('Wartezeit') } }, WAITS.map(h => el('button', { type: 'button', aria: { pressed: String(h === own.setup.waitHours) },
      onclick: () => { if (h !== own.setup.waitHours) run(() => E.call('emUpdate', { waitHours: h }), t('Wartezeit geändert.')); } }, waitLabel(h)))),
    nPeople >= 2 ? el('div', el('h4.set-sub', t('Gemeinsam anfragen')),
      el('p.muted', t('Mit „2 von 3“ reicht eine Person allein nicht: Der Schlüssel ist aufgeteilt, und erst zusammen ergeben die Teile ihn.')),
      el('div.seg', { role: 'group', aria: { label: t('Wie viele müssen gemeinsam anfragen?') } }, [1, 2, 3].filter(k => k <= nPeople).map(k => el('button', { type: 'button', aria: { pressed: String(k === own.setup.threshold) },
        onclick: () => setThreshold(own, k) }, k === 1 ? t('Eine Person reicht') : t('{k} von {n}', { k, n: nPeople }))))) : null));
  // ------------------------------------------------ log
  out.push(logCard(own));
  out.push(el('section.card.set-sec', el('h3.set-title', t('Notfallzugang beenden')),
    el('p.muted', t('Löscht die Einrichtung, alle Einladungen, versiegelten Schlüssel und das Protokoll. Deine Dateien bleiben unverändert.')),
    el('button.btn.danger', { type: 'button', onclick: async () => {
      if (await confirmDialog({ title: t('Notfallzugang beenden?'), text: t('Deine Vertrauenspersonen können danach keinen Zugang mehr anfragen.'), ok: t('Beenden'), danger: true })) run(() => E.call('emEnd'), t('Notfallzugang beendet.'));
    } }, icon('trash'), t('Beenden …'))));
  return out;
}

function contactRow(own, c) {
  const label = { invited: c.expired ? t('Einladung abgelaufen') : t('Eingeladen – wartet auf Annahme'), accepted: t('Angenommen – Sicherheitscode vergleichen'), active: t('Bestätigt') }[c.status];
  const btns = [];
  if (c.status === 'accepted') btns.push(el('button.btn.primary.sm', { type: 'button', data: { act: 'compare' }, onclick: () => compareDialog(own, c) }, icon('shield'), t('Code vergleichen')));
  if (c.status === 'invited') btns.push(el('button.btn.ghost.sm', { type: 'button', onclick: () => inviteAgain(c.email) }, t('Erneut einladen')));
  btns.push(el('button.icon-btn.sm', { type: 'button', aria: { label: t('{email} entfernen', { email: c.email }) }, onclick: async () => {
    if (await confirmDialog({ title: t('Vertrauensperson entfernen?'), text: t('{email} kann danach keinen Zugang mehr anfragen. Ein laufender Zugang endet sofort.', { email: c.email }), ok: t('Entfernen'), danger: true })) run(() => E.call('emRemove', { slot: c.slot }), t('Entfernt.'));
  } }, icon('trash')));
  return el('div.dev-row.em-contact', { data: { slot: c.slot, status: c.status } },
    icon(c.status === 'active' ? 'checkCircle' : c.status === 'accepted' ? 'shield' : 'user'),
    el('div.dev-text', el('strong', c.email), el('span.muted', label)), el('div.em-row-btns', btns));
}

async function inviteAgain(email) {
  const r = await run(() => E.call('emInvite', { email }));
  if (r) inviteInfo([email], r.mailed);
}
function inviteInfo(emails, mailed) {
  const msg = t('Ich habe dich in FaLe One als Vertrauensperson für den Notfall eingetragen. Melde dich bitte mit dieser E-Mail-Adresse an: {url} – danach vergleichen wir kurz einen Sicherheitscode.', { url: APP_URL });
  openDialog({ title: mailed ? t('Einladung verschickt') : t('Sag Bescheid'), body: [
    el('p.dlg-text', mailed ? t('{list} hat eine E-Mail bekommen.', { list: emails.join(', ') }) : t('E-Mails verschickt FaLe One in der Beta noch nicht. Schick {list} diese Nachricht (zum Beispiel per Messenger):', { list: emails.join(', ') })),
    mailed ? null : el('p.em-msg', msg)],
    actions: mailed ? [{ label: t('OK'), value: 'ok', default: true }] : [{ label: t('Schließen'), value: 'cancel' }, { label: t('Nachricht kopieren'), value: 'copy', default: true, run: async () => { try { await navigator.clipboard.writeText(msg); toast(t('Kopiert.')); } catch { toast(t('Kopieren ging nicht – bitte markiere den Text.'), { kind: 'error' }); } } }] });
}
async function addContact(own) {
  let input;
  const r = await openDialog({ title: t('Vertrauensperson hinzufügen'), body: [
    el('p.dlg-text', t('Die Person braucht ein FaLe-Konto mit dieser E-Mail-Adresse.')),
    el('label.field', el('span.field-label', t('E-Mail-Adresse')), input = el('input.input', { type: 'email', autocomplete: 'off', inputmode: 'email', autofocus: true }))],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Einladen'), value: 'ok', default: true }],
    onMount: () => ({ collect: () => { const v = input.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { input.focus(); input.setAttribute('aria-invalid', 'true'); return false; } return v; } }) });
  if (r.value !== 'ok') return;
  const x = await run(() => E.call('emInvite', { email: r.data }));
  if (x) inviteInfo([r.data], x.mailed);
}
async function setThreshold(own, k) {
  if (k === own.setup.threshold) return;
  const active = activeCount(own);
  if (!active) return run(() => E.call('emUpdate', { threshold: k }), t('Gespeichert.'));
  if (own.request && own.request.status === 'released') { toast(t('Der Zugang ist gerade freigegeben. Widerrufe ihn zuerst.'), { kind: 'error' }); return; }
  const ok = await confirmDialog({ title: k === 1 ? t('Eine Person reicht?') : t('{k} Personen gemeinsam?', { k }), text: t('Der Schlüssel wird für alle bestätigten Vertrauenspersonen neu versiegelt. Eine laufende Anfrage wird dabei beendet.'), ok: t('Neu versiegeln') });
  if (ok) run(() => E.call('emReseal', { threshold: k }), t('Neu versiegelt.'));
}

async function compareDialog(own, c) {
  if (!c.sas) { toast(t('Für diese Person fehlt noch ein Schlüssel.'), { kind: 'error' }); return; }
  const r = await openDialog({ title: t('Sicherheitscode vergleichen'), cls: 'em-sas-dlg', body: [
    el('p.dlg-text', t('Ruf {email} an oder trefft euch. Lest euch die Symbole (oder die Zahlen) vor. Nur wenn alles übereinstimmt, ist sicher, dass niemand einen falschen Schlüssel untergeschoben hat.', { email: c.email })),
    sasBox(c.sas),
    el('p.muted.small', t('Bei {email} steht derselbe Code unter Notfallzugang → Für andere da.', { email: c.email }))],
    actions: [{ label: t('Stimmt nicht'), value: 'no' }, { label: t('Stimmt überein'), value: 'yes', default: true }] });
  if (r.value === 'yes') {
    const x = await run(() => E.call('emReseal', { confirm: [c.slot] }));
    if (x) toast(t('Bestätigt. {email} ist jetzt deine Vertrauensperson.', { email: c.email }));
  } else if (r.value === 'no') {
    const del = await confirmDialog({ title: t('Code stimmt nicht'), text: t('Bestätige auf keinen Fall. Entferne die Person und lade sie neu ein. Wenn es wieder nicht passt, schreib uns.'), ok: t('Person entfernen'), danger: true });
    if (del) run(() => E.call('emRemove', { slot: c.slot }), t('Entfernt.'));
  }
}

const LOG = {
  setup_created: () => t('Notfallzugang eingerichtet'), setup_changed: () => t('Einstellungen geändert'), contact_invited: e => t('{who} eingeladen', e),
  contact_accepted: e => t('{who} hat angenommen', e), contact_confirmed: e => t('Sicherheitscode mit {who} bestätigt', e), contact_removed: e => t('{who} entfernt', e),
  contact_declined: e => t('{who} hat abgelehnt', e), contact_left: e => t('{who} ist keine Vertrauensperson mehr', e), contact_deleted: () => t('Das Konto einer Vertrauensperson wurde gelöscht'),
  request: e => t('{who} hat Zugang angefragt', e), request_joined: e => t('{who} hat sich der Anfrage angeschlossen', e), joined_released: e => t('{who} hat sich dem freigegebenen Zugang angeschlossen', e),
  denied: () => t('Du hast die Anfrage abgelehnt'), released: () => t('Freigegeben – die Wartezeit ist ohne Widerspruch abgelaufen'), revoked: () => t('Du hast den Zugang widerrufen'),
  request_canceled: () => t('Anfrage beendet (Schlüssel neu versiegelt)'), expired: () => t('Anfrage verfallen (nicht genug Personen)'), key_fetched: e => t('{who} hat den Schlüssel abgeholt', e),
  viewed: e => t('{who} hat den Notfallzugang geöffnet', e), download: e => t('{who} hat „{name}“ heruntergeladen', e), threshold_changed: e => t('Jetzt müssen {k} Personen gemeinsam anfragen', e),
};
function logLine(own, l) {
  const who = l.slot ? emailOf(own, l.slot) : '';
  const f = LOG[l.event];
  const text = f ? f({ who, name: l.name || t('eine Datei'), k: l.detail && l.detail.threshold }) : l.event;
  const ic = { request: 'warning', request_joined: 'warning', released: 'shield', denied: 'close', revoked: 'close', download: 'download', viewed: 'eye', key_fetched: 'key' }[l.event] || 'history';
  return el('li.em-log-item' + (['request', 'request_joined', 'released', 'download', 'viewed', 'key_fetched', 'joined_released'].includes(l.event) ? '.hl' : ''), icon(ic), el('span', text), el('time.muted', { datetime: l.at }, fmtDateTime(l.at)));
}
function logCard(own) {
  const list = el('ul.em-log', own.log.slice(0, 8).map(l => logLine(own, l)));
  return el('section.card.set-sec', el('h3.set-title', t('Protokoll')),
    el('p.muted', t('Jede Anfrage, Freigabe, jedes Öffnen und jeder Download durch deine Vertrauenspersonen steht hier.')), list,
    own.log.length > 8 ? el('button.link-btn', { type: 'button', onclick: async () => {
      let all = own.log;
      try { all = await E.call('emLog'); } catch {}
      openDialog({ title: t('Protokoll'), cls: 'wide', body: el('ul.em-log', all.map(l => logLine(own, l))), actions: [{ label: t('Schließen'), value: 'ok', default: true }] });
    } }, t('Alles anzeigen')) : null);
}

// ------------------------------------------------ scope picker (wizard step 1 and "Ändern")
function scopePicker(state) {
  const box = el('div.em-scope');
  const paint = () => {
    const folders = E.childrenOf(null).filter(n => n.kind === 'folder' && !(n.meta && n.meta.role === 'emergency' && state.checklistOn)).sort((a, b) => a.name.localeCompare(b.name));
    const albums = [...E.state.albums.values()].sort((a, b) => a.name.localeCompare(b.name));
    const radio = (v, label, hint) => el('label.em-choice' + (state.mode === v ? '.on' : ''), el('input', { type: 'radio', name: 'em-mode', value: v, checked: state.mode === v, onchange: () => { state.mode = v; paint(); } }),
      el('span', el('strong', label), el('span.muted', hint)));
    clear(box).append(
      radio('items', t('Ausgewählte Inhalte'), t('Empfohlen: ein Notfallordner, dazu nach Wunsch einzelne Ordner oder Alben.')),
      state.mode === 'items' ? el('div.em-sub',
        state.allowChecklist ? el('label.check', el('input', { type: 'checkbox', checked: state.checklistOn, onchange: e => { state.checklistOn = e.target.checked; paint(); } }),
          el('span', el('strong', t('Notfallordner mit Checkliste anlegen')), el('span.muted', t('Ein neuer Ordner mit Unterordnern – du füllst ihn danach in Ruhe.')))) : null,
        state.allowChecklist && state.checklistOn ? el('div.em-checklist', CHECK.map(([k, l]) => el('label.check.sm', el('input', { type: 'checkbox', checked: state.items[k], onchange: e => { state.items[k] = e.target.checked; } }), el('span', l())))) : null,
        state.allowChecklist && state.checklistOn ? el('p.callout.warn', icon('warning'), el('span', t('Passwörter gehören nicht in einfache Notizen. Wenn du Zugangsdaten hinterlegst, dann bewusst: Nach einer Freigabe kann deine Vertrauensperson alles hier lesen. Oft besser: Hinweise, wo Unterlagen liegen, oder die Notfallfunktion deines Passwort-Managers.'))) : null,
        folders.length ? el('fieldset.em-pick', el('legend', t('Ordner')), folders.map(f => el('label.check.sm', el('input', { type: 'checkbox', checked: state.roots.has(f.id), onchange: e => { if (e.target.checked) state.roots.add(f.id); else state.roots.delete(f.id); } }), el('span', f.name || t('Ohne Namen'))))) : null,
        albums.length ? el('fieldset.em-pick', el('legend', t('Alben')), albums.map(a => el('label.check.sm', el('input', { type: 'checkbox', checked: state.albums.has(a.id), onchange: e => { if (e.target.checked) state.albums.add(a.id); else state.albums.delete(a.id); } }), el('span', a.name || t('Ohne Namen'))))) : null) : null,
      radio('all', t('Alles (Drive und Fotos)'), t('Nur lesen. Für alle, die im Notfall wirklich alles übergeben möchten.')));
  };
  paint();
  return box;
}
async function editScope(own) {
  const sc = own.scope || { mode: 'items', roots: [], albums: [] };
  const state = { mode: sc.mode, roots: new Set(sc.roots || []), albums: new Set(sc.albums || []), checklistOn: false, allowChecklist: false, items: {} };
  let note;
  const r = await openDialog({ title: t('Was im Notfall zugänglich ist'), cls: 'wide', body: [scopePicker(state),
    el('label.field', el('span.field-label', t('Nachricht an deine Vertrauenspersonen (optional, verschlüsselt)')), note = el('textarea.input', { rows: 3, maxlength: 2000, value: sc.note || '' }))],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Speichern'), value: 'ok', default: true }] });
  if (r.value !== 'ok') return;
  run(() => E.call('emUpdate', { mode: state.mode, roots: [...state.roots], albumIds: [...state.albums], note: note.value.trim() }), t('Gespeichert. Neue Dateien in diesen Ordnern kommen automatisch dazu.'));
}

// ================================================================ setup wizard (3 steps)
function wizard(main, setTitle) {
  setTitle(t('Notfallzugang einrichten'));
  const wrap = el('div.view.notfall.wiz');
  main.appendChild(wrap);
  if (E.state.em && E.state.em.own) { location.hash = '#/notfall'; return {}; }
  const S = { step: 1, mode: 'items', roots: new Set(), albums: new Set(), checklistOn: true, allowChecklist: true, items: Object.fromEntries(CHECK.map(([k]) => [k, true])),
    emails: ['', '', ''], k: 1, wait: 168, note: '', busy: false };
  const body = el('div.wiz-body');
  const steps = el('ol.wiz-steps', { aria: { label: t('Schritte') } });
  wrap.append(el('div.view-head', el('a.icon-btn', { href: '#/notfall', aria: { label: t('Zurück') } }, icon('back')), el('h2.view-title', t('Notfallzugang einrichten'))), steps, body);
  const emailsOk = () => S.emails.map(e => e.trim()).filter(Boolean);
  const valid = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const paint = () => {
    clear(steps).append(...[t('Inhalte'), t('Personen'), t('Wartezeit')].map((l, i) => el('li' + (i + 1 === S.step ? '.on' : i + 1 < S.step ? '.done' : ''), { aria: { current: i + 1 === S.step ? 'step' : undefined } }, el('span.wiz-n', String(i + 1)), el('span', l))));
    clear(body);
    const nav = (back, next, nextLabel, primary = true) => el('div.wiz-nav', back ? el('button.btn.ghost', { type: 'button', onclick: back }, t('Zurück')) : el('span'), el('button.btn' + (primary ? '.primary' : ''), { type: 'button', data: { act: 'next' }, disabled: S.busy, onclick: next }, nextLabel));
    if (S.step === 1) {
      body.append(el('section.card.set-sec', el('h3.set-title', t('Was soll im Notfall zugänglich sein?')), scopePicker(S),
        nav(null, () => {
          if (S.mode === 'items' && !S.checklistOn && !S.roots.size && !S.albums.size) { toast(t('Bitte wähle mindestens einen Ordner oder ein Album aus.'), { kind: 'error' }); return; }
          S.step = 2; paint();
        }, t('Weiter'))));
    } else if (S.step === 2) {
      const n = emailsOk().length;
      body.append(el('section.card.set-sec', el('h3.set-title', t('Wem vertraust du?')),
        el('p.muted', t('Eine bis drei Personen mit FaLe-Konto. Nach dem Annehmen vergleicht ihr einen kurzen Sicherheitscode – persönlich oder am Telefon. Erst dann wird der Schlüssel für sie versiegelt.')),
        ...[0, 1, 2].map(i => el('label.field', el('span.field-label', t('Vertrauensperson {n} (E-Mail)', { n: i + 1 }) + (i ? ' – ' + t('optional') : '')),
          el('input.input', { type: 'email', value: S.emails[i], autocomplete: 'off', inputmode: 'email', data: { email: i }, oninput: e => { S.emails[i] = e.target.value; const m = emailsOk().length; if ((m >= 2) !== (n >= 2)) paint(); } }))),
        n >= 2 ? el('div', el('h4.set-sub', t('Gemeinsam anfragen?')), el('p.muted', t('Mit „2 von 3“ reicht eine Person allein nicht – der Schlüssel wird aufgeteilt.')),
          el('div.seg', { role: 'group', aria: { label: t('Wie viele müssen gemeinsam anfragen?') } }, [1, 2, 3].filter(k => k <= n).map(k => el('button', { type: 'button', aria: { pressed: String(k === S.k) }, onclick: () => { S.k = k; paint(); } }, k === 1 ? t('Eine Person reicht') : t('{k} von {n}', { k, n }))))) : null,
        nav(() => { S.step = 1; paint(); }, () => {
          const list = emailsOk();
          if (!list.length) { toast(t('Bitte gib mindestens eine E-Mail-Adresse ein.'), { kind: 'error' }); return; }
          const badOne = list.find(e => !valid(e));
          if (badOne) { toast(t('„{email}“ ist keine gültige E-Mail-Adresse.', { email: badOne }), { kind: 'error' }); return; }
          if (new Set(list.map(e => e.toLowerCase())).size !== list.length) { toast(t('Jede Person nur einmal, bitte.'), { kind: 'error' }); return; }
          S.k = Math.min(S.k, list.length); S.step = 3; paint();
        }, t('Weiter'))));
    } else {
      const list = emailsOk();
      let note;
      body.append(el('section.card.set-sec', el('h3.set-title', t('Wie lange darfst du widersprechen?')),
        el('p.muted', t('Nach einer Anfrage hast du so lange Zeit, mit einem Tipp abzulehnen. Erst danach wird freigegeben.')),
        el('div.seg.em-waits', { role: 'group', aria: { label: t('Wartezeit') } }, WAITS.map(h => el('button', { type: 'button', aria: { pressed: String(h === S.wait) }, onclick: () => { S.note = note.value; S.wait = h; paint(); } }, waitLabel(h)))),
        el('label.field', el('span.field-label', t('Nachricht an deine Vertrauenspersonen (optional, verschlüsselt)')),
          note = el('textarea.input', { rows: 3, maxlength: 2000, placeholder: t('Zum Beispiel: Die Originale liegen im Ordner im Arbeitszimmer.'), oninput: e => { S.note = e.target.value; } })),
        el('h4.set-sub', t('Zusammenfassung')),
        el('ul.em-sum',
          el('li', icon('folder'), el('span', S.mode === 'all' ? t('Alles in Drive und Fotos (nur lesen)') : [S.checklistOn ? t('Neuer Notfallordner') : null, S.roots.size ? tp(S.roots.size, '{n} Ordner', '{n} Ordner') : null, S.albums.size ? tp(S.albums.size, '{n} Album', '{n} Alben') : null].filter(Boolean).join(' · '))),
          el('li', icon('user'), el('span', list.join(', ') + (S.k > 1 ? ' · ' + t('{k} von {n} gemeinsam', { k: S.k, n: list.length }) : ''))),
          el('li', icon('history'), el('span', t('{w} Wartezeit', { w: waitLabel(S.wait) })))),
        nav(() => { S.note = note.value; S.step = 2; paint(); }, async () => {
          if (S.busy) return;
          S.busy = true; S.note = note.value; paint();
          try {
            const checklist = S.mode === 'items' && S.checklistOn ? { name: t('Notfallordner'), items: Object.fromEntries(CHECK.filter(([k]) => S.items[k]).map(([k, l]) => [k, l()])) } : null;
            const r = await E.call('emSetup', { waitHours: S.wait, mode: S.mode, roots: [...S.roots], albumIds: [...S.albums], checklist, note: S.note.trim(), emails: list, threshold: S.k });
            E.setEm(r.status);
            location.hash = '#/notfall';
            const sent = list.filter(e => !r.failed.some(f => f.email === e));
            if (r.failed.length) toast(t('Nicht eingeladen: {list}', { list: r.failed.map(f => f.email).join(', ') }), { kind: 'error' });
            if (sent.length) setTimeout(() => inviteInfo(sent, !!r.status.notify), 300);
            E.syncNow();
          } catch (e) { S.busy = false; paint(); errorToast(e); }
        }, S.busy ? t('Richte ein …') : t('Einrichten'))));
      note.value = S.note;
    }
    const f = body.querySelector('input, button.btn.primary');
    if (f && S.step > 1) setTimeout(() => { const h = body.querySelector('.set-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }, 30);
  };
  paint();
  return {};
}

// ================================================================ contact side: "Für andere da"
function othersView(main, setTitle) {
  setTitle(t('Für andere da'));
  const wrap = el('div.view.notfall');
  main.appendChild(wrap);
  const body = el('div.em-body');
  wrap.append(el('div.view-head', el('a.icon-btn', { href: '#/notfall', aria: { label: t('Zurück') } }, icon('back')), el('h2.view-title', t('Für andere da'))),
    el('p.lead.muted', t('Menschen, die dich als Vertrauensperson eingetragen haben. Im Notfall fragst du hier Zugang an.')), body);
  const paint = () => {
    const st = E.state.em;
    clear(body);
    if (!st) { body.append(el('p.muted', t('Lade …'))); return; }
    if (!st.others.length) { body.append(el('div.empty', icon('user'), el('p', t('Noch hat dich niemand als Vertrauensperson eingetragen.')))); return; }
    for (const x of st.others) body.append(otherCard(x));
  };
  paint();
  E.refreshEm();
  const tick = setInterval(() => { if (document.visibilityState === 'visible' && E.state.em && E.state.em.others.some(x => x.request)) paint(); }, 30000);
  return { update: what => { if (what.has('em')) paint(); }, destroy: () => clearInterval(tick) };
}

function otherCard(x) {
  const who = x.ownerEmail;
  const card = el('section.card.set-sec.em-other', { data: { setup: x.setupId, status: x.status } });
  const head = el('div.em-status-head', el('span.em-hero-ic.sm', icon('user')), el('div', el('h3.em-status-title', who),
    el('p.muted', [t('{w} Wartezeit', { w: waitLabel(x.waitHours) }), x.threshold > 1 ? t('{k} müssen gemeinsam anfragen', { k: x.threshold }) : null].filter(Boolean).join(' · '))));
  card.append(head);
  if (x.status === 'invited') {
    card.append(el('p', t('{who} möchte dich als Vertrauensperson für den Notfall. Du könntest dann im Notfall Zugang anfragen – {who} wird benachrichtigt und kann ablehnen.', { who })),
      el('div.set-btns',
        el('button.btn.primary', { type: 'button', data: { act: 'accept' }, onclick: () => run(() => E.call('emAccept', { setupId: x.setupId }), t('Angenommen. Vergleicht jetzt den Sicherheitscode.')) }, icon('check'), t('Annehmen')),
        el('button.btn.ghost', { type: 'button', onclick: async () => { if (await confirmDialog({ title: t('Einladung ablehnen?'), text: t('{who} wird informiert.', { who }), ok: t('Ablehnen') })) run(() => E.call('emLeave', { setupId: x.setupId }), t('Abgelehnt.')); } }, t('Ablehnen'))));
    return card;
  }
  if (x.keyChanged) card.append(el('p.callout.warn', icon('warning'), el('span', t('Dein Schlüssel hat sich seit dem Annehmen geändert. Bitte {who}, dich zu entfernen und neu einzuladen.', { who }))));
  if (x.status === 'accepted') {
    card.append(el('p', t('Vergleiche diesen Sicherheitscode mit {who} – persönlich oder am Telefon. {who} bestätigt ihn in der eigenen App.', { who })), x.sas ? sasBox(x.sas) : null,
      el('p.muted.small', t('Wartet auf die Bestätigung durch {who}.', { who })));
  } else if (x.readable) {
    card.append(el('p.callout', icon('shield'), el('span', t('Freigegeben seit {date}. Du kannst lesen und herunterladen; ändern kannst du nichts.', { date: fmtDateTime(x.request.releasedAt) }))),
      el('div.set-btns', el('a.btn.primary', { href: '#/notfall/zugang/' + x.setupId, data: { act: 'open' } }, icon('folder'), t('Öffnen'))));
  } else if (x.request && x.request.status === 'waiting') {
    const mine = x.requested;
    const txt = x.request.releaseAt
      ? t('Angefragt. Freigabe in {left} ({at}), wenn {who} nicht ablehnt.', { left: countdown(x.request.releaseAt, x.request.now), at: fmtDateTime(x.request.releaseAt), who })
      : t('{n} von {k} Personen haben angefragt. Die Wartezeit beginnt, wenn genug zusammen sind.', { n: x.request.requesters.length, k: x.request.threshold });
    card.append(el('div.em-wait', icon('history'), el('p', txt)));
    if (!mine) card.append(el('div.set-btns', el('button.btn.primary', { type: 'button', data: { act: 'request' }, onclick: () => requestDialog(x) }, t('Ebenfalls anfragen'))));
  } else {
    const lc = x.lastClosed;
    const cool = lc && lc.retryAt && Date.parse(lc.retryAt) > Date.now();
    if (lc && lc.status === 'denied') card.append(el('p.muted', t('{who} hat die letzte Anfrage am {date} abgelehnt.', { who, date: fmtDateTime(lc.closedAt) })));
    if (lc && lc.status === 'revoked') card.append(el('p.muted', t('{who} hat den Zugang am {date} widerrufen.', { who, date: fmtDateTime(lc.closedAt) })));
    card.append(el('p', t('Du bist Vertrauensperson für {who}. Wenn etwas passiert ist, kannst du Zugang anfragen.', { who })),
      el('div.set-btns', el('button.btn.primary', { type: 'button', data: { act: 'request' }, disabled: cool || x.contacts < x.threshold, onclick: () => requestDialog(x) }, icon('key'), t('Zugang anfragen')),
        cool ? el('span.muted.small', t('Wieder möglich ab {date}', { date: fmtDateTime(lc.retryAt) })) : null),
      x.contacts < x.threshold ? el('p.muted.small', t('{who} hat noch nicht genug Vertrauenspersonen bestätigt.', { who })) : null);
  }
  card.append(el('button.link-btn.small', { type: 'button', onclick: async () => { if (await confirmDialog({ title: t('Keine Vertrauensperson mehr sein?'), text: t('{who} wird informiert. Du kannst danach keinen Zugang mehr anfragen.', { who }), ok: t('Beenden'), danger: true })) run(() => E.call('emLeave', { setupId: x.setupId }), t('Erledigt.')); } }, t('Nicht mehr Vertrauensperson sein')));
  return card;
}
async function requestDialog(x) {
  const ok = await confirmDialog({ title: t('Zugang anfragen?'), text: t('{who} wird sofort benachrichtigt und kann ablehnen. Ohne Widerspruch wird der Zugang nach {w} freigegeben. Jede Anfrage steht im Protokoll von {who}.', { who: x.ownerEmail, w: waitLabel(x.waitHours) }), ok: t('Anfragen') });
  if (!ok) return;
  run(() => E.call('emRequest', { setupId: x.setupId }), t('Angefragt.'));
}

// ================================================================ read-only browser of a released Notfallzugang
const opened = new Map(); // setupId → result of emOpen (decrypted views, in memory only)
const thumbCache = new Map();
function browse(main, setTitle, setupId, folderId, albumId) {
  const wrap = el('div.view.notfall.em-browse');
  main.appendChild(wrap);
  const x = E.state.em && E.state.em.others.find(o => o.setupId === setupId);
  const who = x ? x.ownerEmail : '';
  setTitle(t('Notfallzugang von {who}', { who }));
  const body = el('div.em-body');
  wrap.append(el('div.view-head', el('a.icon-btn', { href: folderId || albumId ? '#/notfall/zugang/' + setupId : '#/notfall/fuer-andere', aria: { label: t('Zurück') } }, icon('back')),
    el('h2.view-title', who || t('Notfallzugang')), el('span.ro-badge', icon('lock'), t('Nur lesen'))), body);
  let alive = true;
  const load = async (force) => {
    clear(body).append(el('p.muted', t('Entschlüssele …')));
    try {
      if (force || !opened.has(setupId)) {
        const r = await E.call('emOpen', { setupId });
        if (r.waiting) { opened.delete(setupId); return paintWaiting(r.waiting); }
        opened.set(setupId, r);
      }
      if (alive) paint(opened.get(setupId));
    } catch (e) {
      clear(body).append(el('p.callout.warn', icon('warning'), el('span', e.code === 'locked' ? t('Der Zugang ist nicht (mehr) freigegeben.') : e.code === 'tampered' ? t('Die Schlüsselteile passen nicht zusammen. Bitte melde dich bei uns.') : errorText(e))),
        el('a.btn.ghost', { href: '#/notfall/fuer-andere' }, t('Zurück')));
    }
  };
  const paintWaiting = w => {
    clear(body).append(el('div.em-wait', icon('history'), el('p', t('Es fehlen noch Schlüsselteile: {have} von {need} sind da. Die anderen Vertrauenspersonen müssen FaLe One einmal öffnen.', { have: w.have, need: w.need }))),
      el('button.btn.ghost', { type: 'button', onclick: () => load(true) }, icon('refresh'), t('Erneut versuchen')));
  };
  const paint = r => {
    const nodes = r.nodes;
    const byId = new Map(nodes.map(n => [n.id, n]));
    clear(body);
    if (!folderId && !albumId && r.note) body.append(el('section.card.em-letter', el('h3.set-title', icon('fileText'), t('Nachricht von {who}', { who })), el('p.em-note', r.note)));
    let list;
    if (albumId) {
      const a = r.albums.find(z => z.id === albumId);
      setTitle(a ? a.name : t('Album'));
      list = (a ? a.items : []).map(id => byId.get(id)).filter(Boolean);
    } else {
      list = nodes.filter(n => (n.parent || null) === (folderId || null));
      if (folderId) { const f = byId.get(folderId); if (f) setTitle(f.name); body.append(el('p.muted', crumbs(byId, folderId))); }
    }
    list.sort((a, b) => ((a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
    const files = nodes.filter(n => n.kind !== 'folder' && !n.err);
    if (!folderId && !albumId) body.append(el('div.set-btns', el('button.btn.ghost.sm', { type: 'button', data: { act: 'zip' }, onclick: () => zipAll(setupId, r, who) }, icon('download'), t('Alles herunterladen ({n} Dateien, ZIP)', { n: files.length }))));
    const items = el('div.items.list', { role: 'list' });
    for (const n of list) items.append(row(setupId, n, byId));
    if (!list.length) items.append(el('p.muted', t('Hier ist nichts.')));
    body.append(items);
    if (!folderId && !albumId && r.albums.length) {
      body.append(el('h3.set-sub', t('Alben')), el('div.items.list', { role: 'list' }, r.albums.map(a => el('div.row', { role: 'listitem' },
        el('a.row-open', { href: `#/notfall/zugang/${setupId}/a/${a.id}` }, el('span.thumb', icon('album')), el('span.row-text', el('span.row-name', a.name || t('Ohne Namen')), el('span.row-meta', tp(a.items.length, '{n} Foto', '{n} Fotos'))))))));
    }
    loadThumbs(setupId, list.filter(n => n.head && n.head.thumb));
  };
  load(false);
  return { destroy: () => { alive = false; } };
}
function crumbs(byId, id) {
  const path = [];
  for (let cur = byId.get(id), g = 0; cur && g < 100; g++) { path.unshift(cur.name); cur = cur.parent ? byId.get(cur.parent) : null; }
  return path.join(' › ');
}
function row(setupId, n, byId) {
  const isFolder = n.kind === 'folder';
  const meta = isFolder ? tp([...byId.values()].filter(c => c.parent === n.id).length, '{n} Element', '{n} Elemente') : [fmtSize((n.rev && n.rev.size) || 0), fmtDate((n.rev && n.rev.mtime) || n.updatedAt)].filter(Boolean).join(' · ');
  const th = el('span.thumb', { data: { thumb: n.id } }, icon(isFolder ? 'folder' : n.kind === 'photo' ? 'image' : 'file'));
  const cached = thumbCache.get(n.id);
  if (cached) { clear(th).append(el('img', { alt: '', src: cached })); th.classList.add('has-img'); }
  const open = el(isFolder ? 'a.row-open' : 'button.row-open', isFolder ? { href: `#/notfall/zugang/${setupId}/f/${n.id}` } : { type: 'button', onclick: () => fileActions(setupId, n) },
    th, el('span.row-text', el('span.row-name', n.err ? t('(nicht lesbar)') : (n.name || t('Ohne Namen'))), el('span.row-meta', meta)));
  return el('div.row', { role: 'listitem', data: { id: n.id } }, open);
}
async function loadThumbs(setupId, nodes) {
  const need = nodes.filter(n => !thumbCache.has(n.id));
  if (!need.length) return;
  let got = {};
  try { got = await E.call('emThumbs', { setupId, ids: need.map(n => n.id) }); } catch { return; }
  for (const [id, blob] of Object.entries(got)) {
    const url = URL.createObjectURL(blob);
    thumbCache.set(id, url);
    for (const box of document.querySelectorAll(`[data-thumb="${id}"]`)) { clear(box).append(el('img', { alt: '', src: url })); box.classList.add('has-img'); }
  }
}
async function fetchFile(setupId, n) {
  const pid = 'em:' + n.id + ':' + Math.random().toString(36).slice(2);
  const bar = progressBar(0, t('Lade {name}', { name: n.name }));
  const close = toast(el('span.toast-prog', el('span', t('Entschlüssele „{name}“ …', { name: n.name })), bar), { timeout: 3600e3 });
  const off = E.onProgress(pid, f => bar.set(f));
  try { return await E.call('emDownload', { setupId, id: n.id, progressId: pid }); }
  finally { off(); close(); }
}
async function fileActions(setupId, n) {
  const image = /^image\/(jpeg|png|webp|gif|avif)$/.test((n.rev && n.rev.mime) || '') || n.kind === 'photo';
  if (image) {
    let blob;
    try { blob = await fetchFile(setupId, n); } catch (e) { errorToast(e); return; }
    const url = URL.createObjectURL(blob);
    await openDialog({ title: n.name, cls: 'wide', body: el('img.em-img', { src: url, alt: n.name }),
      actions: [{ label: t('Schließen'), value: 'cancel' }, { label: t('Herunterladen'), value: 'dl', default: true, run: () => saveBlob(blob, n.name) }] });
    URL.revokeObjectURL(url);
    return;
  }
  try { saveBlob(await fetchFile(setupId, n), n.name || 'Datei'); } catch (e) { errorToast(e); }
}
async function zipAll(setupId, r, who) {
  const byId = new Map(r.nodes.map(n => [n.id, n]));
  const safe = s => String(s || t('Ohne Namen')).replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').slice(0, 120);
  const pathOf = n => { const p = []; for (let c = n, g = 0; c && g < 100; g++) { p.unshift(safe(c.name)); c = c.parent ? byId.get(c.parent) : null; } return p.join('/'); };
  const files = r.nodes.filter(n => n.kind !== 'folder' && !n.err);
  const used = new Set();
  const entries = files.map(n => { let p = pathOf(n); while (used.has(p)) p = p.replace(/(\.[^./]*)?$/, m => ' (2)' + m); used.add(p); return { path: p, size: (n.rev && n.rev.size) || 0, mtime: n.rev && n.rev.mtime, key: n.id, get: () => E.call('emDownload', { setupId, id: n.id }) }; });
  const total = entries.reduce((s, e) => s + e.size, 0);
  const status = el('span', t('Bereite vor …'));
  const bar = progressBar(0, t('Fortschritt'));
  const close = toast(el('span.toast-prog', status, bar), { timeout: 24 * 3600e3 });
  let bytes = 0;
  try {
    const { writeTo } = await import('../export.js');
    await writeTo({ zip: true, prefix: safe('Notfallzugang ' + who + ' ' + new Date().toISOString().slice(0, 10)), startPart: 1 }, entries, e => {
      bytes += e.size; bar.set(total ? Math.min(1, bytes / total) : 1);
      status.textContent = t('Exportiere … {done} von {total}', { done: fmtSize(bytes), total: fmtSize(total) });
    });
    toast(t('Fertig: {n} Dateien heruntergeladen.', { n: entries.length }));
  } catch (e) { errorToast(e); } finally { close(); }
}
