const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const rows = fs.readFileSync(dir + '/invoice.csv', 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
const money = (v) => Math.round(Number(String(v).replace(/[£$,\s]/g, '')) * 100) / 100;
const header = rows[0].map((h) => h.toLowerCase());
assert.deepStrictEqual(header.slice(0, 3), ['date', 'hours', 'amount'], 'header ' + rows[0]);
// Brightside only - including the row written " brightside " - hours x each row's own rate.
const body = rows.slice(1).filter((r) => !/total/i.test(r[0]));
assert.deepStrictEqual(body.map((r) => [r[0], Number(r[1]), money(r[2])]), [
  ['2026-09-01', 3, 135], ['2026-09-02', 1.5, 67.5], ['2026-09-04', 2.25, 135], ['2026-09-08', 0.75, 33.75], ['2026-09-09', 2, 90],
]);
const total = rows.find((r) => /total/i.test(r[0]));
assert(total, 'no TOTAL row');
assert.strictEqual(money(total[total.length - 1]), 461.25);
console.log('PASS');
