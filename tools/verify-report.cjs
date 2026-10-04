#!/usr/bin/env node
// Convenience entry point; the implementation lives with the server so the server folder is self-contained.
//   node tools/verify-report.cjs report.json
const verifier = require('../server/lib/verify-report.cjs');

module.exports = verifier;
if (require.main === module) verifier.cli(process.argv);
