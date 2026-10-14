'use strict';
// POST /api/ai/register – issue a pseudonymous, HMAC-signed device token.
const core = require('../_lib/instance');
module.exports = (req, res) => core().register(req, res);
