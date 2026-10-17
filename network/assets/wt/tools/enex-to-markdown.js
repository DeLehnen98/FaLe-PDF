// Tool: ENEX note exports → Markdown files in a ZIP (one folder per notebook/export, attachments next to
// the notes, optional YAML header with dates and tags, an index file). Opens in any Markdown editor and
// in plain text editors – no account, no subscription. Everything runs in the browser.
import { parseEnex, enmlToMarkdown, frontMatter, safeName, uniqueName, resourceFileName, linkPath } from '../lib/enex.js';

const tr = (lang, de, en) => (lang === 'de' ? de : en);
const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });

function decode(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const enc = (/encoding=["']([\w-]+)["']/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(enc.toLowerCase()).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

export default {
  options: [
    {
      id: 'header', type: 'toggle', default: true,
      label: { de: 'Datum und Schlagwörter oben in jede Notiz schreiben', en: 'Write dates and tags at the top of each note' },
      hint: { de: 'Als kurzer YAML-Kopf – viele Notiz-Apps lesen ihn automatisch ein.', en: 'As a short YAML header – many note apps read it automatically.' },
    },
  ],

  async run(inputs, opts, ctx) {
    const L = ctx.lang;
    const files = [];
    const usedTop = new Set();
    let notesTotal = 0, attTotal = 0, missingTotal = 0;
    const index = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i / inputs.length, { de: `Datei ${i + 1} von ${inputs.length} wird gelesen …`, en: `Reading file ${i + 1} of ${inputs.length} …` });
      await ctx.tick();
      const bytes = await input.bytes();
      let notes;
      try { notes = parseEnex(decode(bytes)); } catch (err) {
        if (err.userMessage) throw userError(`${input.name}: ${err.userMessage.de}`, `${input.name}: ${err.userMessage.en}`);
        throw err;
      }
      if (!notes.length) throw userError(`${input.name} enthält keine Notizen.`, `${input.name} contains no notes.`);
      const folder = uniqueName(safeName(input.name.replace(/\.enex$/i, ''), 60), usedTop);
      const usedNotes = new Set(), usedAtt = new Set();
      index.push(`## ${folder}`, '');
      for (const [k, note] of notes.entries()) {
        if (k % 20 === 0) {
          ctx.progress((i + k / notes.length) / inputs.length, { de: `${folder}: Notiz ${k + 1} von ${notes.length}`, en: `${folder}: note ${k + 1} of ${notes.length}` });
          await ctx.tick();
        }
        const links = new Map();
        for (const r of note.resources) {
          if (links.has(r.hash)) continue;
          const name = uniqueName(resourceFileName(r), usedAtt);
          const att = tr(L, 'Anhänge', 'Attachments');
          files.push({ name: `${folder}/${att}/${name}`, data: r.bytes });
          links.set(r.hash, `${att}/${name}`);
          attTotal++;
        }
        const referenced = new Set([...note.enml.matchAll(/hash=["']([0-9a-f]{32})["']/gi)].map(m => m[1].toLowerCase()));
        const spare = note.resources.filter(r => !referenced.has(r.hash)).map(r => ({ mime: r.mime, path: links.get(r.hash) }));
        const { markdown, missing } = enmlToMarkdown(note.enml, links, spare);
        missingTotal += missing;
        const fileName = uniqueName(safeName(note.title) + '.md', usedNotes);
        // the title as heading – unless the note already starts with that heading
        const startsWithTitle = markdown.trimStart().replace(/^#+\s+/, '').split('\n')[0].trim() === note.title.trim() && /^\s*#/.test(markdown);
        const text = (opts.header ? frontMatter(note) : '') + (startsWithTitle ? '' : `# ${note.title}\n\n`) + markdown;
        files.push({ name: `${folder}/${fileName}`, data: new TextEncoder().encode(text) });
        index.push(`- [${note.title.replace(/[[\]]/g, '')}](${linkPath(`${folder}/${fileName}`)})`);
        notesTotal++;
      }
      index.push('');
    }
    await ctx.tick();
    ctx.progress(0.95, { de: 'ZIP wird gepackt …', en: 'Packing the ZIP …' });
    const title = tr(L, 'Inhaltsverzeichnis', 'Contents');
    files.unshift({ name: `${title}.md`, data: new TextEncoder().encode(`# ${title}\n\n${index.join('\n')}\n`) });
    const { createZip } = await import('../lib/shared/zip.js');
    const zip = await createZip(files);
    if (missingTotal) ctx.note({ de: `${missingTotal} eingebettete ${missingTotal === 1 ? 'Datei fehlte' : 'Dateien fehlten'} schon im Export – ${missingTotal === 1 ? 'sie ist' : 'sie sind'} in den Notizen weggelassen.`, en: `${missingTotal} embedded ${missingTotal === 1 ? 'file was' : 'files were'} already missing from the export and ${missingTotal === 1 ? 'is' : 'are'} left out.` });
    const base = inputs.length === 1 ? inputs[0].name.replace(/\.enex$/i, '') : tr(L, 'Notizen', 'Notes');
    return {
      outputs: [{
        name: ctx.fileName(base, tr(L, ' (Markdown)', ' (Markdown)'), 'zip'),
        blob: zip,
        note: tr(L, `${notesTotal} ${notesTotal === 1 ? 'Notiz' : 'Notizen'}, ${attTotal} ${attTotal === 1 ? 'Anhang' : 'Anhänge'}`, `${notesTotal} ${notesTotal === 1 ? 'note' : 'notes'}, ${attTotal} ${attTotal === 1 ? 'attachment' : 'attachments'}`),
      }],
    };
  },
};
