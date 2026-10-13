// Routing for the „Extras“ screens (#/profil, #/fristen, #/tresor, #/papierkorb, #/duplikate, #/schreiben, #/gliederung).
import { openScreen } from '../screen.js';
import { errorToast, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';

const SCREENS = {
  profil: { title: 'Meine Daten', sub: 'Nur auf diesem Gerät gespeichert', load: () => import('./profile-screen.js') },
  fristen: { title: 'Fristen & Erinnerungen', sub: 'Nie wieder eine Kündigungsfrist verpassen', load: () => import('./reminders.js') },
  tresor: { title: 'Privater Tresor', sub: 'Verschlüsselt mit deiner PIN', load: () => import('./vault.js') },
  papierkorb: { title: 'Papierkorb', sub: 'Gelöschte Dateien werden 30 Tage aufbewahrt', load: () => import('./organize.js').then(m => ({ mount: m.mountTrash })) },
  duplikate: { title: 'Duplikate finden', sub: 'Identische Dateien aufspüren und Platz schaffen', load: () => import('./organize.js').then(m => ({ mount: m.mountDuplicates })) },
  schreiben: { title: 'Schreiben & Vorlagen', sub: 'Briefe in einer Minute – fertig als Dokument und PDF', load: () => import('./letters.js') },
  gliederung: { title: 'Folien aus Gliederung', sub: 'Text rein, fertige Präsentation raus', load: () => import('../office/outline.js') },
};
export const EXTRA_ROUTES = Object.keys(SCREENS);

export async function openExtraRoute(parts, params, { goBack }) {
  const conf = SCREENS[parts[0]];
  if (!conf) return;
  const screen = openScreen({ title: conf.title, sub: conf.sub, onBack: () => (screen.onBackRequest ? screen.onBackRequest(goBack) : goBack()) });
  screen.root.classList.add('extras-screen', `extras-${parts[0]}`);
  screen.hashKey = location.hash;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
  try {
    const mod = await conf.load();
    if (screen.signal.aborted) return;
    screen.body.innerHTML = '';
    const cleanup = await mod.mount(screen, { parts, params, goBack });
    if (typeof cleanup === 'function') screen.cleanup = cleanup;
  } catch (e) {
    if (screen.signal.aborted) return;
    errorToast(e, 'Diese Ansicht konnte nicht geöffnet werden.');
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p>${esc(e && e.userMessage ? e.userMessage : 'Bitte versuche es erneut.')}</p></div></div>`;
  }
}
