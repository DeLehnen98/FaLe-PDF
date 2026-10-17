// SEO preset of the QR generator: Wi-Fi only, with a printable guest card (network name and password in plain
// text for devices that can't scan).
import { makeQrTool } from './qr-code.js';

export default makeQrTool('wifi');
