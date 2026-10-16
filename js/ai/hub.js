// KI-Assistent hub (#/ki), FaLe Plus (#/ki/plus) and KI-Einstellungen (#/ki/einstellungen).
import { showPlus } from '../monetize.js';
import { $, h, esc, toast, errorToast, confirmDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { isNative } from '../platform.js';
import * as C from './client.js';
import { statusCard, docChip, getDoc } from './common.js';
import { AI_FEATURES } from './entry.js';

export async function mount(screen, { params }) {
  const doc = await getDoc(params.get('doc'));
  const st = statusCard();
  const wrap = h(`<div class="screen-inner ai-hub">
    <div class="card ai-hero"><span class="ai-hero-ic">${oicon('sparkle')}</span><div><strong>Dein KI-Assistent</strong>
      <p>Stell Fragen an deine Dokumente, lass sie zusammenfassen oder übersetzen, erstelle Folien, Lernkarten und Briefe. Gesendet wird nur, was du für eine Aufgabe auswählst – nie ohne deine Zustimmung.</p></div></div>
    <div data-status></div>
    <div data-doc></div>
    <h2 class="section-title">Was möchtest du tun?</h2>
    <div class="tool-grid ai-grid" role="list"></div>
    <div class="ai-hub-foot">
      ${showPlus() ? `<a class="card action-card ai-plus-card" href="#/ki/plus"><span class="tile-ic">${oicon('star')}</span><span><strong>FaLe Plus</strong><span class="muted small">Mehr KI-Anfragen pro Tag – und FaLe PDF unterstützen</span></span></a>` : ''}
      <a class="card action-card" href="#/ki/einstellungen" data-ai-settings><span class="tile-ic">${oicon('sliders')}</span><span><strong>KI-Einstellungen</strong><span class="muted small">Cloud-KI an/aus, Einwilligung, Datenschutz</span></span></a>
    </div>
    <p class="ai-disclaimer">${oicon('info')}<span>KI kann Fehler machen. Prüfe wichtige Inhalte, Zahlen und Fristen – die Ergebnisse sind keine Rechts- oder Steuerberatung.</span></p>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  if (doc) $('[data-doc]', wrap).appendChild(docChip(doc, () => { location.hash = '#/ki'; }));
  const grid = $('.ai-grid', wrap);
  AI_FEATURES.forEach(f => {
    const href = f.href + (doc && f.doc ? `${f.href.includes('?') ? '&' : '?'}doc=${encodeURIComponent(doc.id)}` : '');
    grid.appendChild(h(`<a class="tool-card" role="listitem" href="${href}" data-ai-feature="${f.id}"><span class="tile-ic ai-ic">${oicon(f.icon)}</span><span class="tc-text"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></span></a>`));
  });
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  return () => st.el._dispose && st.el._dispose();
}

// ---------------------------------------------------------------- FaLe Plus
export async function mountPlus(screen) {
  if (!showPlus()) { location.replace('#/ki'); return () => {}; }   // web: no paid offer (see monetize.js)
  const st = statusCard();
  const wrap = h(`<div class="screen-inner ai-plus">
    <div class="card ai-plus-hero"><span class="ai-hero-ic">${oicon('star')}</span><div><strong>FaLe Plus</strong>
      <p>FaLe PDF bleibt kostenlos – alle Werkzeuge, ohne Wasserzeichen. Plus ist ein freiwilliges Abo für alle, die die Cloud-KI viel nutzen und die Entwicklung unterstützen möchten.</p></div></div>
    <div data-status></div>
    <div class="card card-pad ai-plus-list"><ul>
      <li>${oicon('check')}<span><strong>Bis zu 200 KI-Anfragen pro Tag</strong> statt einiger weniger</span></li>
      <li>${oicon('check')}<span><strong>Keine Werbevideos</strong> nötig</span></li>
      <li>${oicon('check')}<span>Jederzeit in Google Play kündbar</span></li>
      <li>${oicon('heart')}<span>Hilft, die KI-Kosten zu tragen und FaLe PDF weiterzuentwickeln</span></li>
    </ul>
    <p class="muted small">Hinweis: Solange FaLe PDF ein kleines Projekt ist, gilt für die Cloud-KI ein festes Monatsbudget für alle Nutzerinnen und Nutzer – auch mit Plus kann es in seltenen Fällen bis zum Monatsende pausieren.</p></div>
    <div class="ai-plus-buy" data-buy></div>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const buy = $('[data-buy]', wrap);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const P = await import('./plus.js');
  const status = await C.aiStatus().catch(() => null);
  if (!status || !status.features || !status.features.plus || !P.plusPurchasableHere()) {
    buy.innerHTML = `<div class="notice">${oicon('info')}<span>FaLe Plus ist bald verfügbar.</span></div>`;
    return () => st.el._dispose && st.el._dispose();
  }
  const q = C.cachedQuota();
  if (q && q.plus) {
    buy.innerHTML = `<div class="card card-pad ai-plus-active">${oicon('checkCircle')}<div><strong>FaLe Plus ist aktiv</strong><span class="muted small">${q.plusUntil ? `Bezahlt bis ${new Date(q.plusUntil).toLocaleDateString('de-DE')}` : ''}</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-manage>Abo verwalten</button></div>`;
    $('[data-manage]', buy).addEventListener('click', () => P.manage().catch(e => errorToast(e)));
    return () => st.el._dispose && st.el._dispose();
  }
  buy.innerHTML = '<p class="muted small">Preise werden geladen …</p>';
  try {
    if (!C.hasConsent()) { buy.innerHTML = '<p class="muted small">Bitte richte zuerst oben die Cloud-KI ein.</p>'; return () => st.el._dispose && st.el._dispose(); }
    const prods = await P.loadProducts();
    if (!prods.length) throw Object.assign(new Error('none'), { userMessage: 'Die Abos sind gerade nicht verfügbar.' });
    buy.innerHTML = '<div class="ai-plus-options"></div><button class="btn btn-ghost btn-sm" type="button" data-restore>Käufe wiederherstellen</button><p class="muted small">Das Abo verlängert sich automatisch und ist jederzeit über Google Play kündbar. Es gelten die Bedingungen von Google Play.</p>';
    prods.forEach(p => {
      const b = h(`<button class="card ai-plus-opt" type="button"><strong>${esc(p.label)}</strong><span class="ai-price" data-no-i18n>${esc(p.price)}</span></button>`);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { const r = await P.buy(p); if (r.active) { toast('Danke! FaLe Plus ist jetzt aktiv.', 'success'); location.reload(); } else if (!r.cancelled) toast('Der Kauf ist noch nicht bestätigt. Versuche „Käufe wiederherstellen“.', 'info'); }
        catch (e) { errorToast(e, 'Der Kauf konnte nicht abgeschlossen werden.'); }
        finally { b.disabled = false; }
      });
      $('.ai-plus-options', buy).appendChild(b);
    });
    $('[data-restore]', buy).addEventListener('click', async e => {
      e.target.disabled = true;
      try { const r = await P.restore(); toast(r.active ? 'FaLe Plus wurde wiederhergestellt.' : 'Kein aktives Abo gefunden.', r.active ? 'success' : 'info'); }
      catch (err) { errorToast(err, 'Wiederherstellen fehlgeschlagen.'); }
      finally { e.target.disabled = false; }
    });
  } catch (e) { buy.innerHTML = `<div class="notice">${oicon('info')}<span>${esc(e.userMessage || 'FaLe Plus ist gerade nicht verfügbar.')}</span></div>`; }
  return () => st.el._dispose && st.el._dispose();
}

// ---------------------------------------------------------------- settings
export async function mountSettings(screen) {
  const render = () => {
    const c = C.consent();
    screen.body.innerHTML = '';
    const wrap = h(`<div class="screen-inner ai-settings">
      <div class="card settings-group">
        <div class="settings-row"><div class="label"><strong>Cloud-KI verwenden</strong><span>Aus: Es werden keine Texte an den KI-Dienst gesendet. Alle anderen Funktionen bleiben nutzbar.</span></div>
          <label class="switch"><input type="checkbox" data-cloud ${C.cloudDisabled() ? '' : 'checked'}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Cloud-KI verwenden</span></label></div>
        <div class="settings-row"><div class="label"><strong>Einwilligung</strong><span>${c ? `Erteilt am ${new Date(c.at).toLocaleDateString('de-DE')}.` : 'Noch nicht erteilt – wird beim ersten Mal abgefragt.'}</span></div>
          ${c ? '<button class="btn btn-danger-ghost btn-sm" type="button" data-revoke>Widerrufen</button>' : ''}</div>
        ${isNative() ? '<div class="settings-row" data-adrow><div class="label"><strong>Werbe-Einwilligung</strong><span>Für freiwillige Werbevideos (Google AdMob). Hier kannst du deine Auswahl ändern.</span></div><button class="btn btn-ghost btn-sm" type="button" data-adprivacy>Ändern</button></div>' : ''}
        <div class="settings-row"><div class="label"><strong>Datenschutz</strong><span>Was bei der Cloud-KI verarbeitet wird – und was nicht.</span></div><button class="btn btn-ghost btn-sm" type="button" data-privacy>Lesen</button></div>
      </div>
      <div class="card card-pad ai-facts"><strong>So schützt FaLe PDF deine Daten bei der KI</strong><ul>
        <li>Gesendet wird nur der Text, den du für eine Aufgabe auswählst – beim Chat nur die passendsten Ausschnitte.</li>
        <li>Unser Server speichert keine Inhalte und protokolliert keine Eingaben – nur Zähler für das Tageskontingent (30 Tage).</li>
        <li>Statt Konto: eine zufällige Gerätekennung, die du hier mit „Widerrufen“ löschen kannst.</li>
        <li>Zusammenfassen und Übersetzen laufen – wo dein Browser es kann – auch komplett auf dem Gerät.</li>
      </ul></div>
    </div>`);
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

