'use strict';
// One shared handler set per function instance (production wiring: env config, Supabase store).
const { makeCore } = require('./core');
let core = null;
module.exports = () => (core || (core = makeCore()));
