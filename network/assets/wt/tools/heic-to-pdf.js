// SEO preset of jpg-to-pdf: HEIC (iPhone photos) → PDF – only where the browser can decode HEIC (Safari).
// No HEIC decoder is shipped; the honest notice from convert-image is shown above the pick zone.
import { heicNotice } from './convert-image.js';
heicNotice(document.documentElement.lang === 'en' ? 'en' : 'de');
export { default } from './jpg-to-pdf.js';
