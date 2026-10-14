'use strict';
// POST /api/share?a=config|create|put|finish|info|open|get|status|delete – end-to-end encrypted share links.
const core = require('../_lib/share-instance');
module.exports = (req, res) => core().share(req, res);
