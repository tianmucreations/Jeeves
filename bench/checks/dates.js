const assert = require('assert');
const fs = require('fs');
const dir = process.argv[2];
const rows = fs.readFileSync(dir + '/schedule.csv', 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
assert.deepStrictEqual(rows[0].map((h) => h.toLowerCase()), ['event', 'date', 'weekday']);
// Day-first dates: 11/09 is 11 September, not 9 November.
assert.deepStrictEqual(rows.slice(1), [
  ['Dentist', '2026-09-11', 'Friday'],
  ['Birthday dinner', '2026-09-29', 'Tuesday'],
  ['Book club', '2026-10-03', 'Saturday'],
  ['Car service', '2026-10-20', 'Tuesday'],
  ['School fete', '2026-11-01', 'Sunday'],
]);
console.log('PASS');
