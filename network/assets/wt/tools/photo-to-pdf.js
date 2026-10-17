// SEO preset of jpg-to-pdf for phone photos: same options, but starts with "For email and messengers" –
// a dozen 12-megapixel photos would otherwise make a PDF too big to send.
import { withDefaults } from './jpg-to-pdf.js';

export default withDefaults({ shrink: 'email' });
