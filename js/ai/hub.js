// KI-Assistent hub (#/ki), FaLe Pro (#/ki/pro, old link #/ki/plus) and KI-Einstellungen (#/ki/einstellungen).
import { blocked as companyBlocked } from '../policy.js';
import { showPlus, proActive } from '../monetize.js';
import { $, h, esc, toast, errorToast, confirmDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { isNative, platformName } from '../platform.js';
import * as C from './client.js';
import { statusCard, docChip, getDoc } from './common.js';
import { aiGroupsHtml } from './entry.js';
import { aiHidden, setAiHidden } from './hidden.js';
import { locale } from '../i18n/index.js';

export async function mount(screen, { params }) {
  const doc = await getDoc(params.get('doc'));
  const st = statusCard();
  const wrap = h(`<div class="screen-inner ai-hub">
    ${aiHidden() ? `<div class="card card-pad ai-hidden-note" data-ai-hidden-note><strong>KI ist ausgeblendet</strong><p class="muted small">Du hast die KI in den Einstellungen ausgeblendet. Diese Seite bleibt erreichbar – in der App erscheinen aber keine KI-Hinweise mehr.</p><button class="btn btn-ghost btn-sm" type="button" data-unhide>Wieder einblenden</button></div>` : ''}
    <div class="card ai-hero"><span class="ai-hero-ic">${oicon('sparkle')}</span><div><strong>Dein KI-Assistent</strong>
      <p>Stell Fragen an deine Dokumente, lass sie zusammenfassen oder übersetzen, erstelle Folien, Lernkarten und Briefe. Gesendet wird nur, was du für eine Aufgabe auswählst – nie ohne deine Zustimmung.</p></div></div>
    <div data-status></div>
    <div data-doc></div>
    <h2 class="section-title">Was möchtest du tun?</h2>
    <div class="ai-groups" data-groups></div>
    <div class="ai-hub-foot">
      ${showPlus() || proActive() ? `<a class="card action-card ai-plus-card" href="#/ki/pro"><span class="tile-ic">${oicon('star')}</span><span><strong>FaLe Pro</strong><span class="muted small">${proActive() ? 'Aktiv – alle KI-Werkzeuge ohne Video, werbefrei' : 'Alle KI-Werkzeuge ohne Video – und keine Werbung'}</span></span></a>` : ''}
      <a class="card action-card" href="#/ki/einstellungen" data-ai-settings><span class="tile-ic">${oicon('sliders')}</span><span><strong>KI-Einstellungen</strong><span class="muted small">Cloud-KI an/aus, Einwilligung, Datenschutz</span></span></a>
    </div>
    <p class="ai-disclaimer">${oicon('info')}<span>KI kann Fehler machen. Prüfe wichtige Inhalte, Zahlen und Fristen – die Ergebnisse sind keine Rechts- oder Steuerberatung.</span></p>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const un = $('[data-unhide]', wrap);
  if (un) un.addEventListener('click', () => { setAiHidden(false); $('[data-ai-hidden-note]', wrap).remove(); toast('KI wird wieder angezeigt.', 'success'); });
  if (doc) $('[data-doc]', wrap).appendChild(docChip(doc, () => { location.hash = '#/ki'; }));
  $('[data-groups]', wrap).innerHTML = aiGroupsHtml({
    hrefOf: f => f.href + (doc && f.doc ? `${f.href.includes('?') ? '&' : '?'}doc=${encodeURIComponent(doc.id)}` : ''),
    attr: f => `data-ai-feature="${f.id}"`, role: 'listitem',
  });
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  return () => st.el._dispose && st.el._dispose();
}

// ---------------------------------------------------------------- FaLe Pro (internally „plus“: product ids, storage)
const yes = () => `<span class="pro-yes">${oicon('check')}</span>`;
export async function mountPlus(screen) {
  if (!showPlus() && !proActive()) { location.replace('#/werkzeuge/ki'); return () => {}; }   // web: no paid offer (see monetize.js)
  const st = statusCard();
  const pro = proActive();
  const wrap = h(`<div class="screen-inner ai-plus">
    <div class="card ai-plus-hero${pro ? ' is-on' : ''}"><span class="ai-hero-ic">${oicon(pro ? 'checkCircle' : 'star')}</span><div>
      <strong>${pro ? 'Du hast FaLe Pro' : 'FaLe Pro'}</strong>
      <p>${pro ? 'Alle KI-Werkzeuge ohne Video und keine Werbung – danke für deine Unterstützung!' : 'Alle KI-Werkzeuge ohne Video – und keine Werbung. Als Abo oder einmal bezahlt für immer.'}</p></div>
      ${pro ? '<span class="pro-tag big" data-no-i18n>PRO</span>' : ''}</div>
    <div data-status></div>
    <div class="ai-plus-buy" data-buy></div>
    <h2 class="section-title">Ohne Pro und mit Pro</h2>
    <div class="card pro-compare" role="table" aria-label="Ohne Pro und mit Pro im Vergleich">
      <div class="pc-row pc-head" role="row"><span role="columnheader"></span><span role="columnheader">Ohne Pro</span><span role="columnheader" class="pc-pro">Mit Pro</span></div>
      <div class="pc-row" role="row"><span role="rowheader"><strong>PDF-Werkzeuge</strong><small>Bearbeiten, Unterschreiben, Umwandeln, Scannen …</small></span><span role="cell">${yes()} alle</span><span role="cell" class="pc-pro">${yes()} alle</span></div>
      <div class="pc-row" role="row"><span role="rowheader"><strong>KI-Werkzeuge</strong><small>Chat, Zusammenfassen, Übersetzen, Folien, Briefe …</small></span><span role="cell">1 Video pro Anfrage</span><span role="cell" class="pc-pro">${yes()} ohne Video</span></div>
      <div class="pc-row" role="row"><span role="rowheader"><strong>Werbung</strong><small>Banner unten auf den Hauptseiten</small></span><span role="cell">Banner</span><span role="cell" class="pc-pro">${yes()} werbefrei</span></div>
      <div class="pc-row" role="row"><span role="rowheader"><strong>FaLe Sync</strong><small>mit dem freiwilligen FaLe-Konto</small></span><span role="cell">1 GB</span><span role="cell" class="pc-pro">${yes()} 20 GB</span></div>
      <div class="pc-row" role="row"><span role="rowheader"><strong>Auf allen Geräten</strong><small>mit dem freiwilligen FaLe-Konto</small></span><span role="cell">–</span><span role="cell" class="pc-pro">${yes()} Pro gilt überall</span></div>
    </div>
    <div class="card card-pad ai-plus-list"><strong>Gut zu wissen</strong><ul>
      <li>${oicon('play')}<span><strong>Ohne Pro:</strong> Ein Video schaltet eine KI-Anfrage frei. Es muss bis zum Ende laufen – wird es abgebrochen oder die App geschlossen, gibt es keine Freischaltung. Google bestätigt jedes Video unserem Server.</span></li>
      <li>${oicon('sparkle')}<span><strong>Mit Pro:</strong> alle KI-Werkzeuge ohne Video – fair bis zu 200 Anfragen am Tag.</span></li>
      <li>${oicon('shield')}<span>Gesendet wird nur, was du für eine Aufgabe auswählst – mit und ohne Pro.</span></li>
    </ul>
    <p class="muted small">Solange FaLe PDF ein kleines Projekt ist, gilt für die Cloud-KI ein festes Monatsbudget für alle – auch mit Pro kann sie in seltenen Fällen bis zum Monatsende pausieren.</p></div>
    <div class="card card-pad ai-plus-fair" data-fair><strong>So fair rechnen wir ab</strong><ul>
      <li>${oicon('check')}<span>Keine Probezeit, die heimlich zum Abo wird</span></li>
      <li>${oicon('check')}<span>Kündigen mit einem Tipp – hier in der App</span></li>
      <li>${oicon('check')}<span>Auf Wunsch eine Erinnerung drei Tage vor jeder Verlängerung</span></li>
      <li>${oicon('check')}<span>Ohne Pro fehlt dir keine einzige PDF-Funktion</span></li>
    </ul></div>
    <div class="ai-plus-tips" data-tips hidden></div>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const buy = $('[data-buy]', wrap);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const P = await import('./plus.js');
  const done = () => st.el._dispose && st.el._dispose();
  renderTips(P, $('[data-tips]', wrap));
  const status = await C.aiStatus().catch(() => null);
  if (!status || !status.features || !status.features.plus || !P.plusPurchasableHere()) {
    buy.innerHTML = `<div class="notice">${oicon('info')}<span>FaLe Pro ist bald verfügbar.</span></div>`;
    return done;
  }
  const q = C.cachedQuota();
  if (q && q.plus) { renderActive(P, buy, q); return done; }
  buy.innerHTML = '<p class="muted small">Preise werden geladen …</p>';
  try {
    if (!C.hasConsent()) { buy.innerHTML = '<p class="muted small">Bitte richte zuerst oben die Cloud-KI ein.</p>'; return done; }
    const prods = await P.loadProducts();
    if (!prods.length) throw Object.assign(new Error('none'), { userMessage: 'Die Angebote sind gerade nicht verfügbar.' });
    const hasLife = prods.some(p => p.kind === 'inapp');
    buy.innerHTML = `<div class="ai-plus-options"></div><button class="btn btn-ghost btn-sm" type="button" data-restore>Käufe wiederherstellen</button>
      <p class="muted small">Abos verlängern sich automatisch und sind jederzeit über Google Play kündbar. Es gelten die Bedingungen von Google Play.</p>${hasLife ? '<p class="muted small">„Für immer“ ist ein einmaliger Kauf ohne Verlängerung.</p>' : ''}`;
    prods.forEach(p => {
      const life = p.kind === 'inapp';
      const sub = life ? 'Einmal zahlen, kein Abo' : p.plan === 'yearly' ? 'Abo, jährlich kündbar' : 'Abo, monatlich kündbar';
      const b = h(`<button class="card ai-plus-opt${life ? ' is-life' : ''}" type="button" data-plus-product="${esc(p.id)}"><strong>${esc(p.label)}</strong><span class="ai-price" data-no-i18n>${esc(p.price)}</span><span class="muted small">${sub}</span></button>`);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await P.buy(p);
          if (r.active) { toast(r.lifetime ? 'Danke! FaLe Pro gehört jetzt dir – für immer.' : 'Danke! FaLe Pro ist jetzt aktiv.', 'success'); location.reload(); }
          else if (r.pending) toast('Die Zahlung ist noch in Bearbeitung. Pro wird aktiv, sobald sie bestätigt ist – dann „Käufe wiederherstellen“ antippen.', 'info');
          else if (!r.cancelled) toast('Der Kauf ist noch nicht bestätigt. Versuche „Käufe wiederherstellen“.', 'info');
        } catch (e) { errorToast(e, 'Der Kauf konnte nicht abgeschlossen werden.'); }
        finally { b.disabled = false; }
      });
      $('.ai-plus-options', buy).appendChild(b);
    });
    $('[data-restore]', buy).addEventListener('click', async e => {
      e.target.disabled = true;
      try { const r = await P.restore(); toast(r.active ? 'FaLe Pro wurde wiederhergestellt.' : 'Kein aktiver Kauf gefunden.', r.active ? 'success' : 'info'); if (r.active) location.reload(); }
      catch (err) { errorToast(err, 'Wiederherstellen fehlgeschlagen.'); }
      finally { e.target.disabled = false; }
    });
  } catch (e) { buy.innerHTML = `<div class="notice">${oicon('info')}<span>${esc(e.userMessage || 'FaLe Pro ist gerade nicht verfügbar.')}</span></div>`; }
  return done;
}

function renderActive(P, box, q) {
  const info = P.plusInfo() || {};
  const life = info.lifetime || (q.plusUntil && new Date(q.plusUntil).getFullYear() >= 2090);
  if (life) {
    box.innerHTML = `<div class="card card-pad ai-plus-active">${oicon('checkCircle')}<div><strong>FaLe Pro gehört dir – für immer</strong><span class="muted small">Kein Abo, keine Verlängerung. Danke für deine Unterstützung!</span></div></div>`;
    return;
  }
  const until = q.plusUntil ? new Date(q.plusUntil).toLocaleDateString(locale()) : '';
  const renewText = info.renews === false ? `Gekündigt – läuft am ${until} aus` : until ? `Verlängert sich am ${until}` : '';
  box.innerHTML = `<div class="card card-pad ai-plus-active">${oicon('checkCircle')}<div><strong>FaLe Pro ist aktiv</strong><span class="muted small">${renewText}</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-manage>Abo verwalten oder kündigen</button></div>
    <div class="card settings-group"><div class="settings-row"><div class="label"><strong>Vor der Verlängerung erinnern</strong><span>Eine Mitteilung drei Tage, bevor das Abo verlängert wird.</span></div>
      <label class="switch"><input type="checkbox" data-remind ${P.reminderOn() ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Vor der Verlängerung erinnern</span></label></div></div>`;
  $('[data-manage]', box).addEventListener('click', () => P.manage().catch(e => errorToast(e)));
  // stale (cancelled in Play / renewed since)? re-check once a day, then show the fresh state
  if (!box.dataset.refreshed) {
    box.dataset.refreshed = '1';
    const before = JSON.stringify(info);
    P.refreshInfo().then(async fresh => {
      if (JSON.stringify(fresh || {}) === before || !box.isConnected) return;
      const q2 = await C.refreshQuota().catch(() => null);
      if (q2 && q2.plus) renderActive(P, box, q2);
    }).catch(() => {});
  }
  $('[data-remind]', box).addEventListener('change', async e => {
    await P.setReminder(e.target.checked);
    toast(e.target.checked ? 'Du wirst vor der Verlängerung erinnert.' : 'Keine Erinnerung vor der Verlängerung.', 'success');
  });
  P.syncReminder();
}

/** Voluntary tips (consumable products) – shown whenever Google Play offers them, independent of the AI. */
async function renderTips(P, box) {
  if (!box || !P.plusPurchasableHere()) return;
  let tips = [];
  try { tips = await P.loadTips(); } catch { return; }
  if (!tips.length) return;
  const n = P.supporterCount();
  box.hidden = false;
  box.innerHTML = `<div class="card card-pad"><strong>Einfach Danke sagen</strong>
    <p class="muted small">Ein einmaliger Beitrag ohne Gegenleistung – er hilft, FaLe PDF weiterzuentwickeln.</p>${n ? `<p class="muted small" data-tip-count>${n === 1 ? 'Du hast schon einmal unterstützt – danke!' : `Du hast schon ${n}-mal unterstützt – danke!`}</p>` : ''}
    <div class="ai-tip-row"></div></div>`;
  const row = $('.ai-tip-row', box);
  tips.forEach(t => {
    const b = h(`<button class="btn btn-ghost" type="button" data-tip="${esc(t.id)}">${oicon('heart')}<span>${esc(t.label)}</span><span class="ai-price" data-no-i18n>${esc(t.price)}</span></button>`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await P.tip(t);
        if (r.thanked) { toast('Vielen Dank für deine Unterstützung!', 'success'); renderTips(P, box); }
        else if (r.pending) toast('Die Zahlung ist noch in Bearbeitung – danke schon mal!', 'info');
      } catch (e) { errorToast(e, 'Das hat leider nicht geklappt.'); }
      finally { b.disabled = false; }
    });
    row.appendChild(b);
  });
}

// ---------------------------------------------------------------- settings
export async function mountSettings(screen) {
  const render = () => {
    const c = C.consent();
    screen.body.innerHTML = '';
    if (companyBlocked('cloudAi')) {
      screen.body.appendChild(h(`<div class="screen-inner ai-settings"><div class="card policy-card" role="note">${oicon('shield')}<div><strong>Von deiner Firma eingestellt</strong>
        <span class="muted small">Die Cloud-KI ist auf diesem Gerät ausgeschaltet. Alle anderen Werkzeuge arbeiten wie immer nur auf deinem Gerät.</span></div></div></div>`));
      return;
    }
    const wrap = h(`<div class="screen-inner ai-settings">
      <div class="card settings-group">
        <div class="settings-row"><div class="label"><strong>KI komplett ausblenden</strong><span>Entfernt alle KI-Hinweise, -Karten und -Menüpunkte aus der App. Die Cloud-KI wird dabei ausgeschaltet.</span></div>
          <label class="switch"><input type="checkbox" data-hide ${aiHidden() ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">KI komplett ausblenden</span></label></div>
        <div class="settings-row"><div class="label"><strong>Cloud-KI verwenden</strong><span>Aus: Es werden keine Texte an den KI-Dienst gesendet. Alle anderen Funktionen bleiben nutzbar.</span></div>
          <label class="switch"><input type="checkbox" data-cloud ${C.cloudDisabled() ? '' : 'checked'}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Cloud-KI verwenden</span></label></div>
        <div class="settings-row"><div class="label"><strong>Einwilligung</strong><span>${c ? `Erteilt am ${new Date(c.at).toLocaleDateString('de-DE')}.` : 'Noch nicht erteilt – wird beim ersten Mal abgefragt.'}</span></div>
          ${c ? '<button class="btn btn-danger-ghost btn-sm" type="button" data-revoke>Widerrufen</button>' : ''}</div>
        ${isNative() && platformName() !== 'ios' ? '<div class="settings-row" data-adrow><div class="label"><strong>Werbe-Einwilligung</strong><span>Für das Werbebanner und freiwillige Werbevideos (Google AdMob). Hier kannst du deine Auswahl ändern.</span></div><button class="btn btn-ghost btn-sm" type="button" data-adprivacy>Ändern</button></div>' : ''}
        <div class="settings-row"><div class="label"><strong>Datenschutz</strong><span>Was bei der Cloud-KI verarbeitet wird – und was nicht.</span></div><button class="btn btn-ghost btn-sm" type="button" data-privacy>Lesen</button></div>
      </div>
      <div class="card card-pad ai-facts"><strong>So schützt FaLe PDF deine Daten bei der KI</strong><ul>
        <li>Gesendet wird nur der Text, den du für eine Aufgabe auswählst – beim Chat nur die passendsten Ausschnitte.</li>
        <li>Unser Server speichert keine Inhalte und protokolliert keine Eingaben – nur Zähler für das Tageskontingent (30 Tage).</li>
        <li>Statt Konto: eine zufällige Gerätekennung, die du hier mit „Widerrufen“ löschen kannst.</li>
        <li>Zusammenfassen und Übersetzen laufen – wo dein Browser es kann – auch komplett auf dem Gerät.</li>
      </ul></div>
    </div>`);
    $('[data-hide]', wrap).addEventListener('change', e => {
      setAiHidden(e.target.checked);
      if (e.target.checked) C.setCloudDisabled(true);
      toast(e.target.checked ? 'KI ausgeblendet – du findest den Schalter hier in den KI-Einstellungen.' : 'KI wird wieder angezeigt. Die Cloud-KI bleibt aus, bis du sie einschaltest.', 'success');
      render();
    });
    $('[data-cloud]', wrap).addEventListener('change', e => { C.setCloudDisabled(!e.target.checked); toast(e.target.checked ? 'Cloud-KI eingeschaltet' : 'Cloud-KI ausgeschaltet – es werden keine Texte mehr gesendet.', 'success'); });
    const rv = $('[data-revoke]', wrap);
    if (rv) rv.addEventListener('click', async () => {
      if (!await confirmDialog('Einwilligung widerrufen?', 'Die Cloud-KI wird erst nach erneuter Zustimmung wieder genutzt. Die zufällige Gerätekennung wird auf diesem Gerät gelöscht.', { okLabel: 'Widerrufen', danger: true })) return;
      C.revokeConsent(); toast('Einwilligung widerrufen', 'success'); render();
    });
    const ad = $('[data-adprivacy]', wrap);
    if (ad) ad.addEventListener('click', async () => { try { (await import('./ads.js')).showAdPrivacyOptions(); } catch (e) { errorToast(e, 'Die Werbe-Einstellungen konnten nicht geöffnet werden.'); } });
    $('[data-privacy]', wrap).addEventListener('click', () => import('../platform.js').then(m => m.openLegalPage('datenschutz.html')));
    screen.body.appendChild(wrap);
  };
  render();
  screen.setFoot([]);
}

