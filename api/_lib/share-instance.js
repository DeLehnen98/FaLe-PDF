'use strict';
// One shared handler set per function instance for the sharing endpoints (env config, Supabase store).
const { makeShareCore } = require('./share');
let core = null;
module.exports = () => (core || (core = makeShareCore()));
