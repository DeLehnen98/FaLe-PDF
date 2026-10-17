'use strict';
// POST /api/share?a=config|create|put|finish|info|open|get|status|delete – end-to-end encrypted share links;
// a=rq-create|rq-open|rq-upload|rq-retract|rq-status|rq-close|rq-remove|rq-delete – "Unterlagen anfordern".
const core = require('../_lib/share-instance');
module.exports = (req, res) => core().share(req, res);
