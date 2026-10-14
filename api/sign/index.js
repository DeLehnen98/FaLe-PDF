'use strict';
// POST /api/sign?a=create|open|result|finish|status|delete – "Unterschrift anfordern" (encrypted, no account).
const core = require('../_lib/share-instance');
module.exports = (req, res) => core().sign(req, res);
