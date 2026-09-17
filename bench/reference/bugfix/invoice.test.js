const test = require('node:test');
const assert = require('node:assert');
const { invoiceTotal } = require('./invoice.js');

test('invoice total includes tax, in dollars and cents', () => {
  assert.strictEqual(invoiceTotal([{ qty: 3, price: 19.99 }], 0.1), 65.97);
});
