const { execSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const dir = process.argv[2];
assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(dir + '/split.test.js')).digest('hex'), process.argv[3], 'the test file was changed');
execSync('node --test', { cwd: dir, stdio: 'pipe' });
const { splitBill } = require(dir + '/split.js');
const cases = [[100, [1, 1, 1]], [0.05, [1, 1, 1]], [10, [1, 2, 3]], [99.99, [3, 3, 1]], [1234.56, [5, 0, 2, 2, 1]], [0.01, [1, 1]], [7, [1]], [33.33, [1, 1, 1, 1, 1, 1]]];
for (const [total, shares] of cases) {
  const parts = splitBill(total, shares);
  const cents = parts.map((p) => Math.round(p * 100));
  assert.ok(parts.every((p, i) => Math.abs(p * 100 - cents[i]) < 1e-6), `not whole cents: ${parts}`);
  assert.strictEqual(cents.reduce((a, b) => a + b, 0), Math.round(total * 100), `does not add up: ${total} ${shares} -> ${parts}`);
  const totalShares = shares.reduce((a, b) => a + b, 0);
  shares.forEach((s, i) => {
    const exact = (total * 100 * s) / totalShares;
    assert.ok(Math.abs(cents[i] - exact) < 1 + 1e-9, `unfair: ${total} ${shares} -> ${parts}`);
    if (s === 0) assert.strictEqual(cents[i], 0, 'no share must pay nothing');
  });
}
console.log('PASS');
