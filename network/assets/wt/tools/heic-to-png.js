// SEO preset of convert-image: HEIC (iPhone photos) → PNG – only where the browser can decode HEIC (Safari).
import { makeConverter, heicNotice } from './convert-image.js';
heicNotice(document.documentElement.lang === 'en' ? 'en' : 'de');
export default makeConverter({ to: 'png' });
