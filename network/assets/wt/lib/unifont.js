// Unicode text for every web tool that draws text into PDFs. Thin wrapper around the app's
// js/office/unifont.js (synced to lib/shared/office/unifont.js): Liberation Sans from
// vendor/pdfjs/standard_fonts/, embedded as a subset on save, as a real pdf-lib PDFFont.
//
//   const { font, text, missing } = await prepareText(doc, userText, { family: 'serif', bold: true });
//   page.drawText(text, { font, size, x, y });          // standard font if WinAnsi is enough, else Unicode
//   const f = await getFont(doc, { bold: true });        // always the Unicode face
//   measure(f, 'Łódź', 12)                               // width in pt
//   missingWarning(missing) → {de, en} | null           // only for scripts the font does not have
export {
  uniFont, uniFont as getFont, stdFont, fontForText, prepareText, cleanText, needsUnicode, isWinAnsiChar,
  missingWarning, unsupportedChars, preloadUniFont, loadUniTtf, uniPdfFont, parseTtf, subsetTtf, advance,
} from './shared/office/unifont.js';

/** Width of `text` in `font` at `size` pt. */
export const measure = (font, text, size) => font.widthOfTextAtSize(String(text ?? ''), size);
