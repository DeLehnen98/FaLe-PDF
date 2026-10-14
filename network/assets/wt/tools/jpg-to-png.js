// SEO preset of convert-image: JPG → PNG (lossless from here on).
import { makeConverter } from './convert-image.js';
export default makeConverter({ to: 'png' });
