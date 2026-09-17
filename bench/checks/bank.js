const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const summary = JSON.parse(fs.readFileSync(dir + '/summary.json', 'utf8'));
// Money spent per category: spending is positive, refunds reduce it, income is not spending.
const expected = { Groceries: 1086.55, Subscriptions: 32.98, Housing: 2100, Transport: 63.45 };
const got = Object.fromEntries(Object.entries(summary).filter(([k]) => k !== 'Income').map(([k, v]) => [k, Math.round(Math.abs(Number(v)) * 100) / 100]));
assert.deepStrictEqual(got, expected, JSON.stringify(summary));
console.log('PASS');
