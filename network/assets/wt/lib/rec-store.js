// Where a recording goes while it runs: a file in the browser's private file system (OPFS, via a worker –
// survives a crash, needs no memory for long recordings) or, where that isn't available, memory.
// Files: fale-rec/<start ms>.<ext> plus an empty <stamp>.done once the recording was finished normally.
// Unfinished files are offered for recovery on the next visit; finished ones are removed then.

const DIR = 'fale-rec';

async function dirHandle(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

/** Can recordings be written to disk here? (OPFS + sync access handles in workers) */
export async function diskOk() {
  try {
    if (!navigator.storage?.getDirectory || typeof Worker === 'undefined') return false;
    await dirHandle(true);
    return true;
  } catch { return false; }
}

/** A sink for one recording. mime: the recorder's type. → { write(blob), finish() → File|Blob, size, disk } */
export async function openSink(mime, { forceMemory = false } = {}) {
  const ext = /mp4/i.test(mime) ? 'mp4' : 'webm';
  const name = `${Date.now()}.${ext}`;   // the start time, used for the recovery list
  if (!forceMemory && await diskOk()) {
    try { return await diskSink(name, mime); } catch { /* fall back to memory */ }
  }
  return memorySink(mime);
}

function memorySink(mime) {
  const parts = [];
  let size = 0, chain = Promise.resolve();
  return {
    disk: false,
    get size() { return size; },
    write(blob) { parts.push(blob); size += blob.size; return chain; },
    async finish() { return new Blob(parts, { type: mime }); },
    async discard() { parts.length = 0; },
  };
}

async function diskSink(name, mime) {
  const worker = new Worker(new URL('./rec-store-worker.js', import.meta.url), { type: 'module' });
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); } };
  const call = (msg, transfer = []) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer); });
  await call({ op: 'open', name });
  let size = 0, failed = null;
  let chain = Promise.resolve();
  const backup = [];   // if the disk fails mid-way (quota), the rest stays in memory
  return {
    disk: true,
    name,
    get size() { return size; },
    write(blob) {
      size += blob.size;
      chain = chain.then(async () => {
        if (failed) { backup.push(blob); return; }
        try { const buf = await blob.arrayBuffer(); await call({ op: 'write', buf }, [buf]); } catch (err) { failed = err; backup.push(blob); }
      });
      return chain;
    },
    async finish() {
      await chain;
      try { await call({ op: 'close' }); } catch { /* already closed */ }
      worker.terminate();
      const dir = await dirHandle();
      await dir.getFileHandle(name.replace(/\.\w+$/, '.done'), { create: true });
      const file = await (await dir.getFileHandle(name)).getFile();
      return backup.length ? new Blob([file, ...backup], { type: mime }) : new Blob([file], { type: mime });
    },
    async discard() {
      await chain.catch(() => {});
      try { await call({ op: 'close' }); } catch { /* ignore */ }
      worker.terminate();
      await removeRecording(name);
    },
  };
}

/** Recordings that were cut off (no .done): [{ name, file, mime, when }]. Finished leftovers are deleted. */
export async function recoverable() {
  if (!await diskOk()) return [];
  const dir = await dirHandle();
  const names = [];
  for await (const [n] of dir.entries()) names.push(n);
  const out = [];
  for (const n of names) {
    if (!/\.(webm|mp4)$/.test(n)) continue;
    const done = names.includes(n.replace(/\.\w+$/, '.done'));
    if (done) { await removeRecording(n); continue; }
    try {
      const file = await (await dir.getFileHandle(n)).getFile();
      if (!file.size) { await removeRecording(n); continue; }
      out.push({ name: n, file, mime: n.endsWith('.mp4') ? 'video/mp4' : 'video/webm', when: new Date(+n.split('.')[0] || 0) });
    } catch { /* still being written in another tab */ }
  }
  for (const n of names) if (n.endsWith('.done') && !names.includes(n.replace('.done', '.webm')) && !names.includes(n.replace('.done', '.mp4'))) await dir.removeEntry(n).catch(() => {});
  return out;
}

export async function removeRecording(name) {
  try {
    const dir = await dirHandle();
    await dir.removeEntry(name).catch(() => {});
    await dir.removeEntry(name.replace(/\.\w+$/, '.done')).catch(() => {});
  } catch { /* nothing stored */ }
}
