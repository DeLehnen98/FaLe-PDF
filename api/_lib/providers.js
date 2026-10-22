'use strict';
// Provider adapters. Common interface:
//   complete({ task, system, user, maxTokens, stream, onDelta, signal }) → { text, usage: { input, output } }
// Selected by AI_PROVIDER: anthropic (default) | openai_compat | gemini | mock (tests only).
// Inputs are never logged.

class ProviderError extends Error {
  constructor(status, kind) { super(`provider ${kind || 'error'} ${status || ''}`.trim()); this.status = status; this.kind = kind || 'error'; }
}

async function* sseEvents(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(buf[i] === '\r' ? i + 4 : i + 2);
      let event = 'message';
      const data = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) yield { event, data: data.join('\n') };
    }
  }
}

function withTimeout(signal, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', () => ac.abort(), { once: true }); }
  return { signal: ac.signal, done: () => clearTimeout(t) };
}

async function post(url, headers, body, { signal, fetchImpl = fetch }) {
  let r;
  try {
    r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new ProviderError(0, signal && signal.aborted ? 'timeout' : 'network');
  }
  if (!r.ok) {
    // drain without logging the body (it might echo user input)
    try { await r.text(); } catch {}
    throw new ProviderError(r.status, r.status === 429 ? 'rate_limited' : r.status === 401 || r.status === 403 ? 'auth' : r.status >= 500 ? 'unavailable' : 'rejected');
  }
  return r;
}

// ------------------------------------------------------------------ Anthropic Messages API
function anthropic(cfg, deps = {}) {
  return {
    name: 'anthropic',
    async complete({ system, user, maxTokens, stream, onDelta, signal }) {
      const to = withTimeout(signal, cfg.providerTimeoutMs);
      try {
        const r = await post(`${cfg.anthropicBase}/v1/messages`, { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' }, {
          model: cfg.model, max_tokens: maxTokens, system, stream: !!stream,
          messages: [{ role: 'user', content: user }],
        }, { signal: to.signal, fetchImpl: deps.fetchImpl });
        if (!stream) {
          const j = await r.json();
          const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          return { text, usage: { input: (j.usage && j.usage.input_tokens) || 0, output: (j.usage && j.usage.output_tokens) || 0 }, stop: j.stop_reason };
        }
        let text = '', input = 0, output = 0, stop = null;
        for await (const ev of sseEvents(r.body)) {
          let d; try { d = JSON.parse(ev.data); } catch { continue; }
          if (d.type === 'message_start' && d.message && d.message.usage) { input = d.message.usage.input_tokens || 0; output = d.message.usage.output_tokens || 0; }
          else if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') { text += d.delta.text; onDelta && onDelta(d.delta.text); }
          else if (d.type === 'message_delta') { if (d.usage && d.usage.output_tokens != null) output = d.usage.output_tokens; if (d.delta && d.delta.stop_reason) stop = d.delta.stop_reason; }
          else if (d.type === 'error') throw new ProviderError(0, 'stream_error');
        }
        return { text, usage: { input, output }, stop };
      } finally { to.done(); }
    },
  };
}

// ------------------------------------------------------------------ OpenAI-compatible chat completions
function openaiCompat(cfg, deps = {}) {
  return {
    name: 'openai_compat',
    async complete({ system, user, maxTokens, stream, onDelta, signal }) {
      const to = withTimeout(signal, cfg.providerTimeoutMs);
      try {
        const body = { model: cfg.model, max_tokens: maxTokens, stream: !!stream, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
        if (stream) body.stream_options = { include_usage: true };
        const r = await post(`${cfg.openaiBase}/chat/completions`, { Authorization: `Bearer ${cfg.openaiKey}` }, body, { signal: to.signal, fetchImpl: deps.fetchImpl });
        if (!stream) {
          const j = await r.json();
          const c = j.choices && j.choices[0];
          return { text: (c && c.message && c.message.content) || '', usage: { input: (j.usage && j.usage.prompt_tokens) || 0, output: (j.usage && j.usage.completion_tokens) || 0 }, stop: c && c.finish_reason };
        }
        let text = '', input = 0, output = 0, stop = null;
        for await (const ev of sseEvents(r.body)) {
          if (ev.data === '[DONE]') break;
          let d; try { d = JSON.parse(ev.data); } catch { continue; }
          const c = d.choices && d.choices[0];
          const t = c && c.delta && c.delta.content;
          if (t) { text += t; onDelta && onDelta(t); }
          if (c && c.finish_reason) stop = c.finish_reason;
          if (d.usage) { input = d.usage.prompt_tokens || input; output = d.usage.completion_tokens || output; }
        }
        return { text, usage: { input, output }, stop };
      } finally { to.done(); }
    },
  };
}

// ------------------------------------------------------------------ Google Gemini API
function gemini(cfg, deps = {}) {
  return {
    name: 'gemini',
    async complete({ system, user, maxTokens, stream, onDelta, signal }) {
      const to = withTimeout(signal, cfg.providerTimeoutMs);
      try {
        const base = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(cfg.model);
        const url = stream ? `${base}:streamGenerateContent?alt=sse` : `${base}:generateContent`;
        const r = await post(url, { 'x-goog-api-key': cfg.geminiKey }, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }, { signal: to.signal, fetchImpl: deps.fetchImpl });
        const pickText = j => ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || '').join('');
        if (!stream) {
          const j = await r.json();
          const u = j.usageMetadata || {};
          return { text: pickText(j), usage: { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0 } };
        }
        let text = '', input = 0, output = 0;
        for await (const ev of sseEvents(r.body)) {
          let d; try { d = JSON.parse(ev.data); } catch { continue; }
          const t = pickText(d);
          if (t) { text += t; onDelta && onDelta(t); }
          if (d.usageMetadata) { input = d.usageMetadata.promptTokenCount || input; output = d.usageMetadata.candidatesTokenCount || output; }
        }
        return { text, usage: { input, output } };
      } finally { to.done(); }
    },
  };
}

// ------------------------------------------------------------------ mock (tests only)
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mockReply(task, user, system = '') {
  const inner = (user.match(/<(?:text|dokument)>\n([\s\S]*?)\n<\/(?:text|dokument)>/) || [])[1] || user;
  const firstWords = inner.replace(/\[(?:S\.|Folie|Blatt|Abschnitt) \d+\]\n/g, '').split(/\s+/).slice(0, 6).join(' ');
  switch (task) {
    case 'summarize': return `- Zusammenfassung (Test): ${firstWords}\n- Zweiter Punkt aus dem Dokument\n- Dritter Punkt`;
    case 'translate': return `[EN] ${inner}`;
    case 'image_translate': return `[DE] ${inner}`;
    case 'chat': {
      // cite the excerpt that shares most words with the question (deterministic for tests)
      const q = (user.match(/Frage: ([^\n]*)$/) || [])[1] || '';
      const words = new Set(q.toLowerCase().match(/[\p{L}\d]{4,}/gu) || []);
      const blocks = [...user.split('</dokument>')[0].matchAll(/\[(S\.|Folie|Blatt|Abschnitt) (\d+)\]\n([^[]*)/g)].map(m => ({ u: m[1], p: m[2], score: (m[3].toLowerCase().match(/[\p{L}\d]{4,}/gu) || []).filter(w => words.has(w)).length }));
      if (!blocks.length) return 'Dazu finde ich nichts im Dokument.';
      const best = blocks.slice().sort((a, b) => b.score - a.score)[0];
      const other = blocks.find(b => b !== best);
      const ghost = /geisterseite/i.test(q) ? ` Siehe auch [${best.u} 999].` : ''; // a page the app never sent (tests the check)
      return `Laut Dokument steht die Antwort zu „${q}“ hier [${best.u} ${best.p}].${other ? ` Mehr dazu [${other.u} ${other.p}].` : ''}${ghost}`;
    }
    case 'rewrite': return inner.replace(/\bsehr sehr\b/gi, 'sehr').replace(/\bFeler\b/g, 'Fehler').replace(/\bschlecht\b/g, 'ungünstig') + (/kürze/i.test(user) ? '' : ' Vielen Dank.');
    case 'explain': return `Erklärung (Test): „${firstWords}“ bedeutet in einfachen Worten etwas Wichtiges.`;
    case 'slides': {
      const topic = (user.match(/Thema: ([^\n]*)/) || [])[1] || 'Präsentation';
      return JSON.stringify({ title: topic, subtitle: 'Erstellt mit KI', slides: [
        { heading: 'Einführung', bullets: [{ text: `Worum geht es: ${topic}`, level: 0 }, { text: 'Ziele des Vortrags', level: 0 }, { text: 'Detail', level: 1 }], notes: 'Begrüßung' },
        { heading: 'Kernpunkte', bullets: [{ text: 'Erster Kernpunkt', level: 0 }, { text: 'Zweiter Kernpunkt', level: 0 }] },
        { heading: 'Fazit', bullets: [{ text: 'Zusammenfassung', level: 0 }, { text: 'Nächste Schritte', level: 0 }] },
      ] });
    }
    case 'formula': return '```json\n' + JSON.stringify({ formula: '=SUMME(B2:B10)', explanation: 'Addiert alle Werte von B2 bis B10.' }) + '\n```';
    case 'flashcards': return JSON.stringify({ cards: [
      { front: 'Was ist das Thema?', back: firstWords || 'Das Dokument' }, { front: 'Begriff A', back: 'Erklärung A' }, { front: 'Begriff B', back: 'Erklärung B' }] });
    case 'quiz': return JSON.stringify({ questions: [
      { question: 'Worum geht es im Text?', options: ['Um das Thema', 'Um Kochen', 'Um Fußball', 'Um Musik'], answer: 0, explanation: 'Steht im ersten Absatz.' },
      { question: 'Welche Aussage stimmt?', options: ['Falsch 1', 'Richtig', 'Falsch 2', 'Falsch 3'], answer: 1, explanation: 'Siehe Text.' },
      { question: 'Ungültige Frage', options: ['a', 'b'], answer: 3 }] });
    case 'letter_extract': {
      // deterministic for tests: picks the first IBAN and an amount from the text
      const ib = (inner.match(/\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b/) || [])[0];
      const am = (inner.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s?(?:€|EUR)/) || [])[1];
      return JSON.stringify({ type: /mahnung/i.test(inner) ? 'mahnung' : 'rechnung', sender: 'KI-Test Absender GmbH', summary: 'Test: Bitte bezahlen.', ...(ib ? { iban: ib } : {}), ...(am ? { amount: Number(am.replace(/\./g, '').replace(',', '.')) } : {}), due_date: '2030-01-31', due_label: 'Zahlung (KI)', customer_number: 'KI-4711', date: 'kein Datum' });
    }
    case 'form_help': {
      let d = {}; try { d = JSON.parse(inner); } catch {}
      const l = (system.match(/übersetzt auf ([^ (]+)/) || [])[1] || 'Deutsch';
      return JSON.stringify({ form_lang: 'de', fields: (d.fields || []).map(f => ({ id: f.id, term: `[${l}] ${f.label}`, explain: `Test-Erklärung zu „${f.label}“.`, kind: 'text' })) });
    }
    case 'form_answers': {
      let d = []; try { d = JSON.parse(inner); } catch {}
      return JSON.stringify({ items: (Array.isArray(d) ? d : []).map(x => ({ id: x.id, text: `[DE] ${x.text}` })) });
    }
    case 'letter': {
      const reply = (user.match(/<schreiben>\n([\s\S]*?)\n<\/schreiben>/) || [])[1];
      if (reply) { // deterministic reply: the Aktenzeichen of the letter + its sender as recipient
        const az = (reply.match(/Aktenzeichen:?\s*([\w/-]+)/i) || [])[1] || '[Aktenzeichen]';
        return JSON.stringify({ subject: `Ihr Schreiben – Aktenzeichen ${az}`, salutation: 'Sehr geehrte Damen und Herren,',
          paragraphs: [`vielen Dank für Ihr Schreiben (Aktenzeichen ${az}).`, `Mein Anliegen: ${firstWords}.`], closing: 'Mit freundlichen Grüßen',
          to_name: 'Stadtwerke Teststadt GmbH', to_street: 'Hauptstraße 1', to_city: '12345 Teststadt' });
      }
      return JSON.stringify({ subject: 'Kündigung meines Vertrags', salutation: 'Sehr geehrte Damen und Herren,',
        paragraphs: [`hiermit wende ich mich an Sie wegen: ${firstWords}.`, 'Bitte bestätigen Sie mir den Eingang dieses Schreibens bis zum [Datum].'], closing: 'Mit freundlichen Grüßen' });
    }
    case 'compare': {
      const a = (user.match(/<dokument_a[^>]*>\n([\s\S]*?)\n<\/dokument_a>/) || [])[1] || '';
      const b = (user.match(/<dokument_b[^>]*>\n([\s\S]*?)\n<\/dokument_b>/) || [])[1] || '';
      const price = t => (t.match(/(\d+,\d{2}) ?€/) || [])[1] || '?';
      return `## Das Wichtigste\nTest-Vergleich: Der Preis ändert sich.\n## Geändert\n- Preis: ${price(a)} € → ${price(b)} €\n## Neu dazugekommen\n- ${b.split(/\s+/).slice(0, 4).join(' ')}`;
    }
    default: return 'OK';
  }
}

function mock() {
  return {
    name: 'mock',
    async complete({ task, system, user, maxTokens, stream, onDelta, signal }) {
      if (user.includes('[[mock:error]]')) throw new ProviderError(503, 'unavailable');
      if (user.includes('[[mock:slow]]')) await sleep(1500);
      let text = user.includes('[[mock:badjson]]') ? 'Das ist leider kein JSON.' : mockReply(task, user, system || '');
      text = text.slice(0, maxTokens * 4);
      if (stream) {
        const parts = text.match(/\S+\s*/g) || [text];
        for (const [i, p] of parts.entries()) {
          if (signal && signal.aborted) break;
          onDelta && onDelta(p);
          await sleep(i === 2 && user.includes('[[mock:stall]]') ? 6000 : 4); // a stream that goes quiet (client watchdog test)
        }
      }
      return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) } };
    },
  };
}

function getProvider(cfg, deps) {
  switch (cfg.provider) {
    case 'anthropic': return anthropic(cfg, deps);
    case 'openai_compat': return openaiCompat(cfg, deps);
    case 'gemini': return gemini(cfg, deps);
    case 'mock': return mock();
    default: throw new ProviderError(0, 'not_configured');
  }
}

module.exports = { getProvider, ProviderError, sseEvents };
