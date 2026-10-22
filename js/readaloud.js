// Text-to-speech using the Web Speech API (runs on-device / via the OS voices).
import './speech-shim.js'; // Android app: speechSynthesis on top of the system voice – must exist before the check below
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export function getVoices() {
  if (!speechSupported) return [];
  const all = speechSynthesis.getVoices();
  const de = all.filter(v => /^de(-|_|$)/i.test(v.lang));
  const rest = all.filter(v => !/^de(-|_|$)/i.test(v.lang));
  return [...de, ...rest];
}

export function onVoicesChanged(fn) {
  if (!speechSupported) return () => {};
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}

function chunkText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…;:]+[.!?…;:]*\s*/g) || [clean];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 220 && cur) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > 260) {
      // very long sentence without punctuation: split at word boundaries
      const words = s.split(' ');
      for (const w of words) {
        if ((cur + ' ' + w).length > 220 && cur) { chunks.push(cur.trim()); cur = ''; }
        cur += (cur ? ' ' : '') + w;
      }
    } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export class ReadAloud {
  constructor({ numPages, getPageText, onPage, onState }) {
    this.numPages = numPages;
    this.getPageText = getPageText;
    this.onPage = onPage || (() => {});
    this.onState = onState || (() => {});
    this.rate = 1;
    this.voiceURI = null;
    this.page = 1;
    this.chunks = [];
    this.index = 0;
    this.state = 'stopped'; // playing | paused | stopped
    this.token = 0;
  }

  async start(page = 1) {
    if (!speechSupported) throw Object.assign(new Error('no tts'), { userMessage: 'Vorlesen wird von diesem Browser nicht unterstützt.' });
    this.cancelSpeech();
    this.page = page;
    this.state = 'playing';
    this.onState(this.state, this.page);
    await this.loadPage(page);
  }

  async loadPage(page) {
    const token = ++this.token;
    let p = page;
    while (p <= this.numPages) {
      const text = await this.getPageText(p);
      if (token !== this.token) return;
      const chunks = chunkText(text);
      if (chunks.length) {
        this.page = p;
        this.chunks = chunks;
        this.index = 0;
        this.onPage(p);
        this.onState(this.state, p);
        this.speak(token);
        return;
      }
      p++;
    }
    this.finish();
  }

  speak(token) {
    if (token !== this.token || this.state !== 'playing') return;
    if (this.index >= this.chunks.length) { this.loadPage(this.page + 1); return; }
    const u = new SpeechSynthesisUtterance(this.chunks[this.index]);
    const voice = getVoices().find(v => v.voiceURI === this.voiceURI) || getVoices().find(v => /^de/i.test(v.lang));
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'de-DE';
    u.rate = this.rate;
    u.onend = () => { if (token !== this.token) return; this.index++; this.speak(token); };
    u.onerror = e => {
      if (token !== this.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.index++;
      this.speak(token);
    };
    speechSynthesis.speak(u);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.cancelSpeech();
    this.onState(this.state, this.page);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.onState(this.state, this.page);
    this.speak(++this.token);
  }

  toggle() { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }

  setRate(r) {
    this.rate = r;
    if (this.state === 'playing') { this.cancelSpeech(); this.speak(++this.token); }
  }

  setVoice(uri) {
    this.voiceURI = uri;
    if (this.state === 'playing') { this.cancelSpeech(); this.speak(++this.token); }
  }

  stop() {
    this.cancelSpeech();
    this.state = 'stopped';
    this.onState(this.state, this.page);
  }

  finish() {
    this.state = 'stopped';
    this.onState('finished', this.page);
  }

  cancelSpeech() {
    this.token++;
    if (speechSupported) { try { speechSynthesis.cancel(); } catch {} }
  }
}
