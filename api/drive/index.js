'use strict';
// POST /api/drive?a=… – FaLe One (FaLe Drive + FaLe Fotos), end-to-end encrypted (see api/_lib/drive.js, docs/FALE-ONE-API.md).
const { makeDriveCore } = require('../_lib/drive');
let core = null;
module.exports = (req, res) => (core || (core = makeDriveCore())).drive(req, res);
