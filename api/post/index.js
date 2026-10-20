'use strict';
// POST /api/post?a=config|quote|create|status|cancel|webhook – „Brief per Post“ (print & mail, paid via Stripe).
const { makePostalCore } = require('../_lib/postal');
let core = null;
module.exports = (req, res) => (core || (core = makePostalCore())).post(req, res);
