// „Chat mit Dokument“: local chunking + BM25 retrieval, only the best passages (with page numbers)
// go to the cloud AI. Answers cite pages ([S. 3]) – a tap opens the document at that page.
import { $, h, esc } from '../ui.js';
import { oicon, kindOf, openHash } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, docPicker, docChip, getDoc, gate } from './common.js';
import { ensureCloud, showAiError, richText, copyText, progressNote } from './ui.js';
import { docPages } from './doctext.js';
import { makeChunks, buildIndex, selectContext } from './retrieval.js';
import { AI_CONFIG, outputLang } from './config.js';
import { canSpeak, speakText } from './speak.js';

const SUGGEST = ['Worum geht es in diesem Dokument?', 'Welche Fristen, Termine oder Beträge werden genannt?', 'Was muss ich jetzt tun?'];
// follow-ups offered under each answer (the ones not asked yet) – one tap instead of typing
const MORE = ['Erkläre das in einfachen Worten.', 'Muss ich etwas bezahlen – und bis wann?', 'Kann ich widersprechen? Bis wann?', 'Welche Unterlagen werden verlangt?', 'Wen kann ich bei Fragen kontaktieren?', 'Was passiert, wenn ich nichts tue?'];
const STOP = new Set('aber alle auch dass dein deine diese dieser dieses durch eine einem einen einer eines etwas haben habe kann können muss müssen nach nicht noch oder sind soll sollen über unter warum was welche welcher welches wenn werden wird wie wieso wo zum zur bitte gibt steht dokument'.split(' '));
/** One word of the question that also appears on the cited page – the viewer highlights it there. */
function markWord(question, text) {
  const t = String(text || '').toLowerCase();
  const words = String(question || '').toLowerCase().match(/[\p{L}\d][\p{L}\d-]{3,}/gu) || [];
  return words.filter(w => !STOP.has(w) && t.includes(w)).sort((a, b) => b.length - a.length)[0] || '';
}

export async function mount(screen, { params }) {
  const doc = await getDoc(params.get('doc'));
  if (!doc) {
    const st = statusCard();
    const wrap = h('<div class="screen-inner ai-chat-pick"></div>');
    wrap.appendChild(st.el);
    wrap.appendChild(await docPicker({ title: 'Mit welchem Dokument möchtest du chatten?', hint: 'Nur die passendsten Textstellen deiner Frage werden an die KI gesendet.', onPick: d => location.replace(`#/ki/chat?doc=${encodeURIComponent(d.id)}`) }));
    screen.body.appendChild(wrap);
    screen.setFoot([]);
    return () => st.el._dispose && st.el._dispose();
  }

  screen.setTitle('Chat mit Dokument', doc.name);
  let sendBtn = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => gate([sendBtn], s) });
  const wrap = h(`<div class="screen-inner ai-chat">
    <div data-top></div>
    <div class="ai-msgs" data-msgs role="log" aria-live="polite" aria-label="Unterhaltung">
      <div class="ai-msg ai-msg-intro"><span class="ai-avatar">${oicon('sparkle')}</span><div class="ai-bubble"><p>Frag mich etwas zu diesem Dokument. Ich antworte mit Seitenangaben – tippe darauf, um die Stelle zu öffnen.</p>
        <div class="ai-suggest">${SUGGEST.map(s => `<button class="lt-chip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div></div>
    </div>
    <p class="ai-prep muted small" data-prep hidden></p>
  </div>`);
  const top = $('[data-top]', wrap);
  top.appendChild(st.el);
  top.appendChild(docChip(doc, () => { location.hash = '#/ki/chat'; }));
  const msgs = $('[data-msgs]', wrap), prep = $('[data-prep]', wrap);
  screen.body.appendChild(wrap);

  const composer = h(`<form class="ai-composer" autocomplete="off">
    <label class="sr-only" for="ai-q">Deine Frage</label>
    <textarea class="input" id="ai-q" rows="1" maxlength="1000" placeholder="Frage zum Dokument …" enterkeyhint="send"></textarea>
    <button class="btn btn-primary" type="submit" data-send aria-label="Senden">${oicon('arrowUp')}<span class="hide-sm">Senden</span></button></form>`);
  const ta = $('textarea', composer);
  sendBtn = $('[data-send]', composer);
  screen.setFoot([composer]);
  screen.foot.classList.add('ai-foot');
  gate([sendBtn], st.state());
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); } });

  let index = null, unit = 'S.', busy = false, ac = null;
  const history = [];
  const asked = new Set();
  const kind = kindOf(doc);

  async function ensureIndex() {
    if (index) return index;
    prep.hidden = false;
    progressNote(prep, 'Dokument wird vorbereitet …');
    try {
      const r = await docPages(doc, { signal: screen.signal, onProgress: (p, label) => progressNote(prep, `${label} ${p ? Math.round(p * 100) + ' %' : ''}`) });
      unit = r.unit;
      index = buildIndex(makeChunks(r.pages));
      progressNote(prep, '');
      if (r.ocr) { prep.hidden = false; prep.textContent = 'Text wurde per Texterkennung (OCR) auf deinem Gerät gelesen – kleine Erkennungsfehler sind möglich.'; }
      return index;
    } catch (e) { progressNote(prep, ''); throw e; }
  }

  function openCite(page, question) {
    const onPage = index ? index.chunks.filter(c => c.page === page).map(c => c.text).join(' ') : '';
    const word = markWord(question, onPage);
    if (kind === 'pdf') { location.hash = `#/ansicht/${doc.id}?seite=${page}${word ? `&q=${encodeURIComponent(word)}` : ''}`; return; }
    const q = word || (onPage ? onPage.split(/\s+/).slice(0, 4).join(' ') : '');
    location.hash = `${openHash(doc)}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  }
  msgs.addEventListener('click', e => {
    const c = e.target.closest('.ai-cite');
    if (c) { const m = c.closest('.ai-msg'); openCite(parseInt(c.dataset.page, 10), m ? m.dataset.question : ''); return; }
    const s = e.target.closest('[data-q]');
    if (s) { ta.value = s.dataset.q; composer.requestSubmit(); }
    const cp = e.target.closest('[data-copy]');
    if (cp) copyText(cp.closest('.ai-msg').querySelector('.ai-answer').innerText);
  });

  composer.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) { if (ac) ac.abort(); return; }
    const q = ta.value.trim();
    if (q.length < 2) { ta.focus(); return; }
    if (!await ensureCloud()) return;
    busy = true;
    sendBtn.innerHTML = `${oicon('stop')}<span class="hide-sm">Stopp</span>`;
    sendBtn.setAttribute('aria-label', 'Antwort abbrechen');
    ta.value = ''; ta.style.height = 'auto';
    msgs.querySelectorAll('.ai-more').forEach(x => x.remove()); // old follow-up chips go away
    asked.add(q);
    msgs.appendChild(h(`<div class="ai-msg ai-msg-user"><div class="ai-bubble" data-no-i18n>${esc(q)}</div></div>`));
    const bot = h(`<div class="ai-msg"><span class="ai-avatar">${oicon('sparkle')}</span><div class="ai-bubble"><div class="ai-answer" data-no-i18n><span class="ai-typing" aria-label="KI schreibt"><i></i><i></i><i></i></span></div><div class="ai-msg-foot" hidden></div></div></div>`);
    msgs.appendChild(bot);
    bot.scrollIntoView({ block: 'end', behavior: 'smooth' });
    const ans = $('.ai-answer', bot), foot = $('.ai-msg-foot', bot);
    bot.dataset.question = q;
    ac = new AbortController();
    try {
      const idx = await ensureIndex();
      const ctx = selectContext(idx, q + ' ' + (history.length ? history[history.length - 1].q : ''), { k: 8, maxChars: AI_CONFIG.MAX_CHAT_CONTEXT });
      let shown = '';
      const sent = new Set(ctx.map(c => c.page));
      const r = await C.runTask('chat', { question: q, title: doc.name, unit, chunks: ctx.map(c => ({ page: c.page, text: c.text })), history: history.slice(-3) }, {}, {
        stream: true, signal: ac.signal,
        onDelta: (t, full) => { shown = full; ans.innerHTML = richText(full, { pages: sent }); },
      });
      const text = r.output || shown;
      ans.innerHTML = richText(text, { pages: sent });
      history.push({ q, a: text });
      const pages = [...new Set(ctx.map(c => c.page))];
      foot.hidden = false;
      foot.innerHTML = `<details><summary>${oicon('file')} ${pages.length} Textstelle${pages.length === 1 ? '' : 'n'} verwendet</summary><div class="ai-src">${pages.map(p => `<button type="button" class="ai-cite" data-page="${p}">${esc(unit)} ${p}</button>`).join(' ')}</div></details>
        <button class="icon-btn" type="button" data-say aria-label="Antwort vorlesen"></button>
        <button class="icon-btn" type="button" data-copy aria-label="Antwort kopieren">${oicon('copy')}</button>`;
      const say = $('[data-say]', foot);
      if (canSpeak()) {
        say.innerHTML = oicon('speaker');
        let hd = null;
        say.addEventListener('click', () => {
          if (hd) { hd.stop(); return; }
          say.innerHTML = oicon('stop'); say.setAttribute('aria-label', 'Vorlesen beenden');
          hd = speakText(text, { lang: outputLang(), onEnd: () => { hd = null; say.innerHTML = oicon('speaker'); say.setAttribute('aria-label', 'Antwort vorlesen'); } });
        });
      } else say.remove();
      // honest about sources: no page given, or a page the AI never saw → say so
      const good = ans.querySelectorAll('.ai-cite').length, odd = ans.querySelectorAll('.ai-cite-x').length;
      if (odd) foot.insertAdjacentHTML('afterbegin', '<p class="ai-warn" data-cite-warn>Eine Seitenangabe passt nicht zu den gesendeten Textstellen (mit „?“ markiert) – bitte im Dokument nachsehen.</p>');
      else if (!good && text.length > 120) foot.insertAdjacentHTML('afterbegin', '<p class="ai-note muted small" data-cite-warn>Ohne Seitenangabe – prüfe Wichtiges bitte im Dokument.</p>');
      if (r.partial) foot.insertAdjacentHTML('afterbegin', `<p class="ai-warn">${esc(r.partialMessage)}</p>`);
      const more = [...SUGGEST, ...MORE].filter(x => !asked.has(x)).slice(0, 3);
      if (more.length) $('.ai-bubble', bot).appendChild(h(`<div class="ai-suggest ai-more" aria-label="Weitere Fragen">${more.map(x => `<button class="lt-chip" type="button" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>`));
    } catch (err) {
      if (err && err.name === 'AbortError') { ans.insertAdjacentHTML('beforeend', '<p class="muted small">Abgebrochen.</p>'); const t = ans.querySelector('.ai-typing'); if (t) t.remove(); }
      else { bot.remove(); showAiError(err); }
    } finally {
      busy = false; ac = null;
      sendBtn.innerHTML = `${oicon('arrowUp')}<span class="hide-sm">Senden</span>`;
      sendBtn.setAttribute('aria-label', 'Senden');
      bot.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  });
  setTimeout(() => { if (!matchMedia('(max-width: 720px)').matches) ta.focus(); }, 80);
  return () => { if (ac) ac.abort(); st.el._dispose && st.el._dispose(); };
}
