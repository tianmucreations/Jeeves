const test = require('node:test');
const assert = require('node:assert');
const { daysUntil } = require('./countdown.js');

test('late in the evening, the 20th is still 3 days after the 17th', () => {
  assert.strictEqual(daysUntil('2026-09-20', new Date(2026, 8, 17, 23, 0)), 3);
});

test('first thing in the morning, the 20th is 3 days after the 17th', () => {
  assert.strictEqual(daysUntil('2026-09-20', new Date(2026, 8, 17, 0, 30)), 3);
});
