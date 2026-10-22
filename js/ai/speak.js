// „Vorlesen“ for KI results (answers, summaries, translations, explanations): the device's own voice, offline and
// free – nothing is sent anywhere. In the Android app speechSynthesis comes from js/speech-shim.js.
const REGION = { en: 'en-GB', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', hi: 'hi-IN', uk: 'uk-UA', pt: 'pt-PT', id: 'id-ID' };
let current = null;
let hooked = false;

export const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';

/** Text as it should sound: no Markdown marks, no page references like [S. 3]. */
export function speakable(text) {
  return String(text || '')
    .replace(/\[(?:S\.|Seite|Folie|Blatt|Abschnitt)\s*[\d\s,–\-und]+\]/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function pieces(text) {
  const out = [];
  for (const para of speakable(text).split(/\n+/)) {
    const sentences = para.match(/[^.!?…;:]+[.!?…;:]*\s*/g) || [para];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > 220 && cur) { out.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.filter(Boolean);
}

export function stopSpeaking() { if (current) current.stop(); }

/** Speak `text` (stops anything spoken before). Returns a handle {stop()}; onEnd runs once when done or stopped. */
export function speakText(text, { lang = '', onEnd = null } = {}) {
  stopSpeaking();
  const parts = pieces(text);
  const synth = canSpeak() ? window.speechSynthesis : null;
  let i = 0, over = false;
  const handle = {
    stop() { if (over) return; over = true; try { synth && synth.cancel(); } catch { /* nothing to stop */ } finish(); },
  };
  function finish() { if (current === handle) current = null; over = true; if (onEnd) { const f = onEnd; onEnd = null; try { f(); } catch { /* UI gone */ } } }
  if (!synth || !parts.length) { finish(); return handle; }
  const want = (lang || document.documentElement.lang || 'de').toLowerCase();
  const voices = (() => { try { return synth.getVoices() || []; } catch { return []; } })();
  const voice = voices.find(v => (v.lang || '').toLowerCase() === want) || voices.find(v => (v.lang || '').toLowerCase().startsWith(want.slice(0, 2)));
  const next = () => {
    if (over) return;
    if (i >= parts.length) { finish(); return; }
    const u = new window.SpeechSynthesisUtterance(parts[i++]);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = want.length === 2 ? (REGION[want] || `${want}-${want.toUpperCase()}`) : want;
    u.rate = 0.95; // a little calmer than the default
    u.onend = next;
    u.onerror = e => { if (e && (e.error === 'canceled' || e.error === 'interrupted')) return; finish(); };
    try { synth.speak(u); } catch { finish(); }
  };
  current = handle;
  if (!hooked) { hooked = true; window.addEventListener('hashchange', stopSpeaking); window.addEventListener('pagehide', stopSpeaking); }
  try { synth.cancel(); } catch { /* fresh start */ }
  next();
  return handle;
}

/** A „Vorlesen“ button that toggles to „Stopp“ while speaking. getText() is read on every press. */
export function bindSpeakButton(btn, getText, { lang = () => '', icons } = {}) {
  if (!canSpeak()) { btn.hidden = true; return; }
  let h = null;
  const set = on => {
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = on ? `${icons.stop} <span>Stopp</span>` : `${icons.speak} <span>Vorlesen</span>`;
  };
  set(false);
  btn.addEventListener('click', () => {
    if (h) { h.stop(); h = null; set(false); return; }
    const text = getText();
    if (!text) return;
    set(true);
    h = speakText(text, { lang: typeof lang === 'function' ? lang() : lang, onEnd: () => { h = null; if (btn.isConnected) set(false); } });
  });
}
