// pdf.js worker entry: polyfills for older Android System WebViews first, then the pdf.js worker.
// (ES modules evaluate their imports in order, so the polyfills are in place before pdf.js runs.)
import './pdfworker-compat.js';
import '../vendor/pdfjs/pdf.worker.min.mjs';
// re-exported for pdf.js' fallback ("fake worker" on the main thread): it imports this file and needs the handler
export { WorkerMessageHandler } from '../vendor/pdfjs/pdf.worker.min.mjs';
