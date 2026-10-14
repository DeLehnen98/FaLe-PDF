// „Lernkarten & Quiz“: the AI turns a document into flashcards or a multiple-choice quiz.
// Decks are stored only on this device (IndexedDB settings) and reviewed with a simple
// Leitner-style spaced repetition (boxes 1–5).
import { $, $$, h, esc, toast, confirmDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as db from '../db.js';
import * as C from './client.js';
import { statusCard, docChip, getDoc, gate, docPicker } from './common.js';
import { ensureCloud, showAiError, progressNote } from './ui.js';
import { docText } from './doctext.js';
import { AI_CONFIG } from './config.js';

const KEY = 'aiDecks';
const DAY = 86400000;
export const INTERVALS = [0, 1, 3, 7, 16, 35]; // days per box (index = box)

export async function listDecks() { const d = await db.getSetting(KEY, []); return Array.isArray(d) ? d : []; }
async function saveDecks(d) { await db.setSetting(KEY, d); }
export async function getDeck(id) { return (await listDecks()).find(d => d.id === id) || null; }
async function putDeck(deck) { const all = (await listDecks()).filter(d => d.id !== deck.id); all.unshift(deck); await saveDecks(all.slice(0, 100)); }
async function deleteDeck(id) { await saveDecks((await listDecks()).filter(d => d.id !== id)); }

/** Spaced repetition step. grade: 'again' | 'hard' | 'good'. */
export function schedule(card, grade, now = Date.now()) {
  const box = card.box || 1;
  if (grade === 'again') return { ...card, box: 1, due: now + 10 * 60000, seen: (card.seen || 0) + 1 };
  if (grade === 'hard') return { ...card, box, due: now + Math.max(1, INTERVALS[box] / 2) * DAY, seen: (card.seen || 0) + 1 };
  const nb = Math.min(5, box + 1);
  return { ...card, box: nb, due: now + INTERVALS[nb] * DAY, seen: (card.seen || 0) + 1 };
}
export const dueCards = (deck, now = Date.now()) => (deck.cards || []).filter(c => !c.due || c.due <= now);

export async function mount(screen, { params }) {
  const deckId = params.get('deck');
  if (deckId) return params.get('modus') === 'quiz' ? quizScreen(screen, deckId) : reviewScreen(screen, deckId);
  return generator(screen, await getDoc(params.get('doc')));
}

// ---------------------------------------------------------------- generator + deck list
async function generator(screen, doc) {
  let go = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => gate([go], s) });
  const wrap = h(`<div class="screen-inner ai-study">
    <div data-status></div>
    <div class="card card-pad ai-options">
      <div class="field"><span class="field-label">Aus welchem Dokument?</span><div data-docbox></div></div>
      <div class="field-row">
        <div class="field"><span class="field-label">Was erstellen?</span><div class="seg" role="group" aria-label="Art"><button type="button" data-kind="flashcards" aria-pressed="true">${oicon('bookOpen')} Lernkarten</button><button type="button" data-kind="quiz" aria-pressed="false">${oicon('checkCircle')} Quiz</button></div></div>
        <label class="field"><span class="field-label">Anzahl</span><select class="select" name="count">${[5, 8, 10, 12, 15, 20].map(n => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
    </div>
    <p class="ai-prep muted small" data-prep hidden></p>
    <h2 class="section-title">Deine Lernsets <span class="muted small">nur auf diesem Gerät</span></h2>
    <div class="ai-decks" data-decks></div>
  </div>`);
  $('[data-status]', wrap).appendChild(st.el);
  const docBox = $('[data-docbox]', wrap), prep = $('[data-prep]', wrap);
  let kind = 'flashcards';
  $$('[data-kind]', wrap).forEach(b => b.addEventListener('click', () => { kind = b.dataset.kind; $$('[data-kind]', wrap).forEach(x => x.setAttribute('aria-pressed', String(x === b))); go.innerHTML = `${oicon('sparkle')} ${kind === 'quiz' ? 'Quiz erstellen' : 'Lernkarten erstellen'}`; }));
  const renderDoc = async () => {
    docBox.innerHTML = '';
    if (doc) docBox.appendChild(docChip(doc, () => { doc = null; renderDoc(); }));
    else docBox.appendChild(await docPicker({ title: '', onPick: d => { doc = d; renderDoc(); } }));
  };
  await renderDoc();
  screen.body.appendChild(wrap);
  go = h(`<button class="btn btn-primary" type="button" data-go>${oicon('sparkle')} Lernkarten erstellen</button>`);
  screen.setFoot([go]);
  gate([go], st.state());

  async function renderDecks() {
    const box = $('[data-decks]', wrap);
    const decks = await listDecks();
    box.innerHTML = '';
    if (!decks.length) { box.appendChild(h('<p class="panel-empty">Noch keine Lernsets. Wähle oben ein Dokument und erstelle Lernkarten oder ein Quiz.</p>')); return; }
    decks.forEach(d => {
      const due = dueCards(d).length;
      const el = h(`<div class="card ai-deck" data-deck="${esc(d.id)}"><span class="tile-ic ai-ic">${oicon(d.cards && d.cards.length ? 'bookOpen' : 'checkCircle')}</span>
        <div class="ai-deck-txt"><strong data-no-i18n>${esc(d.title)}</strong><span class="muted small">${d.cards && d.cards.length ? `${d.cards.length} Karten · ${due ? `${due} fällig` : 'nichts fällig'}` : ''}${d.quiz && d.quiz.length ? `${d.cards && d.cards.length ? ' · ' : ''}${d.quiz.length} Quizfragen` : ''}</span></div>
        <div class="ai-deck-acts">${d.cards && d.cards.length ? `<a class="btn btn-soft btn-sm" href="#/ki/lernkarten?deck=${encodeURIComponent(d.id)}">Lernen</a>` : ''}${d.quiz && d.quiz.length ? `<a class="btn btn-ghost btn-sm" href="#/ki/lernkarten?deck=${encodeURIComponent(d.id)}&modus=quiz">Quiz</a>` : ''}
        <button class="icon-btn" type="button" data-del aria-label="Lernset löschen">${oicon('trash')}</button></div></div>`);
      $('[data-del]', el).addEventListener('click', async () => { if (await confirmDialog('Lernset löschen?', `„${d.title}“ wird von diesem Gerät entfernt.`, { okLabel: 'Löschen', danger: true })) { await deleteDeck(d.id); renderDecks(); } });
      box.appendChild(el);
    });
  }
  renderDecks();

  go.addEventListener('click', async () => {
    if (!doc) { toast('Bitte wähle zuerst ein Dokument.', 'error'); return; }
    if (!await ensureCloud()) return;
    go.disabled = true;
    try {
      prep.hidden = false;
      const t = await docText(doc, { signal: screen.signal, onProgress: (p, l) => progressNote(prep, l) });
      progressNote(prep, kind === 'quiz' ? 'Die KI erstellt das Quiz …' : 'Die KI erstellt die Lernkarten …');
      const r = await C.runTask(kind, { text: t.text.slice(0, AI_CONFIG.MAX_STUDY_CHARS) }, { count: +$('[name=count]', wrap).value });
      const now = Date.now();
      const title = doc.name.replace(/\.[^.]+$/, '');
      const existing = (await listDecks()).find(d => d.docId === doc.id);
      const deck = existing || { id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 6), title, docId: doc.id, createdAt: now, cards: [], quiz: [] };
      if (kind === 'quiz') deck.quiz = r.output.questions;
      else deck.cards = [...(deck.cards || []), ...r.output.cards.map((c, i) => ({ id: now.toString(36) + i, front: c.front, back: c.back, box: 1, due: now }))];
      deck.updatedAt = now;
      await putDeck(deck);
      if (t.text.length > AI_CONFIG.MAX_STUDY_CHARS || r.truncated) toast('Das Dokument ist lang – verwendet wurde der Anfang.', 'info', { timeout: 5000 });
      location.hash = `#/ki/lernkarten?deck=${encodeURIComponent(deck.id)}${kind === 'quiz' ? '&modus=quiz' : ''}`;
    } catch (e) { showAiError(e); }
    finally { go.disabled = false; progressNote(prep, ''); }
  });
  return () => st.el._dispose && st.el._dispose();
}

// ---------------------------------------------------------------- review
async function reviewScreen(screen, id) {
  let deck = await getDeck(id);
  if (!deck || !deck.cards || !deck.cards.length) { location.replace('#/ki/lernkarten'); return; }
  screen.setTitle('Lernkarten', deck.title);
  const wrap = h(`<div class="screen-inner ai-review"><div class="ai-review-top"><span class="muted small" data-progress></span><span class="ai-boxes" data-boxes></span></div><div data-stage></div></div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const stage = $('[data-stage]', wrap);
  let queue = dueCards(deck).sort((a, b) => (a.box || 1) - (b.box || 1));
  let done = 0, practiceAll = false;
  const boxes = () => { $('[data-boxes]', wrap).innerHTML = [1, 2, 3, 4, 5].map(b => `<span title="Fach ${b}">${b}:${deck.cards.filter(c => (c.box || 1) === b).length}</span>`).join(''); };
  boxes();
  const next = () => {
    $('[data-progress]', wrap).textContent = queue.length ? `${done + 1} von ${done + queue.length}${practiceAll ? ' (Übungsrunde)' : ' fällig'}` : '';
    if (!queue.length) {
      const nextDue = Math.min(...deck.cards.map(c => c.due || 0));
      stage.innerHTML = `<div class="card card-pad ai-review-done">${oicon('checkCircle')}<h3>Alles gelernt für heute!</h3>
        <p class="muted">Nächste Wiederholung: ${nextDue > Date.now() ? new Date(nextDue).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }) : 'jetzt'}.</p>
        <div class="ai-res-acts"><button class="btn btn-soft" type="button" data-all>Trotzdem alle üben</button>${deck.quiz && deck.quiz.length ? `<a class="btn btn-ghost" href="#/ki/lernkarten?deck=${encodeURIComponent(deck.id)}&modus=quiz">Quiz starten</a>` : ''}<a class="btn btn-ghost" href="#/ki/lernkarten">Zur Übersicht</a></div></div>`;
      $('[data-all]', stage).addEventListener('click', () => { practiceAll = true; queue = [...deck.cards]; done = 0; next(); });
      return;
    }
    const card = queue[0];
    stage.innerHTML = `<div class="ai-card" data-flip="0" tabindex="0" role="button" aria-label="Karte umdrehen">
        <div class="ai-card-face front"><span class="ai-card-tag">Frage · Fach ${card.box || 1}</span><p data-no-i18n>${esc(card.front)}</p></div>
        <div class="ai-card-face back" hidden><span class="ai-card-tag">Antwort</span><p data-no-i18n>${esc(card.back)}</p></div></div>
      <div class="ai-grade" hidden><button class="btn btn-ghost" type="button" data-g="again">Nochmal</button><button class="btn btn-soft" type="button" data-g="hard">Schwer</button><button class="btn btn-primary" type="button" data-g="good">Gewusst</button></div>
      <button class="btn btn-primary ai-show" type="button" data-show>Antwort zeigen</button>`;
    const flip = () => { $('.front', stage).hidden = true; $('.back', stage).hidden = false; $('[data-show]', stage).hidden = true; $('.ai-grade', stage).hidden = false; };
    $('.ai-card', stage).addEventListener('click', flip);
    $('.ai-card', stage).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    $('[data-show]', stage).addEventListener('click', flip);
    $$('[data-g]', stage).forEach(b => b.addEventListener('click', async () => {
      const g = b.dataset.g;
      const upd = practiceAll ? { ...card, seen: (card.seen || 0) + 1 } : schedule(card, g);
      deck.cards = deck.cards.map(c => (c.id === card.id ? upd : c));
      await putDeck(deck);
      queue.shift();
      if (g === 'again') queue.push(upd);
      else done++;
      boxes();
      next();
    }));
  };
  next();
}

// ---------------------------------------------------------------- quiz
async function quizScreen(screen, id) {
  const deck = await getDeck(id);
  if (!deck || !deck.quiz || !deck.quiz.length) { location.replace('#/ki/lernkarten'); return; }
  screen.setTitle('Quiz', deck.title);
  const wrap = h('<div class="screen-inner ai-quiz"><div data-stage></div></div>');
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const stage = $('[data-stage]', wrap);
  let i = 0, score = 0;
  const show = () => {
    if (i >= deck.quiz.length) {
      const pct = Math.round(score / deck.quiz.length * 100);
      stage.innerHTML = `<div class="card card-pad ai-review-done">${oicon(pct >= 70 ? 'checkCircle' : 'bookOpen')}<h3>${score} von ${deck.quiz.length} richtig</h3><p class="muted">${pct >= 90 ? 'Hervorragend!' : pct >= 70 ? 'Gut gemacht!' : 'Weiter üben – das wird!'}</p>
        <div class="ai-res-acts"><button class="btn btn-soft" type="button" data-again>Nochmal</button>${deck.cards && deck.cards.length ? `<a class="btn btn-ghost" href="#/ki/lernkarten?deck=${encodeURIComponent(deck.id)}">Lernkarten</a>` : ''}<a class="btn btn-ghost" href="#/ki/lernkarten">Zur Übersicht</a></div></div>`;
      $('[data-again]', stage).addEventListener('click', () => { i = 0; score = 0; show(); });
      return;
    }
    const q = deck.quiz[i];
    stage.innerHTML = `<div class="card card-pad ai-q"><span class="muted small">Frage ${i + 1} von ${deck.quiz.length}</span><h3 data-no-i18n>${esc(q.question)}</h3>
      <div class="ai-opts">${q.options.map((o, k) => `<button class="ai-opt" type="button" data-k="${k}"><span class="ai-opt-l">${'ABCDE'[k]}</span><span data-no-i18n>${esc(o)}</span></button>`).join('')}</div>
      <div class="ai-expl" hidden></div></div>`;
    $$('.ai-opt', stage).forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k;
      const right = k === q.answer;
      if (right) score++;
      $$('.ai-opt', stage).forEach(x => { x.disabled = true; const kk = +x.dataset.k; x.classList.toggle('right', kk === q.answer); x.classList.toggle('wrong', kk === k && !right); });
      const ex = $('.ai-expl', stage);
      ex.hidden = false;
      ex.innerHTML = `<p><strong>${right ? 'Richtig!' : 'Leider falsch.'}</strong> <span data-no-i18n>${esc(q.explanation || '')}</span></p><button class="btn btn-primary btn-sm" type="button" data-next>${i + 1 < deck.quiz.length ? 'Weiter' : 'Ergebnis'}</button>`;
      $('[data-next]', ex).addEventListener('click', () => { i++; show(); });
      $('[data-next]', ex).focus();
    }));
  };
  show();
}
