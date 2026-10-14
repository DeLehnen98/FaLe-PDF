// SEO preset of convert-image: HEIC (iPhone photos) → JPG – only where the browser can decode HEIC
// (Safari). No HEIC decoder is shipped; the page says so honestly before and after picking.
import { makeConverter, heicNotice } from './convert-image.js';
heicNotice(document.documentElement.lang === 'en' ? 'en' : 'de');
export default makeConverter({ to: 'jpg' });
