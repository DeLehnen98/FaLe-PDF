'use strict';
// POST /api/account?a=config|me|link|delete – optional FaLe-Konto (see api/_lib/account.js).
const { makeAccountCore } = require('../_lib/account');
let core = null;
module.exports = (req, res) => (core || (core = makeAccountCore())).account(req, res);
