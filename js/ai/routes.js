// Routing for the AI screens: #/ki, #/ki/chat, #/ki/zusammenfassen, #/ki/uebersetzen, #/ki/folien,
// #/ki/lernkarten, #/ki/brief, #/ki/bild, #/ki/plus, #/ki/einstellungen (all optional ?doc=<id>).
import { openScreen } from '../screen.js';
import { errorToast, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { loadAiCss } from './ui.js';

const SCREENS = {
  '': { title: 'KI-Assistent', sub: 'Fragen, zusammenfassen, übersetzen – du entscheidest, was gesendet wird', load: () => import('./hub.js') },
  chat: { title: 'Chat mit Dokument', sub: 'Antworten mit Seitenangaben', load: () => import('./chat.js') },
  zusammenfassen: { title: 'Zusammenfassen', sub: 'Das Wichtigste auf einen Blick', load: () => import('./textops.js').then(m => ({ mount: (s, c) => m.mount(s, { ...c, op: 'summarize' }) })) },
  uebersetzen: { title: 'Übersetzen', sub: 'Dokumente und Texte in viele Sprachen', load: () => import('./textops.js').then(m => ({ mount: (s, c) => m.mount(s, { ...c, op: 'translate' }) })) },
  folien: { title: 'Folien per KI', sub: 'Thema rein, fertige Präsentation raus', load: () => import('./slides-ai.js') },
  lernkarten: { title: 'Lernkarten & Quiz', sub: 'Aus Dokumenten lernen – gespeichert auf diesem Gerät', load: () => import('./study.js') },
  brief: { title: 'Brief per KI', sub: 'Anliegen beschreiben, fertigen Brief erhalten', load: () => import('./letter-ai.js') },
  bild: { title: 'Bild übersetzen', sub: 'Foto von Schild, Speisekarte oder Brief übersetzen', load: () => import('./image-ai.js') },
  plus: { title: 'FaLe Plus', sub: 'Mehr KI-Anfragen pro Tag', load: () => import('./hub.js').then(m => ({ mount: m.mountPlus })) },
  einstellungen: { title: 'KI-Einstellungen', sub: 'Cloud-KI, Einwilligung und Datenschutz', load: () => import('./hub.js').then(m => ({ mount: m.mountSettings })) },
};

export const AI_ROUTE = 'ki';

export async function openAiRoute(parts, params, { goBack }) {
  loadAiCss();
  const key = parts[1] || '';
  const conf = SCREENS[key];
  if (!conf) { location.replace('#/ki'); return; }
  const screen = openScreen({ title: conf.title, sub: conf.sub, onBack: () => (screen.onBackRequest ? screen.onBackRequest(goBack) : goBack()) });
  const cls = ['ai-screen', `ai-route-${key || 'hub'}`];
  screen.root.classList.add(...cls);
  screen.cleanup = () => screen.root.classList.remove(...cls);
  screen.hashKey = location.hash;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
  try {
    const mod = await conf.load();
    if (screen.signal.aborted) return;
    screen.body.innerHTML = '';
    const cleanup = await mod.mount(screen, { parts, params, goBack });
    screen.cleanup = () => { try { if (typeof cleanup === 'function') cleanup(); } finally { screen.root.classList.remove(...cls); } };
  } catch (e) {
    if (screen.signal.aborted) return;
    errorToast(e, 'Diese Ansicht konnte nicht geöffnet werden.');
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p>${esc(e && e.userMessage ? e.userMessage : 'Bitte versuche es erneut.')}</p></div></div>`;
  }
}
