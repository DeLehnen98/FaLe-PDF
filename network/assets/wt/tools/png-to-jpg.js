// SEO preset of convert-image: PNG → JPG (transparent areas get a background colour).
import { makeConverter } from './convert-image.js';
export default makeConverter({ to: 'jpg' });
