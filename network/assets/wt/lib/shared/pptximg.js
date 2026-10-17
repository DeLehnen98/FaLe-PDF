// GENERATED – synced copy of js/tools/pptximg.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// PowerPoint files with one picture per slide (PDF → PowerPoint), written without freezing the page.
// pptxgenjs decodes every base64 picture synchronously while it writes the file – with a few hundred slides the
// page did not react for many seconds. So the slides get a tiny placeholder picture, and the real JPEG bytes are
// put into the finished ZIP afterwards (binary, no decoding; JSZip writes asynchronously in small steps).
// Import-free – used by the app (js/tools/toppt.js) and synced into the FaLe Werkzeuge (lib/shared/pptximg.js).

/** 1×1 white JPEG – stands in for each slide picture until writePptx() swaps in the real bytes. */
export const PLACEHOLDER_JPEG = 'image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0CiiigD//2Q==';

/**
 * @param pptx    pptxgenjs presentation whose slides each got exactly one picture (PLACEHOLDER_JPEG), in order
 * @param JSZip   the JSZip constructor
 * @param images  Uint8Array JPEG bytes, one per slide (same order)
 * @returns Blob of the .pptx
 */
export async function writePptx(pptx, JSZip, images, mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
  const raw = await pptx.write({ outputType: 'arraybuffer' });
  if (!images.length) return new Blob([raw], { type: mime });
  const zip = await JSZip.loadAsync(raw);
  const names = images.map((_, i) => `ppt/media/image-${i + 1}-1.jpeg`);
  const missing = names.filter(n => !zip.file(n));
  if (missing.length) throw new Error(`pptx: picture ${missing[0]} not found – the library changed its file layout`);
  names.forEach((n, i) => zip.file(n, images[i], { binary: true, compression: 'STORE' }));
  return zip.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
