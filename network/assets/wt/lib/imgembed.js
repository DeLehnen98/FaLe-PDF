// Put an image input onto PDF pages (pdf-lib), with the best quality/size strategy per format:
//   JPEG  → embedded as is (no re-compression); EXIF rotations 90/180/270° are applied with a page
//           transform, mirrored orientations (rare) are re-encoded through a canvas
//   PNG   → embedded losslessly (alpha becomes a soft mask)
//   other → decoded by the browser (WebP, GIF, BMP, AVIF, HEIC if supported) and stored as PNG when the
//           image has transparency, otherwise as high-quality JPEG
import { LIMITS, canvasScaleCap } from './shared/limits.js';
import { canvasToBlob } from './pdf.js';

const PT_PER_MM = 72 / 25.4;
export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
export const mm = v => v * PT_PER_MM;

/**
 * @returns {Promise<{image, width: number, height: number, orientation: number}>}
 *   width/height = displayed size in pixels (after EXIF rotation), orientation = rotation still to apply when drawing
 */
export async function embedImage(doc, input) {
  if (input.format === 'jpeg') {
    const info = await input.imageInfo();
    if ([1, 3, 6, 8].includes(info.orientation || 1)) {
      try {
        const image = await doc.embedJpg(await input.bytes());
        const o = info.orientation || 1;
        const swap = o === 6 || o === 8;
        return { image, width: swap ? image.height : image.width, height: swap ? image.width : image.height, orientation: o };
      } catch { /* unusual JPEG – fall through to the canvas path */ }
    }
  } else if (input.format === 'png') {
    try {
      const image = await doc.embedPng(await input.bytes());
      return { image, width: image.width, height: image.height, orientation: 1 };
    } catch { /* fall through */ }
  }
  // decode through the browser (EXIF orientation applied by createImageBitmap)
  const bmp = await input.bitmap();
  try {
    const s = canvasScaleCap(bmp.width, bmp.height, LIMITS.canvasPixels);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const alpha = hasAlpha(ctx, c.width, c.height);
    let image;
    if (alpha) image = await doc.embedPng(new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()));
    else {
      // white background for formats without alpha, then JPEG at high quality
      image = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer()));
    }
    c.width = c.height = 0;
    return { image, width: bmp.width, height: bmp.height, orientation: 1 };
  } finally { bmp.close?.(); }
}

function hasAlpha(ctx, w, h) {
  // sample rows (cheap) – a full scan of a 12 MP photo is still fast, but sampling is enough
  const step = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += step) {
    const d = ctx.getImageData(0, y, w, 1).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  }
  return false;
}

/**
 * Draw an embedded image into a box (fit, centred), applying a remaining EXIF rotation.
 * @param page  pdf-lib page
 * @param e     result of embedImage()
 * @param box   {x, y, width, height} in points
 */
export function drawFitted(page, e, PDFLib, box) {
  const s = Math.min(box.width / e.width, box.height / e.height);
  const dw = e.width * s, dh = e.height * s;
  const bx = box.x + (box.width - dw) / 2, by = box.y + (box.height - dh) / 2;
  const { degrees } = PDFLib;
  switch (e.orientation) {
    case 6: page.drawImage(e.image, { x: bx, y: by + dh, width: dh, height: dw, rotate: degrees(-90) }); break;
    case 8: page.drawImage(e.image, { x: bx + dw, y: by, width: dh, height: dw, rotate: degrees(90) }); break;
    case 3: page.drawImage(e.image, { x: bx + dw, y: by + dh, width: dw, height: dh, rotate: degrees(180) }); break;
    default: page.drawImage(e.image, { x: bx, y: by, width: dw, height: dh });
  }
}

/**
 * Page size for an image.
 * @param {'fit'|'a4'|'letter'} size
 * @param {'auto'|'portrait'|'landscape'} orient
 * @param {number} margin  points
 * @returns {[number, number]}
 */
export function pageSizeFor(e, size = 'a4', orient = 'auto', margin = 0) {
  if (size === 'fit') {
    // 1 px = 0.75 pt (96 dpi), capped at the PDF maximum of 14 400 pt
    let w = e.width * 0.75, h = e.height * 0.75;
    const k = Math.min(1, (14400 - 2 * margin) / Math.max(w, h));
    return [w * k + 2 * margin, h * k + 2 * margin];
  }
  let [w, h] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const landscape = orient === 'landscape' || (orient === 'auto' && e.width > e.height);
  return landscape ? [h, w] : [w, h];
}
