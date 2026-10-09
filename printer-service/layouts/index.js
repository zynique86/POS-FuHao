// Barrel export so the driver can `require('./layouts')` once and reach each
// pure-function layout without picking the file by hand.
//
// Each layout exposes { build(data) } that returns an array of entries.  See
// receipt.js for the entry contract.  Keep the layouts themselves pure — all
// Supabase and node-thermal-printer plumbing stays in index.js / drivers/.

const format  = require('./format');
const receipt = require('./receipt');
const kitchen = require('./kitchen');
const bar     = require('./bar');

module.exports = { format, receipt, kitchen, bar };
