'use strict';
// GET /api/admob-ssv – AdMob rewarded-ad server-side verification callback (ECDSA-signed by Google).
const core = require('./_lib/instance');
module.exports = (req, res) => core().ssv(req, res);
