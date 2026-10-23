// Module worker for js/tools/images.js: decodes a photo, scales it down and encodes it as JPEG – off the main thread,
// so the app stays responsive while big phone photos (12–50 MP) are turned into a PDF or into preview thumbnails.
// Message: { id, file: Blob, maxDim, quality } → { id, ok, bytes: ArrayBuffer, w, h } | { id, ok: false, error }
self.onmessage = async e => {
  const { id, file, maxDim = 3000, quality = 0.9 } = e.data || {};
  let bmp = null, c = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); // EXIF rotation like <img>
    const w = bmp.width, h = bmp.height;
    if (!w || !h) throw new Error('leeres Bild');
    const f = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * f)), th = Math.max(1, Math.round(h * f));
    c = new OffscreenCanvas(tw, th);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white page, like the main-thread path
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, tw, th);
    bmp.close(); bmp = null;
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
    const bytes = await blob.arrayBuffer();
    c.width = 0; c.height = 0; // free the pixels right away (phones)
    self.postMessage({ id, ok: true, bytes, w: tw, h: th }, [bytes]);
  } catch (err) {
    if (bmp) try { bmp.close(); } catch { /* already closed */ }
    if (c) { c.width = 0; c.height = 0; }
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
