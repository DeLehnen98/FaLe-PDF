'use strict';
// POST /api/ai – run one server-defined AI task (see api/_lib/tasks.js).
const core = require('../_lib/instance');
module.exports = (req, res) => core().ai(req, res);
