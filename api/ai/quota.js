'use strict';
// POST /api/ai/quota – availability (anonymous) and, with a token, today's quota for the device.
const core = require('../_lib/instance');
module.exports = (req, res) => core().quota(req, res);
