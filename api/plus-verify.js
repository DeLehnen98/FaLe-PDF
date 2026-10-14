'use strict';
// POST /api/plus-verify – verify a Google Play subscription purchase and store the entitlement.
const core = require('./_lib/instance');
module.exports = (req, res) => core().plusVerify(req, res);
