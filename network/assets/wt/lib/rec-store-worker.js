// Worker for lib/rec-store.js: writes recording chunks straight into a file in the browser's private file
// system (OPFS) with a synchronous access handle. Unlike createWritable(), these writes land in the file
// itself, so after a crash or a closed tab the recording up to the last second is still there.
let handle = null, offset = 0, writes = 0;

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.op === 'open') {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('fale-rec', { create: true });
      const fh = await dir.getFileHandle(m.name, { create: true });
      handle = await fh.createSyncAccessHandle();
      handle.truncate(0);
      offset = 0; writes = 0;
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === 'write') {
      offset += handle.write(new Uint8Array(m.buf), { at: offset });
      if (++writes % 4 === 0) handle.flush();
      self.postMessage({ id: m.id, ok: true, size: offset });
    } else if (m.op === 'close') {
      if (handle) { handle.flush(); handle.close(); handle = null; }
      self.postMessage({ id: m.id, ok: true, size: offset });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err?.message || err) });
  }
};
