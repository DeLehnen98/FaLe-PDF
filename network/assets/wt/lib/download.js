// Saving and sharing results.

/** Start a download of a Blob. The object URL is revoked after a minute (slow mobile downloads). */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function toFiles(outputs) {
  return outputs.map(o => (o.blob instanceof File ? o.blob : new File([o.blob], o.name, { type: o.blob.type || 'application/octet-stream' })));
}

/** true when the Web Share API can share these outputs as files. */
export function canShare(outputs) {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: toFiles(outputs) }));
  } catch { return false; }
}

/** Share outputs; resolves 'shared' | 'aborted' | 'failed'. */
export async function share(outputs, title = '') {
  try {
    await navigator.share({ files: toFiles(outputs), title });
    return 'shared';
  } catch (err) {
    return err && err.name === 'AbortError' ? 'aborted' : 'failed';
  }
}
