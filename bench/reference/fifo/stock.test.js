const test = require('node:test');
const assert = require('node:assert');
const { Portfolio } = require('./stock.js');

test('sells the oldest shares first', () => {
  const p = new Portfolio();
  p.buy(10, 5);
  p.buy(10, 8);
  assert.strictEqual(p.sell(15, 10), 60);
  assert.strictEqual(p.held(), 5);
});
