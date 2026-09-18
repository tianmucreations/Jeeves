const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const rows = fs.readFileSync(dir + '/left.csv', 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
assert.deepStrictEqual(rows[0].map((h) => h.toLowerCase()), ['month', 'left']);
const money = (v) => Math.round(Number(String(v).replace(/[£$,\s]/g, '')) * 100) / 100;
// Monthly bills every month; the yearly one only in August; the quarterly one in July (and October).
assert.deepStrictEqual(rows.slice(1).map((r) => [r[0], money(r[1])]), [['2026-07', 1454.5], ['2026-08', 924.5], ['2026-09', 1694.5]]);
console.log('PASS');
