const test = require('node:test');
const assert = require('node:assert');
const { splitBill } = require('./split.js');

const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

test('three equal people still add up to the bill', () => {
  assert.strictEqual(sum(splitBill(100, [1, 1, 1])), 100);
});

test('someone with no share pays nothing', () => {
  assert.deepStrictEqual(splitBill(50, [1, 0, 1]), [25, 0, 25]);
});
