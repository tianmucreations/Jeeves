const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
// Exactly the asked changes and nothing else: compared with the correct version, word for word.
const got = fs.readFileSync(dir + '/minutes.md', 'utf8').trimEnd();
const want = fs.readFileSync(path.join(__dirname, '../reference/minutes/minutes.md'), 'utf8').trimEnd();
assert.strictEqual(got, want);
console.log('PASS');
