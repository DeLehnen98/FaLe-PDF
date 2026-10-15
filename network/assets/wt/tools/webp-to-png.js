// SEO preset of convert-image: WebP → PNG (lossless, transparency kept).
import { makeConverter } from './convert-image.js';
export default makeConverter({ to: 'png' });
