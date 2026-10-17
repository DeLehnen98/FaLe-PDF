// SEO preset of the QR generator: EPC QR code (GiroCode) for SEPA transfers only, with a printable card that
// repeats payee, IBAN, amount and reference in plain text.
import { makeQrTool } from './qr-code.js';

export default makeQrTool('epc');
