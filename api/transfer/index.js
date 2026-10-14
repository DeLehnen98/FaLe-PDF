'use strict';
// POST /api/transfer?a=create|join|send|poll|close – signalling for "Geräte verbinden" (WebRTC, encrypted SDP).
const core = require('../_lib/share-instance');
module.exports = (req, res) => core().transfer(req, res);
